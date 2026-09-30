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
console.log('ok');
