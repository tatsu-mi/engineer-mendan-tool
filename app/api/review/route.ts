import { isMediaFeedback } from '../../../lib/media-review';
import {
  GEMINI_API_BASE,
  TEXT_MODEL,
  getGeneratedText,
  noStoreJson,
  readApiKey,
  readGeminiResponse
} from '../_shared/gemini';
import { requireAuthenticatedUser } from '../_shared/auth';
import { getDatabaseErrorMessage, getSupabaseAdmin } from '../../../lib/supabase-admin';
import { getHistoryViewer, getInterviewDetail } from '../../../lib/interview-history';

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
        '姿勢・意欲': { type: 'INTEGER', minimum: 1, maximum: 5 },
        '総合': { type: 'INTEGER', minimum: 1, maximum: 5 }
      },
      required: ['技術力', 'コミュニケーション', '姿勢・意欲', '総合']
    },
    technical: { type: 'STRING', description: '1800文字以内。冒頭に技術力の総括的な評価・助言を記し、その後「具体的なアドバイス」として回答に即した改善点・回答例を追加する。' },
    communication: { type: 'STRING', description: '1800文字以内。冒頭にコミュニケーションの総括的な評価・助言を記し、その後「具体的なアドバイス」として回答に即した改善点・回答例を追加する。' },
    attitude: { type: 'STRING', description: '1800文字以内。冒頭に姿勢・意欲の総括的な評価・助言を記し、その後「具体的なアドバイス」として回答に即した改善点・回答例を追加する。' },
    feedback: { type: 'STRING', description: '1800文字以内。冒頭に面談全体の総括的な改善アドバイスを記し、その後「具体的なアドバイス」として対象の質問・回答、改善点、回答例を追加する。' }
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

function isValidReview(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const review = value as Record<string, any>;
  return ['◎', '○', '△', '×'].includes(review.overall)
    && ['技術力', 'コミュニケーション', '姿勢・意欲', '総合'].every(key =>
      Number.isInteger(review.scores?.[key])
      && review.scores[key] >= 1
      && review.scores[key] <= 5
    )
    && ['technical', 'communication', 'attitude', 'feedback'].every(key =>
      typeof review[key] === 'string' && review[key].trim().length > 0
    );
}

