export type UsageMember = { id: string; email: string; display_name: string | null };
export type UsageInterview = {
  member_id: string; status: string; started_at: string; duration_seconds: number | null;
};
export type UsagePeriod = { preset: string; start: string; end: string; from: string; until: string };
export type UsageParams = Record<string, string | string[] | undefined>;

export function jstDate(value: Date | string): string {
  return new Date(new Date(value).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9998-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getUsagePeriod(params: UsageParams, now = new Date()): UsagePeriod {
  const today = jstDate(now);
  const month = today.slice(0, 7);
  const preset = typeof params.period === 'string' ? params.period : 'month';
  let start: string;
  let end = today;
  if (preset === 'custom') {
    if (!validDate(params.start) || !validDate(params.end) || params.start > params.end) {
      throw new Error('開始日・終了日を正しい日付で指定し、開始日を終了日以前にしてください。');
    }
    start = params.start;
    end = params.end;
  } else if (preset === 'previous') {
    const first = new Date(`${month}-01T00:00:00Z`);
    end = new Date(first.getTime() - 86400_000).toISOString().slice(0, 10);
    start = `${end.slice(0, 7)}-01`;
  } else if (preset === '30days') {
    start = new Date(new Date(`${today}T00:00:00Z`).getTime() - 29 * 86400_000).toISOString().slice(0, 10);
  } else {
    start = `${month}-01`;
  }
  return {
    preset: ['month', 'previous', '30days', 'custom'].includes(preset) ? preset : 'month', start, end,
    from: new Date(`${start}T00:00:00+09:00`).toISOString(),
    until: new Date(new Date(`${end}T00:00:00+09:00`).getTime() + 86400_000).toISOString()
  };
}

export function aggregateUsage(members: UsageMember[], interviews: UsageInterview[], administratorEmails: string[], period: UsagePeriod, excludeAdmins: boolean) {
  const admins = new Set(administratorEmails.map(email => email.trim().toLowerCase()));
  const rows = members.filter(member => !excludeAdmins || !admins.has(member.email.toLowerCase())).map(member => ({
    ...member, isAdministrator: admins.has(member.email.toLowerCase()),
    started: 0, completed: 0, interrupted: 0, unconfirmed: 0,
    seconds: 0, timedCount: 0, days: new Set<string>(), lastUsed: null as string | null
  }));
  const byId = new Map(rows.map(row => [row.id, row]));
  const from = Date.parse(period.from);
  const until = Date.parse(period.until);
  for (const interview of interviews) {
    const row = byId.get(interview.member_id);
    if (!row || interview.status === 'preparing') continue;
    const timestamp = Date.parse(interview.started_at);
    if (!Number.isFinite(timestamp)) continue;
    if (!row.lastUsed || timestamp > Date.parse(row.lastUsed)) row.lastUsed = interview.started_at;
    if (timestamp < from || timestamp >= until) continue;
    row.started++;
    row.days.add(jstDate(interview.started_at));
    if (interview.status === 'completed') row.completed++;
    else if (interview.status === 'interrupted') row.interrupted++;
    else row.unconfirmed++;
    if (['completed', 'interrupted'].includes(interview.status) && interview.duration_seconds !== null && Number.isFinite(interview.duration_seconds) && interview.duration_seconds >= 0) {
      row.seconds += interview.duration_seconds;
      row.timedCount++;
    }
  }
  return rows.map(({ days, ...row }) => ({ ...row, days: days.size, completionRate: row.started ? row.completed / row.started : null }));
}

export type UsageRow = ReturnType<typeof aggregateUsage>[number];
export const usageSortColumns = [
  { key: 'name', label: 'メンバー' },
  { key: 'started', label: '開始' },
  { key: 'completed', label: '完了' },
  { key: 'interrupted', label: '中断' },
  { key: 'unconfirmed', label: '終了未確認' },
  { key: 'completionRate', label: '完了率' },
  { key: 'seconds', label: '合計時間' },
  { key: 'average', label: '平均時間' },
  { key: 'days', label: '利用日数' },
  { key: 'lastUsed', label: '最終面談日時（全期間）' }
] as const;
export type UsageSortColumn = typeof usageSortColumns[number]['key'];
export type UsageSortDirection = 'asc' | 'desc';

export function getUsageSort(params: UsageParams): { column: UsageSortColumn; direction: UsageSortDirection } {
  const legacy = new Map<string, UsageSortColumn>([['count', 'started'], ['time', 'seconds'], ['oldest', 'lastUsed']]);
  const requested = typeof params.sort === 'string' ? params.sort : '';
  const column = usageSortColumns.find(item => item.key === requested)?.key || legacy.get(requested) || 'started';
  const direction = params.direction === 'asc' || params.direction === 'desc'
    ? params.direction : column === 'name' || requested === 'oldest' ? 'asc' : 'desc';
  return { column, direction };
}

export function sortUsage(rows: UsageRow[], sort: string, direction?: UsageSortDirection) {
  const order = getUsageSort({ sort, direction });
  function value(row: UsageRow): string | number | null {
    switch (order.column) {
      case 'name': return row.display_name || row.email;
      case 'lastUsed': return row.lastUsed ? Date.parse(row.lastUsed) : -Infinity;
      case 'seconds': return row.timedCount ? row.seconds : null;
      case 'average': return row.timedCount ? row.seconds / row.timedCount : null;
      default: return row[order.column];
    }
  }
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const tie = () => a.email.localeCompare(b.email) || a.id.localeCompare(b.id);
    // 未記録の時間・算出できない完了率は、昇順でも降順でも末尾に置く。
    if (left === null || right === null) return left === right ? tie() : left === null ? 1 : -1;
    const comparison = typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right, 'ja') : left < right ? -1 : left > right ? 1 : 0;
    return (order.direction === 'asc' ? comparison : -comparison) || tie();
  });
}
