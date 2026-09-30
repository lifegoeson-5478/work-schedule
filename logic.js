// 스케줄 계산 로직 (브라우저와 test.js에서 같이 씀)
const TEAMS = ['런드리고', '런드리24'];
const CODES = ['', '휴일', '연차', '생일', '공가']; // '' = 근무
const DOW = '일월화수목금토';

// ponytail: 공휴일 직접 관리. 임시공휴일·선거일·2028년 이후는 여기에 추가
// '대체' = 대체공휴일 (런드리고 휴일 수엔 포함, 런드리24 필요휴무 개수엔 미포함)
const HOLIDAYS = {
  '2026-01-01': '신정', '2026-02-16': '설날', '2026-02-17': '설날', '2026-02-18': '설날',
  '2026-03-01': '삼일절', '2026-03-02': '대체', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날',
  '2026-05-25': '대체', '2026-06-03': '지방선거', '2026-06-06': '현충일',
  '2026-07-17': '제헌절', // 2026년부터 공휴일 재지정 — 확정 여부 확인
  '2026-08-15': '광복절', '2026-08-17': '대체', '2026-09-24': '추석', '2026-09-25': '추석',
  '2026-09-26': '추석', '2026-10-03': '개천절', '2026-10-05': '대체', '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-06': '설날', '2027-02-07': '설날', '2027-02-08': '설날',
  '2027-02-09': '대체', '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일', '2027-07-17': '제헌절', '2027-07-19': '대체', '2027-08-15': '광복절',
  '2027-08-16': '대체', '2027-09-14': '추석', '2027-09-15': '추석', '2027-09-16': '추석',
  '2027-10-03': '개천절', '2027-10-04': '대체', '2027-10-09': '한글날', '2027-10-11': '대체',
  '2027-12-25': '성탄절', '2027-12-27': '대체',
};

const pad = n => String(n).padStart(2, '0');
const fmtMonth = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
const ym = month => month.split('-').map(Number);
const addMonth = (month, k) => { const [y, m] = ym(month); return fmtMonth(new Date(y, m - 1 + k, 1)); };
const daysIn = month => { const [y, m] = ym(month); return new Date(y, m, 0).getDate(); };
const ymd = (month, d) => `${month}-${pad(d)}`;
const dow = (month, d) => { const [y, m] = ym(month); return new Date(y, m - 1, d).getDay(); };
const isRest = (month, d) => [0, 6].includes(dow(month, d)) || ymd(month, d) in HOLIDAYS;
const holidayCount = month => Object.entries(HOLIDAYS).filter(([k, v]) => k.startsWith(month) && v !== '대체').length;

// 입사일 전·퇴직일 다음날부터는 '퇴직'
const active = (e, date) => (!e.start_date || date >= e.start_date) && (!e.end_date || date <= e.end_date);
const cellOf = (e, month, d, cells) => active(e, ymd(month, d)) ? (cells[e.id]?.[d] || '') : '퇴직';

// 재직 기간 안의 주말+공휴일 수 = 런드리고 한 달 휴일 수
function restQuota(e, month) {
  let q = 0;
  for (let d = 1; d <= daysIn(month); d++) if (active(e, ymd(month, d)) && isRest(month, d)) q++;
  return q;
}
// 재직 기간 안에서 로테이션 요일에 해당하는 날 수
function rotationOffs(e, month, rotations = {}) {
  const off = rotations[e.id] || '';
  let n = 0;
  if (off) for (let d = 1; d <= daysIn(month); d++) if (active(e, ymd(month, d)) && off.includes(DOW[dow(month, d)])) n++;
  return n;
}
// 필요휴무 신청 한도 = 기본 휴무(주말+공휴일) − 로테이션 휴무일. 로테이션이 없으면 기본 휴무 전부
const offLimit = (e, month, rotations = {}) => Math.max(0, restQuota(e, month) - rotationOffs(e, month, rotations));
// 해당 월 신청은 전달 20일까지
const canRequest = (month, now = new Date()) => { const [y, m] = ym(month); return now < new Date(y, m - 2, 21); };

