/**
 * 데이터 마이그레이션 시스템
 *
 * 목적: 프로젝트 업데이트 시 데이터 구조 변경이 필요할 때, 기존 사용자의 데이터를 자동으로 마이그레이션합니다.
 *
 * 동작 원리:
 * 1. 쿠키(`lastMigrationDate`)에 마지막 마이그레이션 실행 날짜를 저장합니다.
 * 2. 앱 초기화 시 `runMigrations()`를 호출합니다.
 * 3. `runMigrations()`는 저장된 날짜보다 최신인 마이그레이션만 순차적으로 실행합니다.
 * 4. 모든 마이그레이션이 완료되면 쿠키를 현재 날짜로 갱신합니다.
 *
 * 마이그레이션 추가 방법:
 * - `MIGRATIONS` 배열에 `{ date: 'YYYY-MM-DD', fn: async (state) => { ... } }` 형태의 객체를 추가합니다.
 * - `date`는 마이그레이션이 작성된 날짜(ISO 8601 형식)입니다.
 * - `fn`은 현재 `state` 객체를 받아 수정된 state를 반환하는 비동기 함수입니다.
 * - 배열은 날짜순(오래된 순)으로 정렬되어 있어야 합니다.
 *
 * 주의사항:
 * - 마이그레이션 함수는 **멱등성(idempotent)**을 가져야 합니다. 중복 실행되어도 문제가 없어야 합니다.
 * - 마이그레이션 내부에서 `saveToDB`를 직접 호출하지 마세요. `runMigrations`가 마지막에 한 번 저장합니다.
 * - state 구조 변경 시 기존 데이터와의 호환성을 고려하세요.
 */

import { loadFromDB, saveToDB } from './db.js';

const COOKIE_NAME = 'paycycle_last_migration';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10; // 10년

/**
 * 쿠키에서 마지막 마이그레이션 날짜를 읽습니다.
 * @returns {string|null} ISO 날짜 문자열(YYYY-MM-DD) 또는 null
 */
function getLastMigrationDate() {
  const cookies = document.cookie.split('; ');
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(value);
  }
  return null;
}

/**
 * 쿠키에 마지막 마이그레이션 날짜를 저장합니다.
 * @param {string} date - ISO 날짜 문자열(YYYY-MM-DD)
 */
function setLastMigrationDate(date) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(date)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

/**
 * 오늘 날짜를 YYYY-MM-DD 형식으로 반환합니다.
 * @returns {string}
 */
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 마이그레이션 정의 배열
 * 새로운 마이그레이션이 필요할 때 이 배열에만 추가하면 됩니다.
 * 날짜순(오래된 것부터)으로 정렬해야 합니다.
 *
 * @type {Array<{date: string, fn: (state: any) => Promise<any>}>}
 */
const MIGRATIONS = [
  // 예시 마이그레이션 (실제로는 아래 실제 마이그레이션들이 있습니다)
  // {
  //   date: '2025-01-15',
  //   fn: async (state) => {
  //     // state.monthlySalary → state.salaryHistory 변환
  //     if (state.monthlySalary && (!state.salaryHistory || state.salaryHistory.length === 0)) {
  //       state.salaryHistory = [{ id: 'migrated', amount: state.monthlySalary, from: '0000-01-01' }];
  //       delete state.monthlySalary;
  //     }
  //     return state;
  //   }
  // },
];

/**
 * 데이터 마이그레이션을 실행합니다.
 * 저장된 마지막 마이그레이션 날짜보다 최신인 마이그레이션만 순차 실행합니다.
 *
 * @returns {Promise<void>}
 */
export async function runMigrations() {
  const lastDate = getLastMigrationDate();
  const today = todayISO();

  // 실행할 마이그레이션 필터링
  const pending = MIGRATIONS.filter(m => !lastDate || m.date > lastDate);

  if (pending.length === 0) {
    // 마이그레이션이 없으면 쿠키만 갱신(최신화)
    if (lastDate !== today) setLastMigrationDate(today);
    return;
  }

  console.log(`[Migration] ${pending.length}개 마이그레이션 실행 예정`);

  // 현재 state 로드
  let state = await loadFromDB();
  if (!state) {
    console.log('[Migration] 저장된 state 없음, 마이그레이션 건너뜀');
    setLastMigrationDate(today);
    return;
  }

  // 각 마이그레이션 순차 실행
  for (const migration of pending) {
    console.log(`[Migration] 실행: ${migration.date}`);
    try {
      state = await migration.fn(state);
      console.log(`[Migration] 완료: ${migration.date}`);
    } catch (err) {
      console.error(`[Migration] 실패: ${migration.date}`, err);
      throw err; // 실패 시 중단, 다음 실행 시 재시도
    }
  }

  // 모든 마이그레이션 완료 후 저장
  await saveToDB(state);
  setLastMigrationDate(today);
  console.log('[Migration] 모두 완료, 쿠키 갱신:', today);
}

/**
 * 개발/테스트용: 마이그레이션 강제 재실행을 위해 쿠키를 삭제합니다.
 */
export function resetMigrationCookie() {
  document.cookie = `${COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax`;
  console.log('[Migration] 쿠키 초기화됨');
}

/**
 * 개발/테스트용: 현재 쿠키 값을 확인합니다.
 * @returns {string|null}
 */
export function getMigrationCookie() {
  return getLastMigrationDate();
}