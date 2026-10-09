/**
 * Payroll Management
 * 급여일(기본 25일, 주말·공휴일 → 전 영업일) 기준 예산 주기 계산
 */
'use strict';

import { loadFromDB, saveToDB } from './db.js';

// 한국 공휴일 (필요시 연도 확장)
const HOLIDAYS = {
  2025: ['2025-01-01','2025-01-28','2025-01-29','2025-01-30','2025-03-01',
         '2025-05-05','2025-05-06','2025-06-06','2025-08-15','2025-10-03',
         '2025-10-05','2025-10-06','2025-10-07','2025-10-08','2025-10-09','2025-12-25'],
  2026: ['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01',
         '2026-05-05','2026-05-25','2026-06-06','2026-08-15','2026-09-24',
         '2026-09-25','2026-09-26','2026-09-27','2026-10-03','2026-10-09','2026-12-25'],
  2027: ['2027-01-01','2027-02-05','2027-02-06','2027-02-07','2027-02-08','2027-03-01',
         '2027-05-05','2027-06-06','2027-08-15','2027-09-14','2027-09-15',
         '2027-09-16','2027-09-17','2027-09-18','2027-10-03','2027-10-09','2027-12-25'],
};

const CATEGORIES = [
  { id: 'food',          label: '식비',     emoji: '🍚' },
  { id: 'cafe',          label: '카페/간식', emoji: '☕' },
  { id: 'living',        label: '생활/마트', emoji: '🛒' },
  { id: 'shopping',      label: '쇼핑',     emoji: '🛍️' },
  { id: 'transport',     label: '교통',     emoji: '🚌' },
  { id: 'housing',       label: '주거/통신', emoji: '🏠' },
  { id: 'culture',       label: '문화/여가', emoji: '🎬' },
  { id: 'medical',       label: '의료/보험', emoji: '💊' },
  { id: 'savings',       label: '저축',     emoji: '🐷' },
  { id: 'date',          label: '데이트',   emoji: '💑' },
  { id: 'etc',           label: '기타',     emoji: '✨' },
];
const catOf = (id) => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

/* ============ 상태 ============ */
let state = { payDay: 25, salaryHistory: [], incomes: [], expenses: [], recurringExpenses: [] };
let view = null;          // 보고 있는 주기 {year, index}
let editingId = null;     // 수정 중인 지출 id
let selectedCat = 'food'; // 시트에서 선택된 카테고리

