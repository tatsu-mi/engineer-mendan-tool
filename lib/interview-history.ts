import 'server-only';

import { getActiveAdministrator, getSupabaseAdmin } from './supabase-admin';

export type HistoryViewer = {
  memberId: string;
  email: string;
  isAdministrator: boolean;
};

export async function getHistoryViewer(memberId: string, email: string): Promise<HistoryViewer> {
  const administrator = await getActiveAdministrator(email);
  return { memberId, email, isAdministrator: Boolean(administrator) };
}

export async function getHistoryMembers() {
  const { data, error } = await getSupabaseAdmin()
    .from('members')
    .select('id,email,display_name')
    .eq('is_active', true)
    .order('display_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true });

  if (error) throw new Error(`メンバー一覧を取得できませんでした: ${error.message}`);
  return data ?? [];
}

export async function getInterviewHistory(memberId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('interviews')
    .select('id,status,started_at,ended_at,duration_seconds,interview_projects(project_name),interview_reviews(overall,overall_score)')
    .eq('member_id', memberId)
    .order('started_at', { ascending: false });

  if (error) throw new Error(`面談履歴を取得できませんでした: ${error.message}`);
  return data ?? [];
}

export async function getInterviewDetail(interviewId: string, allowedMemberId?: string) {
  let query = getSupabaseAdmin()
    .from('interviews')
    .select(`
      id,member_id,status,started_at,ended_at,duration_seconds,
      members(email,display_name),
      interview_projects(project_name,interviewer_role,required_skills,project_details),
      interview_configurations(main_question_count,follow_up_intensity,includes_reverse_questions,customization),
      interview_skill_sheets(content,original_file_name),
      interview_questions(sequence_number,main_question_number,question_type,question_text),
      conversation_logs(sequence_number,speaker_role,text,spoken_at),
      interview_reviews(overall,technical_score,communication_score,overall_score,technical,communication,attitude,feedback)
    `)
    .eq('id', interviewId);

  if (allowedMemberId) query = query.eq('member_id', allowedMemberId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`面談詳細を取得できませんでした: ${error.message}`);
  return data;
}
