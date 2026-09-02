# データベースER図

面談時点の入力・生成結果を後から再現できるよう、案件情報、面談構成、質問、会話ログ、総評は面談ごとに保存する。
ログインユーザーのスキルシートは常に1件を更新し、面談開始時の入力内容を面談ごとのスナップショットとして保存する。

```mermaid
erDiagram
    MEMBERS ||--o{ INTERVIEWS : "実施する"
    MEMBERS ||--o| SKILL_SHEETS : "現在の内容を所有する"
    SKILL_SHEETS ||--o{ INTERVIEW_SKILL_SHEETS : "コピー元になる"
    INTERVIEWS ||--|| INTERVIEW_SKILL_SHEETS : "面談時点の内容を持つ"
    INTERVIEWS ||--|| INTERVIEW_PROJECTS : "案件情報を持つ"
    INTERVIEWS ||--|| INTERVIEW_CONFIGURATIONS : "構成を持つ"
    INTERVIEWS ||--o{ INTERVIEW_QUESTIONS : "質問を持つ"
    INTERVIEW_QUESTIONS o|--o{ INTERVIEW_QUESTIONS : "深掘り元になる"
    INTERVIEWS ||--o{ CONVERSATION_LOGS : "会話を記録する"
    INTERVIEW_QUESTIONS o|--o{ CONVERSATION_LOGS : "関連する"
    INTERVIEWS ||--o| INTERVIEW_REVIEWS : "総評を持つ"

    ADMINISTRATOR_ACCOUNTS {
        uuid id PK "管理者ID"
        varchar email UK "管理者メールアドレス（小文字）"
        varchar display_name "表示名"
        boolean is_active "利用可否"
        timestamptz created_at "作成日時"
        timestamptz updated_at "更新日時"
    }

    MEMBERS {
        uuid id PK "メンバーID"
        varchar email UK "Entraメールアドレス（小文字）"
        varchar display_name "表示名"
        boolean is_active "利用可否"
        timestamptz created_at "作成日時"
        timestamptz updated_at "更新日時"
    }

    SKILL_SHEETS {
        uuid id PK "スキルシートID"
        uuid member_id FK,UK "所有メンバーID"
        text content "現在の本文"
        varchar original_file_name "現在の元PDF名（任意）"
        varchar original_file_storage_key "現在の元PDF保存先（任意）"
        timestamptz created_at "作成日時"
        timestamptz updated_at "更新日時"
    }

    INTERVIEWS {
        uuid id PK "面談ID"
        uuid member_id FK "面談を実施したメンバーID"
        varchar status "準備中・実施中・完了・中断"
        timestamptz started_at "開始日時"
        timestamptz ended_at "終了日時"
        integer duration_seconds "実施時間（秒）"
        timestamptz created_at "作成日時"
        timestamptz updated_at "更新日時"
    }

    INTERVIEW_SKILL_SHEETS {
        uuid id PK "面談時スキルシートID"
        uuid interview_id FK,UK "面談ID"
        uuid source_skill_sheet_id FK "コピー元ID"
        text content "面談時点の本文"
        varchar original_file_name "面談時点の元PDF名（任意）"
        varchar original_file_storage_key "面談時点の元PDF保存先（任意）"
        timestamptz created_at "保存日時"
    }

    INTERVIEW_PROJECTS {
        uuid id PK "案件情報ID"
        uuid interview_id FK,UK "面談ID"
        varchar project_name "案件名"
        varchar interviewer_role "面接官の役割"
        text required_skills "必須スキル・技術要件"
        text project_details "業務内容・案件概要"
        timestamptz created_at "作成日時"
        timestamptz updated_at "更新日時"
    }

    INTERVIEW_CONFIGURATIONS {
        uuid id PK "面談構成ID"
        uuid interview_id FK,UK "面談ID"
        integer main_question_count "主質問数（1〜20）"
        varchar follow_up_intensity "none・standard・deep"
        boolean includes_reverse_questions "逆質問の有無"
        text customization "希望する雰囲気・話し方"
        varchar live_model "使用したLiveモデル"
        varchar text_model "質問・総評生成モデル"
        timestamptz created_at "作成日時"
        timestamptz updated_at "更新日時"
    }

    INTERVIEW_QUESTIONS {
        uuid id PK "質問ID"
        uuid interview_id FK "面談ID"
        uuid parent_question_id FK "元の主質問ID（任意）"
        integer sequence_number "全質問を通した順番"
        integer main_question_number "主質問番号（任意）"
        varchar question_type "main・follow_up・reverse"
        text question_text "確定・生成された質問文"
        timestamptz created_at "作成日時"
    }

    CONVERSATION_LOGS {
        uuid id PK "会話ログID"
        uuid interview_id FK "面談ID"
        uuid interview_question_id FK "関連質問ID（任意）"
        integer sequence_number "発言順"
        varchar speaker_role "interviewer・candidate"
        text raw_text "補正前テキスト（任意）"
        text text "画面表示・評価用テキスト"
        timestamptz spoken_at "発言日時（任意）"
        timestamptz created_at "作成日時"
    }

    INTERVIEW_REVIEWS {
        uuid id PK "総評ID"
        uuid interview_id FK,UK "面談ID"
        varchar overall "◎・○・△・×"
        smallint technical_score "技術力（1〜5）"
        smallint communication_score "コミュニケーション（1〜5）"
        smallint overall_score "総合（1〜5）"
        text technical "技術力・経験の適合性"
        text communication "コミュニケーション能力"
        text attitude "姿勢・意欲"
        text feedback "技術者へのフィードバック"
        timestamptz created_at "作成日時"
        timestamptz updated_at "更新日時"
    }
```

