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
      value: '', textContent: '', innerHTML: '', disabled: false, style: {}, remove() {},
      appendChild() {}, replaceChildren() {},
      querySelector: () => ({ textContent: '' }),
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
    exports: {}, Blob, WebSocket, AbortSignal, AbortController, console,
    document: { getElementById: element, querySelectorAll: () => [], createElement: () => ({
      className: '', innerHTML: '', dataset: {}, querySelector: () => ({ textContent: '' })
    }) },
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
  const connect = async (recordAnswer = true) => {
    const pending = run('connectLiveApi("initial-token", null, liveConnectionGeneration)');
    const socket = sockets.at(-1);
    socket.open();
    await socket.message({ setupComplete: {} });
    await pending;
    if (recordAnswer) run('selfIntroductionRequested = true; beginAnswerRecording();');
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


test('AI opens with the project explanation before recording the self introduction, and never repeats it on resume', async () => {
  const app = browser();
  const socket = await app.connect(false);
  assert.equal(app.run('isAnswerRecording'), false);
  assert.equal(socket.sent.length, 1, 'setup does not start candidate audio');
  app.run('startInterviewOpening();');
  const opening = socket.sent[1].clientContent;
  assert.equal(opening.turnComplete, true);
  assert.match(opening.turns[0].parts[0].text, /案件名・業務概要・必須スキル/);
  assert.match(opening.turns[0].parts[0].text, /自己紹介をお願いします/);
  assert.equal(app.run('isAwaitingModel'), true);
  assert.equal(app.element('nextBtn').disabled, true);
  app.run('startInterviewOpening();');
  assert.equal(socket.sent.length, 2);
  app.run(`addMessage = () => ({}); aiTextBuffer = '案件をご説明します。それでは、自己紹介をお願いします。';`);
  await socket.message({ serverContent: { turnComplete: true } });
  [...app.timers.values()].find(timer => timer.delay === 800).callback();
  assert.equal(app.run('isAnswerRecording'), true);
  assert.equal(app.run('questionCount'), 0);
  await readyToResume(app, socket);
  app.run('reconnectLiveSession();');
  const resumed = await completeReconnect(app);
  assert.equal(resumed.sent.some(message => message.clientContent), false);
});

test('self introduction always gets one project-related question before Q1 for every follow-up setting', () => {
  for (const intensity of ['none', 'standard', 'deep']) {
    const app = browser();
    app.run(`selfIntroductionRequested = true; interviewQuestions = ['API設計を説明してください'];
      interviewFollowUpIntensity = '${intensity}'; addMessage = () => ({});`);
    const followUp = app.run('buildTurnInstruction()');
    assert.match(followUp, /自己紹介で述べた経験・技術・担当範囲と今回の案件/);
    assert.match(followUp, /主質問数に含めず/);
    assert.match(followUp, /この発言では主質問へ進まない/);
    app.run(`aiTextBuffer = 'Javaの開発をご担当されたのですね。今回の案件でどう生かせますか？';
      turnCompletePending = true; finalizeCompletedTurn();`);
    assert.equal(app.run('questionCount'), 0);
    assert.equal(app.run('currentQuestionFollowUpCount'), 0);
    const firstQuestion = app.run('buildTurnInstruction()');
    assert.match(firstQuestion, /Q1です/);
    assert.match(firstQuestion, /API設計を説明してください/);
    app.run(`aiTextBuffer = '設計経験を生かせるのですね。Q1です。API設計を説明してください';
      turnCompletePending = true; finalizeCompletedTurn();`);
    assert.equal(app.run('questionCount'), 1);
    assert.equal(app.run('currentQuestionFollowUpCount'), 0);
  }
});

function setupTranscriptMessages(app) {
  app.run(`
    addMessage = (role, text) => {
      const logEntry = { role: role === 'interviewer' ? 'interviewer' : 'candidate', rawText: text, text };
      const messageRef = { logEntry, bubble: { textContent: text } };
      conversationLog.push(logEntry);
      transcriptMessageRefs.set(logEntry, messageRef);
      return messageRef;
    };
    renderReview = () => {};
    currentInterviewId = 'interview-1';
  `);
}

const validReview = {
  overall: '○', scores: { 技術力: 3, コミュニケーション: 3, '姿勢・意欲': 4, 総合: 3 },
  technical: '設計経験あり', communication: '説明が具体的', attitude: '前向き', feedback: '経験を深める'
};

test('review displays the overall score below its rating and all three category scores separately', () => {
  const app = browser();
  app.run(`renderReview(${JSON.stringify(validReview)})`);
  const html = app.element('reviewContent').innerHTML;
  const badge = html.slice(html.indexOf('class="overall-badge"'), html.indexOf('class="score-row"'));
  assert.match(badge, /総合評価[\s\S]*badge-mark[\s\S]*総合スコア[\s\S]*3/);
  const categories = html.slice(html.indexOf('class="score-row"'), html.indexOf('class="review-sections"'));
  assert.match(categories, /技術力/);
  assert.match(categories, /コミュニケーション/);
  assert.match(categories, /姿勢・意欲[\s\S]*sc-num">4/);
  assert.doesNotMatch(categories, /総合スコア/);
  assert.equal(app.run(`validateReview(${JSON.stringify(validReview)})`), true);
  const missingScore = JSON.parse(JSON.stringify(validReview));
  delete missingScore.scores['姿勢・意欲'];
  assert.equal(app.run(`validateReview(${JSON.stringify(missingScore)})`), false);
});

test('short technical answers are corrected and long interviewer context fits the correction API limits', async () => {
  const app = browser(() => Response.json({ correctedText: 'Java', shouldReplace: true }));
  const result = await app.run(`requestTranscriptCorrection({
    rawText: 'ジャバ', previousInterviewerText: '前'.repeat(5000),
    followingInterviewerText: '後'.repeat(5000), isReverseQuestionTurn: false
  })`);
  assert.equal(result, 'Java');
  const body = JSON.parse(app.requests[0].options.body);
  assert.equal(body.rawText, 'ジャバ');
  assert.equal(body.previousInterviewerText.length, 4000);
  assert.equal(body.followingInterviewerText.length, 4000);
  await app.run(`requestTranscriptCorrection({ rawText: 'はい', previousInterviewerText: '',
    followingInterviewerText: '', isReverseQuestionTurn: false })`);
  assert.equal(app.requests.length, 1, 'simple acknowledgements still avoid unnecessary requests');
});

test('manual ending waits for the last buffered answer correction before saving and reviewing', async () => {
  let resolveCorrection;
  const app = browser(url => {
    if (url === '/api/correct-transcript') return new Promise(resolve => { resolveCorrection = resolve; });
    if (url === '/api/review') return Response.json({ review: validReview });
    return Response.json({});
  });
  setupTranscriptMessages(app);
  app.run(`addMessage('interviewer', '使用した技術は何ですか？'); userTextBuffer = 'ジャバ'; endSession();`);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/correct-transcript');
  assert.equal(JSON.parse(app.requests[0].options.body).followingInterviewerText, '');
  resolveCorrection(Response.json({ correctedText: 'Java', shouldReplace: true }));
  for (let i = 0; i < 4; i++) await app.tick();
  const saved = app.requests.find(call => call.url.endsWith('/complete'));
  const reviewed = app.requests.find(call => call.url === '/api/review');
  for (const call of [saved, reviewed]) {
    assert.ok(call);
    const answer = JSON.parse(call.options.body).conversationLog.at(-1);
    assert.equal(answer.text, 'Java');
    assert.equal(answer.rawText, 'ジャバ');
  }
  assert.equal(app.run('transcriptMessageRefs.get(conversationLog.at(-1)).bubble.textContent'), 'Java');
  assert.equal(app.requests.filter(call => call.url === '/api/correct-transcript').length, 1);
});

test('automatic closing retries a failed last-answer correction with the closing context before saving', async () => {
  let corrections = 0;
  const app = browser(url => {
    if (url === '/api/correct-transcript') return ++corrections === 1
      ? Response.json({ error: 'temporary failure' }, { status: 502 })
      : Response.json({ correctedText: '質問は以上です。', shouldReplace: true });
    if (url === '/api/review') return Response.json({ review: validReview });
    return Response.json({});
  });
  setupTranscriptMessages(app);
  app.run(`questionCount = interviewQuestionTarget; reverseQuestionActive = true;
    addMessage('interviewer', '他にはいかがですか？');
    userTextBuffer = '質問は異常です。';
    aiTextBuffer = '面談は以上です。本日はお時間をいただきありがとうございました。後ほど結果をご連絡いたします';
    turnCompletePending = true; finalizeCompletedTurn();`);
  for (let i = 0; i < 4; i++) await app.tick();
  assert.equal(app.run('isSessionActive'), false);
  assert.equal(corrections, 2);
  const retry = app.requests.filter(call => call.url === '/api/correct-transcript')[1];
  const context = JSON.parse(retry.options.body);
  assert.equal(context.previousInterviewerText, '他にはいかがですか？');
  assert.match(context.followingInterviewerText, /面談は以上です/);
  assert.equal(context.isReverseQuestionTurn, true);
  const saved = app.requests.find(call => call.url.endsWith('/complete'));
  assert.equal(JSON.parse(saved.options.body).conversationLog[1].text, '質問は以上です。');
});

test('persistent correction failure retries once and preserves the original answer', async () => {
  const app = browser(() => Response.json({ error: 'unavailable' }, { status: 502 }));
  setupTranscriptMessages(app);
  app.run(`const answer = addMessage('user', 'ジャバ');
    correctCandidateMessage(answer, { rawText: 'ジャバ', previousInterviewerText: '',
      followingInterviewerText: '', isReverseQuestionTurn: false });`);
  await app.run('reconcileTranscriptCorrections()');
  assert.equal(app.requests.length, 2);
  assert.equal(app.run('conversationLog[0].text'), 'ジャバ');
  assert.equal(app.run('pendingTranscriptCorrections.size'), 0);
});

test('successful no-change corrections are not repeated at the end', async () => {
  const app = browser(() => Response.json({ correctedText: 'Java', shouldReplace: false }));
  setupTranscriptMessages(app);
  app.run(`const answer = addMessage('user', 'Java');
    correctCandidateMessage(answer, { rawText: 'Java', previousInterviewerText: '',
      followingInterviewerText: '', isReverseQuestionTurn: false });`);
  await app.run('reconcileTranscriptCorrections()');
  assert.equal(app.requests.length, 1);
});

function resumableInterview(overrides = {}) {
  return {
    id: 'interview-1', status: 'interrupted', duration_seconds: 540, resume_version: 1,
    interview_projects: { project_name: 'API開発', interviewer_role: 'PL', required_skills: 'Java', project_details: '設計開発' },
    interview_configurations: { main_question_count: 2, follow_up_intensity: 'deep', customization: 'ゆっくり' },
    interview_skill_sheets: { content: 'Java経験3年', original_file_name: 'skills.pdf' },
    interview_questions: [
      { id: 'q1', question_type: 'main', main_question_number: 1, question_text: '設計経験は？' },
      { id: 'q2', question_type: 'main', main_question_number: 2, question_text: 'テスト経験は？' }
    ],
    conversation_logs: [
      { sequence_number: 1, speaker_role: 'interviewer', text: 'Q1です。設計経験は？', interview_question_id: 'q1' },
      { sequence_number: 2, speaker_role: 'candidate', raw_text: 'ジャバで設計しました。', text: 'Javaで設計しました。', interview_question_id: 'q1' },
      { sequence_number: 3, speaker_role: 'interviewer', text: '具体的に工夫した点は？', interview_question_id: 'q1' }
    ],
    progress: {
      questionCount: 1, currentQuestionFollowUpCount: 1, reverseQuestionActive: false,
      sessionStarted: true, selfIntroductionRequested: true, selfIntroductionCompleted: true,
      selfIntroductionFollowUpAsked: true, isAwaitingModel: false,
      userTextBuffer: 'エラー応答を', aiTextBuffer: '', pendingTurnInstruction: ''
    }, ...overrides
  };
}

async function openResumedSocket(app) {
  for (let i = 0; i < 6 && !app.sockets.length; i++) await app.tick();
  const socket = app.sockets.at(-1);
  assert.ok(socket);
  socket.open();
  await socket.message({ setupComplete: {} });
  return socket;
}

test('a silent model response saves pending answer and progress, then exposes manual resume without completing the interview', async () => {
  const app = browser(() => Response.json({ saved: true }));
  await app.connect();
  app.run(`currentInterviewId = 'interview-1'; questionCount = 2; userTextBuffer = '設計を担当しました。'; submitAnswer();`);
  const timeout = [...app.timers.values()].find(timer => timer.delay === 45000);
  assert.ok(timeout);
  timeout.callback();
  await app.run('checkpointSaveQueue');
  const saved = app.requests.find(call => call.url.endsWith('/interrupt'));
  const snapshot = JSON.parse(saved.options.body);
  assert.equal(snapshot.progress.userTextBuffer, '設計を担当しました。');
  assert.equal(snapshot.progress.questionCount, 2);
  assert.equal(snapshot.progress.isAwaitingModel, true);
  assert.match(snapshot.progress.pendingTurnInstruction, /進行制御/);
  assert.equal(app.element('resumeBtn').style.display, '');
  assert.equal(app.run('isSessionActive'), false);
  assert.equal(app.requests.some(call => call.url === '/api/review' || call.url.endsWith('/complete')), false);
});

test('fresh connection restores a mid-answer interview with the same ID, elapsed time and follow-up count', async () => {
  const interview = resumableInterview();
  const app = browser(url => url.endsWith('/resume') ? Response.json({ interview })
    : url === '/api/live-token' ? Response.json({ token: 'resume-token' }) : Response.json({ saved: true }));
  app.run(`isSessionActive = false; interruptedInterviewId = 'interview-1'; startMicCapture = async () => {};`);
  const pending = app.run('resumeSession()');
  const socket = await openResumedSocket(app);
  await pending;
  assert.equal(app.run('currentInterviewId'), 'interview-1');
  assert.equal(app.run('elapsedSeconds'), 540);
  assert.equal(app.element('timer').textContent, '09:00');
  assert.equal(app.run('questionCount'), 1);
  assert.equal(app.run('currentQuestionFollowUpCount'), 1);
  assert.equal(app.run('conversationLog.length'), 3);
  assert.equal(app.run('conversationLog[1].rawText'), 'ジャバで設計しました。');
  assert.equal(app.run('userTextBuffer'), 'エラー応答を');
  assert.equal(app.run('isAnswerRecording'), true);
  assert.deepEqual(socket.sent[0].setup.sessionResumption, {});
  assert.match(socket.sent[0].setup.systemInstruction.parts[0].text, /中断からの再開/);
  assert.equal(socket.sent[1].clientContent.turns.length, 3);
  assert.equal(socket.sent[1].clientContent.turnComplete, false);
  assert.equal(socket.sent.filter(message => message.realtimeInput?.activityStart).length, 1);
  assert.equal(socket.sent.some(message => message.clientContent?.turnComplete), false, 'does not restart the opening or question');
  assert.equal(app.requests.some(call => call.url === '/api/questions' || call.url === '/api/interviews'), false);
});

test('resume regenerates an interrupted model response once without resending or dropping the submitted answer', async () => {
  const base = resumableInterview();
  const interview = resumableInterview({ progress: { ...base.progress,
    isAwaitingModel: true, userTextBuffer: 'エラー応答を統一しました。', aiTextBuffer: 'エラーを',
    pendingTurnInstruction: '[進行制御] Q2です。テスト経験は？と尋ねてください。'
  } });
  const app = browser(url => url.endsWith('/resume') ? Response.json({ interview })
    : url === '/api/live-token' ? Response.json({ token: 'resume-token' })
    : url === '/api/correct-transcript' ? Response.json({ correctedText: 'エラー応答を統一しました。', shouldReplace: false })
    : Response.json({ saved: true }));
  app.run(`isSessionActive = false; interruptedInterviewId = 'interview-1'; startMicCapture = async () => {}; showAiThinking = () => {};`);
  const pending = app.run('resumeSession()');
  const socket = await openResumedSocket(app);
  await pending;
  assert.equal(app.run('isAnswerRecording'), false);
  const history = socket.sent.find(message => message.clientContent?.turnComplete === false).clientContent;
  assert.equal(history.turns.at(-1).parts[0].text, 'エラー応答を統一しました。');
  const generation = socket.sent.filter(message => message.clientContent?.turnComplete === true);
  assert.equal(generation.length, 1);
  assert.equal(generation[0].clientContent.turns[0].parts[0].text, interview.progress.pendingTurnInstruction);
  assert.equal(app.run('currentQuestionFollowUpCount'), 1);
  assert.equal(app.run('aiTextBuffer'), '');
  await socket.message({ serverContent: { outputTranscription: { text: 'Q2です。テスト経験は？' }, turnComplete: true } });
  [...app.timers.values()].find(timer => timer.delay === 800).callback();
  assert.equal(app.run('conversationLog.filter(log => log.role === "candidate").length'), 2);
  assert.equal(app.run('conversationLog.at(-2).text'), 'エラー応答を統一しました。');
  assert.equal(app.run('questionCount'), 2);
  assert.equal(app.run('isAnswerRecording'), true);
});

test('resume preserves reverse-question and self-introduction stages and infers progress for legacy logs', () => {
  const app = browser();
  for (const stage of [
    { questionCount: 2, reverseQuestionActive: true },
    { questionCount: 0, selfIntroductionCompleted: false, selfIntroductionFollowUpAsked: true }
  ]) {
    const base = resumableInterview();
    app.run(`restoreInterview(${JSON.stringify({ ...base, progress: { ...base.progress, ...stage } })});`);
    for (const [key, value] of Object.entries(stage)) assert.equal(app.run(key), value);
  }
  const base = resumableInterview({ progress: null });
  app.run(`restoreInterview(${JSON.stringify(base)})`);
  assert.equal(app.run('questionCount'), 1);
  assert.equal(app.run('currentQuestionFollowUpCount'), 1);
  const intro = app.run(`inferInterviewProgress([
    { role: 'interviewer', text: '自己紹介をお願いします。' }, { role: 'candidate', text: 'Java経験3年です。' }
  ])`);
  assert.equal(intro.selfIntroductionFollowUpAsked, false);
  assert.equal(intro.isAwaitingModel, true);
});

test('new resume can be cancelled while its server request is pending', async () => {
  let finish;
  const app = browser(() => new Promise(resolve => { finish = resolve; }));
  app.run(`isSessionActive = false; interruptedInterviewId = 'interview-1';`);
  const pending = app.run('resumeSession()');
  await app.tick();
  app.run('closeLiveConnection()');
  finish(Response.json({ interview: resumableInterview() }));
  await pending;
  assert.equal(app.sockets.length, 0);
  assert.equal(app.run('isSessionActive'), false);
});