function dayCount(emps, team, month, d, cells) {
  let total = 0, am = 0, pm = 0;
  for (const e of emps) if (e.team === team && cellOf(e, month, d, cells) === '') {
    total++;
    e.shift === '13:00' ? pm++ : am++;
  }
  return { total, am, pm };
}
const minGo = (month, d, peak) => isRest(month, d) ? (peak ? 4 : 3) : 5;
const isShort = (team, month, d, c, peak) =>
  team === '런드리24' ? c.am < 1 || c.pm < 1 : c.total < minGo(month, d, peak);

// 연차 쓰면 위험한 날: 내 팀(런드리24는 내 조) 근무 인원이 최소면 '위험', 최소보다 적으면 '부족'
// c = { am, pm, total } (dayCount 결과 또는 DB 예상 인원)
function riskOf(e, month, d, c, peak) {
  if (!c) return null;
  const n = e.team === '런드리24' ? (e.shift === '13:00' ? c.pm : c.am) : c.total;
  const min = e.team === '런드리24' ? 1 : minGo(month, d, peak);
  return n < min ? '부족' : n === min ? '위험' : null;
}

// ---------- 주 5일 근무 (한 주 = 토~금, 월 경계는 앞뒤 달 칸까지 봄) ----------
const worksOn = c => c === '' || c === '생일'; // 생일은 반차라 근무일로 셈
// month에 걸친 주들. 각 주 = [{ m: 'YYYY-MM', d }] 7일 (앞뒤 달 날짜 포함)
function weeksOf(month) {
  const [y, m] = ym(month), weeks = [];
  for (let s = 1 - (new Date(y, m - 1, 1).getDay() + 1) % 7; s <= daysIn(month); s += 7)
    weeks.push(Array.from({ length: 7 }, (_, i) => { const t = new Date(y, m - 1, s + i); return { m: fmtMonth(t), d: t.getDate() }; }));
  return weeks;
}
// 그 주에 확인되는 근무일 수. adj = { prev }: 지난달 cells (없으면 그 날짜는 빼고 셈)
// 다음 달로 넘어가는 주는 다음 달 날짜를 안 봄 → 다음 달 스케줄 짤 때 지난달과 합산해서 판단
function weekWork(e, week, month, cells, adj = {}) {
  const prev = addMonth(month, -1);
  let n = 0;
  for (const { m, d } of week) {
    const c = m === month ? cells : m === prev ? adj.prev : null;
    if (c && worksOn(cellOf(e, m, d, c))) n++;
  }
  return n;
}
// 주 5일 넘게 근무하는 주 → [{ id, work, days: 이번 달 일자들 }]
function weekIssues(emps, month, cells, adj = {}) {
  const out = [];
  for (const w of weeksOf(month)) for (const e of emps) {
    const work = weekWork(e, w, month, cells, adj);
    if (work > 5) out.push({ id: e.id, work, days: w.filter(x => x.m === month).map(x => x.d) });
  }
  return out;
}

// ---------- 연속 근무 5일까지 (6일부터 안 됨). 지난달 월말부터 이어서 셈, 다음 달은 모름 ----------
// d를 근무로 쳤을 때 d를 포함해 이어지는 연속 근무일 수
function workRun(e, month, d, cells, adj = {}) {
  const pm = addMonth(month, -1), pn = daysIn(pm), n = daysIn(month);
  const w = x => x >= 1 ? worksOn(cellOf(e, month, x, cells)) : !!adj.prev && x > -pn && worksOn(cellOf(e, pm, pn + x, adj.prev));
  let run = 1;
  for (let x = d - 1; w(x); x--) run++;
  for (let x = d + 1; x <= n && w(x); x++) run++;
  return run;
}
// 연속 6일 이상 근무 구간 → [{ id, work: 전체 연속일(지난달 포함), days: 이번 달 일자들 }]
function runIssues(emps, month, cells, adj = {}) {
  const out = [], n = daysIn(month);
  for (const e of emps) for (let d = 1; d <= n;) {
    if (!worksOn(cellOf(e, month, d, cells))) { d++; continue; }
    let end = d;
    while (end < n && worksOn(cellOf(e, month, end + 1, cells))) end++;
    const work = workRun(e, month, d, cells, adj);
    if (work > 5) out.push({ id: e.id, work, days: Array.from({ length: end - d + 1 }, (_, i) => d + i) });
    d = end + 1;
  }
  return out;
}

