-- 이미 schema.sql을 실행한 DB에 추가로 한 번 실행 (여러 번 실행해도 안전)
alter table public.ws_employees add column if not exists must_change_pw boolean not null default false;

create or replace function public.ws_password_changed() returns void
  language sql security definer set search_path = public as
  $$ update public.ws_employees set must_change_pw = false where lower(email) = lower(auth.jwt() ->> 'email') $$;
revoke execute on function public.ws_password_changed() from public, anon;
grant execute on function public.ws_password_changed() to authenticated;

-- 배권솔님 빼고 전원 "첫 로그인 시 비밀번호 변경" 켜기 (비밀번호 자체는 Supabase Authentication에서 따로 설정)
update public.ws_employees set must_change_pw = true where name <> '배권솔';
