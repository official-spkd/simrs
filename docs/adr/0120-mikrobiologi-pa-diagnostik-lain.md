# ADR-0120 · Mikrobiologi bertahap, patologi anatomi, dan diagnostik lain (S02, S10)

Status: diterapkan pada potongan 4.8 (fase 4) · 8 Oktober 2026

## Konteks

Rencana fase 4 §4.8 meminta beberapa hal.

S02 Mikrobiologi:

- kultur: inkubasi → laporan awal → laporan akhir;
- isolat dari daftar organisme lokal, uji kepekaan S/I/R + MIC;
- validasi seperti lab;
- antibiogram sebagai sumber PPRA.

S02 Patologi anatomi:

- makroskopik/mikroskopik/diagnosis + gambar (P08) + TTE.

S10 Diagnostik lain:

- EKG/USG/echo/endoskopi/treadmill = order F3-1 + isian P07 + lampiran P08 + TTE → `diagnostic.report_signed`.

Skema 4.0b sudah punya `micro_isolates`, `micro_susceptibilities`, `pa_reports` (berversi), dan `diagnostic_reports`
fase 3. Belum ada laporan bertahap mikrobiologi, tautan PA ke spesimen kamar operasi (4.7b), maupun penanda S10 di
`diagnostic_reports`. Unit pelaksana (Lab, PA, diagnostik) tidak punya relasi dengan pasien, sehingga ABAC pasien
standar menolak mereka. Masalah yang sama sudah diselesaikan untuk gizi/bank darah dengan tampilan layanan
(ADR-0105).

## Keputusan

1. **Laporan mikrobiologi per tahap** (`micro_reports`, satu per order × tahap `awal`/`akhir`):
   - analis (`lab.result.verify`) menulis validasi teknis, yang membuat baris;
   - dokter (`lab.result.release`) merilis klinis dengan PDF ber-TTE, lalu event `micro.report_released` terbit.

   Trigger menegakkan empat aturan:
   - laporan akhir hanya setelah laporan awal dirilis (`MICRO_STAGE_ORDER`);
   - perilis ≠ validator teknis (`VALIDATOR_SAME_USER`);
   - rilis sekali dan tidak dihapus;
   - setelah tahap divalidasi teknis, isolat dan uji kepekaan tahap itu terkunci (`MICRO_STAGE_CLOSED`).

   Uji kepekaan hanya untuk isolat tahap akhir. Uji kultur dikenali dari `lab_test_definitions.panel_code = 'MIKRO'`;
   seed menambah kultur darah, urin, sputum, dan pus (LOINC belum dipetakan).
2. **Antibiogram kumulatif** (`GET /micro/antibiogram?from&to`): isolat pertama per pasien × organisme (CLSI M39
   sederhana) dari laporan akhir yang dirilis di periode itu, dengan %S per antibiotik. Hasilnya agregat tanpa
   identitas pasien.
3. **Patologi anatomi:**
   - `pa_reports` dikelola pola entri berversi ADR-0028 (masuk `CLINICAL_TABLES`): baru, koreksi sebelum TTE,
     addendum sesudahnya;
   - gambar = `image_document_ids` (dokumen aktif milik pasien);
   - tautan ke spesimen kamar operasi lewat `surgery_specimen_id`. Kasus operasi diisi server dari spesimen. Satu
     laporan terkini per spesimen;
   - worklist PA = spesimen terkirim (`surgery_specimens`) yang belum berlaporan atau dikirim ≤ 7 hari;
   - TTE lewat `ClinicalSigningService`, lalu event `pa.report_signed`;
   - izin `lab.result.release`, untuk dokter berpenugasan di unit Lab/PA.
4. **S10:** laporan = entri berversi `diagnostic_reports` (kategori `lainnya`) dengan kolom baru `kind`,
   `form_response_id`, dan `document_ids`.
   - Worklist: order ber-kode ICD-9-CM jenis S10 (`DIAGNOSTIC_KIND_CODES`, prefiks terpanjang menang).
   - Dokter mengisi formulir P07 `diag_<jenis>` (lima formulir di-seed) lewat `POST /diagnostics/requests/:id/form`,
     lalu `POST /diagnostics/reports`. Satu laporan terkini per order.
   - TTE (`diagnostics.sign`), lalu event `diagnostic.report_signed`.
   - Laporan tampil di panel hasil fase 3 karena memakai tabel hasil yang sama.
5. **Tampilan layanan untuk TTE dan formulir.** `ClinicalPdfService.issue` dan `FormResponsesService.create` menerima
   `accessChecked` dari pemanggil yang sudah menerapkan aturan tampilan layanan penunjang (`supportScope`). Hak tulis
   per profesi formulir tetap diperiksa. Pemanggil lain tidak berubah.

## Konsekuensi

- Migrasi `20261008810000_micro_pa_diagnostics`: tabel `micro_reports` (RLS FORCE, tanpa DELETE, hanya kolom rilis
  yang bisa di-UPDATE), kolom baru di `pa_reports` dan `diagnostic_reports`, serta trigger penguncian isolat. Tidak ada
  fungsi SECURITY DEFINER baru.
- Layar Lab (4.2) belum punya tab Mikrobiologi. Mode api memakai layar terpisah `/penunjang/mikrobiologi` yang sudah
  ada di registri. Tab bisa ditambahkan pemilik layar Lab dengan komponen yang sama.
- Kultur darah positif sebagai nilai kritis (demo) belum ada: `critical_results` belum punya sumber mikrobiologi.
- Order PA non-OK (biopsi poli/endoskopi) belum punya entitas order; laporan PA tanpa spesimen tetap bisa dibuat per
  kunjungan.
- Lampiran S10 dan gambar PA memakai dokumen pasien yang sudah diunggah (unggah lewat layar Dokumen); layar 4.8 belum
  punya unggah langsung.