/* ============ 유틸 ============ */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => fmtDate(d).slice(0, 7);
const monthStart = (d) => `${monthKey(d)}-01`;
const fmtKR = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
const fmtMoney = (n) => Math.round(n).toLocaleString('ko-KR');
// 주기 월 표기: 시작월~종료월 (예: 9~10월, 12~1월)
const fmtCycleMonth = (c) => {
  const startMonth = c.start.getMonth() + 1;
  const endMonth = c.end.getMonth() + 1;
  return startMonth === endMonth ? `${startMonth}월` : `${startMonth}~${endMonth}월`;
};
const fmtWan = (n) => {
  const sign = n < 0 ? '-' : '';
  const w = Math.abs(n) / 10000;
  return sign + (w >= 100 ? Math.round(w) : w >= 10 ? Math.round(w) : w.toFixed(1)) + '만';
};
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => s.replace(/[^\d]/g, '');
const formatAmountInput = (value) => {
  const number = digits(String(value)).replace(/^0+/, '');
  return number.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

function formatAmountInputValue(input) {
  const cursor = input.selectionStart;
  const digitsBeforeCursor = digits(input.value.slice(0, cursor)).length;
  input.value = formatAmountInput(input.value);
  if (cursor !== null) {
    let nextCursor = 0;
    let digitsSeen = 0;
    while (nextCursor < input.value.length && digitsSeen < digitsBeforeCursor) {
      if (/\d/.test(input.value[nextCursor])) digitsSeen++;
      nextCursor++;
    }
    input.setSelectionRange(nextCursor, nextCursor);
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ============ 급여일 / 주기 계산 ============ */
function isNonBusinessDay(d) {
  return d.getDay() === 0 || d.getDay() === 6 || (HOLIDAYS[d.getFullYear()] || []).includes(fmtDate(d));
}

function getPayDate(year, month, payDay = state.payDay) {
  const lastDay = new Date(year, month, 0).getDate();
  let d = new Date(year, month - 1, Math.min(payDay, lastDay));
  let guard = 0;
  while (isNonBusinessDay(d) && guard < 10) {
    d.setDate(d.getDate() - 1);
    guard++;
  }
  return d;
}

function nextPayDate(today, payDay) {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let date = getPayDate(today.getFullYear(), today.getMonth() + 1, payDay);
  if (date < todayStart) date = getPayDate(today.getFullYear(), today.getMonth() + 2, payDay);
  return date;
}

function generateYearCycles(year) {
  const payDates = [];
  for (let m = 1; m <= 13; m++) {
    payDates.push(getPayDate(year + (m > 12 ? 1 : 0), ((m - 1) % 12) + 1));
  }
  // 주기 M = [M월 급여일, (M+1)월 급여일 전일]
  // 급여일当天부터 다음 급여 전일까지 → 공백/중복 없음
  const cycles = [];
  for (let i = 0; i < 12; i++) {
    cycles.push({
      index: i,
      year,
      month: i + 1,
      start: payDates[i],
      end: new Date(payDates[i + 1].getTime() - 864e5),
      payDate: payDates[i],
    });
  }
  return cycles;
}

function locateCycle(date) {
  for (const y of [date.getFullYear() - 1, date.getFullYear()]) {
    for (const c of generateYearCycles(y)) {
      if (date >= c.start && date <= c.end) return c;
    }
  }
  return generateYearCycles(date.getFullYear())[0];
}

function getViewCycle() {
  if (view) {
    const c = generateYearCycles(view.year)[view.index];
    if (c) return c;
  }
  return locateCycle(new Date());
}

function cycleKey(c) { return `${c.year}-${c.index}`; }

/* ============ 데이터 ============ */
async function loadState() {
  try {
    const saved = await loadFromDB();
    if (saved) state = { ...state, ...saved };
  } catch (e) { console.error('로드 실패', e); }
  // 마이그레이션: 단일 monthlySalary → 급여 이력 (전체 주기에 적용)
  if (!Array.isArray(state.salaryHistory) || state.salaryHistory.length === 0) {
    state.salaryHistory = [{ id: uid(), amount: state.monthlySalary || 0, from: '0000-01-01' }];
  }
  if (!Array.isArray(state.recurringExpenses)) state.recurringExpenses = [];
  delete state.monthlySalary;
}
async function saveState() {
  try { await saveToDB(state); }
  catch (e) { console.error('저장 실패', e); }
}

// 특정 주기에 적용되는 급여 (from <= 주기 시작일 중 가장 최근 것)
function salaryFor(c) {
  const startStr = fmtDate(c.start);
  let amount = 0;
  for (const s of [...state.salaryHistory].sort((a, b) => a.from.localeCompare(b.from))) {
    if (s.from <= startStr) amount = s.amount;
  }
  return amount;
}

function salaryForCycle(c) {
  const override = state.incomes.find(i => i.type === 'salary' && i.cycleKey === cycleKey(c));
  return override ? override.amount : salaryFor(c);
}

function loadPreviousSalary(inputId) {
  const currentCycle = getViewCycle();
  const previousCycle = locateCycle(new Date(currentCycle.start.getTime() - 864e5));
  const amount = salaryForCycle(previousCycle);
  if (amount <= 0) {
    toast('지난달에 등록된 월급이 없습니다');
    return;
  }
  $(inputId).value = formatAmountInput(amount);
  toast(`${fmtCycleMonth(previousCycle)} 주기 월급을 불러왔습니다`);
}

function configuredSalary() {
  const history = [...state.salaryHistory].sort((a, b) => a.from.localeCompare(b.from));
  return history.length ? history[history.length - 1].amount : 0;
}

function updateSalarySettings(amount, payDay, today = new Date()) {
  const from = fmtDate(nextPayDate(today, payDay));
  state.salaryHistory = state.salaryHistory.filter(s => s.from < from);
  state.salaryHistory.push({ id: uid(), amount, from });
  state.payDay = payDay;
}

function recurringDatesInCycle(rule, c) {
  const dates = [];
  const month = new Date(c.start.getFullYear(), c.start.getMonth(), 1);
  // 지난달 말일이 주말이면 이 급여 주기의 첫날 이후로 밀릴 수 있다.
  month.setMonth(month.getMonth() - 1);
  const lastMonth = new Date(c.end.getFullYear(), c.end.getMonth(), 1);
  while (month <= lastMonth) {
    const recurrenceMonth = monthKey(month);
    const planned = recurringPlannedDate(rule, month);
    const date = recurringDateInMonth(rule, month);
    const dateString = fmtDate(date);
    if (date >= c.start && date <= c.end && fmtDate(planned) >= rule.startDate) {
      dates.push({ date: dateString, recurrenceMonth });
    }
    month.setMonth(month.getMonth() + 1);
  }
  return dates;
}

function recurringPlannedDate(rule, month) {
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return new Date(month.getFullYear(), month.getMonth(), Math.min(rule.day, lastDay));
}

function recurringDateInMonth(rule, now) {
  const date = recurringPlannedDate(rule, now);
  // 해당 월에 지정일이 없으면 말일에 적용하고 다음 달로 넘기지 않는다.
  if (date.getDate() !== rule.day) return date;
  let guard = 0;
  while (isNonBusinessDay(date) && guard < 10) {
    date.setDate(date.getDate() + 1);
    guard++;
  }
  return date;
}

function addRecurringOccurrence(rule, date, c, recurrenceMonth) {
  const exists = state.expenses.some(e => e.recurrenceId === rule.id && e.recurrenceMonth === recurrenceMonth);
  if (exists) return false;
  state.expenses.push({
    id: uid(), name: rule.name, amount: rule.amount, date, category: rule.category,
    cycleKey: cycleKey(c), recurrenceId: rule.id, recurrenceMonth,
  });
  return true;
}

// 열어보지 않은 과거 급여 주기도 종료/수정 전에 기록으로 확정한다.
function materializeRecurringHistory(rule, now) {
  const month = parseDate(rule.startDate);
  month.setDate(1);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  while (month < currentMonth) {
    const date = recurringDateInMonth(rule, month);
    const dateString = fmtDate(date);
    if (fmtDate(recurringPlannedDate(rule, month)) >= rule.startDate) {
      addRecurringOccurrence(rule, dateString, locateCycle(date), monthKey(month));
    }
    month.setMonth(month.getMonth() + 1);
  }
}

// 이번 달 이후 일정과 지난달 말에서 이번 달로 이월된 일정을 새 규칙으로 맞춘다.
function rescheduleRecurringOccurrences(now) {
  const fromMonth = monthKey(now);
  let changed = false;
  for (const e of state.expenses) {
    if (!e.recurrenceId || e.deleted) continue;
    const rule = state.recurringExpenses.find(r => r.id === e.recurrenceId);
    if (!rule) continue;
    const recurrenceMonth = e.recurrenceMonth || e.date.slice(0, 7);
    const [year, month] = recurrenceMonth.split('-').map(Number);
    const date = recurringDateInMonth(rule, new Date(year, month - 1, 1));
    if (recurrenceMonth < fromMonth && monthKey(date) < fromMonth) continue;
    const dateString = fmtDate(date);
    const key = cycleKey(locateCycle(date));
    if (e.date !== dateString || e.cycleKey !== key || e.recurrenceMonth !== recurrenceMonth) {
      Object.assign(e, { date: dateString, cycleKey: key, recurrenceMonth });
      changed = true;
    }
  }
  return changed;
}

// 반복 설정을 종료하거나 바꿀 때 지난달까지의 실제 내역은 그대로 남긴다.
function removeRecurringOccurrencesFromMonth(ruleId, fromMonth) {
  state.expenses = state.expenses.filter(e =>
    e.recurrenceId !== ruleId || (e.recurrenceMonth || e.date.slice(0, 7)) < fromMonth
  );
}

async function ensureRecurringExpenses(c) {
  let changed = false;
  for (const rule of state.recurringExpenses) {
    for (const { date, recurrenceMonth } of recurringDatesInCycle(rule, c)) {
      if (addRecurringOccurrence(rule, date, c, recurrenceMonth)) changed = true;
    }
  }
  if (changed) await saveState();
}

/* ============ 통계 ============ */
function cycleStats(c) {
  const key = cycleKey(c);
  const incomes = state.incomes.filter(i => i.type !== 'salary' && i.cycleKey === key);
  const expenses = state.expenses.filter(e => e.cycleKey === key && !e.deleted);
  const totalIncome = salaryForCycle(c)
    + incomes.reduce((s, i) => s + i.amount, 0);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const balance = totalIncome - totalExpense;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const totalDays = Math.round((c.end - c.start) / 864e5) + 1;
  const remainingDays = Math.max(0, Math.ceil((c.end - today) / 864e5));
  const elapsedDays = Math.min(totalDays, Math.max(1, totalDays - remainingDays));
  const progress = totalIncome > 0 ? Math.min(100, (totalExpense / totalIncome) * 100) : 0;
  // 시간 경과율 (오늘 위치) - 진행바의 amber 구간
  const timePct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));

  return { incomes, expenses, totalIncome, totalExpense, balance,
           totalDays, remainingDays, elapsedDays, progress, timePct };
}

/* ============ 렌더링 ============ */
async function renderAll() {
  const c = getViewCycle();
  await ensureRecurringExpenses(c);
  const s = cycleStats(c);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 상단 제목
  $('cycleTitle').firstChild.textContent = fmtCycleMonth(c);
  const startYear = c.start.getFullYear();
  const endYear = c.end.getFullYear();
  $('cycleYear').textContent = startYear === endYear
    ? String(startYear)
    : `${startYear}~${String(endYear).slice(2)}`;

  // 주기 범위 + D-day (다음 급여일까지)
  $('cycleRange').textContent = `${fmtKR(c.start)} ~ ${fmtKR(c.end)}  (${s.totalDays}일)`;
  const ddayEl = $('ddayBadge');
  const nextPay = new Date(c.end.getTime() + 864e5);
  const dday = Math.ceil((nextPay - today) / 864e5);
  ddayEl.textContent = dday >= 0 ? `D-${dday}` : '급여일';
  ddayEl.classList.toggle('late', dday >= 0 && dday <= 3);

  // 잔액 (big)
  const big = $('balanceBig');
  big.innerHTML = `${fmtMoney(Math.abs(s.balance))}<small>원</small>`;
  big.classList.toggle('neg', s.balance < 0);

  // 진행바: 지출(회색) + 남은예산(초록) — 급여를 100% 기준으로
  const bar = $('progressBar');
  bar.classList.toggle('neg', s.balance < 0);
  const spentPct = Math.min(100, s.progress); // 지출 비율 (급여 대비)
  $('barSpent').style.width = `${spentPct}%`;
  $('barRemain').style.width = `${Math.max(0, 100 - spentPct)}%`;

  // 범례
  $('lgRemain').textContent = fmtWan(s.balance);
  $('lgSpent').textContent = fmtWan(s.totalExpense);

  const salaryButton = $('addIncomeBtn');
  const hasSalary = salaryForCycle(c) > 0;
  salaryButton.textContent = hasSalary ? '급여 수정' : '급여 입력';
  salaryButton.setAttribute('aria-label', hasSalary ? '급여 수정' : '급여 입력');

  // 지출 리스트
  renderExpenses(s.expenses);
}

function renderExpenses(expenses) {
  $('expenseCount').textContent = `${expenses.length}건`;

  const recurring = expenses.filter(e => e.recurrenceId);
  const regular = expenses.filter(e => !e.recurrenceId);
  $('recurringExpenseCount').textContent = `${recurring.length}건`;
  $('regularExpenseCount').textContent = `${regular.length}건`;
  renderExpenseGroup('recurringExpenseList', recurring, '등록된 고정지출이 없습니다');
  renderExpenseGroup('regularExpenseList', regular, '등록된 지출이 없습니다');
}

function renderExpenseGroup(listId, expenses, emptyMessage) {
  const list = $(listId);
  if (expenses.length === 0) {
    list.innerHTML = `<div class="empty">${emptyMessage}</div>`;
    return;
  }

  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
  const today = new Date();
  list.innerHTML = sorted.map(e => {
    const cat = catOf(e.category);
    const daysLeft = e.recurrenceId ? expenseDaysLeft(e.date, today) : -1;
    const ddayText = daysLeft === 0 ? 'D-DAY' : `D-${daysLeft}`;
    return `
      <button type="button" class="row" data-id="${escapeHtml(e.id)}" aria-label="${escapeHtml(e.name)}, ${fmtMoney(e.amount)}원, ${escapeHtml(e.date)}, ${cat.label}${daysLeft >= 0 ? `, ${ddayText}` : ''}, 수정">
        <span class="ic" aria-hidden="true">${cat.emoji}</span>
        <span class="main">
          <span class="row-top">
            <span class="t">${escapeHtml(e.name)}</span>
            <span class="a">-${fmtMoney(e.amount)}원</span>
          </span>
          <span class="row-bottom">
            <span class="s">${escapeHtml(e.date)} · ${cat.label}</span>
            ${daysLeft >= 0 ? `<span class="expense-dday ${daysLeft === 0 ? 'is-today' : ''}">${ddayText}</span>` : ''}
          </span>
        </span>
      </button>`;
  }).join('');

  // 행 클릭 → 수정 시트
  list.querySelectorAll('.row').forEach(row => {
    row.addEventListener('click', () => openEditExpense(row.dataset.id));
  });
}

function expenseDaysLeft(date, today = new Date()) {
  const due = parseDate(date);
  const utcDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utcDay(due) - utcDay(today)) / 864e5);
}

