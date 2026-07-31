'use strict';

// ===== 設定 =====
const MODEL_LIVE = 'gemini-3.1-flash-live-preview';
const MODEL_TEXT = 'gemini-3.5-flash-lite';
const WS_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const REST_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_QUESTIONS = 7;

// ===== 状態 =====
let ws = null;
let isSessionActive = false;
let isAnswerRecording = false;
let isAwaitingModel = false;
let pendingCaptureAfterPlayback = false;
let pendingAutoEnd = false;
let lastSubmittedQuestion = 0;
let reviewGenerationInProgress = false;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let audioQueue = [];
let isPlayingAudio = false;
let inputAnalyser = null;
let outputAnalyser = null;
let visualizerRaf = null;
let activeSource = null;
let userTextBuffer = '';
let aiTextBuffer = '';
let conversationLog = [];
let timerInterval = null;
let elapsedSeconds = 0;
let questionCount = 0;
let sessionStarted = false;

// ===== UI =====
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatus(text, state = 'idle') {
  $('statusText').textContent = text;
  $('statusDot').className = 'status-dot' + (state !== 'idle' ? ` ${state}` : '');
}

function showError(msg) {
  const el = $('errorMsg');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 8000);
}

function setNextButton({ visible, disabled }) {
  const button = $('nextBtn');
  button.style.display = visible ? '' : 'none';
  button.disabled = disabled;
}

function updateQCounter(current) {
  questionCount = Math.max(1, Math.min(current, MAX_QUESTIONS));
  $('qCounter').classList.add('active');
  $('qLabel').textContent = `${questionCount} / ${MAX_QUESTIONS}問`;
  document.querySelectorAll('.q-dot').forEach((dot, i) => {
    dot.classList.remove('done', 'current');
    if (i + 1 < questionCount) dot.classList.add('done');
    else if (i + 1 === questionCount) dot.classList.add('current');
  });
}

function extractQuestionNumber(text) {
  const match = text.match(/(?:^|[\s、。])Q\s*([1-7])\s*(?:です|[.．:：]|問)/i)
    || text.match(/第\s*([1-7])\s*問/);
  return match ? Number(match[1]) : null;
}

function addMessage(role, text, qNum = null) {
  $('placeholder')?.remove();
  const box = $('transcriptBox');
  const isInterviewer = role === 'interviewer';
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;

  const qNumHtml = isInterviewer && qNum
    ? `<span class="msg-qnum show">Q${qNum}</span>`
    : '<span class="msg-qnum"></span>';

  msg.innerHTML = `
    <div class="msg-avatar">${isInterviewer ? '面' : '私'}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <div class="msg-role">${isInterviewer ? 'AI面接官' : 'あなた'}</div>
        ${qNumHtml}
      </div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
    </div>`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
  conversationLog.push({ role: isInterviewer ? 'interviewer' : 'candidate', text });
}

