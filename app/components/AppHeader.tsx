import SignOutButton from './SignOutButton';

type AppHeaderProps = {
  userEmail: string;
  homeHref?: string;
};

export default function AppHeader({ userEmail, homeHref = '/' }: AppHeaderProps) {
  return (
    <header className="app-header">
      <a className="brand" href={homeHref} aria-label="面談練習 ホーム">
        <span className="brand-product">エンジニア向けAI面談練習ツール</span>
      </a>
      <div className="header-account">
        <a className="header-history-link" href="/history">面談履歴</a>
        <div className="header-context">
          <span className="header-context-dot" aria-hidden="true" />
          <span className="header-email">{userEmail}</span>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
