create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.administrator_accounts (
  id uuid primary key default gen_random_uuid(),
  email varchar(320) not null unique,
  display_name varchar(200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint administrator_accounts_email_normalized
    check (email = lower(btrim(email)) and position('@' in email) > 1)
);

comment on table public.administrator_accounts is
  '運用担当者が手動で登録する管理者アカウント。ログイン時には自動追加しない。';

create table public.members (
  id uuid primary key default gen_random_uuid(),
  email varchar(320) not null unique,
  display_name varchar(200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint members_email_normalized
    check (email = lower(btrim(email)) and position('@' in email) > 1)
);

comment on table public.members is
  'ログインユーザーを初回利用時に自動登録するメンバーマスタ。';

create table public.skill_sheets (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members(id) on delete cascade,
  content text not null,
  original_file_name varchar(500),
  original_file_storage_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skill_sheets_content_not_blank check (length(btrim(content)) > 0)
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  status varchar(20) not null default 'in_progress',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interviews_status_check
    check (status in ('preparing', 'in_progress', 'completed', 'interrupted')),
  constraint interviews_duration_check
    check (duration_seconds is null or duration_seconds >= 0)
);

create table public.interview_skill_sheets (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.interviews(id) on delete cascade,
  source_skill_sheet_id uuid not null references public.skill_sheets(id) on delete restrict,
  content text not null,
  original_file_name varchar(500),
  original_file_storage_key text,
  created_at timestamptz not null default now(),
  constraint interview_skill_sheets_content_not_blank check (length(btrim(content)) > 0)
);

create table public.interview_projects (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.interviews(id) on delete cascade,
  project_name varchar(1000) not null,
  interviewer_role varchar(1000),
  required_skills text not null,
  project_details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_projects_name_not_blank check (length(btrim(project_name)) > 0),
  constraint interview_projects_skills_not_blank check (length(btrim(required_skills)) > 0)
);

create table public.interview_configurations (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.interviews(id) on delete cascade,
  main_question_count integer not null,
  follow_up_intensity varchar(20) not null,
  includes_reverse_questions boolean not null default true,
  customization text,
  live_model varchar(200) not null,
  text_model varchar(200) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_configurations_question_count_check
    check (main_question_count between 1 and 20),
  constraint interview_configurations_follow_up_check
    check (follow_up_intensity in ('none', 'standard', 'deep'))
);

create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  parent_question_id uuid references public.interview_questions(id) on delete set null,
  sequence_number integer not null,
  main_question_number integer,
  question_type varchar(20) not null,
  question_text text not null,
  created_at timestamptz not null default now(),
  constraint interview_questions_sequence_positive check (sequence_number > 0),
  constraint interview_questions_main_number_positive
    check (main_question_number is null or main_question_number > 0),
  constraint interview_questions_type_check
    check (question_type in ('main', 'follow_up', 'reverse')),
  constraint interview_questions_text_not_blank check (length(btrim(question_text)) > 0),
  unique (interview_id, sequence_number)
);

create unique index interview_questions_main_number_unique
  on public.interview_questions (interview_id, main_question_number)
  where question_type = 'main';

create table public.conversation_logs (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  interview_question_id uuid references public.interview_questions(id) on delete set null,
  sequence_number integer not null,
  speaker_role varchar(20) not null,
  raw_text text,
  text text not null,
  spoken_at timestamptz,
  created_at timestamptz not null default now(),
  constraint conversation_logs_sequence_positive check (sequence_number > 0),
  constraint conversation_logs_role_check
    check (speaker_role in ('interviewer', 'candidate')),
  constraint conversation_logs_text_not_blank check (length(btrim(text)) > 0),
  unique (interview_id, sequence_number)
);

create table public.interview_reviews (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.interviews(id) on delete cascade,
  overall varchar(1) not null,
  technical_score smallint not null,
  communication_score smallint not null,
  overall_score smallint not null,
  technical text not null,
  communication text not null,
  attitude text not null,
  feedback text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_reviews_overall_check check (overall in ('◎', '○', '△', '×')),
  constraint interview_reviews_technical_score_check check (technical_score between 1 and 5),
  constraint interview_reviews_communication_score_check check (communication_score between 1 and 5),
  constraint interview_reviews_overall_score_check check (overall_score between 1 and 5)
);

create index interviews_member_started_at_idx
  on public.interviews (member_id, started_at desc);
create index conversation_logs_interview_sequence_idx
  on public.conversation_logs (interview_id, sequence_number);

create trigger administrator_accounts_set_updated_at
before update on public.administrator_accounts
for each row execute function public.set_updated_at();
create trigger members_set_updated_at
before update on public.members
for each row execute function public.set_updated_at();
create trigger skill_sheets_set_updated_at
before update on public.skill_sheets
for each row execute function public.set_updated_at();
create trigger interviews_set_updated_at
before update on public.interviews
for each row execute function public.set_updated_at();
create trigger interview_projects_set_updated_at
before update on public.interview_projects
for each row execute function public.set_updated_at();
create trigger interview_configurations_set_updated_at
before update on public.interview_configurations
for each row execute function public.set_updated_at();
create trigger interview_reviews_set_updated_at
before update on public.interview_reviews
for each row execute function public.set_updated_at();

create or replace function public.start_interview(
  p_member_id uuid,
  p_skill_sheet_content text,
  p_original_file_name text,
  p_project jsonb,
  p_configuration jsonb,
  p_questions jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_skill_sheet_id uuid;
  v_interview_id uuid;
  v_skill_sheet_auto_saved boolean := false;
begin
  if not exists (
    select 1 from public.members where id = p_member_id and is_active = true
  ) then
    raise exception 'member_not_available';
  end if;

  select id into v_skill_sheet_id
  from public.skill_sheets
  where member_id = p_member_id;

  -- 初回面談では、未保存の入力を現在のスキルシートとして保存してからコピーする。
  if v_skill_sheet_id is null then
    insert into public.skill_sheets (
      member_id, content, original_file_name
    ) values (
      p_member_id,
      btrim(p_skill_sheet_content),
      nullif(btrim(p_original_file_name), '')
    )
    on conflict (member_id) do nothing
    returning id into v_skill_sheet_id;

    if v_skill_sheet_id is null then
      select id into v_skill_sheet_id
      from public.skill_sheets
      where member_id = p_member_id;
    else
      v_skill_sheet_auto_saved := true;
    end if;
  end if;

  insert into public.interviews (
    member_id, status
  ) values (
    p_member_id, 'in_progress'
  )
  returning id into v_interview_id;

  insert into public.interview_skill_sheets (
    interview_id, source_skill_sheet_id, content, original_file_name
  ) values (
    v_interview_id,
    v_skill_sheet_id,
    btrim(p_skill_sheet_content),
    nullif(btrim(p_original_file_name), '')
  );

  insert into public.interview_projects (
    interview_id, project_name, interviewer_role, required_skills, project_details
  ) values (
    v_interview_id,
    p_project ->> 'projectName',
    nullif(p_project ->> 'interviewerRole', ''),
    p_project ->> 'requiredSkills',
    nullif(p_project ->> 'projectDetails', '')
  );

  insert into public.interview_configurations (
    interview_id,
    main_question_count,
    follow_up_intensity,
    includes_reverse_questions,
    customization,
    live_model,
    text_model
  ) values (
    v_interview_id,
    (p_configuration ->> 'mainQuestionCount')::integer,
    p_configuration ->> 'followUpIntensity',
    coalesce((p_configuration ->> 'includesReverseQuestions')::boolean, true),
    nullif(p_configuration ->> 'customization', ''),
    p_configuration ->> 'liveModel',
    p_configuration ->> 'textModel'
  );

  insert into public.interview_questions (
    interview_id, sequence_number, main_question_number, question_type, question_text
  )
  select v_interview_id, q.ordinality::integer, q.ordinality::integer, 'main', q.value
  from jsonb_array_elements_text(p_questions) with ordinality as q(value, ordinality);

  return jsonb_build_object(
    'interviewId', v_interview_id,
    'skillSheetAutoSaved', v_skill_sheet_auto_saved
  );
end;
$$;

create or replace function public.complete_interview(
  p_member_id uuid,
  p_interview_id uuid,
  p_duration_seconds integer,
  p_logs jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.interviews i
    join public.members m on m.id = i.member_id and m.is_active = true
    where i.id = p_interview_id and i.member_id = p_member_id
  ) then
    raise exception 'interview_not_found';
  end if;

  delete from public.conversation_logs where interview_id = p_interview_id;

  insert into public.conversation_logs (
    interview_id,
    interview_question_id,
    sequence_number,
    speaker_role,
    raw_text,
    text,
    spoken_at
  )
  select
    p_interview_id,
    (
      select iq.id
      from public.interview_questions iq
      where iq.interview_id = p_interview_id
        and iq.question_type = 'main'
        and iq.main_question_number = nullif(log.value ->> 'questionNumber', '')::integer
    ),
    log.ordinality::integer,
    log.value ->> 'role',
    nullif(log.value ->> 'rawText', ''),
    log.value ->> 'text',
    nullif(log.value ->> 'spokenAt', '')::timestamptz
  from jsonb_array_elements(p_logs) with ordinality as log(value, ordinality);

  update public.interviews
  set status = 'completed',
      ended_at = now(),
      duration_seconds = greatest(p_duration_seconds, 0)
  where id = p_interview_id;
end;
$$;

create or replace function public.interrupt_interview(
  p_member_id uuid,
  p_interview_id uuid,
  p_duration_seconds integer,
  p_logs jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.interviews i
    join public.members m on m.id = i.member_id and m.is_active = true
    where i.id = p_interview_id
      and i.member_id = p_member_id
      and i.status <> 'completed'
  ) then
    raise exception 'interview_not_found';
  end if;

  delete from public.conversation_logs where interview_id = p_interview_id;

  insert into public.conversation_logs (
    interview_id,
    interview_question_id,
    sequence_number,
    speaker_role,
    raw_text,
    text,
    spoken_at
  )
  select
    p_interview_id,
    (
      select iq.id
      from public.interview_questions iq
      where iq.interview_id = p_interview_id
        and iq.question_type = 'main'
        and iq.main_question_number = nullif(log.value ->> 'questionNumber', '')::integer
    ),
    log.ordinality::integer,
    log.value ->> 'role',
    nullif(log.value ->> 'rawText', ''),
    log.value ->> 'text',
    nullif(log.value ->> 'spokenAt', '')::timestamptz
  from jsonb_array_elements(coalesce(p_logs, '[]'::jsonb)) with ordinality as log(value, ordinality);

  update public.interviews
  set status = 'interrupted',
      ended_at = now(),
      duration_seconds = greatest(p_duration_seconds, 0)
  where id = p_interview_id
    and member_id = p_member_id
    and status <> 'completed';

end;
$$;

create or replace function public.save_interview_review(
  p_member_id uuid,
  p_interview_id uuid,
  p_review jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.interviews i
    join public.members m on m.id = i.member_id and m.is_active = true
    where i.id = p_interview_id and i.member_id = p_member_id
  ) then
    raise exception 'interview_not_found';
  end if;

  insert into public.interview_reviews (
    interview_id,
    overall,
    technical_score,
    communication_score,
    overall_score,
    technical,
    communication,
    attitude,
    feedback
  ) values (
    p_interview_id,
    p_review ->> 'overall',
    (p_review -> 'scores' ->> '技術力')::smallint,
    (p_review -> 'scores' ->> 'コミュニケーション')::smallint,
    (p_review -> 'scores' ->> '総合')::smallint,
    p_review ->> 'technical',
    p_review ->> 'communication',
    p_review ->> 'attitude',
    p_review ->> 'feedback'
  )
  on conflict (interview_id) do update
  set overall = excluded.overall,
      technical_score = excluded.technical_score,
      communication_score = excluded.communication_score,
      overall_score = excluded.overall_score,
      technical = excluded.technical,
      communication = excluded.communication,
      attitude = excluded.attitude,
      feedback = excluded.feedback;
end;
$$;

alter table public.administrator_accounts enable row level security;
alter table public.members enable row level security;
alter table public.skill_sheets enable row level security;
alter table public.interviews enable row level security;
alter table public.interview_skill_sheets enable row level security;
alter table public.interview_projects enable row level security;
alter table public.interview_configurations enable row level security;
alter table public.interview_questions enable row level security;
alter table public.conversation_logs enable row level security;
alter table public.interview_reviews enable row level security;

revoke all on table
  public.administrator_accounts,
  public.members,
  public.skill_sheets,
  public.interviews,
  public.interview_skill_sheets,
  public.interview_projects,
  public.interview_configurations,
  public.interview_questions,
  public.conversation_logs,
  public.interview_reviews
from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.start_interview(uuid, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.complete_interview(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
revoke execute on function public.interrupt_interview(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_interview_review(uuid, uuid, jsonb)
  from public, anon, authenticated;

grant usage on schema public to service_role;
grant select on table public.administrator_accounts to service_role;
grant all on table
  public.members,
  public.skill_sheets,
  public.interviews,
  public.interview_skill_sheets,
  public.interview_projects,
  public.interview_configurations,
  public.interview_questions,
  public.conversation_logs,
  public.interview_reviews
to service_role;
grant execute on function public.start_interview(uuid, text, text, jsonb, jsonb, jsonb)
  to service_role;
grant execute on function public.complete_interview(uuid, uuid, integer, jsonb)
  to service_role;
grant execute on function public.interrupt_interview(uuid, uuid, integer, jsonb)
  to service_role;
grant execute on function public.save_interview_review(uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';

-- members はログイン時にアプリケーションが自動登録する。
-- 管理者だけは運用担当者が明示的に手動登録する（アプリケーションからは追加しない）。
-- insert into public.administrator_accounts (email, display_name)
-- values ('admin@example.com', '管理者名');
