import SignOutButton from './SignOutButton';

type AccessDeniedPageProps = {
  email: string;
};

export default function AccessDeniedPage({ email }: AccessDeniedPageProps) {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="access-denied-title">
        <p className="eyebrow">Access restricted</p>
        <h1 id="access-denied-title">利用権限がありません</h1>
        <p className="login-description">
          {email} のメンバーアカウントは現在利用できません。
          管理担当者にアカウント状態の確認を依頼してください。
        </p>
        <div className="login-button"><SignOutButton /></div>
      </section>
    </main>
  );
}
