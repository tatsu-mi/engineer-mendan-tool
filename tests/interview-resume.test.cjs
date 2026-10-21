const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const compile = path => ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const id = '11111111-1111-4111-8111-111111111111';
const checks = { exports: {} };
vm.runInNewContext(compile('app/api/_shared/interview-checkpoint.ts'), checks);
const input = {
  durationSeconds: 200, resumeVersion: 0, revision: 1,
  conversationLog: [{ role: 'interviewer', text: 'Q1です。経験は？', questionNumber: 1 }],
  progress: {
    questionCount: 1, currentQuestionFollowUpCount: 0, reverseQuestionActive: false,
    sessionStarted: true, selfIntroductionRequested: true, selfIntroductionCompleted: true,
    selfIntroductionFollowUpAsked: true, isAwaitingModel: false,
    userTextBuffer: 'Java経験', aiTextBuffer: '', pendingTurnInstruction: ''
  }
};
function route(name, { authenticated = true, interview = { id, status: 'interrupted', resume_version: 0 }, rpcError = null } = {}) {
  const exports = {};
  const calls = [];
  const filters = [];
  const query = {
    select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
    maybeSingle: async () => ({ data: interview, error: null })
  };
  vm.runInNewContext(compile(`app/api/interviews/[id]/${name}/route.ts`), {
    exports,
    require: module => {
      if (module.endsWith('/auth')) return { requireAuthenticatedUser: async () => authenticated
        ? { memberId: 'owner-1' } : { response: Response.json({ error: 'login required' }, { status: 401 }) } };
      if (module.endsWith('/gemini')) return { noStoreJson: (body, init) => Response.json(body, init) };
      if (module.endsWith('/interview-checkpoint')) return checks.exports;
      if (module.endsWith('/supabase-admin')) return {
        getDatabaseErrorMessage: (_error, fallback) => fallback,
        getSupabaseAdmin: () => ({ from: () => query, rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: { resume_version: 1, progress: input.progress, conversation_logs: [] }, error: rpcError };
        } })
      };
      throw new Error(module);
    }
  });
  return {
    calls, filters,
    request: (method = 'POST', body = input, interviewId = id) => exports[method](new Request(`http://localhost/api/interviews/${id}/${name}`, {
      method, ...(method === 'POST' ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {})
    }), { params: Promise.resolve({ id: interviewId }) })
  };
}

test('checkpoint and interruption preserve progress with ownership and stale-save version passed to the database', async () => {
  for (const name of ['checkpoint', 'interrupt']) {
    const api = route(name);
    assert.equal((await api.request()).status, 200);
    assert.equal(api.calls[0].name, 'save_interview_checkpoint');
    assert.equal(api.calls[0].args.p_member_id, 'owner-1');
    assert.equal(api.calls[0].args.p_resume_version, 0);
    assert.equal(api.calls[0].args.p_revision, 1);
    assert.equal(api.calls[0].args.p_interrupted, name === 'interrupt');
    assert.equal(api.calls[0].args.p_progress.userTextBuffer, 'Java経験');
  }
});

test('checkpoint rejects invalid progress and logs without changing stored data', async () => {
  const api = route('checkpoint');
  for (const invalid of [null, {}, { ...input, resumeVersion: -1 }, { ...input, revision: 0 },
    { ...input, durationSeconds: -1 }, { ...input, progress: { ...input.progress, questionCount: 99 } },
    { ...input, progress: { ...input.progress, userTextBuffer: 'a'.repeat(20001) } },
    { ...input, conversationLog: [{ role: 'candidate', text: '' }] }
  ]) assert.equal((await api.request('POST', invalid)).status, 400);
  assert.equal(api.calls.length, 0);
});

test('resume requires authentication and ownership, and rejects completed interviews', async () => {
  const unauthenticated = route('resume', { authenticated: false });
  assert.equal((await unauthenticated.request()).status, 401);
  assert.equal(unauthenticated.calls.length, 0);
  const missing = route('resume', { interview: null });
  assert.equal((await missing.request()).status, 404);
  assert.deepEqual(missing.filters, [['id', id], ['member_id', 'owner-1']]);
  const completed = route('resume', { interview: { id, status: 'completed' } });
  assert.equal((await completed.request()).status, 409);
  assert.equal(completed.calls.length, 0);
});

test('reading a resume preview does not start it, and resuming returns the snapshot locked by the database', async () => {
  const api = route('resume');
  assert.equal((await api.request('GET')).status, 200);
  assert.equal(api.calls.length, 0);
  const response = await api.request();
  const data = await response.json();
  assert.equal(data.interview.resume_version, 1);
  assert.deepEqual(data.interview.progress, input.progress);
  assert.equal(api.calls[0].name, 'resume_interview');
  assert.equal(api.calls[0].args.p_resume_version, 0);
  const conflict = route('resume', { rpcError: { message: 'interview_not_resumable' } });
  assert.equal((await conflict.request()).status, 409);
});
