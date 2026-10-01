/* ============================================================
 * CafeBar — Konfigurasi Firebase Realtime Database
 * ------------------------------------------------------------
 * CARA AKTIFKAN (5 menit, gratis):
 * 1. Buka https://console.firebase.google.com → Add project
 *    misal: "cafe-order-app" (tanpa Analytics juga boleh).
 * 2. Build → Realtime Database → Create Database → Lokasi
 *    (asia-southeast1) → Start in TEST mode (baca/tulis true
 *    30 hari, nanti perketat rules).
 * 3. Project Settings (ikon gear) → Your apps → Web </> →
 *    Register app → copy config di bawah ke sini.
 * 4. Upload file ini + db.js ke hosting yang sama (GitHub Pages /
 *    InfinityFree / XAMPP). Semua halaman otomatis sinkron.
 *
 * CATATAN: tanpa config valid, aplikasi tetap jalan dengan
 * mode LOKAL (localStorage + BroadcastChannel, antar-tab
 * satu browser). Dengan config valid → REALTIME antar perangkat.
 * ============================================================ */

const FIREBASE_CONFIG = {
  apiKey: "GANTI_DENGAN_API_KEY",
  authDomain: "GANTI.firebaseapp.com",
  databaseURL: "https://GANTI-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "GANTI",
  appId: "GANTI"
};

/* Rules Realtime Database untuk testing (ganti setelah produksi):
{
  "rules": {
    "cafe": {
      ".read": true,
      ".write": true
    }
  }
}
*/