/* ============ 시트 공통 ============ */
function openSheet(id) {
  document.body.classList.add('modal-open');
  $('overlay').classList.add('on');
  $(id).classList.add('on');
}
function closeSheets() {
  closeCalendar(false);
  $('overlay').classList.remove('on');
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('on'));
  document.body.classList.remove('modal-open');
  editingId = null;
}

/* ============ 급여일 칩 ============ */
function buildPayDayChips() {
  $('payDayChips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => syncPayDayUI(parseInt(chip.dataset.val, 10)));
  });
}

function syncPayDayUI(day) {
  $('payDayChips').querySelectorAll('.chip').forEach(chip => {
    const isActive = parseInt(chip.dataset.val, 10) === day;
    chip.classList.toggle('on', isActive);
    chip.setAttribute('aria-checked', isActive);
  });
}

/* ============ 카테고리 칩 ============ */
function buildCatChips() {
  $('catChips').innerHTML = CATEGORIES.map(c =>
    `<button type="button" class="chip ${c.id === selectedCat ? 'on' : ''}" data-cat="${c.id}" aria-pressed="${c.id === selectedCat}">${c.emoji} ${c.label}</button>`
  ).join('');
  $('catChips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedCat = chip.dataset.cat;
      $('catChips').querySelectorAll('.chip').forEach(x => {
        const active = x === chip;
        x.classList.toggle('on', active);
        x.setAttribute('aria-pressed', active);
      });
    });
  });
}

