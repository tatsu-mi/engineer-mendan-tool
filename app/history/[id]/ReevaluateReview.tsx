'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MediaFeedback } from '../../../lib/media-review';

type Review = {
  overall: string;
  scores: Record<string, number>;
  technical: string;
  communication: string;
  attitude: string;
  feedback: string;
  media_feedback?: MediaFeedback;
};

export default function ReevaluateReview({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Review | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const pending = busy || saving || refreshing;

  async function reevaluate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage('会話ログから総評を再評価しています…');
    setError('');
    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': apiKey.trim() },
        body: JSON.stringify({ interviewId, reevaluate: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '再評価に失敗しました。');
      setApiKey('');
      setDraft(data.review);
      setMessage('再評価結果を表示しています。保存するまでは保存済みの総評は更新されません。');
    } catch (error) {
      setMessage('');
      setError(error instanceof Error ? error.message : '再評価に失敗しました。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function save() {
    if (submitting.current || pending || !draft) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    setMessage('総評を保存しています…');
    try {
      const response = await fetch('/api/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId, review: draft })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '総評を保存できませんでした。');
      setDraft(null);
      setMessage('総評を保存しました。');
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage('');
      setError(error instanceof Error ? error.message : '総評を保存できませんでした。');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="detail-reevaluate" onSubmit={reevaluate} aria-busy={pending}>
      <p>保存済みの会話ログを現在の採点基準で再評価します。結果を確認して「保存」を押すと、総評を上書きします。音声・動画は再解析せず、既存の助言を保持します。</p>
      <div className="detail-reevaluate-controls">
        <label htmlFor="reviewApiKey">Gemini APIキー</label>
        <input id="reviewApiKey" className="input-base" type="password" autoComplete="off" required
          value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={pending} />
        <button className="btn btn-primary" type="submit" disabled={pending || !apiKey.trim()}>
          {busy ? '再評価中…' : '会話ログから再評価'}
        </button>
      </div>
      <p>API利用料が発生します。APIキーは保存しません。</p>
      <p role="status">{message}</p>
      {error && <p role="alert">{error}</p>}
      {draft && <section aria-label="再評価結果（未保存）">
        <h3>再評価結果（未保存）</h3>
        <div className="detail-review">
          <div className="detail-overall">
            <span>総合評価</span>
            <strong>{draft.overall}</strong>
            <small>総合スコア {draft.scores['総合']} / 5</small>
          </div>
          <div className="detail-scores">
            {['技術力', 'コミュニケーション', '姿勢・意欲'].map(label => (
              <div className="detail-score" key={label}><span>{label}</span><strong>{draft.scores[label]}<small> / 5</small></strong></div>
            ))}
          </div>
          <div className="detail-review-grid">
            <div><h3>技術力</h3><p>{draft.technical}</p></div>
            <div><h3>コミュニケーション</h3><p>{draft.communication}</p></div>
            <div><h3>姿勢・意欲</h3><p>{draft.attitude}</p></div>
            {draft.media_feedback && <>
              <div><h3>身振り・表情</h3><p>{draft.media_feedback.visual}</p></div>
              <div><h3>声のトーン・話し方</h3><p>{draft.media_feedback.vocal}</p></div>
              <div className="detail-feedback"><h3>解析対象</h3><p>{draft.media_feedback.coverage}</p></div>
            </>}
            <div className="detail-feedback"><h3>改善アドバイス</h3><p>{draft.feedback}</p></div>
          </div>
        </div>
        <div className="detail-reevaluate-controls">
          <button className="btn btn-primary" type="button" onClick={save} disabled={pending}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button className="btn" type="button" disabled={pending} onClick={() => { setDraft(null); setMessage('再評価結果を破棄しました。'); setError(''); }}>
            破棄
          </button>
        </div>
      </section>}
    </form>
  );
}
