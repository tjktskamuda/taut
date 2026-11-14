// Taut — set ikon garis (dibuat khusus untuk Taut)
const P = {
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z"/>',
  transfer: '<path d="M7.5 4v14.5M7.5 4 4 7.5M7.5 4 11 7.5M16.5 20V5.5M16.5 20 13 16.5M16.5 20l3.5-3.5"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2.5"/><path d="M9 4.8V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.8M9 11h6M9 15h4"/>',
  mirror: '<rect x="2.5" y="4" width="14" height="10" rx="1.8"/><path d="M6.5 18h5M9 14v4"/><rect x="15" y="8.5" width="6.5" height="12" rx="1.6"/><path d="M17.6 18h1.3"/>',
  camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="12.6" r="3.6"/>',
  notes: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h8.7L19 6.8v12.7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5z"/><path d="M15 3v4h4M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4.2l2 2.4H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderUp: '<path d="M3 7a2 2 0 0 1 2-2h4.2l2 2.4H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.3"/><circle cx="9" cy="17" r="2.3"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 19.5h1.5M19.5 14v1.5"/>',
  send: '<path d="M20.5 3.5 10 14M20.5 3.5 14 21l-4-7-7-4z"/>',
  clip: '<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 15.5-5-5L5 20"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
  audio: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  doc: '<path d="M6.5 3h7.8L19 7.7v12.8a.5.5 0 0 1-.5.5h-12A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
  apk: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 8v6M9.5 11.5 12 14l2.5-2.5M10 18h4"/>',
  file: '<path d="M6.5 3h7.8L19 7.7v12.8a.5.5 0 0 1-.5.5h-12A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14 3v5h5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  share: '<path d="M12 14V3.5M8 7.5l4-4 4 4"/><path d="M8 10.5H6.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2H16"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  ring: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0M3 9.5a9 9 0 0 1 2.2-4.8M21 9.5a9 9 0 0 0-2.2-4.8"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  unlink: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1M3 3l18 18"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1"/>',
  flip: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M9 12a3.2 3.2 0 0 1 5.6-1.6M15 13.6a3.2 3.2 0 0 1-5.6 1.4M14.9 8.7v1.9H13M9.1 16.8v-1.9H11"/>',
  shutter: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M11 18h2"/>',
  laptop: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5V15H5z"/><path d="M2.5 15h19l-1 3.2a1 1 0 0 1-1 .8h-15a1 1 0 0 1-1-.8z"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.2" r=".6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  pin: '<path d="M9 3h6l-1 5.5 3.5 3.5h-11L10 8.5z"/><path d="M12 12v9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>',
  text: '<path d="M5 6.5V4.5h14v2M12 4.5V20M9 20h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
  eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
  mirrorFlip: '<path d="M12 3v18M9 7 4 17h5zM15 7l5 10h-5z"/>',
  install: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M12 7.5v7M9 11.5l3 3 3-3"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  sparkle: '<path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.2 10.2 12.6 4.5 10.8 10.2 9z"/>',
  handoff: '<rect x="2.5" y="5" width="9" height="14" rx="2"/><rect x="14.5" y="3" width="7" height="12" rx="1.8"/><path d="M9 21h6.5a2 2 0 0 0 2-2v-1.5M15.5 19.5l2-2 2 2"/>',
  battery: '<rect x="2.5" y="7.5" width="17" height="9" rx="2.2"/><path d="M21.5 10.5v3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7 14h10"/>',
};

export function icon(name, size = 20, cls = '') {
  const p = P[name] || P.file;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

export function kindIcon(kind) {
  return { image: 'image', video: 'video', audio: 'audio', doc: 'doc', archive: 'archive', apk: 'apk' }[kind] || 'file';
}

export function deviceIcon(type) {
  return { phone: 'phone', tablet: 'tablet', laptop: 'laptop', desktop: 'desktop' }[type] || 'laptop';
}

// Logo Taut: dua cincin yang saling bertaut
export function logo(size = 32) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="tg${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C8DFF"/><stop offset="1" stop-color="#2A4FE0"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#tg${size})"/><rect x="13" y="20" width="24" height="24" rx="8" fill="none" stroke="#fff" stroke-width="5"/><rect x="27" y="20" width="24" height="24" rx="8" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5"/></svg>`;
}

// Ilustrasi perangkat (untuk kartu perangkat & beranda)
export function deviceArt(type, opts = {}) {
  const screen = 'style="fill:var(--art-screen)"';
  const frame = 'style="fill:var(--art-frame)"';
  const notch = 'style="fill:var(--art-notch)"';
  if (type === 'phone') {
    return `<svg viewBox="0 0 60 110" class="art art-phone"><rect x="2" y="2" width="56" height="106" rx="12" ${frame}/><rect x="5.5" y="5.5" width="49" height="99" rx="9" ${screen}/><rect x="23" y="9" width="14" height="4" rx="2" ${frame}/></svg>`;
  }
  if (type === 'tablet') {
    return `<svg viewBox="0 0 120 90" class="art art-tablet"><rect x="2" y="2" width="116" height="86" rx="10" ${frame}/><rect x="7" y="7" width="106" height="76" rx="6" ${screen}/></svg>`;
  }
  if (type === 'desktop') {
    return `<svg viewBox="0 0 130 100" class="art art-desktop"><rect x="2" y="2" width="126" height="76" rx="7" ${frame}/><rect x="6" y="6" width="118" height="68" rx="4" ${screen}/><path d="M55 78h20l3 14H52z" ${frame}/><rect x="40" y="91" width="50" height="5" rx="2.5" ${frame}/></svg>`;
  }
  return `<svg viewBox="0 0 140 92" class="art art-laptop"><rect x="18" y="2" width="104" height="70" rx="7" ${frame}/><rect x="22" y="6" width="96" height="62" rx="4" ${screen}/><path d="M4 74h132l-4 10a6 6 0 0 1-5.6 4H13.6A6 6 0 0 1 8 84z" ${frame}/><rect x="58" y="74" width="24" height="3" rx="1.5" ${notch}/></svg>`;
}
