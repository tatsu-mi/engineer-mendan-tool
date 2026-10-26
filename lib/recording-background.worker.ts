import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

let segmenter: ImageSegmenter;
let canvas: OffscreenCanvas;
let context: OffscreenCanvasRenderingContext2D;
let maskCanvas: OffscreenCanvas;
let maskContext: OffscreenCanvasRenderingContext2D;

self.onmessage = async (event: MessageEvent) => {
  const { type, frame, timestamp, origin } = event.data;
  try {
    if (type === 'init') {
      const files = await FilesetResolver.forVisionTasks(`${origin}/mediapipe/wasm`);
      segmenter = await ImageSegmenter.createFromOptions(files, {
        canvas: new OffscreenCanvas(256, 256),
        baseOptions: { modelAssetPath: `${origin}/models/selfie_segmenter.tflite`, delegate: 'CPU' },
        runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false
      });
      // This pinned model has a single output: the probability of a person.
      if (segmenter.getLabels().join(',') !== 'selfie') throw new Error('Unexpected segmentation model');
      canvas = new OffscreenCanvas(1, 1);
      maskCanvas = new OffscreenCanvas(1, 1);
      context = canvas.getContext('2d')!;
      maskContext = maskCanvas.getContext('2d')!;
      if (!context || !maskContext) throw new Error('Canvas unavailable');
      self.postMessage({ type: 'ready' });
    } else if (type === 'frame') {
      canvas.width = frame.width;
      canvas.height = frame.height;
      segmenter.segmentForVideo(frame, timestamp, result => {
        const mask = result.confidenceMasks?.[0];
        if (!mask) throw new Error('Person mask unavailable');
        maskCanvas.width = mask.width;
        maskCanvas.height = mask.height;
        const pixels = maskContext.createImageData(mask.width, mask.height);
        const probabilities = mask.getAsFloat32Array();
        for (let i = 0; i < probabilities.length; i++) {
          pixels.data[i * 4 + 3] = probabilities[i] >= 0.8 ? 255 : 0;
        }
        maskContext.putImageData(pixels, 0, 0);
        context.globalCompositeOperation = 'source-over';
        context.drawImage(frame, 0, 0);
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      });
      const output = canvas.transferToImageBitmap();
      self.postMessage({ type: 'frame', frame: output }, { transfer: [output] });
    }
  } catch (_) {
    self.postMessage({ type: 'error' });
  } finally {
    frame?.close();
  }
};
