-- 이미 schema.sql을 실행한 DB에 추가로 한 번 실행 (여러 번 실행해도 안전)
alter table public.ws_employees add column if not exists must_change_pw boolean not null default false;

create or replace function public.ws_password_changed() returns void
  language sql security definer set search_path = public as
  $$ update public.ws_employees set must_change_pw = false where lower(email) = lower(auth.jwt() ->> 'email') $$;
revoke execute on function public.ws_password_changed() from public, anon;
grant execute on function public.ws_password_changed() to authenticated;

-- 날짜별 예상 근무 인원 (연차 위험한 날 표시용). 누가 쉬는지는 안 알려주고 숫자만.
-- 칸: 스케줄에 적힌 값 → 비어 있으면 로테이션 요일이면 휴일 → 대기·승인 신청 있으면 휴무 → 나머지 근무
create or replace function public.ws_day_counts(p_month text)
returns table(day int, team text, am int, pm int)
language sql stable security definer set search_path = public as $$
  with m as (select to_date(p_month || '-01', 'YYYY-MM-DD') as first),
  days as (
    select g::int as day, (m.first + (g - 1))::date as dt
    from m, generate_series(1, extract(day from m.first + interval '1 month' - interval '1 day')::int) g
  ),
  sch as (select cells from public.ws_schedules where month = p_month),
  st as (
    select d.day, e.team, e.shift,
      case
        when (e.start_date is not null and d.dt < e.start_date) or (e.end_date is not null and d.dt > e.end_date) then '퇴직'
        when coalesce((select cells -> e.id::text ->> d.day::text from sch), '') <> '' then 'off'
        when exists (select 1 from public.ws_rotations r where r.employee_id = e.id and r.month = p_month
                     and position(substr('일월화수목금토', extract(dow from d.dt)::int + 1, 1) in r.days) > 0) then 'off'
        when exists (select 1 from public.ws_requests q where q.employee_id = e.id and q.date = d.dt and q.status <> '반려') then 'off'
        else ''
      end as code
    from days d cross join public.ws_employees e
  )
  select day, team,
    (count(*) filter (where code = '' and shift <> '13:00'))::int,
    (count(*) filter (where code = '' and shift = '13:00'))::int
  from st
  where public.ws_my_employee_id() is not null
  group by day, team
$$;
revoke execute on function public.ws_day_counts(text) from public, anon;
grant execute on function public.ws_day_counts(text) to authenticated;

-- 배권솔님 빼고 전원 "첫 로그인 시 비밀번호 변경" 켜기 (비밀번호 자체는 Supabase Authentication에서 따로 설정)
update public.ws_employees set must_change_pw = true where name <> '배권솔';
