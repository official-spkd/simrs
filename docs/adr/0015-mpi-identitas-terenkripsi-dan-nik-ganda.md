# ADR-0015 · MPI: identitas terenkripsi, kebijakan NIK ganda, dan audit akses pasien

Status: diterima · 4 Okt 2026

## Konteks
docs/04 §1 mewajibkan NIK, no. peserta BPJS, no. HP, dan alamat dienkripsi di aplikasi (AES-256-GCM, kunci per tenant) dengan kolom hash untuk pencarian sama-persis. docs/05 §3 mewajibkan NIK tampil tersamar kecuali lewat endpoint khusus yang diaudit, dan setiap baca/ubah data pasien diaudit. Mockup MPI menunjukkan pasangan rekam medis ganda dengan NIK yang sama (data lama), jadi database tidak bisa memaksakan NIK unik. Dokumen tidak mengatur: bentuk penyimpanan identifier, cara mencegah duplikat baru, apa yang dicatat untuk hasil pencarian, dan bagaimana penolakan ABAC tetap tercatat padahal transaksi permintaan dibatalkan.

## Keputusan
1. **Identifier di tabel sendiri.** `patient_identifiers` (nik, bpjs, ihs, paspor) menyimpan `value_enc` (AES-256-GCM, tujuan `patient_identifier`, kunci turunan HKDF per tenant × tujuan) dan `value_hash` (HMAC `sistem:nilai` per tenant). Nilai tidak pernah diubah: koreksi = baris baru, baris lama nonaktif dengan alasan (hak kolom database). CHECK menolak nilai yang bukan format terenkripsi `v1.…`. Maksimal satu identifier aktif per sistem per pasien.
2. **Nomor RM di `patients.mrn`.** Nomor internal RS dari layanan penomoran (P08), unik per tenant, tidak bisa diubah role aplikasi. Alamat dan no. HP dienkripsi di kolom `patients` (tujuan `contact`); no. HP juga di-hash untuk pencocokan duplikat. Nama dan nama ibu tidak dienkripsi (dibutuhkan untuk pencarian mirip).
3. **NIK ganda dicegah di API, bukan di database.** Pendaftaran dan penggantian identifier mengunci nilai itu (advisory lock per tenant × sistem × hash), lalu menolak `409` bila nilai sudah aktif di pasien lain. Respons memuat RM pemiliknya agar petugas memakai rekam medis yang ada. Duplikat lama (migrasi data, pendaftaran tanpa NIK) ditangani lewat tinjauan MPI (penggabungan berjejak).
4. **Tersamar secara bawaan.** Respons API memuat bentuk tersamar (`3174••••••••0012`). Nilai utuh NIK, BPJS, IHS, paspor, atau no. HP hanya lewat `GET /patients/:id/reveal` dengan izin `patient.identity`, dicatat per pembukaan.
5. **Setiap pasien yang tampil diaudit.** Detail = `read`; setiap pasien di hasil pencarian = `search` dengan `patientId`. Teks pencarian tidak pernah dicatat (bisa berisi NIK atau nama), hanya jenisnya (`by: nik|mrn|name|…`). Temuan "volume tak wajar" hanya menghitung `read`, `print`, `export`.
6. **Penolakan ABAC tetap tercatat.** `PatientAccessService.assert` melempar `AuditedDenial`; interceptor menulis `access_denied` (dengan `patientId`) di transaksi tersendiri setelah transaksi permintaan batal, sama seperti penolakan izin peran.
7. **FK ke pasien `NOT VALID`.** FK `access_relationships` dan `break_glass_grants` → `patients` memeriksa semua baris baru; baris lama di basis data lokal/tes (dibuat sebelum tabel pasien ada) tidak divalidasi.

## Konsekuensi
+ Bocornya dump database tidak membuka NIK, BPJS, alamat, atau no. HP; hash tidak bisa dikorelasikan antar-RS maupun antar-sistem.
+ Pendaftaran baru tidak bisa membuat NIK ganda, termasuk dua pendaftaran serentak.
− Pencarian nama memakai pg_trgm, tetapi di bawah RLS indeks GIN tidak terpakai karena operator `%` tidak leakproof; pencarian memindai pasien satu tenant. Cukup untuk fase 1, perlu solusi sebelum RS besar (lihat utang teknis).
− Pencarian sama-persis hanya untuk nilai utuh (tidak ada pencarian sebagian NIK); ini disengaja.
− Rotasi kunci enkripsi butuh enkripsi ulang (format `v1` disiapkan untuk versi kunci berikutnya).
