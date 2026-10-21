alter table public.interviews
  add column progress jsonb,
  add column resume_version integer not null default 0,
  add column checkpoint_revision bigint not null default 0;

create or replace function public.save_interview_checkpoint(
  p_member_id uuid, p_interview_id uuid, p_duration_seconds integer,
  p_logs jsonb, p_progress jsonb, p_resume_version integer, p_revision bigint,
  p_interrupted boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_interview public.interviews%rowtype;
begin
  select i.* into current_interview from public.interviews i
  join public.members m on m.id = i.member_id and m.is_active = true
  where i.id = p_interview_id and i.member_id = p_member_id for update of i;
  if not found or current_interview.status = 'completed'
     or current_interview.resume_version <> p_resume_version then
    raise exception 'interview_not_resumable';
  end if;
  -- 遅れて届いた古い保存・中断リクエストで、再開後の進捗を巻き戻さない。
  if current_interview.checkpoint_revision >= p_revision then return; end if;
  perform public.interrupt_interview(p_member_id, p_interview_id, p_duration_seconds, p_logs);
  update public.interviews
  set progress = p_progress, checkpoint_revision = p_revision,
      status = case when p_interrupted then 'interrupted' else 'in_progress' end,
      ended_at = case when p_interrupted then now() else null end
  where id = p_interview_id;
end;
$$;

create or replace function public.resume_interview(
  p_member_id uuid, p_interview_id uuid, p_resume_version integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_interview public.interviews%rowtype;
  saved_logs jsonb;
begin
  select i.* into current_interview from public.interviews i
  join public.members m on m.id = i.member_id and m.is_active = true
  where i.id = p_interview_id and i.member_id = p_member_id for update of i;
  if not found or current_interview.status = 'completed'
     or current_interview.resume_version <> p_resume_version then
    raise exception 'interview_not_resumable';
  end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.sequence_number), '[]'::jsonb)
    into saved_logs from public.conversation_logs l where l.interview_id = p_interview_id;
  update public.interviews
  set status = 'in_progress', ended_at = null,
      resume_version = resume_version + 1, checkpoint_revision = 0
  where id = p_interview_id;
  return jsonb_build_object('progress', current_interview.progress,
    'duration_seconds', current_interview.duration_seconds,
    'resume_version', current_interview.resume_version + 1,
    'conversation_logs', saved_logs, 'status', 'in_progress');
end;
$$;

revoke execute on function public.save_interview_checkpoint(uuid, uuid, integer, jsonb, jsonb, integer, bigint, boolean) from public, anon, authenticated;
revoke execute on function public.resume_interview(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.save_interview_checkpoint(uuid, uuid, integer, jsonb, jsonb, integer, bigint, boolean) to service_role;
grant execute on function public.resume_interview(uuid, uuid, integer) to service_role;
