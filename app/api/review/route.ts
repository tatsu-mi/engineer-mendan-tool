import {
  GEMINI_API_BASE,
  TEXT_MODEL,
  getGeneratedText,
  noStoreJson,
  readApiKey,
  readGeminiResponse
} from '../_shared/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const responseSchema = {
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

function isValidConversation(value: unknown): value is Array<{ role: string; text: string }> {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 300
    && value.every(item =>
      item
      && (item.role === 'interviewer' || item.role === 'candidate')
      && typeof item.text === 'string'
      && item.text.length <= 20000
    )
    && value.reduce((total, item) => total + item.text.length, 0) <= 2000000;
}

export async function POST(request: Request) {
  const apiKey = readApiKey(request);
  if (!apiKey) return noStoreJson({ error: 'APIキーを入力してください。' }, { status: 400 });

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return noStoreJson({ error: 'リクエストを読み取れませんでした。' }, { status: 400 });
  }

  const { projectName, requiredSkills, skillSheet, conversationLog } = input;
  if (
    typeof projectName !== 'string'
    || typeof requiredSkills !== 'string'
    || typeof skillSheet !== 'string'
    || !isValidConversation(conversationLog)
  ) {
    return noStoreJson({ error: '総評生成に必要な面談情報が不足しています。' }, { status: 400 });
  }

  const logText = conversationLog
    .map(log => `【${log.role === 'interviewer' ? '面接官' : '候補者'}】${log.text}`)
    .join('\n');
  const prompt = `以下はSES技術者面談の情報と会話ログです。面接官の立場から、候補者を総合的に評価してください。

## 案件情報
- 案件名：${projectName || '（案件名未設定）'}
- 必須スキル：${requiredSkills || '（必須スキル未設定）'}

## 候補者のスキルシート
${skillSheet || '（スキルシート未設定）'}

## 会話ログ
${logText}

## 評価基準
- technical、communication、attitude はそれぞれ200文字以内
- feedback は300文字以内で、候補者が次回改善できる具体的な助言を含める
- 会話で確認できなかった事項を経験済みと断定しない
- overall は ◎（強く推奨）・○（推奨）・△（要検討）・×（見送り）のいずれか`;

  const response = await fetch(`${GEMINI_API_BASE}/models/${TEXT_MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema
      }
    }),
    cache: 'no-store'
  });

  try {
    const data = await readGeminiResponse(response, '総評の生成に失敗しました');
    const rawText = getGeneratedText(data);
    if (!rawText) throw new Error('総評本文が返されませんでした。');
    return noStoreJson({ review: JSON.parse(rawText) });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : '総評の生成に失敗しました。' },
      { status: response.status >= 400 ? response.status : 502 }
    );
  }
}
