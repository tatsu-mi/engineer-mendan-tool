-- マイグレーション適用済みのテスト専用DBで実行する。データは最後にロールバックする。
begin;
do $$
declare
  owner_id uuid;
  other_id uuid;
  interview_id uuid;
  snapshot jsonb;
  logs jsonb := '[{"role":"interviewer","text":"Q1です。設計経験は？","questionNumber":1}]';
begin
  insert into public.members(email) values ('resume-test-owner@example.test') returning id into owner_id;
  insert into public.members(email) values ('resume-test-other@example.test') returning id into other_id;
  interview_id := (public.start_interview(owner_id, 'Java経験', '',
    '{"projectName":"API開発","requiredSkills":"Java"}',
    '{"mainQuestionCount":1,"followUpIntensity":"standard","liveModel":"test","textModel":"test"}',
    '["設計経験は？"]') ->> 'interviewId')::uuid;

  perform public.save_interview_checkpoint(owner_id, interview_id, 40, logs,
    '{"questionCount":1,"userTextBuffer":"設計を"}', 0, 1, false);
  if (select status from public.interviews where id = interview_id) <> 'in_progress' then
    raise exception 'checkpoint incorrectly interrupted the interview';
  end if;
  perform public.save_interview_checkpoint(owner_id, interview_id, 50, logs,
    '{"questionCount":1,"userTextBuffer":"設計を担当"}', 0, 2, true);
  perform public.save_interview_checkpoint(owner_id, interview_id, 10, '[]', '{}', 0, 1, false);
  if (select status from public.interviews where id = interview_id) <> 'interrupted' then
    raise exception 'out-of-order checkpoint overwrote interruption';
  end if;

  snapshot := public.resume_interview(owner_id, interview_id, 0);
  if (snapshot ->> 'duration_seconds')::integer <> 50
     or (snapshot ->> 'resume_version')::integer <> 1
     or snapshot -> 'progress' ->> 'userTextBuffer' <> '設計を担当'
     or jsonb_array_length(snapshot -> 'conversation_logs') <> 1 then
    raise exception 'resume lost saved time, progress or logs';
  end if;
  if (select ended_at from public.interviews where id = interview_id) is not null then
    raise exception 'resume did not clear interruption end time';
  end if;

  begin
    perform public.save_interview_checkpoint(owner_id, interview_id, 10, '[]', '{}', 0, 99, true);
    raise exception 'stale save unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'interview_not_resumable' then raise; end if;
  end;
  begin
    perform public.resume_interview(other_id, interview_id, 1);
    raise exception 'another member resumed the interview';
  exception when others then
    if sqlerrm <> 'interview_not_resumable' then raise; end if;
  end;
  begin
    perform public.resume_interview(owner_id, interview_id, 0);
    raise exception 'concurrent stale resume succeeded';
  exception when others then
    if sqlerrm <> 'interview_not_resumable' then raise; end if;
  end;

  perform public.save_interview_checkpoint(owner_id, interview_id, 70, logs, '{"questionCount":1}', 1, 1, false);
  perform public.complete_interview(owner_id, interview_id, 80, logs);
  begin
    perform public.resume_interview(owner_id, interview_id, 1);
    raise exception 'completed interview was resumed';
  exception when others then
    if sqlerrm <> 'interview_not_resumable' then raise; end if;
  end;
  begin
    perform public.save_interview_checkpoint(owner_id, interview_id, 70, '[]', '{}', 1, 2, true);
    raise exception 'completed interview was overwritten';
  exception when others then
    if sqlerrm <> 'interview_not_resumable' then raise; end if;
  end;
end;
$$;
rollback;
