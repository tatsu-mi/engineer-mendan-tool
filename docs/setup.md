# 環境構築・デプロイ

[使い方](../README.md)

## ローカル起動

```bash
npm install
npm run dev
```

開発サーバーはWebpackで起動します。Turbopackで `Next.js package not found` のpanicが発生する環境への回避策です。起動済みのサーバーには反映されないため、変更後は停止して `npm run dev` で起動し直してください。

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
2. [マイグレーション](../supabase/migrations/)をファイル名順にSQL Editorで実行する（Supabase CLIを利用する場合は `supabase db push`）。既存環境にも `20261021000000_add_attitude_score.sql` を適用してください。過去の総評の姿勢・意欲は「未採点」と表示します。
3. 音声・映像の評価には `20261021020000_add_media_feedback.sql` も適用する（履歴取得にも必要です）
4. 途中再開には `20261021010000_resume_interviews.sql` も適用する

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
