// Taut — lapisan jaringan: server sinyal (protokol PeerJS) + WebRTC peer-to-peer
//
// Model keamanan:
//  - Server sinyal hanya mempertemukan perangkat; isinya tidak dipercaya.
//  - Semua pesan dari perangkat lain divalidasi. Berkas & media baru diproses
//    setelah lapisan aplikasi menandai sambungan "authed" (lolos verifikasi).
import { uid, isObj, okId, okCode, safeInt, safeMime, cleanFileName, cleanRel, cleanName, cleanStr } from './util.js?v=1.1.1';

export const PREFIX = 'taut-v1-';
export const DEFAULT_SIGNAL = 'wss://0.peerjs.com:443/peerjs';
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
export const LIMITS = {
  fileMax: 50 * 1024 ** 3,       // ukuran berkas maksimum yang diterima
  memMax: 2 * 1024 ** 3,         // tanpa folder penyimpanan, berkas ditampung di memori
  clipImgMax: 25 * 1024 ** 2,
  rxConcurrent: 6,
  mediaConcurrent: 6,
  sdpMax: 100000,
};

export class Emitter {
  constructor() { this._h = {}; }
  on(e, f) { (this._h[e] ||= []).push(f); return () => this.off(e, f); }
  off(e, f) { this._h[e] = (this._h[e] || []).filter((x) => x !== f); }
  emit(e, ...a) { for (const f of this._h[e] || []) { try { f(...a); } catch (err) { console.error(err); } } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------
// Server sinyal (kompatibel dengan server PeerJS publik)
// ---------------------------------------------------------------
export class Signal extends Emitter {
  constructor(url) {
    super();
    this.url = url || DEFAULT_SIGNAL;
    this.state = 'offline';
    this.retry = 0;
    this.ws = null;
    this.stopped = true;
  }
  start(id, token) {
    this.id = id; this.token = token; this.stopped = false;
    this._open();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this._rt); clearTimeout(this._ot); clearTimeout(this._ok);
    this._stopHb();
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch {} }
    this.ws = null;
    this._set('offline');
  }
  restart(id, token) { this.stop(); this.start(id, token); }
  kick() {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState > 1) { this.retry = 0; this._open(); }
  }
  _set(s) { if (this.state !== s) { this.state = s; this.emit('state', s); } }
  _open() {
    clearTimeout(this._rt); clearTimeout(this._ot); clearTimeout(this._ok);
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch {} }
    this._set('connecting');
    let ws;
    try {
      ws = new WebSocket(`${this.url}?key=peerjs&id=${encodeURIComponent(PREFIX + this.id)}&token=${encodeURIComponent(this.token)}&version=1.5.4`);
    } catch (e) { this._schedule(); return; }
    this.ws = ws;
    ws.onopen = () => {
      // Server tidak mengirim OPEN bila ID+token yang sama tersambung ulang; anggap daring setelah jeda singkat.
      this._ok = setTimeout(() => { if (this.ws === ws && ws.readyState === 1 && this.state === 'connecting') this._online(); }, 1800);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 300000) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (isObj(m)) this._msg(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this._stopHb(); this._set('offline');
      if (!this.stopped) this._schedule();
    };
    ws.onerror = () => {};
    this._ot = setTimeout(() => { if (this.ws === ws && this.state === 'connecting') { try { ws.close(); } catch {} } }, 12000);
  }
  _online() {
    clearTimeout(this._ot); clearTimeout(this._ok);
    this.retry = 0; this._set('online'); this._startHb();
    this.emit('open');
  }
  _schedule() {
    clearTimeout(this._rt);
    const d = Math.min(15000, 800 * 2 ** this.retry++);
    this._rt = setTimeout(() => this._open(), d);
  }
  _startHb() {
    this._stopHb();
    this._hb = setInterval(() => { if (this.ws && this.ws.readyState === 1) this.ws.send('{"type":"HEARTBEAT"}'); }, 5000);
  }
  _stopHb() { clearInterval(this._hb); }
  _msg(m) {
    switch (m.type) {
      case 'OPEN': this._online(); break;
      case 'ID-TAKEN': this.emit('idtaken'); break;
      case 'ERROR': this.emit('error', cleanStr(m.payload && m.payload.msg, 200) || 'Kesalahan server'); break;
      case 'OFFER': case 'ANSWER': case 'CANDIDATE': case 'LEAVE': case 'EXPIRE': {
        if (this.state === 'connecting') this._online();
        if (typeof m.src !== 'string' || !m.src.startsWith(PREFIX)) return;
        const from = m.src.slice(PREFIX.length);
        if (!okCode(from)) return; // hanya kode 6 angka yang sah
        this.emit('signal', { type: m.type, from, payload: isObj(m.payload) ? m.payload : {} });
        break;
      }
      default: break;
    }
  }
  send(type, to, payload) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type, dst: PREFIX + to, payload }));
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------
// Satu sambungan ke satu perangkat
// ---------------------------------------------------------------
export class Link extends Emitter {
  constructor(net, rid, { initiator, cid, hello, flags }) {
    super();
    this.net = net;
    this.rid = rid;              // kode perangkat lawan (dibuktikan server sinyal)
    this.cid = cid || uid(10);
    this.initiator = initiator;
    this.remoteHello = hello || null;
    Object.assign(this, flags || {});
    this.state = 'new';
    this.authed = false;         // diisi lapisan aplikasi setelah verifikasi
    this.pc = null; this.dc = null;
    this.ice = [];
    this.tx = new Map(); this.rx = new Map(); this.queue = []; this.nextTid = 1;
    this.media = new Map();
    this.lastRx = 0;
  }
  _pc() {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.signal.send('CANDIDATE', this.rid, candPayload(this.cid, e.candidate));
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed') this.close('failed');
      if (s === 'disconnected') {
        clearTimeout(this._dt);
        this._dt = setTimeout(() => { if (pc.connectionState === 'disconnected') this.close('lost'); }, 8000);
      }
    };
    this.pc = pc;
    return pc;
  }
  _timeout(ms) {
    clearTimeout(this._to);
    this._to = setTimeout(() => { if (this.state !== 'open') this.close('timeout'); }, ms);
  }
  async start(hello, waitMs = 60000) {
    this.state = 'connecting';
    const pc = this._pc();
    this._dc(pc.createDataChannel('taut', { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const ok = this.net.signal.send('OFFER', this.rid, offerPayload(this.cid, pc.localDescription.sdp, hello));
    if (!ok) { this.close('nosignal'); return; }
    this._timeout(waitMs);
  }
  async accept(sdp, hello, buffered = []) {
    this.state = 'connecting';
    const pc = this._pc();
    pc.ondatachannel = (e) => { if (!this.dc) this._dc(e.channel); };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const c of buffered) { try { await pc.addIceCandidate(c); } catch {} }
    await this._flushIce();
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    this.net.signal.send('ANSWER', this.rid, answerPayload(this.cid, pc.localDescription.sdp, { hello }));
    this._timeout(30000);
  }
  async onAnswer(p) {
    if (!this.pc || this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
    await this._flushIce();
    this._timeout(25000);
  }
  async onCandidate(c) {
    if (!isObj(c)) return;
    if (!this.pc || !this.pc.remoteDescription) { if (this.ice.length < 40) this.ice.push(c); return; }
    try { await this.pc.addIceCandidate(c); } catch {}
  }
  async _flushIce() {
    const l = this.ice; this.ice = [];
    for (const c of l) { try { await this.pc.addIceCandidate(c); } catch {} }
  }
  _dc(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1024 * 1024;
    const opened = () => {
      if (this.state === 'open' || this.state === 'closed' || dc.readyState !== 'open') return;
      this.state = 'open'; this.lastRx = Date.now(); clearTimeout(this._to);
      this._ping = setInterval(() => { if (this.open) this.send({ t: 'ping' }); }, 5000);
      this.emit('open');
    };
    dc.onopen = opened;
    dc.onclose = () => this.close('closed');
    dc.onerror = () => {};
    dc.onmessage = (e) => this._data(e.data);
    if (dc.readyState === 'open') setTimeout(opened, 0);
  }
  get open() { return this.state === 'open' && this.dc && this.dc.readyState === 'open'; }
  // Sidik jari sertifikat DTLS kedua sisi (untuk mengikat verifikasi ke sambungan ini)
  fingerprints() {
    const fp = (d) => { const m = /a=fingerprint:(\S+) ([0-9A-Fa-f:]+)/.exec((d && d.sdp) || ''); return m ? m[1].toLowerCase() + ' ' + m[2].toUpperCase() : ''; };
    return this.pc ? [fp(this.pc.localDescription), fp(this.pc.remoteDescription)] : ['', ''];
  }
  send(obj) {
    if (this.open) { try { this.dc.send(JSON.stringify(obj)); return true; } catch (e) { console.warn('kirim gagal', obj && obj.t, e); return false; } }
    return false;
  }
  close(reason = 'closed', silent = false) {
    if (this.state === 'closed') return;
    const was = this.state;
    this.state = 'closed';
    this.authed = false;
    clearTimeout(this._to); clearTimeout(this._dt); clearInterval(this._ping);
    for (const t of this.tx.values()) if (t.state === 'sending' || t.state === 'queued') { t.state = 'failed'; this.emit('tx', t); }
    for (const t of this.queue) { t.state = 'failed'; this.emit('tx', t); }
    this.queue = [];
    for (const r of this.rx.values()) if (r.state === 'receiving') { r.state = 'failed'; r.parts = null; this._abortSink(r); this.emit('rx', r); }
    for (const m of this.media.values()) this._mediaClose(m, true);
    try { this.dc && this.dc.close(); } catch {}
    try { this.pc && this.pc.close(); } catch {}
    if (!silent) this.emit('close', reason, was);
  }

  // ---------- Pengiriman berkas ----------
  sendFile(file, meta = {}) {
    const t = {
      tid: this.nextTid++, id: meta.id || uid(), file,
      name: meta.name || file.name || 'berkas', size: file.size, mime: file.type || meta.mime || 'application/octet-stream',
      purpose: meta.purpose || 'transfer', rel: meta.rel || '', batch: meta.batch || null, extra: meta.extra || null,
      sent: 0, state: 'queued', dir: 'out', rid: this.rid, t0: 0, speed: 0,
    };
    this.queue.push(t);
    this.emit('tx', t);
    this._pump();
    return t;
  }
  cancel(t) {
    if (t.dir === 'out') {
      if (t.state === 'queued') { this.queue = this.queue.filter((x) => x !== t); t.state = 'cancelled'; this.emit('tx', t); }
      else if (t.state === 'sending') { t.state = 'cancelled'; this.send({ t: 'f-cancel', tid: t.tid, side: 'tx' }); this.emit('tx', t); }
    } else if (t.state === 'receiving') {
      this._rxFail(t, 'cancelled');
      this.send({ t: 'f-cancel', tid: t.tid, side: 'rx' });
    }
  }
  async _pump() {
    if (this._pumping) return;
    this._pumping = true;
    try {
      while (this.queue.length && this.open) {
        const t = this.queue.shift();
        if (t.state !== 'queued') continue;
        await this._sendOne(t);
      }
    } finally { this._pumping = false; }
  }
  _chunk() {
    const m = (this.pc && this.pc.sctp && this.pc.sctp.maxMessageSize) || 65536;
    return Math.max(8192, Math.min(65536, m) - 64);
  }
  _drain() {
    return new Promise((res) => {
      const dc = this.dc;
      let done = false;
      const f = () => { if (done) return; done = true; dc.removeEventListener('bufferedamountlow', f); res(); };
      dc.addEventListener('bufferedamountlow', f);
      setTimeout(f, 250);
    });
  }
  async _sendOne(t) {
    this.tx.set(t.tid, t);
    t.state = 'sending'; t.t0 = performance.now();
    this.send({ t: 'f-start', tid: t.tid, id: t.id, name: t.name, size: t.size, mime: t.mime, purpose: t.purpose, rel: t.rel, batch: t.batch, extra: t.extra });
    this.emit('tx', t);
    const CH = this._chunk();
    const BLOCK = CH * 16;
    let off = 0, lastEmit = 0;
    try {
      while (off < t.size) {
        if (t.state !== 'sending' || !this.open) break;
        const bEnd = Math.min(off + BLOCK, t.size);
        const block = new Uint8Array(await t.file.slice(off, bEnd).arrayBuffer());
        let p = 0;
        while (p < block.length) {
          if (t.state !== 'sending' || !this.open) break;
          if (this.dc.bufferedAmount > 6 * 1024 * 1024) { await this._drain(); continue; }
          const n = Math.min(CH, block.length - p);
          const out = new Uint8Array(n + 4);
          new DataView(out.buffer).setUint32(0, t.tid);
          out.set(block.subarray(p, p + n), 4);
          this.dc.send(out.buffer);
          p += n;
        }
        off += p;
        t.sent = off;
        const now = performance.now();
        if (now - lastEmit > 120) { lastEmit = now; t.speed = t.sent / Math.max(0.001, (now - t.t0) / 1000); this.emit('tx', t); }
      }
    } catch (e) {
      console.warn('kirim gagal', e);
      if (t.state === 'sending') t.state = 'failed';
    }
    if (t.state === 'sending') {
      if (off >= t.size && this.open) { this.send({ t: 'f-end', tid: t.tid }); t.state = 'done'; t.sent = t.size; }
      else t.state = 'failed';
    }
    this.tx.delete(t.tid);
    this.emit('tx', t);
  }

  // ---------- Penerimaan data ----------
  _data(d) {
    this.lastRx = Date.now();
    if (typeof d === 'string') {
      if (d.length > 2_000_000) return;
      let m; try { m = JSON.parse(d); } catch { return; }
      if (isObj(m) && typeof m.t === 'string') this._ctl(m);
      return;
    }
    if (d instanceof Blob) { d.arrayBuffer().then((b) => this._bin(b)); return; }
    if (d instanceof ArrayBuffer) this._bin(d);
  }
  _bin(buf) {
    if (!this.authed || buf.byteLength < 4) return;
    const tid = new DataView(buf).getUint32(0);
    const r = this.rx.get(tid);
    if (!r || r.state !== 'receiving') return;
    const chunk = new Uint8Array(buf, 4);
    if (r.got + chunk.byteLength > r.size) { // pengirim melebihi ukuran yang diumumkan
      this._rxFail(r, 'failed');
      this.send({ t: 'f-cancel', tid, side: 'rx' });
      return;
    }
    r.got += chunk.byteLength;
    if (r.sink) {
      r.chain = r.chain.then(async () => {
        const s = await r.sink;
        if (s) { await s.write(chunk); } else if (r.parts) r.parts.push(chunk);
      }).catch((e) => { console.warn(e); r.sinkError = true; });
    } else r.parts.push(chunk);
    const now = performance.now();
    if (now - r.lastEmit > 120) { r.lastEmit = now; r.speed = r.got / Math.max(0.001, (now - r.t0) / 1000); this.emit('rx', r); }
  }
  _abortSink(r) { if (r.sink) Promise.resolve(r.sink).then((s) => s && s.abort && s.abort()).catch(() => {}); }
  _rxFail(r, state, reason) {
    r.state = state; r.parts = null; r.reason = reason || null;
    this.rx.delete(r.tid);
    this._abortSink(r);
    this.emit('rx', r);
  }
  _ctl(m) {
    if (m.t === 'ping') { this.send({ t: 'pong' }); return; }
    if (m.t === 'pong') return;
    const internal = m.t.startsWith('f-') || m.t.startsWith('m-');
    if (!internal) { this.emit('msg', m); return; }
    if (!this.authed) return; // berkas & media hanya dari perangkat terverifikasi
    switch (m.t) {
      case 'f-start': this._fileStart(m); break;
      case 'f-end': {
        const r = this.rx.get(m.tid);
        if (!r || r.state !== 'receiving') return;
        this.rx.delete(m.tid);
        if (r.got !== r.size) { this._rxFail(r, 'failed'); return; } // berkas terpotong
        r.state = 'finishing';
        r.chain.then(async () => {
          const s = r.sink ? await r.sink : null;
          if (s && !r.sinkError) { try { await s.close(); r.savedToDisk = true; } catch (e) { r.sinkError = true; } }
          if (r.parts && !r.savedToDisk) r.blob = new Blob(r.parts, { type: r.mime });
          r.parts = null;
          r.state = r.sinkError && !r.blob ? 'failed' : 'done';
          this.emit('rx', r);
        });
        break;
      }
      case 'f-cancel': {
        if (m.side === 'tx') {
          const r = this.rx.get(m.tid);
          if (r && r.state === 'receiving') this._rxFail(r, 'cancelled');
        } else {
          const t = this.tx.get(m.tid) || this.queue.find((x) => x.tid === m.tid);
          if (t) { t.state = 'cancelled'; this.queue = this.queue.filter((x) => x !== t); this.emit('tx', t); }
        }
        break;
      }
      case 'm-offer': this._mediaOffer(m).catch((e) => console.warn(e)); break;
      case 'm-answer': this._mediaAnswer(m).catch((e) => console.warn(e)); break;
      case 'm-ice': this._mediaIce(m); break;
      case 'm-stop': { const ms = okId(m.sid) && this.media.get(m.sid); if (ms) this._mediaClose(ms, false, true); break; }
      default: break;
    }
  }
  _fileStart(m) {
    const tid = safeInt(m.tid, 1, 2 ** 31);
    if (tid === null || this.rx.has(tid)) return;
    const size = safeInt(m.size, 0, LIMITS.fileMax);
    const purpose = ['transfer', 'clip', 'share'].includes(m.purpose) ? m.purpose : 'transfer';
    const mime = safeMime(m.mime);
    const deny = () => this.send({ t: 'f-cancel', tid, side: 'rx' });
    if (size === null) { deny(); return; }
    if ([...this.rx.values()].filter((r) => r.state === 'receiving').length >= LIMITS.rxConcurrent) { deny(); return; }
    if (purpose === 'clip' && (!mime.startsWith('image/') || size > LIMITS.clipImgMax)) { deny(); return; }
    const ex = isObj(m.extra) ? m.extra : {};
    const r = {
      tid, id: okId(m.id) ? m.id : uid(), name: cleanFileName(m.name), size, mime, purpose,
      rel: cleanRel(m.rel), batch: okId(m.batch) ? m.batch : null,
      extra: { bname: cleanFileName(ex.bname), bcount: safeInt(ex.bcount, 1, 100000) || 1, bsize: safeInt(ex.bsize, 0, LIMITS.fileMax) || size },
      dir: 'in', rid: this.rid, parts: [], got: 0, state: 'receiving', t0: performance.now(), lastEmit: 0, speed: 0, chain: Promise.resolve(),
    };
    if (this.net.sinkFor) r.sink = this.net.sinkFor(r, this) || null;
    this.rx.set(tid, r);
    if (!r.sink && size > LIMITS.memMax) { // terlalu besar untuk memori browser
      this.emit('rx', r);
      this._rxFail(r, 'failed', 'toolarge');
      deny();
      return;
    }
    this.emit('rx', r);
  }

  // ---------- Media (layar & kamera) ----------
  async startMedia(stream, kind, label, extra = {}) {
    const sid = uid(8);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const ms = { sid, pc, kind, label, dir: 'out', stream, rid: this.rid, ice: [], extra };
    this.media.set(sid, ms);
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'm-ice', sid, c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.stopMedia(sid); };
    for (const tr of stream.getTracks()) {
      try { tr.contentHint = kind === 'screen' ? 'detail' : 'motion'; } catch {}
      pc.addTrack(tr, stream);
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ t: 'm-offer', sid, kind, label, extra, sdp: pc.localDescription.sdp });
    this.emit('media', ms);
    return ms;
  }
  async _mediaOffer(m) {
    if (!okId(m.sid) || this.media.has(m.sid) || typeof m.sdp !== 'string' || m.sdp.length > LIMITS.sdpMax) return;
    if (m.kind !== 'screen' && m.kind !== 'camera') return;
    if (this.media.size >= LIMITS.mediaConcurrent) { this.send({ t: 'm-stop', sid: m.sid }); return; }
    const facing = isObj(m.extra) && m.extra.facing === 'user' ? 'user' : 'environment';
    const ms = { sid: m.sid, pc: null, kind: m.kind, label: cleanName(m.label, 40), extra: { facing }, dir: 'in', stream: null, rid: this.rid, ice: [] };
    this.media.set(m.sid, ms);
    // Persetujuan: tampilan media hanya dibuka bila diminta atau diizinkan pengguna
    let allow = false;
    try { allow = this.net.mediaGate ? await this.net.mediaGate(this, ms) : false; } catch { allow = false; }
    if (ms.closed || this.state === 'closed') return;
    if (!allow) { ms.closed = true; this.media.delete(m.sid); this.send({ t: 'm-stop', sid: m.sid }); return; }
    const pc = new RTCPeerConnection({ iceServers: ICE });
    ms.pc = pc;
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'm-ice', sid: m.sid, c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      ms.stream = (e.streams && e.streams[0]) || ms.stream || new MediaStream();
      if (!e.streams || !e.streams[0]) ms.stream.addTrack(e.track);
      this.emit('media', ms);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this._mediaClose(ms, false, true); };
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    for (const c of ms.ice) { try { await pc.addIceCandidate(c); } catch {} }
    ms.ice = [];
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    this.send({ t: 'm-answer', sid: m.sid, sdp: pc.localDescription.sdp });
  }
  async _mediaAnswer(m) {
    const ms = okId(m.sid) && this.media.get(m.sid);
    if (!ms || ms.dir !== 'out' || !ms.pc || typeof m.sdp !== 'string' || m.sdp.length > LIMITS.sdpMax) return;
    if (ms.pc.signalingState !== 'have-local-offer') return;
    await ms.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    for (const c of ms.ice) { try { await ms.pc.addIceCandidate(c); } catch {} }
    ms.ice = [];
    for (const s of ms.pc.getSenders()) {
      if (!s.track || s.track.kind !== 'video') continue;
      try {
        const p = s.getParameters();
        p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
        p.encodings[0].maxBitrate = ms.kind === 'screen' ? 8_000_000 : 5_000_000;
        if (ms.kind === 'screen') p.degradationPreference = 'maintain-resolution';
        await s.setParameters(p);
      } catch {}
    }
  }
  async _mediaIce(m) {
    const ms = okId(m.sid) && this.media.get(m.sid);
    if (!ms || !isObj(m.c)) return;
    if (!ms.pc || !ms.pc.remoteDescription) { if (ms.ice.length < 40) ms.ice.push(m.c); return; }
    try { await ms.pc.addIceCandidate(m.c); } catch {}
  }
  async replaceVideo(sid, track) {
    const ms = this.media.get(sid);
    if (!ms || !ms.pc) return;
    const s = ms.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
    if (s) await s.replaceTrack(track);
  }
  stopMedia(sid) {
    const ms = this.media.get(sid);
    if (!ms) return;
    this.send({ t: 'm-stop', sid });
    this._mediaClose(ms, false);
  }
  _mediaClose(ms, linkClosing, remote = false) {
    if (ms.closed) return;
    ms.closed = true;
    this.media.delete(ms.sid);
    try { ms.pc && ms.pc.close(); } catch {}
    this.emit('media-end', ms, remote || linkClosing);
  }

  async stats() {
    if (!this.pc) return null;
    try {
      const st = await this.pc.getStats();
      let pair = null;
      st.forEach((r) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId);
      });
      if (!pair) st.forEach((r) => { if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) pair = pair || r; });
      if (!pair) return null;
      const lc = st.get(pair.localCandidateId), rc = st.get(pair.remoteCandidateId);
      const lt = lc && lc.candidateType, rt = rc && rc.candidateType;
      let via = 'internet';
      if (lt === 'relay' || rt === 'relay') via = 'relay';
      else if (lt === 'host' && rt === 'host') via = 'lan';
      else if (lc && rc && isPrivate(lc.address || lc.ip) && isPrivate(rc.address || rc.ip)) via = 'lan';
      return { via, rtt: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null };
    } catch { return null; }
  }
}

