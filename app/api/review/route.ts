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
    ...Object.fromEntries(['technical', 'communication', 'attitude', 'feedback'].map(key => [key, {
      type: 'OBJECT',
      description: '指定テンプレート用の本文。合計1800文字以内。対応する点数が5点ならsummary以外は空文字にする。',
      properties: {
        summary: { type: 'STRING', description: key === 'feedback' ? '面談全体のアドバイス内容。総合5点なら評価した強みの総括のみ。' : '会話の具体的な根拠に基づく、その項目の総括的な評価・強み・点数の理由。guidanceと合わせて従来の総括文を構成する。5点でも必須。' },
        ...(key === 'feedback' ? { target: { type: 'STRING', description: '対象の質問・回答。実際の質問の主題と回答内容の要約。総合5点なら空文字。' } } : {
          guidance: { type: 'STRING', description: '冒頭の総括文の結びとして、今後どう取り組み、どう伝えると強みや専門性がさらに伝わるかを自然な文章で助言する。評価の繰り返しや具体的な助言欄への丸投げは不可。1〜4点は必須、5点は空文字。' },
          advice: { type: 'STRING', description: '「具体的なアドバイス」の独立した本文。実際の回答を取り上げ、何をどう整理・補足して伝えるかを説明する。改善点・回答例の親見出しとして扱わず本文を書く。5点は空文字。' }
        }),
        improvement: { type: 'STRING', description: '改善点の本文。対象の回答で補う説明を具体化する。5点なら空文字。' },
        example: { type: 'STRING', description: '改善点を解消した、一人称で口頭で使える完成した想定回答例。未確認の経験を仮定する場合は注意書きを含める。5点なら空文字。' }
      },
      required: key === 'feedback' ? ['summary', 'target', 'improvement', 'example'] : ['summary', 'guidance', 'advice', 'improvement', 'example']
    }]))
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

const commentKeys = ['technical', 'communication', 'attitude', 'feedback'] as const;

const scoreKeys = { technical: '技術力', communication: 'コミュニケーション', attitude: '姿勢・意欲', feedback: '総合' } as const;

