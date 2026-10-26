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
const review = { overall: '△', scores: { 技術力: 3, コミュニケーション: 3, '姿勢・意欲': 3, 総合: 3 },
  technical: '技術', communication: '説明', attitude: '行動', feedback: '助言' };

function app({ administrator = false, authenticated = true, record = interview, upstream = review, readError = false } = {}) {
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
        getSupabaseAdmin: () => ({ rpc: async (_, args) => { saves.push(args); return { error: null }; } })
      };
      return gemini;
    },
    fetch: async (_, options) => {
      prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(upstream) }] } }] });
    }
  });
  return { prompts, saves, reads, post: (extra = {}) => route.POST(new Request('http://localhost/api/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': 'test' },
    body: JSON.stringify({ interviewId: 'interview-id', reevaluate: true, ...extra })
  })) };
}

test('reevaluation uses ordered stored data, ignores supplied content, and preserves previous media advice', async () => {
  const api = app();
  assert.equal((await api.post({ projectName: 'FORGED_PROJECT', requiredSkills: 'FORGED_SKILL',
    conversationLog: [{ role: 'candidate', text: 'FORGED_ANSWER' }], mediaFeedback: { ...feedback, vocal: 'FORGED_MEDIA' } })).status, 200);
  assert.deepEqual(api.reads, [['interview-id', 'owner']]);
  const prompt = api.prompts[0];
  assert.match(prompt, /SAVED_PROJECT/);
  assert.match(prompt, /SAVED_SKILL/);
  assert.ok(prompt.indexOf('SAVED_QUESTION') < prompt.indexOf('SAVED_ANSWER'));
  assert.doesNotMatch(prompt, /FORGED_|PREVIOUS_/);
  assert.equal(api.saves[0].p_member_id, 'owner');
  assert.deepEqual(JSON.parse(JSON.stringify(api.saves[0].p_review.media_feedback)), feedback);
});

test('administrator reevaluation saves against the interview owner', async () => {
  const api = app({ administrator: true, record: { ...interview, member_id: 'other-member' } });
  assert.equal((await api.post()).status, 200);
  assert.deepEqual(api.reads, [['interview-id', undefined]]);
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
  assert.equal(api.saves[0].p_review.media_feedback, undefined);
});
