import { NextResponse } from 'next/server';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_LIVE_API_BASE = 'https://generativelanguage.googleapis.com/v1alpha';
export const TEXT_MODEL = 'gemini-3.5-flash-lite';
export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function readApiKey(request: Request) {
  return request.headers.get('x-gemini-api-key')?.trim() ?? '';
}

export async function readGeminiResponse(response: Response, fallback: string) {
  let data: Record<string, any>;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${fallback}（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(data.error?.message || `${fallback}（HTTP ${response.status}）`);
  }
  if (data.promptFeedback?.blockReason) {
    throw new Error(`安全性フィルターにより処理できませんでした（${data.promptFeedback.blockReason}）`);
  }
  return data;
}

export function getGeneratedText(data: Record<string, any>) {
  return data.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text || '')
    .join('')
    .trim() as string | undefined;
}
