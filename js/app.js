// Taut — Kit Kerja Lintas Perangkat
import {
  $, $$, sleep, uid, randomCode, esc, linkify, firstUrl, fmtSize, fmtSpeed, fmtTime, fmtAgo,
  detectDevice, isMacLike, isIOS, canShareScreen, canCamera, isStandalone, LS, idb, fileKind, extOf,
  makeThumb, downloadBlob, shareBlob, makeZip, chime, audioCtx, loadScript,
} from './util.js?v=1.0.1';
import { icon, kindIcon, deviceIcon, logo, deviceArt } from './icons.js?v=1.0.1';
import { Net, DEFAULT_SIGNAL } from './net.js?v=1.0.1';

const VERSION = '1.0.1';
const DEV = detectDevice();
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const MOD = isMacLike() ? '⌘' : 'Ctrl';
const narrow = () => window.innerWidth < 720;

// =====================================================================
// STATE
// =====================================================================
let firstRun = false;
let me = LS.get('me');
if (!me || !me.uid || !me.code) {
  me = { uid: uid(16), code: randomCode(), token: uid(20), name: DEV.label };
  firstRun = true;
}
me.type = DEV.type; me.os = DEV.os;
LS.set('me', me);

const S = {
  settings: Object.assign({ theme: 'auto', autoConnect: true, clipAuto: false, clipAutoCopy: true, notify: false, signal: '', sound: true }, LS.get('settings', {})),
  trusted: LS.get('trusted', {}),
  devices: new Map(),
  page: 'home',
  sel: null,
  tl: {},
  clips: LS.get('clips', []),
  notes: LS.get('notes', {}),
  activity: LS.get('activity', []),
  myShared: [],
  received: [],
  sessions: new Map(),
  unread: {},
  blobs: new Map(),
  urls: new Map(),
  live: new Map(),
  battery: null,
  dirHandle: null, dirPending: null,
  connecting: null,
  lastClip: null,
  noteSel: null,
  filesTab: 'remote', filesFilter: 'all', filesDev: null,
  installEvt: null,
};
const save = {
  me: () => LS.set('me', me),
  settings: () => LS.set('settings', S.settings),
  trusted: () => LS.set('trusted', S.trusted),
  clips: debounce(() => LS.set('clips', S.clips.slice(0, 80)), 300),
  notes: debounce(() => LS.set('notes', S.notes), 300),
  activity: debounce(() => LS.set('activity', S.activity.slice(0, 40)), 300),
};
function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

// Server sinyal: bisa diganti lewat ?signal= (untuk pengujian) atau pengaturan
const qs = new URLSearchParams(location.search);
if (qs.get('signal')) S.settings.signal = qs.get('signal');
const SIGNAL_URL = S.settings.signal || DEFAULT_SIGNAL;

// =====================================================================
// JARINGAN
// =====================================================================
const helloBase = () => ({ uid: me.uid, code: me.code, name: me.name, type: me.type, os: me.os, v: VERSION });
const net = new Net({
  signalUrl: SIGNAL_URL,
  me,
  hello: helloBase,
  isTrusted: (h) => !!(h && h.uid && S.trusted[h.uid]),
});
net.sinkFor = (r) => (S.dirHandle && r.purpose === 'transfer' ? openSink(r) : null);

net.signal.on('state', () => refresh('status'));
net.signal.on('open', () => { connectTrusted(); if (pendingHashCode) { const c = pendingHashCode; pendingHashCode = null; startConnect(c); } });
net.signal.on('idtaken', () => {
  me.code = randomCode(); me.token = uid(20); save.me();
  net.signal.restart(me.code, me.token);
  refresh('status'); renderQR();
  toast('Kode perangkat diperbarui menjadi ' + fmtCode(me.code), { icon: 'refresh' });
});
net.signal.on('error', (msg) => console.warn('Server sinyal:', msg));
net.on('request', (req) => showRequest(req));
net.on('link-open', (l) => onLinkOpen(l));
net.on('link-close', (l, reason, was) => onLinkClose(l, reason, was));
net.on('msg', (l, m) => onMsg(l, m));
net.on('tx', (l, t) => onTx(l, t));
net.on('rx', (l, r) => onRx(l, r));
net.on('media', (l, ms) => onMedia(l, ms));
net.on('media-end', (l, ms, remote) => onMediaEnd(l, ms, remote));

const fmtCode = (c) => String(c).replace(/(\d{3})(\d{3})/, '$1 $2');
const devOf = (duid) => S.devices.get(duid);
const devName = (duid) => (devOf(duid) && devOf(duid).name) || (S.trusted[duid] && S.trusted[duid].name) || 'Perangkat';
const connected = () => [...S.devices.values()].filter((d) => d.ready && d.link && d.link.open);
const linkOf = (duid) => { const d = devOf(duid); return d && d.ready && d.link && d.link.open ? d.link : null; };
const featuresOf = () => ({ screen: canShareScreen(), camera: canCamera() });

function helloFull(l) {
  const ruid = l.remoteHello && l.remoteHello.uid;
  return {
    t: 'hello', ...helloBase(), battery: S.battery, features: featuresOf(),
    key: (ruid && S.trusted[ruid] && S.trusted[ruid].key) || null,
    shared: sharedMeta(),
  };
}

function connectTrusted() {
  if (!S.settings.autoConnect || net.signal.state !== 'online') return;
  for (const t of Object.values(S.trusted)) {
    if (!t.code) continue;
    const d = devOf(t.uid);
    if (d && d.ready) continue;
    const ex = net.links.get(t.code);
    if (ex && ex.state !== 'closed') continue;
    const l = net.connect(t.code, { quiet: true, waitMs: 20000 });
    if (l) l.auto = true;
  }
}

const retries = new Map();
function scheduleReconnect(code) {
  const n = (retries.get(code) || 0) + 1;
  if (n > 6) { retries.delete(code); return; }
  retries.set(code, n);
  setTimeout(() => {
    if ([...S.devices.values()].some((d) => d.code === code && d.ready)) { retries.delete(code); return; }
    const ex = net.links.get(code);
    if (ex && ex.state !== 'closed') return;
    const l = net.connect(code, { quiet: true, waitMs: 15000 });
    if (l) { l.auto = true; l.retry = true; }
  }, Math.min(30000, 1500 * n * n));
}

function startConnect(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { setConnStatus('err', 'Kode harus 6 angka.'); return; }
  if (code === me.code) { setConnStatus('err', 'Itu kode perangkat ini sendiri.'); return; }
  const d = [...S.devices.values()].find((x) => x.code === code && x.ready);
  if (d) { setConnStatus('ok', `${esc(d.name)} sudah terhubung.`); return; }
  if (net.signal.state !== 'online') { setConnStatus('err', 'Belum tersambung ke server. Periksa koneksi internet perangkat ini.'); net.signal.kick(); return; }
  const l = net.connect(code, { waitMs: 60000 });
  if (!l) return;
  S.connecting = l;
  setConnStatus('wait', `Menghubungkan ke ${fmtCode(code)}… Ketuk <b>Izinkan</b> di perangkat tersebut.`, true);
}

function onLinkOpen(l) {
  retries.delete(l.rid);
  l.send(helloFull(l));
  l._helloTimer = setTimeout(() => { if (!l.duid || !devOf(l.duid) || !devOf(l.duid).ready) l.close('nohello'); }, 12000);
}

function onLinkClose(l, reason, was) {
  clearTimeout(l._helloTimer);
  const d = [...S.devices.values()].find((x) => x.link === l);
  if (d) {
    d.link = null; d.ready = false; d.via = null; d.rtt = null; d.shared = [];
    for (const s of [...S.sessions.values()]) if (s.link === l) endSession(s.sid, false);
    if (was === 'open' && reason !== 'bye' && reason !== 'auth') toast(`${esc(d.name)} terputus`, { icon: 'unlink' });
    if (reason === 'bye') toast(`${esc(d.name)} memutuskan sambungan`, { icon: 'unlink' });
    addActivity('unlink', `Terputus dari ${d.name}`);
  }
  if (S.connecting === l) {
    S.connecting = null;
    const msg = {
      rejected: 'Permintaan ditolak oleh perangkat tersebut.',
      offline: `Perangkat dengan kode ${fmtCode(l.rid)} tidak ditemukan atau sedang tidak membuka Taut.`,
      timeout: 'Waktu habis. Pastikan Taut terbuka di perangkat tersebut, lalu coba lagi.',
      failed: 'Sambungan gagal. Coba sambungkan kedua perangkat ke Wi-Fi yang sama.',
      nosignal: 'Tidak tersambung ke server sinyal.',
      cancel: 'Dibatalkan.',
    }[reason] || 'Sambungan gagal dibuat.';
    if (reason !== 'replaced') setConnStatus('err', msg);
  }
  const t = Object.values(S.trusted).find((x) => x.code === l.rid);
  const lost = ['failed', 'lost', 'closed', 'timeout', 'nohello'].includes(reason);
  if (t && S.settings.autoConnect && ((was === 'open' && lost) || (l.retry && ['offline', 'timeout', 'failed'].includes(reason)))) scheduleReconnect(l.rid);
  refresh('devices');
}

// ---------------------------------------------------------------------
// Pesan kendali
// ---------------------------------------------------------------------
function onMsg(l, m) {
  if (m.t === 'hello') return onHello(l, m);
  const duid = l.duid;
  if (!duid || !devOf(duid) || !devOf(duid).ready) {
    if (m.t !== 'pair' && m.t !== 'auth-fail') return;
  }
  const d = devOf(duid);
  switch (m.t) {
    case 'pair':
      if (S.trusted[duid]) { S.trusted[duid].key = m.key; save.trusted(); }
      break;
    case 'auth-fail':
      toast('Verifikasi perangkat gagal. Hubungkan ulang dengan kode.', { icon: 'shield' });
      if (S.trusted[duid]) { delete S.trusted[duid]; save.trusted(); }
      l.close('auth');
      break;
    case 'info':
      if (m.name) { d.name = m.name; if (S.trusted[duid]) { S.trusted[duid].name = m.name; save.trusted(); } }
      if ('battery' in m) d.battery = m.battery;
      refresh(m.name ? 'devices' : 'stats');
      break;
    case 'bye': l.close('bye'); break;
    case 'forget':
      if (S.trusted[duid]) { delete S.trusted[duid]; save.trusted(); }
      break;
    case 'text': recvText(duid, m); break;
    case 'clip': recvClip(duid, m); break;
    case 'notes-all': for (const n of m.notes || []) mergeNote(n, l); refresh('notes'); break;
    case 'note': mergeNote(m.note, l); refresh('notes'); break;
    case 'shared': d.shared = m.items || []; refresh('files'); break;
    case 'share-get': serveShared(l, m.id); break;
    case 'batch-cancel': for (const t of [...l.queue, ...l.tx.values()]) if (t.batch === m.batch) l.cancel(t); break;
    case 'scr-req': askMedia(duid, 'screen'); break;
    case 'cam-req': askMedia(duid, 'camera', m.facing); break;
    case 'media-deny': toast(`${esc(d.name)} menolak permintaan ${m.kind === 'screen' ? 'layar' : 'kamera'}.`, { icon: 'x' }); break;
    case 'cam-flip': flipCamera(m.sid); break;
    case 'cam-facing': { const s = S.sessions.get(m.sid); if (s) { s.facing = m.facing; s.mirror = m.facing === 'user'; applyMirror(s); } break; }
    case 'ring': startRing(duid); break;
    case 'ring-stop': stopRing(true); break;
    default: break;
  }
}

function onHello(l, m) {
  clearTimeout(l._helloTimer);
  if (!m.uid) { l.close('nohello'); return; }
  const tr = S.trusted[m.uid];
  let ok = true;
  if (tr && tr.key && m.key && tr.key !== m.key) ok = false;
  if (l.autoAccepted && (!tr || (tr.key && m.key !== tr.key))) ok = false;
  if (!ok) { l.send({ t: 'auth-fail' }); setTimeout(() => l.close('auth'), 200); toast('Sambungan ditolak: verifikasi perangkat gagal.', { icon: 'shield' }); return; }
  // tutup sambungan lama ke perangkat yang sama
  const old = devOf(m.uid);
  if (old && old.link && old.link !== l) { const ol = old.link; old.link = null; ol.close('replaced', true); }
  l.duid = m.uid;
  const d = old || { uid: m.uid, shared: [] };
  Object.assign(d, {
    uid: m.uid, code: m.code, name: m.name || 'Perangkat', type: m.type || 'desktop', os: m.os || '',
    features: m.features || {}, battery: m.battery || null, shared: m.shared || [], link: l, ready: true, since: Date.now(),
  });
  S.devices.set(m.uid, d);
  let key = (tr && tr.key) || m.key || null;
  if (!key && !l.initiator) { key = uid(24); l.send({ t: 'pair', key }); }
  S.trusted[m.uid] = { uid: m.uid, code: m.code, name: d.name, type: d.type, os: d.os, key, lastSeen: Date.now() };
  save.trusted();
  if (!S.sel || !devOf(S.sel) || !devOf(S.sel).ready) S.sel = m.uid;
  if (!S.filesDev || !devOf(S.filesDev) || !devOf(S.filesDev).ready) S.filesDev = m.uid;
  l.send({ t: 'notes-all', notes: Object.values(S.notes) });
  if (S.connecting === l) { S.connecting = null; closeModal('connect'); }
  if (!l.auto || !l.retry) toast(`${esc(d.name)} terhubung`, { icon: 'check', kind: 'ok' });
  if (S.settings.sound) chime();
  addActivity('link', `Terhubung dengan ${d.name}`);
  updateStats(d);
  if (S.pendingShare) {
    const txt = S.pendingShare; S.pendingShare = null;
    setTimeout(() => pickDevice('Kirim yang dibagikan', 'share', (u) => { sendText(u, txt); toast('Terkirim ke ' + esc(devName(u)), { icon: 'check', kind: 'ok' }); }), 400);
  }
  refresh('devices');
}

// =====================================================================
// TIMELINE (Transfer Bebas)
// =====================================================================
function tl(duid) {
  if (!S.tl[duid]) S.tl[duid] = LS.get('tl.' + duid, []);
  return S.tl[duid];
}
const saveTLs = {};
function saveTL(duid) {
  (saveTLs[duid] ||= debounce(() => {
    const items = tl(duid).slice(-200).map((it) => ({ ...it, cur: undefined }));
    for (const it of items) if (['sending', 'receiving', 'queued'].includes(it.state)) it.state = 'failed';
    LS.set('tl.' + duid, items);
  }, 500))();
}
function tlFind(duid, id) { return tl(duid).find((x) => x.id === id); }
function tlPush(duid, item) {
  tl(duid).push(item);
  if (tl(duid).length > 250) tl(duid).splice(0, tl(duid).length - 250);
  saveTL(duid);
  if (S.page === 'transfer' && S.sel === duid) appendTimeline(item);
  else bump('transfer');
}

function sendText(duid, text) {
  text = String(text || '').trim();
  if (!text) return;
  const l = linkOf(duid);
  if (!l) { toast('Perangkat tidak terhubung.', { icon: 'unlink' }); return; }
  const id = uid();
  l.send({ t: 'text', id, text, ts: Date.now() });
  tlPush(duid, { id, dir: 'out', kind: 'text', text, ts: Date.now() });
}
function recvText(duid, m) {
  tlPush(duid, { id: m.id || uid(), dir: 'in', kind: 'text', text: m.text, ts: Date.now() });
  const url = firstUrl(m.text);
  addActivity(url ? 'link' : 'text', `${devName(duid)}: ${m.text.slice(0, 60)}`);
  notify(devName(duid), m.text);
  if (S.page !== 'transfer' || S.sel !== duid) {
    toast(`<b>${esc(devName(duid))}</b><br>${esc(m.text.slice(0, 120))}`, {
      icon: url ? 'link' : 'text',
      actions: url ? [{ label: 'Buka', fn: () => window.open(url, '_blank', 'noopener') }, { label: 'Lihat', fn: () => { S.sel = duid; go('transfer'); } }] : [{ label: 'Lihat', fn: () => { S.sel = duid; go('transfer'); } }],
      timeout: 6000,
    });
  }
  if (S.settings.sound) chime();
}

function sendFiles(duid, list) {
  const l = linkOf(duid);
  if (!l) { toast('Perangkat tidak terhubung.', { icon: 'unlink' }); return; }
  list = list.filter((x) => x && x.file);
  if (!list.length) return;
  const isFolder = list.length > 1 && list.some((x) => x.rel && x.rel.includes('/'));
  if (isFolder) {
    const bid = uid();
    const root = list[0].rel.split('/')[0] || 'Folder';
    const size = list.reduce((a, b) => a + b.file.size, 0);
    const item = { id: bid, dir: 'out', kind: 'batch', name: root, count: list.length, size, ts: Date.now(), state: 'sending', doneCount: 0, doneBytes: 0, files: list.map((x) => ({ name: x.file.name, size: x.file.size, rel: x.rel })) };
    tlPush(duid, item);
    for (const x of list) l.sendFile(x.file, { batch: bid, rel: x.rel, extra: { bname: root, bcount: list.length, bsize: size } });
  } else {
    for (const x of list) {
      const fid = uid();
      S.blobs.set(fid, x.file);
      tlPush(duid, { id: fid, dir: 'out', kind: 'file', fid, name: x.file.name || 'berkas', size: x.file.size, mime: x.file.type, ts: Date.now(), state: 'queued' });
      l.sendFile(x.file, { id: fid });
    }
  }
  addActivity('transfer', `Mengirim ${list.length} berkas ke ${devName(duid)}`);
}

function onTx(l, t) {
  const duid = l.duid;
  if (!duid) return;
  if (t.purpose === 'clip' || t.purpose === 'share') return;
  if (t.batch) {
    const it = tlFind(duid, t.batch);
    if (!it) return;
    S.live.set(it.id, { l, batch: true });
    if (t.state === 'done' && !t._c) { t._c = 1; it.doneCount++; it.doneBytes += t.size; }
    if (t.state === 'failed' || t.state === 'cancelled') { it.state = t.state; }
    else if (it.doneCount >= it.count) { it.state = 'done'; S.live.delete(it.id); }
    else it.state = 'sending';
    const cur = t.state === 'sending' ? t.sent : 0;
    patchProgress(duid, it, (it.doneBytes + cur) / Math.max(1, it.size), t.speed);
    if (t.state !== 'sending') { saveTL(duid); updateItem(duid, it); }
    return;
  }
  const it = tlFind(duid, t.id);
  if (!it) return;
  const prev = it.state;
  it.state = t.state === 'sending' ? 'sending' : t.state;
  if (it.state === 'sending') S.live.set(it.id, { l, t });
  else S.live.delete(it.id);
  patchProgress(duid, it, t.sent / Math.max(1, t.size), t.speed);
  if (prev !== it.state) { saveTL(duid); updateItem(duid, it); }
}