// 승인된 신청 → 로테이션(팀 무관) → 주 5일·연속 5일 보정 → 로테이션 없는 런드리고는 남은 휴일을 인원 여유가 큰 날부터 배정
// adj = { prev }: 지난달 cells (월초 주 5일 계산용)
// ponytail: 무작위가 섞인 배치를 여러 번 해서 인원 부족한 날이 가장 적은 결과를 고름 (빠듯한 인원에서 효과 큼)
function autoSchedule(emps, month, approved, rotations, peak, adj = {}, tries = 20) {
  const teams = TEAMS.filter(t => emps.some(e => e.team === t));
  let best, bestShort = Infinity;
  for (let i = 0; i < tries && bestShort > 0; i++) {
    const c = autoScheduleOnce(emps, month, approved, rotations, peak, adj);
    let short = 0;
    for (let d = 1; d <= daysIn(month); d++) for (const t of teams) if (isShort(t, month, d, dayCount(emps, t, month, d, c), peak)) short++;
    if (short < bestShort) [best, bestShort] = [c, short];
  }
  return best;
}
function autoScheduleOnce(emps, month, approved, rotations, peak, adj = {}) {
  const n = daysIn(month), cells = {};
  const on = (e, d) => active(e, ymd(month, d));
  for (const e of emps) cells[e.id] = {};
  for (const r of approved) if (cells[r.employee_id]) cells[r.employee_id][+r.date.slice(8)] = r.kind === '필요휴무' ? '휴일' : r.kind;

  for (const e of emps) {
    const off = rotations[e.id] || '';
    for (let d = 1; d <= n; d++) if (off && on(e, d) && !cells[e.id][d] && off.includes(DOW[dow(month, d)])) cells[e.id][d] = '휴일';
  }

  const go = emps.filter(e => e.team === '런드리고');
  const flex = go.filter(e => !rotations[e.id]);
  // 화수목은 목표 6명으로 잡아서 휴일이 덜 몰리게
  const target = d => isRest(month, d) ? minGo(month, d, peak) : [2, 3, 4].includes(dow(month, d)) ? 6 : 5;
  const head = d => go.filter(e => on(e, d) && !cells[e.id][d]).length;

  // 주 5일 초과면 그 주(이번 달 쪽) 안에서 인원 여유가 큰 날을 휴일로
  const weeks = weeksOf(month);
  const weekOfDay = d => weeks.find(w => w.some(x => x.m === month && x.d === d));
  const surplus = (e, d) => e.team === '런드리고' ? head(d) - target(d)
    : emps.filter(x => x.team === e.team && (x.shift === '13:00') === (e.shift === '13:00') && on(x, d) && !cells[x.id][d]).length - 1;
  for (const w of weeks) for (const e of emps) {
    const days = w.filter(x => x.m === month).map(x => x.d);
    while (weekWork(e, w, month, cells, adj) > 5) {
      const free = days.filter(d => on(e, d) && !cells[e.id][d]);
      if (!free.length) break;
      cells[e.id][free.reduce((a, b) => surplus(e, b) > surplus(e, a) ? b : a)] = '휴일';
    }
  }

  // 연속 근무 6일 이상 구간이 있으면 그 안에 휴일 하나 (양쪽이 5일 이하가 되는 날 중 여유 큰 날, 없으면 5일째 다음 날)
  function breakRuns(e) {
    for (let guard = 0; guard < n; guard++) {
      const iss = runIssues([e], month, cells, adj)[0];
      if (!iss) return;
      const s = iss.days[0], t = iss.days.at(-1), before = iss.work - (t - s + 1);  // 지난달에서 이어온 일수
      const free = iss.days.filter(p => on(e, p) && !cells[e.id][p]);
      const split = free.filter(p => before + (p - s) <= 5 && t - p <= 5);
      // 쉬어도 최소 인원이 남는 날 우선 (연속 근무 규칙이 인원보다 우선이라 없으면 그래도 끊음)
      const safe = split.filter(p => surplus(e, p) > (e.team === '런드리고' ? minGo(month, p, peak) - target(p) : 0));
      const pool = safe.length ? safe : split;
      const pick = pool.length ? pool.reduce((a, b) => surplus(e, b) > surplus(e, a) ? b : a)
        : free.filter(p => before + (p - s) <= 5).pop() ?? free[0];
      if (pick === undefined) return;
      cells[e.id][pick] = '휴일';
    }
  }
  // 휴일을 근무로 되돌려도 되는 날: 신청 아님 · 주 5일 · 연속 5일 안 넘음
  const fixed = new Set(approved.map(r => r.employee_id + '-' + +r.date.slice(8)));
  const canWork = (e, d) => cells[e.id][d] === '휴일' && !fixed.has(e.id + '-' + d)
    && weekWork(e, weekOfDay(d), month, cells, adj) < 5 && workRun(e, month, d, cells, adj) <= 5;
  // 휴일이 기본 휴무(주말+공휴일)보다 많으면 넘치는 만큼, 인원 가장 모자란 날부터 근무로
  function trimToQuota(e) {
    for (let extra = Object.values(cells[e.id]).filter(c => c === '휴일').length - restQuota(e, month); extra > 0; extra--) {
      const cand = [];
      for (let d = 1; d <= n; d++) if (canWork(e, d)) cand.push(d);
      if (!cand.length) return;
      delete cells[e.id][cand.reduce((a, b) => surplus(e, b) < surplus(e, a) ? b : a)];
    }
  }
  // 로테이션·런드리24: 연속 근무 끊고 → 로테이션 휴무가 넘치면 되돌림 (자동 배치 대상은 휴일 다 나눈 뒤에)
  for (const e of emps.filter(x => !flex.includes(x))) breakRuns(e);
  for (const e of emps.filter(x => rotations[x.id])) trimToQuota(e);

  const need = new Map(flex.map(e => {
    let used = 0;
    for (let d = 1; d <= n; d++) if (cells[e.id][d] === '휴일') used++;
    return [e.id, restQuota(e, month) - used];
  }));
  // ponytail: 탐욕 배정(한 명씩 번갈아 하루씩). 공정성·연속휴무 규칙이 더 필요하면 여기서 점수 조정
  for (let progress = true; progress;) {
    progress = false;
    for (const e of flex) {
      if (need.get(e.id) <= 0) continue;
      let best = 0, bestScore = -Infinity;
      for (let d = 1; d <= n; d++) {
        if (!on(e, d) || cells[e.id][d]) continue;
        // 이틀 연휴는 선호, 3일 이상 연속 휴무는 감점
        let run = 1;
        for (let k = d - 1; cells[e.id][k]; k--) run++;
        for (let k = d + 1; cells[e.id][k]; k++) run++;
        const h = head(d);
        const score = h - target(d) + (h <= minGo(month, d, peak) ? -10 : 0) // 최소 인원 깨는 날은 최후 수단
          + (run === 2 ? 0.4 : run > 2 ? 2 - run : 0) + Math.random() * 0.3;
        if (score > bestScore) [best, bestScore] = [d, score];
      }
      if (!best) continue;
      cells[e.id][best] = '휴일';
      need.set(e.id, need.get(e.id) - 1);
      progress = true;
    }
  }
  // 자동 배치 대상: 연속 6일 이상 끊고, 그만큼 늘어난 휴일은 다른 날에서 되돌림
  for (const e of flex) { breakRuns(e); trimToQuota(e); }

  // 그래도 부족한 날은 그날 쉬는 사람의 휴일을 여유 있는 날로 옮김 (신청한 날·로테이션은 안 건드림)
  // 옮겨 보고 주 5일·연속 5일 위반이 늘면 되돌림
  const broken = e => weekIssues([e], month, cells, adj).length + runIssues([e], month, cells, adj).length;
  for (let d = 1; d <= n; d++) {
    for (let moved = true; moved && head(d) < minGo(month, d, peak);) {
      moved = false;
      for (const e of flex) {
        if (cells[e.id][d] !== '휴일' || fixed.has(e.id + '-' + d)) continue;
        const was = broken(e);
        let best = 0, bestS = -Infinity;
        for (let d2 = 1; d2 <= n; d2++) {
          if (!on(e, d2) || cells[e.id][d2] || head(d2) <= minGo(month, d2, peak)) continue;
          delete cells[e.id][d]; cells[e.id][d2] = '휴일';
          if (broken(e) <= was && surplus(e, d2) > bestS) [best, bestS] = [d2, surplus(e, d2)];
          delete cells[e.id][d2]; cells[e.id][d] = '휴일';
        }
        if (!best) continue;
        delete cells[e.id][d];
        cells[e.id][best] = '휴일';
        moved = true;
        break;
      }
    }
  }
  return cells;
}

