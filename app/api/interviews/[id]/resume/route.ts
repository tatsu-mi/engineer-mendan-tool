import { requireAuthenticatedUser } from '../../../_shared/auth';
import { noStoreJson } from '../../../_shared/gemini';
import { INTERVIEW_ID_PATTERN } from '../../../_shared/interview-checkpoint';
import { getDatabaseErrorMessage, getSupabaseAdmin } from '../../../../../lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

async function readInterview(context: Context) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return { response: authentication.response };
  const { id } = await context.params;
  if (!INTERVIEW_ID_PATTERN.test(id)) return { response: noStoreJson({ error: '面談IDが正しくありません。' }, { status: 400 }) };
  const { data, error } = await getSupabaseAdmin().from('interviews').select(`
    id,status,duration_seconds,progress,resume_version,
    interview_projects(project_name,interviewer_role,required_skills,project_details),
    interview_configurations(main_question_count,follow_up_intensity,customization),
    interview_skill_sheets(content,original_file_name),
    interview_questions(id,sequence_number,main_question_number,question_type,question_text),
    conversation_logs(sequence_number,speaker_role,raw_text,text,spoken_at,interview_question_id)
  `).eq('id', id).eq('member_id', authentication.memberId).maybeSingle();
  if (error) return { response: noStoreJson({ error: '面談情報を取得できませんでした。' }, { status: 502 }) };
  if (!data) return { response: noStoreJson({ error: '再開できる面談が見つかりません。' }, { status: 404 }) };
  if (data.status === 'completed') return { response: noStoreJson({ error: '完了した面談は再開できません。' }, { status: 409 }) };
  return { interview: data, memberId: authentication.memberId };
}

export async function GET(_request: Request, context: Context) {
  const result = await readInterview(context);
  return result.response ?? noStoreJson({ interview: result.interview });
}

export async function POST(_request: Request, context: Context) {
  const result = await readInterview(context);
  if (result.response) return result.response;
  const { data, error } = await getSupabaseAdmin().rpc('resume_interview', {
    p_member_id: result.memberId,
    p_interview_id: result.interview!.id,
    p_resume_version: result.interview!.resume_version
  });
  if (error) return noStoreJson({ error: getDatabaseErrorMessage(error, '面談を再開できませんでした。') }, { status: 409 });
  // RPC内で行ロックを取得した時点のログと進捗を返す。
  return noStoreJson({ interview: { ...result.interview, ...data } });
}