function onRx(l, r) {
  const duid = l.duid;
  if (!duid) return;
  if (r.purpose === 'clip') {
    if (r.state === 'done' && r.blob) recvClipImage(duid, r);
    return;
  }
  // transfer & berkas bersama
  if (r.batch) {
    let it = tlFind(duid, r.batch);
    if (!it) {
      const ex = r.extra || {};
      it = { id: r.batch, dir: 'in', kind: 'batch', name: ex.bname || 'Folder', count: ex.bcount || 1, size: ex.bsize || r.size, ts: Date.now(), state: 'receiving', doneCount: 0, doneBytes: 0, files: [] };
      tlPush(duid, it);
      addActivity('folder', `Menerima folder "${it.name}" dari ${devName(duid)}`);
    }
    S.live.set(it.id, { l, batch: true, in: true });
    if (r.state === 'done' && !r._c) {
      r._c = 1; it.doneCount++; it.doneBytes += r.size;
      it.files.push({ fid: r.id, name: r.name, size: r.size, mime: r.mime, rel: r.rel, disk: !!r.savedToDisk });
      if (r.blob) storeReceived(r, duid);
    }
    if (r.state === 'failed' || r.state === 'cancelled') it.state = r.state;
    else if (it.doneCount >= it.count) {
      it.state = 'done'; S.live.delete(it.id);
      notify(devName(duid), `Folder "${it.name}" diterima (${it.count} berkas)`);
      if (S.settings.sound) chime();
    } else it.state = 'receiving';
    patchProgress(duid, it, (it.doneBytes + (r.state === 'receiving' ? r.got : 0)) / Math.max(1, it.size), r.speed);
    if (r.state !== 'receiving') { saveTL(duid); updateItem(duid, it); }
    return;
  }
  let it = tlFind(duid, r.id);
  if (!it) {
    it = { id: r.id, dir: 'in', kind: 'file', fid: r.id, name: r.name, size: r.size, mime: r.mime, ts: Date.now(), state: 'receiving' };
    if (r.purpose === 'share') it.fromShare = true;
    tlPush(duid, it);
  }
  const prev = it.state;
  it.state = r.state;
  if (r.state === 'receiving') S.live.set(it.id, { l, t: r });
  else S.live.delete(it.id);
  if (r.state === 'done') {
    it.disk = !!r.savedToDisk;
    if (r.blob) storeReceived(r, duid);
    const k = fileKind(r.mime, r.name);
    addActivity(kindIcon(k), `Menerima ${r.name} dari ${devName(duid)}`);
    notify(devName(duid), `Mengirim ${r.name} (${fmtSize(r.size)})`);
    if (S.settings.sound) chime();
    if (S.page !== 'transfer' || S.sel !== duid) {
      toast(`<b>${esc(r.name)}</b><br>dari ${esc(devName(duid))} · ${fmtSize(r.size)}`, {
        icon: kindIcon(k), timeout: 6000,
        actions: r.blob ? [{ label: 'Buka', fn: () => preview(r.id) }, { label: 'Simpan', fn: () => saveFile(r.id) }] : [],
      });
    }
  }
  patchProgress(duid, it, r.got / Math.max(1, r.size), r.speed);
  if (prev !== it.state) { saveTL(duid); updateItem(duid, it); }
}

async function storeReceived(r, duid, origin = 'recv') {
  const rec = { id: r.id, blob: r.blob, name: r.name, mime: r.mime || r.blob.type, size: r.size, from: duid, fromName: devName(duid), ts: Date.now(), origin, rel: r.rel || '', batch: r.batch || null };
  S.blobs.set(r.id, r.blob);
  try { await idb.put('files', rec); } catch (e) { console.warn('IDB penuh/gagal', e); }
  S.received.unshift({ ...rec, blob: undefined });
  refresh('files');
}

function cancelItem(duid, it) {
  const live = S.live.get(it.id);
  const l = (live && live.l) || linkOf(duid);
  if (!l) return;
  if (it.kind === 'batch') {
    if (it.dir === 'out') { for (const t of [...l.queue, ...l.tx.values()]) if (t.batch === it.id) l.cancel(t); }
    else { for (const r of l.rx.values()) if (r.batch === it.id) l.cancel(r); l.send({ t: 'batch-cancel', batch: it.id }); }
    it.state = 'cancelled'; updateItem(duid, it); saveTL(duid);
  } else if (live && live.t) l.cancel(live.t);
  else { for (const t of l.queue) if (t.id === it.id) l.cancel(t); }
}