/* ============ 지출 날짜 선택 ============ */
let calendarView = null;
function syncExpenseDateUI() {
  const recurring = $('expRecurring').checked;
  $('dateLabel').textContent = recurring ? '매월 지출일' : '날짜';
  $('expDateTrigger').hidden = recurring;
  $('expRecurringDay').hidden = !recurring;
  $('expRecurringHint').hidden = !recurring;
  $('expRecurringHint').textContent = editingId
    ? '변경·삭제는 이번 달부터 적용 · 지난달 기록은 유지'
    : '없는 날짜는 말일 · 주말·공휴일은 다음 영업일';
}

function setExpenseDate(value) {
  $('expDate').value = value;
  const date = parseDate(value);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  $('expDateText').textContent = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} (${weekday})`;
}

function renderCalendar() {
  const { year, month } = calendarView;
  $('calendarMonth').textContent = `${year}년 ${month + 1}월`;
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const selected = $('expDate').value;
  const today = fmtDate(new Date());
  const blankDays = Array.from({ length: firstWeekday }, () => '<span aria-hidden="true"></span>');
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const value = `${year}-${pad(month + 1)}-${pad(day)}`;
    const classes = [value === today ? 'is-today' : '', value === selected ? 'is-selected' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-date="${value}" aria-label="${year}년 ${month + 1}월 ${day}일" aria-pressed="${value === selected}">${day}</button>`;
  });
  $('calendarDays').innerHTML = [...blankDays, ...days].join('');
}

