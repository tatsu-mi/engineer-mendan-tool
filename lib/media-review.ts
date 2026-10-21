export type MediaFeedback = { visual: string; vocal: string; coverage: string };
export type MediaSample = { mimeType: string; data: string; startSeconds: number; durationSeconds: number };
export const MAX_MEDIA_BYTES = 1500000;
const MIME_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'video/webm', 'video/mp4']);

export function isMediaFeedback(value: unknown): value is MediaFeedback {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['visual', 'vocal', 'coverage'].every(key =>
    typeof item[key] === 'string' && item[key].trim().length > 0 && item[key].length <= 4000);
}

export function isMediaSamples(value: unknown): value is MediaSample[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return false;
  let bytes = 0;
  for (const sample of value) {
    if (!sample || !MIME_TYPES.has(sample.mimeType) || typeof sample.data !== 'string'
      || !sample.data.length || sample.data.length > 2000000
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(sample.data)
      || !Number.isFinite(sample.startSeconds) || sample.startSeconds < 0 || sample.startSeconds > 86400
      || !Number.isFinite(sample.durationSeconds) || sample.durationSeconds < 1 || sample.durationSeconds > 12) return false;
    bytes += sample.data.length / 4 * 3 - (sample.data.endsWith('==') ? 2 : sample.data.endsWith('=') ? 1 : 0);
  }
  return bytes <= MAX_MEDIA_BYTES;
}
