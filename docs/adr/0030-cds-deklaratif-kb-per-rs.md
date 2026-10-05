# ADR-0030 · CDS deklaratif: mesin aturan bersama, basis pengetahuan per RS, setiap keputusan tercatat

Status: diterima · 6 Okt 2026 (fase 3 potongan 3.4) · Komponen: K09, K08, K12

## Konteks

CPOE (K09) wajib menahan resep yang membahayakan pasien. Contohnya alergi, reaksi silang, interaksi, dosis ginjal, dan duplikasi order. Override hanya boleh dengan alasan yang tercatat dan bisa ditinjau (CLAUDE.md §4.9, DoD fase 3 "resep dengan alergi terdaftar diblokir").

Isi aturan klinis (pasangan obat yang berinteraksi, ambang eGFR, golongan reaksi silang) adalah keputusan komite farmasi/PFT tiap RS, dan bisa berbeda antar-RS (keputusan fase 3 no. 10). Kalau aturan ditulis sebagai kode, setiap perubahan klinis butuh rilis aplikasi dan tidak bisa berbeda per RS.

Potongan 3.0a sudah menyediakan mesin murni `evaluateCdsItem` di `@simrs/shared`, yang menafsirkan jenis aturan yang dikenal. Potongan 3.0c menyediakan tabel `cds_rules` (berversi, append-only) dan `cds_alerts` (setiap keputusan, CHECK override wajib alasan ≥ 10).

## Keputusan

1. **Jenis aturan = kode, isi aturan = data RS.**
   - Mesin hanya mengenal lima jenis aturan: `cross_reactivity`, `interaction`, `history`, `renal`, `duplicate`. Menambah jenis baru = perubahan kode + pembaruan ADR ini.
   - Aturan bawaan selalu aktif tanpa KB: alergi zat sama, alergi golongan sama, perubahan dosis obat rutin, item di luar paket penjamin, singkatan terlarang.
   - Isi aturan (zat/golongan, tingkat `info`/`warn`/`block`, pesan) disimpan di `cds_rules` per RS, divalidasi `cdsRuleSchema` saat masuk.
2. **Versi KB.**
   - Aturan aktif = versi tertinggi per kode yang berstatus `aktif`. Menonaktifkan aturan = versi baru berstatus `nonaktif`, tanpa UPDATE/DELETE.
   - Setiap temuan menyimpan `rule_code` + `rule_version`, sehingga keputusan lama tetap bisa ditelusuri ke isi aturan saat itu.
   - KB yang rusak di basis data menghentikan order (gagal tertutup, 500), bukan dilewati diam-diam.
3. **Satu evaluator server (`CdsService`, modul `cds`).** Pratinjau (`POST /orders/evaluate`) dan kirim order (`POST /orders/submit`) memakai fungsi yang sama dengan mesin yang sama seperti pratinjau web/mode presentasi. Klien tidak pernah menentukan hasil CDS; kiriman selalu dievaluasi ulang di server. Konteks pasien dibaca dari rekam medis kelompok RM gabungan (ADR-0016):
   - alergi terkode (`allergy_intolerances_current` + golongan dari `drug_substances`) atau teks;
   - obat aktif = order obat berstatus terakhir `aktif` (termasuk komponen racikan);
   - **flag riwayat** = diagnosis ICD-10 aktif (diagnosis kunjungan atau problem list) sebagai token `icd10-<kategori>` dan `icd10-<kode tanpa titik>` (mis. N18.3 → `icd10-n18`, `icd10-n183`); aturan `history` RS ditulis dengan token ini;
   - **eGFR** = observasi lab final terakhir berkode LOINC 98979-8 (CKD-EPI 2021), 62238-1 (CKD-EPI), atau 33914-3 (MDRD);
   - order 30 hari terakhir yang tidak dibatalkan (aturan `duplicate`, batas jendela 720 jam);
   - penjamin utama kunjungan (temuan biaya);
   - daftar singkatan terlarang RS (`abbreviations`), diperiksa pada dosis dan aturan pakai.
4. **Interaksi antar-order dan racikan.** Setiap baris dievaluasi terhadap baris lain di kiriman yang sama. Racikan dievaluasi per komponen dan temuannya digabung ke barisnya.
5. **Setiap keputusan tercatat di `cds_alerts`.**
   - Kiriman berhasil: peringatan berkeputusan `diterima`, blok berkeputusan `override` dengan alasan dokter.
   - Kiriman yang ditolak (`block` tanpa alasan sah) juga tercatat: `diblokir` (tanpa `order_group_id`) + audit `create` berstatus `denied`, baru kemudian 422 `CDS_BLOCKED`.
   - Agar penolakan tidak ikut dibatalkan, `POST /orders/submit` memakai `@NoRequestTransaction()`. Handler menjalankan satu `TenantDb.transaction()` yang mengembalikan hasil "ditolak", lalu galat dilempar setelah commit. Ini pola ketiga `@NoRequestTransaction` (di samping lookup ADR-0025 dan SSE ADR-0026).
6. **Tinjauan override.** `GET /cds/overrides` (izin `order.read` lingkup seluruh RS, mis. auditor mutu) menampilkan override dan penolakan per rentang waktu. Pasien hanya diidentifikasi lewat RM, dan pembacaan diaudit.

## Konsekuensi

- \+ RS bisa menyesuaikan KB tanpa rilis. RS lain tidak terpengaruh: KB per tenant di bawah RLS, dan diuji (aturan dinonaktifkan di RS B tetap berlaku di RS A).
- \+ Override dan penolakan bisa ditinjau komite, lengkap dengan versi aturan yang dipakai.
- − **Belum ada alat kelola KB.** Impor KB (CLI gagal-tertutup dari berkas komite) dan layar kelola KB belum dibangun. Sementara KB = seed contoh 3.0c, dan perubahan lewat baris `cds_rules` versi baru oleh operator.
- − **Dua aturan seed belum aktif di API.** Aturan seed `history` memakai flag `hipoglikemia-berat` dan `ckd`. Flag ini tidak dihasilkan dari diagnosis, jadi kedua aturan itu belum berlaku di API sampai KB RS menulisnya dengan token `icd10-*`. Aturan `renal` (metformin eGFR < 30) sudah berlaku.
- − **Dosis per berat badan belum dinilai.** Belum ada jenis aturan untuknya; menyusul bila komite farmasi menetapkan datanya (perlu jenis aturan baru).
- − **eGFR bergantung data rujukan.** eGFR hanya terbaca bila kode LOINC di atas ada di data rujukan yang diimpor dan hasil lab ditulis dengan kode itu (fase 4).
- − **Kebenaran klinis KB contoh** wajib divalidasi komite medik/PFT sebelum pilot (rencana §5).