function openCalendar() {
  const date = parseDate($('expDate').value || fmtDate(new Date()));
  calendarView = { year: date.getFullYear(), month: date.getMonth() };
  renderCalendar();
  $('calendarOverlay').hidden = false;
  $('expenseSheet').inert = true;
  $('calendarClose').focus();
}

function closeCalendar(restoreFocus = true) {
  if ($('calendarOverlay').hidden) return;
  $('calendarOverlay').hidden = true;
  $('expenseSheet').inert = false;
  if (restoreFocus) $('expDateTrigger').focus();
}

function moveCalendarMonth(offset) {
  const date = new Date(calendarView.year, calendarView.month + offset, 1);
  calendarView = { year: date.getFullYear(), month: date.getMonth() };
  renderCalendar();
}

/* ============ 지출 추가/수정 ============ */
function openAddExpense() {
  editingId = null;
  $('expSheetTitle').textContent = '지출 추가';
  $('expSave').style.display = '';
  $('expFoot').style.display = 'none';
  $('expAmount').value = '';
  $('expName').value = '';
  setExpenseDate(fmtDate(new Date()));
  $('expRecurring').checked = false;
  $('expRecurring').disabled = false;
  $('expRecurringDay').disabled = false;
  $('expRecurringDay').value = String(new Date().getDate());
  syncExpenseDateUI();
  $('expErr').textContent = '';
  selectedCat = 'food';
  buildCatChips();
  openSheet('expenseSheet');
}