// ---------------------------------------------------------------------
// Penyimpanan otomatis ke folder (Chrome/Edge di Windows & Mac)
// ---------------------------------------------------------------------
async function openSink(r) {
  try {
    let dir = S.dirHandle;
    const parts = (r.rel || '').split('/').filter(Boolean);
    parts.pop();
    for (const p of parts) dir = await dir.getDirectoryHandle(p.replace(/[\\:*?"<>|]/g, '_'), { create: true });
    let name = (r.name || 'berkas').replace(/[\\/:*?"<>|]/g, '_');
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; i < 500; i++) {
      try { await dir.getFileHandle(name); name = `${base} (${i})${ext}`; } catch { break; }
    }
    const fh = await dir.getFileHandle(name, { create: true });
    r.diskName = name;
    return await fh.createWritable();
  } catch (e) { console.warn('sink', e); return null; }
}
async function loadDirHandle() {
  if (!window.showDirectoryPicker) return;
  try {
    const h = await idb.get('kv', 'dir');
    if (!h) return;
    const p = await h.queryPermission({ mode: 'readwrite' });
    if (p === 'granted') S.dirHandle = h; else S.dirPending = h;
  } catch {}
}
async function pickDir() {
  try {
    const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'taut' });
    S.dirHandle = h; S.dirPending = null;
    await idb.put('kv', h, 'dir');
    toast(`Berkas diterima akan disimpan otomatis ke folder "${esc(h.name)}".`, { icon: 'folder', kind: 'ok' });
  } catch {}
  refresh('settings');
}
async function grantDir() {
  try {
    const p = await S.dirPending.requestPermission({ mode: 'readwrite' });
    if (p === 'granted') { S.dirHandle = S.dirPending; S.dirPending = null; }
  } catch {}
  refresh('settings');
}

// =====================================================================
// PAPAN KLIP SUPER
// =====================================================================
function sendClipText(text, targets) {
  text = String(text || '');
  if (!text.trim()) return 0;
  const links = targets ? targets.map(linkOf).filter(Boolean) : net.openLinks().filter((l) => l.duid && devOf(l.duid) && devOf(l.duid).ready);
  if (!links.length) { toast('Belum ada perangkat terhubung.', { icon: 'unlink' }); return 0; }
  const id = uid();
  for (const l of links) l.send({ t: 'clip', id, text, ts: Date.now() });
  S.lastClip = text;
  S.clips.unshift({ id, dir: 'out', kind: 'text', text, ts: Date.now(), to: links.map((l) => l.duid) });
  S.clips = S.clips.slice(0, 80);
  save.clips(); refresh('clips');
  toast(`Papan klip dikirim ke ${links.length > 1 ? links.length + ' perangkat' : esc(devName(links[0].duid))}`, { icon: 'clipboard', kind: 'ok' });
  return links.length;
}
function sendClipImage(blob, targets) {
  const links = targets ? targets.map(linkOf).filter(Boolean) : net.openLinks().filter((l) => l.duid && devOf(l.duid) && devOf(l.duid).ready);
  if (!links.length) { toast('Belum ada perangkat terhubung.', { icon: 'unlink' }); return; }
  const id = uid();
  S.blobs.set(id, blob);
  const name = 'Gambar papan klip.' + ((blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg'));
  for (const l of links) l.sendFile(blob, { purpose: 'clip', id, name });
  S.clips.unshift({ id, dir: 'out', kind: 'image', fid: id, ts: Date.now(), to: links.map((l) => l.duid) });
  save.clips(); refresh('clips');
  toast(`Gambar dikirim ke ${links.length > 1 ? links.length + ' perangkat' : esc(devName(links[0].duid))}`, { icon: 'image', kind: 'ok' });
}
function recvClip(duid, m) {
  S.clips.unshift({ id: m.id || uid(), dir: 'in', kind: 'text', text: m.text, from: duid, ts: Date.now() });
  S.clips = S.clips.slice(0, 80);
  save.clips();
  S.lastClip = m.text;
  if (S.page !== 'clipboard') bump('clipboard');
  refresh('clips');
  notify(`Papan klip dari ${devName(duid)}`, m.text);
  if (S.settings.clipAutoCopy) {
    copyText(m.text, true).then((ok) => {
      if (ok) toast(`Papan klip dari <b>${esc(devName(duid))}</b> sudah disalin. Tinggal tempel.`, { icon: 'clipboard', kind: 'ok' });
      else clipToast(duid, m.text);
    });
  } else clipToast(duid, m.text);
}
function clipToast(duid, text) {
  toast(`<b>Papan klip dari ${esc(devName(duid))}</b><br>${esc(text.slice(0, 140))}`, {
    icon: 'clipboard', timeout: 9000,
    actions: [{ label: 'Salin', fn: () => copyText(text).then((ok) => ok && toast('Disalin', { icon: 'check', kind: 'ok' })) }],
  });
}
async function recvClipImage(duid, r) {
  await storeReceived(r, duid, 'clip');
  S.clips.unshift({ id: r.id, dir: 'in', kind: 'image', fid: r.id, from: duid, ts: Date.now() });
  save.clips(); refresh('clips');
  if (S.page !== 'clipboard') bump('clipboard');
  let ok = false;
  if (S.settings.clipAutoCopy && document.hasFocus()) ok = await copyImage(r.blob, true);
  toast(`<b>Gambar papan klip dari ${esc(devName(duid))}</b>${ok ? '<br>Sudah disalin.' : ''}`, {
    icon: 'image', timeout: 8000,
    actions: [{ label: 'Salin', fn: () => copyImage(r.blob) }, { label: 'Lihat', fn: () => preview(r.id) }],
  });
}
async function copyText(text, quiet = false) {
  try {
    if (!quiet || document.hasFocus()) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  if (quiet) { S.pendingCopy = text; return false; }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return ok;
  } catch { return false; }
}
async function copyImage(blob, quiet = false) {
  try {
    let b = blob;
    if (b.type !== 'image/png') b = await toPng(b);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
    if (!quiet) toast('Gambar disalin', { icon: 'check', kind: 'ok' });
    return true;
  } catch {
    if (!quiet) toast('Browser ini belum bisa menyalin gambar. Gunakan Simpan.', { icon: 'info' });
    return false;
  }
}
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
async function sendCurrentClipboard(targets) {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const img = it.types.find((t) => t.startsWith('image/'));
        if (img) { sendClipImage(await it.getType(img), targets); return; }
        if (it.types.includes('text/plain')) { const txt = await (await it.getType('text/plain')).text(); if (txt.trim()) { sendClipText(txt, targets); return; } }
      }
    }
    const t = await navigator.clipboard.readText();
    if (t && t.trim()) { sendClipText(t, targets); return; }
    toast('Papan klip kosong.', { icon: 'info' });
  } catch {
    toast(`Browser tidak mengizinkan membaca papan klip. Tempel (${MOD}+V) ke kotak teks lalu ketuk Kirim.`, { icon: 'info', timeout: 6000 });
  }
}
// Sinkron otomatis (Chrome/Edge desktop): cek papan klip saat jendela fokus
let clipPermOk = false;
async function clipPoll() {
  if (!S.settings.clipAuto || !clipPermOk || !document.hasFocus() || document.hidden) return;
  if (!connected().length) return;
  try {
    const t = await navigator.clipboard.readText();
    if (t && t !== S.lastClip && t.length < 200000) {
      if (S.lastClip === null) { S.lastClip = t; return; }
      sendClipText(t);
    }
  } catch {}
}
async function checkClipPerm() {
  clipPermOk = false;
  try {
    const p = await navigator.permissions.query({ name: 'clipboard-read' });
    clipPermOk = p.state === 'granted';
    p.onchange = () => { clipPermOk = p.state === 'granted'; };
  } catch {}
}
async function enableClipAuto(on) {
  S.settings.clipAuto = on; save.settings();
  if (on) {
    try { S.lastClip = await navigator.clipboard.readText(); } catch {}
    await checkClipPerm();
    if (!clipPermOk) toast('Izinkan akses papan klip di browser agar sinkron otomatis berjalan (Chrome/Edge).', { icon: 'info', timeout: 7000 });
  }
  refresh('clips');
}

// =====================================================================
// CATATAN
// =====================================================================
function noteTitle(n) {
  const first = (n.body || '').split('\n').find((x) => x.trim()) || '';
  return first.trim().slice(0, 80) || 'Catatan baru';
}
function mergeNote(n, from) {
  if (!n || !n.id) return;
  const cur = S.notes[n.id];
  if (cur && cur.updatedAt >= n.updatedAt) return;
  // Pengguna sedang mengetik catatan yang sama: tunda, jangan dibuang
  if (cur && S.page === 'notes' && S.noteSel === n.id && document.activeElement && document.activeElement.id === 'noteBody' && Date.now() - (S.lastNoteType || 0) < 1800) {
    S.noteDefer = S.noteDefer || {};
    clearTimeout(S.noteDefer[n.id]);
    S.noteDefer[n.id] = setTimeout(() => { mergeNote(n, from); refresh('notes'); }, 1900);
    return;
  }
  S.notes[n.id] = { id: n.id, body: n.body || '', updatedAt: n.updatedAt, deleted: !!n.deleted, pinned: !!n.pinned, by: n.by };
  save.notes();
  net.broadcast({ t: 'note', note: S.notes[n.id] }, from);
  if (S.page === 'notes' && S.noteSel === n.id) {
    const ta = $('#noteBody');
    if (ta && ta.value !== n.body) {
      const focused = document.activeElement === ta;
      const a = ta.selectionStart, z = ta.selectionEnd;
      ta.value = n.deleted ? '' : n.body;
      if (focused) { try { ta.setSelectionRange(Math.min(a, ta.value.length), Math.min(z, ta.value.length)); } catch {} }
    }
  }
  if (S.page !== 'notes') bump('notes');
}
const pushNote = debounce((id) => { const n = S.notes[id]; if (n) net.broadcast({ t: 'note', note: n }); }, 350);
function editNote(id, patch) {
  const n = S.notes[id];
  if (!n) return;
  Object.assign(n, patch, { updatedAt: Date.now(), by: me.name });
  save.notes();
  pushNote(id);
}
function newNote(body = '') {
  const id = uid();
  S.notes[id] = { id, body, updatedAt: Date.now(), deleted: false, pinned: false, by: me.name };
  save.notes(); pushNote(id);
  S.noteSel = id;
  return id;
}

// =====================================================================
// AKSES BERKAS (berkas bersama)
// =====================================================================
function sharedMeta() {
  return S.myShared.map((x) => ({ id: x.id, name: x.name, size: x.size, mime: x.mime, ts: x.ts, thumb: x.thumb || null, rel: x.rel || '' }));
}
async function addShared(list) {
  for (const x of list) {
    const f = x.file;
    const rec = { id: uid(), blob: f, name: f.name, size: f.size, mime: f.type, ts: Date.now(), origin: 'share', rel: x.rel || '' };
    rec.thumb = await makeThumb(f, 160);
    S.blobs.set(rec.id, f);
    try { await idb.put('files', rec); } catch {}
    S.myShared.unshift({ ...rec, blob: undefined });
  }
  net.broadcast({ t: 'shared', items: sharedMeta() });
  toast(`${list.length} berkas dibagikan ke perangkat terhubung`, { icon: 'folderUp', kind: 'ok' });
  refresh('files');
}
async function removeShared(id) {
  S.myShared = S.myShared.filter((x) => x.id !== id);
  S.blobs.delete(id);
  try { await idb.del('files', id); } catch {}
  net.broadcast({ t: 'shared', items: sharedMeta() });
  refresh('files');
}
async function serveShared(l, id) {
  const meta = S.myShared.find((x) => x.id === id);
  if (!meta) return;
  const blob = await getBlob(id);
  if (!blob) return;
  l.sendFile(blob, { purpose: 'share', id: uid(), name: meta.name, mime: meta.mime });
}
function requestShared(duid, item) {
  const l = linkOf(duid);
  if (!l) return;
  l.send({ t: 'share-get', id: item.id });
  toast(`Mengambil ${esc(item.name)}…`, { icon: 'download' });
}

async function getBlob(fid) {
  if (S.blobs.has(fid)) return S.blobs.get(fid);
  try {
    const rec = await idb.get('files', fid);
    if (rec && rec.blob) { S.blobs.set(fid, rec.blob); return rec.blob; }
  } catch {}
  return null;
}
async function blobUrl(fid) {
  if (S.urls.has(fid)) return S.urls.get(fid);
  const b = await getBlob(fid);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  S.urls.set(fid, u);
  return u;
}
async function fileMeta(fid) {
  const r = S.received.find((x) => x.id === fid) || S.myShared.find((x) => x.id === fid);
  if (r) return r;
  for (const arr of Object.values(S.tl)) { const it = arr.find((x) => x.fid === fid); if (it) return it; }
  try { const rec = await idb.get('files', fid); if (rec) return rec; } catch {}
  return { name: 'berkas' };
}
async function saveFile(fid) {
  const b = await getBlob(fid);
  if (!b) { toast('Berkas tidak tersedia lagi di perangkat ini.', { icon: 'info' }); return; }
  const m = await fileMeta(fid);
  if (isIOS()) { if (await shareBlob(b, m.name)) return; }
  downloadBlob(b, m.name);
}
async function shareFile(fid) {
  const b = await getBlob(fid);
  if (!b) return;
  const m = await fileMeta(fid);
  if (!(await shareBlob(b, m.name))) downloadBlob(b, m.name);
}
async function saveBatch(duid, it) {
  const files = [];
  for (const f of it.files || []) {
    const b = await getBlob(f.fid);
    if (b) files.push({ name: f.rel || f.name, blob: b });
  }
  if (!files.length) { toast(it.files && it.files.some((f) => f.disk) ? 'Folder sudah tersimpan otomatis di folder penyimpanan.' : 'Berkas tidak tersedia.', { icon: 'info' }); return; }
  toast('Menyiapkan ZIP…', { icon: 'archive' });
  const zip = await makeZip(files);
  const name = (it.name || 'Folder') + '.zip';
  if (isIOS() && (await shareBlob(zip, name))) return;
  downloadBlob(zip, name);
}
async function deleteReceived(fid) {
  S.received = S.received.filter((x) => x.id !== fid);
  S.blobs.delete(fid);
  if (S.urls.has(fid)) { URL.revokeObjectURL(S.urls.get(fid)); S.urls.delete(fid); }
  try { await idb.del('files', fid); } catch {}
  refresh('files');
}
async function loadFiles() {
  try {
    const all = await idb.all('files');
    S.myShared = all.filter((x) => x.origin === 'share').sort((a, b) => b.ts - a.ts).map((x) => ({ ...x, blob: undefined }));
    S.received = all.filter((x) => x.origin !== 'share').sort((a, b) => b.ts - a.ts).map((x) => ({ ...x, blob: undefined }));
  } catch {}
}

// =====================================================================
// PENCERMINAN LAYAR & KAMERA BERSAMA
// =====================================================================
async function shareScreen(duids) {
  if (!canShareScreen()) { toast('Berbagi layar hanya bisa dari Windows atau Mac (Chrome, Edge, Safari).', { icon: 'info' }); return; }
  const links = duids.map(linkOf).filter(Boolean);
  if (!links.length) { toast('Pilih perangkat tujuan.', { icon: 'info' }); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
  } catch (e) { if (e && e.name !== 'NotAllowedError') toast('Tidak bisa memulai berbagi layar.', { icon: 'x' }); return; }
  const v = stream.getVideoTracks()[0];
  for (const l of links) {
    const ms = await l.startMedia(stream, 'screen', me.name);
    S.sessions.set(ms.sid, { sid: ms.sid, link: l, duid: l.duid, kind: 'screen', dir: 'out', stream, label: me.name });
    addActivity('mirror', `Membagikan layar ke ${devName(l.duid)}`);
  }
  v.addEventListener('ended', () => { for (const s of [...S.sessions.values()]) if (s.stream === stream) endSession(s.sid, true); });
  refresh('sessions');
}
async function shareCamera(duid, facing = 'environment') {
  const l = linkOf(duid);
  if (!l) return;
  if (!canCamera()) { toast('Kamera tidak tersedia di perangkat ini.', { icon: 'info' }); return; }
  let stream;
  try { stream = await getCam(facing); }
  catch (e) { toast('Izin kamera ditolak atau kamera sedang dipakai aplikasi lain.', { icon: 'x' }); return; }
  const ms = await l.startMedia(stream, 'camera', me.name, { facing });
  const s = { sid: ms.sid, link: l, duid, kind: 'camera', dir: 'out', stream, label: me.name, facing, mirror: facing === 'user' };
  S.sessions.set(ms.sid, s);
  openWin(s);
  addActivity('camera', `Membagikan kamera ke ${devName(duid)}`);
  refresh('sessions');
}
function getCam(facing) {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
}
async function flipCamera(sid) {
  const s = S.sessions.get(sid);
  if (!s || s.dir !== 'out' || s.kind !== 'camera') return;
  const facing = s.facing === 'user' ? 'environment' : 'user';
  try {
    s.stream.getVideoTracks().forEach((t) => t.stop());
    const ns = await getCam(facing);
    const tr = ns.getVideoTracks()[0];
    await s.link.replaceVideo(sid, tr);
    s.stream = ns; s.facing = facing; s.mirror = facing === 'user';
    if (s.win) { $('video', s.win).srcObject = ns; applyMirror(s); }
    s.link.send({ t: 'cam-facing', sid, facing });
  } catch (e) { toast('Gagal mengganti kamera.', { icon: 'x' }); }
}
function requestScreen(duid) {
  const l = linkOf(duid);
  if (!l) return;
  l.send({ t: 'scr-req' });
  toast(`Meminta layar ${esc(devName(duid))}… Konfirmasi di perangkat tersebut.`, { icon: 'mirror' });
}
function requestCamera(duid, facing = 'environment') {
  const l = linkOf(duid);
  if (!l) return;
  l.send({ t: 'cam-req', facing });
  toast(`Meminta kamera ${esc(devName(duid))}… Ketuk Izinkan di perangkat tersebut.`, { icon: 'camera' });
}
function askMedia(duid, kind, facing) {
  const name = esc(devName(duid));
  if (kind === 'screen' && !canShareScreen()) { linkOf(duid) && linkOf(duid).send({ t: 'media-deny', kind }); return; }
  if (S.settings.sound) chime();
  notify('Taut', kind === 'screen' ? `${devName(duid)} ingin melihat layar Anda` : `${devName(duid)} ingin memakai kamera Anda`);
  modal({
    id: 'ask-' + kind, icon: kind === 'screen' ? 'mirror' : 'camera',
    title: kind === 'screen' ? `${name} ingin melihat layar Anda` : `${name} ingin memakai kamera Anda`,
    body: kind === 'screen'
      ? '<p>Pilih layar, jendela, atau tab yang ingin dibagikan. Anda bisa menghentikannya kapan saja.</p>'
      : `<p>Kamera ${facing === 'user' ? 'depan' : 'belakang'} perangkat ini akan tampil di ${name}. Anda bisa menghentikannya kapan saja.</p>`,
    actions: [
      { label: 'Tolak', fn: () => { const l = linkOf(duid); l && l.send({ t: 'media-deny', kind }); } },
      { label: kind === 'screen' ? 'Bagikan layar' : 'Izinkan kamera', primary: true, fn: () => (kind === 'screen' ? shareScreen([duid]) : shareCamera(duid, facing || 'environment')) },
    ],
  });
}
function onMedia(l, ms) {
  if (ms.dir === 'out') return;
  let s = S.sessions.get(ms.sid);
  if (!s) {
    s = { sid: ms.sid, link: l, duid: l.duid, kind: ms.kind, dir: 'in', stream: ms.stream, label: ms.label, facing: ms.extra && ms.extra.facing, mirror: ms.extra && ms.extra.facing === 'user' };
    S.sessions.set(ms.sid, s);
    openWin(s);
    addActivity(ms.kind === 'screen' ? 'mirror' : 'camera', `${devName(l.duid)} membagikan ${ms.kind === 'screen' ? 'layar' : 'kamera'}`);
    if (S.settings.sound) chime();
  } else {
    s.stream = ms.stream;
    if (s.win) { const v = $('video', s.win); if (v.srcObject !== ms.stream) v.srcObject = ms.stream; }
  }
  refresh('sessions');
}
function onMediaEnd(l, ms, remote) {
  const s = S.sessions.get(ms.sid);
  if (!s) return;
  S.sessions.delete(ms.sid);
  closeWin(s);
  if (s.dir === 'out' && ![...S.sessions.values()].some((x) => x.stream === s.stream)) s.stream.getTracks().forEach((t) => t.stop());
  if (remote && s.dir === 'in') toast(`${esc(devName(s.duid))} berhenti membagikan ${s.kind === 'screen' ? 'layar' : 'kamera'}.`, { icon: s.kind === 'screen' ? 'mirror' : 'camera' });
  refresh('sessions');
}
function endSession(sid, notifyRemote = true) {
  const s = S.sessions.get(sid);
  if (!s) return;
  if (notifyRemote && s.link && s.link.open) s.link.stopMedia(sid);
  else if (s.link) { const ms = s.link.media.get(sid); if (ms) s.link._mediaClose(ms, false); }
  if (S.sessions.has(sid)) {
    S.sessions.delete(sid); closeWin(s);
    if (s.dir === 'out' && ![...S.sessions.values()].some((x) => x.stream === s.stream)) s.stream.getTracks().forEach((t) => t.stop());
  }
  refresh('sessions');
}

// ---------- Jendela tampilan (layar/kamera) ----------
let winZ = 50, winN = 0;
function openWin(s) {
  const w = document.createElement('div');
  w.className = 'win' + (s.kind === 'screen' ? ' win-screen' : ' win-cam') + (s.dir === 'out' ? ' win-local' : '');
  const title = s.dir === 'out' ? 'Kamera perangkat ini' : (s.kind === 'screen' ? `Layar ${devName(s.duid)}` : `Kamera ${devName(s.duid)}`);
  const sub = s.dir === 'out' ? `Dibagikan ke ${devName(s.duid)}` : (s.kind === 'screen' ? 'Pencerminan layar' : 'Kamera bersama');
  w.innerHTML = `
    <div class="win-head">
      <span class="win-ic">${icon(s.kind === 'screen' ? 'mirror' : 'camera', 16)}</span>
      <div class="win-t"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
      <div class="win-btns">
        ${s.dir === 'in' ? `<button class="wbtn" data-w="snap" title="Ambil foto">${icon('shutter', 17)}</button>` : ''}
        ${s.kind === 'camera' ? `<button class="wbtn" data-w="flip" title="Ganti kamera depan/belakang">${icon('flip', 17)}</button><button class="wbtn" data-w="mirror" title="Cermin">${icon('mirrorFlip', 17)}</button>` : ''}
        ${s.dir === 'in' ? `<button class="wbtn" data-w="sound" title="Suara">${icon('audio', 17)}</button>` : ''}
        ${document.pictureInPictureEnabled || (HTMLVideoElement.prototype.webkitSetPresentationMode) ? `<button class="wbtn" data-w="pip" title="Gambar dalam gambar">${icon('pip', 17)}</button>` : ''}
        <button class="wbtn" data-w="full" title="Layar penuh">${icon('full', 17)}</button>
        <button class="wbtn danger" data-w="close" title="${s.dir === 'out' ? 'Hentikan' : 'Tutup'}">${icon('x', 17)}</button>
      </div>
    </div>
    <div class="win-body"><video autoplay playsinline muted></video><div class="win-wait">${icon('refresh', 22, 'spin')}<span>Menyambungkan video…</span></div></div>`;
  const v = $('video', w);
  v.srcObject = s.stream;
  v.addEventListener('loadeddata', () => w.classList.add('has-video'));
  v.play().catch(() => {});
  s.win = w;
  applyMirror(s);
  const off = (winN++ % 5) * 28;
  if (!narrow()) {
    const W = s.kind === 'screen' ? Math.min(760, window.innerWidth - 80) : (s.dir === 'out' ? 300 : 420);
    w.style.width = W + 'px';
    w.style.left = Math.max(16, window.innerWidth - W - 32 - off) + 'px';
    w.style.top = 80 + off + 'px';
  }
  w.style.zIndex = ++winZ;
  w.addEventListener('pointerdown', () => { w.style.zIndex = ++winZ; });
  dragify(w, $('.win-head', w));
  w.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    const a = b.dataset.w;
    if (a === 'close') endSession(s.sid, true);
    if (a === 'flip') { if (s.dir === 'out') flipCamera(s.sid); else s.link.send({ t: 'cam-flip', sid: s.sid }); }
    if (a === 'mirror') { s.mirror = !s.mirror; applyMirror(s); }
    if (a === 'sound') { v.muted = !v.muted; b.classList.toggle('on', !v.muted); }
    if (a === 'pip') {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else if (v.requestPictureInPicture) await v.requestPictureInPicture();
        else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode('picture-in-picture');
      } catch {}
    }
    if (a === 'full') {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (w.requestFullscreen) await w.requestFullscreen();
        else if (w.webkitRequestFullscreen) w.webkitRequestFullscreen();
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      } catch { if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
    }
    if (a === 'snap') snapshot(s, v);
  });
  $('#stage').appendChild(w);
}
function closeWin(s) { if (s.win) { s.win.remove(); s.win = null; } }
function applyMirror(s) { if (s.win) $('video', s.win).classList.toggle('mirror', !!s.mirror); }
function dragify(w, handle) {
  let sx, sy, ox, oy, on = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || narrow()) return;
    on = true; sx = e.clientX; sy = e.clientY; ox = w.offsetLeft; oy = w.offsetTop;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!on) return;
    w.style.left = Math.max(-w.offsetWidth + 80, Math.min(window.innerWidth - 80, ox + e.clientX - sx)) + 'px';
    w.style.top = Math.max(0, Math.min(window.innerHeight - 50, oy + e.clientY - sy)) + 'px';
  });
  handle.addEventListener('pointerup', () => { on = false; });
}
async function snapshot(s, v) {
  if (!v.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d');
  if (s.mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(v, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const d = new Date();
  const name = `${s.kind === 'screen' ? 'Tangkapan layar' : 'Foto'} ${devName(s.duid)} ${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
  const r = { id: uid(), blob, name, mime: 'image/png', size: blob.size };
  await storeReceived(r, s.duid);
  s.win && s.win.classList.add('flash');
  setTimeout(() => s.win && s.win.classList.remove('flash'), 300);
  toast(`<b>${esc(name)}</b><br>${c.width}×${c.height} · ${fmtSize(blob.size)}`, { icon: 'image', kind: 'ok', actions: [{ label: 'Simpan', fn: () => saveFile(r.id) }, { label: 'Lihat', fn: () => preview(r.id) }] });
}

// =====================================================================
// CARI PERANGKAT (bunyikan)
// =====================================================================
let ringTimer = null;
function ringDevice(duid) {
  const l = linkOf(duid);
  if (!l) return;
  l.send({ t: 'ring' });
  toast(`Membunyikan ${esc(devName(duid))}…`, { icon: 'ring', actions: [{ label: 'Hentikan', fn: () => l.send({ t: 'ring-stop' }) }] });
}
function startRing(duid) {
  stopRing(true);
  const el = document.createElement('div');
  el.className = 'ring-ov';
  el.innerHTML = `<div class="ring-pulse">${icon('ring', 46)}</div><h2>${esc(devName(duid))} sedang mencari perangkat ini</h2><button class="btn primary lg" data-act="ring-stop">Saya di sini</button>`;
  document.body.appendChild(el);
  let n = 0;
  const beat = () => { chime('ring'); try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {} if (++n > 25) stopRing(); };
  beat();
  ringTimer = setInterval(beat, 1200);
}
function stopRing() {
  clearInterval(ringTimer); ringTimer = null;
  $$('.ring-ov').forEach((x) => x.remove());
}

// =====================================================================
// AKTIVITAS, NOTIFIKASI, LENCANA
// =====================================================================
function addActivity(ic, text) {
  S.activity.unshift({ ic, text, ts: Date.now() });
  S.activity = S.activity.slice(0, 40);
  save.activity();
  refresh('activity');
}
function notify(title, body) {
  if (!S.settings.notify || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body: String(body).slice(0, 200), icon: 'icons/icon-192.png', tag: 'taut' }));
    else new Notification(title, { body: String(body).slice(0, 200), icon: 'icons/icon-192.png' });
  } catch {}
}
function bump(page) { S.unread[page] = (S.unread[page] || 0) + 1; refresh('badges'); }

// =====================================================================
// UI DASAR: modal, toast, pemilih berkas
// =====================================================================
function toast(html, { icon: ic = 'info', actions = [], timeout = 4200, kind = '' } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${icon(ic, 18)}</span><div class="t-body">${html}</div>${actions.map((a, i) => `<button class="t-act" data-i="${i}">${esc(a.label)}</button>`).join('')}<button class="t-x" aria-label="Tutup">${icon('x', 14)}</button>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.i != null) actions[+b.dataset.i].fn();
    el.classList.add('out'); setTimeout(() => el.remove(), 200);
  });
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, timeout);
}

const modals = new Map();
function modal({ id = uid(), title = '', icon: ic = '', body = '', actions = [], cls = '', onClose, wide = false, dismiss = true }) {
  closeModal(id);
  const el = document.createElement('div');
  el.className = 'modal-wrap';
  el.innerHTML = `<div class="modal ${cls} ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    ${title ? `<div class="modal-head">${ic ? `<span class="m-ic">${icon(ic, 22)}</span>` : ''}<h2>${title}</h2>${dismiss ? `<button class="icon-btn m-x" aria-label="Tutup">${icon('x', 18)}</button>` : ''}</div>` : ''}
    <div class="modal-body">${body}</div>
    ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-mi="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
  const close = () => { if (!modals.has(id)) return; modals.delete(id); el.classList.add('out'); setTimeout(() => el.remove(), 180); onClose && onClose(); };
  el.addEventListener('click', (e) => {
    if (dismiss && (e.target === el || e.target.closest('.m-x'))) { close(); return; }
    const b = e.target.closest('[data-mi]');
    if (b) { const a = actions[+b.dataset.mi]; const r = a.fn && a.fn(); if (r !== false) close(); }
  });
  $('#overlays').appendChild(el);
  modals.set(id, { el, close });
  return { el, close };
}
function closeModal(id) { const m = modals.get(id); if (m) m.close(); }

function ask({ title, label = '', value = '', placeholder = '', ok = 'Simpan', type = 'text' }) {
  return new Promise((res) => {
    let done = false;
    const m = modal({
      id: 'ask', title, body: `<label class="fld"><span>${label}</span><input id="askIn" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>`,
      actions: [{ label: 'Batal', fn: () => { done = true; res(null); } }, { label: ok, primary: true, fn: () => { done = true; res($('#askIn').value); } }],
      onClose: () => { if (!done) res(null); },
    });
    const inp = $('#askIn', m.el);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; res(inp.value); m.close(); } });
  });
}

function pickFiles({ multiple = true, accept = '', capture = '', dir = false } = {}) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = multiple;
    if (accept) inp.accept = accept;
    if (capture) inp.setAttribute('capture', capture);
    if (dir) { inp.webkitdirectory = true; inp.setAttribute('webkitdirectory', ''); }
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      res([...inp.files].map((f) => ({ file: f, rel: f.webkitRelativePath || '' })));
      inp.remove();
    });
    inp.addEventListener('cancel', () => { res([]); inp.remove(); });
    inp.click();
  });
}

