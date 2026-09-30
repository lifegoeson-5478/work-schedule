-- 근무 스케줄 사이트 — 기존 Supabase 프로젝트에 추가하는 용도
-- 다른 사이트 테이블·함수와 겹치지 않게 전부 ws_ 로 시작. 여러 번 실행해도 안전.
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run

-- 1. 테이블 -------------------------------------------------------------
create table if not exists public.ws_employees (
  id bigint generated always as identity primary key,
  email text unique not null,          -- 로그인 이메일 (기존 사이트 계정 그대로 사용 가능)
  name text not null,
  team text not null check (team in ('런드리고', '런드리24')),
  part text not null,                  -- 시트 '파트' 칸
  position text not null default '사원',
  work_type text not null default 'I08(60)',
  shift text not null default '10:00' check (shift in ('자율', '10:00', '13:00')),
  start_date date,                     -- 입사일 (이전은 '퇴직' 표시)
  end_date date,                       -- 퇴직일 (다음날부터 '퇴직' 표시)
  is_admin boolean not null default false,
  sort int not null default 0
);

create table if not exists public.ws_schedules (
  month text primary key,              -- '2026-10'
  cells jsonb not null default '{}',   -- { "직원id": { "일": "휴일" | "연차" | "생일" | "공가" } }, 빈칸 = 근무
  peak boolean not null default false,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.ws_requests (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.ws_employees on delete cascade,
  date date not null,
  kind text not null check (kind in ('필요휴무', '연차', '공가', '생일')),
  reason text,
  status text not null default '대기' check (status in ('대기', '승인', '반려')),
  created_at timestamptz not null default now()
);
create unique index if not exists ws_requests_one_per_day on public.ws_requests (employee_id, date) where status <> '반려';

create table if not exists public.ws_rotations (
  employee_id bigint not null references public.ws_employees on delete cascade,
  month text not null,
  days text not null,                  -- '일·월'
  primary key (employee_id, month)
);

-- 2. 권한 확인 함수 -------------------------------------------------------
create or replace function public.ws_my_employee_id() returns bigint
  language sql stable security definer set search_path = public as
  $$ select id from public.ws_employees where lower(email) = lower(auth.jwt() ->> 'email') $$;

create or replace function public.ws_is_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce((select is_admin from public.ws_employees where lower(email) = lower(auth.jwt() ->> 'email')), false) $$;

-- 3. RLS 정책 ------------------------------------------------------------
alter table public.ws_employees enable row level security;
alter table public.ws_schedules enable row level security;
alter table public.ws_requests  enable row level security;
alter table public.ws_rotations enable row level security;

drop policy if exists ws_emp_select   on public.ws_employees;
drop policy if exists ws_emp_admin    on public.ws_employees;
drop policy if exists ws_sch_select   on public.ws_schedules;
drop policy if exists ws_sch_admin    on public.ws_schedules;
drop policy if exists ws_rot_select   on public.ws_rotations;
drop policy if exists ws_rot_admin    on public.ws_rotations;
drop policy if exists ws_req_select   on public.ws_requests;
drop policy if exists ws_req_insert   on public.ws_requests;
drop policy if exists ws_req_delete   on public.ws_requests;
drop policy if exists ws_req_admin    on public.ws_requests;

-- 직원 명단: 등록된 직원만 조회, 관리자만 수정
create policy ws_emp_select on public.ws_employees for select to authenticated using (public.ws_my_employee_id() is not null);
create policy ws_emp_admin  on public.ws_employees for all    to authenticated using (public.ws_is_admin()) with check (public.ws_is_admin());

-- 스케줄: 확정된 달만 직원 조회, 관리자는 전부
create policy ws_sch_select on public.ws_schedules for select to authenticated using (published and public.ws_my_employee_id() is not null);
create policy ws_sch_admin  on public.ws_schedules for all    to authenticated using (public.ws_is_admin()) with check (public.ws_is_admin());

-- 로테이션: 직원 조회, 관리자 수정
create policy ws_rot_select on public.ws_rotations for select to authenticated using (public.ws_my_employee_id() is not null);
create policy ws_rot_admin  on public.ws_rotations for all    to authenticated using (public.ws_is_admin()) with check (public.ws_is_admin());

-- 휴무 신청: 본인 것만 조회 / 전달 20일 23:59(한국시간)까지 신청 / 대기중일 때만 취소, 관리자는 전부
create policy ws_req_select on public.ws_requests for select to authenticated using (employee_id = public.ws_my_employee_id());
create policy ws_req_insert on public.ws_requests for insert to authenticated with check (
  employee_id = public.ws_my_employee_id() and status = '대기'
  and now() < (date_trunc('month', date::timestamp) - interval '1 month' + interval '20 days') at time zone 'Asia/Seoul'
);
create policy ws_req_delete on public.ws_requests for delete to authenticated using (employee_id = public.ws_my_employee_id() and status = '대기');
create policy ws_req_admin  on public.ws_requests for all    to authenticated using (public.ws_is_admin()) with check (public.ws_is_admin());

-- 3-1. 임시 비밀번호 → 첫 로그인 때 강제 변경 ------------------------------
-- 관리자가 어드민 > 담당자 관리에서 켜고, 본인이 비밀번호를 바꾸면 자동으로 꺼짐
alter table public.ws_employees add column if not exists must_change_pw boolean not null default false;

-- 직원은 ws_employees를 직접 못 고치니, 본인 표시만 끄는 함수
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

-- 4. 첫 관리자 등록 (이메일·이름 바꿔서 주석 풀고 실행) -------------------
-- 이후 담당자는 사이트 어드민 > 담당자 관리에서 추가하면 돼요.
-- insert into public.ws_employees (email, name, team, part, position, shift, is_admin, sort)
-- values ('lead@lifegoeson.kr', '팀장님', '런드리고', '관리', '팀장', '자율', true, 1)
-- on conflict (email) do update set is_admin = true;
