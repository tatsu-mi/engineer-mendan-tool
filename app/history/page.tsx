import { auth } from '../../auth';
import { ensureActiveMember } from '../../lib/supabase-admin';
import { getHistoryMembers, getHistoryViewer, getInterviewHistory } from '../../lib/interview-history';
import LoginPage from '../components/LoginPage';
import HistoryFrame from './HistoryFrame';
import MemberFilter from './MemberFilter';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ memberId?: string | string[] }>;

const statusLabels: Record<string, string> = {
  preparing: '準備中',
  in_progress: '実施中',
  completed: '完了',
  interrupted: '中断'
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}

export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return <LoginPage />;

  const member = await ensureActiveMember(email, session?.user?.name);
  if (!member) return <LoginPage />;
  const viewer = await getHistoryViewer(member.id, email);
  const members = viewer.isAdministrator ? await getHistoryMembers() : [];
  const requestedMemberId = (await searchParams).memberId;
  const requestedId = typeof requestedMemberId === 'string' ? requestedMemberId : undefined;
  const selectedMemberId = viewer.isAdministrator && members.some(item => item.id === requestedId)
    ? requestedId!
    : member.id;
  const selectedMember = members.find(item => item.id === selectedMemberId);
  const interviews = await getInterviewHistory(selectedMemberId);

  return (
    <HistoryFrame userEmail={email}>
      <div className="history-heading">
        <div>
          <p className="eyebrow">Interview history</p>
          <h1>面談履歴</h1>
          <p>過去の面談設定、会話ログ、総評を確認できます。</p>
        </div>
        {viewer.isAdministrator && <MemberFilter members={members} selectedMemberId={selectedMemberId} />}
      </div>

      {viewer.isAdministrator && selectedMember && (
        <p className="history-target">表示中: {selectedMember.display_name || selectedMember.email}</p>
      )}

      {interviews.length === 0 ? (
        <div className="history-empty"><strong>面談履歴はまだありません</strong><p>面談を実施すると、ここから振り返ることができます。</p><a className="btn btn-primary" href="/">新しい面談を始める</a></div>
      ) : (
        <div className="history-list">
          {interviews.map(interview => {
            const project = Array.isArray(interview.interview_projects) ? interview.interview_projects[0] : interview.interview_projects;
            const review = Array.isArray(interview.interview_reviews) ? interview.interview_reviews[0] : interview.interview_reviews;
            return (
              <a className="history-card" href={`/history/${interview.id}${viewer.isAdministrator ? `?memberId=${selectedMemberId}` : ''}`} key={interview.id}>
                <div className="history-card-main">
                  <div className="history-card-meta"><time>{formatDate(interview.started_at)}</time><span className={`history-status status-${interview.status}`}>{statusLabels[interview.status] ?? interview.status}</span></div>
                  <h2>{project?.project_name || '案件名未設定'}</h2>
                  <p>面談時間 {formatDuration(interview.duration_seconds)}</p>
                </div>
                <div className="history-card-review">
                  {review ? <><span className="history-review-mark">{review.overall}</span><span>総合 {review.overall_score} / 5</span></> : <span>総評なし</span>}
                  <span className="history-card-arrow" aria-hidden="true">→</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </HistoryFrame>
  );
}