// Ambil berkas dari drag & drop (termasuk folder)
async function filesFromDrop(dt) {
  const out = [];
  const items = dt.items ? [...dt.items] : [];
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])].map((f) => ({ file: f, rel: '' }));
  const walk = async (ent, path) => {
    if (ent.isFile) {
      const f = await new Promise((r, j) => ent.file(r, j)).catch(() => null);
      if (f) out.push({ file: f, rel: path ? path + '/' + f.name : '' });
    } else if (ent.isDirectory) {
      const reader = ent.createReader();
      let batch;
      do {
        batch = await new Promise((r) => reader.readEntries(r, () => r([])));
        for (const e of batch) await walk(e, (path ? path + '/' : '') + ent.name);
      } while (batch.length);
    }
  };
  for (const e of entries) {
    if (e.isDirectory) await walk(e, '');
    else await walk(e, '');
  }
  // berkas lepas tanpa folder tidak punya rel
  return out.map((x) => ({ file: x.file, rel: x.rel.includes('/') ? x.rel : '' }));
}

// =====================================================================
// TAMPILAN
// =====================================================================
const NAV = [
  { id: 'home', label: 'Beranda', ic: 'home' },
  { id: 'transfer', label: 'Transfer Bebas', short: 'Transfer', ic: 'transfer' },
  { id: 'clipboard', label: 'Papan Klip Super', short: 'Papan Klip', ic: 'clipboard' },
  { id: 'mirror', label: 'Pencerminan Layar', short: 'Layar', ic: 'mirror' },
  { id: 'camera', label: 'Kamera Bersama', short: 'Kamera', ic: 'camera' },
  { id: 'notes', label: 'Catatan', ic: 'notes' },
  { id: 'files', label: 'Akses Berkas', short: 'Berkas', ic: 'folder' },
];
const TABS = ['home', 'transfer', 'clipboard', 'notes'];

function shell() {
  $('#sidebar').innerHTML = `
    <div class="brand">${logo(34)}<div class="brand-t"><b>Taut</b><span>Kit Kerja Lintas Perangkat</span></div></div>
    <button class="me-card" data-act="connect" id="meCard"></button>
    <nav class="nav">${NAV.map((n) => `<button class="nav-item" data-page="${n.id}" title="${n.label}">${icon(n.ic, 20)}<span>${n.label}</span><i class="badge" data-badge="${n.id}"></i></button>`).join('')}</nav>
    <div class="side-sec"><span>Perangkat terhubung</span><button class="mini-btn" data-act="connect" title="Hubungkan perangkat">${icon('plus', 16)}</button></div>
    <div id="sideDevices" class="side-devices"></div>
    <div class="side-foot"><button class="nav-item" data-page="settings">${icon('settings', 20)}<span>Pengaturan</span></button></div>`;
  $('#tabbar').innerHTML = TABS.map((id) => { const n = NAV.find((x) => x.id === id); return `<button class="tab" data-page="${id}">${icon(n.ic, 22)}<span>${n.short || n.label}</span><i class="badge" data-badge="${id}"></i></button>`; }).join('') +
    `<button class="tab" data-act="more">${icon('grid', 22)}<span>Lainnya</span><i class="badge" data-badge="more"></i></button>`;
}

const PAGES = {};
function go(page) {
  if (!PAGES[page]) page = 'home';
  if (S.page === 'notes' && page !== 'notes') flushNoteEdit();
  S.page = page;
  S.unread[page] = 0;
  $$('[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  const n = NAV.find((x) => x.id === page);
  $('#pageTitle').textContent = page === 'settings' ? 'Pengaturan' : (n ? n.label : 'Taut');
  const view = $('#view');
  view.className = 'view page-' + page;
  view.innerHTML = PAGES[page].html();
  view.scrollTop = 0;
  PAGES[page].mount && PAGES[page].mount(view);
  refresh('badges');
  if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
  closeModal('more');
}

let pending = new Set(), raf = 0;
function refresh(what) {
  pending.add(what);
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const p = pending; pending = new Set();
    if (p.has('devices') || p.has('status') || p.has('stats')) { renderMe(); renderSideDevices(); renderNetPill(); }
    if (p.has('status')) { const st = $('#cxStatus'); if (st) st.innerHTML = netStateHtml(); }
    renderBadges();
    const pg = PAGES[S.page];
    if (pg && pg.update) pg.update(p);
  });
}

function netStateHtml() {
  const s = net.signal.state;
  if (s === 'online') return `<span class="dot ok"></span>Siap dihubungkan`;
  if (s === 'connecting') return `<span class="dot warn"></span>Menyambung ke server…`;
  return `<span class="dot bad"></span>Luring — periksa internet`;
}
function renderNetPill() {
  const s = net.signal.state, n = connected().length;
  const el = $('#netPill');
  el.className = 'net-pill ' + (s === 'online' ? 'ok' : s === 'connecting' ? 'warn' : 'bad');
  el.innerHTML = `<span class="dot"></span><span>${s === 'online' ? (n ? `${n} perangkat terhubung` : 'Daring') : s === 'connecting' ? 'Menyambung…' : 'Luring'}</span>`;
}
function batteryHtml(b) {
  if (!b || b.level == null) return '';
  const lv = Math.max(0, Math.min(100, b.level));
  return `<span class="batt ${lv <= 20 ? 'low' : ''} ${b.charging ? 'chg' : ''}" title="Baterai ${lv}%"><span class="batt-b"><i style="width:${lv}%"></i></span>${lv}%${b.charging ? icon('bolt', 11) : ''}</span>`;
}
function viaHtml(d) {
  if (!d.via) return '';
  const t = d.via === 'lan' ? 'Jaringan lokal' : d.via === 'relay' ? 'Relay' : 'Internet P2P';
  return `<span class="via">${icon(d.via === 'lan' ? 'wifi' : 'globe', 12)}${t}${d.rtt != null ? ' · ' + d.rtt + ' ms' : ''}</span>`;
}
function renderMe() {
  const el = $('#meCard');
  if (!el) return;
  el.innerHTML = `<span class="me-ic">${icon(deviceIcon(me.type), 22)}</span><span class="me-t"><b>${esc(me.name)}</b><small>Kode ${fmtCode(me.code)} · ${connected().length} terhubung</small></span><span class="dot ${net.signal.state === 'online' ? 'ok' : net.signal.state === 'connecting' ? 'warn' : 'bad'}"></span>`;
}
function renderSideDevices() {
  const el = $('#sideDevices');
  if (!el) return;
  const list = connected();
  const conn = [...net.links.values()].filter((l) => l.state === 'connecting' && !l.quiet);
  el.innerHTML = list.map((d) => `<button class="side-dev ${S.sel === d.uid && S.page === 'transfer' ? 'active' : ''}" data-act="open-dev" data-uid="${d.uid}">
      <span class="sd-ic">${icon(deviceIcon(d.type), 18)}<i class="dot ok"></i></span>
      <span class="sd-t"><b>${esc(d.name)}</b><small>${d.via ? (d.via === 'lan' ? 'Jaringan lokal' : 'Internet') : 'Terhubung'}${d.battery && d.battery.level != null ? ' · ' + d.battery.level + '%' : ''}</small></span></button>`).join('') +
    conn.map((l) => `<div class="side-dev wait"><span class="sd-ic">${icon('refresh', 18, 'spin')}</span><span class="sd-t"><b>${fmtCode(l.rid)}</b><small>Menunggu persetujuan…</small></span></div>`).join('') +
    (!list.length && !conn.length ? `<button class="side-empty" data-act="connect">${icon('qr', 18)}<span>Belum ada perangkat.<br><b>Hubungkan sekarang</b></span></button>` : '');
}
function renderBadges() {
  for (const b of $$('[data-badge]')) {
    const id = b.dataset.badge;
    let n = id === 'more' ? NAV.filter((x) => !TABS.includes(x.id)).reduce((a, x) => a + (S.unread[x.id] || 0), 0) : (S.unread[id] || 0);
    if (S.page === id) n = 0;
    b.textContent = n > 99 ? '99+' : n || '';
    b.classList.toggle('show', n > 0);
  }
}

