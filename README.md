# engineer-mendan-tool（面談練習ツール）

Gemini Live APIを利用したSES技術者向けAI面談ツールです。Next.js App Routerで構成し、Vercelへそのままデプロイできます。

## 構成

- フロントエンド: React Client Componentによる面談画面、マイク入力、音声再生、「次へ」のターン制御
- 面談構成: 主質問数（1〜20問）と深掘り強度を指定し、開始前に案件・スキルシートから全主質問を確定して1問ずつ進行
- 案件自動生成: スキルシートを入力またはPDFから取り込み、マッチ度を「高・中・低」から選んで練習用の架空案件を生成。高は経験に合う案件、中は一部に挑戦が必要な案件、低は未経験の要件が多い案件を目安とし、生成後の案件情報は編集可能
- 面談開始: AI担当者が案件を説明してから自己紹介を依頼。自己紹介後は案件に関連する質問を1問返し、回答後に主質問へ進行（自己紹介と関連質問は主質問数に含めない）
- 評価: スキルシートは評価に使わず、会話で確認できた内容だけを根拠に総評を生成
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

## 管理者向け利用分析

管理者でログインすると、メニューまたはヘッダーの「利用分析」から `/analytics` を開けます。今月・先月・直近30日・任意期間で、メンバー別の開始／完了／中断回数、終了未確認件数、完了率、合計／平均面談時間、利用日数を集計します。最終面談日時とリンク先の履歴は全期間が対象です。

「管理者を除外する」を選んで集計すると、`administrator_accounts` に登録されたメンバー（利用停止中の管理者を含む）を一覧と上部の集計から除外します。対象は `members.is_active = true` の登録済みメンバーで、期間内に未利用のメンバーも表示します。初回ログイン前の社員は含みません。

日付は日本時間の面談開始日を基準とし、準備中は開始回数に含めません。合計・平均時間は完了または中断し、時間が保存されている面談のみが対象です。追加のDBマイグレーションは不要です。

利用状況一覧は各データ列の見出しをクリックすると昇順・降順を切り替えられます。期間と管理者除外の条件は維持されます。未記録の時間と算出できない完了率は常に末尾、最終面談日時の「利用なし」は昇順で先頭に表示します。
