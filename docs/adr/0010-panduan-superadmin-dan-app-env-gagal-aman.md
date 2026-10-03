# ADR-0010 · Panduan sistem di area superadmin dan APP_ENV gagal aman

Status: diterima · 3 Okt 2026

## Konteks

- Pemilik produk meminta satu fitur di area superadmin yang menjelaskan cara sistem bekerja, cara kode bekerja, dan tutorialnya, ditampilkan sebagai halaman di aplikasi. Isinya sekaligus menjadi README bagi pengembang berikutnya.
- Dokumen proyek belum mengenal peran lintas tenant untuk operator platform. Login (P02) dan otorisasi (P03) baru dibangun di fase 1.
- Fitur pengembangan (Swagger, endpoint `/dev`, tenant dari header) harus mati di produksi, dan keputusan itu tidak boleh bergantung pada orang yang ingat menyetel variabel.

## Keputusan

1. **Satu sumber konten.** Panduan ditulis sebagai Markdown di `docs/panduan/` dan dirender oleh web di `/superadmin/panduan/<slug>`. Isi di aplikasi selalu sama dengan isi di repo. Tautan antar-berkas relatif (`./02-….md`) bekerja di GitHub dan di aplikasi.
2. **Rendering aman.** `react-markdown` + `remark-gfm` (dependensi kecil, hanya di komponen server, tanpa JavaScript tambahan di browser). HTML mentah tidak dirender dan skema URL berbahaya disaring. Berkas dipilih dari daftar tetap `GUIDE_PAGES`; slug URL tidak pernah menjadi path.
3. **Peran baru `superadmin_platform`** (diimplementasikan di fase 1): operator platform lintas tenant, tanpa akses data pasien secara default. Area `/superadmin/*` akan memeriksa sesi + peran ini.
4. **Sampai fase 1**, area superadmin (panduan + `/dev/ui`) hanya terbuka bila `APP_ENV` eksplisit `local` atau `staging`; selain itu 404 dan menu tidak tampil. Keputusan dibuat di server per permintaan, bukan saat build.
5. **`APP_ENV` gagal aman.** Nilai yang tidak disetel, kosong, atau tidak dikenal dianggap `production`. Helper tunggal `devToolsAllowed()` di `@simrs/shared` dipakai API dan web. Di produksi: Swagger tidak ada, modul `/dev` tidak didaftarkan (rute 404), tenant dari header ditolak `401`.
6. **HSTS di web selalu dikirim**, karena header Next dibakukan saat build. Browser mengabaikan HSTS lewat HTTP biasa, jadi aman untuk lokal.

## Konsekuensi

+ Pengembang baru punya satu tempat untuk memahami sistem, dan dokumentasi tidak bisa tertinggal dari panduan di aplikasi.
+ Lupa menyetel env tidak membuka fitur pengembangan di produksi.
− Area superadmin belum bisa dipakai di produksi sampai P02/P03 selesai.
− Tambahan dependensi `react-markdown`/`remark-gfm` di web (server-only).
