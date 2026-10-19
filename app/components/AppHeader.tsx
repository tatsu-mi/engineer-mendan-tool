import SignOutButton from './SignOutButton';

type AppHeaderProps = {
  userEmail: string;
  homeHref?: string;
  isAdministrator?: boolean;
};

export default function AppHeader({ userEmail, homeHref = '/', isAdministrator = false }: AppHeaderProps) {
  return (
    <header className="app-header">
      <a className="brand" href={homeHref} aria-label="面談練習 ホーム">
        <span className="brand-product">エンジニア向けAI面談練習ツール</span>
      </a>
      <div className="header-account">
        {isAdministrator && <a className="header-analytics" href="/analytics">利用分析</a>}
        <div className="header-context">
          <span className="header-context-dot" aria-hidden="true" />
          <span className="header-email">{userEmail}</span>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
