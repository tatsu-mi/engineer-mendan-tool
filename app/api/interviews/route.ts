import { requireAuthenticatedUser } from '../_shared/auth';
import { LIVE_MODEL, TEXT_MODEL, noStoreJson } from '../_shared/gemini';
import { getDatabaseErrorMessage, getSupabaseAdmin } from '../../../lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isOptionalText(value: unknown, maxLength: number) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= maxLength);
}

function isRequiredText(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export async function POST(request: Request) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return noStoreJson({ error: 'リクエストを読み取れませんでした。' }, { status: 400 });
  }

  const skillSheet = input.skillSheet as Record<string, unknown> | undefined;
  const project = input.project as Record<string, unknown> | undefined;
  const configuration = input.configuration as Record<string, unknown> | undefined;
  const questions = input.questions;

  if (
    !skillSheet
    || !isRequiredText(skillSheet.content, 120000)
    || !isOptionalText(skillSheet.originalFileName, 500)
    || !project
    || !isRequiredText(project.projectName, 1000)
    || !isOptionalText(project.interviewerRole, 1000)
    || !isRequiredText(project.requiredSkills, 20000)
    || !isOptionalText(project.projectDetails, 20000)
    || !configuration
    || !Number.isInteger(configuration.mainQuestionCount)
    || Number(configuration.mainQuestionCount) < 1
    || Number(configuration.mainQuestionCount) > 20
    || !['none', 'standard', 'deep'].includes(String(configuration.followUpIntensity))
    || !isOptionalText(configuration.customization, 1000)
    || !Array.isArray(questions)
    || questions.length !== Number(configuration.mainQuestionCount)
    || !questions.every(question => isRequiredText(question, 1000))
  ) {
    return noStoreJson({ error: '面談の保存内容が正しくありません。' }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc('start_interview', {
    p_member_id: authentication.memberId,
    p_skill_sheet_content: String(skillSheet.content).trim(),
    p_original_file_name: String(skillSheet.originalFileName ?? '').trim(),
    p_project: {
      projectName: String(project.projectName).trim(),
      interviewerRole: String(project.interviewerRole ?? '').trim(),
      requiredSkills: String(project.requiredSkills).trim(),
      projectDetails: String(project.projectDetails ?? '').trim()
    },
    p_configuration: {
      mainQuestionCount: configuration.mainQuestionCount,
      followUpIntensity: configuration.followUpIntensity,
      includesReverseQuestions: true,
      customization: String(configuration.customization ?? '').trim(),
      liveModel: LIVE_MODEL,
      textModel: TEXT_MODEL
    },
    p_questions: questions.map(question => String(question).trim())
  });

  if (error || !data || typeof data !== 'object') {
    return noStoreJson(
      { error: getDatabaseErrorMessage(error, '面談情報を保存できませんでした。') },
      { status: 502 }
    );
  }

  return noStoreJson(data, { status: 201 });
}
