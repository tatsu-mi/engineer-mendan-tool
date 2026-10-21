const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function source(path) {
  return ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

const gemini = { exports: {} };
vm.runInNewContext(source('app/api/_shared/gemini.ts'), { exports: gemini.exports, require });

test('review accepts conversation without a skill sheet and ignores any legacy sheet input', async () => {
  const exports = {};
  const prompts = [];
  const saved = [];
  const review = {
    overall: '○', scores: { 技術力: 3, コミュニケーション: 3, '姿勢・意欲': 4, 総合: 3 },
    technical: '会話で確認した設計経験。', communication: '具体的な説明。',
    attitude: '前向きな回答。', feedback: '判断理由をさらに具体化してください。'
  };
  vm.runInNewContext(source('app/api/review/route.ts'), {
    exports,
    require: name => {
      if (name.endsWith('/auth')) return { requireAuthenticatedUser: async () => ({ memberId: 'member-1' }) };
      if (name.endsWith('/supabase-admin')) return {
        getSupabaseAdmin: () => ({ rpc: async (name, args) => { saved.push({ name, args }); return { error: null }; } })
      };
      return gemini.exports;
    },
    fetch: async (url, options) => {
      prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(review) }] } }] });
    }
  });
  const input = {
    interviewId: 'interview-1', projectName: 'API開発', requiredSkills: 'Java',
    conversationLog: [
      { role: 'interviewer', text: '設計で工夫した点を教えてください。' },
      { role: 'candidate', text: 'API設計でエラー応答を統一しました。' },
      { role: 'interviewer', text: 'APIのエラー応答を統一されたのですね。' }
    ]
  };
  for (const sheet of [undefined, 'SECRET_SHEET_EXPERT', 'SECRET_SHEET_BEGINNER']) {
    const response = await exports.POST(new Request('http://localhost/api/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': 'test-key' },
      body: JSON.stringify({ ...input, ...(sheet === undefined ? {} : { skillSheet: sheet }) })
    }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).review, review);
  }
  assert.equal(new Set(prompts).size, 1, 'changing only the skill sheet cannot change evaluation input');
  assert.doesNotMatch(prompts[0], /SECRET_SHEET/);
  assert.match(prompts[0], /候補者の評価は会話内容だけを根拠/);
  assert.match(prompts[0], /エラー応答を統一/);
  assert.equal(saved.length, 3);
  assert.equal(saved[0].args.p_interview_id, input.interviewId);
  assert.equal(saved[0].args.p_review.scores['姿勢・意欲'], 4);

  for (const score of [undefined, 0, 6, 4.5, '4']) {
    review.scores['姿勢・意欲'] = score;
    const response = await exports.POST(new Request('http://localhost/api/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': 'test-key' },
      body: JSON.stringify(input)
    }));
    assert.equal(response.status, 502, 'missing or invalid attitude scores cannot be saved');
  }
  assert.equal(saved.length, 3);
});
