const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(resolve(__dirname, '../app/interview-client.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function browser(mode = 'audio', getUserMedia) {
  const elements = new Map();
  const node = () => ({ children: [], textContent: '', hidden: true, style: {}, classList: { toggle() {} },
    appendChild(child) { this.children.push(child); }, play: async () => {} });
  const element = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  element('recordingMode').value = mode;
  const track = kind => ({ kind, stopped: false, stop() { this.stopped = true; } });
  const mic = track('audio');
  const camera = track('video');
  class MediaStream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
  }
  const connections = [];
  const disconnections = [];
  const analysers = [];
  const gains = [];
  const intervals = new Map();
  let nextInterval = 0;
  const audioNode = () => ({ targets: [], connect(target) { this.targets.push(target); }, disconnect() { this.disconnected = true; } });
  const compressor = { ...audioNode(), ...Object.fromEntries(
    ['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, { value: 0 }])
  ) };
  const mixTrack = track('audio');
  const destination = { stream: new MediaStream([mixTrack]) };
  const micSource = { connect: target => connections.push(['mic', target]), disconnect() {} };
  const output = { connect: target => connections.push(['ai', target]), disconnect: target => disconnections.push(target) };
  const recorders = [];
  class MediaRecorder {
    static isTypeSupported(type) { return type.includes('webm'); }
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    finish() {
      this.ondataavailable({ data: new Blob(['last chunk'], { type: this.mimeType }) });
      this.onstop();
    }
  }
  const blobs = [];
  const context = vm.createContext({
    exports: {}, console, Blob, MediaRecorder, MediaStream,
    setInterval(callback) { intervals.set(++nextInterval, callback); return nextInterval; },
    clearInterval(id) { intervals.delete(id); },
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => new MediaStream([camera])) } },
    document: { getElementById: element, createElement: node },
    URL: { createObjectURL(blob) { blobs.push(blob); return `blob:${blobs.length}`; } },
    audioContext: null
  });
  vm.runInContext(source, context);
  context.testMicStream = new MediaStream([mic]);
  context.testAudioContext = {
    currentTime: 1,
    createMediaStreamDestination: () => destination, createMediaStreamSource: () => micSource,
    createDynamicsCompressor: () => compressor,
    createAnalyser() {
      const analyser = { ...audioNode(), level: 0, getFloatTimeDomainData(samples) { samples.fill(this.level); } };
      analysers.push(analyser);
      return analyser;
    },
    createGain() {
      const gain = { ...audioNode(), gain: { value: 1, setTargetAtTime(value) { this.value = value; } } };
      gains.push(gain);
      return gain;
    }
  };
  context.testOutput = output;
  const run = code => vm.runInContext(code, context);
  run('recordingPageActive = true; isSessionActive = true; mediaStream = testMicStream; audioContext = testAudioContext; outputAnalyser = testOutput;');
  return { run, element, recorders, blobs, connections, disconnections, mic, camera, destination,
    analysers, gains, intervals, compressor };
}

test('mixes microphone and AI audio locally and includes the final chunk after stop', async () => {
  const app = browser();
  await app.run('startLocalRecording()');
  assert.deepEqual(app.connections.map(c => c[0]), ['mic', 'ai']);
  assert.equal(app.recorders[0].stream.getAudioTracks().length, 1);
  app.run('stopLocalRecording()');
  assert.equal(app.blobs.length, 0);
  app.recorders[0].finish();
  assert.equal(await app.blobs[0].text(), 'last chunk');
  assert.equal(app.element('recordingDownloads').children.length, 1);
  assert.match(app.element('recordingDownloads').children[0].children[0].download, /\.webm$/);
  assert.equal(app.disconnections[0], app.analysers[1]);
  assert.equal(app.intervals.size, 0);
  assert.ok(app.analysers.every(node => node.disconnected));
  assert.ok(app.gains.every(node => node.disconnected));
  assert.equal(app.compressor.disconnected, true);
  assert.equal(app.mic.stopped, false);
});

test('video records a camera track and releases the camera after recording', async () => {
  let constraints;
  const app = browser('video', async options => {
    constraints = options;
    return { getTracks: () => [app.camera], getVideoTracks: () => [app.camera] };
  });
  await app.run('startLocalRecording()');
  assert.equal(app.recorders[0].stream.getVideoTracks().length, 1);
  assert.equal(app.element('recordingPreview').hidden, false);
  assert.equal(constraints.video.width.max, 640);
  assert.equal(constraints.video.height.ideal, 360);
  assert.equal(constraints.video.frameRate.ideal, 12);
  assert.equal(constraints.video.frameRate.max, 15);
  assert.equal(app.recorders[0].options.videoBitsPerSecond, 300000);
  assert.equal(app.recorders[0].options.audioBitsPerSecond, 64000);
  app.run('stopLocalRecording()');
  app.recorders[0].finish();
  assert.equal(app.camera.stopped, true);
  assert.equal(app.element('recordingPreview').hidden, true);
});