function openEditExpense(id) {
  const e = state.expenses.find(x => x.id === id);
  if (!e) return;
  const rule = state.recurringExpenses.find(x => x.id === e.recurrenceId);
  const item = rule || e;
  editingId = id;
  $('expSheetTitle').textContent = e.recurrenceId ? '고정 지출 수정' : '지출 수정';
  $('expSave').style.display = 'none';
  $('expFoot').style.display = '';
  $('expAmount').value = formatAmountInput(item.amount);
  $('expName').value = item.name;
  setExpenseDate(e.date);
  $('expRecurring').checked = !!e.recurrenceId;
  $('expRecurring').disabled = true;
  $('expRecurringDay').value = String(rule?.day || parseDate(e.date).getDate());
  $('expRecurringDay').disabled = !!e.recurrenceId && !rule;
  syncExpenseDateUI();
  if (e.recurrenceId && !rule) $('expRecurringHint').textContent = '종료된 고정 지출 · 이 내역만 수정·삭제';
  $('expErr').textContent = '';
  selectedCat = item.category;
  buildCatChips();
  openSheet('expenseSheet');
}

function readExpenseForm() {
  const amount = parseInt(digits($('expAmount').value), 10);
  const name = $('expName').value.trim() || catOf(selectedCat).label;
  if (!amount || amount <= 0) { $('expErr').textContent = '금액을 입력하세요'; return null; }
  if ($('expRecurring').checked) {
    const day = Number($('expRecurringDay').value);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      $('expErr').textContent = '매월 지출일을 선택하세요'; return null;
    }
    return { amount, name, category: selectedCat, day };
  }
  const date = $('expDate').value;
  if (!date) { $('expErr').textContent = '날짜를 선택하세요'; return null; }
  return { amount, name, date, category: selectedCat };
}

async function saveNewExpense() {
  const f = readExpenseForm(); if (!f) return;
  if ($('expRecurring').checked) {
    const now = new Date();
    const rule = { id: uid(), ...f, startDate: monthStart(now) };
    state.recurringExpenses.push(rule);
    await ensureRecurringExpenses(locateCycle(recurringDateInMonth(rule, now)));
  } else {
    const c = locateCycle(parseDate(f.date));
    state.expenses.push({ id: uid(), ...f, cycleKey: cycleKey(c) });
  }
  await saveState(); closeSheets(); await renderAll();
  toast(`${f.name} ${fmtMoney(f.amount)}원 추가`);
}

