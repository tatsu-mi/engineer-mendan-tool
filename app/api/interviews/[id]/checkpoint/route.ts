import { requireAuthenticatedUser } from '../../../_shared/auth';
import { noStoreJson } from '../../../_shared/gemini';
import { INTERVIEW_ID_PATTERN, isValidCheckpoint } from '../../../_shared/interview-checkpoint';
import { getDatabaseErrorMessage, getSupabaseAdmin } from '../../../../../lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;
  const { id } = await context.params;
  let input: unknown;
  try { input = await request.json(); } catch { /* validation below */ }
  if (!INTERVIEW_ID_PATTERN.test(id) || !isValidCheckpoint(input)) {
    return noStoreJson({ error: '面談の進捗データが正しくありません。' }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin().rpc('save_interview_checkpoint', {
    p_member_id: authentication.memberId,
    p_interview_id: id,
    p_duration_seconds: input.durationSeconds,
    p_logs: input.conversationLog,
    p_progress: input.progress,
    p_resume_version: input.resumeVersion,
    p_revision: input.revision,
    p_interrupted: input.interrupted === true
  });
  if (error) return noStoreJson({ error: getDatabaseErrorMessage(error, '面談の進捗を保存できませんでした。') }, { status: 409 });
  return noStoreJson({ saved: true });
}
