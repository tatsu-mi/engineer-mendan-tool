import {
  GEMINI_LIVE_API_BASE,
  noStoreJson,
  readApiKey,
  readGeminiResponse
} from '../_shared/gemini';
import { requireAuthenticatedUser } from '../_shared/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;

  const apiKey = readApiKey(request);
  if (!apiKey) return noStoreJson({ error: 'APIキーを入力してください。' }, { status: 400 });

  const response = await fetch(`${GEMINI_LIVE_API_BASE}/auth_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    // 有効期限はGoogle側の時計を基準にしたデフォルト値
    // （新規接続60秒、セッション利用30分）を使用する。
    body: JSON.stringify({ uses: 1 }),
    cache: 'no-store'
  });

  try {
    const data = await readGeminiResponse(response, 'Live APIトークンを発行できませんでした');
    if (!data.name) throw new Error('Live APIトークンが応答に含まれていません。');
    return noStoreJson({ token: data.name });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Live APIトークンを発行できませんでした。' },
      { status: response.status >= 400 ? response.status : 502 }
    );
  }
}