// Bentuk pesan mengikuti skema server PeerJS (server publik menolak bentuk lain).
// Data milik Taut dititipkan di kolom "metadata".
function offerPayload(cid, sdp, hello) {
  return { sdp: { type: 'offer', sdp }, type: 'data', connectionId: cid, label: cid, reliable: true, serialization: 'raw', browser: 'chrome', metadata: { app: 'taut', hello } };
}
function answerPayload(cid, sdp, meta) {
  return { sdp: { type: 'answer', sdp }, type: 'data', connectionId: cid, browser: 'chrome', metadata: { app: 'taut', ...meta } };
}
function candPayload(cid, c) {
  return { candidate: c.toJSON ? c.toJSON() : c, type: 'data', connectionId: cid };
}
function readPayload(p) {
  const md = isObj(p.metadata) ? p.metadata : {};
  const sdp = isObj(p.sdp) ? p.sdp.sdp : p.sdp;
  return {
    cid: okId(p.connectionId) ? p.connectionId : null,
    sdp: typeof sdp === 'string' && sdp.length < LIMITS.sdpMax ? sdp : null,
    hello: isObj(md.hello) ? md.hello : null,
    reject: md.reject === true,
    candidate: isObj(p.candidate) ? p.candidate : null,
    taut: md.app === 'taut',
  };
}

