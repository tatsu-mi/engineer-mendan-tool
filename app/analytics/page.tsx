import { auth } from '../../auth';
import { ensureActiveMember } from '../../lib/supabase-admin';
import { getUsageData } from '../../lib/usage-data';
import { aggregateUsage, getUsagePeriod, getUsageSort, sortUsage, usageSortColumns, type UsageParams } from '../../lib/usage-analytics';
import LoginPage from '../components/LoginPage';
import AccessDeniedPage from '../components/AccessDeniedPage';
import HistoryFrame from '../history/HistoryFrame';

export const dynamic = 'force-dynamic';

function duration(seconds: number) {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 3600)}時間${Math.floor(rounded % 3600 / 60)}分${rounded % 60}秒`;
}
function percent(rate: number | null) {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value)) : '利用なし';
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<UsageParams> }) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return <LoginPage />;
  const member = await ensureActiveMember(email, session?.user?.name);
  if (!member) return <AccessDeniedPage email={email} />;
  const data = await getUsageData(email);
  if (!data) return (
    <HistoryFrame userEmail={email}>
      <div className="history-empty"><strong>管理者専用の画面です</strong><p>このアカウントでは利用状況の分析を閲覧できません。</p><a href="/history">自分の面談履歴へ</a></div>
    </HistoryFrame>
  );
  const params = await searchParams;
  let period;
  let periodError: string | undefined;
  try { period = getUsagePeriod(params); }
  catch (error) {
    periodError = error instanceof Error ? error.message : '期間を確認してください。';
    period = getUsagePeriod({});
  }
  const excludeAdmins = params.excludeAdmins === '1';
  const sort = getUsageSort(params);
  const rows = periodError ? [] : sortUsage(aggregateUsage(data.members, data.interviews, data.administratorEmails, period, excludeAdmins), sort.column, sort.direction);
  const total = rows.reduce((sum, row) => ({
    users: sum.users + Number(row.started > 0), started: sum.started + row.started,
    completed: sum.completed + row.completed, seconds: sum.seconds + row.seconds,
    timedCount: sum.timedCount + row.timedCount
  }), { users: 0, started: 0, completed: 0, seconds: 0, timedCount: 0 });
  return (
    <HistoryFrame userEmail={email} isAdministrator activePage="analytics">
      <div className="history-heading">
        <div><p className="eyebrow">Usage analytics</p><h1>利用状況の分析</h1><p>メンバーの練習頻度と継続状況を確認できます。</p></div>
        <span className="history-status">管理者専用</span>
      </div>
      <form className="analytics-filters" method="get">
        <label>集計期間<select className="select-base" name="period" defaultValue={periodError ? 'custom' : period.preset}>
          <option value="month">今月</option><option value="previous">先月</option><option value="30days">直近30日</option><option value="custom">任意期間</option>
        </select></label>
        <label>開始日（任意期間）<input className="input-base" type="date" name="start" defaultValue={typeof params.start === 'string' ? params.start : period.start} /></label>
        <label>終了日（任意期間）<input className="input-base" type="date" name="end" defaultValue={typeof params.end === 'string' ? params.end : period.end} /></label>
        <input type="hidden" name="sort" value={sort.column} />
        <input type="hidden" name="direction" value={sort.direction} />
        <label className="analytics-checkbox"><input type="checkbox" name="excludeAdmins" value="1" defaultChecked={excludeAdmins} />管理者を除外する</label>
        <button className="btn btn-primary" type="submit">集計する</button>
      </form>
      {periodError ? <p className="analytics-error" role="alert">{periodError}</p> : <>
        <p className="history-target">集計期間: {period.start} 〜 {period.end}（日本時間）{excludeAdmins ? ' ／ 管理者を除外中' : ' ／ 管理者を含む'}</p>
        <div className="analytics-summary">
          <div><span>利用人数 / 対象人数</span><strong>{total.users}<small> / {rows.length}人</small></strong></div>
          <div><span>面談開始回数</span><strong>{total.started}<small>回</small></strong></div>
          <div><span>完了率</span><strong>{percent(total.started ? total.completed / total.started : null)}</strong></div>
          <div><span>合計面談時間</span><strong className="analytics-duration">{total.timedCount ? duration(total.seconds) : '—'}</strong></div>
        </div>
        <div className="analytics-table-wrap" tabIndex={0} role="region" aria-label="メンバー別利用状況（横スクロールできます）">
          <table className="analytics-table">
            <caption>メンバー別利用状況（{rows.length}人）</caption>
            <thead><tr>{usageSortColumns.map(column => {
              const active = sort.column === column.key;
              const nextDirection = active && sort.direction === 'asc' ? 'desc' : 'asc';
              const query = new URLSearchParams({
                period: period.preset, start: period.start, end: period.end,
                sort: column.key, direction: nextDirection,
                ...(excludeAdmins ? { excludeAdmins: '1' } : {})
              });
              return <th scope="col" key={column.key} aria-sort={active ? sort.direction === 'asc' ? 'ascending' : 'descending' : undefined}>
                <a className="analytics-sort" href={`/analytics?${query}`} aria-label={`${column.label}を${nextDirection === 'asc' ? '昇順' : '降順'}に並べ替え`}>
                  {column.label}<span aria-hidden="true">{active ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span>
                </a>
              </th>;
            })}<th scope="col">履歴</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <th scope="row"><span>{row.display_name || row.email}</span>{row.display_name && <small>{row.email}</small>}{row.isAdministrator && <small className="analytics-admin">管理者</small>}</th>
              <td>{row.started}回</td><td>{row.completed}回</td><td>{row.interrupted}回</td><td>{row.unconfirmed}回</td><td>{percent(row.completionRate)}</td>
              <td>{row.timedCount ? duration(row.seconds) : '—'}</td><td>{row.timedCount ? duration(row.seconds / row.timedCount) : '—'}</td><td>{row.days}日</td><td>{date(row.lastUsed)}</td>
              <td><a href={`/history?memberId=${row.id}`} aria-label={`${row.display_name || row.email}の面談履歴`}>履歴を見る →</a></td>
            </tr>)}</tbody>
          </table>
          {rows.length === 0 && <p className="detail-empty">条件に一致するメンバーはいません。</p>}
        </div>
      </>}
      <div className="analytics-notes">
        <p>対象は利用可能な登録済みメンバーです。初回ログイン前の社員は含まれません。「管理者を除外する」を選ぶと、利用停止中の管理者も除外します。</p>
        <p>開始回数は準備中を除く面談件数、完了率は完了回数 ÷ 開始回数です。利用日数は面談を開始した日本時間の日付で数えます。</p>
        <p>実施中のままの面談は「終了未確認」に含めます。合計・平均時間は完了または中断し、時間が保存された面談のみが対象です。最終面談日時とリンク先の履歴は全期間を表示します。</p>
      </div>
    </HistoryFrame>
  );
}