function showAiThinking() {
  if ($('aiThinking')) return;
  $('placeholder')?.remove();
  const box = $('transcriptBox');
  const el = document.createElement('div');
  el.id = 'aiThinking';
  el.className = 'msg interviewer';
  el.innerHTML = `
    <div class="msg-avatar">面</div>
    <div class="msg-body">
      <div class="msg-meta"><div class="msg-role">AI面接官</div></div>
      <div class="msg-bubble">
        <div class="ai-thinking"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function removeAiThinking() {
  $('aiThinking')?.remove();
}

// ===== タイマー =====
function startTimer() {
  elapsedSeconds = 0;
  $('timer').textContent = '00:00';
  $('timer').classList.add('active');
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const seconds = String(elapsedSeconds % 60).padStart(2, '0');
    $('timer').textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  $('timer').classList.remove('active');
}

// ===== API Key =====
function saveApiKey() {
  const key = $('apiKeyInput').value.trim();
  if (!key) {
    showError('APIキーを入力してください');
    return;
  }
  sessionStorage.setItem('gemini_key', key);
  setStatus('APIキーを設定しました。');
}

function getApiKey() {
  return sessionStorage.getItem('gemini_key') || $('apiKeyInput').value.trim();
}

// ===== 波形ビジュアライザー =====
function startVisualizer(analyserNode) {
  const canvas = $('visualizer');
  const ctx = canvas.getContext('2d');

  function draw() {
    visualizerRaf = requestAnimationFrame(draw);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const buffer = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(buffer);
    const count = 72;
    const barWidth = (width / count) - 1;
    for (let i = 0; i < count; i++) {
      const value = buffer[Math.floor(i * buffer.length / count)] / 255;
      const barHeight = value * height * 0.85;
      ctx.fillStyle = `rgba(29,78,216,${0.15 + value * 0.85})`;
      ctx.fillRect(i * (barWidth + 1), (height - barHeight) / 2, barWidth, barHeight);
    }
  }

  draw();
}

function stopVisualizer() {
  if (visualizerRaf) {
    cancelAnimationFrame(visualizerRaf);
    visualizerRaf = null;
  }
  const canvas = $('visualizer');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ===== バイナリ変換 =====
function float32ToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  return int16;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  new Uint8Array(buffer).forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToFloat32(base64) {
  const binary = atob(base64);
  const int16 = new Int16Array(binary.length / 2);
  for (let i = 0; i < int16.length; i++) {
    int16[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
  }
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

// ===== 回答ターン制御 =====
function beginAnswerRecording() {
  if (!isSessionActive || !ws || ws.readyState !== WebSocket.OPEN || isAwaitingModel) return;
  ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
  isAnswerRecording = true;
  pendingCaptureAfterPlayback = false;
  setNextButton({ visible: true, disabled: false });
  setStatus(
    sessionStarted ? '回答をお話しください 🎤' : '「よろしくお願いします」と話し、回答送信ボタンを押してください 🎤',
    'recording'
  );
}

function submitAnswer() {
  if (!isSessionActive || !isAnswerRecording || isAwaitingModel) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showError('AI面接官との接続が切れています。');
    return;
  }

  lastSubmittedQuestion = questionCount;
  isAnswerRecording = false;
  isAwaitingModel = true;
  setNextButton({ visible: true, disabled: true });
  setStatus('回答を送信しました。面接官が考えています...', 'connected');
  showAiThinking();
  ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
}

// ===== 音声再生キュー =====
async function enqueueAudio(base64) {
  audioQueue.push(base64);
  if (!isPlayingAudio) await drainAudioQueue();
}

async function drainAudioQueue() {
  if (audioQueue.length === 0) {
    isPlayingAudio = false;

    if (pendingAutoEnd && isSessionActive) {
      pendingAutoEnd = false;
      endSession();
      return;
    }

    if (pendingCaptureAfterPlayback && isSessionActive) beginAnswerRecording();
    return;
  }

  isPlayingAudio = true;
  setStatus('面接官が話しています...', 'playing');
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (!outputAnalyser) {
      outputAnalyser = audioContext.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyser.connect(audioContext.destination);
    }
    const float32 = base64ToFloat32(audioQueue.shift());
    const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputAnalyser);
    activeSource = source;
    source.start();
    source.onended = () => {
      activeSource = null;
      drainAudioQueue();
    };
  } catch (error) {
    console.error('Audio error:', error);
    drainAudioQueue();
  }
}

function clearAudioQueue() {
  audioQueue = [];
  isPlayingAudio = false;
  if (activeSource) {
    try {
      activeSource.stop();
    } catch (_) {
      // 既に停止済みの場合は何もしない
    }
    activeSource = null;
  }
}

// ===== Live APIメッセージ処理 =====
async function handleMessage(event) {
  const text = event.data instanceof Blob ? await event.data.text() : event.data;
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return;
  }

  if (data.setupComplete !== undefined) {
    startTimer();
    beginAnswerRecording();
    return;
  }

  const content = data.serverContent;
  if (!content) return;

  if (content.interrupted === true) {
    clearAudioQueue();
    removeAiThinking();
    aiTextBuffer = '';
    isAwaitingModel = false;
    pendingCaptureAfterPlayback = false;
    beginAnswerRecording();
    return;
  }

  if (content.modelTurn?.parts) {
    for (const part of content.modelTurn.parts) {
      if (part.inlineData?.data) {
        removeAiThinking();
        await enqueueAudio(part.inlineData.data);
      }
      if (part.text) aiTextBuffer += part.text;
    }
  }

  if (content.inputTranscription?.text) {
    userTextBuffer += content.inputTranscription.text;
  }

  if (content.outputTranscription?.text) {
    aiTextBuffer += content.outputTranscription.text;
  }

  if (!content.turnComplete) return;

  const userText = userTextBuffer.trim();
  if (userText) {
    if (!sessionStarted && /よろしくお願い/.test(userText)) sessionStarted = true;
    addMessage('user', userText);
  }
  userTextBuffer = '';
  removeAiThinking();

  const aiText = aiTextBuffer.trim();
  if (aiText) {
    const detectedQuestion = extractQuestionNumber(aiText);
    if (detectedQuestion && detectedQuestion >= questionCount) {
      sessionStarted = true;
      updateQCounter(detectedQuestion);
    } else if (sessionStarted && questionCount === 0) {
      updateQCounter(1);
    }
    addMessage('interviewer', aiText, questionCount || null);
  }
  aiTextBuffer = '';
  isAwaitingModel = false;

  // Q7の回答送信後に返されたクロージングを最後まで再生してから総評を生成する。
  if (lastSubmittedQuestion === MAX_QUESTIONS) {
    pendingAutoEnd = true;
    setNextButton({ visible: true, disabled: true });
    if (!isPlayingAudio && audioQueue.length === 0) {
      pendingAutoEnd = false;
      endSession();
    }
    return;
  }

  pendingCaptureAfterPlayback = true;
  if (!isPlayingAudio && audioQueue.length === 0) beginAnswerRecording();
}

// ===== システムプロンプト =====
function buildSystemPrompt() {
  const projectName = $('projectName').value.trim() || '（案件名未設定）';
  const interviewerRole = $('interviewerRole').value.trim() || 'プロジェクトリーダー（PL）';
  const requiredSkills = $('requiredSkills').value.trim() || '（要件未設定）';
  const projectDetail = $('projectDetail').value.trim() || '（概要未設定）';
  const skillSheet = $('skillSheet').value.trim() || '（スキルシート未設定）';

  return `あなたはSI/SES企業の${interviewerRole}として、技術者の面談（スキルチェック面接）を担当しています。

## あなたのロールと案件情報
- 役職：${interviewerRole}
- 案件名：${projectName}
- 業務概要：${projectDetail}
- 必須スキル・技術要件：${requiredSkills}

## 面談の進め方（必ず守ること）
候補者が「よろしくお願いします」と言ったら面談を開始し、以下の7つの主質問を順番に行ってください。
候補者の発言は「回答送信」操作で区切られます。回答が確定するまで応答せず、回答確定ごとに1回だけ応答してください。
回答にはまず簡潔に反応し、必要ならその質問を1回だけ深掘りしてください。深掘りが不要、または深掘り済みなら次の主質問へ進んでください。
1回の発言で複数の質問をしないでください。
主質問を始めるときだけ、必ず発言の冒頭を「Q1です。」「Q2です。」のように質問番号から始めてください。深掘りにはQ番号を付けないでください。

**Q1. 自己紹介・経歴の概要**
「簡単に自己紹介と、これまでの経歴の概要をお聞かせください」と聞いてください。

**Q2. スキルシートの直近案件について（必須）**
スキルシートに記載されている最も直近の案件・プロジェクトについて、具体的に掘り下げてください。

**Q3. スキルシートの技術スキルと本案件との適合性（必須）**
スキルシートに記載されているスキルと、本案件の必須要件を照らし合わせて質問してください。

**Q4. 過去のトラブル対応・チームでの立ち回り**
「過去のプロジェクトで、特に困難だった状況や、チームで乗り越えたエピソードを教えてください」と聞いてください。

**Q5. リーダーシップ・コミュニケーションスタイル**
「チームメンバーや他部署との連携で、どのようなコミュニケーションを大切にしていますか？」と聞いてください。

**Q6. 案件への意欲・今後の展望**
「本案件に興味を持っていただいた理由と、今後挑戦したいことをお聞かせください」と聞いてください。

**Q7. 逆質問・クロージング**
Q7の発言では「以上で私からの質問は終わりです。何かご質問はありますか？」と質問するだけにしてください。
Q7を質問した発言内では、面談終了の挨拶やクロージングを絶対に行わず、候補者が次に回答を確定するまで必ず待ってください。
Q7に対する候補者の回答が別のターンで確定した後、質問があれば簡潔に回答し、最後は必ず「面談は以上です。本日はお時間をいただきありがとうございました。後ほど結果をご連絡いたします」で締めくくってください。Q7では深掘りしないでください。

## 制約
- 1回の発言は2〜3文程度にまとめる
- Q2・Q3は必ずスキルシートの具体的な記載内容（案件名・技術名・期間など）に言及する
- 深掘りは各質問につき1回まで
- 丁寧・テンポよく、ビジネスライクなトーンで話す

## 候補者のスキルシート（必ずこの内容を読んで質問を作ること）
${skillSheet}`;
}

function validateInputs() {
  if (!getApiKey()) {
    showError('APIキーを入力してください');
    return false;
  }
  if (!$('projectName').value.trim()) {
    showError('案件名を入力してください');
    return false;
  }
  if (!$('requiredSkills').value.trim()) {
    showError('必須スキルを入力してください');
    return false;
  }
  if (!$('skillSheet').value.trim()) {
    showError('スキルシートを入力してください');
    return false;
  }
  return true;
}

// ===== セッション開始 =====
function startSession() {
  if (!validateInputs()) return;

  conversationLog = [];
  questionCount = 0;
  sessionStarted = false;
  isAnswerRecording = false;
  isAwaitingModel = false;
  pendingCaptureAfterPlayback = false;
  pendingAutoEnd = false;
  lastSubmittedQuestion = 0;
  userTextBuffer = '';
  aiTextBuffer = '';
  $('transcriptBox').innerHTML = `
    <div class="placeholder" id="placeholder">
      接続後、「よろしくお願いします」と話して回答送信ボタンを押してください。
    </div>`;
  $('startBtn').style.display = 'none';
  $('endBtn').style.display = '';
  setNextButton({ visible: true, disabled: true });
  $('reviewPanel').classList.remove('show');
  $('qCounter').classList.remove('active');
  document.querySelectorAll('.q-dot').forEach(dot => dot.classList.remove('done', 'current'));

  setStatus('接続中...', 'idle');
  const apiKey = getApiKey();
  ws = new WebSocket(`${WS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
  isSessionActive = true;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      setup: {
        model: `models/${MODEL_LIVE}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } }
          },
          thinkingConfig: { thinkingLevel: 'minimal' }
        },
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: true }
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] }
      }
    }));
    startMicCapture();
  };

  ws.onmessage = handleMessage;
  ws.onerror = () => {
    showError('接続エラー。APIキーを確認してください。');
    cleanupSession('面談を開始できませんでした。');
  };
  ws.onclose = event => {
    if (!isSessionActive) return;
    if (event.code !== 1000) showError(`切断されました (code: ${event.code})`);
    cleanupSession('接続が終了しました。もう一度面談を開始してください。');
  };
}

// ===== マイクキャプチャ =====
async function startMicCapture() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();

    const micSource = audioContext.createMediaStreamSource(mediaStream);
    inputAnalyser = audioContext.createAnalyser();
    inputAnalyser.fftSize = 256;
    micSource.connect(inputAnalyser);
    startVisualizer(inputAnalyser);

    const sourceRate = audioContext.sampleRate;
    const targetRate = 16000;
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    micSource.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    scriptProcessor.onaudioprocess = event => {
      if (!isAnswerRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const ratio = targetRate / sourceRate;
      const outputLength = Math.floor(input.length * ratio);
      const resampled = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = i / ratio;
        const low = Math.floor(sourceIndex);
        const high = Math.min(low + 1, input.length - 1);
        resampled[i] = input[low] + (input[high] - input[low]) * (sourceIndex - low);
      }
      ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: arrayBufferToBase64(float32ToInt16(resampled).buffer),
            mimeType: 'audio/pcm;rate=16000'
          }
        }
      }));
    };
  } catch (error) {
    showError(`マイクにアクセスできませんでした: ${error.message}`);
    cleanupSession('マイクを利用できないため面談を開始できませんでした。');
  }
}

// ===== セッション終了・後片付け =====
function endSession() {
  if (!isSessionActive) return;
  isSessionActive = false;
  isAnswerRecording = false;
  isAwaitingModel = false;
  pendingCaptureAfterPlayback = false;
  pendingAutoEnd = false;
  clearAudioQueue();
  stopTimer();

  if (userTextBuffer.trim()) {
    conversationLog.push({ role: 'candidate', text: userTextBuffer.trim() });
    userTextBuffer = '';
  }
  if (aiTextBuffer.trim()) {
    conversationLog.push({ role: 'interviewer', text: aiTextBuffer.trim() });
    aiTextBuffer = '';
  }

  stopMediaResources();
  if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000);
  ws = null;

  document.querySelectorAll('.q-dot').forEach(dot => {
    dot.classList.remove('current');
    if (questionCount === MAX_QUESTIONS) dot.classList.add('done');
  });
  showStoppedControls();
  setStatus('面談終了。総評を生成しています...', 'idle');
  generateReview();
}

function stopMediaResources() {
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  inputAnalyser = null;
  outputAnalyser = null;
  stopVisualizer();
}

function showStoppedControls() {
  $('startBtn').style.display = '';
  $('endBtn').style.display = 'none';
  setNextButton({ visible: false, disabled: true });
}

function cleanupSession(statusMessage) {
  isSessionActive = false;
  isAnswerRecording = false;
  isAwaitingModel = false;
  pendingCaptureAfterPlayback = false;
  pendingAutoEnd = false;
  clearAudioQueue();
  stopTimer();
  stopMediaResources();
  if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000);
  ws = null;
  showStoppedControls();
  setStatus(statusMessage, 'idle');
}

// ===== 総評生成 =====
function reviewResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      overall: { type: 'STRING', enum: ['◎', '○', '△', '×'] },
      scores: {
        type: 'OBJECT',
        properties: {
          '技術力': { type: 'INTEGER', minimum: 1, maximum: 5 },
          'コミュニケーション': { type: 'INTEGER', minimum: 1, maximum: 5 },
          '総合': { type: 'INTEGER', minimum: 1, maximum: 5 }
        },
        required: ['技術力', 'コミュニケーション', '総合']
      },
      technical: { type: 'STRING' },
      communication: { type: 'STRING' },
      attitude: { type: 'STRING' },
      feedback: { type: 'STRING' }
    },
    required: ['overall', 'scores', 'technical', 'communication', 'attitude', 'feedback']
  };
}

function validateReview(review) {
  const validOverall = ['◎', '○', '△', '×'].includes(review?.overall);
  const scoreKeys = ['技術力', 'コミュニケーション', '総合'];
  const validScores = scoreKeys.every(key => {
    const score = review?.scores?.[key];
    return Number.isInteger(score) && score >= 1 && score <= 5;
  });
  return validOverall
    && validScores
    && ['technical', 'communication', 'attitude', 'feedback']
      .every(key => typeof review[key] === 'string' && review[key].trim());
}

async function generateReview() {
  if (reviewGenerationInProgress) return;
  const apiKey = getApiKey();
  if (!apiKey) {
    showReviewError('APIキーが設定されていません。');
    return;
  }
  if (conversationLog.length === 0) {
    showReviewError('評価できる会話ログがありません。');
    return;
  }

  reviewGenerationInProgress = true;
  $('reviewPanel').classList.add('show');
  $('reviewContent').innerHTML = `
    <div class="review-generating">
      <div class="review-spinner"></div>
      商談総評レポートを生成しています...
    </div>`;
  setTimeout(() => $('reviewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);

  const logText = conversationLog
    .map(log => `【${log.role === 'interviewer' ? '面接官' : '候補者'}】${log.text}`)
    .join('\n');
  const projectName = $('projectName').value.trim() || '（案件名未設定）';
  const requiredSkills = $('requiredSkills').value.trim() || '（必須スキル未設定）';
  const skillSheet = $('skillSheet').value.trim() || '（スキルシート未設定）';

  const prompt = `以下はSES技術者面談の情報と会話ログです。面接官の立場から、候補者を総合的に評価してください。

## 案件情報
- 案件名：${projectName}
- 必須スキル：${requiredSkills}

## 候補者のスキルシート
${skillSheet}

## 会話ログ
${logText}

## 評価基準
- technical、communication、attitude はそれぞれ200文字以内
- feedback は300文字以内で、候補者が次回改善できる具体的な助言を含める
- 会話で確認できなかった事項を経験済みと断定しない
- overall は ◎（強く推奨）・○（推奨）・△（要検討）・×（見送り）のいずれか`;

  try {
    const response = await fetch(`${REST_ENDPOINT}/${MODEL_TEXT}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: reviewResponseSchema()
        }
      })
    });

    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw new Error(`APIからJSONではない応答が返されました（HTTP ${response.status}）。`);
    }

    if (!response.ok) {
      throw new Error(data.error?.message || `APIリクエストに失敗しました（HTTP ${response.status}）。`);
    }
    if (data.promptFeedback?.blockReason) {
      throw new Error(`安全性フィルターにより評価を生成できませんでした（${data.promptFeedback.blockReason}）。`);
    }

    const rawText = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();
    if (!rawText) throw new Error('APIから評価本文が返されませんでした。');

    let review;
    try {
      review = JSON.parse(rawText);
    } catch (_) {
      throw new Error('評価結果のJSONを解析できませんでした。');
    }
    if (!validateReview(review)) throw new Error('評価結果に必要な項目が不足しています。');

    renderReview(review);
    setStatus('面談終了 — 総評生成完了');
  } catch (error) {
    showReviewError(error.message);
    setStatus('面談終了 — 総評生成に失敗しました', 'idle');
  } finally {
    reviewGenerationInProgress = false;
  }
}

