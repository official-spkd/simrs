---
description: Bangun satu layar web dari mockup design/mockups/<Nama>.dc.html
argument-hint: <NamaLayar, mis. Ranap>
---
Bangun layar **$ARGUMENTS**.

1. Baca `design/mockups/$ARGUMENTS.dc.html` seluruhnya: markup (tata letak, teks, gaya) dan blok `<script type="text/x-dc">` (state awal, data contoh, handler, aturan gerbang).
2. Cari rute dan kode komponen di `docs/08-desain-ui.md`. Pastikan endpoint API yang dibutuhkan sudah ada; bila belum, buat dulu dengan tes.
3. Implementasikan sebagai halaman Next.js + komponen `packages/ui` dan token desain. Jangan menyalin runtime mockup; data contoh pindah ke seed/fixture.
4. Pertahankan semua interaksi dan gerbang keselamatan yang ada di mockup. Teks UI Bahasa Indonesia, aksesibel (elemen asli, label, kontras, target sentuh).
5. Tambahkan tes komponen untuk logika penting dan satu tes Playwright untuk alur utama layar.
6. Laporkan perbedaan yang sengaja diambil dari mockup dan alasannya.
