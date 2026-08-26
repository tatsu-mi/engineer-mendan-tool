'use client';

import { useEffect } from 'react';

const Icon = ({ children }: { children: React.ReactNode }) => (
  <span className="card-header-icon" aria-hidden="true">{children}</span>
);

export default function InterviewApp() {
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    import('../interview-client').then(module => {
      if (active) cleanup = module.initializeInterviewApp();
    });

    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  return (
    <>
      <header className="app-header">
        <div className="header-logo">
          <div className="header-title">面談練習ツール</div>
        </div>
      </header>

      <main className="container">
        <div className="step-label">
          <div className="step-num">1</div>
          <div className="step-title">APIキー設定</div>
        </div>
        <section className="card">
          <div className="card-header">
            <Icon>🔑</Icon>
            <span className="card-title">Google AI Studio APIキー</span>
          </div>
          <div className="card-body">
            <div className="apikey-row">
              <input
                type="password"
                className="input-base"
                id="apiKeyInput"
                placeholder="AIzaSy..."
                autoComplete="off"
              />
              <button className="btn btn-secondary" id="saveApiKeyBtn" type="button">SET</button>
            </div>
            <p className="field-hint">APIキーはブラウザに保存せず、各処理時にバックエンドへ安全に渡します。</p>
          </div>
        </section>

        <div className="step-label">
          <div className="step-num">2</div>
          <div className="step-title">面談情報の設定</div>
        </div>

        <section className="card">
          <div className="card-header">
            <Icon>💼</Icon>
            <span className="card-title">案件情報</span>
            <span className="card-badge required">必須</span>
          </div>
          <div className="card-body form-stack">
            <div className="two-col">
              <div>
                <label className="field-label" htmlFor="projectName">
                  案件名・プロジェクト名 <span className="req">*</span>
                </label>
                <input
                  type="text"
                  className="input-base"
                  id="projectName"
                  placeholder="例）大手流通EC基幹システム刷新PJ"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="interviewerRole">面接官ロール</label>
                <input
                  type="text"
                  className="input-base"
                  id="interviewerRole"
                  placeholder="例）プロジェクトリーダー（PL）"
                  defaultValue="プロジェクトリーダー（PL）"
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="requiredSkills">
                必須スキル・技術要件 <span className="req">*</span>
              </label>
              <textarea
                className="textarea-base"
                id="requiredSkills"
                rows={3}
                placeholder="例）Java（Spring Boot）5年以上、AWS（EC2/RDS/S3）、MySQL、チームリード経験歓迎"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="projectDetail">業務内容・案件概要</label>
              <textarea
                className="textarea-base"
                id="projectDetail"
                rows={3}
                placeholder="例）大手流通企業のEC基幹システム刷新。Spring Bootによるマイクロサービス化、AWSへのインフラ移行。"
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <Icon>📄</Icon>
            <span className="card-title">技術者スキルシート</span>
            <span className="card-badge required">必須</span>
          </div>
          <div className="card-body form-stack">
            <div className="file-import">
              <div className="file-import-row">
                <input
                  type="file"
                  id="skillSheetFile"
                  accept=".pdf,application/pdf"
                  hidden
                />
                <label
                  className="btn btn-secondary file-import-label"
                  id="skillSheetFileLabel"
                  htmlFor="skillSheetFile"
                >
                  PDFを読み込む
                </label>
                <span className="file-limit">対応形式：.pdf（最大4MB）</span>
              </div>
              <div className="file-import-status" id="skillSheetImportStatus" aria-live="polite">
                PDFはバックエンドで解析し、下のテキスト欄へ反映します。面談前に内容を編集できます。
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="skillSheet">
                スキルシート内容 <span className="req">*</span>
                <span className="field-label-note">（取込後の修正・手入力も可能）</span>
              </label>
              <textarea
                className="textarea-base"
                id="skillSheet"
                rows={8}
                placeholder={'氏名：山田 太郎\n経験年数：8年\n主なスキル：Java、Spring Boot、AWS、MySQL\n\n【職務経歴】\n2022〜2024年　大手製造業の在庫管理システム開発'}
              />
              <p className="field-hint">
                PDFは表やスキャン画像を含めてAIがテキスト化します。内容を確認・修正してから面談を開始してください。
              </p>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <Icon>💡</Icon>
            <span className="card-title">面談構成・スタイル</span>
          </div>
          <div className="card-body form-stack">
            <div className="interview-settings">
              <div>
                <label className="field-label" htmlFor="questionCount">主質問数</label>
                <div className="number-input-wrap">
                  <input
                    type="number"
                    className="input-base"
                    id="questionCount"
                    min={1}
                    max={20}
                    step={1}
                    defaultValue={7}
                    inputMode="numeric"
                    aria-describedby="questionCountHint"
                  />
                  <span>問</span>
                </div>
                <p className="field-hint" id="questionCountHint">
                  1〜20問。AIが案件・経歴に合わせて全体をバランスよく構成します。
                </p>
              </div>
              <div>
                <label className="field-label" htmlFor="followUpIntensity">回答の深掘り強度</label>
                <select
                  className="select-base"
                  id="followUpIntensity"
                  defaultValue="standard"
                  aria-describedby="followUpIntensityHint"
                >
                  <option value="none">なし — 主質問をテンポよく進行</option>
                  <option value="standard">標準 — 必要に応じて1回</option>
                  <option value="deep">しっかり — 原則1〜2回</option>
                </select>
                <p className="field-hint" id="followUpIntensityHint">
                  深掘りは主質問数に含みません。「しっかり」ほど面談時間が長くなります。
                </p>
              </div>
            </div>
            <div className="reverse-question-note">
              <span aria-hidden="true">↩</span>
              最後に必ず逆質問の時間を設けます。候補者が「もう質問はありません」と伝えるまで継続します。
            </div>
            <div>
              <label className="field-label" htmlFor="interviewCustomization">
                この面談で希望する雰囲気や話し方
                <span className="field-label-note">（任意）</span>
              </label>
              <textarea
                className="textarea-base"
                id="interviewCustomization"
                rows={4}
                maxLength={1000}
                aria-describedby="interviewCustomizationHint interviewCustomizationCounter"
                placeholder="例）緊張をほぐすような柔らかい雰囲気で、回答を急かさず、相づちを少し多めにしてください。"
              />
              <div className="field-hint-row">
                <p className="field-hint" id="interviewCustomizationHint">
                  口調・雰囲気・進行テンポなどの補助設定として適用します。
                </p>
                <span className="char-counter" id="interviewCustomizationCounter" aria-live="polite">
                  0 / 1000
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="error-msg" id="errorMsg" role="alert" />

        <div className="step-label">
          <div className="step-num">3</div>
          <div className="step-title">面談実施</div>
        </div>

        <section className="card">
          <div className="card-header">
            <Icon>🎙️</Icon>
            <span className="card-title">面談コントロール</span>
            <span className="timer" id="timer">00:00</span>
          </div>
          <div className="card-body form-stack">
            <div className="status-bar">
              <div className="status-dot" id="statusDot" />
              <div className="status-text" id="statusText">
                案件情報とスキルシートを入力して「面談開始」を押してください
              </div>
            </div>

            <div className="q-counter" id="qCounter">
              <span className="progress-label">質問進捗</span>
              <div className="q-dots" id="qDots" />
              <span className="progress-label" id="qLabel">— / 7問</span>
            </div>

            <div className="visualizer-wrap">
              <canvas id="visualizer" />
            </div>

            <div className="controls-row">
              <button className="btn btn-primary" id="startBtn" type="button">▶ 面談開始</button>
              <button
                className="btn btn-primary"
                id="nextBtn"
                type="button"
                style={{ display: 'none' }}
                disabled
              >
                回答を送信して次へ ▶
              </button>
              <button
                className="btn btn-danger"
                id="endBtn"
                type="button"
                style={{ display: 'none' }}
              >
                ■ 面談終了
              </button>
              <div className="controls-hint">
                回答後に「回答を送信して次へ」を押してください<br />
                「面談終了」ボタンで途中終了
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <Icon>💬</Icon>
            <span className="card-title">会話ログ</span>
          </div>
          <div className="transcript-box" id="transcriptBox">
            <div className="placeholder" id="placeholder">
              面談を開始すると、ここに会話が表示されます。<br />
              接続後「よろしくお願いします」と話しかけてください。
            </div>
          </div>
        </section>

        <section className="card review-panel" id="reviewPanel">
          <div className="card-header">
            <Icon>📋</Icon>
            <span className="card-title">商談総評レポート</span>
          </div>
          <div id="reviewContent" />
        </section>

        <footer>
          面談練習ツール — © Beeline
        </footer>
      </main>
    </>
  );
}
