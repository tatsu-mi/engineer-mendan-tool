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

会話ログの候補者発言（画面上の「あなた」）は音声文字起こしであり、誤認識を含む可能性があります。一方、AI面接官は各回答を理解したうえで、その直後の発言の最初の一文に回答内容の要点を自然な表現で要約して復唱しています。評価では、このAI面接官による要約した復唱を一次情報として最も重く扱い、候補者発言の文字起こしは文脈確認のための参考情報としてのみ扱ってください。

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
- 候補者の経験・実績・スキルの判定は、候補者発言そのものより、その直後のAI面接官による要約した復唱を優先する
- AI面接官の質問、案件説明、逆質問への回答は候補者の実績ではないため、候補者の発言として評価しない
- AI面接官の要約した復唱に含まれない候補者発言の情報は参考程度にとどめ、重要な加点・減点の根拠にしない
- AI面接官の要約した復唱と候補者発言が食い違う場合は、AI面接官の要約した復唱を採用する
- 候補者発言に見られる誤字、脱字、不自然な語句、同音異義語、固有名詞の表記揺れ、言い間違いに見える箇所は、音声の聞き取り・文字起こし精度に起因するものとして扱い、技術力・コミュニケーション・態度・総合評価のいずれにも一切反映しない
- AI面接官の質問と、その回答後にAI面接官が述べた要約した復唱の内容に意味上の矛盾がなければ、候補者は質問を正しく理解し、言葉の誤りなく回答したものと判断する
- 文字起こし上の言葉の誤り、表現の不自然さ、発音、用語の言い間違いを、technical、communication、attitude、feedback、overallの根拠や改善点として記載しない
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
