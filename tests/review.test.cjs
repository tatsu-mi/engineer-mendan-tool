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
  const fixture = require('./fixtures/review.cjs');
  const review = structuredClone(fixture.review);
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
      const generated = { ...fixture.generatedReview, scores: review.scores };
      const schema = JSON.parse(options.body).generationConfig.responseSchema;
      for (const key of ['technical', 'communication', 'attitude', 'feedback']) {
        assert.deepEqual(schema.properties[key].required, key === 'feedback' ? ['summary', 'target', 'improvement', 'example'] : ['summary', 'guidance', 'advice', 'improvement', 'example']);
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] });
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
  assert.match(prompts[0], /評価の中心は「この候補者が今回の案件で活躍できるか」/);
  assert.match(prompts[0], /受け答えが的確であることだけでは、この水準を超えない/);
  assert.match(prompts[0], /主要な必須要件の適合や本人の役割・判断・行動・結果が未確認で、活躍できると判断できない場合は3点以下/);
  assert.match(prompts[0], /根拠が足りなければ3点以下に見直す/);
  assert.doesNotMatch(prompts[0], /すべてが揃うこと.*一律の必須条件にしない|この行動の評価を3点に抑えない|課題と対応が結び付く実務上の工夫は4点を支持/);
  assert.equal(saved.length, 3);
  assert.equal(saved[0].args.p_interview_id, input.interviewId);
  assert.equal(saved[0].args.p_review.scores['姿勢・意欲'], 3);

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