export async function POST(request: Request) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;

  const apiKey = readApiKey(request);
  if (!apiKey) return noStoreJson({ error: 'APIキーを入力してください。' }, { status: 400 });

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return noStoreJson({ error: 'リクエストを読み取れませんでした。' }, { status: 400 });
  }

  let { interviewId, projectName, requiredSkills, conversationLog, mediaFeedback } = input;
  let reviewMemberId = authentication.memberId;
  if (input.reevaluate === true) {
    if (typeof interviewId !== 'string' || !interviewId) {
      return noStoreJson({ error: '面談IDが正しくありません。' }, { status: 400 });
    }
    try {
      const viewer = await getHistoryViewer(authentication.memberId, authentication.email);
      const interview = await getInterviewDetail(interviewId, viewer.isAdministrator ? undefined : authentication.memberId);
      if (!interview) return noStoreJson({ error: '面談が見つからないか、操作権限がありません。' }, { status: 404 });
      if (!['completed', 'interrupted'].includes(interview.status)) {
        return noStoreJson({ error: '完了または中断した面談のみ再評価できます。' }, { status: 409 });
      }
      const projects = interview.interview_projects;
      const project = Array.isArray(projects) ? projects[0] : projects;
      const reviews = interview.interview_reviews;
      const previousReview = Array.isArray(reviews) ? reviews[0] : reviews;
      projectName = project?.project_name ?? '';
      requiredSkills = project?.required_skills ?? '';
      conversationLog = [...(interview.conversation_logs ?? [])]
        .sort((a, b) => a.sequence_number - b.sequence_number)
        .map(log => ({ role: log.speaker_role, text: log.text }));
      if (!(conversationLog as Array<{ role: string; text: string }>).some(log => log.role === 'candidate' && log.text.trim())) {
        return noStoreJson({ error: '再評価できる候補者の会話ログがありません。' }, { status: 400 });
      }
      // 過去の音声・映像の助言は保持し、再解析や会話の採点には使わない。
      mediaFeedback = isMediaFeedback(previousReview?.media_feedback) ? previousReview.media_feedback : undefined;
      reviewMemberId = interview.member_id;
    } catch {
      return noStoreJson({ error: '再評価に必要な面談情報を取得できませんでした。' }, { status: 502 });
    }
  }
  if (mediaFeedback !== undefined && !isMediaFeedback(mediaFeedback)) {
    return noStoreJson({ error: '録音・録画の評価結果が不正です。' }, { status: 400 });
  }
  if (
    typeof interviewId !== 'string'
    || typeof projectName !== 'string'
    || typeof requiredSkills !== 'string'
    || !isValidConversation(conversationLog)
  ) {
    return noStoreJson({ error: '総評生成に必要な面談情報が不足しています。' }, { status: 400 });
  }

  const logText = conversationLog
    .map(log => `【${log.role === 'interviewer' ? '面接官' : '候補者'}】${log.text}`)
    .join('\n');
  const prompt = `以下はSES技術者面談の情報と会話ログです。面接官の立場から、候補者を総合的に評価してください。

会話ログの候補者発言（画面上の「あなた」）は音声文字起こしであり、誤認識を含む可能性があります。一方、AI面接官は各回答の直後の発言の最初の一文に回答内容の要点を自然な表現で要約して復唱しています。評価では、このAI面接官による要約した復唱を最も重く扱い、候補者発言の文字起こしは主に文脈確認の参考情報として扱ってください。ただし、AI利用や本人の担当範囲について候補者が明示した説明を、復唱が別の開発方法や担当範囲へ読み替えていないか確認してください。

## 案件情報
- 案件名：${projectName || '（案件名未設定）'}
- 必須スキル：${requiredSkills || '（必須スキル未設定）'}

## 会話ログ
${logText}

## 評価基準
- scoresには技術力、コミュニケーション、姿勢・意欲、総合をそれぞれ1〜5の整数で採点する。姿勢・意欲は会話から確認できた学習意欲や課題への取り組み方を根拠とし、attitudeのコメントと整合させる
- 他の候補者とも比較して参画者を選ぶSES面談として、質問に問題なく答えられることや技術を説明できることは基本条件とする。「この案件でこの候補者を選ぶ理由」が会話から具体的に伝わったかを評価する。実在する競合候補者の能力や選考結果、市場統計は推測しない

### 点数の目安
- 1点：質問に対する内容面の回答が成立しない、または案件の必須要件に対する重大な不足が会話で確認された
- 2点：関連する説明はあるが、回答が抽象的で、本人の担当・判断・成果や案件への適合を十分に確認できない
- 3点：基本的な受け答えや技術説明ができ、必要な経験は確認できるが、この案件で選ぶ理由となる強み・貢献の伝達は弱い。問題のない回答や一般的な技術知識だけでは3点を上限とする
- 4点：案件に関連する具体的な経験を、本人の役割・判断理由・行動・結果と結び付けて説明し、参画後にどう貢献できるかが伝わる。推奨できる明確な根拠がある
- 5点：4点の条件に加え、案件の課題を踏まえた提案、トレードオフを含む深い判断、成果の再現性まで示し、積極的に選ぶべき説得力のある強みが確認できる

### 項目ごとの判断
- 技術力：用語や仕組みの説明だけで高得点にしない。具体的な課題、本人の担当範囲、選択肢と採用理由、検証・結果を評価し、案件で活かせる経験かを判断する。成果は数値に限らず、品質改善や問題解決など具体的に説明できた結果も評価する
- コミュニケーション：質問を理解して無難に答えるだけでは3点まで。結論と根拠を整理し、相手の関心に合わせて具体例を示し、自分の強みと案件への貢献を説得力をもって伝えた場合に4点以上とする。話の長さや自己アピールの量だけでは加点しない
- 姿勢・意欲：「頑張ります」「学びたいです」などの意思表明や丁寧な受け答えだけでは高得点にしない。主体的に課題を捉えた行動、学習を実務に活かした事例、案件理解に基づく提案や質問を根拠にする。逆質問の数だけでは加点しない
- 総合：各項目の単純平均ではなく、必須要件への適合と、この案件で選ぶ理由が伝わったかで判断する。技術説明と問題のない受け答えにとどまり、案件に結び付く強み・貢献が具体的でなければ3点以下。姿勢・意欲の高さだけで技術面の不足やアピール不足を補って4点以上にしない
- 厳しさは上記の根拠と条件で表し、機械的な減点や点数分布の割り当てはしない。説明不足・未確認と能力不足を区別し、質問されず説明機会もなかった事項を能力不足と断定しない。高得点に必要な根拠が未確認の場合は補完せず、何が確認できれば評価が上がるかを助言する

### 根拠とコメント
- 候補者の評価は会話内容だけを根拠とし、スキルシートの記載は加点・減点・経験や実績の補完に一切使わない
- 案件情報は求めるスキルとの関連性を判断する基準としてのみ使い、候補者の経験・実績の根拠にしない
- 面接官が質問内で紹介したスキルシートの情報は、候補者が会話で説明した事実として扱わない
- technical、communication、attitude はそれぞれ1800文字以内。冒頭には従来どおり、その項目全体についての評価、良かった点、課題、今後の取り組み方を自然な文章でまとめる。点数の理由が分かる総括的な評価・助言を残し、回答ごとの指摘だけに置き換えない。その後に空行と「具体的なアドバイス」の見出しを置き、実際の回答に即した補足を追加する。根拠は実際の質問の主題と回答内容の要約で特定する
- 各項目の改善点は、該当する回答の何が不足し、どう説明すれば案件での価値が伝わるかを具体的に示す。必要に応じて短い回答例を添え、未確認の事実はfeedbackと同じく本人が実体験で補う欄にする。feedbackには最優先の改善と詳しい回答例を集約し、各項目の説明をそのまま繰り返さない
- 文字数は上限であり、会話に根拠が少ない場合は短くまとめる。良かった点・改善点を無理に作らず、確認できなかった内容は未確認と記す
- 各評価コメントは会話中の具体的な根拠と、選ばれるために足りない説明を示し、点数と整合させる。高評価の条件を満たす場合は、その強みを明記する
- feedback は1800文字以内。冒頭には従来どおり、面談全体での強みと選定上の最大の課題、次回に向けた取り組み方を総括的な改善アドバイスとして記す。この助言を回答例の列挙に置き換えない。その後に空行と「具体的なアドバイス」の見出しを置き、選定への影響が大きい順に、実際の会話から改善対象の回答を最大3件選んで補足する。字数を埋めるために指摘を増やさず、会話が短い場合は確認できた回答だけを扱う
- 各指摘は「対象の質問・回答」「改善点」「回答例」の順で、見出しと改行・空行で区切って読みやすく記載する。対象は質問の主題と回答内容の短い要約で特定する。音声文字起こしを逐語引用して表現を批判せず、評価に使った面接官の復唱と整合する内容を示す
- 「改善点」では、その回答のどの説明が足りず、なぜ選ぶ理由として弱かったかを具体的に示す。「もっと具体的に」だけで終わらず、本人の役割・判断理由・行動・結果・案件への貢献のうち不足していた要素を明示する。説明できていた強みは残す
- 「回答例」では、その質問に対して次回どう話せばよいかを、候補者が口頭で使える自然な一人称の文で示す。会話で確認できた事実を使い、不明な役割・行動・成果・数値は捏造せず「［実際に担当した範囲］」「［採用した理由］」「［確認できた結果］」など本人が事実で補う欄にする。補足が必要な例には「補足欄は実体験に合わせて埋めてください」と明記する。面接官が提案・説明した内容を本人の経験にしない
- 改善対象が確認できない場合は無理に欠点や回答例を作らず、会話で確認できた強みと次回も活かす伝え方を記す。回答例は話し方の練習用であり、未確認の経験があることや実際の参画可否を保証する表現にしない
- 候補者の経験・実績・スキルの判定は、候補者発言そのものより、その直後のAI面接官による要約した復唱を優先する
- AI面接官の質問、案件説明、逆質問への回答は候補者の実績ではないため、候補者の発言として評価しない
- AI面接官の要約した復唱に含まれない候補者発言の情報は参考程度にとどめ、重要な加点・減点の根拠にしない。ただし、AI利用と本人の担当範囲の明示的な説明は、復唱による誤った実績の帰属を防ぐために保持する
- AI面接官の要約した復唱と候補者発言が食い違う場合は、原則としてAI面接官の要約した復唱を採用する。ただし、候補者が明示したAI支援・コード生成・バイブコーディングや本人の担当範囲を、復唱がライブラリ利用や本人による一からの実装へ読み替えている場合は、その読み替えを採用しない
- AIを使って作成したという事実だけで、本人の設計・実装・最適化の実績や、逆に本人の技術力不足を断定しない。本人が説明した指示・コードの確認・修正・動作検証・設計判断の具体的な内容を評価し、未確認の担当範囲は未確認として扱う
- 候補者発言に見られる誤字、脱字、不自然な語句、同音異義語、固有名詞の表記揺れ、言い間違いに見える箇所は、音声の聞き取り・文字起こし精度に起因するものとして扱い、技術力・コミュニケーション・態度・総合評価のいずれにも一切反映しない
- AI面接官の質問と、その回答後にAI面接官が述べた要約した復唱の内容に意味上の矛盾がなければ、候補者は質問を正しく理解し、言葉の誤りなく回答したものと判断する
- 文字起こし上の言葉の誤り、表現の不自然さ、発音、用語の言い間違いを、technical、communication、attitude、feedback、overallの根拠や改善点として記載しない
- 会話で確認できなかった事項を経験済みと断定しない
- overall は総合点と必ず対応させ、5点＝◎（強く推奨）、4点＝○（推奨）、3点＝△（要検討）、1〜2点＝×（見送り）とする。基本的な受け答えや技術説明ができただけで○・◎にしない`;

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
    const review = JSON.parse(rawText);
    if (!isValidReview(review)) throw new Error('総評に必要な項目が不足しています。');

    // 映像・音声の助言は会話に基づく採点と独立させ、採点プロンプトに混ぜない。
    if (mediaFeedback) review.media_feedback = {
      visual: mediaFeedback.visual, vocal: mediaFeedback.vocal, coverage: mediaFeedback.coverage
    };
    const { error } = await getSupabaseAdmin().rpc('save_interview_review', {
      p_member_id: reviewMemberId,
      p_interview_id: interviewId,
      p_review: review
    });
    if (error) {
      throw new Error(getDatabaseErrorMessage(error, '総評を保存できませんでした。'));
    }
    return noStoreJson({ review });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : '総評の生成に失敗しました。' },
      { status: response.status >= 400 ? response.status : 502 }
    );
  }
}
