import type { ReactNode } from 'react';
import AppHeader from '../components/AppHeader';

export default function HistoryFrame({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  return (
    <div className="app-frame">
      <AppHeader userEmail={userEmail} />
      <div className="app-layout history-layout">
        <aside className="sidebar" aria-label="メニュー">
          <div className="sidebar-label">Menu</div>
          <nav className="sidebar-page-nav">
            <div className="sidebar-menu-section">
              <a className="sidebar-menu-item" href="/">
                <strong>面談</strong>
              </a>
              <div className="workflow-nav workflow-subnav">
                <a className="workflow-item" href="/#connection">
                  <span className="workflow-number">01</span>
                  <span><strong>接続設定</strong><small>APIキー</small></span>
                </a>
                <a className="workflow-item" href="/#preparation">
                  <span className="workflow-number">02</span>
                  <span><strong>面談準備</strong><small>案件・経歴・構成</small></span>
                </a>
                <a className="workflow-item" href="/#interview">
                  <span className="workflow-number">03</span>
                  <span><strong>面談実施</strong><small>音声面談・会話ログ</small></span>
                </a>
              </div>
            </div>
            <a className="sidebar-menu-item active" href="/history">
              <strong>面談履歴</strong>
              <small>過去の設定・会話・総評</small>
            </a>
          </nav>
        </aside>
        <main className="workspace history-workspace">{children}</main>
      </div>
    </div>
  );
}
