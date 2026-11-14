# Taut — Kit Kerja Lintas Perangkat

Taut menghubungkan **iPad, Windows, Mac, dan HP** dalam satu alur kerja — langsung dari browser, tanpa kabel, tanpa instal driver.

**Buka aplikasinya:** https://tjktskamuda.github.io/taut/

## Fitur

| Fitur | Keterangan |
|---|---|
| **Transfer Bebas** | Kirim foto, video, dokumen, sampai satu folder utuh. Seret & lepas, tempel gambar, atau ketik pesan/tautan. Berkas dikirim langsung antar perangkat (tanpa batas ukuran dari server). |
| **Papan Klip Super** | Salin di satu perangkat, tempel di perangkat lain — teks dan gambar. Tekan `Ctrl/⌘ + V` di Taut untuk langsung mengirim. Sinkron otomatis di Chrome/Edge. |
| **Pencerminan Layar** | Tampilkan layar Windows/Mac di iPad, HP, atau komputer lain. iPad bisa *meminta* layar komputer. |
| **Kamera Bersama** | Pakai kamera iPad/HP sebagai kamera untuk komputer. Ganti kamera depan/belakang dari jauh dan ambil foto langsung dari jendela tampilan. |
| **Catatan** | Catatan yang tersinkron otomatis ke semua perangkat terhubung. |
| **Akses Berkas** | Bagikan berkas/folder dari satu perangkat, lalu jelajahi dan ambil dari perangkat lain (filter Foto, Video, Audio, Dokumen). |
| **Lanjutkan di Perangkat Lain** | Kirim tautan atau teks dan buka langsung di perangkat lain. |
| **Cari Perangkat** | Bunyikan perangkat yang terhubung. |

Plus: perangkat tepercaya tersambung otomatis, status baterai & kualitas jaringan, simpan otomatis ke folder (Chrome/Edge), tema terang/gelap, dan bisa dipasang sebagai aplikasi (PWA).

## Cara menghubungkan

1. Buka **https://tjktskamuda.github.io/taut/** di kedua perangkat.
2. Di satu perangkat, ketuk **Hubungkan** → pindai kode QR perangkat lain, atau ketik kode 6 angkanya.
3. Ketuk **Izinkan** di perangkat yang dituju. Berikutnya keduanya tersambung otomatis.

> Paling cepat dan stabil bila kedua perangkat memakai **Wi-Fi yang sama**. Jaringan yang memblokir komunikasi antarperangkat (mis. Wi-Fi tamu/isolasi klien) bisa menghalangi sambungan — coba hotspot HP.

## Pasang sebagai aplikasi

- **iPad / iPhone:** buka di Safari → ikon **Bagikan** → **Tambahkan ke Layar Utama**.
- **Windows / Mac (Chrome atau Edge):** klik ikon **Pasang** di ujung kanan bilah alamat.
- **Mac (Safari):** menu **File → Tambahkan ke Dock**.

## Batasan browser

- iPad/iPhone/Android **tidak bisa membagikan layarnya** dari browser (batasan sistem). Mereka tetap bisa *menampilkan* layar dari Windows/Mac.
- Mengendalikan mouse/keyboard komputer dari perangkat lain tidak dimungkinkan dari browser.
- Di Safari, menyalin otomatis ke papan klip butuh satu ketukan (**Salin**) karena aturan keamanan Apple.

## Keamanan

- **Izin eksplisit.** Perangkat baru hanya bisa terhubung setelah Anda menekan **Izinkan**. Tautan/QR hanya mengisi kode; Anda tetap harus menekan **Hubungkan**.
- **Verifikasi tanpa mengirim rahasia.** Saat dipasangkan, kedua perangkat menyimpan kunci rahasia 256-bit (sebagai kunci yang tidak bisa diekspor). Pada sambungan berikutnya, perangkat membuktikan kepemilikan kunci dengan HMAC yang terikat pada sidik jari sertifikat DTLS sambungan itu — kunci tidak pernah dikirim ulang, sehingga perangkat palsu yang mengambil alih kode tidak mendapat apa pun.
- **Angka verifikasi** 4 digit muncul di kedua layar saat pemasangan; jika berbeda, ketuk **Lupakan**.
- **Semua data dari perangkat lain divalidasi**: nama, ID, ukuran, tipe berkas, jalur folder, catatan, dan media. Berkas HTML/SVG tidak pernah dijalankan; berkas yang melebihi ukuran yang diumumkan ditolak.
- **Layar & kamera** dari perangkat lain hanya tampil bila Anda memintanya atau mengizinkannya.
- **Content-Security-Policy** ketat dan perlindungan dari pembingkaian (clickjacking).
- Batasan: semua aplikasi di `tjktskamuda.github.io` berbagi satu origin browser, jadi aplikasi lain di alamat itu secara teknis bisa membaca data Taut di browser yang sama (kecuali kunci, yang tidak bisa diekspor). Untuk isolasi penuh, pasang Taut di domain/akun GitHub tersendiri.

## Teknis

- HTML/CSS/JavaScript murni (tanpa build), PWA dengan service worker.
- Data dikirim **peer-to-peer lewat WebRTC** (terenkripsi DTLS). Server sinyal publik PeerJS hanya dipakai untuk mempertemukan perangkat; isi berkas tidak melewati server.
- Pustaka: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) untuk memindai QR, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) untuk membuat QR.

Taut adalah proyek independen untuk pembelajaran di SMKN 1 Murung Pudak dan tidak berafiliasi dengan merek perangkat mana pun.
