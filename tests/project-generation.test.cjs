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
const project = {
  projectName: '在庫管理システム刷新',
  interviewerRole: '開発チームリーダー',
  requiredSkills: 'Java、Spring Boot、SQL',
  projectDetail: '5名のチームで設計・実装・テストを担当する。'
};

function route({ authenticated = true, fetchImpl } = {}) {
  const exports = {};
  const calls = [];
  vm.runInNewContext(source('app/api/project/route.ts'), {
    exports, AbortSignal,
    require: name => name.endsWith('/auth')
      ? { requireAuthenticatedUser: async () => authenticated
        ? { memberId: 'member-1' }
        : { response: Response.json({ error: 'ログインが必要です' }, { status: 401 }) } }
      : gemini.exports,
    fetch: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return fetchImpl ? fetchImpl() : Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(project) }] } }]
      });
    }
  });
  return {
    calls,
    post: (body, apiKey = 'test-key') => exports.POST(new Request('http://localhost/api/project', {
      method: 'POST', headers: { 'x-gemini-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }))
  };
}

test('API: all match levels generate a complete project with distinct requirements', async () => {
  const api = route();
  for (const [matchLevel, label] of [['high', '高'], ['medium', '中'], ['low', '低']]) {
    const response = await api.post({ skillSheet: 'Java経験3年', matchLevel });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { project });
    const call = api.calls.at(-1);
    assert.equal(call.headers['x-goog-api-key'], 'test-key');
    assert.match(call.body.systemInstruction.parts[0].text, new RegExp(`指定のマッチ度\\n${label}：`));
    assert.match(call.body.contents[0].parts[0].text, /Java経験3年/);
    assert.deepEqual(call.body.generationConfig.responseSchema.required, Object.keys(project));
  }
  assert.equal(new Set(api.calls.map(call => call.body.systemInstruction.parts[0].text)).size, 3);
});

test('API: rejects unauthenticated requests, missing keys and invalid input without calling Gemini', async () => {
  const unauthenticated = route({ authenticated: false });
  assert.equal((await unauthenticated.post({})).status, 401);
  assert.equal(unauthenticated.calls.length, 0);
  const api = route();
  assert.equal((await api.post({}, '')).status, 400);
  for (const input of [null, [], 'text', {},
    { skillSheet: ' ', matchLevel: 'high' },
    { skillSheet: 'a'.repeat(120001), matchLevel: 'high' },
    { skillSheet: 123, matchLevel: 'high' },
    { skillSheet: 'Java', matchLevel: 'invalid' },
    { skillSheet: 'Java', matchLevel: '__proto__' }
  ]) assert.equal((await api.post(input)).status, 400);
  assert.equal(api.calls.length, 0);
});

test('API: malformed, empty and oversized model output never becomes a project', async () => {
  for (const output of ['invalid JSON', 'null', '[]', '{}',
    JSON.stringify({ ...project, requiredSkills: ' ' }),
    JSON.stringify({ ...project, projectName: 'a'.repeat(1001) })
  ]) {
    const api = route({ fetchImpl: () => Response.json({
      candidates: [{ content: { parts: [{ text: output }] } }]
    }) });
    const response = await api.post({ skillSheet: 'Java', matchLevel: 'high' });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).project, undefined);
  }
});

test('API: upstream failure, safety block, network error and timeout return JSON errors', async () => {
  for (const fetchImpl of [
    () => Response.json({ error: { message: 'quota exceeded' } }, { status: 429 }),
    () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
    () => { throw new TypeError('fetch failed'); },
    () => { throw new DOMException('timed out', 'TimeoutError'); }
  ]) {
    const api = route({ fetchImpl });
    const response = await api.post({ skillSheet: 'Java', matchLevel: 'low' });
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
  }
});

function browser(fetchImpl) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, textContent: '',
      classList: { toggle() {}, add() {}, remove() {} }
    });
    return elements.get(id);
  };
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    exports: {}, document: { getElementById: element }, AbortController,
    fetch: fetchImpl,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(source('app/interview-client.ts'), context);
  element('apiKeyInput').value = 'test-key';
  element('skillSheet').value = 'Java経験3年';
  element('projectMatchLevel').value = 'high';
  for (const field of Object.keys(project)) element(field).value = `入力済み：${field}`;
  return { element, timers, run: code => vm.runInContext(code, context) };
}

test('UI: sends the current skill sheet and match level, blocks duplicate generation and session start, then allows editing', async () => {
  let finish;
  const calls = [];
  const app = browser((url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { finish = resolve; });
  });
  app.element('projectMatchLevel').value = 'low';
  const pending = app.run('generateProject()');
  await app.run('generateProject()');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/project');
  assert.deepEqual(JSON.parse(calls[0].options.body), { skillSheet: 'Java経験3年', matchLevel: 'low' });
  assert.equal(app.run('validateInputs()'), false);
  for (const id of ['generateProjectBtn', 'projectMatchLevel', 'skillSheet', 'skillSheetFile', 'projectName', 'startBtn']) {
    assert.equal(app.element(id).disabled, true, id);
  }
  finish(Response.json({ project }));
  await pending;
  for (const [field, value] of Object.entries(project)) {
    assert.equal(app.element(field).value, value);
    assert.equal(app.element(field).disabled, false);
  }
  assert.equal(app.element('startBtn').disabled, false);
  assert.equal(app.element('generateProjectBtn').disabled, false);
  assert.equal(app.element('skillSheet').value, 'Java経験3年');
  assert.match(app.element('projectGenerationStatus').textContent, /マッチ度「低」/);
});

test('UI: failures preserve existing fields and restore controls for retry', async () => {
  for (const fetchImpl of [
    async () => Response.json({ error: '生成できません' }, { status: 502 }),
    async () => Response.json({ project: { ...project, projectDetail: '' } }),
    async () => { throw new TypeError('fetch failed'); }
  ]) {
    const app = browser(fetchImpl);
    await app.run('generateProject()');
    for (const field of Object.keys(project)) assert.equal(app.element(field).value, `入力済み：${field}`);
    assert.equal(app.element('generateProjectBtn').disabled, false);
    assert.equal(app.element('startBtn').disabled, false);
    assert.equal(app.element('skillSheetFile').disabled, false);
    assert.match(app.element('projectGenerationStatus').textContent, /失敗/);
    assert.equal(app.timers.size, 0);
  }
});

test('UI: missing inputs and busy states do not send generation requests', async () => {
  for (const setup of [
    "$('apiKeyInput').value = ''", "$('skillSheet').value = ''",
    "$('projectMatchLevel').value = 'invalid'", 'isSkillSheetImporting = true',
    'isSkillSheetLoading = true', 'isSessionActive = true', 'reviewGenerationInProgress = true'
  ]) {
    const app = browser(() => assert.fail('unexpected generation request'));
    app.run(setup);
    await app.run('generateProject()');
  }
});

test('UI: timeout keeps existing data and lets the user retry', async () => {
  const app = browser((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const pending = app.run('generateProject()');
  for (const callback of app.timers.values()) callback();
  await pending;
  assert.match(app.element('projectGenerationStatus').textContent, /タイムアウト/);
  assert.equal(app.element('generateProjectBtn').disabled, false);
  assert.equal(app.element('projectName').value, '入力済み：projectName');
});
