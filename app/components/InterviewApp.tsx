'use client';

import { useEffect } from 'react';
import AppHeader from './AppHeader';

type InterviewAppProps = {
  userEmail: string;
};

export default function InterviewApp({ userEmail }: InterviewAppProps) {
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    let navigationFrame = 0;
    let navigationLock: string | undefined;
    let navigationUnlockTimer: ReturnType<typeof setTimeout> | undefined;

    const navigationItems = Array.from(document.querySelectorAll<HTMLAnchorElement>('.workflow-item[href^="#"]'));
    const navigationSections = navigationItems
      .map(item => document.querySelector<HTMLElement>(item.hash))
      .filter((section): section is HTMLElement => section !== null);

    const setActiveNavigation = (activeId?: string) => {
      navigationItems.forEach(item => {
        item.classList.toggle('active', item.hash === `#${activeId}`);
      });
    };

    const handleNavigationClick = (event: Event) => {
      event.preventDefault();
      const item = event.currentTarget as HTMLAnchorElement;
      const targetId = item.hash.slice(1);
      const target = document.getElementById(targetId);
      if (!target) return;

      navigationLock = targetId;
      setActiveNavigation(targetId);
      window.history.replaceState(null, '', item.hash);

      const headerHeight = document.querySelector<HTMLElement>('.app-header')?.offsetHeight ?? 68;
      const targetTop = window.scrollY + target.getBoundingClientRect().top - headerHeight - 16;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });

      if (navigationUnlockTimer) clearTimeout(navigationUnlockTimer);
      navigationUnlockTimer = setTimeout(() => {
        navigationLock = undefined;
        updateNavigation();
      }, 750);
    };

    const updateNavigation = () => {
      cancelAnimationFrame(navigationFrame);
      navigationFrame = requestAnimationFrame(() => {
        if (navigationLock) {
          setActiveNavigation(navigationLock);
          return;
        }

        let activeId: string | undefined = navigationSections[0]?.id;
        const headerHeight = document.querySelector<HTMLElement>('.app-header')?.offsetHeight ?? 68;
        navigationSections.forEach(section => {
          if (section.getBoundingClientRect().top <= headerHeight + 24) activeId = section.id;
        });

        const pageBottom = window.scrollY + window.innerHeight;
        const isAtPageEnd = pageBottom >= document.documentElement.scrollHeight - 8;
        if (isAtPageEnd) activeId = navigationSections.at(-1)?.id;

        setActiveNavigation(activeId);
      });
    };

    navigationItems.forEach(item => item.addEventListener('click', handleNavigationClick));
    window.addEventListener('scroll', updateNavigation, { passive: true });
    window.addEventListener('resize', updateNavigation);
    updateNavigation();

    import('../interview-client').then(module => {
      if (active) cleanup = module.initializeInterviewApp();
    });

    return () => {
      active = false;
      cancelAnimationFrame(navigationFrame);
      if (navigationUnlockTimer) clearTimeout(navigationUnlockTimer);
      navigationItems.forEach(item => item.removeEventListener('click', handleNavigationClick));
      window.removeEventListener('scroll', updateNavigation);
      window.removeEventListener('resize', updateNavigation);
      cleanup?.();
    };
  }, []);

  return (
    <div className="app-frame">
      <AppHeader userEmail={userEmail} homeHref="#top" />

      <div className="app-layout" id="top">
        <aside className="sidebar" aria-label="面談フロー">
          <div className="sidebar-label">Menu</div>
          <nav className="sidebar-page-nav">
            <div className="sidebar-menu-section">
              <a className="sidebar-menu-item active" href="#top">
                <strong>面談</strong>
              </a>
              <div className="workflow-nav workflow-subnav">
                <a className="workflow-item active" href="#connection">
                  <span className="workflow-number">01</span>
                  <span><strong>接続設定</strong><small>APIキー</small></span>
                </a>
                <a className="workflow-item" href="#preparation">
                  <span className="workflow-number">02</span>
                  <span><strong>面談準備</strong><small>案件・経歴・構成</small></span>
                </a>
                <a className="workflow-item" href="#interview">
                  <span className="workflow-number">03</span>
                  <span><strong>面談実施</strong><small>音声面談・会話ログ</small></span>
                </a>
              </div>
            </div>
            <a className="sidebar-menu-item" href="/history">
              <strong>面談履歴</strong>
              <small>過去の設定・会話・総評</small>
            </a>
          </nav>
          <div className="sidebar-note">
            <span className="sidebar-note-label">Before you start</span>
            <p>静かな場所でマイクの利用を許可してください。面談中も途中終了できます。</p>
          </div>
        </aside>

        <main className="workspace">
          <section className="connection-section" id="connection">
            <div className="section-heading">
              <span className="section-index">01</span>
              <div>
                <p className="eyebrow">Connection</p>
                <h2>接続設定</h2>
                <p>面談で使用するGoogle AI Studio APIキーを設定します。</p>
              </div>
            </div>
            <div className="form-panel connection-panel">
              <div className="connection-panel-copy">
                <h3>Google AI Studio APIキー</h3>
                <p>キーは保存されず、処理時のみバックエンドへ送信されます。</p>
              </div>
              <div className="apikey-row">
                <input type="password" className="input-base" id="apiKeyInput" placeholder="APIキーを入力" aria-label="Google AI Studio APIキー" autoComplete="off" />
              </div>
            </div>
          </section>

          <section className="preparation-section" id="preparation">
            <div className="section-heading">
              <span className="section-index">02</span>
              <div>
                <p className="eyebrow">Preparation</p>
                <h2>面談情報</h2>
                <p>AI面接官が質問を組み立てるための材料を登録します。</p>
              </div>
            </div>

            <section className="form-panel">
              <div className="panel-heading">
                <div><p className="panel-kicker">Project</p><h3>案件情報</h3></div>
              </div>
              <div className="panel-content form-stack">
                <div className="two-col">
                  <div>
                    <label className="field-label" htmlFor="projectName">案件名・プロジェクト名 <span className="req">必須</span></label>
                    <input type="text" className="input-base" id="projectName" placeholder="例：大手流通EC基幹システム刷新PJ" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="interviewerRole">面接官の役割</label>
                    <input type="text" className="input-base" id="interviewerRole" placeholder="例：プロジェクトリーダー（PL）" defaultValue="プロジェクトリーダー（PL）" />
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="requiredSkills">必須スキル・技術要件 <span className="req">必須</span></label>
                  <textarea className="textarea-base" id="requiredSkills" rows={3} placeholder="例：Java（Spring Boot）5年以上、AWS、MySQL、チームリード経験" />
                </div>
                <div>
                  <label className="field-label" htmlFor="projectDetail">業務内容・案件概要</label>
                  <textarea className="textarea-base" id="projectDetail" rows={3} placeholder="担当工程、チーム構成、開発環境などを入力してください" />
                </div>
              </div>
            </section>

            <section className="form-panel">
              <div className="panel-heading">
                <div><p className="panel-kicker">Candidate</p><h3>技術者スキルシート</h3></div>
              </div>
              <div className="panel-content form-stack">
                <div className="file-import">
                  <input type="file" id="skillSheetFile" accept=".pdf,application/pdf" hidden />
                  <div className="file-import-copy"><strong>PDFから内容を取り込む</strong><span>表やスキャン画像も解析できます（最大4MB）</span></div>
                  <label className="btn btn-secondary file-import-label" id="skillSheetFileLabel" htmlFor="skillSheetFile">PDFを選択</label>
                  <div className="file-import-status" id="skillSheetImportStatus" aria-live="polite">取り込み後に内容を確認・編集できます。</div>
                </div>
                <div>
                  <label className="field-label" htmlFor="skillSheet">スキルシート内容 <span className="req">必須</span><span className="field-label-note">直接入力も可能</span></label>
                  <textarea className="textarea-base skill-sheet-input" id="skillSheet" rows={9} placeholder={'氏名：山田 太郎\n経験年数：8年\n主なスキル：Java、Spring Boot、AWS、MySQL\n\n【職務経歴】\n2022〜2024年　大手製造業の在庫管理システム開発'} />
                  <div className="skill-sheet-actions">
                    <p className="field-hint" id="skillSheetSaveStatus" aria-live="polite">保存済みのスキルシートを読み込んでいます...</p>
                    <button className="btn btn-secondary" id="updateSkillSheetBtn" type="button">スキルシートを更新</button>
                  </div>
                </div>
              </div>
            </section>

            <section className="form-panel">
              <div className="panel-heading">
                <div><p className="panel-kicker">Interview design</p><h3>面談の構成</h3></div>
              </div>
              <div className="panel-content form-stack">
                <div className="interview-settings">
                  <div>
                    <label className="field-label" htmlFor="questionCount">主質問数</label>
                    <div className="number-input-wrap">
                      <input type="number" className="input-base" id="questionCount" min={1} max={20} step={1} defaultValue={7} inputMode="numeric" aria-describedby="questionCountHint" />
                      <span>問</span>
                    </div>
                    <p className="field-hint" id="questionCountHint">1〜20問から設定できます。</p>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="followUpIntensity">回答の深掘り</label>
                    <select className="select-base" id="followUpIntensity" defaultValue="standard" aria-describedby="followUpIntensityHint">
                      <option value="none">なし — 主質問をテンポよく進行</option>
                      <option value="standard">標準 — 必要に応じて1回</option>
                      <option value="deep">しっかり — 原則1〜2回</option>
                    </select>
                    <p className="field-hint" id="followUpIntensityHint">深掘りは主質問数に含みません。</p>
                  </div>
                </div>
                <div className="reverse-question-note">
                  <span className="note-rule" aria-hidden="true" />
                  <div><strong>自己紹介と逆質問は主質問数に含みません</strong><p>最初に自己紹介を伺い、最後は「もう質問はありません」と伝えるまで逆質問を継続します。</p></div>
                </div>
                <div>
                  <label className="field-label" htmlFor="interviewCustomization">希望する雰囲気や話し方 <span className="field-label-note">任意</span></label>
                  <textarea className="textarea-base" id="interviewCustomization" rows={4} maxLength={1000} aria-describedby="interviewCustomizationHint interviewCustomizationCounter" placeholder="例：緊張をほぐす柔らかい雰囲気で、回答を急かさず進めてください" />
                  <div className="field-hint-row">
                    <p className="field-hint" id="interviewCustomizationHint">口調や進行テンポに反映します。</p>
                    <span className="char-counter" id="interviewCustomizationCounter" aria-live="polite">0 / 1000</span>
                  </div>
                </div>
              </div>
            </section>
          </section>

          <div className="error-msg" id="errorMsg" role="alert" />

          <section className="interview-section" id="interview">
            <div className="section-heading interview-heading">
              <span className="section-index">03</span>
              <div><p className="eyebrow">Live interview</p><h2>面談を実施</h2><p>準備ができたら、マイクを使用して面談を始めます。</p></div>
            </div>

            <div className="interview-cockpit">
              <section className="control-panel">
                <div className="control-panel-top">
                  <div><p className="panel-kicker">Session control</p><h3>面談コントロール</h3></div>
                  <span className="timer" id="timer">00:00</span>
                </div>
                <div className="status-bar">
                  <div className="status-dot" id="statusDot" />
                  <div className="status-text" id="statusText">案件情報とスキルシートを入力してください</div>
                </div>
                <div className="q-counter" id="qCounter">
                  <span className="progress-label">質問進捗</span>
                  <div className="q-dots" id="qDots" />
                  <span className="progress-label" id="qLabel">— / 7問</span>
                </div>
                <div className="visualizer-wrap">
                  <span className="visualizer-label">Audio input</span>
                  <canvas id="visualizer" />
                </div>
                <div className="controls-row">
                  <button className="btn btn-primary" id="startBtn" type="button">面談を開始</button>
                  <button className="btn btn-primary" id="nextBtn" type="button" style={{ display: 'none' }} disabled>回答を送信して次へ</button>
                  <button className="btn btn-danger" id="endBtn" type="button" style={{ display: 'none' }}>面談を終了</button>
                </div>
                <p className="controls-hint">回答後に送信ボタンを押すと、次の質問へ進みます。</p>
              </section>

              <section className="transcript-panel">
                <div className="transcript-heading">
                  <div><p className="panel-kicker">Transcript</p><h3>会話ログ</h3></div>
                  <span className="live-label" id="liveLabel">Live</span>
                </div>
                <div className="transcript-box" id="transcriptBox">
                  <div className="placeholder" id="placeholder">
                    <span className="placeholder-mark" aria-hidden="true">“</span>
                    面談を開始すると、ここに会話が表示されます。<br />接続後「よろしくお願いします」と話しかけてください。
                  </div>
                </div>
              </section>
            </div>
          </section>

          <section className="review-panel" id="reviewPanel">
            <div className="review-panel-heading">
              <div><p className="eyebrow">Interview review</p><h2>商談総評レポート</h2></div>
              <span className="report-label">Report</span>
            </div>
            <div id="reviewContent" />
          </section>

          <footer><span>エンジニア向けAI面談練習ツール</span><span>Powered by Gemini Live API</span></footer>
        </main>
      </div>
    </div>
  );
}
