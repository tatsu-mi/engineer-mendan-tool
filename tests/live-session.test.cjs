const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(resolve(__dirname, '../app/interview-client.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function browser(fetchImpl) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', disabled: false, style: {}, remove() {},
      classList: { add() {}, remove() {}, toggle() {} },
      getContext: () => ({ clearRect() {} })
    });
    return elements.get(id);
  };
  const sockets = [];
  class WebSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; this.onopen(); }
    send(data) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(data)); }
    close(code = 1000, reason = '') {
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
    message(data) { return this.onmessage({ data: JSON.stringify(data) }); }
  }
  let nextTimer = 0;
  const timers = new Map();
  const intervals = new Map();
  const requests = [];
  const context = vm.createContext({
    exports: {}, Blob, WebSocket, AbortSignal, console,
    document: { getElementById: element, querySelectorAll: () => [] },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    setInterval: callback => { intervals.set(++nextTimer, callback); return nextTimer; },
    clearInterval: id => intervals.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetchImpl ? fetchImpl(url, options) : Response.json({ token: `token-${requests.length}` });
    }
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  element('apiKeyInput').value = 'test-key';
  run("isSessionActive = true; buildSystemPrompt = () => 'interview instructions';");
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const connect = async () => {
    const pending = run('connectLiveApi("initial-token", null, liveConnectionGeneration)');
    const socket = sockets.at(-1);
    socket.open();
    await socket.message({ setupComplete: {} });
    await pending;
    return socket;
  };
  return { element, run, sockets, requests, timers, intervals, tick, connect };
}

async function readyToResume(app, socket) {
  await socket.message({ sessionResumptionUpdate: { resumable: true, newHandle: 'checkpoint-1' } });
}

async function completeReconnect(app) {
  await app.tick();
  const socket = app.sockets.at(-1);
  socket.open();
  await socket.message({ setupComplete: {} });
  await app.tick();
  return socket;
}

test('GoAway at nine minutes: closes before the deadline and resumes with a fresh token, preserving interview state', async () => {
  const app = browser();
  const first = await app.connect();
  assert.deepEqual(first.sent[0].setup.sessionResumption, {});
  await readyToResume(app, first);
  app.run(`elapsedSeconds = 540; questionCount = 4; currentInterviewId = 'interview-1';
    conversationLog = [{ role: 'user', text: 'Javaの開発経験があります' }];
    userTextBuffer = '現在の回答';`);
  await first.message({ goAway: { timeLeft: '60s' } });
  assert.equal(first.readyState, 1, 'keeps the answer open until the turn boundary or deadline');
  const deadline = [...app.timers.values()].find(timer => timer.delay === 58000);
  assert.ok(deadline);
  deadline.callback();
  assert.equal(first.readyState, 3, 'client closes instead of waiting for server code 1008');
  assert.equal(app.run('isAnswerRecording'), false);
  const second = await completeReconnect(app);
  assert.match(second.url, /access_token=token-1/);
  assert.equal(app.requests[0].options.headers['x-gemini-api-key'], 'test-key');
  assert.deepEqual(second.sent[0].setup.sessionResumption, { handle: 'checkpoint-1' });
  assert.equal(second.sent[0].setup.systemInstruction.parts[0].text, first.sent[0].setup.systemInstruction.parts[0].text);
  assert.equal(app.run('elapsedSeconds'), 540);
  assert.equal(app.intervals.size, 1);
  assert.equal(app.run('questionCount'), 4);
  assert.equal(app.run('currentInterviewId'), 'interview-1');
  assert.equal(app.run('conversationLog.length'), 1);
  assert.equal(app.run('userTextBuffer'), '現在の回答');
  assert.equal(app.run('isSessionActive && isAnswerRecording && !liveReconnectInProgress'), true);
  assert.equal(app.element('nextBtn').disabled, false);
  assert.equal(second.sent[1].realtimeInput.activityStart !== undefined, true);
  await first.message({ serverContent: { inputTranscription: { text: '古い接続からの遅延データ' } } });
  assert.equal(app.run('userTextBuffer'), '現在の回答');
});

