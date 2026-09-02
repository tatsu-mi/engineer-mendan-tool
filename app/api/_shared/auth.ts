import { auth } from '../../../auth';
import { ensureActiveMember } from '../../../lib/supabase-admin';
import { noStoreJson } from './gemini';

export async function requireAuthenticatedUser() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  const displayName = session?.user?.name;

  if (!email) {
    return {
      email: null,
      memberId: null,
      response: noStoreJson(
        { error: 'セッションの有効期限が切れました。再度ログインしてください。' },
        { status: 401 }
      )
    } as const;
  }

  let memberId: string;
  try {
    const member = await ensureActiveMember(email, displayName);
    if (!member) {
      return {
        email,
        memberId: null,
        response: noStoreJson(
          { error: 'このアカウントは無効化されています。' },
          { status: 403 }
        )
      } as const;
    }
    memberId = member.id;
  } catch (error) {
    console.error('User account initialization failed:', error);
    return {
      email,
      memberId: null,
      response: noStoreJson(
        { error: 'ユーザーアカウントを初期化できませんでした。' },
        { status: 503 }
      )
    } as const;
  }

  return { email, memberId, response: null } as const;
}
