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

const MAX_PDF_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const apiKey = readApiKey(request);
  if (!apiKey) return noStoreJson({ error: 'APIキーを入力してください。' }, { status: 400 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return noStoreJson({ error: 'PDFファイルを読み取れませんでした。' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.type !== 'application/pdf') {
    return noStoreJson({ error: 'PDFファイルを選択してください。' }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return noStoreJson({ error: 'PDFは4MB以下にしてください。' }, { status: 413 });
  }

  const prompt = `添付されたPDFはSES技術者のスキルシートです。面談の質問作成に使えるよう、内容を日本語のMarkdownテキストとして正確に抽出してください。

## 必須事項
- 氏名・イニシャル、経験年数、自己PRなどの基本情報
- OS、言語、フレームワーク、DB、クラウド、ツール、資格などのスキル
- すべての職務経歴について、期間、案件概要、担当工程、役割、業務内容、使用技術
- 表の見出しと各行の対応関係を保つ
- 読み取れない箇所は「判読不能」と記載する
- PDFにない経験や情報を推測・追加しない
- Markdown本文だけを出力し、前置きや説明は付けない`;

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const response = await fetch(`${GEMINI_API_BASE}/models/${TEXT_MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64 } },
          { text: prompt }
        ]
      }]
    }),
    cache: 'no-store'
  });

  try {
    const data = await readGeminiResponse(response, 'PDFの解析に失敗しました');
    const text = getGeneratedText(data)
      ?.replace(/^```(?:markdown|md|text)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    if (!text) throw new Error('PDFから内容を抽出できませんでした。');
    return noStoreJson({ text });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'PDFの解析に失敗しました。' },
      { status: response.status >= 400 ? response.status : 502 }
    );
  }
}
