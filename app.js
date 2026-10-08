/**
 * 급여 주기 가계부
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
const setToggle = (id, on) => { const el = $(id); el.classList.toggle('on', on); el.setAttribute('aria-checked', on); };
const getToggle = (id) => $(id).classList.contains('on');
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
function getPayDate(year, month, payDay = state.payDay) {
  const lastDay = new Date(year, month, 0).getDate();
  let d = new Date(year, month - 1, Math.min(payDay, lastDay));
  const hol = new Set([...(HOLIDAYS[year] || []), ...(HOLIDAYS[year + 1] || [])]);
  let guard = 0;
  while ((d.getDay() === 0 || d.getDay() === 6 || hol.has(fmtDate(d))) && guard < 10) {
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
  const lastMonth = new Date(c.end.getFullYear(), c.end.getMonth(), 1);
  while (month <= lastMonth) {
    const year = month.getFullYear();
    const monthNumber = month.getMonth() + 1;
    const day = Math.min(rule.day, new Date(year, monthNumber, 0).getDate());
    const date = new Date(year, monthNumber - 1, day);
    const dateString = fmtDate(date);
    if (date >= c.start && date <= c.end && dateString >= rule.startDate) dates.push(dateString);
    month.setMonth(month.getMonth() + 1);
  }
  return dates;
}

async function ensureRecurringExpenses(c) {
  let changed = false;
  for (const rule of state.recurringExpenses) {
    for (const date of recurringDatesInCycle(rule, c)) {
      const recurrenceMonth = date.slice(0, 7);
      const exists = state.expenses.some(e => e.recurrenceId === rule.id && e.recurrenceMonth === recurrenceMonth);
      if (!exists) {
        state.expenses.push({
          id: uid(),
          name: rule.name,
          amount: rule.amount,
          date,
          category: rule.category,
          cycleKey: cycleKey(c),
          done: false,
          recurrenceId: rule.id,
          recurrenceMonth,
        });
        changed = true;
      }
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

  // 진행바: 지출(회색) + 시간경과(앰버) + 잔여(초록)
  const bar = $('progressBar');
  bar.classList.toggle('neg', s.balance < 0);
  $('barSpent').style.width = `${s.progress}%`;
  const amber = Math.max(0, Math.min(100 - s.progress, s.timePct - s.progress));
  $('barToday').style.width = `${amber}%`;
  $('barRemain').style.width = `${Math.max(0, 100 - s.progress - amber)}%`;

  // 범례
  $('lgRemain').textContent = fmtWan(s.balance);
  $('lgSpent').textContent = fmtWan(s.totalExpense);
  $('lgIncome').textContent = fmtWan(s.totalIncome);

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
  list.innerHTML = sorted.map(e => {
    const cat = catOf(e.category);
    return `
      <div class="row ${e.done ? 'done' : ''}" data-id="${e.id}">
        <div class="ic">${cat.emoji}</div>
        <div class="main">
          <div class="t">${escapeHtml(e.name)}</div>
          <div class="s">${e.date} · ${cat.label} · ${e.done ? '완료' : '예정'}</div>
        </div>
        <div class="a">-${fmtMoney(e.amount)}원</div>
        <div class="chk" data-chk="${e.id}">${e.done ? '✓' : ''}</div>
      </div>`;
  }).join('');

  // 행 클릭 → 수정 시트
  list.querySelectorAll('.row').forEach(row => {
    row.addEventListener('click', () => openEditExpense(row.dataset.id));
  });
  // 체크박스 클릭 → 확인 토글 (수정 시트와 분리)
  list.querySelectorAll('[data-chk]').forEach(chk => {
    chk.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const e = state.expenses.find(x => x.id === chk.dataset.chk);
      if (e) { e.done = !e.done; await saveState(); await renderAll(); }
    });
  });
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
    chip.classList.toggle('on', parseInt(chip.dataset.val, 10) === day);
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
  setToggle('expRecurring', false);
  $('expRecurring').disabled = false;
  $('expErr').textContent = '';
  selectedCat = 'food';
  buildCatChips();
  openSheet('expenseSheet');
}

function openEditExpense(id) {
  const e = state.expenses.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  $('expSheetTitle').textContent = '지출 수정';
  $('expSave').style.display = 'none';
  $('expFoot').style.display = '';
  $('expAmount').value = formatAmountInput(e.amount);
  $('expName').value = e.name;
  setExpenseDate(e.date);
  const isRecurring = !!e.recurrenceId;
  setToggle('expRecurring', isRecurring);
  $('expRecurring').disabled = isRecurring;
  $('expErr').textContent = '';
  selectedCat = e.category;
  buildCatChips();
  openSheet('expenseSheet');
}

function readExpenseForm() {
  const amount = parseInt(digits($('expAmount').value), 10);
  const name = $('expName').value.trim() || catOf(selectedCat).label;
  const date = $('expDate').value;
  if (!amount || amount <= 0) { $('expErr').textContent = '금액을 입력하세요'; return null; }
  if (!date) { $('expErr').textContent = '날짜를 선택하세요'; return null; }
  return { amount, name, date, category: selectedCat };
}

async function saveNewExpense() {
  const f = readExpenseForm(); if (!f) return;
  const c = locateCycle(parseDate(f.date));
  const expense = { id: uid(), ...f, cycleKey: cycleKey(c), done: false };
  if (getToggle('expRecurring')) {
    const recurrenceId = uid();
    const day = parseDate(f.date).getDate();
    state.recurringExpenses.push({ id: recurrenceId, ...f, day, startDate: f.date });
    expense.recurrenceId = recurrenceId;
    expense.recurrenceMonth = f.date.slice(0, 7);
  }
  state.expenses.push(expense);
  await saveState(); closeSheets(); await renderAll();
  toast(`${f.name} ${fmtMoney(f.amount)}원 추가`);
}

async function updateExpense() {
  const f = readExpenseForm(); if (!f) return;
  const e = state.expenses.find(x => x.id === editingId);
  if (!e) return;
  const c = locateCycle(parseDate(f.date));
  Object.assign(e, f, { cycleKey: cycleKey(c) });
  await saveState(); closeSheets(); await renderAll();
  toast('수정되었습니다');
}

async function deleteExpense() {
  if (!editingId) return;
  const expense = state.expenses.find(x => x.id === editingId);
  if (expense?.recurrenceId) {
    if (!confirm('이 고정 지출 설정과 등록된 항목을 모두 삭제할까요?')) return;
    state.recurringExpenses = state.recurringExpenses.filter(rule => rule.id !== expense.recurrenceId);
    state.expenses = state.expenses.filter(item => item.recurrenceId !== expense.recurrenceId);
  } else {
    state.expenses = state.expenses.filter(x => x.id !== editingId);
  }
  await saveState(); closeSheets(); await renderAll();
  toast('삭제되었습니다');
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

    // 기본 뷰 = 현재 주기
    const now = locateCycle(new Date());
    view = { year: now.year, index: now.index };

  // 칩 생성
  buildCatChips();
  buildPayDayChips();

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
  // 토글 버튼 클릭
  $('expRecurring').addEventListener('click', () => setToggle('expRecurring', !getToggle('expRecurring')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('calendarOverlay').hidden) closeCalendar();
      else closeSheets();
    }
  });

    await renderAll();
    registerSW();
  } catch (err) {
    console.error('초기화 실패:', err);
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
