-- 로테이션 패턴 + 휴무 겹치면 안 되는 짝. Supabase SQL Editor에서 한 번 실행 (여러 번 실행해도 안전)

-- 1. 담당자별 로테이션 패턴: '일·월,금·토,수·목' 을 rot_start 달부터 매달 하나씩 돌림
alter table public.ws_employees add column if not exists rot_pattern text;
alter table public.ws_employees add column if not exists rot_start text;   -- 'YYYY-MM'

-- 그 달 패턴 로테이션 (패턴 없거나 시작 전이면 null)
create or replace function public.ws_pattern_rot(p text, s text, m text) returns text
  language sql immutable as $$
  select case when p is null or p = '' or s is null or m < s then null else
    (string_to_array(p, ','))[
      ((split_part(m, '-', 1)::int * 12 + split_part(m, '-', 2)::int)
       - (split_part(s, '-', 1)::int * 12 + split_part(s, '-', 2)::int)) % cardinality(string_to_array(p, ',')) + 1]
  end
$$;

-- 2. 휴무 겹치면 안 되는 짝 (a < b 로 한 번만 저장)
create table if not exists public.ws_conflicts (
  a bigint not null references public.ws_employees on delete cascade,
  b bigint not null references public.ws_employees on delete cascade,
  primary key (a, b),
  check (a < b)
);
alter table public.ws_conflicts enable row level security;
drop policy if exists ws_con_select on public.ws_conflicts;
drop policy if exists ws_con_admin on public.ws_conflicts;
create policy ws_con_select on public.ws_conflicts for select to authenticated using (public.ws_my_employee_id() is not null);
create policy ws_con_admin  on public.ws_conflicts for all    to authenticated using (public.ws_is_admin()) with check (public.ws_is_admin());

-- 3. 예상 근무 인원: 직접 입력한 로테이션이 없으면 패턴 로테이션도 봄
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
        when position(substr('일월화수목금토', extract(dow from d.dt)::int + 1, 1) in coalesce(
               (select r.days from public.ws_rotations r where r.employee_id = e.id and r.month = p_month),
               public.ws_pattern_rot(e.rot_pattern, e.rot_start, p_month), '')) > 0 then 'off'
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
