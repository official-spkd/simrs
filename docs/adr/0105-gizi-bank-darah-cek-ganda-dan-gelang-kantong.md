# ADR-0105 · Gizi + Bank darah: cek ganda dua petugas, gelang ↔ kantong, aturan ABO per komponen, tampilan layanan

Status: diterapkan pada potongan 4.9 (fase 4, S07 + S08) · 7 Oktober 2026

## Konteks

Rencana fase 4 §4.9 meminta order diet, daftar makan per ruang × jam makan + label, sisa makanan (S07), serta
permintaan darah, crossmatch, pengeluaran kantong yang aman, reaksi transfusi, dan event `blood.unit_issued` (S08).
Skema 4.0b sudah menegakkan ABO/Rh, crossmatch, ED, dan jalur darurat golongan O di trigger `blood_issues`
(ADR-0037). Orkestrator menambahkan dua gerbang wajib: **gelang ↔ kantong** dan **petugas kedua**. Layar Gizi dan
Bank darah sudah ada di mode presentasi (4.0c), jadi keputusan no. 1 ("tanpa layar") digantikan layar hibrida.

Empat hal belum diatur:

1. Skema 4.0b tidak menyimpan petugas kedua maupun verifikasi di samping pasien.
2. Fungsi `app_blood_abo_compatible` 4.0b memakai aturan sel darah merah untuk semua komponen. Akibatnya plasma
   (FFP) golongan O lolos ke pasien A/B/AB, padahal antibodi anti-A/anti-B di plasma O menyerang sel pasien.
3. Lingkup `unit` penunjang (ADR-0034) = "order yang ditujukan ke unit penugasan", tetapi `blood_requests` dan
   `diet_orders` tidak punya kolom unit pelaksana. Bagi ahli gizi, penugasannya bahkan tanpa unit.
4. Siapa yang memasang transfusi dan mengorder diet. Matriks 4.0a hanya memberi `blood_bank` ke analis lab, dan gizi ke
   perawat dengan lingkup relasi.

## Keputusan

1. **Cek ganda dua petugas sebelum kantong keluar** (pola keputusan fase 4 no. 12, apoteker kedua dari sesinya
   sendiri). Petugas pertama menyimpan `blood_issue_checks`: lima butir wajib semuanya `true` (CHECK) dan alasan darurat
   bila ada. Petugas kedua mengeluarkan kantong dari sesinya sendiri: `blood_issues.issue_check_id` wajib untuk baris
   baru (CHECK `NOT VALID`, baris lama 4.0b tidak divalidasi ulang). Trigger `app_blood_issue_double_check` menegakkan
   empat hal: cek ada, kantong/permintaan/alasan darurat sama, umur ≤ 30 menit (`BLOOD_DOUBLE_CHECK_REQUIRED`), dan
   pengeluar ≠ pemeriksa pertama (`BLOOD_SECOND_CHECKER_SAME`). Satu cek dipakai satu kali (indeks unik).
2. **Transfusi di samping pasien: gelang ↔ kantong + petugas kedua** (tabel `transfusions`). Pemasang memindai gelang
   memakai tabel pindaian gelang fase 3 (`wristband_scans`). Gelang harus cocok dengan gelang aktif kunjungan
   permintaan, dan nomor kantong yang dipindai harus sama dengan kantong yang dikeluarkan. Salah pasien
   (`BLOOD_WRONG_PATIENT`) atau salah kantong (`BLOOD_WRONG_BAG`) ditolak 422 tanpa override, dan penolakan tetap
   tercatat di audit walau transaksi batal (`AuditedDenial`). Status awal `menunggu_verifikasi`. Transfusi baru
   `berjalan` setelah petugas LAIN memindai ulang gelang + kantong dari sesinya sendiri. Trigger `app_transfusion_guard`
   memeriksa pindaian (cocok, kunjungan sama, milik pelaku, gelang belum batal, ≤ `emar.scan_valid_minutes`),
   kesamaan kantong, transisi status yang sah, dan tidak ada DELETE. Gelang tidak terbaca = cetak ulang gelang beralasan
   (ADR-0096), bukan verifikasi manual. Verifikasi manual dua petugas di mode presentasi tidak dibawa ke mode api.
3. **TTV transfusi append-only** (`transfusion_vitals`, waktu server). TTV awal dicatat saat pemasangan. Dugaan reaksi
   (`transfusionReactionCheck` di `@simrs/shared`: gejala apa pun, suhu naik ≥ 1 °C, atau sistolik turun ≥ 30 mmHg)
   menghentikan transfusi di transaksi yang sama dengan alasan tercatat. Laporan reaksi masuk `transfusion_reactions`
   dan ikut menghentikan transfusi yang masih berjalan. Selesai tanpa reaksi wajib ada TTV 15 menit.
