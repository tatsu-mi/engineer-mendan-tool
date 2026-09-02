import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

function getConfiguration() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!url || !key) {
    throw new Error('SUPABASE_URLとSUPABASE_SECRET_KEYを設定してください。');
  }
  return { url, key };
}

export function getSupabaseAdmin() {
  if (client) return client;

  const { url, key } = getConfiguration();
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
  return client;
}

export async function getActiveAdministrator(email: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('administrator_accounts')
    .select('id,email,display_name,is_active')
    .eq('email', email.trim().toLowerCase())
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`管理者アカウントを確認できませんでした: ${error.message}`);
  return data;
}

export async function ensureActiveMember(email: string, displayName?: string | null) {
  const normalizedEmail = email.trim().toLowerCase();
  const { error: insertError } = await getSupabaseAdmin()
    .from('members')
    .upsert(
      {
        email: normalizedEmail,
        display_name: displayName?.trim() || null
      },
      { onConflict: 'email', ignoreDuplicates: true }
    );

  if (insertError) throw new Error(`メンバーを登録できませんでした: ${insertError.message}`);

  const { data, error } = await getSupabaseAdmin()
    .from('members')
    .select('id,email,is_active')
    .eq('email', normalizedEmail)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`メンバーを確認できませんでした: ${error.message}`);
  return data;
}

export function getDatabaseErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    if (message.includes('interview_not_found')) {
      return '指定された面談が見つからないか、操作権限がありません。';
    }
    console.error(fallback, error);
  }
  return fallback;
}