// ---------------------------------------------------------------------
// HALAMAN: BERANDA
// ---------------------------------------------------------------------
const FEATURES = [
  { page: 'transfer', ic: 'transfer', t: 'Transfer Bebas', d: 'Kirim foto, video, dokumen, hingga satu folder utuh tanpa kabel.', c: 'blue' },
  { page: 'clipboard', ic: 'clipboard', t: 'Papan Klip Super', d: 'Salin di satu perangkat, tempel di perangkat lain.', c: 'violet' },
  { page: 'mirror', ic: 'mirror', t: 'Pencerminan Layar', d: 'Tampilkan layar Windows/Mac di iPad atau perangkat lain.', c: 'teal' },
  { page: 'camera', ic: 'camera', t: 'Kamera Bersama', d: 'Jadikan kamera iPad/HP sebagai kamera untuk komputer.', c: 'orange' },
  { page: 'notes', ic: 'notes', t: 'Catatan', d: 'Catatan tersinkron otomatis di semua perangkat.', c: 'yellow' },
  { page: 'files', ic: 'folder', t: 'Akses Berkas', d: 'Jelajahi dan ambil berkas yang dibagikan perangkat lain.', c: 'green' },
  { act: 'send-link', ic: 'handoff', t: 'Lanjutkan di Perangkat Lain', d: 'Kirim tautan atau teks, buka langsung di perangkat lain.', c: 'pink' },
  { act: 'ring-pick', ic: 'ring', t: 'Cari Perangkat', d: 'Bunyikan perangkat yang terhubung untuk menemukannya.', c: 'red' },
];
PAGES.home = {
  html: () => `
    <section class="hero-card">
      <div class="hero-txt">
        <span class="eyebrow">${icon(deviceIcon(me.type), 14)} Perangkat ini · ${esc(me.os)}</span>
        <h2>${esc(me.name)}</h2>
        <p>Kode perangkat <b class="code-chip">${fmtCode(me.code)}</b></p>
        <div class="hero-actions">
          <button class="btn primary" data-act="connect">${icon('qr', 18)}Hubungkan perangkat</button>
          <button class="btn" data-act="rename">${icon('edit', 16)}Ganti nama</button>
        </div>
      </div>
      <div class="hero-art" id="heroArt"></div>
    </section>
    <div class="sec-h"><h3>Perangkat terhubung</h3><span id="homeCount" class="muted"></span></div>
    <div id="homeDevices"></div>
    <div class="sec-h"><h3>Fitur</h3></div>
    <div class="feat-grid">${FEATURES.map((f) => `<button class="feat ${f.c}" ${f.page ? `data-page="${f.page}"` : `data-act="${f.act}"`}><span class="feat-ic">${icon(f.ic, 22)}</span><b>${f.t}</b><small>${f.d}</small></button>`).join('')}</div>
    <div class="sec-h"><h3>Aktivitas terbaru</h3></div>
    <div id="homeActivity" class="card list-card"></div>`,
  mount() { this.update(new Set(['devices', 'activity'])); },
  update(p) {
    if (p.has('devices') || p.has('status') || p.has('stats')) {
      const list = connected();
      $('#heroArt').innerHTML = heroArt(list);
      $('#homeCount').textContent = list.length ? `${list.length} perangkat` : '';
      $('#homeDevices').innerHTML = list.length ? `<div class="dev-grid">${list.map(devCard).join('')}</div>` : emptyConnect();
      if (!list.length) renderQR($('#homeQR'), 132);
    }
    if (p.has('activity') || p.has('devices')) {
      $('#homeActivity').innerHTML = S.activity.length
        ? S.activity.slice(0, 8).map((a) => `<div class="act-row"><span class="act-ic">${icon(a.ic, 16)}</span><span class="act-t">${esc(a.text)}</span><small>${fmtAgo(a.ts)}</small></div>`).join('')
        : `<div class="empty-sm">Belum ada aktivitas. Hubungkan perangkat untuk mulai.</div>`;
    }
  },
};
function heroArt(list) {
  const others = list.slice(0, 3);
  return `<div class="constellation n${others.length}">
    <div class="node me-node">${deviceArt(me.type)}<span>${esc(me.name)}</span></div>
    ${others.map((d, i) => `<div class="link-line l${i}"></div><div class="node o${i}">${deviceArt(d.type)}<span>${esc(d.name)}</span></div>`).join('')}
    ${!others.length ? `<div class="node ghost g0">${deviceArt('tablet')}</div><div class="node ghost g1">${deviceArt('phone')}</div><div class="pulse-ring"></div>` : ''}
  </div>`;
}
function devCard(d) {
  return `<div class="dev-card">
    <div class="dev-top">
      <div class="dev-art">${deviceArt(d.type)}</div>
      <div class="dev-info">
        <b>${esc(d.name)}</b>
        <span class="chip ok"><i class="dot ok"></i>Terhubung</span>
        <div class="dev-sub">${viaHtml(d)}${batteryHtml(d.battery)}</div>
      </div>
      <button class="icon-btn" data-act="dev-menu" data-uid="${d.uid}" title="Lainnya">${icon('more', 18)}</button>
    </div>
    <div class="dev-acts">
      <button data-act="send-files" data-uid="${d.uid}">${icon('transfer', 18)}<span>Kirim berkas</span></button>
      <button data-act="send-clip" data-uid="${d.uid}">${icon('clipboard', 18)}<span>Papan klip</span></button>
      ${d.features && d.features.screen ? `<button data-act="req-screen" data-uid="${d.uid}">${icon('mirror', 18)}<span>Lihat layar</span></button>` : (canShareScreen() ? `<button data-act="share-screen" data-uid="${d.uid}">${icon('mirror', 18)}<span>Bagikan layar</span></button>` : '')}
      ${d.features && d.features.camera ? `<button data-act="req-cam" data-uid="${d.uid}">${icon('camera', 18)}<span>Pakai kamera</span></button>` : ''}
      <button data-act="ring" data-uid="${d.uid}">${icon('ring', 18)}<span>Bunyikan</span></button>
    </div>
  </div>`;
}
function emptyConnect() {
  return `<div class="card empty-connect">
    <div class="ec-qr" id="homeQR"></div>
    <div class="ec-t">
      <h3>Hubungkan perangkat pertama Anda</h3>
      <p>Buka <b>${esc(APP_URL.replace(/^https?:\/\//, ''))}</b> di iPad, HP, Windows, atau Mac lain, lalu pindai kode QR ini atau ketik kode <b>${fmtCode(me.code)}</b>.</p>
      <div class="row gap">
        <button class="btn primary" data-act="connect">${icon('plus', 18)}Masukkan kode</button>
        ${canCamera() ? `<button class="btn" data-act="scan">${icon('scan', 18)}Pindai QR</button>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------
// HALAMAN: TRANSFER BEBAS
// ---------------------------------------------------------------------
PAGES.transfer = {
  html: () => `
    <div class="split ${narrow() && S.sel && S.mobileConv ? 'show-conv' : ''}" id="split">
      <aside class="conv-list card" id="convList"></aside>
      <section class="conv card" id="conv">
        <header class="conv-head" id="convHead"></header>
        <div class="timeline" id="timeline"></div>
        <footer class="composer" id="composer">
          <button class="icon-btn" data-act="tf-files" title="Kirim berkas">${icon('clip', 20)}</button>
          ${canShareScreen() || !isIOS() ? `<button class="icon-btn hide-sm" data-act="tf-folder" title="Kirim folder">${icon('folderUp', 20)}</button>` : ''}
          ${isIOS() || /Android/.test(navigator.userAgent) ? `<button class="icon-btn" data-act="tf-photo" title="Ambil foto & kirim">${icon('camera', 20)}</button>` : ''}
          <textarea id="msgInput" rows="1" placeholder="${narrow() ? 'Ketik pesan…' : 'Ketik pesan atau tempel tautan…'}"></textarea>
          <button class="send-btn" data-act="tf-send" title="Kirim">${icon('send', 20)}</button>
        </footer>
        <div class="drop-ov">${icon('download', 40)}<b>Lepaskan untuk mengirim</b><span id="dropTo"></span></div>
      </section>
    </div>`,
  mount(view) {
    const inp = $('#msgInput');
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(S.sel, inp.value); inp.value = ''; autoGrow(inp); }
    });
    inp.addEventListener('input', () => autoGrow(inp));
    const conv = $('#conv');
    let dc = 0;
    conv.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dc++; conv.classList.add('drag'); } });
    conv.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    conv.addEventListener('dragleave', () => { if (--dc <= 0) { dc = 0; conv.classList.remove('drag'); } });
    conv.addEventListener('drop', async (e) => {
      e.preventDefault(); dc = 0; conv.classList.remove('drag');
      if (!S.sel || !linkOf(S.sel)) { toast('Pilih perangkat yang terhubung dulu.', { icon: 'info' }); return; }
      sendFiles(S.sel, await filesFromDrop(e.dataTransfer));
    });
    this.update(new Set(['devices', 'timeline']));
  },
  update(p) {
    if (p.has('devices') || p.has('status')) { renderConvList(); renderConvHead(); }
    else if (p.has('stats')) renderConvHead();
    if (p.has('timeline') || p.has('devices')) {
      if (p.has('timeline') || this._for !== S.sel) { this._for = S.sel; renderTimeline(); }
    }
  },
};
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; }
function convDevices() {
  const ids = new Set(connected().map((d) => d.uid));
  for (const t of Object.values(S.trusted)) ids.add(t.uid);
  return [...ids].map((id) => devOf(id) || { ...S.trusted[id], ready: false }).sort((a, b) => (b.ready ? 1 : 0) - (a.ready ? 1 : 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
}
function renderConvList() {
  const el = $('#convList');
  if (!el) return;
  const list = convDevices();
  if (!S.sel && list.length) S.sel = list[0].uid;
  el.innerHTML = `<div class="cl-head"><b>Perangkat</b><button class="mini-btn" data-act="connect" title="Hubungkan">${icon('plus', 16)}</button></div>` + (list.length ? list.map((d) => {
    const last = tl(d.uid).slice(-1)[0];
    const lastTxt = last ? (last.kind === 'text' ? last.text : last.kind === 'batch' ? '📁 ' + last.name : '📎 ' + last.name) : (d.ready ? 'Terhubung' : 'Tidak terhubung');
    return `<button class="cl-item ${S.sel === d.uid ? 'active' : ''} ${d.ready ? '' : 'off'}" data-act="sel-dev" data-uid="${d.uid}">
      <span class="cl-ic">${icon(deviceIcon(d.type), 20)}<i class="dot ${d.ready ? 'ok' : 'off'}"></i></span>
      <span class="cl-t"><b>${esc(d.name)}</b><small>${esc(String(lastTxt).slice(0, 48))}</small></span>
      ${last ? `<small class="cl-time">${fmtTime(last.ts).replace(/^.*, /, '')}</small>` : ''}</button>`;
  }).join('') : `<div class="empty-sm">Belum ada perangkat.<br><button class="btn sm primary" data-act="connect">Hubungkan</button></div>`);
}
function renderConvHead() {
  const el = $('#convHead');
  if (!el) return;
  const d = S.sel && (devOf(S.sel) || S.trusted[S.sel]);
  if (!d) { el.innerHTML = `<div class="ch-t"><b>Transfer Bebas</b><small>Hubungkan perangkat untuk mulai mengirim</small></div>`; $('#composer').classList.add('disabled'); return; }
  const on = !!linkOf(S.sel);
  $('#composer').classList.toggle('disabled', !on);
  $('#dropTo') && ($('#dropTo').textContent = 'ke ' + d.name);
  el.innerHTML = `<button class="icon-btn back-btn" data-act="conv-back">${icon('left', 20)}</button>
    <span class="ch-ic">${icon(deviceIcon(d.type), 20)}</span>
    <div class="ch-t"><b>${esc(d.name)}</b><small>${on ? `<i class="dot ok"></i>Terhubung ${devOf(S.sel).via ? '· ' + (devOf(S.sel).via === 'lan' ? 'jaringan lokal' : 'internet') : ''}` : '<i class="dot off"></i>Tidak terhubung'}</small></div>
    <div class="ch-acts">
      ${on ? `<button class="btn sm" data-act="tf-files">${icon('clip', 16)}<span class="hide-sm">Berkas</span></button>
      ${!isIOS() ? `<button class="btn sm hide-sm" data-act="tf-folder">${icon('folderUp', 16)}<span>Folder</span></button>` : ''}
      <button class="btn sm" data-act="tf-clear" title="Bersihkan riwayat">${icon('trash', 16)}</button>` : `<button class="btn sm primary" data-act="reconnect" data-uid="${S.sel}">${icon('refresh', 16)}Hubungkan ulang</button>`}
    </div>`;
}
function renderTimeline() {
  const el = $('#timeline');
  if (!el) return;
  if (!S.sel) { el.innerHTML = emptyTimeline(); return; }
  const items = tl(S.sel);
  el.innerHTML = items.length ? items.map(itemHtml).join('') : emptyTimeline(true);
  hydrateThumbs(el);
  el.scrollTop = el.scrollHeight;
}
function emptyTimeline(dev) {
  return `<div class="tl-empty">${icon('transfer', 40)}<b>${dev ? 'Mulai berbagi' : 'Transfer Bebas'}</b><span>Seret berkas atau folder ke sini, tempel (${MOD}+V) gambar, atau ketik pesan. Berkas dikirim langsung antar perangkat tanpa batas ukuran.</span></div>`;
}
function appendTimeline(item) {
  const el = $('#timeline');
  if (!el) return;
  if ($('.tl-empty', el)) el.innerHTML = '';
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  el.insertAdjacentHTML('beforeend', itemHtml(item));
  hydrateThumbs(el);
  if (near || item.dir === 'out') el.scrollTop = el.scrollHeight;
  renderConvList();
}
function updateItem(duid, it) {
  if (S.page !== 'transfer' || S.sel !== duid) return;
  const node = $(`#timeline [data-id="${it.id}"]`);
  if (!node) return;
  node.outerHTML = itemHtml(it);
  hydrateThumbs($('#timeline'));
}
const progEmit = new Map();
function patchProgress(duid, it, frac, speed) {
  if (S.page !== 'transfer' || S.sel !== duid) return;
  const now = performance.now();
  if (now - (progEmit.get(it.id) || 0) < 100 && frac < 1) return;
  progEmit.set(it.id, now);
  const node = $(`#timeline [data-id="${it.id}"]`);
  if (!node) return;
  const bar = $('.prog i', node), lab = $('.pstat', node);
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  if (bar) bar.style.width = pct + '%';
  if (lab) lab.textContent = `${pct}%${speed ? ' · ' + fmtSpeed(speed) : ''}`;
}
const STATE_TXT = { queued: 'Mengantre', sending: 'Mengirim', receiving: 'Menerima', done: '', failed: 'Gagal', cancelled: 'Dibatalkan' };
function itemHtml(it) {
  const time = `<span class="m-time">${fmtTime(it.ts)}${it.dir === 'out' && it.state === 'done' ? ' · ' + icon('check', 12) : ''}</span>`;
  if (it.kind === 'text') {
    const url = firstUrl(it.text);
    return `<div class="msg ${it.dir}" data-id="${it.id}"><div class="bubble text">${linkify(it.text)}
      <div class="b-acts"><button data-act="copy-text" data-id="${it.id}">${icon('copy', 14)}Salin</button>${url && it.dir === 'in' ? `<a href="${esc(url)}" target="_blank" rel="noopener">${icon('link', 14)}Buka</a>` : ''}</div></div>${time}</div>`;
  }
  const active = ['queued', 'sending', 'receiving'].includes(it.state);
  const st = STATE_TXT[it.state] || '';
  if (it.kind === 'batch') {
    const pct = Math.round((it.doneBytes / Math.max(1, it.size)) * 100);
    return `<div class="msg ${it.dir}" data-id="${it.id}"><div class="bubble file">
      <div class="file-card"><span class="f-ic folder">${icon('folder', 24)}</span>
        <div class="f-info"><b>${esc(it.name)}</b><small>${it.count} berkas · ${fmtSize(it.size)}${st ? ' · ' + st : ''}${it.state === 'done' && it.files && it.files.some((f) => f.disk) ? ' · tersimpan di folder' : ''}</small>
        ${active ? `<div class="prog"><i style="width:${pct}%"></i></div><small class="pstat">${pct}% · ${it.doneCount}/${it.count}</small>` : ''}</div></div>
      <div class="f-acts">${active ? `<button data-act="tf-cancel" data-id="${it.id}">${icon('x', 14)}Batal</button>` : ''}
      ${it.dir === 'in' && it.state === 'done' ? `<button data-act="save-batch" data-id="${it.id}">${icon('download', 14)}Simpan ZIP</button>` : ''}</div>
    </div>${time}</div>`;
  }
  const k = fileKind(it.mime, it.name);
  const pct = 0;
  const media = k === 'image' && (it.state === 'done' || it.dir === 'out') && !it.disk;
  return `<div class="msg ${it.dir}" data-id="${it.id}"><div class="bubble file ${media ? 'has-media' : ''}">
    ${media ? `<button class="media-prev" data-act="preview" data-fid="${it.fid}"><img data-fid="${it.fid}" alt=""></button>` : ''}
    <div class="file-card"><span class="f-ic ${k}">${icon(kindIcon(k), 22)}<em>${esc(extOf(it.name))}</em></span>
      <div class="f-info"><b title="${esc(it.name)}">${esc(it.name)}</b><small>${fmtSize(it.size)}${st ? ' · ' + st : ''}${it.disk ? ' · tersimpan di folder' : ''}${it.fromShare ? ' · dari Akses Berkas' : ''}</small>
      ${active ? `<div class="prog"><i style="width:${pct}%"></i></div><small class="pstat">${it.state === 'queued' ? 'Mengantre…' : '0%'}</small>` : ''}</div></div>
    <div class="f-acts">${active ? `<button data-act="tf-cancel" data-id="${it.id}">${icon('x', 14)}Batal</button>` : ''}
      ${it.state === 'done' && !it.disk ? `${!media && ['image', 'video', 'audio', 'doc'].includes(k) ? `<button data-act="preview" data-fid="${it.fid}">${icon('eye', 14)}Buka</button>` : ''}
        ${it.dir === 'in' ? `<button data-act="save-file" data-fid="${it.fid}">${icon('download', 14)}Simpan</button>` : ''}
        ${isIOS() ? `<button data-act="share-file" data-fid="${it.fid}">${icon('share', 14)}Bagikan</button>` : ''}` : ''}
    </div></div>${time}</div>`;
}
function hydrateThumbs(root) {
  for (const img of $$('img[data-fid]', root)) {
    if (img.src) continue;
    blobUrl(img.dataset.fid).then((u) => { if (u) img.src = u; else { const b = img.closest('.media-prev'); b && b.remove(); } });
  }
}

// ---------------------------------------------------------------------
// HALAMAN: PAPAN KLIP SUPER
// ---------------------------------------------------------------------
PAGES.clipboard = {
  html: () => `
    <div class="clip-grid">
      <section class="card clip-main">
        <div class="clip-hero"><span class="big-ic violet">${icon('clipboard', 26)}</span><div><h3>Salin di sini, tempel di sana</h3><p>Teks dan gambar yang Anda kirim langsung masuk ke papan klip perangkat lain.</p></div></div>
        <textarea id="clipText" class="big-input" rows="4" placeholder="Ketik atau tempel teks di sini…"></textarea>
        <div class="clip-row">
          <select id="clipTarget" class="select"></select>
          <div class="grow"></div>
          <button class="btn" data-act="clip-current">${icon('clipboard', 16)}Kirim isi papan klip</button>
          <button class="btn primary" data-act="clip-send">${icon('send', 16)}Kirim</button>
        </div>
        <p class="hint">${icon('keyboard', 14)} Tekan <kbd>${MOD}</kbd>+<kbd>V</kbd> di mana saja di Taut (di luar kotak teks) untuk langsung mengirim isi papan klip.</p>
      </section>
      <section class="card clip-set" id="clipSet"></section>
    </div>
    <div class="sec-h"><h3>Riwayat papan klip</h3><button class="btn sm" data-act="clip-clear">${icon('trash', 14)}Bersihkan</button></div>
    <div id="clipList" class="clip-list"></div>`,
  mount() { this.update(new Set(['clips', 'devices'])); },
  update(p) {
    if (p.has('devices')) {
      const sel = $('#clipTarget');
      if (sel) { const v = sel.value; const list = connected(); sel.innerHTML = `<option value="">Semua perangkat (${list.length})</option>` + list.map((d) => `<option value="${d.uid}">${esc(d.name)}</option>`).join(''); sel.value = list.some((d) => d.uid === v) ? v : ''; }
    }
    if (p.has('clips') || p.has('devices') || p.has('settings')) {
      const autoOk = !isIOS() && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !!(navigator.clipboard && navigator.clipboard.readText);
      $('#clipSet').innerHTML = `<h3>Pengaturan</h3>
        ${switchRow('clipAutoCopy', 'Salin otomatis saat menerima', 'Isi papan klip dari perangkat lain langsung disalin ke perangkat ini (iPad/Safari: ketuk Salin pada pemberitahuan).')}
        ${switchRow('clipAuto', 'Sinkron otomatis', autoOk ? 'Saat Anda menyalin sesuatu lalu kembali ke Taut, isinya dikirim otomatis ke semua perangkat.' : 'Tersedia di Chrome/Edge untuk Windows & Mac.', !autoOk)}
        <div class="mini-stats"><div><b>${S.clips.filter((c) => c.dir === 'out').length}</b><small>Terkirim</small></div><div><b>${S.clips.filter((c) => c.dir === 'in').length}</b><small>Diterima</small></div><div><b>${connected().length}</b><small>Perangkat</small></div></div>`;
      const el = $('#clipList');
      el.innerHTML = S.clips.length ? S.clips.map((c) => `<div class="clip-item ${c.dir}">
          <div class="ci-head"><span class="ci-dir">${icon(c.dir === 'in' ? 'download' : 'send', 14)}${c.dir === 'in' ? 'Dari ' + esc(devName(c.from)) : 'Ke ' + esc((c.to || []).map(devName).join(', ') || 'perangkat')}</span><small>${fmtTime(c.ts)}</small></div>
          ${c.kind === 'image' ? `<button class="ci-img" data-act="preview" data-fid="${c.fid}"><img data-fid="${c.fid}" alt=""></button>` : `<div class="ci-text">${linkify(c.text)}</div>`}
          <div class="ci-acts">
            ${c.kind === 'image' ? `<button class="btn sm" data-act="clip-copy-img" data-fid="${c.fid}">${icon('copy', 14)}Salin</button><button class="btn sm" data-act="save-file" data-fid="${c.fid}">${icon('download', 14)}Simpan</button>` : `<button class="btn sm" data-act="clip-copy" data-id="${c.id}">${icon('copy', 14)}Salin</button><button class="btn sm" data-act="clip-resend" data-id="${c.id}">${icon('send', 14)}Kirim lagi</button>`}
            <button class="btn sm ghost" data-act="clip-del" data-id="${c.id}">${icon('trash', 14)}</button>
          </div></div>`).join('') : `<div class="card empty-sm">${icon('clipboard', 28)}<br>Belum ada riwayat. Salin teks di perangkat lain lalu kirim ke sini.</div>`;
      hydrateThumbs(el);
    }
  },
};
function switchRow(key, title, desc, disabled = false) {
  return `<label class="sw-row ${disabled ? 'disabled' : ''}"><span class="sw-t"><b>${title}</b><small>${desc}</small></span><span class="switch"><input type="checkbox" data-set="${key}" ${S.settings[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i></i></span></label>`;
}

// ---------------------------------------------------------------------
// HALAMAN: PENCERMINAN LAYAR
// ---------------------------------------------------------------------
PAGES.mirror = {
  html: () => `
    <section class="feature-hero teal"><div class="fh-ic">${icon('mirror', 30)}</div><div><h2>Pencerminan Layar</h2><p>Tampilkan layar Windows atau Mac secara langsung di iPad, HP, atau komputer lain — cocok untuk presentasi, mengajar, atau memantau dari jauh.</p></div></section>
    <div class="cards2">
      <section class="card"><h3>${icon('send', 18)} Bagikan layar perangkat ini</h3><div id="mirShare"></div></section>
      <section class="card"><h3>${icon('eye', 18)} Lihat layar perangkat lain</h3><div id="mirView"></div></section>
    </div>
    <div class="sec-h"><h3>Sesi aktif</h3></div><div id="sessList"></div>`,
  mount() { this.update(new Set(['devices', 'sessions'])); },
  update(p) {
    if (p.has('devices') || p.has('sessions')) {
      const list = connected();
      $('#mirShare').innerHTML = canShareScreen()
        ? (list.length ? `<p class="muted">Pilih perangkat yang akan menampilkan layar ini:</p><div class="pick-list">${list.map((d) => `<label class="pick"><input type="checkbox" name="mirTo" value="${d.uid}" checked><span>${icon(deviceIcon(d.type), 18)}${esc(d.name)}</span></label>`).join('')}</div><button class="btn primary" data-act="mir-start">${icon('mirror', 18)}Mulai berbagi layar</button>` : noDev())
        : `<div class="notice">${icon('info', 18)}<span>${esc(DEV.label)} tidak dapat membagikan layarnya dari browser (batasan sistem ${esc(DEV.os)}). Perangkat ini tetap bisa <b>menampilkan</b> layar dari Windows atau Mac lewat bagian <b>Lihat layar perangkat lain</b>.</span></div>`;
      const viewers = list.filter((d) => d.features && d.features.screen);
      $('#mirView').innerHTML = list.length ? (viewers.length ? `<div class="dev-rows">${viewers.map((d) => `<div class="dev-row"><span>${icon(deviceIcon(d.type), 20)}</span><b>${esc(d.name)}</b><button class="btn sm primary" data-act="req-screen" data-uid="${d.uid}">Minta layar</button></div>`).join('')}</div><p class="hint">Perangkat tujuan akan diminta memilih layar yang dibagikan.</p>` : `<div class="notice">${icon('info', 18)}<span>Perangkat terhubung tidak mendukung berbagi layar. Hubungkan Windows atau Mac.</span></div>`) : noDev();
      renderSessions('screen');
    }
  },
};
PAGES.camera = {
  html: () => `
    <section class="feature-hero orange"><div class="fh-ic">${icon('camera', 30)}</div><div><h2>Kamera Bersama</h2><p>Pakai kamera iPad atau HP sebagai kamera untuk komputer — tunjukkan dokumen, benda, atau tulisan tangan dengan kamera belakang yang tajam. Ambil foto langsung dari jendela tampilan.</p></div></section>
    <div class="cards2">
      <section class="card"><h3>${icon('eye', 18)} Pakai kamera perangkat lain</h3><div id="camUse"></div></section>
      <section class="card"><h3>${icon('send', 18)} Bagikan kamera perangkat ini</h3><div id="camShare"></div></section>
    </div>
    <div class="sec-h"><h3>Sesi aktif</h3></div><div id="sessList"></div>`,
  mount() { this.update(new Set(['devices', 'sessions'])); },
  update(p) {
    if (p.has('devices') || p.has('sessions')) {
      const list = connected();
      const cams = list.filter((d) => d.features && d.features.camera);
      const facingSel = (n) => `<select class="select sm" id="${n}"><option value="environment">Kamera belakang</option><option value="user">Kamera depan</option></select>`;
      $('#camUse').innerHTML = list.length ? (cams.length ? `<div class="row gap wrap">${facingSel('camFacing')}</div><div class="dev-rows">${cams.map((d) => `<div class="dev-row"><span>${icon(deviceIcon(d.type), 20)}</span><b>${esc(d.name)}</b><button class="btn sm primary" data-act="req-cam" data-uid="${d.uid}">Gunakan kamera</button></div>`).join('')}</div>` : `<div class="notice">${icon('info', 18)}<span>Perangkat terhubung tidak memiliki kamera yang bisa dipakai.</span></div>`) : noDev();
      $('#camShare').innerHTML = canCamera() ? (list.length ? `<div class="row gap wrap">${facingSel('camFacing2')}</div><div class="dev-rows">${list.map((d) => `<div class="dev-row"><span>${icon(deviceIcon(d.type), 20)}</span><b>${esc(d.name)}</b><button class="btn sm" data-act="share-cam" data-uid="${d.uid}">Kirim kamera</button></div>`).join('')}</div>` : noDev()) : `<div class="notice">${icon('info', 18)}<span>Kamera tidak tersedia di perangkat ini.</span></div>`;
      renderSessions('camera');
    }
  },
};
function noDev() { return `<div class="empty-sm">Belum ada perangkat terhubung.<br><button class="btn sm primary" data-act="connect">${icon('plus', 14)}Hubungkan</button></div>`; }
function renderSessions(kind) {
  const el = $('#sessList');
  if (!el) return;
  const list = [...S.sessions.values()].filter((s) => s.kind === kind);
  el.innerHTML = list.length ? `<div class="card list-card">${list.map((s) => `<div class="sess-row"><span class="live-dot"></span><span class="sr-t"><b>${s.dir === 'out' ? (kind === 'screen' ? 'Membagikan layar ke ' : 'Membagikan kamera ke ') + esc(devName(s.duid)) : (kind === 'screen' ? 'Layar ' : 'Kamera ') + esc(devName(s.duid))}</b><small>${s.dir === 'out' ? 'Keluar' : 'Masuk'}</small></span>
    ${s.dir === 'in' && !s.win ? `<button class="btn sm" data-act="sess-open" data-sid="${s.sid}">Tampilkan</button>` : ''}
    <button class="btn sm danger" data-act="sess-stop" data-sid="${s.sid}">${icon('stop', 14)}${s.dir === 'out' ? 'Hentikan' : 'Tutup'}</button></div>`).join('')}</div>` : `<div class="empty-sm card">Tidak ada sesi aktif.</div>`;
}

// ---------------------------------------------------------------------
// HALAMAN: CATATAN
// ---------------------------------------------------------------------
PAGES.notes = {
  html: () => `
    <div class="split notes-split ${narrow() && S.noteSel && S.mobileNote ? 'show-conv' : ''}" id="nsplit">
      <aside class="card note-list">
        <div class="nl-head"><div class="search">${icon('search', 16)}<input id="noteSearch" placeholder="Cari catatan"></div><button class="btn primary sm" data-act="note-new">${icon('plus', 16)}Baru</button></div>
        <div id="noteItems"></div>
      </aside>
      <section class="card note-ed" id="noteEd"></section>
    </div>`,
  mount() {
    $('#noteSearch').addEventListener('input', () => this.update(new Set(['notes-list'])));
    this.update(new Set(['notes']));
  },
  update(p) {
    if (p.has('notes') || p.has('notes-list') || p.has('devices')) {
      const q = ($('#noteSearch') && $('#noteSearch').value.toLowerCase()) || '';
      const list = Object.values(S.notes).filter((n) => !n.deleted && (!q || n.body.toLowerCase().includes(q))).sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt);
      $('#noteItems').innerHTML = list.length ? list.map((n) => `<button class="note-item ${S.noteSel === n.id ? 'active' : ''}" data-act="note-open" data-id="${n.id}"><b>${n.pinned ? icon('pin', 12) : ''}${esc(noteTitle(n))}</b><small>${fmtTime(n.updatedAt)} · ${esc((n.body.split('\n').filter((x) => x.trim())[1] || '').slice(0, 50) || 'Tidak ada teks tambahan')}</small></button>`).join('') : `<div class="empty-sm">${q ? 'Tidak ditemukan.' : 'Belum ada catatan.'}</div>`;
      if (!p.has('notes-list')) renderNoteEditor();
    }
  },
};
function renderNoteEditor() {
  const el = $('#noteEd');
  if (!el) return;
  const n = S.noteSel && S.notes[S.noteSel];
  if (!n || n.deleted) {
    el.innerHTML = `<div class="tl-empty">${icon('notes', 40)}<b>Catatan tersinkron</b><span>Tulis di iPad, lanjutkan di laptop. Catatan otomatis tersinkron ke semua perangkat yang terhubung.</span><button class="btn primary" data-act="note-new">${icon('plus', 16)}Catatan baru</button></div>`;
    return;
  }
  const ta = $('#noteBody');
  if (ta && ta.dataset.id === n.id) { if (document.activeElement !== ta && ta.value !== n.body) ta.value = n.body; $('#noteMeta').textContent = noteMeta(n); return; }
  el.innerHTML = `<div class="ne-head"><button class="icon-btn back-btn" data-act="note-back">${icon('left', 20)}</button><small id="noteMeta">${noteMeta(n)}</small><div class="grow"></div>
      <button class="icon-btn ${n.pinned ? 'on' : ''}" data-act="note-pin" title="Sematkan">${icon('pin', 18)}</button>
      <button class="icon-btn" data-act="note-send" title="Kirim sebagai teks ke perangkat">${icon('send', 18)}</button>
      <button class="icon-btn" data-act="note-copy" title="Salin">${icon('copy', 18)}</button>
      <button class="icon-btn danger" data-act="note-del" title="Hapus">${icon('trash', 18)}</button></div>
    <textarea id="noteBody" data-id="${n.id}" placeholder="Judul di baris pertama…">${esc(n.body)}</textarea>`;
  const t = $('#noteBody');
  t.addEventListener('input', () => {
    S.lastNoteType = Date.now();
    editNote(n.id, { body: t.value });
    $('#noteMeta').textContent = 'Menyimpan…';
    clearTimeout(t._u);
    t._u = setTimeout(() => { PAGES.notes.update(new Set(['notes-list'])); $('#noteMeta').textContent = noteMeta(S.notes[n.id]); }, 500);
  });
}
function noteMeta(n) { return `Diubah ${fmtTime(n.updatedAt)}${n.by ? ' di ' + n.by : ''} · tersinkron ke ${connected().length} perangkat`; }
function flushNoteEdit() {}

// ---------------------------------------------------------------------
// HALAMAN: AKSES BERKAS
// ---------------------------------------------------------------------
const FILTERS = [['all', 'Semua'], ['image', 'Foto'], ['video', 'Video'], ['audio', 'Audio'], ['doc', 'Dokumen'], ['other', 'Lainnya']];
PAGES.files = {
  html: () => `
    <div class="tabs" id="fTabs">
      <button data-act="ftab" data-tab="remote">${icon('globe', 16)}Perangkat lain</button>
      <button data-act="ftab" data-tab="mine">${icon('folderUp', 16)}Dibagikan dari sini</button>
      <button data-act="ftab" data-tab="recv">${icon('download', 16)}Diterima</button>
    </div>
    <div class="row gap wrap filt" id="fFilt">${FILTERS.map(([k, l]) => `<button class="chip-btn" data-act="ffilt" data-f="${k}">${l}</button>`).join('')}</div>
    <div id="fBody"></div>`,
  mount() { this.update(new Set(['files'])); },
  update(p) {
    if (!(p.has('files') || p.has('devices'))) return;
    $$('#fTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.filesTab));
    $$('#fFilt button').forEach((b) => b.classList.toggle('active', b.dataset.f === S.filesFilter));
    const flt = (x) => S.filesFilter === 'all' || (S.filesFilter === 'other' ? !['image', 'video', 'audio', 'doc'].includes(fileKind(x.mime, x.name)) : fileKind(x.mime, x.name) === S.filesFilter);
    const body = $('#fBody');
    if (S.filesTab === 'remote') {
      const list = connected();
      if (!list.length) { body.innerHTML = `<div class="card">${noDev()}</div>`; return; }
      if (!S.filesDev || !list.some((d) => d.uid === S.filesDev)) S.filesDev = list[0].uid;
      const d = devOf(S.filesDev);
      const items = (d.shared || []).filter(flt);
      body.innerHTML = `<div class="row gap wrap dev-pills">${list.map((x) => `<button class="pill ${x.uid === S.filesDev ? 'active' : ''}" data-act="fdev" data-uid="${x.uid}">${icon(deviceIcon(x.type), 16)}${esc(x.name)} <em>${(x.shared || []).length}</em></button>`).join('')}</div>` +
        (items.length ? `<div class="f-grid">${items.map((x) => fileTile(x, `<button class="btn sm primary" data-act="fget" data-id="${x.id}">${icon('download', 14)}Ambil</button>`)).join('')}</div>`
          : `<div class="card empty-sm">${icon('folder', 30)}<br><b>${esc(d.name)}</b> belum membagikan berkas${S.filesFilter !== 'all' ? ' jenis ini' : ''}.<br><small>Di ${esc(d.name)}, buka <b>Akses Berkas → Dibagikan dari sini</b> lalu tambahkan berkas atau folder.</small></div>`);
    } else if (S.filesTab === 'mine') {
      const items = S.myShared.filter(flt);
      body.innerHTML = `<div class="card share-bar"><div><b>Bagikan berkas ke semua perangkat terhubung</b><small>Perangkat lain bisa menjelajah dan mengambil berkas ini kapan saja selama terhubung.</small></div><div class="row gap"><button class="btn primary" data-act="share-add">${icon('plus', 16)}Tambah berkas</button>${!isIOS() ? `<button class="btn" data-act="share-add-dir">${icon('folderUp', 16)}Tambah folder</button>` : ''}${isIOS() || /Android/.test(navigator.userAgent) ? `<button class="btn" data-act="share-add-photo">${icon('image', 16)}Foto & video</button>` : ''}</div></div>` +
        (items.length ? `<div class="f-grid">${items.map((x) => fileTile(x, `<button class="btn sm ghost" data-act="share-rm" data-id="${x.id}">${icon('trash', 14)}Hapus</button>`, true)).join('')}</div>` : `<div class="card empty-sm">${icon('folderUp', 30)}<br>Belum ada berkas yang dibagikan.</div>`);
    } else {
      const items = S.received.filter(flt);
      body.innerHTML = `<div class="row between recv-bar"><small class="muted" id="storeInfo">${S.received.length} berkas</small>${S.received.length ? `<button class="btn sm ghost" data-act="recv-clear">${icon('trash', 14)}Hapus semua</button>` : ''}</div>` +
        (items.length ? `<div class="f-grid">${items.map((x) => fileTile(x, `<button class="btn sm" data-act="save-file" data-fid="${x.id}">${icon('download', 14)}Simpan</button>${isIOS() ? `<button class="btn sm" data-act="share-file" data-fid="${x.id}">${icon('share', 14)}</button>` : ''}<button class="btn sm ghost" data-act="recv-del" data-id="${x.id}">${icon('trash', 14)}</button>`, true, x.fromName)).join('')}</div>` : `<div class="card empty-sm">${icon('download', 30)}<br>Belum ada berkas diterima.</div>`);
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { const s = $('#storeInfo'); if (s) s.textContent = `${S.received.length} berkas · memakai ${fmtSize(e.usage)} penyimpanan browser`; });
    }
    hydrateThumbs(body);
  },
};
function fileTile(x, acts, local = false, from = '') {
  const k = fileKind(x.mime, x.name);
  const thumb = x.thumb ? `<img src="${x.thumb}" alt="">` : (local && k === 'image' ? `<img data-fid="${x.id}" alt="">` : `<span class="ft-ic ${k}">${icon(kindIcon(k), 30)}<em>${esc(extOf(x.name))}</em></span>`);
  return `<div class="f-tile"><button class="ft-thumb" ${local ? `data-act="preview" data-fid="${x.id}"` : ''}>${thumb}</button><div class="ft-info"><b title="${esc(x.name)}">${esc(x.name)}</b><small>${fmtSize(x.size)} · ${fmtTime(x.ts)}${from ? ' · ' + esc(from) : ''}</small></div><div class="ft-acts">${acts}</div></div>`;
}

// ---------------------------------------------------------------------
// HALAMAN: PENGATURAN
// ---------------------------------------------------------------------
PAGES.settings = {
  html: () => `<div class="settings" id="setBody"></div>`,
  mount() { this.update(new Set(['settings'])); },
  update(p) {
    if (!(p.has('settings') || p.has('devices') || p.has('status'))) return;
    const tr = Object.values(S.trusted).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    $('#setBody').innerHTML = `
      <section class="card set-sec"><h3>Perangkat ini</h3>
        <div class="set-row"><span class="sr-ic">${icon(deviceIcon(me.type), 20)}</span><div class="sr-t"><b>${esc(me.name)}</b><small>${esc(me.os)} · Kode ${fmtCode(me.code)}</small></div><button class="btn sm" data-act="rename">${icon('edit', 14)}Ganti nama</button></div>
        <div class="set-row"><span class="sr-ic">${icon('refresh', 20)}</span><div class="sr-t"><b>Buat kode baru</b><small>Perangkat tepercaya tetap tersimpan, tetapi perlu dihubungkan ulang dari perangkat ini.</small></div><button class="btn sm" data-act="new-code">Buat ulang</button></div>
      </section>
      <section class="card set-sec"><h3>Tampilan</h3>
        <div class="seg" role="radiogroup">${[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, l]) => `<button class="${S.settings.theme === k ? 'active' : ''}" data-act="theme" data-v="${k}">${icon(k === 'dark' ? 'moon' : k === 'light' ? 'sun' : 'sparkle', 16)}${l}</button>`).join('')}</div>
        ${switchRow('sound', 'Bunyi pemberitahuan', 'Bunyi lembut saat menerima berkas, pesan, atau sambungan baru.')}
      </section>
      <section class="card set-sec"><h3>Sambungan</h3>
        ${switchRow('autoConnect', 'Hubungkan otomatis ke perangkat tepercaya', 'Saat Taut dibuka, perangkat yang pernah diizinkan langsung tersambung lagi.')}
        <div class="set-row"><span class="sr-ic">${icon('globe', 20)}</span><div class="sr-t"><b>Status server</b><small id="cxStatus">${netStateHtml()}</small></div><button class="btn sm" data-act="kick">${icon('refresh', 14)}Sambung ulang</button></div>
      </section>
      <section class="card set-sec"><h3>Perangkat tepercaya</h3>
        ${tr.length ? tr.map((t) => `<div class="set-row"><span class="sr-ic">${icon(deviceIcon(t.type), 20)}</span><div class="sr-t"><b>${esc(t.name)}</b><small>${esc(t.os || '')} · Kode ${fmtCode(t.code)} · ${devOf(t.uid) && devOf(t.uid).ready ? '<span class="ok-t">Terhubung</span>' : 'terakhir ' + fmtAgo(t.lastSeen || 0)}</small></div>
          ${devOf(t.uid) && devOf(t.uid).ready ? `<button class="btn sm" data-act="disconnect" data-uid="${t.uid}">Putuskan</button>` : `<button class="btn sm" data-act="reconnect" data-uid="${t.uid}">Hubungkan</button>`}
          <button class="btn sm ghost danger" data-act="forget" data-uid="${t.uid}">Lupakan</button></div>`).join('') : `<p class="muted">Belum ada. Perangkat yang Anda izinkan akan muncul di sini.</p>`}
      </section>
      <section class="card set-sec"><h3>Penyimpanan</h3>
        ${window.showDirectoryPicker ? `<div class="set-row"><span class="sr-ic">${icon('folder', 20)}</span><div class="sr-t"><b>Simpan otomatis ke folder</b><small>${S.dirHandle ? `Aktif: folder <b>${esc(S.dirHandle.name)}</b>. Berkas diterima langsung ditulis ke folder ini.` : S.dirPending ? `Folder <b>${esc(S.dirPending.name)}</b> perlu izin ulang.` : 'Pilih folder di komputer ini; berkas yang diterima akan langsung tersimpan di sana.'}</small></div>
          ${S.dirPending ? `<button class="btn sm primary" data-act="grant-dir">Izinkan</button>` : ''}<button class="btn sm" data-act="pick-dir">${S.dirHandle ? 'Ganti' : 'Pilih folder'}</button>${S.dirHandle ? `<button class="btn sm ghost" data-act="clear-dir">Matikan</button>` : ''}</div>` : `<div class="set-row"><span class="sr-ic">${icon('folder', 20)}</span><div class="sr-t"><b>Berkas diterima</b><small>Tersimpan di dalam Taut. Ketuk <b>Simpan</b>${isIOS() ? ' atau <b>Bagikan → Simpan ke File/Foto</b>' : ''} untuk memindahkannya.</small></div></div>`}
        <div class="set-row"><span class="sr-ic">${icon('trash', 20)}</span><div class="sr-t"><b>Hapus berkas diterima</b><small>${S.received.length} berkas tersimpan di Taut</small></div><button class="btn sm ghost danger" data-act="recv-clear">Hapus</button></div>
      </section>
      <section class="card set-sec"><h3>Pemberitahuan</h3>
        ${'Notification' in window ? switchRow('notify', 'Tampilkan pemberitahuan sistem', 'Saat Taut di latar belakang dan ada berkas, pesan, atau papan klip masuk.') : `<p class="muted">Pemberitahuan sistem tersedia setelah Taut dipasang ke Layar Utama (iPad).</p>`}
      </section>
      <section class="card set-sec"><h3>Pasang aplikasi</h3>
        <div class="install-box">${installHtml()}</div>
      </section>
      <section class="card set-sec"><h3>Lanjutan</h3>
        <div class="set-row"><span class="sr-ic">${icon('globe', 20)}</span><div class="sr-t"><b>Server sinyal</b><small>${esc(S.settings.signal || DEFAULT_SIGNAL)}<br>Hanya untuk mempertemukan perangkat; berkas tidak pernah melewati server ini.</small></div><button class="btn sm" data-act="set-signal">Ubah</button></div>
        <div class="set-row"><span class="sr-ic">${icon('info', 20)}</span><div class="sr-t"><b>Taut ${VERSION}</b><small>Data dikirim langsung antar perangkat (WebRTC, terenkripsi DTLS). <a href="#" data-act="welcome">Lihat pengenalan</a></small></div></div>
      </section>`;
  },
};
function installHtml() {
  if (isStandalone()) return `<p class="ok-t">${icon('check', 16)} Taut sudah terpasang sebagai aplikasi di perangkat ini.</p>`;
  if (S.installEvt) return `<p>Pasang Taut seperti aplikasi biasa — muncul di menu Start/Dock dan terbuka di jendela sendiri.</p><button class="btn primary" data-act="install">${icon('install', 18)}Pasang Taut</button>`;
  if (DEV.os === 'iPadOS' || DEV.os === 'iOS') return `<ol class="steps"><li>Buka halaman ini di <b>Safari</b>.</li><li>Ketuk ikon <b>Bagikan</b> ${icon('share', 14)} di bilah atas.</li><li>Pilih <b>Tambahkan ke Layar Utama</b>, lalu <b>Tambah</b>.</li></ol>`;
  if (DEV.os === 'macOS' && /Safari/.test(navigator.userAgent) && !/Chrome|Edg/.test(navigator.userAgent)) return `<ol class="steps"><li>Di Safari, klik menu <b>File</b>.</li><li>Pilih <b>Tambahkan ke Dock…</b> lalu <b>Tambah</b>.</li></ol>`;
  return `<ol class="steps"><li>Buka di <b>Chrome</b> atau <b>Edge</b>.</li><li>Klik ikon <b>Pasang</b> ${icon('install', 14)} di ujung kanan bilah alamat.</li><li>Pilih <b>Pasang</b>. Taut muncul di menu Start${DEV.os === 'macOS' ? '/Launchpad' : ''}.</li></ol>`;
}

// =====================================================================
// HUBUNGKAN PERANGKAT (QR + kode)
// =====================================================================
function qrSvg(text, size) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'Q');
  q.addData(text); q.make();
  const n = q.getModuleCount();
  const cells = [];
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const mid = n / 2, logoR = n * 0.11;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!q.isDark(r, c) || inFinder(r, c)) continue;
    if (Math.abs(r + 0.5 - mid) < logoR + 0.6 && Math.abs(c + 0.5 - mid) < logoR + 0.6) continue;
    cells.push(`<rect x="${c + 0.08}" y="${r + 0.08}" width=".84" height=".84" rx=".3"/>`);
  }
  const finder = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".9"/>`;
  const L = logoR * 2;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" width="${size}" height="${size}" class="qr-svg"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" rx="3" fill="#fff"/><g fill="currentColor">${cells.join('')}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</g>
    <g transform="translate(${mid - L / 2} ${mid - L / 2}) scale(${L / 64})"><rect width="64" height="64" rx="16" fill="#2F5BEA"/><rect x="13" y="20" width="24" height="24" rx="8" fill="none" stroke="#fff" stroke-width="5"/><rect x="27" y="20" width="24" height="24" rx="8" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5"/></g></svg>`;
}
const qrLink = () => `${APP_URL}#k=${me.code}`;
function renderQR(el, size = 220) {
  const targets = el ? [el] : $$('[data-qr]');
  for (const t of targets) { if (t) t.innerHTML = qrSvg(qrLink(), size || +t.dataset.qr); }
}
function openConnect() {
  const tr = Object.values(S.trusted).filter((t) => !(devOf(t.uid) && devOf(t.uid).ready)).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const m = modal({
    id: 'connect', title: 'Hubungkan perangkat', icon: 'qr', wide: true, cls: 'connect-modal',
    body: `<div class="connect">
      <div class="cx-qr">
        <div class="qr-box" data-qr="220"></div>
        <div class="code-big">${fmtCode(me.code)}</div>
        <small class="muted">Kode ${esc(me.name)}</small>
        <div class="cx-state" id="cxStatus">${netStateHtml()}</div>
      </div>
      <div class="cx-join">
        <ol class="steps big">
          <li>Buka <b>${esc(APP_URL.replace(/^https?:\/\//, ''))}</b> di perangkat lain.</li>
          <li>Pindai kode QR ini dengan kamera, atau masukkan kodenya di sana.</li>
          <li>Ketuk <b>Izinkan</b> pada permintaan yang muncul di perangkat ini.</li>
        </ol>
        <div class="or"><span><span class="or-a">atau </span>masukkan kode perangkat lain</span></div>
        <form class="code-form" id="codeForm"><input id="codeIn" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="000 000" aria-label="Kode perangkat"><button class="btn primary" type="submit">Hubungkan</button></form>
        ${canCamera() ? `<button class="btn wide" data-act="scan">${icon('scan', 18)}Pindai kode QR perangkat lain</button>` : ''}
        <div id="connStatus" class="conn-status"></div>
        ${tr.length ? `<div class="cx-trusted"><small class="muted">Perangkat tepercaya</small>${tr.slice(0, 4).map((t) => `<button class="tr-chip" data-act="reconnect" data-uid="${t.uid}">${icon(deviceIcon(t.type), 16)}${esc(t.name)}</button>`).join('')}</div>` : ''}
      </div>
    </div>`,
    onClose: () => { if (S.connecting && S.connecting.state === 'connecting') { /* biarkan berjalan */ } },
  });
  renderQR();
  const inp = $('#codeIn', m.el);
  inp.addEventListener('input', () => { const v = inp.value.replace(/\D/g, '').slice(0, 6); inp.value = v.length > 3 ? v.slice(0, 3) + ' ' + v.slice(3) : v; });
  $('#codeForm', m.el).addEventListener('submit', (e) => { e.preventDefault(); startConnect(inp.value); });
  if (!narrow()) setTimeout(() => inp.focus(), 80);
  if (S.connecting && S.connecting.state === 'connecting') setConnStatus('wait', `Menghubungkan ke ${fmtCode(S.connecting.rid)}…`, true);
}
function setConnStatus(kind, html, cancel = false) {
  const el = $('#connStatus');
  if (!el) { if (kind === 'err') toast(html, { icon: 'x' }); return; }
  el.className = 'conn-status ' + kind;
  el.innerHTML = `${kind === 'wait' ? icon('refresh', 16, 'spin') : kind === 'err' ? icon('info', 16) : icon('check', 16)}<span>${html}</span>${cancel ? `<button class="btn sm ghost" data-act="cx-cancel">Batal</button>` : ''}`;
}

