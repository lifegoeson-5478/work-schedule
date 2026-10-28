-- 생일(반차)도 반차와 같이: 휴무 0.5일, 근무 인원은 1명으로. Supabase SQL Editor에서 한 번 실행 (여러 번 실행해도 안전)
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
        when coalesce((select cells -> e.id::text ->> d.day::text from sch), '') in ('반차', '생일') then ''   -- 반차·생일(반차)은 근무 인원 1명
        when coalesce((select cells -> e.id::text ->> d.day::text from sch), '') <> '' then 'off'
        when position(substr('일월화수목금토', extract(dow from d.dt)::int + 1, 1) in coalesce(
               (select r.days from public.ws_rotations r where r.employee_id = e.id and r.month = p_month),
               public.ws_pattern_rot(e.rot_pattern, e.rot_start, p_month), '')) > 0 then 'off'
        when exists (select 1 from public.ws_requests q where q.employee_id = e.id and q.date = d.dt and q.status <> '반려' and q.kind not in ('반차', '생일')) then 'off'
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
