import { auth } from '../../../auth';
import { noStoreJson } from './gemini';

export async function requireAuthenticatedUser() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    return {
      email: null,
      response: noStoreJson(
        { error: 'セッションの有効期限が切れました。再度ログインしてください。' },
        { status: 401 }
      )
    } as const;
  }

  return { email, response: null } as const;
}
