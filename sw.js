const VERSION = 'agenda-v13';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon.png'];

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDoiKo-h2ovNdOTOZvuFKMdYwspCxjBhQY",
  authDomain: "jaaacked-agenda.firebaseapp.com",
  projectId: "jaaacked-agenda",
  storageBucket: "jaaacked-agenda.firebasestorage.app",
  messagingSenderId: "399266121429",
  appId: "1:399266121429:web:7af998b4cab069f441845c"
};
const USER = 'jaaacked';

/* ---------- Notificações (Web Push padrão) ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Agenda', body: e.data ? e.data.text() : '' }; }
  if (d.badge !== undefined && self.navigator.setAppBadge) {
    const n = parseInt(d.badge, 10) || 0;
    (n ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {});
  }
  const opts = {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'favicon.png',
    tag: d.tag || 'agenda',
    renotify: true,
    data: { id: d.id || '', date: d.date || '', start: d.start || '' }
  };
  if (d.id) opts.actions = d.id.includes('@') ? [{ action: 'done', title: 'Feito' }] : [{ action: 'done', title: 'Feito' }, { action: 'snooze', title: 'Adiar 1 dia' }];
  e.waitUntil(self.registration.showNotification(d.title || 'Agenda', opts));
});

const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
function patchItem(id, fields) {
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) {
    body.fields[k] = typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v };
  }
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${USER}/items/${id}?${mask}&key=${FIREBASE_CONFIG.apiKey}`;
  return fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

self.addEventListener('notificationclick', e => {
  const n = e.notification, d = n.data || {};
  n.close();
  if (e.action === 'done' && d.id && d.id.includes('@')) {
    // ocorrência de um item que se repete: marca só aquele dia
    const [sid, ds] = d.id.split('@');
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${USER}/items/${sid}?updateMask.fieldPaths=${encodeURIComponent('doneDates.`' + ds + '`')}&updateMask.fieldPaths=updated&key=${FIREBASE_CONFIG.apiKey}`;
    e.waitUntil(fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { doneDates: { mapValue: { fields: { [ds]: { booleanValue: true } } } }, updated: { integerValue: String(Date.now()) } } }) }));
    return;
  }
  if (e.action === 'done' && d.id) { e.waitUntil(patchItem(d.id, { done: true, updated: Date.now() })); return; }
  if (e.action === 'snooze' && d.id && d.date) {
    const f = { date: addDays(d.date, 1), updated: Date.now() };
    if (d.start) f.start = addDays(d.start, 1);
    e.waitUntil(patchItem(d.id, f)); return;
  }
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = all.find(w => w.url.startsWith(self.registration.scope));
    if (c) { await c.focus(); if (d.id) c.postMessage({ open: d.id }); }
    else await clients.openWindow('./' + (d.id ? '?open=' + d.id : ''));
  })());
});

/* ---------- Cache offline ---------- */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('googleapis.com') && !/fonts\.googleapis\.com$/.test(url.hostname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return r; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const cacheable = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
  if (!cacheable) return;
  e.respondWith(
    caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })
  );
});
