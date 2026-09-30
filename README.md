# 근무 스케줄 사이트

런드리고·런드리24 근무표 확인, 휴무 신청(전달 20일 마감), 관리자 승인·자동 배치·확정(25일), 구글시트용 복사.

## 설정
1. **Supabase**(기존 프로젝트 가능) → SQL Editor에 `schema.sql` 붙여넣고 Run. 테이블·함수는 전부 `ws_`로 시작해서 다른 사이트와 안 겹침
2. `schema.sql` 맨 아래 "첫 관리자 등록" 주석을 풀어 실행 → 이후 담당자·로테이션은 사이트 어드민에서 관리
3. 같은 프로젝트의 다른 사이트 계정이 있으면 그 이메일·비밀번호로 바로 로그인 (가입 불필요)
4. Authentication → Sign In / Providers → Email: **Confirm email 켜두기** (남의 이메일로 가입 방지)
5. Authentication → URL Configuration → Site URL / Redirect URLs에 GitHub Pages 주소 추가
6. `index.html`의 `SUPABASE_URL`, `SUPABASE_KEY`(anon public) 교체
7. GitHub 저장소에 올리고 Settings → Pages → main 브랜치 루트로 배포

## 운영
- 직원: 사이트에서 "처음이에요(가입)" → 메일 인증 → 로그인. `employees`에 없는 이메일은 못 들어옴
- 입사/퇴직: `employees.start_date` / `end_date` 입력 → 그 전·후는 자동으로 '퇴직' 표시
- 공휴일: `logic.js`의 `HOLIDAYS`에 추가 (임시공휴일 등)
- 테스트: `node test.js`