async function updateExpense() {
  const f = readExpenseForm(); if (!f) return;
  const e = state.expenses.find(x => x.id === editingId);
  if (!e) return;
  const rule = state.recurringExpenses.find(x => x.id === e.recurrenceId);
  if (rule) {
    const now = new Date();
    const fromMonth = monthKey(now);
    materializeRecurringHistory(rule, now);
    // 지워진 주기(초기화한 주기)의 표시 억제 기록은 유지한다.
    state.expenses = state.expenses.filter(item =>
      item.recurrenceId !== rule.id || (item.recurrenceMonth || item.date.slice(0, 7)) < fromMonth || item.deleted
    );
    Object.assign(rule, f);
    await ensureRecurringExpenses(locateCycle(recurringDateInMonth(rule, now)));
  } else if (e.recurrenceId) {
    Object.assign(e, { name: f.name, amount: f.amount, category: f.category });
  } else {
    const c = locateCycle(parseDate(f.date));
    Object.assign(e, f, { cycleKey: cycleKey(c) });
  }
  await saveState(); closeSheets(); await renderAll();
  toast('수정되었습니다');
}

async function deleteExpense() {
  if (!editingId) return;
  const expense = state.expenses.find(x => x.id === editingId);
  if (!expense) return;
  const rule = state.recurringExpenses.find(x => x.id === expense?.recurrenceId);
  const stoppedRecurring = !!rule;
  if (rule) {
    if (!confirm('이 고정 지출을 이번 달부터 중단할까요? 지난달까지의 기록은 남습니다.')) return;
    const now = new Date();
    materializeRecurringHistory(rule, now);
    state.recurringExpenses = state.recurringExpenses.filter(item => item.id !== rule.id);
    removeRecurringOccurrencesFromMonth(rule.id, monthKey(now));
  } else {
    if (expense?.recurrenceId && !confirm('지난 고정 지출 내역을 삭제할까요?')) return;
    state.expenses = state.expenses.filter(x => x.id !== editingId);
  }
  await saveState(); closeSheets(); await renderAll();
  toast(stoppedRecurring ? '이번 달부터 고정 지출이 중단되었습니다' : '삭제되었습니다');
}

/* ============ 급여 입력 ============ */
function openIncome() {
  const c = getViewCycle();
  const override = state.incomes.find(i => i.type === 'salary' && i.cycleKey === cycleKey(c));
  $('incAmount').value = formatAmountInput(override ? override.amount : salaryFor(c) || '');
  $('incErr').textContent = '';
  $('incReset').style.display = override ? '' : 'none';
  syncPayDayUI(state.payDay);
  openSheet('incomeSheet');
  setTimeout(() => $('incAmount').focus(), 250);
}

async function saveIncome() {
  const amount = parseInt(digits($('incAmount').value), 10);
  if (!amount || amount <= 0) { $('incErr').textContent = '금액을 입력하세요'; return; }
  const activeChip = $('payDayChips').querySelector('.chip.on');
  const payDay = activeChip ? parseInt(activeChip.dataset.val, 10) : 0;
  if (!payDay) { $('incErr').textContent = '급여일을 선택하세요'; return; }

  // 급여일이 바뀌었으면 다음 급여일부터 새 설정 적용
  if (payDay !== state.payDay) {
    updateSalarySettings(amount, payDay);
  } else {
    // 급여일 동일: 이번 주기 금액만 override
    const c = getViewCycle();
    const existing = state.incomes.find(i => i.type === 'salary' && i.cycleKey === cycleKey(c));
    if (existing) {
      existing.amount = amount;
    } else {
      state.incomes.push({ id: uid(), type: 'salary', amount, date: fmtDate(c.payDate), cycleKey: cycleKey(c) });
    }
  }
  await saveState(); closeSheets(); await renderAll();
  toast(`${fmtMoney(amount)}원 급여 저장됨`);
}

async function resetIncome() {
  const c = getViewCycle();
  const defaultAmount = salaryFor(c);
  if (!confirm(`${fmtCycleMonth(c)} 주기 급여를 초기화할까요?\n설정된 기본 월급(${fmtMoney(defaultAmount)}원)으로 돌아갑니다.`)) return;
  state.incomes = state.incomes.filter(i => !(i.type === 'salary' && i.cycleKey === cycleKey(c)));
  await saveState(); closeSheets(); await renderAll();
  toast('급여가 초기화되었습니다');
}

/* ============ 주기 초기화 ============ */
async function clearCycle() {
  const c = getViewCycle();
  if (!confirm(`${fmtCycleMonth(c)} 주기(${fmtKR(c.start)} ~ ${fmtKR(c.end)})의\n지출 내역을 모두 삭제하시겠습니까?`)) return;
  const key = cycleKey(c);
  state.expenses = state.expenses.filter(e => {
    if (e.cycleKey !== key) return true;
    if (e.recurrenceId) {
      e.deleted = true;
      return true;
    }
    return false;
  });
  state.incomes = state.incomes.filter(i => i.cycleKey !== key || i.type === 'salary');
  await saveState(); await renderAll();
  toast('주기가 초기화되었습니다');
}