test('GoAway during an AI turn waits for completion and rotates before the next answer begins', async () => {
  const app = browser();
  const first = await app.connect();
  app.run('isAnswerRecording = false; isAwaitingModel = true;');
  await first.message({ sessionResumptionUpdate: { resumable: false, newHandle: '' } });
  await first.message({ goAway: { timeLeft: '60s' } });
  assert.equal(first.readyState, 1);
  await first.message({ serverContent: { turnComplete: true } });
  const settle = [...app.timers.values()].find(timer => timer.delay === 800);
  settle.callback();
  assert.equal(app.run('isAwaitingModel'), false);
  // 再開ハンドルがターン完了より遅れて届いても、新たに録音せず更新を待つ。
  assert.equal(app.run('isAnswerRecording'), false);
  await readyToResume(app, first);
  const second = await completeReconnect(app);
  assert.equal(first.readyState, 3);
  assert.equal(app.run('isAnswerRecording'), true);
  assert.deepEqual(second.sent[0].setup.sessionResumption, { handle: 'checkpoint-1' });
});

test('a resumable unexpected close recovers and repeated rotations issue distinct single-use tokens', async () => {
  const app = browser();
  const first = await app.connect();
  await readyToResume(app, first);
  first.close(1006);
  const second = await completeReconnect(app);
  await readyToResume(app, second);
  app.run('isAnswerRecording = false;');
  await second.message({ goAway: { timeLeft: '30s' } });
  const third = await completeReconnect(app);
  assert.equal(app.requests.length, 2);
  assert.notEqual(second.url, third.url);
  assert.equal(app.intervals.size, 1);
  assert.equal(app.run('isSessionActive'), true);
});

test('a failed token request is retried, then resumption can succeed', async () => {
  let calls = 0;
  const app = browser(() => ++calls === 1
    ? Response.json({ error: 'temporary failure' }, { status: 503 })
    : Response.json({ token: 'retry-token' }));
  const first = await app.connect();
  await readyToResume(app, first);
  const pending = app.run('reconnectLiveSession()');
  await completeReconnect(app);
  await pending;
  assert.equal(app.requests.length, 2);
  assert.equal(app.run('isSessionActive && isAnswerRecording'), true);
});

test('failed resumption is bounded and saves the interview as interrupted', async () => {
  const app = browser(url => url.includes('/interrupt')
    ? Response.json({}) : Response.json({ error: 'unavailable' }, { status: 503 }));
  const first = await app.connect();
  await readyToResume(app, first);
  app.run("currentInterviewId = 'interview-1'; elapsedSeconds = 540;");
  await app.run('reconnectLiveSession()');
  assert.equal(app.requests.filter(call => call.url === '/api/live-token').length, 3);
  const saved = app.requests.find(call => call.url.endsWith('/interrupt'));
  assert.equal(JSON.parse(saved.options.body).durationSeconds, 540);
  assert.equal(app.run('isSessionActive'), false);
  assert.equal(app.intervals.size, 0);
  assert.match(app.element('errorMsg').textContent, /接続を再開できません/);
});

test('ending while a token request is pending cannot reopen the connection', async () => {
  let finish;
  const app = browser(() => new Promise(resolve => { finish = resolve; }));
  const first = await app.connect();
  await readyToResume(app, first);
  const pending = app.run('reconnectLiveSession()');
  app.run("cleanupSession('終了しました');");
  finish(Response.json({ token: 'late-token' }));
  await pending;
  assert.equal(app.sockets.length, 1);
  assert.equal(app.run('ws'), null);
  assert.equal(app.run('isSessionActive'), false);
  assert.equal(app.timers.size, 0);
});

test('a connection that never finishes setup times out instead of leaving the interview stuck', async () => {
  const app = browser();
  const first = await app.connect();
  await readyToResume(app, first);
  const pending = app.run('reconnectLiveSession()');
  for (let attempt = 0; attempt < 3; attempt++) {
    await app.tick();
    const socket = app.sockets.at(-1);
    socket.open();
    const timeout = [...app.timers.values()].find(timer => timer.delay === 20000);
    assert.ok(timeout);
    timeout.callback();
  }
  await pending;
  assert.equal(app.sockets.length, 4);
  assert.equal(app.run('isSessionActive'), false);
});

test('non-resumable state never falls back to an old checkpoint or silently starts a new interview', async () => {
  const app = browser();
  const first = await app.connect();
  await readyToResume(app, first);
  await first.message({ sessionResumptionUpdate: { resumable: false } });
  assert.equal(app.run('sessionResumptionHandle'), null);
  await first.message({ goAway: { timeLeft: '1s' } });
  const deadline = [...app.timers.values()].find(timer => timer.delay === 0);
  deadline.callback();
  assert.equal(first.readyState, 3);
  assert.equal(app.run('isSessionActive'), false);
  assert.equal(app.sockets.length, 1);
  assert.equal(app.requests.length, 0);
});
