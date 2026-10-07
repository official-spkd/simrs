# ADR-0093 · Resume medis, gerbang tutup kunjungan, dan surat keterangan kematian

Tanggal: 7 Oktober 2026 · Status: diterapkan pada potongan 3.6 (K13, EP 5c) · Keputusan pemilik produk K-1 (7 Okt 2026).

## Konteks

Rencana fase 3 §3.6 meminta resume yang dihimpun dari sumber (tiap bagian membawa ref), rekonsiliasi obat yang
dikonfirmasi DPJP, finalisasi `clinical.sign` dengan 12 butir server → PDF + TTE → terkunci, resume RJ ringkas untuk
penutupan poli (task 5), dan `DischargeGate` penuh. Keputusan K-1 menetapkan disposisi meninggal: hanya dokter yang
berelasi dengan pasien, wajib jam + sebab kematian ICD-10 + surat keterangan kematian ber-TTE, admisi ditolak.
Skema `discharge_summaries` (3.0b) menyimpan versi final; kolom `document_id` tidak bisa diisi setelah insert
(append-only), sehingga kunci TTE memakai `documents.source_type/source_id` seperti entri klinis lain (ADR-0028/0029).

## Keputusan

1. **Draf ≠ rekam medis.** Draf resume = `clinical_drafts` jenis `resume` per penulis (keputusan fase 3 no. 1), hanya
   berisi isian DPJP (catatan per bagian, edukasi, instruksi, tindak lanjut, kondisi, disposisi, daftar obat pulang,
   konfirmasi rekonsiliasi). Jenis `resume` dicadangkan: API draf generik menolaknya (422), sehingga konfirmasi
   rekonsiliasi tidak bisa ditulis lewat jalur yang tidak memvalidasi.
2. **Isi = data sumber.** Bagian anamnesis (S CPPT dokter pertama), fisik (TTV pertama + terakhir, O CPPT), penunjang
   (observasi lab/imaging + kesimpulan laporan), terapi (eMAR `given` untuk rawat inap; order obat + rencana CPPT
   untuk rawat jalan), diagnosis/prosedur berkode, dan surat kontrol SELALU dihimpun ulang dari versi final terkini;
   DPJP hanya menambah "Catatan DPJP". Rawat inap ikut membaca kunjungan IGD/RJ asal (`source_encounter_id`).
   Ref sumber per bagian disimpan di `discharge_summary_sources` saat final.
3. **Rekonsiliasi.** Konfirmasi DPJP (`clinical.sign` + DPJP utama/rawat bersama/dokter kunjungan) mengikat hash daftar
   obat; mengubah daftar membatalkan konfirmasi. Wajib untuk rawat inap saja.
4. **Butir wajib.** Rawat inap 12 butir (`RESUME_CHECK_IDS`); rawat jalan ringkas 8 butir (`RESUME_RJ_CHECK_IDS`:
   identitas, anamnesis, fisik, diagnosis, prosedur, terapi, kontrol, kondisi). Kurang → 422 `RESUME_INCOMPLETE`
   berisi `missing`.
5. **Finalisasi.** Versi `discharge_summaries` lewat `ClinicalRecordService.prepare`, lalu PDF + TTE lewat
   `ClinicalSigningService.issueSigned` (kunci advisory versi). Versi ber-TTE (pending/signed) → koreksi 409
   `RECORD_LOCKED`; koreksi beralasan hanya bila TTE-nya gagal. Addendum = baris `addendum_of` dengan PDF + TTE
   sendiri. Staging SATUSEHAT `held` Composition per versi; event `discharge.signed`.
6. **Surat keterangan kematian berversi.** Tabel baru `death_certificates` mengikuti pola entri klinis berversi
   (ADR-0028: rantai versi, `app_clinical_guard`, `_current`, append-only, RLS FORCE) agar TTE-nya juga lewat
   `issueSigned`. Kode sebab kematian diperiksa `app_clinical_code_guard` (ICD-10 dari `ref`). Satu rantai per
   kunjungan (indeks parsial `death_certificates_one_per_encounter`).
7. **Siapa boleh (K-1).** Surat kematian dan disposisi `meninggal`: peran ber-`clinical.sign` DAN (tim DPJP/rawat
   bersama, dokter kunjungan, relasi akses aktif, atau akses darurat yang berlaku = dokter jaga yang punya akses).
   Selain itu 403, termasuk petugas admisi lewat `POST /adt/discharges` walau surat sudah terbit.
8. **`DischargeGate` penuh** (`FullDischargeGate`, provider `DISCHARGE_GATE` di `AdtModule`):
   - rawat inap: resume final ber-TTE (bukan gagal) dengan disposisi yang sama;
   - rawat jalan: resume RJ final ber-TTE;
   - meninggal: pelaku sesuai butir 7 + surat kematian ber-TTE;
   - rujuk: surat rujukan keluar F07 (`referrals.kind = 'rujukan-keluar'`, tidak batal);
   - IGD tanpa resume (resume IGD di luar fase 3), syarat meninggal/rujuk tetap berlaku.
9. **Tutup kunjungan dari layar klinis.** `POST /encounters/:id/close` (`clinical.write`): rawat inap/IGD diteruskan
   ke `AdtService.discharge` (dokter tidak butuh `bed.write`), rawat jalan menyelesaikan kunjungan + tiket poli
   (tiket yang belum dimulai dimulai dulu agar task 4 → 5 berurutan) + staging SATUSEHAT `held` Encounter.

## Konsekuensi

Satu tabel baru (`death_certificates`) dan satu kode galat (`RESUME_INCOMPLETE`). Surat rujukan keluar F07 tetap
dibuat modul `referral` (fase 2) tanpa PDF ber-TTE; gerbang hanya memeriksa keberadaannya. TTE gagal untuk surat
kematian/resume diulang lewat koreksi beralasan (versi baru) atau `POST /documents/:id/signatures`. Resume rawat inap
yang belum final setelah pulang tetap muncul di worklist (`resume_overdue`) sebagai jaring pengaman.

## Layar mode api (W1 Poli, W5b Resume)

- **Poli (W1).** Dua endpoint baca penyusun bentuk layar di modul `encounter`: `GET /api/v1/poli/worklist` (antrean poli
  hari ini untuk unit penugasan; lingkup `unit` = kunjungan unit itu, `relationship` = pasien berelasi) dan
  `GET /api/v1/encounters/:id/poli-visit` (bentuk `poliEncounterSchema` + bagian `api`). Penulisan tetap lewat endpoint
  domainnya (TTV, CPPT, diagnosis, draf, antrean, resume, tutup kunjungan).
- **Komponen sama, aksi disuntikkan.** `PoliOps` (`components/klinis/poli-ops.ts`) memisahkan aksi dari tampilan:
  `useDemoPoliOps` (toko demo, perilaku presentasi tidak berubah) dan ops api di `api-poli-client.tsx`.
- **"Tanda tangani dan selesai"** = CPPT final + diagnosis + resume rawat jalan ringkas ber-TTE + tutup kunjungan
  (task 5). Langkah yang sudah selesai dilewati saat diulang. Co-sign DPJP atas CPPT residen menjalankan langkah yang
  sama.
- **Kontrak demo dilonggarkan dua hal** (tanpa memecah data demo): `klinisPatientSchema.sex` menerima `-` (tidak
  diketahui) dan `birthDate` boleh null; `PatientBanner` menerima `-`.
- **Resume (W5b)** memakai `ResumeSections` yang sama; cetak PDF lewat Route Handler BFF yang meneruskan
  `GET /api/v1/documents/:id/content`.