function showRequest(req) {
  const h = req.hello || {};
  if (S.settings.sound) chime();
  notify('Permintaan sambungan', `${h.name || 'Perangkat'} ingin terhubung`);
  modal({
    id: 'req-' + req.from, icon: 'shield', title: 'Permintaan sambungan', dismiss: false,
    body: `<div class="req-card"><div class="req-art">${deviceArt(h.type || 'phone')}</div><div><b class="rc-name">${esc(h.name || 'Perangkat')}</b><small>${esc(h.os || '')} · Kode ${fmtCode(req.from)}</small><p>ingin terhubung ke <strong>${esc(me.name)}</strong>. Setelah diizinkan, keduanya akan tersambung otomatis di lain waktu.</p></div></div>`,
    actions: [
      { label: 'Tolak', fn: () => req.reject() },
      { label: 'Izinkan', primary: true, fn: () => { req.accept(); } },
    ],
  });
}

// ---------- Pemindai QR ----------
async function openScanner() {
  let stream = null, stop = false;
  const m = modal({
    id: 'scan', title: 'Pindai kode QR', icon: 'scan', cls: 'scan-modal',
    body: `<div class="scan-box"><video playsinline muted></video><div class="scan-frame"><i></i></div><p class="scan-msg">Arahkan kamera ke kode QR di layar perangkat lain.</p></div>`,
    onClose: () => { stop = true; stream && stream.getTracks().forEach((t) => t.stop()); },
  });
  try {
    await loadScript('lib/jsQR.js');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
  } catch (e) {
    $('.scan-msg', m.el).textContent = 'Kamera tidak bisa dibuka. Izinkan akses kamera, atau masukkan kode secara manual.';
    return;
  }
  if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
  const v = $('video', m.el);
  v.srcObject = stream; await v.play().catch(() => {});
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (stop) return;
    if (v.videoWidth) {
      const sc = Math.min(1, 640 / v.videoWidth);
      c.width = v.videoWidth * sc; c.height = v.videoHeight * sc;
      g.drawImage(v, 0, 0, c.width, c.height);
      const r = window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      if (r && r.data) {
        const mm = r.data.match(/#k=(\d{6})/) || r.data.match(/^\s*(\d{3}\s?\d{3})\s*$/);
        if (mm) {
          stop = true; m.close();
          try { navigator.vibrate && navigator.vibrate(60); } catch {}
          if (!modals.has('connect')) openConnect();
          startConnect(mm[1]);
          return;
        }
      }
    }
    setTimeout(tick, 180);
  };
  tick();
}

