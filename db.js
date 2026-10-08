/**
 * IndexedDB 래퍼
 * DB: 'paycycle_db', Store: 'kv' (key-value)
 */
'use strict';

const DB_NAME    = 'paycycle_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const STATE_KEY  = 'state';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 저장된 state를 불러옵니다. 없으면 null 반환.
 * @returns {Promise<object|null>}
 */
export async function loadFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror  = () => reject(req.error);
  });
}

/**
 * state 객체를 IndexedDB에 저장합니다.
 * @param {object} state
 * @returns {Promise<void>}
 */
export async function saveToDB(state) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(state, STATE_KEY);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}
