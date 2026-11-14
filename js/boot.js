// Dijalankan paling awal (sebelum aplikasi): perlindungan bingkai & tema.
(function () {
  // Taut tidak boleh dimuat di dalam iframe situs lain (mencegah clickjacking pada tombol "Izinkan").
  if (window.top !== window.self) {
    window.__tautFramed = true;
    document.documentElement.style.display = 'none';
    try { window.top.location.replace(window.location.href); } catch (e) { /* diblokir: tetap tersembunyi */ }
    return;
  }
  try {
    var s = JSON.parse(localStorage.getItem('taut.settings') || '{}');
    var t = s.theme === 'light' || s.theme === 'dark' ? s.theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
