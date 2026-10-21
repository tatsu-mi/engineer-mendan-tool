-- 音声・映像のバイナリは保存せず、練習用の観察結果だけを保持する。
alter table public.interview_reviews
  add column media_feedback jsonb;

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
    attitude_score,
    overall_score,
    technical,
    communication,
    attitude,
    feedback,
    media_feedback
  ) values (
    p_interview_id,
    p_review ->> 'overall',
    (p_review -> 'scores' ->> '技術力')::smallint,
    (p_review -> 'scores' ->> 'コミュニケーション')::smallint,
    (p_review -> 'scores' ->> '姿勢・意欲')::smallint,
    (p_review -> 'scores' ->> '総合')::smallint,
    p_review ->> 'technical',
    p_review ->> 'communication',
    p_review ->> 'attitude',
    p_review ->> 'feedback',
    p_review -> 'media_feedback'
  )
  on conflict (interview_id) do update
  set overall = excluded.overall,
      technical_score = excluded.technical_score,
      communication_score = excluded.communication_score,
      attitude_score = excluded.attitude_score,
      overall_score = excluded.overall_score,
      technical = excluded.technical,
      communication = excluded.communication,
      attitude = excluded.attitude,
      feedback = excluded.feedback,
      media_feedback = excluded.media_feedback;
end;
$$;

notify pgrst, 'reload schema';