/* ============ 주기 네비게이션 ============ */
async function navigate(dir) {
  const c = getViewCycle();
  let { year, index } = c;
  index += dir;
  if (index > 11) { index = 0; year += 1; }
  if (index < 0) { index = 11; year -= 1; }
  view = { year, index };
  await renderAll();
}

/* ============ 초기화 ============ */
async function init() {
  try {
    await loadState();
    if (rescheduleRecurringOccurrences(new Date())) await saveState();

    // 기본 뷰 = 현재 주기
    const now = locateCycle(new Date());
    view = { year: now.year, index: now.index };

  // 칩 생성
  buildCatChips();
  buildPayDayChips();
  $('expRecurringDay').innerHTML = Array.from({ length: 31 }, (_, i) =>
    `<option value="${i + 1}">${i + 1}일</option>`
  ).join('');

  // 금액 입력: 숫자만
  ['expAmount', 'incAmount'].forEach(id => {
    $(id).addEventListener('input', (e) => formatAmountInputValue(e.target));
  });

  // 이벤트 바인딩
  $('prevCycle').addEventListener('click', () => navigate(-1));
  $('nextCycle').addEventListener('click', () => navigate(1));
  $('addExpenseBtn').addEventListener('click', openAddExpense);
  $('addIncomeBtn').addEventListener('click', openIncome);
  $('clearBtn').addEventListener('click', clearCycle);
  $('expSave').addEventListener('click', saveNewExpense);
  $('expUpdate').addEventListener('click', updateExpense);
  $('expDelete').addEventListener('click', deleteExpense);
  $('expClose').addEventListener('click', closeSheets);
  $('expDateTrigger').addEventListener('click', openCalendar);
  $('calendarClose').addEventListener('click', () => closeCalendar());
  $('calendarPrev').addEventListener('click', () => moveCalendarMonth(-1));
  $('calendarNext').addEventListener('click', () => moveCalendarMonth(1));
  $('calendarToday').addEventListener('click', () => { setExpenseDate(fmtDate(new Date())); closeCalendar(); });
  $('calendarDays').addEventListener('click', (event) => {
    const day = event.target.closest('button[data-date]');
    if (day) { setExpenseDate(day.dataset.date); closeCalendar(); }
  });
  $('calendarOverlay').addEventListener('click', (event) => {
    if (event.target === $('calendarOverlay')) closeCalendar();
  });
  $('calendarOverlay').addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const buttons = [...$('calendarOverlay').querySelectorAll('button')];
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
  });
  $('incSave').addEventListener('click', saveIncome);
  $('incReset').addEventListener('click', resetIncome);
  $('loadPreviousIncomeSalary').addEventListener('click', () => loadPreviousSalary('incAmount'));
  $('overlay').addEventListener('click', closeSheets);
  $('expRecurring').addEventListener('change', syncExpenseDateUI);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('calendarOverlay').hidden) closeCalendar();
      else closeSheets();
    }
  });

    await renderAll();

    // 로딩 스크린 자연스럽게 숨기기
    const loadingScreen = document.getElementById('loadingScreen');
    const app = document.getElementById('app');
    if (loadingScreen && app) {
      loadingScreen.classList.add('hidden');
      // 앱 표시 (opacity transition)
      requestAnimationFrame(() => {
        app.style.opacity = '1';
        app.style.visibility = 'visible';
      });
    }

    registerSW();
  } catch (err) {
    console.error('초기화 실패:', err);
    // 에러 시에도 로딩 스크린 숨김
    const loadingScreen = document.getElementById('loadingScreen');
    const app = document.getElementById('app');
    if (loadingScreen) loadingScreen.classList.add('hidden');
    if (app) { app.style.opacity = '1'; app.style.visibility = 'visible'; }
  }
}

/* ============ Service Worker ============ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('SW 등록:', reg.scope))
        .catch(err => console.log('SW 등록 실패:', err));
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
} else {
  init().catch(console.error);
}
