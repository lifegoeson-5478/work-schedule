// node test.js
const assert = require('assert');
const L = require('./logic.js');
const M = '2026-08';
const go = (id, x = {}) => ({ id, team: '런드리고', shift: '10:00', name: 'g' + id, ...x });
const emps = [
  go(1, { shift: '자율' }), go(2), go(3), go(4), go(5), go(6), go(7),
  go(8, { end_date: '2026-08-23' }), go(9, { start_date: '2026-08-29' }),
  { id: 10, team: '런드리24', shift: '10:00' }, { id: 11, team: '런드리24', shift: '10:00' },
  { id: 12, team: '런드리24', shift: '13:00' }, { id: 13, team: '런드리24', shift: '13:00' },
];
const rot = { 10: '금·토', 11: '수·목', 12: '금·토', 13: '수·목' };
const approved = [
  { employee_id: 2, date: '2026-08-12', kind: '필요휴무' },
  { employee_id: 3, date: '2026-08-05', kind: '연차' },
];

assert.equal(L.holidayCount(M), 1);                 // 광복절 (8/17 대체는 제외)
assert.equal(L.restQuota(emps[0], M), 11);          // 주말 10 + 8/17
assert.equal(L.restQuota(emps[7], M), 9);           // 8/23 퇴직
assert.equal(L.canRequest('2026-09', new Date(2026, 7, 20, 23, 59)), true);
assert.equal(L.canRequest('2026-09', new Date(2026, 7, 21)), false);
assert.equal(L.canRequest('2027-01', new Date(2026, 11, 20)), true);

for (let run = 0; run < 20; run++) {
  const cells = L.autoSchedule(emps, M, approved, rot, false);
  const at = (id, d) => L.cellOf(emps.find(e => e.id === id), M, d, cells);
  assert.equal(at(2, 12), '휴일');
  assert.equal(at(3, 5), '연차');
  assert.equal(at(8, 24), '퇴직');
  assert.equal(at(9, 28), '퇴직');
  assert.notEqual(at(9, 29), '퇴직');
  assert.equal(at(10, 7), '휴일');                  // 8/7 금
  assert.equal(at(10, 5), '');                      // 8/5 수
  for (const e of emps.filter(e => e.team === '런드리고')) {
    const offs = Array.from({ length: 31 }, (_, i) => at(e.id, i + 1)).filter(c => c === '휴일').length;
    assert.equal(offs, L.restQuota(e, M), `g${e.id} 휴일 수`);
  }
  for (let d = 1; d <= 31; d++) for (const t of L.TEAMS)
    assert.ok(!L.isShort(t, M, d, L.dayCount(emps, t, M, d, cells), false), `${t} ${d}일 인원 부족`);
  const tsv = L.toTSV(emps, M, cells).split('\n');
  assert.equal(tsv.length, 9 + 1 + 4 + 1);
  assert.ok(tsv.every(r => r.split('\t').length === 5 + 31));
}
// 빠듯한 인원(정직원 6 + 부분 재직 2)이어도 최소 인원 유지
const tight = emps.filter(e => e.id !== 7);
for (let run = 0; run < 50; run++) {
  const cells = L.autoSchedule(tight, M, approved, rot, false);
  for (let d = 1; d <= 31; d++)
    assert.ok(!L.isShort('런드리고', M, d, L.dayCount(tight, '런드리고', M, d, cells), false), `빠듯 ${d}일 부족`);
}
// 런드리고 로테이션: 로테이션 요일만 쉬고 자동 배정은 안 받음
{
  const cells = L.autoSchedule(emps, M, [], { ...rot, 2: '토·일' }, false);
  const offs = Object.keys(cells[2]).map(Number);
  assert.ok(offs.every(d => [0, 6].includes(L.dow(M, d))) && offs.length === 10, 'g2 로테이션');
  assert.equal(L.offLimit(emps[1], M, { 2: '토·일' }), 1);   // 공휴일 수
  assert.equal(L.offLimit(emps[1], M, {}), 11);              // 주말+공휴일 수
}
assert.deepEqual(L.rotationGaps(emps, '런드리24', M, rot), []);
assert.deepEqual(L.rotationGaps(emps, '런드리24', M, { 10: '금·토', 11: '금·토', 12: '수·목', 13: '수·목' }), ['수 오후', '목 오후', '금 오전', '토 오전']);
// 주 5일 (토~금): 2026-10-31(토)~11-06(금)은 10월·11월에 걸침
assert.deepEqual(L.weeksOf('2026-11')[0].map(x => x.m.slice(5) + '/' + x.d), ['10/31', '11/1', '11/2', '11/3', '11/4', '11/5', '11/6']);
assert.equal(L.weeksOf('2026-08')[0][0].d, 1);   // 8/1이 토요일이면 그날부터
{
  // 로테이션이 10월 수·목 → 11월 금·토로 바뀌면 10/31~11/6 주에 휴무가 11/6 하루뿐 → 보정돼야 함
  const r24 = e => e.team === '런드리24';
  const octRot = { 10: '수·목', 11: '수·목', 12: '수·목', 13: '수·목' };
  const novRot = { 10: '금·토', 11: '일·월', 12: '금·토', 13: '일·월' };
  for (let run = 0; run < 30; run++) {
    const oct = L.autoSchedule(emps, '2026-10', [], octRot, false);
    const nov = L.autoSchedule(emps, '2026-11', [], novRot, false, { prev: oct });
    assert.deepEqual(L.weekIssues(emps, '2026-11', nov, { prev: oct }), [], '11월 주 5일 초과');
    assert.deepEqual(L.weekIssues(emps, '2026-10', oct), [], '10월 주 5일 초과');
    assert.equal(nov[10][6], '휴일');
    assert.ok(emps.filter(r24).every(e => L.weekWork(e, L.weeksOf('2026-11')[0], '2026-11', nov, { prev: oct }) <= 5));
    // 런드리고 자동 배치 인원은 주 5일 보정 후에도 휴일 수 = 주말·공휴일 수
    for (const e of emps.filter(e => e.team === '런드리고' && !e.end_date && !e.start_date))
      assert.equal(Object.values(nov[e.id]).filter(c => c === '휴일').length, L.restQuota(e, '2026-11'));
  }
  // 10/31(토)만 10월인 주: 11월이 아직 비어 있어도(전부 근무로 보여도) 10월에선 초과 아님
  const oct = { 2: {} };   // 상담사2 10월 휴일 없음 → 10/31 근무
  assert.ok(!L.weekIssues([emps[1]], '2026-10', oct).some(w => w.days.includes(31)), '10/31 주는 11월에서 판단');
  // 11월에서 합산: 10/31 근무 + 11/1~6 근무 → 초과
  assert.ok(L.weekIssues([emps[1]], '2026-11', { 2: {} }, { prev: oct }).some(w => w.days.includes(1)));
  // 앞달 칸이 없으면 모르는 날은 빼고 셈 → 이번 달 쪽만으로 5일 넘으면 문제
  const allWork = { 2: {} };
  // 11/1~6(6일), 7~13, 14~20, 21~27 → 4주. 11/28~30은 3일뿐이라 문제 없음
  assert.equal(L.weekIssues([emps[1]], '2026-11', allWork).length, 4);
}
console.log('ok');
