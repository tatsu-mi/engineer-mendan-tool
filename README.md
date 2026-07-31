# The面談forSES

Gemini Live APIを利用したSES技術者向けAI面談ツールです。Next.js App Routerで構成し、Vercelへそのままデプロイできます。

## 構成

- フロントエンド: React Client Componentによる面談画面、マイク入力、音声再生、「次へ」のターン制御
- バックエンド: Live API用の短命トークン発行、PDF解析、総評レポート生成
- APIキー: 画面で入力し、必要なリクエストごとにRoute Handlerへ送信（サーバーやブラウザには永続保存しません）

Excel取込には対応していません。PDFはVercel Functionsのペイロード制限を考慮し、4MBまでです。

従来の単一HTML/JavaScriptファイルには依存していません。画面は `app/components/InterviewApp.tsx`、スタイルは `app/globals.css`、ブラウザ処理は `app/interview-client.ts` に分離しています。

## ローカル起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。音声入力にはブラウザのマイク権限が必要です。

## Vercel

このリポジトリをVercelへImportしてデプロイしてください。環境変数は不要です。APIキーは画面から入力します。

```bash
npm run build
```

を通過する状態であれば、VercelがNext.jsとして自動検出します。
