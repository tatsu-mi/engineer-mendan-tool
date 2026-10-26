export interface BackgroundRecording {
  stream: MediaStream;
  stop(): void;
}

/** Only processed frames reach the recording stream, including on failures. */
export async function createBackgroundRecording(
  camera: MediaStream, frameRate: number, onError: () => void, signal: AbortSignal
): Promise<BackgroundRecording> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined'
    || typeof createImageBitmap === 'undefined') {
    throw new Error('このブラウザでは録画の背景除去を利用できません。');
  }
  const worker = new Worker(new URL('./recording-background.worker.ts', import.meta.url));
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = camera;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  let stream: MediaStream | undefined;
  let stopped = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let rejectStart: (reason: Error) => void = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    signal.removeEventListener('abort', stop);
    worker.terminate();
    video.pause();
    video.srcObject = null;
    stream?.getTracks().forEach(track => track.stop());
    rejectStart(new Error('背景除去の準備を中止しました。'));
  };
  const fail = () => {
    if (stopped) return;
    const wasStarted = started;
    rejectStart(new Error('背景除去に失敗したため、録画を停止しました。'));
    stop();
    if (wasStarted) onError();
  };
  const nextFrame = async () => {
    if (stopped) return;
    try {
      const frame = await createImageBitmap(video);
      if (stopped) { frame.close(); return; }
      watchdog = setTimeout(fail, 10000);
      worker.postMessage({ type: 'frame', frame, timestamp: performance.now() }, [frame]);
    } catch (_) { fail(); }
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) { stop(); throw new Error('背景除去の準備を中止しました。'); }
  try {
    const ready = new Promise<void>((resolve, reject) => {
      rejectStart = reject;
      watchdog = setTimeout(fail, 30000);
      worker.onerror = event => { event.preventDefault(); fail(); };
      worker.onmessage = event => {
        const { type, frame } = event.data;
        if (stopped) { frame?.close(); return; }
        clearTimeout(watchdog);
        if (type === 'ready') {
          void nextFrame();
        } else if (type === 'frame') {
          try {
            if (!context) throw new Error('Canvas unavailable');
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
            if (!started) {
              stream = canvas.captureStream(frameRate);
              started = true;
              resolve();
            }
            // One frame at a time bounds memory and keeps inference off the UI thread.
            timer = setTimeout(() => void nextFrame(), 1000 / Math.min(frameRate, 12));
          } catch (_) { fail(); }
          finally { frame.close(); }
        } else { fail(); }
      };
    });
    // Observe rejection even if cancellation happens while play() is pending.
    void ready.catch(() => {});
    await video.play();
    if (stopped) throw new Error('背景除去の準備を中止しました。');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!context || !canvas.width || !canvas.height) throw new Error('カメラ映像を取得できませんでした。');
    worker.postMessage({ type: 'init', origin: location.origin });
    await ready;
    if (stopped) throw new Error('背景除去の準備を中止しました。');
    return { stream: stream!, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