function hasBody(value: unknown): value is string {
  return typeof value === 'string' && value.replace(/[\s#*：:「」【】]/g, '').length > 0;
}

function formatGeneratedReview(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const review = { ...value as Record<string, any> };
  for (const key of commentKeys) {
    const comment = review[key];
    if (!comment || typeof comment !== 'object' || !hasBody(comment.summary)) return null;
    let text = comment.summary.trim();
    if (review.scores?.[scoreKeys[key]] !== 5) {
      if (!hasBody(comment.improvement) || !hasBody(comment.example)) return null;
      if (key === 'feedback') {
        if (!hasBody(comment.target)) return null;
        text += `\n\n対象の質問・回答：\n${comment.target.trim()}`;
      } else {
        if (!hasBody(comment.guidance) || !hasBody(comment.advice)) return null;
        text += `${comment.guidance.trim()}\n\n具体的なアドバイス：\n${comment.advice.trim()}`;
      }
      text += `\n改善点：\n${comment.improvement.trim()}\n\n回答例：\n${comment.example.trim()}`;
    }
    review[key] = text;
  }
  return review;
}

function isValidReview(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const review = value as Record<string, any>;
  return ['◎', '○', '△', '×'].includes(review.overall)
    && Object.values(scoreKeys).every(key =>
      Number.isInteger(review.scores?.[key]) && review.scores[key] >= 1 && review.scores[key] <= 5
    )
    && commentKeys.every(key => {
      const text = review[key];
      if (typeof text !== 'string') return false;
      if (review.scores[scoreKeys[key]] === 5) {
        return hasBody(text)
          && !['具体的なアドバイス：', '対象の質問・回答：', '改善点：', '回答例：'].some(label => text.includes(label));
      }
      const pattern = key === 'feedback'
        ? /^([\s\S]+?)\n\n対象の質問・回答：\n([\s\S]+?)\n改善点：\n([\s\S]+?)\n\n回答例：\n([\s\S]+)$/
        : /^([\s\S]+?)\n\n具体的なアドバイス：\n([\s\S]+?)\n改善点：\n([\s\S]+?)\n\n回答例：\n([\s\S]+)$/;
      const match = text.match(pattern);
      return Boolean(match && match.slice(1).every(hasBody));
    });
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

評価では、会話ログの候補者発言（画面上の「あなた」）を主な根拠として最も重く扱ってください。候補者が述べた具体的なエピソード、本人の役割、判断理由、行動、成果を回答全体から拾い、採点とコメントに反映してください。AI面接官による要約した復唱は、質問の文脈や文字起こしの意味を確認する補助情報です。要約で省略された候補者発言の具体的な情報も、評価の根拠として扱ってください。候補者発言は音声文字起こしであり誤認識を含む可能性がありますが、表記上の誤りは減点しないでください。

## 案件情報
- 案件名：${projectName || '（案件名未設定）'}
- 必須スキル：${requiredSkills || '（必須スキル未設定）'}

## 会話ログ
${logText}

## 評価基準
- scoresには技術力、コミュニケーション、姿勢・意欲、総合をそれぞれ1〜5の整数で採点する。姿勢・意欲は会話から確認できた学習意欲や課題への取り組み方を根拠とし、attitudeのコメントと整合させる
- SES面談として、案件に関連する実務経験と、参画後の貢献を裏付ける行動を評価する。自己アピールの巧さだけでなく、回答に含まれる経験・工夫・課題解決を拾う。実在する競合候補者の能力や選考結果、市場統計は推測しない

### 採点の原則
- 評価の中心は「この候補者が今回の案件で活躍できるか」である。単に質問に答えられる、技術用語を説明できる、関連業務を経験している、意欲を示すだけでは4点以上にしない
- 4点以上は、その評価項目について、今回の案件で活躍できると判断できる具体的な根拠が会話で確認できた場合に限る。一般的な好印象や将来への期待で加点しない
- 高得点に必要な根拠が未確認なら「能力不足」とは断定しないが、確認済みとして加点もしない。説明機会がなかった場合も同様であり、4点以上の条件を緩めない。案件情報が不足して活躍できるか判断できない場合も、適合を推測して4点以上にしない

### 点数の目安
- 1点：質問に対する内容面の回答が成立しない、または案件の必須要件に対する重大な不足が会話で確認された
- 2点：関連する説明はあるが、回答が抽象的で、本人の担当・判断・行動や案件への適合を十分に確認できない
- 3点：基本的な受け答えや関連経験は確認できるが、今回の案件で活躍できると判断するための具体的な根拠が不足している。受け答えが的確であることだけでは、この水準を超えない
- 4点：本人の役割・判断理由・具体的な行動・確認できた結果が結び付き、それが今回の案件で求められる業務・課題にどう活きるか説明できる。その項目について案件で活躍できると判断できる水準。単発の工夫や技術名・手順の説明だけでは足りない
- 5点：4点の条件を満たしたうえで、案件で求められる水準を明確に上回る難しい課題の解決や、継続的・複数の場面での成果が確認でき、特に大きな貢献を期待できる根拠がある。単一の好印象な回答や改善点が見つからないことだけで5点にしない

### 項目ごとの判断
- 技術力：必須スキルを使った本人の実務上の役割、課題、技術的な判断理由、実施内容、結果を確認する。「SQLを調整した」「テストを整備した」「CI/CDを構築した」などの手順や経験の説明だけでは4点にしない。なぜその対応を選び、何を本人が担い、どう課題を解決したかが説明され、今回の案件の業務・課題への適合を裏付けている場合に4点以上とする。結果は定量値に限らず、確認できた定性的な成果でもよい
- コミュニケーション：質問に的確に答えられることは基本水準とする。4点以上には、今回の案件で必要な顧客・チームとの認識合わせ、要件調整、問題の報告・相談などについて、本人がどう相手や状況に応じて働きかけ、どのような合意や問題解決につなげたかという具体的な根拠が必要。流暢さ、回答の長さ、一般的な「共有しています」という説明だけでは加点しない
- 姿勢・意欲：「頑張ります」「学びたいです」などの意思表明や自主学習だけでは4点にしない。4点以上には、本人が課題を見つけ、判断して行動し、業務の改善・解決につなげた具体的な結果と、今回の案件でその主体性が活きる根拠が必要。未経験領域を学習した、有識者に相談した、実装したという説明だけで活躍を推測しない
- 各項目は独立して判断し、各項目の4点以上にはそれぞれ案件での活躍を裏付ける根拠を求める。技術設計の説明不足を、そのままコミュニケーションや姿勢・意欲の減点理由にしない。同じ回答でも、それぞれの項目に該当する根拠を評価する
- 総合：各項目の単純平均や最高点に引き上げる方式ではなく、案件の必須要件への適合と、主要な業務・課題を担って活躍できる具体的な根拠から判断する。関連経験や一部の強みだけでは4点にしない。主要な必須要件の適合や本人の役割・判断・行動・結果が未確認で、活躍できると判断できない場合は3点以下とする。必須要件に対する重大な不足が確認された場合は、姿勢・意欲やコミュニケーションの高さだけで補わない
- 候補者が「今回の案件で活躍できる」と自己申告する必要はないが、評価者は確認済みの実績・行動と具体的な案件要件とのつながりを示すこと。案件名や技術名の一致だけで適合を認定しない
- 機械的な減点や点数分布の割り当てはしない。改善アドバイスがあること自体を減点理由にせず、確認できた根拠が満たす水準で採点する。4点と3点で迷う場合に、未確認の内容を好意的に補って4点にしない
- 出力前に、4点以上の各項目について「本人の具体的な役割・判断・行動・結果」と「今回の案件で活躍できると判断した理由」を会話と照合する。根拠が足りなければ3点以下に見直す。summaryにはその根拠と案件要件とのつながりを明記する。想定回答例で補った内容は、この判定に使わない

### 根拠とコメント
- 各項目は対応する点数が1〜4点の場合だけ改善点と回答例を必ず記載する。5点の場合はレビュー内容のみとし、具体的なアドバイス・改善点・回答例は不要。feedbackは総合点で判断し、総合5点ならアドバイス内容の総括のみとする。
- 候補者の評価は会話内容だけを根拠とし、スキルシートの記載は加点・減点・経験や実績の補完に一切使わない
- 案件情報は求めるスキルとの関連性を判断する基準としてのみ使い、候補者の経験・実績の根拠にしない
- 面接官が質問内で紹介したスキルシートの情報は、候補者が会話で説明した事実として扱わない
- technical、communication、attitude はそれぞれ1800文字以内。summaryにその項目の評価、良かった点、点数の理由を自然な文章でまとめ、1〜4点ではguidanceに今後の取り組み方・強みの伝え方についての総括的な助言を記す。summaryとguidanceは一続きの総括文として表示するため、評価や案件への適合を述べるだけで終えない。例えば「今後は、それぞれの設計判断におけるトレードオフや成果を整理して伝えることで、専門性がさらに伝わります」のように、会話に即した今後の方向性を含める。adviceには個別の回答に即した具体的な助言の本文、improvementには改善点、exampleには改善を反映した回答例を必ず記載する。adviceを親見出しとして空欄にしたり、改善点だけで代用したりしない。5点ならsummaryのみ記載し、guidance、advice、improvement、exampleは空文字とする。
- 各項目の改善点は、該当する回答の何が不足し、どう説明すれば案件での価値が伝わるかを具体的に示す。1〜4点では、その改善点を解消する完成した想定回答例を必ず添える。想定回答例の作成ルールはfeedbackにも共通で適用する。
- 文字数は上限であり、会話に根拠が少ない場合は短くまとめる。良かった点・改善点を無理に作らず、確認できなかった内容は未確認と記す
- 各評価コメントは会話中の具体的な根拠を示し、点数と整合させる。4点以上は確認できた強みとその評価理由を中心に、3点以下はその水準にとどまる理由も示す。今より良くするための補足と、現在の点数を下げる実質的な課題を区別し、高評価のコメントにも無理に不足を作らない
- feedback は1800文字以内。summaryに面談全体のアドバイス内容を記す。総合1〜4点では最優先の改善対象を一つ選び、targetに対象の質問・回答、improvementに改善点、exampleに回答例を記す。総合5点ならsummaryに強みの総括のみ記載し、target、improvement、exampleは空文字とする。
- 各指摘は「対象の質問・回答」「改善点」「回答例」の順で、見出しと改行・空行で区切って読みやすく記載する。対象は質問の主題と候補者の回答内容の短い要約で特定する。音声文字起こしを逐語引用して表現を批判せず、評価の根拠にした候補者発言の具体的な内容を示す
- 「改善点」では、実際に不足がある場合に、どの説明を補えばさらに伝わるかを具体的に示す。「もっと具体的に」だけで終わらず、本人の役割・判断理由・行動・結果・案件への貢献のうち補うとよい要素を明示する。説明できていた強みは残し、4点以上に対する追加の助言は現状の強みをさらに伝えるための提案として記す
- 「回答例」は、元の回答の要約や言い換えではなく、直前の改善点を解消した完成形の想定回答とする。候補者が口頭で使える自然な一人称の文で、質問の主題に沿って示す。元の回答は背景として使えるが、会話で確認できた内容だけに制限しない
- 想定回答例では、改善の見本を示すために、未確認の状況・役割・判断理由・行動・成果を仮定してよい。その場合は回答例の直前に「以下は改善点を補うための想定例です。仮定した内容は、ご自身の実際の経験に合わせて置き換えてください。」と明記する。空欄や「［確認できた結果］」などの補足欄に改善の核心を丸投げせず、具体的な内容を含む完成した回答にする。数値は必要な場合だけ仮定し、数値がなくても判断や定性的な成果が伝わる例を作る
- 想定した内容は回答例の中だけで使い、候補者の実績として点数・総括・改善点の根拠に混ぜない。案件説明や面接官の発言を使って想定例を作る場合も、それを本人の確認済みの経験として扱わない
- 出力前に改善点と回答例を照合する。例えば優先順位の決定基準を指摘したなら基準と理由を、ユーザーとのやり取りから画面設計への反映を指摘したなら具体的なやり取りと設計への反映を、成果の不足を指摘したなら結果を回答例に含める。その回答例を同じ基準で評価した際に同じ不足による減点が残る場合は、回答例を修正する。他の質問への回答や元の回答の言い換えだけで済ませない
- 1〜4点で改善対象の説明が会話に不足している場合は、未確認であることを明示し、次回補足するとよい内容とその想定回答例を示す。5点では助言を省略する。回答例は練習用であり、未確認の経験や実際の参画可否を保証する表現にしない。
- 候補者の経験・実績・スキルの判定は、候補者発言そのものを優先する。自己紹介、主質問、深掘り、逆質問を含め、候補者が会話全体で説明した具体的な根拠を確認する
- AI面接官の質問、案件説明、逆質問への回答は候補者の実績ではないため、候補者の発言として評価しない
- AI面接官の要約した復唱に含まれない具体的なエピソード、役割、判断理由、行動、成果も、候補者発言で確認できれば加点・減点の根拠にする。説明不足を指摘する前に、他の回答も含めて候補者がすでに説明していないか確認し、要約から省略されたことを説明不足として扱わない
- AI面接官の要約した復唱と候補者発言が食い違う場合は、候補者が明示した内容を優先する。肯定・否定、数値、経験の有無、目標と達成済みの成果、AI支援・コード生成・バイブコーディング、本人の担当範囲を復唱だけを根拠に読み替えない。誤認識の可能性があり意味を確定できない箇所は、前後の質問・回答と復唱を補助的に参照し、それでも不明なら未確認とする。不確かな語句から実績や能力不足を断定しない
- AIを使って作成したという事実だけで、本人の設計・実装・最適化の実績や、逆に本人の技術力不足を断定しない。本人が説明した指示・コードの確認・修正・動作検証・設計判断の具体的な内容を評価し、未確認の担当範囲は未確認として扱う
- 候補者発言に見られる誤字、脱字、不自然な語句、同音異義語、固有名詞の表記揺れ、言い間違いに見える箇所は、音声の聞き取り・文字起こし精度に起因するものとして扱い、技術力・コミュニケーション・態度・総合評価のいずれにも一切反映しない
- 質問の理解や回答の的確さは、候補者発言の意味と質問の文脈から判断する。AI面接官の復唱が自然につながっていることだけで、候補者が適切に回答したと判断しない。ただし、文字起こしの誤認識や表現の不自然さだけで理解不足と判断しない
- 文字起こし上の言葉の誤り、表現の不自然さ、発音、用語の言い間違いを、technical、communication、attitude、feedback、overallの根拠や改善点として記載しない
- 評価の根拠として、会話で確認できなかった事項を経験済みと断定しない。明示的に仮定として示す想定回答例は、この評価根拠とは区別する
- 目標・取り組みと達成済みの成果を区別する。例えば「3秒以内を目指した」は「3秒以内を達成した」と書き換えず、既存動作を守るためのテスト整備を、説明のないテスト駆動開発の実践と断定しない
- overall は総合点と必ず対応させ、5点＝◎（強く推奨）、4点＝○（推奨）、3点＝△（要検討）、1〜2点＝×（見送り）とする。基本的な受け答えや技術説明ができただけで○・◎にしない

## JSONの出力形式（必須）
technical、communication、attitudeはsummary（総括的な評価）、guidance（総括文に含める今後の取り組み方・伝え方の助言）、advice（具体的なアドバイスの独立した本文）、improvement（改善点）、example（回答例）を持つオブジェクトで返す。
feedbackはsummary（アドバイス内容）、target（対象の質問・回答）、improvement（改善点）、example（回答例）を持つオブジェクトで返す。
見出しはアプリが付けるので各フィールドには本文のみを書く。対応する点数が5点の場合はsummary以外を空文字にし、1〜4点の場合はすべての本文を必ず記載する。feedbackの対応点数は総合点とする。`;

  let upstreamStatus = 502;
  try {
    let review: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${GEMINI_API_BASE}/models/${TEXT_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt + (attempt === 0 ? ''
            : '\n前回の出力は必須項目が不足していました。全項目のsummaryと、1〜4点の項目のimprovement・example、technical・communication・attitudeのguidance・advice、総合1〜4点のfeedbackのtargetを必ず含めてください。5点はsummaryのみで構いません。') }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema }
        }),
        cache: 'no-store'
      });
      upstreamStatus = response.status >= 400 ? response.status : 502;
      const data = await readGeminiResponse(response, '総評の生成に失敗しました');
      const rawText = getGeneratedText(data);
      try {
        review = rawText ? formatGeneratedReview(JSON.parse(rawText)) : null;
      } catch {
        review = null;
      }
      if (isValidReview(review)) break;
      review = null;
    }
    if (!review) throw new Error('指定テンプレートのレビュー内容・改善点・回答例を生成できませんでした。もう一度再評価してください。');

    // 映像・音声の助言は会話に基づく採点と独立させ、採点プロンプトに混ぜない。
    if (mediaFeedback) review.media_feedback = {
      visual: mediaFeedback.visual, vocal: mediaFeedback.vocal, coverage: mediaFeedback.coverage
    };
    if (input.reevaluate === true) return noStoreJson({ review });

    const { error } = await getSupabaseAdmin().rpc('save_interview_review', {
      p_member_id: authentication.memberId,
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
      { status: upstreamStatus }
    );
  }
}

// 再評価の生成とは別に、画面で確認された総評を明示的に保存する。
export async function PATCH(request: Request) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return noStoreJson({ error: 'リクエストを読み取れませんでした。' }, { status: 400 });
  }
  if (!input || typeof input.interviewId !== 'string' || !input.interviewId || !isValidReview(input.review)) {
    return noStoreJson({ error: '保存する総評の内容が正しくありません。' }, { status: 400 });
  }

  try {
    const viewer = await getHistoryViewer(authentication.memberId, authentication.email);
    const interview = await getInterviewDetail(input.interviewId, viewer.isAdministrator ? undefined : authentication.memberId);
    if (!interview) return noStoreJson({ error: '面談が見つからないか、操作権限がありません。' }, { status: 404 });
    if (!['completed', 'interrupted'].includes(interview.status)) {
      return noStoreJson({ error: '完了または中断した面談のみ総評を保存できます。' }, { status: 409 });
    }
    const { overall, scores, technical, communication, attitude, feedback } = input.review as Record<string, unknown>;
    const review: Record<string, unknown> = { overall, scores, technical, communication, attitude, feedback };
    const reviews = interview.interview_reviews;
    const previousReview = Array.isArray(reviews) ? reviews[0] : reviews;
    if (isMediaFeedback(previousReview?.media_feedback)) review.media_feedback = previousReview.media_feedback;

    const { error } = await getSupabaseAdmin().rpc('save_interview_review', {
      p_member_id: interview.member_id,
      p_interview_id: input.interviewId,
      p_review: review
    });
    if (error) throw new Error(getDatabaseErrorMessage(error, '総評を保存できませんでした。'));
    return noStoreJson({ saved: true });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : '総評を保存できませんでした。' }, { status: 502 });
  }
}
