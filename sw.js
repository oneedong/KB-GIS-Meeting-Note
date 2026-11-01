/* KB GIS Meeting Note service worker — 오프라인 앱 셸 + 새 배포 자동 반영 */
const CACHE = 'kbnote-v5';

// 설치 때 미리 받아 두는 파일. data.enc.json 은 암호문이라 캐시에 둬도 된다.
const SHELL = [
  './',
  './index.html',
  './app.css',
  './vault.js',
  './app.js',
  './data.enc.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  // 앱 파일·데이터(같은 출처): 네트워크 우선(cache:'no-store'로 CDN 캐시 우회), 오프라인이면 캐시.
  if (sameOrigin) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }

  // 다른 출처(Pretendard 글꼴): 캐시 우선.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