4. **Aturan ABO per komponen** (`blood_components.abo_rule`):
   - `sel_darah_merah` (PRC): antigen donor ⊆ antigen pasien;
   - `plasma` (FFP, TC): AB donor universal, plasma O hanya untuk pasien O;
   - `identik` (WB): golongan sama.

   Rh-negatif pasien hanya menerima Rh-negatif untuk semua komponen (konservatif). Komponen non-sel-darah-merah wajib
   golongan pasien diketahui. Jalur darurat tanpa crossmatch (keputusan no. 22) hanya untuk sel darah merah golongan O.
   Kantong yang dicadangkan untuk permintaan lain tidak keluar (`BLOOD_UNIT_UNAVAILABLE`). Fungsi 4.0b diganti
   `CREATE OR REPLACE`. `aboCompatible`/`bloodIssueBlock` di `@simrs/shared` menerima `rule` dengan bawaan sel darah
   merah, jadi kompatibel dengan pemanggil lama.
5. **Golongan pasien di permintaan** boleh diisi bank darah (`PUT /blood/requests/:id/group`, hak kolom
   `patient_abo/patient_rh`), lalu terkunci setelah crossmatch, cek ganda, atau pengeluaran pertama (trigger
   `BLOOD_GROUP_LOCKED`).
6. **Tampilan layanan vs ruangan** (`supportScope`, `apps/api/src/infra/clinical/support-access.ts`):
   - **layanan**: lingkup `all`, atau lingkup `unit` dengan penugasan di unit non-perawatan (penunjang, instalasi,
     farmasi, administrasi) atau tanpa unit. Melihat semua permintaan darah/order diet aktif + 7 hari (keputusan no. 3),
     karena semuanya ditujukan ke bank darah/instalasi gizi. Satu order di luar jendela itu → 404.
   - **ruangan**: klinisi (lingkup `relationship`, atau `unit` di unit perawatan: poli, IGD, rawat inap, OK) hanya
     melihat pasien yang boleh dibukanya. Daftar disaring ABAC fase 3 di SQL sebelum batas baris (`patientAccessSql`);
     satu pasien dibuka lewat `PatientAccessService.assert` (403 diaudit).

   Tidak menambah kolom unit pelaksana.
7. **Izin** (`packages/shared/src/authz.ts`): `blood_bank` mendapat aksi `request` dan `transfuse`.
   - Perawat/bidan: `nutrition.read/write` naik dari `relationship` ke `unit` (mengikuti `clinical.write`, seperti
     keputusan orkestrator untuk `forms.response`), ditambah `blood_bank.read/transfuse` `unit`.
   - Dokter: `nutrition.read/write`, `blood_bank.read/request/transfuse` `relationship`.
   - Analis lab tetap read/crossmatch/issue `unit` (tampilan layanan), tanpa `request`/`transfuse`.

   Rekonsiliasi izin RS yang sudah berjalan memakai `pnpm db:sync-permissions --reconcile`.
8. **S07**: satu order diet aktif per kunjungan (indeks unik parsial `diet_orders_one_active`). Order baru menutup yang
   lama di transaksi yang sama. Order hanya untuk kunjungan rawat inap/IGD yang sedang berjalan. Daftar makan per
   tanggal × jam makan × bangsal menampilkan dua pengenal (nama + No. RM), bed, diet + tekstur, catatan dapur, dan
   alergi tercatat. Layanan makan + sisa makanan append-only; baris terbaru per order × jam makan × tanggal berlaku.
   Cetak HTML daftar + label 70 × 35 mm di `/cetak/gizi`, di luar kerangka staf. Asuhan gizi tetap lewat formulir P07
   (layar Asesmen).

## Konsekuensi

- Migrasi `20261008500000_blood_bank_safety`: tabel `blood_issue_checks`, `transfusions`, `transfusion_vitals` (RLS
  FORCE + `tenant_isolation`, tanpa DELETE, hanya kolom verifikasi/penutupan transfusi yang bisa di-UPDATE). Tiga
  fungsi trigger baru berjalan `SECURITY INVOKER`, sehingga tidak ada fungsi SECURITY DEFINER baru.
- Pengeluaran darah dan verifikasi transfusi menuntut dua sesi/perangkat. Petugas kedua di perangkat yang sama perlu
  keluar-masuk akun; step-up di perangkat yang sama belum dibuat (sama dengan ADR-0096).
- `blood_issues` 4.0b yang dibuat tanpa cek ganda (hanya data uji) tetap sah. Baris baru wajib cek ganda.
- Notifikasi reaksi transfusi ke DPJP/bank darah dan event untuk SATUSEHAT/charge capture di luar potongan ini.
  `blood.unit_issued` sudah terbit.
- Pemusnahan kantong kedaluwarsa (status `dimusnahkan`) dan pembatalan permintaan belum punya endpoint. Kantong lewat
  ED ditandai `expired` di jawaban API dan tidak bisa keluar.
- Puasa (NPO), skrining MST, dan verifikasi order diet di mode presentasi belum punya skema (bukan bagian §4.9).
