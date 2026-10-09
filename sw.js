/**
 * Service Worker - 오프라인 지원
 * 정적 자산 캐시 + 네트워크 우선 전략
 */

const CACHE_NAME = 'paycycle-v9';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 설치 시 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 활성화 시 오래된 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 요청 처리 - 캐시 우선, 없으면 네트워크
self.addEventListener('fetch', (event) => {
  // GET 요청만 처리
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((cached) => {
        if (cached) {
          // 백그라운드에서 캐시 갱신
          event.waitUntil(
            fetch(event.request)
              .then((response) => {
                if (response.ok) {
                  const clone = response.clone();
                  caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, clone);
                  });
                }
              })
              .catch(() => {})
          );
          return cached;
        }

        // 캐시 없으면 네트워크
        return fetch(event.request)
          .then((response) => {
            if (!response.ok) return response;
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
            return response;
          })
          .catch(() => {
            // 오프라인이고 HTML 요청이면 기본 페이지 반환
            if (event.request.headers.get('accept')?.includes('text/html')) {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// 메시지 처리 (수동 캐시 새로고침 등)
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0]?.postMessage({ success: true });
      })
    );
  }
});
