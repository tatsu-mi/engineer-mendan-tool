const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, context = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { exports, require, ...context });
  return exports;
}
const gemini = load('app/api/_shared/gemini.ts');
const media = load('lib/media-review.ts');
const feedback = { visual: 'PREVIOUS_VISUAL', vocal: 'PREVIOUS_VOCAL', coverage: 'PREVIOUS_COVERAGE' };
const interview = {
  member_id: 'owner', status: 'completed',
  interview_projects: [{ project_name: 'SAVED_PROJECT', required_skills: 'SAVED_SKILL' }],
  interview_reviews: [{ media_feedback: feedback }],
  conversation_logs: [
    { sequence_number: 2, speaker_role: 'candidate', text: 'SAVED_ANSWER' },
    { sequence_number: 1, speaker_role: 'interviewer', text: 'SAVED_QUESTION' }
  ]
};
const { generatedReview, review } = require('./fixtures/review.cjs');

function app({ administrator = false, authenticated = true, record = interview, upstream = generatedReview, readError = false, saveError = false } = {}) {
  const prompts = [], saves = [], reads = [];
  const route = load('app/api/review/route.ts', {
    require: name => {
      if (name.endsWith('/auth')) return { requireAuthenticatedUser: async () => authenticated
        ? { memberId: 'owner', email: 'owner@example.com' } : { response: Response.json({}, { status: 401 }) } };
      if (name.endsWith('/media-review')) return media;
      if (name.endsWith('/interview-history')) return {
        getHistoryViewer: async () => ({ isAdministrator: administrator }),
        getInterviewDetail: async (...args) => { reads.push(args); if (readError) throw new Error('DB'); return record; }
      };
      if (name.endsWith('/supabase-admin')) return {
        getDatabaseErrorMessage: (_, fallback) => fallback,
        getSupabaseAdmin: () => ({ rpc: async (_, args) => { saves.push(args); return { error: saveError ? { message: 'SAVE_FAILED' } : null }; } })
      };
      return gemini;
    },
    fetch: async (_, options) => {
      prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
      const result = Array.isArray(upstream) ? upstream[Math.min(prompts.length - 1, upstream.length - 1)] : upstream;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
    }
  });
  return { prompts, saves, reads, post: (extra = {}) => route.POST(new Request('http://localhost/api/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': 'test' },
    body: JSON.stringify({ interviewId: 'interview-id', reevaluate: true, ...extra })
  })), patch: (extra = {}) => route.PATCH(new Request('http://localhost/api/review', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewId: 'interview-id', review, ...extra })
  })) };
}

test('reevaluation uses ordered stored data, ignores supplied content, and preserves previous media advice', async () => {
  const api = app();
  const response = await api.post({ projectName: 'FORGED_PROJECT', requiredSkills: 'FORGED_SKILL',
    conversationLog: [{ role: 'candidate', text: 'FORGED_ANSWER' }], mediaFeedback: { ...feedback, vocal: 'FORGED_MEDIA' } });
  assert.equal(response.status, 200);
  assert.deepEqual(api.reads, [['interview-id', 'owner']]);
  const prompt = api.prompts[0];
  assert.match(prompt, /SAVED_PROJECT/);
  assert.match(prompt, /SAVED_SKILL/);
  assert.ok(prompt.indexOf('SAVED_QUESTION') < prompt.indexOf('SAVED_ANSWER'));
  assert.doesNotMatch(prompt, /FORGED_|PREVIOUS_/);
  assert.equal(api.saves.length, 0);
  const draft = (await response.json()).review;
  assert.deepEqual(draft.media_feedback, feedback);
  assert.equal((await api.patch({ review: draft })).status, 200);
  assert.equal(api.prompts.length, 1);
  assert.equal(api.saves[0].p_member_id, 'owner');
  assert.deepEqual(JSON.parse(JSON.stringify(api.saves[0].p_review)), draft);
});

