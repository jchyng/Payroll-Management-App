// app.js 순수 로직 검증 테스트 (DOM 스텁)
const fs = require('fs');
const vm = require('vm');

// ES module import 구문 제거 (순수 로직 테스트용)
let src = fs.readFileSync(require('path').join(__dirname, 'js', 'app.js'), 'utf8');
src = src.replace(/^import\s.*?['"];?\s*$/gm, '');

const sandbox = {
  document: {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => [],
  },
  window: { addEventListener: () => {} },
  navigator: {},
  confirm: () => true,
  console,
  // IndexedDB 함수 stub (import 제거 후 전역으로 필요)
  loadFromDB: () => Promise.resolve(null),
  saveToDB:   () => Promise.resolve(),
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__t = { getPayDate, generateYearCycles, locateCycle, cycleStats, salaryFor, salaryForCycle, recurringDatesInCycle, recurringDateInMonth, materializeRecurringHistory, removeRecurringOccurrencesFromMonth, rescheduleRecurringOccurrences, expenseDaysLeft, renderExpenseGroup, ensureRecurringExpenses, saveNewExpense, updateExpense, deleteExpense, updateSalarySettings, formatAmountInput, CATEGORIES, state };', ctx);

const { getPayDate, generateYearCycles, locateCycle, cycleStats, salaryFor, salaryForCycle, recurringDatesInCycle, recurringDateInMonth, materializeRecurringHistory, removeRecurringOccurrencesFromMonth, rescheduleRecurringOccurrences, expenseDaysLeft, renderExpenseGroup, ensureRecurringExpenses, saveNewExpense, updateExpense, deleteExpense, updateSalarySettings, formatAmountInput, CATEGORIES, state } = sandbox.globalThis.__t;

const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} → 기대: ${expected}, 실제: ${actual}`); }
}

console.log('=== 급여일 계산 (25일 기준, 주말·공휴일 → 전 영업일) ===');
console.log('\n=== 지출 카테고리 ===');
check('기존 카테고리 전체 복원', CATEGORIES.map(c => c.label),
  ['식비', '카페/간식', '생활/마트', '쇼핑', '교통', '주거/통신', '문화/여가', '의료/보험', '저축', '데이트', '기타']);
console.log('\n=== 금액 입력 형식 ===');
check('천 단위 쉼표 표시', formatAmountInput('1234567'), '1,234,567');
check('입력된 쉼표를 정리 후 재표시', formatAmountInput('12,345,678'), '12,345,678');
check('숫자 외 문자를 제거 후 표시', formatAmountInput('₩1234원'), '1,234');
check('앞자리 0 제거', formatAmountInput('01234'), '1,234');
check('0만 입력하면 빈 값 유지', formatAmountInput('0'), '');
check('2026-01: 25일(일) → 1/23(금)', getPayDate(2026, 1).getDate(), 23);
check('2026-02: 25일(수) → 2/25', getPayDate(2026, 2).getDate(), 25);
check('2026-09: 추석 연휴(9/24~27) → 9/23(수)', getPayDate(2026, 9).getDate(), 23);
check('2026-05: 25일(월) 부처님 → 5/22(금)', getPayDate(2026, 5).getDate(), 22);
state.payDay = 30;
check('2월 30일 설정 → 2/28(토) → 2/27(금)', getPayDate(2026, 2, 30).getDate(), 27);
check('2월 30일 설정, 2024(윤년) → 2/29(목)', getPayDate(2024, 2, 30).getDate(), 29);
state.payDay = 25;

console.log('\n=== 주기 생성 (2026) ===');
const cycles = generateYearCycles(2026);
check('주기 수', cycles.length, 12);
check('1월 주기 시작 = 1월 급여일', local(cycles[0].start), '2026-01-23');
check('1월 주기 종료 = 2월 급여 전일', local(cycles[0].end), '2026-02-24');
check('1월 급여일', local(cycles[0].payDate), '2026-01-23');
check('2월 주기 시작', local(cycles[1].start), '2026-02-25');
check('2월 주기 종료', local(cycles[1].end), '2026-03-24');
check('12월 주기 종료 (다음년도)', local(cycles[11].end), '2027-01-24');

// 주기 연속성: 공백/중복 없음
let gapOk = true;
for (let i = 1; i < cycles.length; i++) {
  if (cycles[i].start.getTime() !== cycles[i - 1].end.getTime() + 864e5) gapOk = false;
}
check('연내 주기 연속성', gapOk, true);

// 연도 경계 연속성: 2025년 12월 주기 종료 + 1일 = 2026년 1월 주기 시작
const c2025 = generateYearCycles(2025);
check('연도 경계 연속성',
  c2025[11].end.getTime() + 864e5 === cycles[0].start.getTime(), true);

// 모든 날짜가 정확히 1개 주기에 속하는지 (2025-12-20 ~ 2026-02-05)
let coverOk = true;
const all = [...generateYearCycles(2025), ...generateYearCycles(2026)];
for (let t = new Date(2025, 11, 20); t <= new Date(2026, 1, 5); t.setDate(t.getDate() + 1)) {
  const count = all.filter(c => t >= c.start && t <= c.end).length;
  if (count !== 1) { coverOk = false; console.log(`    ${local(t)}: ${count}개 주기`); }
}
check('전 기간 정확히 1개 주기에 속함', coverOk, true);

console.log('\n=== 날짜 → 주기 매핑 ===');
check('1/10 → 2025년 12월 주기', `${locateCycle(new Date(2026, 0, 10)).year}-${locateCycle(new Date(2026, 0, 10)).index}`, '2025-11');
check('1/22 → 2025년 12월 주기', `${locateCycle(new Date(2026, 0, 22)).year}-${locateCycle(new Date(2026, 0, 22)).index}`, '2025-11');
check('1/23(급여일) → 2026년 1월 주기', `${locateCycle(new Date(2026, 0, 23)).year}-${locateCycle(new Date(2026, 0, 23)).index}`, '2026-0');
check('1/24 → 2026년 1월 주기', `${locateCycle(new Date(2026, 0, 24)).year}-${locateCycle(new Date(2026, 0, 24)).index}`, '2026-0');
check('2/24 → 2026년 1월 주기', `${locateCycle(new Date(2026, 1, 24)).year}-${locateCycle(new Date(2026, 1, 24)).index}`, '2026-0');
check('2/25(급여일) → 2026년 2월 주기', `${locateCycle(new Date(2026, 1, 25)).year}-${locateCycle(new Date(2026, 1, 25)).index}`, '2026-1');
check('2025-12-30 → 2025년 12월 주기', `${locateCycle(new Date(2025, 11, 30)).year}-${locateCycle(new Date(2025, 11, 30)).index}`, '2025-11');

console.log('\n=== 통계 계산 ===');
state.salaryHistory = [{ id: 'salary-1', amount: 3000000, from: '0000-01-01' }];
state.payDay = 25;
state.incomes = [];
// 이전 버전에서 저장된 완료 상태가 남아 있어도 지출 통계에는 영향이 없다.
state.expenses = [
  { id: '1', name: '점심', amount: 10000, date: '2026-01-25', category: 'food', cycleKey: '2026-0', done: true },
  { id: '2', name: '교통', amount: 50000, date: '2026-02-10', category: 'transport', cycleKey: '2026-0', done: false },
  { id: '3', name: '다른 주기', amount: 999999, date: '2026-02-25', category: 'etc', cycleKey: '2026-1', done: false },
];
const c = cycles[0]; // 2026-01-23 ~ 2026-02-24
const s = cycleStats(c);
check('수입', s.totalIncome, 3000000);
check('지출 (다른 주기 제외)', s.totalExpense, 60000);
check('잔액', s.balance, 2940000);
check('주기 일수 (1/23~2/24)', s.totalDays, 33);

console.log('\n=== 고정지출 반복 일정 ===');
const monthlyRent = { day: 10, startDate: '2026-01-10' };
check('월별 반복일을 해당 급여 주기에 배정',
  recurringDatesInCycle(monthlyRent, cycles[0]), [{ date: '2026-02-10', recurrenceMonth: '2026-02' }]);
check('월말보다 긴 반복일은 해당 월 마지막 날로 조정',
  recurringDatesInCycle({ day: 31, startDate: '2026-02-01' }, locateCycle(new Date(2026, 1, 28))),
  [{ date: '2026-02-28', recurrenceMonth: '2026-02' }]);
check('매월 31일은 윤년 2월 29일로 조정',
  local(recurringDateInMonth({ day: 31 }, new Date(2024, 1, 10))), '2024-02-29');
check('2월에 없는 30일은 주말이어도 2월 말일에 반영',
  local(recurringDateInMonth({ day: 30 }, new Date(2026, 1, 10))), '2026-02-28');
check('지정일이 토요일이면 다음 영업일로 이동',
  local(recurringDateInMonth({ day: 15 }, new Date(2026, 7, 1))), '2026-08-17');
check('지정일이 공휴일이면 연휴 끝난 뒤 영업일로 이동',
  local(recurringDateInMonth({ day: 24 }, new Date(2026, 8, 1))), '2026-09-28');
check('실제 결제일이 다음 달로 밀려도 원래 반복 월을 유지',
  recurringDatesInCycle({ day: 31, startDate: '2026-05-01' }, locateCycle(new Date(2026, 5, 1))),
  [{ date: '2026-06-01', recurrenceMonth: '2026-05' }]);
check('매월 1일도 선택 가능',
  local(recurringDateInMonth({ day: 1 }, new Date(2026, 9, 9))), '2026-10-01');
check('이번 달 첫날부터 반복 설정을 적용',
  recurringDatesInCycle({ day: 1, startDate: '2026-10-01' }, locateCycle(new Date(2026, 9, 1))),
  [{ date: '2026-10-01', recurrenceMonth: '2026-10' }]);
check('반복 시작일 이전 일정은 생성하지 않음',
  recurringDatesInCycle({ day: 10, startDate: '2026-02-11' }, cycles[0]), []);
state.expenses = [];
state.recurringExpenses = [{
  id: 'rent', name: '월세', amount: 500000, category: 'housing',
  day: 10, startDate: '2026-01-10',
}];
const recurringCycle = cycles[0];
ensureRecurringExpenses(recurringCycle);
check('고정지출을 별도 완료 상태 없이 생성',
  state.expenses.map(e => [e.name, e.date, 'done' in e, e.cycleKey]),
  [['월세', '2026-02-10', false, '2026-0']]);
ensureRecurringExpenses(recurringCycle);
check('같은 주기를 다시 열어도 고정지출 중복 생성 방지', state.expenses.length, 1);
state.expenses.push({ id: 'past', recurrenceId: 'rent', recurrenceMonth: '2026-01', date: '2026-01-10' });
state.expenses.push({ id: 'future', recurrenceId: 'rent', recurrenceMonth: '2026-03', date: '2026-03-10' });
removeRecurringOccurrencesFromMonth('rent', '2026-02');
check('이번 달부터 삭제해도 지난달 고정지출 기록은 유지',
  state.expenses.map(e => e.id), ['past']);
state.recurringExpenses = [];
ensureRecurringExpenses(recurringCycle);
check('반복 설정 삭제 후 다음 달로 이월되지 않음', state.expenses.map(e => e.id), ['past']);
state.expenses = [];
const neverVisited = { id: 'never-visited', name: '적금', amount: 100000,
  category: 'savings', day: 31, startDate: '2026-01-01' };
materializeRecurringHistory(neverVisited, new Date(2026, 3, 1));
check('방문하지 않은 지난달의 고정지출 기록도 보존',
  state.expenses.map(e => [e.date, e.recurrenceMonth]),
  [['2026-02-02', '2026-01'], ['2026-02-28', '2026-02'], ['2026-03-31', '2026-03']]);
materializeRecurringHistory(neverVisited, new Date(2026, 3, 1));
check('지난달 기록 보강 시 중복 생성 방지', state.expenses.length, 3);
removeRecurringOccurrencesFromMonth('never-visited', '2026-03');
check('중단 시 이번 달 이후만 삭제',
  state.expenses.map(e => e.date), ['2026-02-02', '2026-02-28']);
state.recurringExpenses = [{ id: 'existing', day: 25, startDate: '2026-08-01' }];
state.expenses = [
  { recurrenceId: 'existing', recurrenceMonth: '2026-08', date: '2026-08-25', cycleKey: 'old' },
  { recurrenceId: 'existing', recurrenceMonth: '2026-09', date: '2026-09-25', cycleKey: 'old' },
];
check('이미 생성된 일정은 이번 달부터 다음 영업일로 재계산',
  [rescheduleRecurringOccurrences(new Date(2026, 8, 9)), state.expenses.map(e => e.date)],
  [true, ['2026-08-25', '2026-09-28']]);
check('재계산을 다시 실행해도 변경 없음',
  rescheduleRecurringOccurrences(new Date(2026, 8, 9)), false);
state.recurringExpenses = [{ id: 'end-of-month', day: 31, startDate: '2026-05-01' }];
state.expenses = [{ recurrenceId: 'end-of-month', recurrenceMonth: '2026-05',
  date: '2026-05-31', cycleKey: 'old' }];
check('지난달 말에서 이번 달로 이월된 기존 결제도 재계산',
  [rescheduleRecurringOccurrences(new Date(2026, 5, 1)), state.expenses[0].date],
  [true, '2026-06-01']);

console.log('\n=== 고정지출 D-day ===');
check('남은 날짜는 양수', expenseDaysLeft('2026-10-23', new Date(2026, 9, 9)), 14);
check('당일은 0', expenseDaysLeft('2026-10-09', new Date(2026, 9, 9)), 0);
check('지난 날짜는 음수', expenseDaysLeft('2026-10-08', new Date(2026, 9, 9)), -1);
const todayForList = new Date();
const tomorrowForList = new Date(todayForList.getFullYear(), todayForList.getMonth(), todayForList.getDate() + 1);
const yesterdayForList = new Date(todayForList.getFullYear(), todayForList.getMonth(), todayForList.getDate() - 1);
const listNode = { innerHTML: '', querySelectorAll: () => [] };
sandbox.document.getElementById = () => listNode;
renderExpenseGroup('testList', [
  { id: 'today', recurrenceId: 'rule', date: local(todayForList), name: '당일', amount: 100, category: 'etc' },
  { id: 'future', recurrenceId: 'rule', date: local(tomorrowForList), name: '내일', amount: 100, category: 'etc' },
  { id: 'past', recurrenceId: 'rule', date: local(yesterdayForList), name: '과거', amount: 100, category: 'etc' },
  { id: 'regular', date: local(tomorrowForList), name: '일반', amount: 100, category: 'etc' },
], '');
check('고정지출은 미래/당일만 D-day 표시하고 당일에 강조 스타일 적용',
  [listNode.innerHTML.includes('expense-dday is-today">D-DAY'),
   listNode.innerHTML.includes('expense-dday ">D-1'),
   listNode.innerHTML.split('data-id="past"')[1].split('</button>')[0].includes('expense-dday'),
   listNode.innerHTML.split('data-id="regular"')[1].split('</button>')[0].includes('expense-dday')],
  [true, true, false, false]);

console.log('\n=== 월급 설정 및 수정 ===');
const pastCycle = locateCycle(new Date(2025, 11, 20));
const oldSalary = salaryFor(pastCycle);
updateSalarySettings(3500000, 10, new Date(2026, 0, 5));
check('설정 변경 전 급여 금액 유지', salaryFor(pastCycle), oldSalary);
check('설정 금액은 다음 급여일 주기부터 적용',
  salaryFor(locateCycle(new Date(2026, 0, 10))), 3500000);
check('설정 변경 이전의 과거 월급 유지',
  salaryFor(locateCycle(new Date(2025, 11, 25))), 3000000);
const editableCycle = locateCycle(new Date(2026, 0, 10));
state.incomes.push({
  id: 'salary-edit', type: 'salary', amount: 3400000,
  date: local(editableCycle.payDate), cycleKey: `${editableCycle.year}-${editableCycle.index}`,
});
check('주기별 월급 수정값 반영', cycleStats(editableCycle).totalIncome, 3400000);
check('수정된 월급은 이후 주기에 영향 없음',
  salaryFor(locateCycle(new Date(2026, 1, 10))), 3500000);
const cycleBeforeJan = locateCycle(new Date(2026, 0, 10));
check('이전 주기의 수정된 월급 불러오기 기준값', salaryForCycle(cycleBeforeJan), 3400000);
updateSalarySettings(4000000, 10, new Date(2026, 0, 15));
check('이미 지난 급여일로 설정하면 다음 달부터 적용',
  salaryFor(locateCycle(new Date(2026, 0, 20))), 3500000);
check('다음 급여일부터 새 설정 금액 적용',
  salaryFor(locateCycle(new Date(2026, 1, 10))), 4000000);

async function testRecurringFormFlow() {
  console.log('\n=== 고정지출 등록·수정·중단 흐름 ===');
  const fields = {
    expAmount: { value: '50,000' }, expName: { value: '교통' },
    expDate: { value: '2026-01-01' }, expRecurring: { checked: true },
    expRecurringDay: { value: '31' }, expErr: { textContent: '' },
  };
  sandbox.document.getElementById = id => fields[id];
  vm.runInContext('renderAll = async () => {}; closeSheets = () => {}; toast = () => {};', ctx);
  state.expenses = [];
  state.recurringExpenses = [];
  const now = new Date();
  const currentMonth = local(now).slice(0, 7);
  await saveNewExpense();
  check('체크 선택 시 이번 달부터 매월 31일 반복 등록',
    [state.recurringExpenses[0].day, state.recurringExpenses[0].startDate, state.expenses[0].date],
    [31, `${currentMonth}-01`, local(recurringDateInMonth({ day: 31 }, now))]);

  const rule = state.recurringExpenses[0];
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  rule.startDate = `${local(previousMonth).slice(0, 7)}-01`;
  materializeRecurringHistory(rule, now);
  const pastDate = state.expenses.find(e => e.recurrenceMonth !== currentMonth).date;
  fields.expName.value = '교통 정기권';
  fields.expRecurringDay.value = '7';
  vm.runInContext('editingId = state.expenses.find(e => e.recurrenceMonth === monthKey(new Date())).id', ctx);
  await updateExpense();
  check('고정지출 수정은 지난달 기록을 바꾸지 않음',
    state.expenses.find(e => e.date === pastDate).name, '교통');
  check('고정지출 수정은 이번 달 날짜부터 변경',
    [rule.day, state.expenses.find(e => e.recurrenceMonth === currentMonth).date],
    [7, local(recurringDateInMonth({ day: 7 }, now))]);

  vm.runInContext('editingId = state.expenses.find(e => e.recurrenceMonth === monthKey(new Date())).id', ctx);
  await deleteExpense();
  check('고정지출 중단 시 지난달 기록만 남음',
    [state.recurringExpenses.length, state.expenses.map(e => e.date)], [0, [pastDate]]);
}

testRecurringFormFlow().then(() => {
  console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
  process.exit(fail > 0 ? 1 : 0);
}).catch(error => { console.error(error); process.exit(1); });
