import { notFound } from 'next/navigation';
import { auth } from '../../../auth';
import { ensureActiveMember } from '../../../lib/supabase-admin';
import { getHistoryViewer, getInterviewDetail } from '../../../lib/interview-history';
import LoginPage from '../../components/LoginPage';
import HistoryFrame from '../HistoryFrame';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ memberId?: string | string[] }>;
};

const statusLabels: Record<string, string> = {
  preparing: '準備中', in_progress: '実施中', completed: '完了', interrupted: '中断'
};
const followUpLabels: Record<string, string> = {
  none: 'なし', standard: '標準（必要に応じて1回）', deep: 'しっかり（原則1〜2回）'
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date(value));
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}

function Score({ label, value }: { label: string; value: number }) {
  return <div className="detail-score"><span>{label}</span><strong>{value}<small> / 5</small></strong></div>;
}

export default async function InterviewHistoryDetailPage({ params, searchParams }: PageProps) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return <LoginPage />;

  const member = await ensureActiveMember(email, session?.user?.name);
  if (!member) return <LoginPage />;
  const viewer = await getHistoryViewer(member.id, email);
  const { id } = await params;
  const interview = await getInterviewDetail(id, viewer.isAdministrator ? undefined : member.id);
  if (!interview) notFound();

  const project = one(interview.interview_projects);
  const configuration = one(interview.interview_configurations);
  const skillSheet = one(interview.interview_skill_sheets);
  const review = one(interview.interview_reviews);
  const interviewMember = one(interview.members);
  const questions = [...(interview.interview_questions ?? [])].sort((a, b) => a.sequence_number - b.sequence_number);
  const logs = [...(interview.conversation_logs ?? [])].sort((a, b) => a.sequence_number - b.sequence_number);
  const requestedMemberId = (await searchParams).memberId;
  const backMemberId = viewer.isAdministrator && typeof requestedMemberId === 'string'
    ? requestedMemberId
    : interview.member_id;

  return (
    <HistoryFrame userEmail={email}>
      <a className="history-back" href={`/history${viewer.isAdministrator ? `?memberId=${backMemberId}` : ''}`}>← 面談履歴へ戻る</a>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Interview detail</p>
          <h1>{project?.project_name || '面談詳細'}</h1>
          <div className="detail-meta">
            <span>{formatDate(interview.started_at)}</span>
            <span className={`history-status status-${interview.status}`}>{statusLabels[interview.status] ?? interview.status}</span>
            <span>{formatDuration(interview.duration_seconds)}</span>
          </div>
          {viewer.isAdministrator && interviewMember && <p className="detail-member">対象: {interviewMember.display_name || interviewMember.email}</p>}
        </div>
        {review && <div className="detail-overall"><span>総合評価</span><strong>{review.overall}</strong><small>{review.overall_score} / 5</small></div>}
      </div>

      <section className="detail-section">
        <div className="detail-section-heading"><p className="panel-kicker">Settings</p><h2>面談時の設定</h2></div>
        <div className="detail-grid">
          <div><span>案件名</span><p>{project?.project_name || '—'}</p></div>
          <div><span>面接官の役割</span><p>{project?.interviewer_role || '—'}</p></div>
          <div><span>主質問数</span><p>{configuration ? `${configuration.main_question_count}問` : '—'}</p></div>
          <div><span>回答の深掘り</span><p>{configuration ? followUpLabels[configuration.follow_up_intensity] : '—'}</p></div>
          <div className="detail-grid-wide"><span>必須スキル・技術要件</span><p>{project?.required_skills || '—'}</p></div>
          <div className="detail-grid-wide"><span>業務内容・案件概要</span><p>{project?.project_details || '—'}</p></div>
          <div className="detail-grid-wide"><span>希望する雰囲気や話し方</span><p>{configuration?.customization || '—'}</p></div>
        </div>
        <details className="detail-disclosure">
          <summary>面談時のスキルシートを表示</summary>
          {skillSheet?.original_file_name && <p className="detail-file-name">取込元: {skillSheet.original_file_name}</p>}
          <div className="detail-pre">{skillSheet?.content || '記録がありません。'}</div>
        </details>
        {questions.length > 0 && (
          <details className="detail-disclosure">
            <summary>用意された質問を表示（{questions.length}件）</summary>
            <ol className="detail-question-list">{questions.map(question => <li key={question.sequence_number}>{question.question_text}</li>)}</ol>
          </details>
        )}
      </section>

      <section className="detail-section">
        <div className="detail-section-heading"><p className="panel-kicker">Transcript</p><h2>会話ログ</h2></div>
        {logs.length === 0 ? <p className="detail-empty">会話ログは記録されていません。</p> : (
          <div className="history-transcript">
            {logs.map(log => (
              <div className={`history-message ${log.speaker_role}`} key={log.sequence_number}>
                <span className="history-message-role">{log.speaker_role === 'interviewer' ? 'AI面接官' : 'あなた'}</span>
                <p>{log.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="detail-section-heading"><p className="panel-kicker">Review</p><h2>総評</h2></div>
        {!review ? <p className="detail-empty">総評は記録されていません。</p> : (
          <div className="detail-review">
            <div className="detail-scores">
              <Score label="技術力" value={review.technical_score} />
              <Score label="コミュニケーション" value={review.communication_score} />
              <Score label="総合" value={review.overall_score} />
            </div>
            <div className="detail-review-grid">
              <div><h3>技術力</h3><p>{review.technical}</p></div>
              <div><h3>コミュニケーション</h3><p>{review.communication}</p></div>
              <div><h3>姿勢・印象</h3><p>{review.attitude}</p></div>
              <div className="detail-feedback"><h3>改善アドバイス</h3><p>{review.feedback}</p></div>
            </div>
          </div>
        )}
      </section>
    </HistoryFrame>
  );
}
