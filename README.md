# MotorWatch PWA — Dashboard Monitoring Motor

Dashboard web statis untuk ESP32-C3 → Firebase Realtime Database → GitHub Pages.

## Fitur
- Grafik Roll dan Pitch real-time dengan rentang 1, 5, dan 15 menit.
- Sudut Complementary Filter, kecepatan GPS, status GPS dan buzzer.
- Peta OpenStreetMap, koordinat, tautan Google Maps, dan reverse geocoding.
- Data IMU ringkas, status kesegaran data, dan counter.
- PWA manifest, service worker, dan tombol instalasi.
- Login Firebase Authentication Email/Password tanpa menanam password ke file publik.

## 1. Siapkan konfigurasi Firebase Web
1. Buka Firebase Console → Project settings → General.
2. Pada bagian Your apps, buat atau pilih aplikasi Web (`</>`).
3. Salin konfigurasi Web App (`apiKey`, `authDomain`, `projectId`, `appId`) ke objek `firebaseConfig` di `script.js`.
4. Pertahankan `databaseURL` yang sudah benar:
   `https://monitoring--kendaraan-default-rtdb.asia-southeast1.firebasedatabase.app`
5. Firebase Console → Authentication → Sign-in method → aktifkan Email/Password.
6. Authentication → Settings → Authorized domains: tambahkan domain GitHub Pages kamu, misalnya `username.github.io`.
7. Gunakan akun Firebase Authentication yang memang diizinkan membaca `/monitoring_motor/latest`.

> Jangan menaruh password di source code. File website publik boleh memuat konfigurasi Firebase Web, tetapi akses database tetap harus dilindungi Firebase Security Rules.

## 2. Struktur data
Website membaca node `/monitoring_motor/latest`, terutama field:
- `roll`: derajat hasil Complementary Filter
- `pitch`: derajat hasil Complementary Filter
- `speed` (juga menerima alias `speedKmph` atau `speedKmh`): km/h
- `latitude`, `longitude`, `gpsStatus`, `buzzer`, `counter`
- `ax`, `ay`, `az`, `gx`, `gy`, `gz` (opsional)

Jika nama field kecepatan berbeda, ubah hanya baris pembacaan `data.speed ?? data.speedKmph ?? data.speedKmh` di `script.js`.

## 3. Jalankan lokal
PWA/service worker membutuhkan HTTP/HTTPS, jangan buka `index.html` langsung sebagai `file://`.
- Bisa memakai ekstensi Live Server di VS Code.
- Atau jalankan server statis lokal dari folder ini.

## 4. Deploy GitHub Pages
1. Buat repository GitHub, misalnya `monitoring-motor`.
2. Unggah seluruh isi folder ini ke root repository (jangan unggah folder zip-nya saja).
3. GitHub → Settings → Pages → Deploy from a branch → `main` / `root`.
4. Tunggu URL Pages aktif, lalu masukkan domain `username.github.io` ke Authorized domains Firebase.
5. Buka website dan login menggunakan akun Firebase Authentication.

## 5. Instalasi ke HP
- Android/Chrome: buka URL HTTPS → tombol `Install App` atau menu browser → Install app / Tambahkan ke layar utama.
- iPhone/iPad: buka URL di Safari → Share → Add to Home Screen.
- Label menu dapat berbeda sesuai browser/versi OS.

## Catatan teknis
- Grafik menyimpan riwayat sementara di memori browser selama halaman aktif, maksimal 15 menit; data hilang saat halaman dimuat ulang. Firebase hanya digunakan sebagai jembatan data terbaru, bukan penyimpanan histori.
- Reverse geocoding menggunakan layanan publik Nominatim/OpenStreetMap. Permintaan dibatasi di sisi klien agar tidak meminta alamat pada setiap update sensor; layanan publik memiliki batas penggunaan dan tidak menjamin nama administrasi selalu tersedia.
- Service worker menyimpan kerangka website agar halaman dasar bisa dibuka kembali; data sensor dan peta tetap memerlukan koneksi internet.
- Jangan membuat Firebase Rules terbuka untuk semua pengguna (`.read: true`) hanya demi memudahkan website.