// =====================================================================
// HALAMAN PENGENALAN (pertama kali dibuka)
// =====================================================================
function showWelcome() {
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `
    <header class="w-nav">${logo(30)}<b>Taut</b><span class="grow"></span><a href="#w-fitur">Fitur</a><a href="#w-cara">Cara pakai</a><button class="btn sm primary" data-w="start">Buka aplikasi</button></header>
    <section class="w-hero">
      <div class="w-hero-t">
        <span class="eyebrow">Untuk iPad · Windows · Mac · HP</span>
        <h1>Satu alur kerja.<br><span class="grad">Semua perangkat.</span></h1>
        <p>Taut menghubungkan iPad, laptop Windows, Mac, dan HP Anda untuk transfer berkas, papan klip bersama, pencerminan layar, kamera bersama, dan catatan yang selalu sinkron — langsung dari browser, tanpa kabel.</p>
        <div class="w-cta"><button class="btn primary lg" data-w="start">Mulai sekarang ${icon('right', 18)}</button><button class="btn lg" data-w="install">${icon('install', 18)}Pasang aplikasi</button></div>
        <div class="w-plat"><span>${icon('tablet', 16)}iPadOS</span><span>${icon('laptop', 16)}Windows</span><span>${icon('laptop', 16)}macOS</span><span>${icon('phone', 16)}Android & iOS</span></div>
      </div>
      <div class="w-hero-art">
        <div class="wa laptop">${deviceArt('laptop')}<div class="wa-screen s1"><i></i><i></i><i></i></div></div>
        <div class="wa tablet">${deviceArt('tablet')}<div class="wa-screen s2"><i></i><i></i></div></div>
        <div class="wa phone">${deviceArt('phone')}<div class="wa-screen s3"><i></i></div></div>
        <div class="wa-fly f1">${icon('image', 18)}</div><div class="wa-fly f2">${icon('doc', 18)}</div><div class="wa-fly f3">${icon('clipboard', 18)}</div>
      </div>
    </section>
    <section class="w-feats" id="w-fitur">
      <h2>Semua yang Anda perlukan untuk bekerja lintas perangkat</h2>
      <div class="w-grid">${FEATURES.map((f) => `<div class="w-feat ${f.c}"><span class="feat-ic">${icon(f.ic, 24)}</span><b>${f.t}</b><p>${f.d}</p></div>`).join('')}</div>
    </section>
    <section class="w-steps" id="w-cara">
      <h2>Terhubung dalam tiga langkah</h2>
      <div class="w-step-row">
        <div><em>1</em><b>Buka Taut</b><p>Di setiap perangkat buka <b>${esc(APP_URL.replace(/^https?:\/\//, ''))}</b>, atau pasang sebagai aplikasi.</p></div>
        <div><em>2</em><b>Pindai QR</b><p>Pindai kode QR dari perangkat lain, atau ketik kode 6 angkanya.</p></div>
        <div><em>3</em><b>Izinkan</b><p>Ketuk Izinkan sekali. Berikutnya perangkat tersambung otomatis.</p></div>
      </div>
    </section>
    <section class="w-name">
      <h2>Beri nama perangkat ini</h2>
      <p>Nama ini terlihat di perangkat lain saat terhubung.</p>
      <div class="row gap center"><input id="wName" class="input lg" value="${esc(me.name)}" maxlength="40"><button class="btn primary lg" data-w="start">Mulai ${icon('right', 18)}</button></div>
      <small class="muted">Berkas dikirim langsung antar perangkat dengan enkripsi. Server hanya mempertemukan perangkat.</small>
    </section>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    if (b.dataset.w === 'start') {
      const nm = ($('#wName', el).value || '').trim();
      if (nm && nm !== me.name) setName(nm);
      LS.set('welcomed', true);
      el.classList.add('out'); setTimeout(() => el.remove(), 300);
      audioCtx();
    }
    if (b.dataset.w === 'install') {
      LS.set('welcomed', true);
      el.remove(); go('settings');
      setTimeout(() => { const s = $('.install-box'); s && s.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
      if (S.installEvt) doInstall();
    }
  });
  el.querySelectorAll('a[href^="#w-"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $(a.getAttribute('href'), el).scrollIntoView({ behavior: 'smooth' }); }));
  document.body.appendChild(el);
}

function setName(nm) {
  me.name = nm.slice(0, 40); save.me();
  net.broadcast({ t: 'info', name: me.name });
  refresh('devices'); refresh('settings');
  if (S.page === 'home') go('home');
}

async function doInstall() {
  if (!S.installEvt) return;
  S.installEvt.prompt();
  try { await S.installEvt.userChoice; } catch {}
  S.installEvt = null;
  refresh('settings');
}

// =====================================================================
// AKSI (delegasi klik)
// =====================================================================
const ACT = {
  connect: () => openConnect(),
  scan: () => openScanner(),
  more: () => {
    modal({
      id: 'more', title: 'Semua fitur', icon: 'grid',
      body: `<div class="more-grid">${[...NAV, { id: 'settings', label: 'Pengaturan', ic: 'settings' }].map((n) => `<button data-page="${n.id}">${icon(n.ic, 24)}<span>${n.short || n.label}</span>${S.unread[n.id] ? `<i class="badge show">${S.unread[n.id]}</i>` : ''}</button>`).join('')}</div>`,
    });
  },
  rename: async () => { const v = await ask({ title: 'Ganti nama perangkat', label: 'Nama yang terlihat di perangkat lain', value: me.name }); if (v && v.trim()) setName(v.trim()); },
  'new-code': () => modal({
    id: 'nc', title: 'Buat kode baru?', icon: 'refresh', body: '<p>Kode lama tidak berlaku lagi. Perangkat lain perlu memasukkan kode baru untuk terhubung ke perangkat ini.</p>',
    actions: [{ label: 'Batal' }, { label: 'Buat kode baru', primary: true, fn: () => { me.code = randomCode(); me.token = uid(20); save.me(); net.signal.restart(me.code, me.token); refresh('devices'); refresh('settings'); if (S.page === 'home') go('home'); toast('Kode baru: ' + fmtCode(me.code), { icon: 'check', kind: 'ok' }); } }],
  }),
  'open-dev': (b) => { S.sel = b.dataset.uid; S.mobileConv = true; go('transfer'); },
  'sel-dev': (b) => { S.sel = b.dataset.uid; S.mobileConv = true; $('#split') && $('#split').classList.add('show-conv'); PAGES.transfer.update(new Set(['devices', 'timeline'])); },
  'conv-back': () => { S.mobileConv = false; $('#split') && $('#split').classList.remove('show-conv'); },
  'send-files': async (b) => { const f = await pickFiles(); if (f.length) { sendFiles(b.dataset.uid, f); toast(`${f.length} berkas dikirim ke ${esc(devName(b.dataset.uid))}`, { icon: 'transfer', actions: [{ label: 'Lihat', fn: () => { S.sel = b.dataset.uid; go('transfer'); } }] }); } },
  'send-clip': (b) => sendCurrentClipboard([b.dataset.uid]),
  'req-screen': (b) => requestScreen(b.dataset.uid),
  'share-screen': (b) => shareScreen([b.dataset.uid]),
  'req-cam': (b) => requestCamera(b.dataset.uid, ($('#camFacing') && $('#camFacing').value) || 'environment'),
  'share-cam': (b) => shareCamera(b.dataset.uid, ($('#camFacing2') && $('#camFacing2').value) || 'environment'),
  ring: (b) => ringDevice(b.dataset.uid),
  'ring-stop': () => stopRing(),
  'ring-pick': () => pickDevice('Cari perangkat', 'ring', (u) => ringDevice(u)),
  'send-link': () => pickDevice('Lanjutkan di perangkat lain', 'handoff', async (u) => {
    let pre = '';
    try { pre = (await navigator.clipboard.readText()) || ''; } catch {}
    const v = await ask({ title: `Kirim ke ${esc(devName(u))}`, label: 'Tautan atau teks', value: firstUrl(pre) || '', placeholder: 'https://…', ok: 'Kirim' });
    if (v && v.trim()) { sendText(u, v.trim()); toast(`Terkirim ke ${esc(devName(u))}`, { icon: 'check', kind: 'ok' }); }
  }),
  'dev-menu': (b) => {
    const u = b.dataset.uid, d = devOf(u);
    modal({
      id: 'dm', title: esc(d.name), icon: deviceIcon(d.type),
      body: `<div class="menu-list">
        <button data-act="open-dev" data-uid="${u}">${icon('transfer', 18)}Buka percakapan transfer</button>
        <button data-act="send-link-to" data-uid="${u}">${icon('handoff', 18)}Kirim tautan/teks</button>
        <button data-act="ring" data-uid="${u}">${icon('ring', 18)}Bunyikan perangkat</button>
        <button data-act="fdev-open" data-uid="${u}">${icon('folder', 18)}Lihat berkas yang dibagikan</button>
        <button data-act="disconnect" data-uid="${u}" class="danger">${icon('unlink', 18)}Putuskan sambungan</button>
        <button data-act="forget" data-uid="${u}" class="danger">${icon('trash', 18)}Lupakan perangkat</button></div>`,
    });
  },
  'send-link-to': async (b) => { closeModal('dm'); const u = b.dataset.uid; const v = await ask({ title: `Kirim ke ${esc(devName(u))}`, label: 'Tautan atau teks', placeholder: 'https://…', ok: 'Kirim' }); if (v && v.trim()) sendText(u, v.trim()); },
  'fdev-open': (b) => { closeModal('dm'); S.filesTab = 'remote'; S.filesDev = b.dataset.uid; go('files'); },
  disconnect: (b) => {
    closeModal('dm');
    const d = devOf(b.dataset.uid);
    if (d && d.link) { d.link.send({ t: 'bye' }); const l = d.link; setTimeout(() => l.close('bye-local'), 150); retries.delete(d.code); }
  },
  forget: (b) => {
    closeModal('dm');
    const u = b.dataset.uid;
    const name = devName(u);
    modal({
      id: 'fg', title: `Lupakan ${esc(name)}?`, icon: 'trash', body: '<p>Perangkat ini tidak akan tersambung otomatis lagi dan perlu izin ulang untuk terhubung.</p>',
      actions: [{ label: 'Batal' }, { label: 'Lupakan', danger: true, fn: () => {
        const d = devOf(u);
        if (d && d.link) { d.link.send({ t: 'forget' }); const l = d.link; setTimeout(() => l.close('bye-local'), 150); }
        delete S.trusted[u]; save.trusted();
        LS.del('tl.' + u); delete S.tl[u];
        if (S.sel === u) S.sel = null;
        refresh('devices'); refresh('settings');
      } }],
    });
  },
  reconnect: (b) => {
    const t = S.trusted[b.dataset.uid];
    if (!t) return;
    if (!modals.has('connect')) openConnect();
    startConnect(t.code);
  },
  'cx-cancel': () => { if (S.connecting) { const l = S.connecting; S.connecting = null; l.close('cancel'); } setConnStatus('err', 'Dibatalkan.'); },
  kick: () => { net.signal.retry = 0; net.signal.restart(me.code, me.token); },

  // transfer
  'tf-send': () => { const i = $('#msgInput'); sendText(S.sel, i.value); i.value = ''; autoGrow(i); i.focus(); },
  'tf-files': async () => { if (!linkOf(S.sel)) return; const f = await pickFiles(); sendFiles(S.sel, f); },
  'tf-folder': async () => { if (!linkOf(S.sel)) return; const f = await pickFiles({ dir: true }); sendFiles(S.sel, f); },
  'tf-photo': async () => { if (!linkOf(S.sel)) return; const f = await pickFiles({ multiple: false, accept: 'image/*,video/*', capture: 'environment' }); sendFiles(S.sel, f); },
  'tf-cancel': (b) => { const it = tlFind(S.sel, b.dataset.id); if (it) cancelItem(S.sel, it); },
  'tf-clear': () => modal({ id: 'clr', title: 'Bersihkan riwayat?', icon: 'trash', body: `<p>Riwayat percakapan dengan ${esc(devName(S.sel))} di perangkat ini akan dihapus. Berkas di tab Diterima tetap ada.</p>`, actions: [{ label: 'Batal' }, { label: 'Bersihkan', danger: true, fn: () => { S.tl[S.sel] = []; saveTL(S.sel); renderTimeline(); renderConvList(); } }] }),
  'copy-text': (b) => { const it = tlFind(S.sel, b.dataset.id); if (it) copyText(it.text).then((ok) => ok && toast('Disalin', { icon: 'check', kind: 'ok' })); },
  preview: (b) => preview(b.dataset.fid),
  'save-file': (b) => saveFile(b.dataset.fid),
  'share-file': (b) => shareFile(b.dataset.fid),
  'save-batch': (b) => { const it = tlFind(S.sel, b.dataset.id); if (it) saveBatch(S.sel, it); },

  // papan klip
  'clip-send': () => { const t = $('#clipText'); const to = $('#clipTarget').value; if (sendClipText(t.value, to ? [to] : null)) t.value = ''; },
  'clip-current': () => { const to = $('#clipTarget').value; sendCurrentClipboard(to ? [to] : null); },
  'clip-copy': (b) => { const c = S.clips.find((x) => x.id === b.dataset.id); if (c) copyText(c.text).then((ok) => ok && toast('Disalin', { icon: 'check', kind: 'ok' })); },
  'clip-copy-img': async (b) => { const bl = await getBlob(b.dataset.fid); if (bl) copyImage(bl); },
  'clip-resend': (b) => { const c = S.clips.find((x) => x.id === b.dataset.id); if (c) sendClipText(c.text); },
  'clip-del': (b) => { S.clips = S.clips.filter((x) => x.id !== b.dataset.id); save.clips(); refresh('clips'); },
  'clip-clear': () => { S.clips = []; save.clips(); refresh('clips'); },

  // layar & kamera
  'mir-start': () => shareScreen($$('input[name="mirTo"]:checked').map((i) => i.value)),
  'sess-stop': (b) => endSession(b.dataset.sid, true),
  'sess-open': (b) => { const s = S.sessions.get(b.dataset.sid); if (s && !s.win) openWin(s); refresh('sessions'); },

  // catatan
  'note-new': () => { newNote(''); S.mobileNote = true; go('notes'); setTimeout(() => { const t = $('#noteBody'); t && t.focus(); }, 60); },
  'note-open': (b) => { S.noteSel = b.dataset.id; S.mobileNote = true; $('#nsplit') && $('#nsplit').classList.add('show-conv'); $('#noteEd').innerHTML = ''; PAGES.notes.update(new Set(['notes'])); },
  'note-back': () => { S.mobileNote = false; $('#nsplit') && $('#nsplit').classList.remove('show-conv'); },
  'note-pin': () => { const n = S.notes[S.noteSel]; if (n) { editNote(n.id, { pinned: !n.pinned }); $('#noteEd').innerHTML = ''; PAGES.notes.update(new Set(['notes'])); } },
  'note-copy': () => { const n = S.notes[S.noteSel]; if (n) copyText(n.body).then((ok) => ok && toast('Catatan disalin', { icon: 'check', kind: 'ok' })); },
  'note-send': () => { const n = S.notes[S.noteSel]; if (!n) return; pickDevice('Kirim catatan sebagai teks', 'send', (u) => { sendText(u, n.body); toast('Terkirim', { icon: 'check', kind: 'ok' }); }); },
  'note-del': () => { const n = S.notes[S.noteSel]; if (!n) return; editNote(n.id, { deleted: true, body: '' }); S.noteSel = null; S.mobileNote = false; go('notes'); toast('Catatan dihapus di semua perangkat', { icon: 'trash' }); },

  // berkas
  ftab: (b) => { S.filesTab = b.dataset.tab; PAGES.files.update(new Set(['files'])); },
  ffilt: (b) => { S.filesFilter = b.dataset.f; PAGES.files.update(new Set(['files'])); },
  fdev: (b) => { S.filesDev = b.dataset.uid; PAGES.files.update(new Set(['files'])); },
  fget: (b) => { const d = devOf(S.filesDev); const it = d && (d.shared || []).find((x) => x.id === b.dataset.id); if (it) requestShared(S.filesDev, it); },
  'share-add': async () => { const f = await pickFiles(); if (f.length) addShared(f); },
  'share-add-dir': async () => { const f = await pickFiles({ dir: true }); if (f.length) addShared(f); },
  'share-add-photo': async () => { const f = await pickFiles({ accept: 'image/*,video/*' }); if (f.length) addShared(f); },
  'share-rm': (b) => removeShared(b.dataset.id),
  'recv-del': (b) => deleteReceived(b.dataset.id),
  'recv-clear': () => modal({ id: 'rc', title: 'Hapus semua berkas diterima?', icon: 'trash', body: '<p>Berkas yang tersimpan di dalam Taut di perangkat ini akan dihapus. Berkas yang sudah Anda simpan ke folder lain tidak terpengaruh.</p>', actions: [{ label: 'Batal' }, { label: 'Hapus semua', danger: true, fn: async () => { for (const r of [...S.received]) await deleteReceived(r.id); } }] }),

  // pengaturan
  theme: (b) => { S.settings.theme = b.dataset.v; save.settings(); applyTheme(); refresh('settings'); },
  'pick-dir': () => pickDir(),
  'grant-dir': () => grantDir(),
  'clear-dir': async () => { S.dirHandle = null; S.dirPending = null; try { await idb.del('kv', 'dir'); } catch {} refresh('settings'); },
  install: () => doInstall(),
  welcome: () => showWelcome(),
  'set-signal': async () => {
    const v = await ask({ title: 'Server sinyal', label: 'Alamat WebSocket server PeerJS (kosongkan untuk bawaan)', value: S.settings.signal || '', placeholder: DEFAULT_SIGNAL });
    if (v === null) return;
    S.settings.signal = v.trim(); save.settings();
    toast('Disimpan. Memuat ulang…', { icon: 'refresh' });
    setTimeout(() => location.reload(), 600);
  },
};

function pickDevice(title, ic, fn) {
  const list = connected();
  if (!list.length) { toast('Belum ada perangkat terhubung.', { icon: 'unlink', actions: [{ label: 'Hubungkan', fn: openConnect }] }); return; }
  if (list.length === 1) { fn(list[0].uid); return; }
  const m = modal({
    id: 'pick', title, icon: ic,
    body: `<div class="menu-list">${list.map((d) => `<button data-pick="${d.uid}">${icon(deviceIcon(d.type), 18)}${esc(d.name)}</button>`).join('')}</div>`,
  });
  m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { m.close(); fn(b.dataset.pick); } });
}

// ---------- Pratinjau berkas ----------
async function preview(fid) {
  const blob = await getBlob(fid);
  if (!blob) { toast('Berkas tidak tersedia lagi di perangkat ini.', { icon: 'info' }); return; }
  const meta = await fileMeta(fid);
  const k = fileKind(blob.type || meta.mime, meta.name);
  const url = await blobUrl(fid);
  let body;
  if (k === 'image') body = `<img class="pv-media" src="${url}" alt="">`;
  else if (k === 'video') body = `<video class="pv-media" src="${url}" controls playsinline autoplay></video>`;
  else if (k === 'audio') body = `<div class="pv-audio">${icon('audio', 48)}<audio src="${url}" controls autoplay></audio></div>`;
  else if (/pdf/.test(blob.type) || /\.pdf$/i.test(meta.name)) body = `<iframe class="pv-doc" src="${url}"></iframe>`;
  else if ((blob.type.startsWith('text/') || /\.(txt|md|csv|json|js|css|html?|xml|py|log)$/i.test(meta.name)) && blob.size < 2e6) body = `<pre class="pv-text">${esc(await blob.text())}</pre>`;
  else body = `<div class="pv-none">${icon(kindIcon(k), 56)}<b>${esc(meta.name)}</b><small>${fmtSize(blob.size)}</small><p>Pratinjau tidak tersedia untuk jenis berkas ini.</p></div>`;
  modal({
    id: 'pv', title: esc(meta.name), icon: kindIcon(k), wide: true, cls: 'pv-modal', body,
    actions: [...(isIOS() ? [{ label: 'Bagikan', fn: () => { shareFile(fid); return false; } }] : []), { label: 'Simpan', primary: true, fn: () => { saveFile(fid); return false; } }],
  });
}

// =====================================================================
// TEMA & STATUS
// =====================================================================
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = S.settings.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : S.settings.theme;
  document.documentElement.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0d1117' : '#f2f4f8';
}
mq.addEventListener ? mq.addEventListener('change', applyTheme) : mq.addListener(applyTheme);

async function updateStats(d) {
  if (!d.link || !d.link.open) return;
  const s = await d.link.stats();
  if (s) { const ch = d.via !== s.via || Math.abs((d.rtt || 0) - (s.rtt || 0)) > 3; d.via = s.via; d.rtt = s.rtt; if (ch) refresh('stats'); }
}
setInterval(() => { if (!document.hidden) connected().forEach(updateStats); }, 4000);

// =====================================================================
// MULAI
// =====================================================================
let pendingHashCode = null;
function boot() {
  applyTheme();
  shell();
  renderNetPill();

  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-page]');
    if (p && !p.closest('.welcome')) { e.preventDefault(); closeModal('more'); if (p.dataset.page === 'transfer') S.mobileConv = false; if (p.dataset.page === 'notes') S.mobileNote = false; go(p.dataset.page); return; }
    const a = e.target.closest('[data-act]');
    if (a && ACT[a.dataset.act]) { e.preventDefault(); ACT[a.dataset.act](a, e); }
  });
  document.addEventListener('change', (e) => {
    const s = e.target.closest('[data-set]');
    if (!s) return;
    const k = s.dataset.set, v = s.checked;
    if (k === 'clipAuto') { enableClipAuto(v); return; }
    if (k === 'notify' && v && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission().then((p) => { S.settings.notify = p === 'granted'; save.settings(); refresh('settings'); if (p !== 'granted') toast('Izin pemberitahuan ditolak di browser.', { icon: 'info' }); });
      return;
    }
    S.settings[k] = v; save.settings();
    if (k === 'autoConnect' && v) connectTrusted();
  });
  $('#btnConnect').addEventListener('click', openConnect);
  $('#netPill').addEventListener('click', openConnect);
  $('#logoTop').innerHTML = logo(28);

  // Tempel global → papan klip / transfer
  document.addEventListener('paste', async (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (t.id === 'msgInput' && e.clipboardData && e.clipboardData.files.length && S.sel && linkOf(S.sel)) {
        e.preventDefault(); sendFiles(S.sel, [...e.clipboardData.files].map((f) => ({ file: f, rel: '' })));
      }
      return;
    }
    if (!connected().length || !e.clipboardData) return;
    e.preventDefault();
    const files = [...e.clipboardData.files];
    const text = e.clipboardData.getData('text/plain');
    if (S.page === 'transfer' && S.sel && linkOf(S.sel)) {
      if (files.length) sendFiles(S.sel, files.map((f) => ({ file: f, rel: '' })));
      else if (text) sendText(S.sel, text);
      return;
    }
    const img = files.find((f) => f.type.startsWith('image/'));
    if (img) sendClipImage(img);
    else if (text) sendClipText(text);
  });

  // Seret berkas ke mana saja → buka transfer
  window.addEventListener('dragover', (e) => { if (hasFiles(e) && S.page !== 'transfer' && !e.target.closest('.welcome')) { e.preventDefault(); } });
  window.addEventListener('drop', async (e) => {
    if (S.page === 'transfer' || !hasFiles(e)) return;
    e.preventDefault();
    const files = await filesFromDrop(e.dataTransfer);
    const list = connected();
    if (!list.length) { toast('Hubungkan perangkat dulu.', { icon: 'unlink' }); return; }
    pickDevice('Kirim ke perangkat', 'transfer', (u) => { sendFiles(u, files); S.sel = u; go('transfer'); });
  });

  window.addEventListener('focus', () => {
    if (S.pendingCopy) { const t = S.pendingCopy; S.pendingCopy = null; navigator.clipboard.writeText(t).then(() => toast('Papan klip dari perangkat lain sudah disalin.', { icon: 'clipboard', kind: 'ok' })).catch(() => {}); }
    clipPoll();
  });
  setInterval(clipPoll, 1500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { net.signal.kick(); setTimeout(connectTrusted, 800); refresh('devices'); }
  });
  window.addEventListener('online', () => { net.signal.kick(); });
  // Tautan QR dibuka saat Taut sudah terbuka di tab ini
  window.addEventListener('hashchange', () => {
    const m2 = location.hash.match(/#k=(\d{6})/);
    if (m2) {
      history.replaceState(null, '', '#' + S.page);
      if (m2[1] === me.code) return;
      if (!modals.has('connect')) openConnect();
      if (net.signal.state === 'online') startConnect(m2[1]); else pendingHashCode = m2[1];
    } else {
      const pg = location.hash.slice(1);
      if (PAGES[pg] && pg !== S.page) go(pg);
    }
  });
  window.addEventListener('resize', debounce(() => refresh('devices'), 200));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; refresh('settings'); });
  window.addEventListener('appinstalled', () => { S.installEvt = null; toast('Taut terpasang!', { icon: 'check', kind: 'ok' }); });
  window.addEventListener('pagehide', () => { for (const l of net.openLinks()) l.send({ t: 'bye' }); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const last = [...modals.keys()].pop(); if (last && !last.startsWith('req-')) closeModal(last); }
  });

  // Baterai
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => { S.battery = { level: Math.round(b.level * 100), charging: b.charging }; net.broadcast({ t: 'info', battery: S.battery }); };
      upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
    }).catch(() => {});
  }

  // Kode dari QR (#k=123456)
  const h = location.hash;
  const km = h.match(/#k=(\d{6})/);
  if (km && km[1] !== me.code) pendingHashCode = km[1];
  const start = km ? 'home' : (h.replace('#', '') || 'home');
  go(PAGES[start] ? start : 'home');
  if (km && km[1] !== me.code) { openConnect(); setConnStatus('wait', `Menyambung ke server… lalu menghubungkan ke ${fmtCode(km[1])}.`, false); }

  if (firstRun || !LS.get('welcomed')) { if (!km) showWelcome(); else LS.set('welcomed', true); }

  Promise.all([loadFiles(), loadDirHandle(), checkClipPerm()]).then(() => refresh('files'));
  startNet();

  // Dibagikan dari aplikasi lain (share target Android/Chrome)
  if (qs.has('share')) {
    const txt = [qs.get('title'), qs.get('text'), qs.get('url')].filter(Boolean).join('\n').trim();
    history.replaceState(null, '', location.pathname + '#home');
    if (txt) S.pendingShare = txt;
  }
  if (qs.has('debug')) window.__taut = { S, net, me, sendFiles, sendText, sendClipText, newNote, editNote, addShared, go, connected, linkOf };

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// Cegah dua tab memakai identitas yang sama
function startNet() {
  let bc = null;
  try { bc = new BroadcastChannel('taut-tab'); } catch {}
  if (!bc) { net.start(); return; }
  const tab = uid(6);
  let other = false;
  bc.onmessage = (e) => {
    const m = e.data || {};
    if (m.t === 'hi' && m.tab !== tab && net.signal.state !== 'offline') bc.postMessage({ t: 'here', tab });
    if (m.t === 'here' && m.tab !== tab) other = true;
    if (m.t === 'take' && m.tab !== tab) {
      for (const l of [...net.links.values()]) l.close('bye-local', true);
      S.devices.forEach((d) => { d.link = null; d.ready = false; });
      net.signal.stop(); refresh('devices');
      tabConflict(bc, tab, true);
    }
  };
  bc.postMessage({ t: 'hi', tab });
  setTimeout(() => { if (other) tabConflict(bc, tab, false); else net.start(); }, 400);
}
function tabConflict(bc, tab, taken) {
  modal({
    id: 'tab', icon: 'info', title: taken ? 'Taut dipakai di jendela lain' : 'Taut sudah terbuka', dismiss: false,
    body: `<p>${taken ? 'Taut sekarang aktif di tab atau jendela lain di perangkat ini.' : 'Taut sudah terbuka di tab atau jendela lain di perangkat ini.'} Hanya satu yang bisa aktif sekaligus.</p>`,
    actions: [{ label: 'Gunakan di sini', primary: true, fn: () => { bc.postMessage({ t: 'take', tab }); setTimeout(() => { net.signal.retry = 0; net.start(); }, 300); } }],
  });
}

boot();