## 制約・運用ルール

- `members.email` は小文字へ正規化し、一意制約を設定する。同一Entraテナントのログインユーザーは初回利用時にここへ自動登録する。無効化されたメンバーはAPIを利用できない。
- `administrator_accounts` は管理者専用の独立テーブルとし、アプリケーションから自動登録・更新しない。管理者レコードは運用担当者が手動で追加する。
- `skill_sheets.member_id` に一意制約を設定し、メンバーごとに現在のスキルシートを最大1件だけ保持する。「スキルシートを更新」の操作で同じレコードを上書きする。
- 案件、構成、質問、会話ログ、総評は `interviews.member_id` と各 `interview_id` を通して所有メンバーへ紐づけ、重複する `member_id` は持たせない。
- 面談開始時の入力内容を `interview_skill_sheets` へコピーする。現在のスキルシートが未保存なら、同一トランザクション内で先に `skill_sheets` へ保存してからコピーする。保存済みシートを編集したまま開始した場合、現在のシートは上書きせず、編集内容だけをその面談のスナップショットとして保存する。
- 面談ごとのスナップショットを残すため、`interview_projects` と `interview_configurations` はマスタ化せず、`interview_id` に一意制約を設定する。
- `interview_questions` と `conversation_logs` は、それぞれ `(interview_id, sequence_number)` に一意制約を設定して発生順を保証する。深掘り質問は `parent_question_id` で元の主質問に関連付ける。
- `interview_reviews` は総評生成が完了するまでは存在しない。再生成時は同じレコードを更新する。生成履歴も必要なら、`interview_id` の一意制約を外して `revision_number` を追加する。
- メールアドレスは認証照合に使うため、暗号化よりもアクセス制御、監査ログ、最小権限を優先する。スキルシートと会話ログは個人情報として保存期間と削除方針を定める。

## 想定インデックス

- `administrator_accounts (email)` unique（手動登録用）
- `members (email)` unique
- `skill_sheets (member_id)` unique
- `interview_skill_sheets (interview_id)` unique
- `interviews (member_id, started_at desc)`
- `conversation_logs (interview_id, sequence_number)` unique
- `interview_questions (interview_id, sequence_number)` unique
- `interview_questions (interview_id, main_question_number)` partial unique（`question_type = 'main'`）
