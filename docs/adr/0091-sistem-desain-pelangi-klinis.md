# ADR-0091 · Sistem desain Pelangi Klinis menggantikan Klinis Bersih

Status: diterima · 6 Okt 2026 · Komponen lintas lapisan (`packages/ui`, `apps/web`)

## Konteks

Pemilik produk meninjau ulang tampilan dan meminta desain yang tetap fungsional tetapi lebih modern, berwarna, dengan gradien dan animasi. Eksplorasi berjalan di kanvas https://claude.ai/artifact/SkzcCc4jNGv48usyiFF1p8:
- fondasi F1–F5: palet, tipografi, komponen, gerak, aturan;
- 44 layar C01–C44.

Arahan pemilik:
- font Poppins;
- jendela ala desktop (P1) digabung dengan palet perintah ⌘K (P2);
- warna tidak hanya hijau;
- gradien hanya satu rona gelap → terang, tidak lintas rona seperti merah → biru.

Pemilik lalu meminta desain itu diterapkan ke aplikasi dan menyetujui penggantian standar resmi. Akibatnya CLAUDE.md §6 dan `docs/08-desain-ui.md` diperbarui.

## Keputusan

1. **Rona.** Ada delapan ramp 50–900:
   - samudra (biru): aksi utama dan front office;
   - zamrud: klinis;
   - anggrek: penunjang;
   - toska: keuangan;
   - bougenvil: manajemen dan back office;
   - batu: netral dan sistem;
   - kunyit: hanya status peringatan;
   - koral: hanya status kritis.

   Semuanya tersedia sebagai kelas Tailwind (`bg-zamrud-100`, `text-koral-800`, …).
2. **Aksen domain.**
   - Kelas `brand-*` adalah aksen domain. Bawaannya samudra.
   - `AppShell` memasang `data-domain` dari grup menu aktif (`navContext` di `lib/nav.ts`), dan `theme.css` menukar seluruh ramp `brand-*` di subtree itu. Kode layar lama yang memakai `brand-*` otomatis berwarna domain, tanpa diubah per layar.
   - Hex teal Klinis Bersih di `apps/web` diganti `var(--color-brand-*)` atau kelas token.
3. **Status tidak ikut domain.**
   - `danger`/`warning`/`success`/`info` dipetakan ke koral/kunyit/zamrud/samudra dan tetap sama di semua domain.
   - Warna status tidak dipakai sebagai hiasan, dan status selalu disertai teks.
   - Triase IGD tetap lima warna baku.
4. **Gradien satu rona.**
   - Tombol utama, item menu aktif, dan garis domain memakai 800 → 600 rona yang sama.
   - Kotak peringatan dan KPI memakai 50 → 100.
   - Gradien merek (logo) selalu samudra (`bg-fajar`).
   - Tidak ada gradien lintas rona.
5. **Tipografi.** Poppins 400–700 (`next/font`, variabel `--font-poppins`) untuk seluruh teks, dengan angka tabular. IBM Plex Mono tetap hanya untuk pengenal (RM, ICD, SEP, kode barang) agar verifikasi per karakter mudah. PDF klinis tetap IBM Plex (ADR-0029).
6. **Kerangka.**
   - Jendela kaca dengan radius 20 dan garis domain 3 px. Mulai 1024 px jendela melayang di atas latar radial samudra.
   - Sidebar kaca 236 px: titik rona per grup, item aktif bergradien rona grupnya.
   - Bila menu lebih dari 24 layar (mis. Superadmin demo), grup lain dilipat menjadi "N layar" dan grup layar aktif tetap terbuka. Grup dengan dua menu atau kurang tidak dilipat. Semua tautan tetap di DOM.
   - Header kaca berisi label domain dan pemicu palet perintah.
7. **Palet perintah ⌘K / Ctrl K** (`CommandPalette`).
   - Pola combobox + listbox dengan `aria-activedescendant`.
   - Isinya layar yang sama dengan menu sesi (izin sudah disaring server).
   - Overlay dipasang lewat portal ke `body`, sebab header kaca menjadi containing block bagi `position: fixed`.
8. **Gerak.**
   - Jendela muncul (`win-in`), isi halaman naik bertahap (`stagger-rise`), palet muncul dari atas (`pal-in`), dan KPI berkilau sekali (`shine-once`).
   - Denyut dipakai hanya untuk status kritis (`animate-crit`).
   - `prefers-reduced-motion` mematikan animasi. `prefers-reduced-transparency` mengganti kaca dengan permukaan padat.
9. **Mockup acuan.** Tata letak dan alur tetap mengikuti `design/mockups/*.dc.html` (read-only). Gaya visual mengikuti Pelangi Klinis (kanvas di atas dan `docs/08-desain-ui.md`). Penyelarasan tata letak isi per layar dengan papan C01–C44 dikerjakan bertahap per domain.

## Konsekuensi

- Tidak ada dependensi baru. `react-dom` menjadi peer dependency `@simrs/ui` untuk portal; aplikasi sudah memakainya.
- Kontras: teks pada 600–900 dan latar 50–100 lolos ≥ 4,5:1, dan `ink-400` (#65728A) ≥ 4,5:1 di atas putih. Menu redup (`opacity-55`) tetap disertai keterangan "layar belum tersedia".
- Tangkapan layar panduan (`docs/panduan/gambar/`) perlu dibuat ulang lewat Playwright (CD-5).
- Hex sisa di luar daftar pemetaan (warna kecil per komponen) dirapikan saat penyelarasan per domain.
