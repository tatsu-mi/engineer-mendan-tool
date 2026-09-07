# 面談練習ツール

Gemini Live APIを利用したSES技術者向けAI面談ツールです。Next.js App Routerで構成し、Vercelへそのままデプロイできます。

## 構成

- フロントエンド: React Client Componentによる面談画面、マイク入力、音声再生、「次へ」のターン制御
- 面談構成: 主質問数（1〜20問）と深掘り強度を指定し、開始前に案件・スキルシートから全主質問を確定して1問ずつ進行
- 案件自動生成: スキルシートを入力またはPDFから取り込み、マッチ度を「高・中・低」から選んで練習用の架空案件を生成。高は経験に合う案件、中は一部に挑戦が必要な案件、低は未経験の要件が多い案件を目安とし、生成後の案件情報は編集可能
- 自己紹介: 面談の最初に必ず実施し、主質問数には含めずに進行
- 逆質問: 主質問とは別に必ず実施し、候補者が質問終了を明示するまで「他にはいかがですか？」と継続
- バックエンド: Live API用の短命トークン発行、PDF解析、総評レポート生成
- 認証: Microsoft Entra IDによる社員ログイン。未認証時は面談画面と各APIを利用できません
- DB: Supabase Postgresへログインユーザーの現在のスキルシート、面談時スナップショット、案件、構成、質問、会話ログ、総評を保存
- APIキー: 画面で入力し、必要なリクエストごとにRoute Handlerへ送信（サーバーやブラウザには永続保存しません）

Excel取込には対応していません。PDFはVercel Functionsのペイロード制限を考慮し、4MBまでです。

従来の単一HTML/JavaScriptファイルには依存していません。画面は `app/components/InterviewApp.tsx`、スタイルは `app/globals.css`、ブラウザ処理は `app/interview-client.ts` に分離しています。

## ローカル起動

```bash
npm install
npm run dev
```

`.env.example` を `.env.local` へコピーし、Entra IDとSupabaseの値を設定してください。

```bash
openssl rand -base64 32
```

で生成した値を `AUTH_SECRET` に設定します。ブラウザで `http://localhost:3000` を開きます。音声入力にはブラウザのマイク権限が必要です。

## Microsoft Entra ID

Entra管理センターの「アプリの登録」で、このアプリ用のシングルテナントアプリを登録します。

1. サポートされているアカウントの種類は「この組織ディレクトリのみに含まれるアカウント」を選択
2. プラットフォーム「Web」にリダイレクトURIを登録
   - ローカル: `http://localhost:3000/api/auth/callback/microsoft-entra-id`
   - 本番: `https://<本番ドメイン>/api/auth/callback/microsoft-entra-id`
3. クライアントシークレットを作成
4. `.env.example` に記載したEntra ID用の4つの環境変数を設定

ログインユーザーの識別には、Entra IDが返す `email` を小文字に正規化して使用します。`email` がない場合は、メール形式の `preferred_username` を使用します。どちらも取得できないアカウント、または設定したEntraテナントと異なるアカウントはログインできません。初回利用時に `members` へ自動登録され、スキルシートや面談データはそのメンバーに紐づきます。

## Supabase

1. Supabaseプロジェクトを作成する
2. [マイグレーション](./supabase/migrations/20260828000000_create_interview_schema.sql)をSQL Editorで実行する（Supabase CLIを利用する場合は `supabase db push`）
3. 既存データベースには追加マイグレーションも適用する

ログインユーザーは `members` に自動登録されます。`administrator_accounts` にはアプリケーションから一切追加しません。管理者を登録する場合だけ、運用担当者がSQL Editorで次を手動実行します。

```sql
insert into public.administrator_accounts (email, display_name)
values ('admin@example.com', '管理者名');
```

メールアドレスはEntra IDのメールと同じ値を小文字で登録してください。`administrator_accounts` のレコード自体が管理者を表し、`is_active` は管理者アカウントの利用可否を表します。管理者は0人でも構いません。

`.env.local` にはProject URLとSecret keyを設定します。Secret keyが発行されていない旧プロジェクトでは、`SUPABASE_SERVICE_ROLE_KEY`も利用できます。どちらのキーもRLSを迂回するため、ブラウザへ公開せずサーバー環境変数としてのみ管理してください。

```env
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SECRET_KEY="sb_secret_..."
```

## Vercel

このリポジトリをVercelへImportしてデプロイし、`.env.example` の6項目をVercelの環境変数に登録してください。Google AI Studio APIキーは従来どおり画面から入力します。

```bash
npm run build
```

を通過する状態であれば、VercelがNext.jsとして自動検出します。
