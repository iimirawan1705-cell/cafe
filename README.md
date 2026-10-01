# cafe

Aplikasi orderan cafe — pelanggan scan QR/barcode di meja, langsung buka menu dan pesan. Admin, dapur, dan history update realtime.

## Halaman

- `index.html` — generator barcode/QR per meja
- `menu.html?meja=1` — menu pelanggan
- `admin.html` — kelola order + menu
- `kitchen.html` — tampilan dapur
- `scanner.html` — scan barcode meja
- `history.html` — pesanan selesai
- `barcode-permeja.html?meja=1` — kartu 1 meja siap cetak

## Realtime

Tanpa config Firebase: mode lokal (`localStorage` + `BroadcastChannel`).
Untuk sinkron antar-HP/PC: isi `firebase-config.js` dari Firebase Console
(Realtime Database), semua halaman (`db.js`) otomatis mirror 2 arah.

## Jalankan lokal (XAMPP)

Apache port 80 aktif, buka `http://localhost/app%20menu%20orderan%20di%20cafe/index.html`.

## Live (GitHub Pages)

Aktifkan Settings → Pages → `main` / `/(root)`:
`https://iimirawan1705-cell.github.io/cafe/index.html`