for (const [quality, width, height, bitRate] of [
  ['low', 320, 180, 100000], ['standard', 640, 360, 300000], ['high', 1280, 720, 1500000]
]) {
  test(`${quality} video quality applies to camera capture and encoding`, async () => {
    let constraints;
    const app = browser('video', async options => {
      constraints = options;
      return { getTracks: () => [app.camera], getVideoTracks: () => [app.camera] };
    });
    app.element('recordingQuality').value = quality;
    await app.run('startLocalRecording()');
    assert.equal(constraints.video.width.ideal, width);
    assert.equal(constraints.video.height.ideal, height);
    assert.equal(app.recorders[0].options.videoBitsPerSecond, bitRate);
    app.run('stopLocalRecording()');
    app.recorders[0].finish();
  });
}

test('quality selection is shown only for video and locked with recording mode during interviews', () => {
  const app = browser('audio');
  app.run('updateRecordingQualityControl()');
  assert.equal(app.element('recordingQualityField').hidden, true);
  assert.equal(app.element('recordingQuality').disabled, true);
  app.element('recordingMode').value = 'video';
  app.element('recordingMode').disabled = false;
  app.run('updateRecordingQualityControl()');
  assert.equal(app.element('recordingQualityField').hidden, false);
  assert.equal(app.element('recordingQuality').disabled, false);
  app.run('setInterviewStructureDisabled(true)');
  assert.equal(app.element('recordingQuality').disabled, true);
  app.run('showStoppedControls()');
  assert.equal(app.element('recordingQuality').disabled, false);
});

test('balances quiet microphone and loud AI toward the same recorded level', async () => {
  const app = browser();
  await app.run('startLocalRecording()');
  app.analysers[0].level = 0.04;
  app.analysers[1].level = 0.3;
  for (const tick of app.intervals.values()) tick();
  const micLevel = app.analysers[0].level * app.gains[0].gain.value;
  const aiLevel = app.analysers[1].level * app.gains[1].gain.value;
  assert.ok(Math.abs(micLevel - 0.12) < 0.000001);
  assert.ok(Math.abs(aiLevel - micLevel) < 0.000001);
  assert.equal(app.connections[0][1], app.analysers[0]);
  assert.equal(app.connections[1][1], app.analysers[1]);
  assert.equal(app.gains[0].targets[0], app.compressor);
  assert.equal(app.gains[1].targets[0], app.compressor);
  assert.equal(app.compressor.targets[0], app.destination);
  app.run('stopLocalRecording()');
  app.recorders[0].finish();
});

test('does not boost silence and caps amplification of faint microphone audio', async () => {
  const app = browser();
  await app.run('startLocalRecording()');
  app.analysers[0].level = 0.001;
  for (const tick of app.intervals.values()) tick();
  assert.equal(app.gains[0].gain.value, 2);
  app.analysers[0].level = 0.011;
  for (const tick of app.intervals.values()) tick();
  assert.equal(app.gains[0].gain.value, 4);
  app.run('stopLocalRecording()');
  app.recorders[0].finish();
});

test('AI playback created after recording starts passes through its volume adjustment', async () => {
  const app = browser();
  app.run('outputAnalyser = null');
  await app.run('startLocalRecording()');
  await app.run('drainAudioQueue()');
  const playback = app.analysers[2];
  assert.ok(playback.targets.includes(app.analysers[1]));
  assert.ok(!playback.targets.includes(app.destination));
  app.run('stopLocalRecording()');
  app.recorders[0].finish();
  assert.equal(playback.disconnected, true);
});

test('camera permission failure leaves the interview active without recording', async () => {
  const app = browser('video', async () => { throw new Error('Permission denied'); });
  await app.run('startLocalRecording()');
  assert.equal(app.run('isSessionActive'), true);
  assert.equal(app.run('localRecording'), null);
  assert.match(app.element('recordingStatus').textContent, /記録なしで継続/);
});

test('ending while waiting for camera permission releases late camera tracks', async () => {
  let grant;
  const app = browser('video', () => new Promise(resolve => { grant = resolve; }));
  const pending = app.run('startLocalRecording()');
  app.run('isSessionActive = false; stopLocalRecording()');
  grant({ getTracks: () => [app.camera] });
  await pending;
  assert.equal(app.camera.stopped, true);
  assert.equal(app.recorders.length, 0);
});

test('resumed sessions keep earlier downloads and an older stop cannot overwrite recording status', async () => {
  const app = browser();
  await app.run('startLocalRecording()');
  app.run('stopLocalRecording()');
  await app.run('startLocalRecording()');
  app.recorders[0].finish();
  assert.match(app.element('recordingStatus').textContent, /録音中/);
  app.run('stopLocalRecording()');
  app.recorders[1].finish();
  assert.equal(app.element('recordingDownloads').children.length, 2);
});

test('unmount discards pending recording data and off mode never starts recording', async () => {
  const off = browser('off');
  await off.run('startLocalRecording()');
  assert.equal(off.recorders.length, 0);
  const app = browser();
  await app.run('startLocalRecording()');
  app.run('recordingPageActive = false; stopLocalRecording()');
  app.recorders[0].finish();
  assert.equal(app.blobs.length, 0);
});
