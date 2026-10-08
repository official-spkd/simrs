# ADR-0106 · 4.9b: reaksi transfusi sebagai nilai kritis, pembatalan + pemusnahan darah, puasa/MST/verifikasi diet

Status: diterapkan pada potongan 4.9b (fase 4, S07 + S08) · 8 Oktober 2026

## Konteks

Potongan 4.9 (ADR-0105) menyisakan lima celah:

- reaksi transfusi belum dikabarkan ke siapa pun;
- permintaan darah tidak bisa dibatalkan;
- kantong kedaluwarsa atau rusak tidak bisa dimusnahkan;
- mode api Gizi belum setara dengan demo, yang punya puasa (NPO), skrining MST, dan verifikasi order oleh ahli gizi.

Orkestrator meminta keempatnya, dan meminta reaksi berat masuk alur nilai kritis S09 (`CriticalResultsService.raise()`
dari 4.1a).

## Keputusan

1. **Notifikasi reaksi transfusi.** Dugaan reaksi (dari TTV) dan laporan reaksi mengirim notifikasi P09 ke dua
   kelompok:
   - DPJP + tim perawatan aktif kunjungan;
   - petugas bank darah, yaitu pemegang `blood_bank.issue` dengan penugasan aktif (maks. 50).

   Pelapor tidak ikut menerima. Notifikasi dikirim in-app + WhatsApp lewat outbox di transaksi penulis. Judul dan isi
   **tanpa PHI** (tingkat reaksi + nama unit); rincian hanya di layar Bank darah lewat tautan
   `/penunjang/bank-darah?kunjungan=`.
2. **Reaksi berat = nilai kritis.** `critical_results` mendapat sumber `transfusion` dan kolom
   `transfusion_reaction_id` (CHECK satu sumber per baris; indeks unik satu nilai kritis per laporan reaksi). Unit
   nilai kritis = unit kunjungan. Penutupan tetap hanya lewat laporan ber-read-back (ADR-0037). Event
   `critical_result.raised` menerima `source: 'transfusion'` (`CRITICAL_SOURCES` diperluas).
3. **Pembatalan permintaan darah** (`POST /blood/requests/:id/cancel`, izin layar `blood_bank.read`):
   - hanya DPJP peminta (`request`) atau bank darah (`crossmatch`) yang boleh membatalkan (diperiksa matriks di
     service);
   - alasan ≥ 10 karakter, tercatat beserta pelaku dan waktu server;
   - hanya dari `diminta`/`diproses` (trigger `BLOOD_REQUEST_CLOSED`);
   - kantong yang dicadangkan dan belum keluar kembali `tersedia`;
   - cek ganda yang belum dipakai tidak lagi bisa mengeluarkan kantong (trigger cek ganda diperbarui).
4. **Pemusnahan kantong dua petugas** (`blood_unit_disposals`, pola sesi masing-masing seperti ADR-0105):
   - petugas pertama mengajukan kategori `kedaluwarsa` (hanya bila ED sudah lewat) atau `rusak`, dengan alasan ≥ 10
     karakter;
   - petugas KEDUA mengonfirmasi, dan trigger mengubah kantong menjadi `dimusnahkan` di transaksi yang sama;
   - satu pengajuan per kantong, tanpa DELETE, semua langkah diaudit;
   - kantong yang sedang diajukan tidak bisa keluar.
5. **Gizi setara demo:**
   - **Puasa** (`diet_npo_orders`): satu aktif per kunjungan, alasan ≥ 10 karakter, rencana selesai opsional, dicabut
     sekali.
   - **Skrining MST** (`nutrition_screenings`, append-only): skor dihitung server dan diperiksa ulang CHECK database.
     Skor ≥ 2 = berisiko.
   - **Verifikasi order diet**: izin baru `nutrition.verify`, hanya untuk `ahli_gizi`. Verifikasi butuh skrining MST
     kunjungan itu (`NUTRITION_SCREENING_REQUIRED`) dan hanya sekali (`DIET_VERIFIED`).
   - **Gerbang antar** (trigger `meal_services`): makanan hanya diantar untuk order aktif yang terverifikasi
     (`DIET_NOT_VERIFIED`) dan tanpa puasa aktif (`NPO_ACTIVE`). Tidak ada override.

   Ganti menu karena alergen (demo) belum ada, karena skema belum punya menu/bahan. Alergi tetap tampil di daftar dan
   label.

## Konsekuensi

- Migrasi `20261008800000_support_49b`: tiga tabel baru (RLS FORCE + `tenant_isolation`, tanpa DELETE, hanya kolom
  konfirmasi/cabut yang bisa di-UPDATE) dan kolom baru di `critical_results`, `blood_requests`, `diet_orders`. Tidak ada
  fungsi SECURITY DEFINER baru.
- Order diet lama (4.9) yang belum diverifikasi tidak bisa diantar sampai diverifikasi ahli gizi.
- RS yang sudah berjalan perlu `pnpm db:sync-permissions --reconcile` untuk `nutrition.verify`.
- Layar Pusat hasil kritis (4.3) perlu label untuk sumber `transfusion`.
