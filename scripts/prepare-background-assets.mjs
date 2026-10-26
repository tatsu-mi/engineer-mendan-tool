import { cp, mkdir } from 'node:fs/promises';

// Keep the WASM runtime on the same origin as the app, at the installed version.
const target = new URL('../public/mediapipe/wasm/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), target, { recursive: true });