// 로테이션만 반영했을 때 요일별로 최소 인원이 깨지는 곳 (예: ['수 오후'], ['토'])
// ponytail: 다른 휴무·공휴일은 안 봄. 요일 단위 대략 점검용
function rotationGaps(emps, team, month, rotations) {
  const first = month + '-01', last = ymd(month, daysIn(month)), gaps = [];
  const list = emps.filter(e => e.team === team && (!e.start_date || e.start_date <= last) && (!e.end_date || e.end_date >= first));
  for (let w = 0; w < 7; w++) {
    const work = list.filter(e => !(rotations[e.id] || '').includes(DOW[w]));
    if (team === '런드리24') {
      if (!work.some(e => e.shift !== '13:00')) gaps.push(DOW[w] + ' 오전');
      if (!work.some(e => e.shift === '13:00')) gaps.push(DOW[w] + ' 오후');
    } else if (work.length < ([0, 6].includes(w) ? 3 : 5)) gaps.push(DOW[w]);
  }
  return gaps;
}

// 구글시트 붙여넣기용: 파트 | 직책 | 근무타입 | 출근시간 | 이름 | 1일..말일, 팀마다 근무 인원 줄
function toTSV(emps, month, cells) {
  const days = Array.from({ length: daysIn(month) }, (_, i) => i + 1), rows = [];
  for (const t of TEAMS) {
    const list = emps.filter(e => e.team === t);
    if (!list.length) continue;
    for (const e of list) rows.push([e.part, e.position, e.work_type, e.shift, e.name, ...days.map(d => cellOf(e, month, d, cells))]);
    rows.push([`${t} 고객문의 근무 인원`, '', '', '', '', ...days.map(d => dayCount(emps, t, month, d, cells).total)]);
  }
  return rows.map(r => r.map(v => v ?? '').join('\t')).join('\n');
}

if (typeof module !== 'undefined') module.exports = {
  TEAMS, CODES, DOW, HOLIDAYS, fmtMonth, addMonth, daysIn, ymd, dow, isRest, holidayCount, active, cellOf,
  restQuota, rotationOffs, offLimit, canRequest, dayCount, isShort, riskOf, weeksOf, weekWork, weekIssues, workRun, runIssues, autoSchedule, rotationGaps, toTSV,
};
