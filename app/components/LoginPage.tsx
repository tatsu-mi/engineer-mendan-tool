import { signIn } from '../../auth';

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">Employee sign in</p>
        <h1 id="login-title">AI面談練習ツール</h1>
        <p className="login-description">
          社員用Microsoftアカウントでログインしてください。
          認証後、面談ワークスペースを利用できます。
        </p>
        <form
          action={async () => {
            'use server';
            await signIn('microsoft-entra-id', { redirectTo: '/' });
          }}
        >
          <button className="btn btn-primary login-button" type="submit">
            Microsoft Entra IDでログイン
          </button>
        </form>
        <p className="login-note">会社から付与されたメールアドレスを使用してください。</p>
      </section>
    </main>
  );
}
