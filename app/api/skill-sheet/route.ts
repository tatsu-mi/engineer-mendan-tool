import { requireAuthenticatedUser } from '../_shared/auth';
import { noStoreJson } from '../_shared/gemini';
import { getDatabaseErrorMessage, getSupabaseAdmin } from '../../../lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_LENGTH = 120000;
const MAX_FILE_NAME_LENGTH = 500;

export async function GET() {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('skill_sheets')
      .select('content,original_file_name,updated_at')
      .eq('member_id', authentication.memberId)
      .maybeSingle();

    if (error) throw error;
    return noStoreJson({
      skillSheet: data
        ? {
            content: data.content,
            originalFileName: data.original_file_name ?? '',
            updatedAt: data.updated_at
          }
        : null
    });
  } catch (error) {
    return noStoreJson(
      { error: getDatabaseErrorMessage(error, 'スキルシートを取得できませんでした。') },
      { status: 502 }
    );
  }
}

export async function PUT(request: Request) {
  const authentication = await requireAuthenticatedUser();
  if (authentication.response) return authentication.response;

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return noStoreJson({ error: 'リクエストを読み取れませんでした。' }, { status: 400 });
  }

  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const originalFileName = typeof input.originalFileName === 'string'
    ? input.originalFileName.trim()
    : '';
  if (!content || content.length > MAX_CONTENT_LENGTH || originalFileName.length > MAX_FILE_NAME_LENGTH) {
    return noStoreJson({ error: 'スキルシートの保存内容が正しくありません。' }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('skill_sheets')
      .upsert({
        member_id: authentication.memberId,
        content,
        original_file_name: originalFileName || null
      }, { onConflict: 'member_id' })
      .select('updated_at')
      .single();

    if (error) throw error;
    return noStoreJson({ updatedAt: data.updated_at });
  } catch (error) {
    return noStoreJson(
      { error: getDatabaseErrorMessage(error, 'スキルシートを更新できませんでした。') },
      { status: 502 }
    );
  }
}
