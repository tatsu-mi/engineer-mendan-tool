const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
function moduleSource(path) {
  return ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}
const validation = {};
vm.runInNewContext(moduleSource('lib/media-review.ts'), { exports: validation });
const gemini = {};
vm.runInNewContext(moduleSource('app/api/_shared/gemini.ts'), { exports: gemini, require });
const id = '12345678-1234-1234-1234-123456789012';
const sample = { mimeType: 'audio/webm', data: Buffer.from('audio sample').toString('base64'), startSeconds: 65, durationSeconds: 12 };
const feedback = { visual: '身振りの観察。', vocal: '1分5秒付近で抑揚があります。', coverage: '抜粋のみ。' };
function route({ owner = true, authenticated = true, upstream = true } = {}) {
  const exports = {};
  const calls = [];
  const filters = [];
  vm.runInNewContext(moduleSource('app/api/media-review/route.ts'), {
    exports, Buffer, AbortSignal,
    require: name => {
      if (name.endsWith('/auth')) return { requireAuthenticatedUser: async () => authenticated
        ? { memberId: 'member-1' } : { response: Response.json({ error: 'unauthorized' }, { status: 401 }) } };
      if (name.endsWith('/supabase-admin')) return { getSupabaseAdmin: () => ({ from() {
        const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
          async maybeSingle() { return { data: owner ? { id } : null, error: null }; } };
        return query;
      } }) };
      if (name.endsWith('/media-review')) return validation;
      return gemini;
    },
    fetch: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return upstream ? Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(feedback) }] } }] })
        : Response.json({ error: { message: 'upstream failed' } }, { status: 500 });
    }
  });
  const post = input => exports.POST(new Request('http://localhost/api/media-review', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': 'test' },
    body: typeof input === 'string' ? input : JSON.stringify(input)
  }));
  return { post, calls, filters };
}
test('bounds media size, count, types, timing and feedback', () => {
  assert.equal(validation.isMediaSamples([sample]), true);
  for (const invalid of [[], Array(9).fill(sample), [{ ...sample, mimeType: 'text/plain' }],
    [{ ...sample, data: 'bad??' }], [{ ...sample, startSeconds: -1 }],
    [{ ...sample, durationSeconds: 13 }], [{ ...sample, durationSeconds: null }],
    Array(2).fill({ ...sample, data: Buffer.alloc(800000).toString('base64') })]) {
    assert.equal(validation.isMediaSamples(invalid), false);
  }
  assert.equal(validation.isMediaFeedback(feedback), true);
  assert.equal(validation.isMediaFeedback({ ...feedback, visual: '' }), false);
});
test('checks authentication and interview ownership before sending media', async () => {
  for (const [settings, status] of [[{ authenticated: false }, 401], [{ owner: false }, 404]]) {
    const app = route(settings);
    assert.equal((await app.post({ interviewId: id, samples: [sample] })).status, status);
    assert.equal(app.calls.length, 0);
  }
});
test('sends media with timestamps, enforces audio-only visual result and exact coverage', async () => {
  const app = route();
  const response = await app.post({ interviewId: id, samples: [sample] });
  assert.equal(response.status, 200);
  const result = (await response.json()).mediaFeedback;
  assert.match(result.visual, /音声のみ/);
  assert.equal(result.vocal, feedback.vocal);
  assert.match(result.coverage, /1区間・計約12秒/);
  assert.ok(app.filters.some(([key, value]) => key === 'member_id' && value === 'member-1'));
  const parts = app.calls[0].contents[0].parts;
  assert.match(parts[1].text, /1分5秒/);
  assert.deepEqual(parts[2].inlineData, { mimeType: sample.mimeType, data: sample.data });
  assert.match(parts[0].text, /性格、本心/);
});
test('rejects malformed and oversized media without upstream calls; reports upstream errors', async () => {
  const app = route();
  for (const input of ['{', { interviewId: id, samples: [{ ...sample, mimeType: 'text/html' }] }]) {
    assert.equal((await app.post(input)).status, 400);
  }
  assert.equal((await app.post('x'.repeat(2100001))).status, 413);
  assert.equal(app.calls.length, 0);
  assert.equal((await route({ upstream: false }).post({ interviewId: id, samples: [sample] })).status, 502);
});
test('stores media feedback separately without changing conversation scoring input', async () => {
  const exports = {};
  const prompts = [];
  let saved;
  const review = { overall: '○', scores: { 技術力: 3, コミュニケーション: 3, '姿勢・意欲': 3, 総合: 3 },
    technical: '設計経験。', communication: '説明。', attitude: '回答。', feedback: '具体化。' };
  vm.runInNewContext(moduleSource('app/api/review/route.ts'), {
    exports,
    require: name => {
      if (name.endsWith('/auth')) return { requireAuthenticatedUser: async () => ({ memberId: 'member-1' }) };
      if (name.endsWith('/supabase-admin')) return { getSupabaseAdmin: () => ({ rpc: async (_, args) => { saved = args; return {}; } }) };
      if (name.endsWith('/media-review')) return validation;
      return gemini;
    },
    fetch: async (_, options) => { prompts.push(JSON.parse(options.body));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(review) }] } }] }); }
  });
  for (const mediaFeedback of [undefined, feedback]) {
    const response = await exports.POST(new Request('http://localhost/api/review', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': 'test' },
      body: JSON.stringify({ interviewId: id, projectName: 'API', requiredSkills: 'Java',
        conversationLog: [{ role: 'candidate', text: 'APIを設計しました。' }], mediaFeedback }) }));
    assert.equal(response.status, 200);
  }
  assert.deepEqual(prompts[0], prompts[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.p_review.media_feedback)), feedback);
});