test('administrator reevaluation saves against the interview owner', async () => {
  const api = app({ administrator: true, record: { ...interview, member_id: 'other-member' } });
  assert.equal((await api.post()).status, 200);
  assert.equal(api.saves.length, 0);
  assert.equal((await api.patch()).status, 200);
  assert.deepEqual(api.reads, [['interview-id', undefined], ['interview-id', undefined]]);
  assert.equal(api.saves[0].p_member_id, 'other-member');
});

test('unauthorized, missing, active, and empty interviews never invoke generation or save', async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401], [{ record: null }, 404], [{ readError: true }, 502],
    [{ record: { ...interview, status: 'in_progress' } }, 409],
    [{ record: { ...interview, conversation_logs: [] } }, 400],
    [{ record: { ...interview, conversation_logs: [{ sequence_number: 1, speaker_role: 'candidate', text: ' ' }] } }, 400]
  ]) {
    const api = app(options);
    assert.equal((await api.post()).status, status);
    assert.equal(api.prompts.length, 0);
    assert.equal(api.saves.length, 0);
  }
});

test('invalid generation preserves the saved review; interrupted interviews without media can be evaluated', async () => {
  const invalid = app({ upstream: { overall: '△' } });
  assert.equal((await invalid.post()).status, 502);
  assert.equal(invalid.saves.length, 0);
  const api = app({ record: { ...interview, status: 'interrupted', interview_reviews: [] } });
  assert.equal((await api.post()).status, 200);
  assert.equal(api.saves.length, 0);
  assert.equal((await api.patch()).status, 200);
  assert.equal(api.saves[0].p_review.media_feedback, undefined);
});


test('save requires authentication, access, finished status, and a valid review', async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401], [{ record: null }, 404], [{ readError: true }, 502],
    [{ record: { ...interview, status: 'in_progress' } }, 409]
  ]) {
    const api = app(options);
    assert.equal((await api.patch()).status, status);
    assert.equal(api.prompts.length, 0);
    assert.equal(api.saves.length, 0);
  }
  for (const invalid of [null, {}, { ...review, scores: { ...review.scores, 総合: 6 } }]) {
    const api = app();
    assert.equal((await api.patch({ review: invalid })).status, 400);
    assert.equal(api.saves.length, 0);
  }
});

test('explicit save preserves stored media advice and reports database failures', async () => {
  const api = app();
  assert.equal((await api.patch({ review: { ...review, media_feedback: { ...feedback, vocal: 'FORGED' }, extra: true } })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(api.saves[0].p_review.media_feedback)), feedback);
  assert.equal(api.saves[0].p_review.extra, undefined);
  assert.equal(api.prompts.length, 0);
  const failed = app({ saveError: true });
  assert.equal((await failed.patch()).status, 502);
});


test('missing advice is regenerated once and all four comments include a heading and body', async () => {
  for (const key of ['technical', 'communication', 'attitude', 'feedback']) {
    const missing = { ...generatedReview, [key]: { summary: '総括のみ' } };
    const api = app({ upstream: [missing, generatedReview] });
    const response = await api.post();
    assert.equal(response.status, 200);
    assert.equal(api.prompts.length, 2);
    const result = (await response.json()).review;
    for (const field of ['technical', 'communication', 'attitude', 'feedback']) {
      assert.equal(result[field], review[field]);
    }
    assert.equal(api.saves.length, 0);
  }
});

test('empty improvement never returns a draft or overwrites stored review', async () => {
  for (const advice of [undefined, '', '   ']) {
    const api = app({ upstream: { ...generatedReview, technical: { ...generatedReview.technical, improvement: advice } } });
    const response = await api.post();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).review, undefined);
    assert.equal(api.prompts.length, 2);
    assert.equal(api.saves.length, 0);
  }
});

test('explicit save rejects comments without a specific-advice body', async () => {
  for (const key of ['technical', 'communication', 'attitude', 'feedback']) {
    for (const comment of ['総括だけ', '総括\n\n具体的なアドバイス\n', '総括\n\n【具体的なアドバイス】']) {
      const api = app();
      assert.equal((await api.patch({ review: { ...review, [key]: comment } })).status, 400);
      assert.equal(api.saves.length, 0);
    }
  }
});


