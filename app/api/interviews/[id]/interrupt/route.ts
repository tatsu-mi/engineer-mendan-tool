import { requireAuthenticatedUser } from '../../../_shared/auth';
import { noStoreJson } from '../../../_shared/gemini';
import { getDatabaseErrorMessage, getSupabaseAdmin } from '../../../../../lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidLog(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const log = value as Record<string, unknown>;
  return (log.role === 'interviewer' || log.role === 'candidate')
    && typeof log.text === 'string'
    && log.text.trim().length > 0
    && log.text.length <= 20000
    && (log.rawText === undefined
      || (typeof log.rawText === 'string' && log.rawText.length <= 20000))
    && (log.questionNumber === undefined
      || log.questionNumber === null
      || (Number.isInteger(log.questionNumber) && Number(log.questionNumber) >= 1 && Number(log.questionNumber) <= 20))
    && (log.spokenAt === undefined
      || (typeof log.spokenAt === 'string' && !Number.isNaN(Date.parse(log.spokenAt))));
}

export async function POST(request: Request, context: RouteContext) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return noStoreJson({ error: '面談IDが正しくありません。' }, { status: 400 });
  }
  let input: Record<string, unknown> = {};
  try {
    input = await request.json();
  } catch {
    // keepaliveリクエストで本文が空の場合は0秒として扱う。
  }
  const durationSeconds = Number.isInteger(input.durationSeconds)
    ? Math.max(Number(input.durationSeconds), 0)
    : 0;
  const logs = Array.isArray(input.conversationLog)
    && input.conversationLog.length <= 300
    && input.conversationLog.every(isValidLog)
    && input.conversationLog.reduce((total, log) => total + String(log.text).length, 0) <= 2000000
    ? input.conversationLog
    : [];

  const { error } = await getSupabaseAdmin().rpc('interrupt_interview', {
    p_member_id: authentication.memberId,
    p_interview_id: id,
    p_duration_seconds: durationSeconds,
    p_logs: logs
  });

  if (error) {
    return noStoreJson(
      { error: getDatabaseErrorMessage(error, '面談の中断状態を保存できませんでした。') },
      { status: 502 }
    );
  }
  return noStoreJson({ saved: true });
}
