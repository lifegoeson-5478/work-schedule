-- 휴무 신청 종류에 '반차' 추가. Supabase SQL Editor에서 한 번 실행 (여러 번 실행해도 안전)
alter table public.ws_requests drop constraint if exists ws_requests_kind_check;
alter table public.ws_requests add constraint ws_requests_kind_check
  check (kind in ('필요휴무', '연차', '반차', '공가', '생일'));
