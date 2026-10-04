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

## Pembaruan 5 Okt 2026

### Pencarian nama memakai indeks trigram di bawah RLS
Konsekuensi pertama di atas (indeks GIN tidak terpakai) ditutup dengan pola ADR-0008 (`app_active_tenant_ids()`), migrasi `20261005090000`:
1. **Tabel indeks `search.patient_names`** (`patient_id`, `tenant_id`, `name_search`), indeks GIN `(tenant_id, name_search gin_trgm_ops)` dengan `fastupdate = off`. RLS ENABLE + kebijakan `tenant_isolation`, **tanpa FORCE**: pemilik (role migrator) membacanya tanpa kebijakan sehingga operator trigram boleh menjadi kondisi indeks. `simrs_app` tidak punya hak apa pun atas skema `search`. Skema terpisah membuat Prisma tidak melihatnya (schema.prisma tidak berubah).
2. **Sinkron lewat trigger** `app_sync_patient_name()` (`SECURITY DEFINER`) setelah INSERT dan UPDATE `name_search` di `patients`. Sumber kebenaran tetap `patients.name_search`; trigger hanya menyalin baris yang baru lolos RLS di transaksi itu.
3. **`app_search_patient_names(p_query text)`**, `SECURITY DEFINER`: tenant **selalu** dari `app_current_tenant()` (bukan parameter; tanpa konteks → `TENANT_REQUIRED`), hanya mengembalikan `(patient_id, score)`, `search_path` dipatok `pg_catalog, pg_temp` dan semua objek ditulis lengkap dengan skemanya, `EXECUTE` hanya untuk `simrs_app`. Kueri dinamis dengan nilai lewat `USING` agar direncanakan dengan nilai sebenarnya; `ROWS 100` agar penggabungan ke `patients` memakai indeks PK per kandidat, bukan memindai seluruh pasien RS. API (`MpiRepository.idsByName`) menggabungkan hasilnya dengan `patients` lewat RLS biasa; filter tanggal lahir dan ABAC tetap di kueri itu, sebelum `LIMIT`.
4. **Hasil sama dengan kueri lama**: kemiripan keseluruhan `%` (ambang 0,3), kemiripan kata `<%` (ambang 0,6; salah ketik, sebagian nama), atau memuat teks (LIKE); urutan skor lalu nomor RM. Ambang ini bawaan pg_trgm yang dulu berlaku tanpa disetel; kini dipatok di fungsi sehingga `SET` di sesi tidak mengubah hasil. Bedanya hanya karakter wildcard LIKE di teks pencarian kini di-escape (dulu `%%` mencocokkan semua nama).
5. **`fastupdate = off`**: dengan daftar tunda GIN setiap pemindaian indeks ikut membaca seluruh daftar tunda, sehingga perencana memilih memindai tabel. Diukur di PostgreSQL 16: 100 ribu nama satu RS dipindai penuh ±200 ms per pencarian; tanpa daftar tunda indeks dipakai mulai ±30 ribu nama (< 1 ms untuk nama spesifik). Pendaftaran pasien jarang dibanding pencarian, jadi sisip langsung ke indeks murah.

Tes (`packages/db/test/patient-name-search.test.ts`): bentuk fungsi yang sempit, hasil identik dengan kueri lama untuk sekumpulan nama, tenant B tidak pernah menerima ID tenant A, trigger sinkron, dan EXPLAIN di atas 30 ribu nama sintetis (transaksi dibatalkan) menunjukkan operator trigram menjadi `Index Cond` indeks `patient_names_trgm`, sedangkan kueri lama di `patients` di bawah RLS tidak pernah bisa.

Konsekuensi: + pencarian nama siap untuk RS besar tanpa melonggarkan RLS. − Satu tabel turunan dan satu trigger per pendaftaran/ubah nama. − Indeks `patients_name_search_trgm` di `patients` tidak lagi dipakai pencarian; dibiarkan karena dimodelkan di schema.prisma (hapus bersama perubahan schema.prisma). − Pra-saring deteksi duplikat (`patient-match.ts`) masih menghitung kemiripan di `patients` di bawah RLS.

### FK relasi dan akses darurat → pasien divalidasi
§7 ditutup oleh migrasi `20261005091000` lewat fungsi `app_validate_patient_fks()` (hanya pemilik tabel/superuser): menghitung baris `access_relationships`/`break_glass_grants` yang merujuk pasien yang tidak ada, lalu `VALIDATE CONSTRAINT` bila nol. Ada baris yatim → `WARNING`, FK tetap `NOT VALID` (baris baru tetap diperiksa penuh), **tidak ada data yang dihapus**, dan migrasi tidak gagal. Database baru, pengembangan, dan produksi (belum punya baris) langsung tervalidasi.

Fungsi melepas FORCE RLS ketiga tabel sementara di dalam transaksinya. Alasannya: di bawah FORCE, `VALIDATE` tanpa `app.tenant_id` gagal `TENANT_REQUIRED`, dan dengan `app.tenant_id` terset pemeriksaan awal FK ikut tersaring kebijakan, sehingga constraint ditandai valid padahal baris yatim tenant lain tidak pernah diperiksa (dibuktikan 5 Okt 2026). Jangan menjalankan `VALIDATE CONSTRAINT` manual pada tabel ber-FORCE RLS; pakai fungsi ini.

Yang dilakukan operator bila migrasi melaporkan FK belum divalidasi:
1. Cek: `SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%_tenant_id_patient_id_fkey';`
2. Database tes lama (`simrs_test` atau `simrs_test_<nama>`): `pnpm db:test:recreate -- --yes` (hanya database di `TEST_DATABASE_URL`), atau biarkan; FK tetap memeriksa baris baru.
3. Database lain: baris relasi dan akses darurat adalah jejak akses, jadi jangan dihapus diam-diam. Tinjau bersama petugas privasi, bereskan, lalu jalankan sebagai migrator atau superuser: `SELECT * FROM app_validate_patient_fks();` (hasil per FK: jumlah baris yatim dan status validasi).