function showReviewError(message) {
  $('reviewPanel').classList.add('show');
  $('reviewContent').innerHTML = `
    <div style="padding:20px; color:var(--red); font-size:13px; line-height:1.8;">
      <div>総評の生成に失敗しました: ${escapeHtml(message)}</div>
      <button class="btn btn-secondary" style="margin-top:12px;" onclick="generateReview()">再生成</button>
    </div>`;
}

// ===== 総評レンダリング =====
function renderReview(review) {
  const badgeColors = { '◎': '#059669', '○': '#1d4ed8', '△': '#d97706', '×': '#dc2626' };
  const badgeColor = badgeColors[review.overall] || '#1d4ed8';
  const overallLabels = { '◎': '強く推奨', '○': '推奨', '△': '要検討', '×': '見送り' };

  function pipBar(score, max = 5) {
    const pips = [];
    for (let i = 1; i <= max; i++) {
      const className = i <= score
        ? (score >= 4 ? 'filled high' : score <= 2 ? 'filled low' : 'filled')
        : '';
      pips.push(`<div class="sc-pip ${className}"></div>`);
    }
    return pips.join('');
  }

  $('reviewContent').innerHTML = `
    <div class="review-dashboard">
      <div class="review-top">
        <div class="overall-badge" style="background:${badgeColor};">
          <div class="badge-label">総合評価</div>
          <div class="badge-mark">${escapeHtml(review.overall)}</div>
          <div class="badge-sub">${overallLabels[review.overall]}</div>
        </div>
        <div class="score-row">
          ${[
            { label: '技術力', key: '技術力' },
            { label: 'コミュニケーション', key: 'コミュニケーション' },
            { label: '総合スコア', key: '総合' }
          ].map(item => {
            const score = review.scores[item.key];
            return `
              <div class="score-card">
                <div class="sc-label">${item.label}</div>
                <div class="sc-bar">${pipBar(score)}</div>
                <div class="sc-num">${score}<span> / 5</span></div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="review-sections">
        <div class="review-section">
          <div class="review-section-header">
            <span class="review-section-icon">💻</span>技術力・経験の適合性
          </div>
          <div class="review-section-body">${escapeHtml(review.technical)}</div>
        </div>
        <div class="review-section">
          <div class="review-section-header">
            <span class="review-section-icon">💬</span>コミュニケーション能力
          </div>
          <div class="review-section-body">${escapeHtml(review.communication)}</div>
        </div>
        <div class="review-section">
          <div class="review-section-header">
            <span class="review-section-icon">🔥</span>姿勢・意欲
          </div>
          <div class="review-section-body">${escapeHtml(review.attitude)}</div>
        </div>
        <div class="review-section review-feedback">
          <div class="review-section-header">
            <span class="review-section-icon">📝</span>技術者へのフィードバック
          </div>
          <div class="review-section-body">${escapeHtml(review.feedback)}</div>
        </div>
      </div>
    </div>`;
}

window.addEventListener('load', () => {
  const saved = sessionStorage.getItem('gemini_key');
  if (saved) $('apiKeyInput').value = saved;
  setStatus('案件情報とスキルシートを入力して「面談開始」を押してください');
});
