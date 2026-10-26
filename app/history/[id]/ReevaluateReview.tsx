'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function ReevaluateReview({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const pending = busy || refreshing;

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
      setMessage('総評を更新しました。');
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage('');
      setError(error instanceof Error ? error.message : '再評価に失敗しました。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="detail-reevaluate" onSubmit={reevaluate} aria-busy={pending}>
      <p>保存済みの会話ログを現在の採点基準で再評価し、総評を上書きします。音声・動画は再解析せず、既存の助言を保持します。</p>
      <div className="detail-reevaluate-controls">
        <label htmlFor="reviewApiKey">Gemini APIキー</label>
        <input id="reviewApiKey" className="input-base" type="password" autoComplete="off" required
          value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={pending} />
        <button className="btn btn-primary" type="submit" disabled={pending || !apiKey.trim()}>
          {pending ? '再評価中…' : '会話ログから再評価'}
        </button>
      </div>
      <p>API利用料が発生します。APIキーは保存しません。</p>
      <p role="status">{message}</p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
