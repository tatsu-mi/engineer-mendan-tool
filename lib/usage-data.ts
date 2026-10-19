import 'server-only';
import { getActiveAdministrator, getSupabaseAdmin } from './supabase-admin';
import type { UsageInterview, UsageMember } from './usage-analytics';

// Supabaseの取得上限で集計が欠けないよう、全ページを取得する。
async function readAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const result: T[] = [];
  const size = 1000;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await read(offset, offset + size - 1);
    if (error) throw new Error(`利用状況を取得できませんでした: ${error.message}`);
    result.push(...(data ?? []));
    if (!data || data.length < size) return result;
  }
}

export async function getUsageData(email: string) {
  if (!await getActiveAdministrator(email)) return null;
  const db = getSupabaseAdmin();
  const [members, interviews, administrators] = await Promise.all([
    readAll<UsageMember>((from, to) => db.from('members').select('id,email,display_name').eq('is_active', true).order('id').range(from, to)),
    readAll<UsageInterview>((from, to) => db.from('interviews').select('member_id,status,started_at,duration_seconds').order('id').range(from, to)),
    readAll<{ email: string }>((from, to) => db.from('administrator_accounts').select('email').order('id').range(from, to))
  ]);
  return { members, interviews, administratorEmails: administrators.map(item => item.email) };
}