function isPrivate(ip) {
  if (!ip) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80|fd|fc)/i.test(ip) || /\.local$/.test(ip);
}

// ---------------------------------------------------------------
// Pengelola semua sambungan
// ---------------------------------------------------------------
export class Net extends Emitter {
  constructor({ signalUrl, me, hello, isTrusted }) {
    super();
    this.me = me;               // { code, token }
    this.hello = hello;         // (link) => salam untuk server sinyal
    this.isTrusted = isTrusted; // (salam) => bool
    this.signal = new Signal(signalUrl);
    this.links = new Map();     // kode -> Link
    this.iceBuf = new Map();    // cid -> kandidat
    this.offerWait = new Map();
    this.sinkFor = null;
    this.mediaGate = null;
    this.signal.on('signal', (s) => this._onSignal(s).catch((e) => console.warn(e)));
  }
  start() { this.signal.start(this.me.code, this.me.token); }
  _track(l) {
    this.links.set(l.rid, l);
    l.on('open', () => this.emit('link-open', l));
    l.on('close', (reason, was) => {
      if (this.links.get(l.rid) === l) this.links.delete(l.rid);
      this.emit('link-close', l, reason, was);
    });
    l.on('msg', (m) => this.emit('msg', l, m));
    l.on('tx', (t) => this.emit('tx', l, t));
    l.on('rx', (r) => this.emit('rx', l, r));
    l.on('media', (m) => this.emit('media', l, m));
    l.on('media-end', (m, remote) => this.emit('media-end', l, m, remote));
    this.emit('link-new', l);
  }
  connect(code, { quiet = false, waitMs = 60000, manual = false } = {}) {
    code = String(code).replace(/\D/g, '');
    if (!okCode(code) || code === this.me.code) return null;
    const ex = this.links.get(code);
    if (ex && (ex.state === 'open' || ex.state === 'connecting')) { if (manual) ex.manual = true; return ex; }
    const l = new Link(this, code, { initiator: true, flags: { quiet, manual } });
    this._track(l);
    l.start(this.hello(l), waitMs).catch((e) => { console.warn(e); l.close('error'); });
    return l;
  }
  async _onSignal({ type, from, payload: raw }) {
    const payload = readPayload(raw);
    const cid = payload.cid;
    if (!cid) return;
    if (type === 'OFFER') {
      if (!payload.taut || !payload.sdp || !payload.hello) return;
      this.offerWait.set(from, cid);
      const ex = this.links.get(from);
      if (ex && ex.state !== 'closed') {
        if (ex.cid === cid) return;
        if (ex.initiator && ex.state === 'connecting' && this.me.code > from) return; // tabrakan: pakai tawaran kita
        if (ex.state === 'open') {
          // Jangan putuskan sambungan yang masih hidup hanya karena ada tawaran baru (bisa penyamar).
          const before = ex.lastRx;
          ex.send({ t: 'ping' });
          await sleep(2500);
          if (this.offerWait.get(from) !== cid) return; // sudah ada tawaran yang lebih baru
          if (ex.state === 'open' && ex.lastRx > before) return;
        }
        if (ex.state !== 'closed') ex.close('replaced');
      }
      const hello = payload.hello;
      const go = async (flags = {}) => {
        const l = new Link(this, from, { initiator: false, cid, hello, flags });
        this._track(l);
        const buf = this.iceBuf.get(cid) || [];
        this.iceBuf.delete(cid);
        try { await l.accept(payload.sdp, this.hello(l), buf); } catch (e) { console.warn(e); l.close('error'); }
        return l;
      };
      if (this.isTrusted(hello)) { await go({ autoAccepted: true }); return; }
      let used = false;
      this.emit('request', {
        from, hello,
        accept: (flags) => { if (used) return null; used = true; return go(flags); },
        reject: () => { if (used) return; used = true; this.signal.send('ANSWER', from, answerPayload(cid, payload.sdp, { reject: true })); this.iceBuf.delete(cid); },
      });
      return;
    }
    if (type === 'ANSWER') {
      const l = this.links.get(from);
      if (!l || l.cid !== cid || !l.initiator) return;
      if (payload.reject) { l.close('rejected'); return; }
      if (!payload.sdp) return;
      if (payload.hello) l.remoteHello = payload.hello;
      await l.onAnswer(payload);
      return;
    }
    if (type === 'CANDIDATE') {
      const l = this.links.get(from);
      if (l && l.cid === cid) { await l.onCandidate(payload.candidate); return; }
      if (!payload.candidate) return;
      const arr = this.iceBuf.get(cid) || [];
      if (arr.length < 40) arr.push(payload.candidate);
      this.iceBuf.set(cid, arr);
      while (this.iceBuf.size > 50) this.iceBuf.delete(this.iceBuf.keys().next().value);
      return;
    }
    if (type === 'EXPIRE' || type === 'LEAVE') {
      const l = this.links.get(from);
      if (l && l.state === 'connecting' && l.initiator) l.close('offline');
    }
  }
  openLinks() { return [...this.links.values()].filter((l) => l.open); }
  broadcast(obj, except) {
    let n = 0;
    for (const l of this.openLinks()) if (l !== except && l.active && l.send(obj)) n++;
    return n;
  }
}