test('five-point comments omit advice while other comments still require the complete template', async () => {
  const high = { ...generatedReview, overall: '◎', scores: { 技術力: 5, コミュニケーション: 5, '姿勢・意欲': 5, 総合: 5 } };
  const api = app({ upstream: high });
  const response = await api.post();
  assert.equal(response.status, 200);
  const result = (await response.json()).review;
  for (const key of ['technical', 'communication', 'attitude', 'feedback']) {
    assert.equal(result[key], high[key].summary);
    assert.doesNotMatch(result[key], /具体的なアドバイス|対象の質問・回答：|改善点：|回答例：/);
  }
  assert.equal((await api.patch({ review: result })).status, 200);
  assert.equal(api.prompts.length, 1);

  const summariesOnly = { ...high };
  for (const key of ['technical', 'communication', 'attitude', 'feedback']) summariesOnly[key] = { summary: high[key].summary };
  assert.equal((await app({ upstream: summariesOnly }).post()).status, 200);
  const incomplete = app({ upstream: { ...generatedReview, feedback: { ...generatedReview.feedback, example: '' } } });
  assert.equal((await incomplete.post({ reevaluate: false, projectName: 'API', requiredSkills: 'Java',
    conversationLog: [{ role: 'candidate', text: '設計しました。' }] })).status, 502);
  assert.equal(incomplete.prompts.length, 2);
  assert.equal(incomplete.saves.length, 0);
});

test('mixed scores omit only advice for the corresponding five-point category', async () => {
  const upstream = { ...generatedReview, scores: { ...generatedReview.scores, 技術力: 5, 総合: 4 } };
  const api = app({ upstream });
  const response = await api.post();
  assert.equal(response.status, 200);
  const result = (await response.json()).review;
  assert.equal(result.technical, '設計経験を確認。');
  assert.equal(result.communication, review.communication);
  assert.equal(result.attitude, review.attitude);
  assert.equal(result.feedback, review.feedback);
  assert.equal((await api.patch({ review: result })).status, 200);
});

test('missing example or target is rejected for scores one through four', async () => {
  for (const score of [1, 2, 3, 4]) {
    for (const [key, field] of [['technical', 'guidance'], ['technical', 'advice'], ['technical', 'example'], ['communication', 'advice'], ['attitude', 'guidance'], ['attitude', 'advice'], ['communication', 'improvement'], ['attitude', 'example'], ['feedback', 'target'], ['feedback', 'example']]) {
      const api = app({ upstream: { ...generatedReview,
        scores: { 技術力: score, コミュニケーション: score, '姿勢・意欲': score, 総合: score },
        [key]: { ...generatedReview[key], [field]: '' } } });
      assert.equal((await api.post()).status, 502);
      assert.equal(api.saves.length, 0);
    }
  }
});


test('overall five omits feedback advice without hiding lower-scored category advice', async () => {
  const upstream = { ...generatedReview, overall: '◎', scores: { ...generatedReview.scores, 総合: 5 } };
  const api = app({ upstream });
  const response = await api.post();
  assert.equal(response.status, 200);
  const result = (await response.json()).review;
  assert.equal(result.technical, review.technical);
  assert.equal(result.feedback, '判断理由を具体化してください。');
  assert.equal((await api.patch({ review: result })).status, 200);
  assert.equal((await api.patch({ review: { ...review, technical: '総括のみ' } })).status, 400);
});


test('each category retains general guidance in the opening paragraph and an independent specific-advice body', async () => {
  const api = app();
  const response = await api.post();
  assert.equal(response.status, 200);
  const result = (await response.json()).review;
  for (const key of ['technical', 'communication', 'attitude']) {
    assert.equal(result[key].split('\n\n')[0], generatedReview[key].summary + generatedReview[key].guidance);
    assert.ok(result[key].includes(`具体的なアドバイス：\n${generatedReview[key].advice}\n改善点：`));
    const emptyAdvice = result[key].replace(generatedReview[key].advice, '');
    assert.equal((await api.patch({ review: { ...result, [key]: emptyAdvice } })).status, 400);
  }
  assert.equal(api.saves.length, 0);
});
