// Taut — utilitas umum
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function uid(n = 12) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of a) s += abc[b % abc.length];
  return s;
}

export function randomCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function linkify(text) {
  const t = esc(text);
  return t.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

export function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}

export function fmtSize(b) {
  if (b == null || isNaN(b)) return '';
  if (b < 1024) return b + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)).replace('.', ',') + ' ' + u[i];
}

export function fmtSpeed(bps) {
  return fmtSize(bps) + '/dtk';
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, '0') + '.' + String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Kemarin ' + hm;
  return d.getDate() + ' ' + BULAN[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ', ' + hm;
}

export function fmtAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}

// ---------- Deteksi perangkat ----------
export function detectDevice() {
  const ua = navigator.userAgent || '';
  const touch = navigator.maxTouchPoints || 0;
  let type = 'desktop', os = 'Lainnya';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) { type = 'tablet'; os = 'iPadOS'; }
  else if (/iPhone|iPod/.test(ua)) { type = 'phone'; os = 'iOS'; }
  else if (/Android/.test(ua)) { type = /Mobile/.test(ua) ? 'phone' : 'tablet'; os = 'Android'; }
  else if (/Windows/.test(ua)) { type = 'laptop'; os = 'Windows'; }
  else if (/Macintosh|Mac OS X/.test(ua)) { type = 'laptop'; os = 'macOS'; }
  else if (/CrOS/.test(ua)) { type = 'laptop'; os = 'ChromeOS'; }
  else if (/Linux/.test(ua)) { type = 'desktop'; os = 'Linux'; }
  const label = {
    iPadOS: 'iPad', iOS: 'iPhone', Android: type === 'phone' ? 'HP Android' : 'Tablet Android',
    Windows: 'PC Windows', macOS: 'Mac', ChromeOS: 'Chromebook', Linux: 'PC Linux', Lainnya: 'Perangkat',
  }[os];
  return { type, os, label };
}

export const isApple = () => /iPad|iPhone|Macintosh/.test(navigator.userAgent);
export const isMacLike = () => /Macintosh|iPad|iPhone/.test(navigator.userAgent);
export const isIOS = () => { const d = detectDevice(); return d.os === 'iPadOS' || d.os === 'iOS'; };
export const canShareScreen = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !isIOS() && !/Android/.test(navigator.userAgent);
export const canCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- localStorage ----------
const P = 'taut.';
export const LS = {
  get(k, d = null) {
    try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(P + k); } catch {} },
};

// ---------- IndexedDB ----------
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open('taut', 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
export const idb = {
  put: (store, val, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key))),
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
};

// ---------- Berkas ----------
export function fileKind(mime = '', name = '') {
  const n = name.toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg|avif)$/.test(n)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v|3gp)$/.test(n)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/.test(n)) return 'audio';
  if (/\.(zip|rar|7z|tar|gz|bz2|xz)$/.test(n) || /zip|compressed|x-tar/.test(mime)) return 'archive';
  if (/\.apk$/.test(n)) return 'apk';
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|ods|odp|csv|md|pages|numbers|key|html?|json|xml|js|css|py|java|c|cpp)$/.test(n) || mime.startsWith('text/') || /pdf|officedocument|msword|ms-excel|ms-powerpoint/.test(mime)) return 'doc';
  return 'other';
}

export function extOf(name = '') {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : '';
}

export async function makeThumb(blob, max = 200) {
  if (!blob || !(blob.type || '').startsWith('image/') || blob.size > 40 * 1024 * 1024) return null;
  try {
    let bmp;
    if (window.createImageBitmap) {
      bmp = await createImageBitmap(blob);
    } else {
      bmp = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im); im.onerror = rej;
        im.src = URL.createObjectURL(blob);
      });
    }
    const w = bmp.width, h = bmp.height;
    const sc = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'berkas';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function shareBlob(blob, name) {
  try {
    const f = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      await navigator.share({ files: [f] });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return true;
  }
  return false;
}

// ---------- ZIP (tanpa kompresi) ----------
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8, crc = 0) {
  crc = crc ^ 0xffffffff;
  for (let i = 0; i < u8.length; i++) crc = CRC_T[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function makeZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const e of entries) {
    const name = enc.encode(e.name.replace(/^\/+/, ''));
    const data = new Uint8Array(await e.blob.arrayBuffer());
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + (b.byteLength ?? b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// ---------- Bunyi ----------
let actx = null;
export function audioCtx() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
  return actx;
}
export function chime(kind = 'soft') {
  const ctx = audioCtx();
  if (!ctx) return;
  const notes = kind === 'ring' ? [880, 1175, 1568] : [660, 990];
  const t0 = ctx.currentTime;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.14);
    g.gain.exponentialRampToValueAtTime(kind === 'ring' ? 0.5 : 0.12, t0 + i * 0.14 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.32);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * 0.14); o.stop(t0 + i * 0.14 + 0.35);
  });
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}
