# Cara kerja backend

Halaman ini untuk pembaca baru yang ingin memahami **bagaimana backend SIM RS bekerja**: bagian-bagiannya, perjalanan satu permintaan dari layar sampai database, lapisan keamanannya, dan pola bersama yang wajib dipakai ulang setiap modul baru. Gambaran sistem tanpa kode ada di [Cara sistem bekerja](./01-cara-kerja-sistem.md). Rincian per modul dan per potongan ada di [Cara kode bekerja](./02-cara-kerja-kode.md). Letak berkas ada di [Peta kode](./19-peta-kode.md).

> Status 7 Okt 2026: pemilik produk memutuskan backend dilanjutkan penuh. Urutannya: sisa fase 3 (3.6, 3.7, 3.8, W1–W5b, 3.9), lalu fase 4 → 10. Yang sudah ada di `master`: fondasi (fase 0), platform inti (fase 1), front office (fase 2), dan API klinis fase 3 potongan 3.0–3.5. Layar klinis mode api masih "Belum tersambung" sampai potongan W. Halaman ini hanya menjelaskan yang sudah ada di kode; rencana ditandai **(rencana)**.

## Arsitektur ringkas

![Diagram arsitektur: kanal → web Next.js (BFF) → API NestJS → PostgreSQL dengan RLS → outbox → worker → sistem luar (lokal: mock)](./gambar/diagram-arsitektur.svg)

| Bagian    | Folder            | Port lokal    | Tugas                                                                                                                  |
| --------- | ----------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Web (BFF) | `apps/web`        | 3000          | Halaman Next.js dan Server Action. Satu-satunya pemanggil API untuk peramban. Token login disimpan di cookie httpOnly. |
| API       | `apps/api`        | 4000          | NestJS, awalan `/api/v1`. 40 modul di `src/modules/<modul>`, fondasi bersama di `src/common` dan `src/infra`.          |
| Database  | `packages/db`     | 5433 (Docker) | PostgreSQL 16. Skema Prisma multi-berkas, migrasi SQL, RLS per tenant, trigger penjaga.                                |
| Worker    | `apps/worker`     | —             | Mengirim outbox (BullMQ di atas Redis), menjalankan job berkala per tenant, jangkar audit, rotasi kunci.               |
| Mock      | `apps/mock`       | 4100          | Tiruan BPJS, E-Klaim, SATUSEHAT, Dukcapil, TTE, TPDI, BTN, dan panel kendali skenario.                                 |
| Kontrak   | `packages/shared` | —             | Skema zod, katalog izin, kode galat, mesin aturan klinis murni. Dipakai API dan web.                                   |
| PDF       | `packages/pdf`    | —             | Render PDF klinis deterministik untuk TTE.                                                                             |

Tiga aturan besar:

1. **Peramban tidak pernah memanggil API.** Komponen klien memanggil Server Action, lalu Server Action memanggil API lewat `api()` (`apps/web/src/lib/server/api.ts`).
2. **Database adalah penjaga terakhir.** Isolasi antar-RS ditegakkan RLS PostgreSQL. Entri klinis tidak bisa di-UPDATE/DELETE, bahkan oleh pemilik tabel.
3. **Tidak ada panggilan ke sistem luar di dalam transaksi.** Efek keluar ditulis ke `outbox_messages` lalu dikirim worker. Pengecualian baca-saja (lookup BPJS/Dukcapil) berjalan di luar transaksi (ADR-0025).

## Alur permintaan dari layar ke database

![Diagram satu permintaan tulis: layar → Server Action → api() → API (header, batas laju, sesi, izin, modul, validasi, ABAC) → satu transaksi bertenant berisi baris domain, kunci idempotensi, event domain, outbox, peristiwa biaya, dan audit → setelah commit worker, SSE, dan TTE](./gambar/diagram-backend-permintaan.svg)

Contoh nyata yang sudah tersambung: petugas mendaftarkan pasien rawat jalan di layar **Pendaftaran** (mode api).

**Di web**

1. Komponen klien memanggil Server Action `registerOutpatientAction` (`apps/web/src/app/(staf)/pendaftaran/actions-api.ts`).
2. Server Action memeriksa sesi dan izin `encounter.write` sendiri, karena setiap Server Action adalah endpoint POST publik. Ia juga memvalidasi input dengan skema zod bersama dan membawa `Idempotency-Key` dari klien.
3. `api('/api/v1/registration/outpatient', …)` mengambil token dari cookie httpOnly, meneruskan IP dan user agent klien, tanpa cache, dengan batas waktu. Respons dicek dengan skema zod. Respons di luar skema dianggap galat dan tidak diteruskan ke UI.

**Di API**

Setiap controller yang menyentuh data tenant memakai `@TenantScoped()` (`apps/api/src/common/tenant-scoped.decorator.ts`). Dekorator ini memasang `AuthGuard`, batas laju per pengguna, dan `TenantTransactionInterceptor`.

1. **Header keamanan dan request id.** Header keamanan dipasang, dan `X-Request-Id` dibuat atau diteruskan. Id ini muncul di log dan di setiap galat.
2. **Batas laju per IP**, lalu `AuthGuard` mengenali sesi: tenant, pengguna, peran, dan unit penugasan. Sesudah itu batas laju **per pengguna** berlaku.
3. **Izin peran (RBAC).** `@RequirePermission('encounter', 'write')` dicocokkan ke matriks izin RS (`PermissionMatrix`, di-cache). Hasilnya **lingkup** `all`, `unit`, atau `relationship`. Bila ditolak, audit `access_denied` di-commit di transaksi singkat tersendiri, lalu klien menerima 403.
4. **Transaksi dibuka.** `prisma.forTenant()` membuka satu transaksi dan menyetel `app.tenant_id`. Semua langkah berikut berjalan di dalamnya:
   - `@RequireModule('F03')` memeriksa modul aktif RS (`tenant_modules`);
   - `ZodValidationPipe` memvalidasi body, dan field asing ditolak;
   - service menjalankan aturan bisnis. Untuk data pasien, `PatientAccessService.assert()` memeriksa relasi (ABAC);
   - repository menulis lewat Prisma (`TenantDb.tx()`).
5. **Isi satu transaksi registrasi** (`RegistrationService.registerOutpatient`):
   - klaim `Idempotency-Key`;
   - kunjungan + riwayat status, dengan nomor dari layanan penomoran;
   - penjamin;
   - relasi akses DPJP;
   - SEP `pending` dengan pesan outbox;
   - event domain `encounter.registered`, yang penangannya menulis task ID BPJS di transaksi yang sama;
   - catatan hasil idempotensi.

   Audit ditulis sebelum commit.

6. **Commit.** Semua tulisan tersimpan bersama. Galat di titik mana pun membatalkan seluruhnya, termasuk auditnya. Satu pengecualian: penolakan ABAC (`AuditedDenial`) tetap dicatat sebagai `access_denied` di transaksi terpisah.
7. **Respons.** Bila berhasil, API mengembalikan JSON. Bila gagal, formatnya `{ code, message, details, requestId }` dengan `code` stabil (mis. `IDEMPOTENCY_KEY_REUSED`, `RECORD_LOCKED`). Pesan internal tidak pernah dikirim.

**Setelah commit**

- Worker mengklaim pesan outbox `pending`, mengirimnya ke sistem luar (lokal: mock), dan mencoba ulang bila gagal.
- Trigger tabel memanggil `pg_notify`, lalu aliran SSE meneruskan perubahan ke layar yang berlangganan.
- Kait `TenantDb.afterCommit()` dijalankan, misalnya untuk invalidasi cache matriks izin.

### Jalur tanpa transaksi permintaan

`@NoRequestTransaction()` hanya untuk tiga pola (ADR-0025, ADR-0026, ADR-0030):

| Pola                                                  | Contoh                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Lookup baca-saja ke sistem luar lewat `LookupGateway` | cek peserta/rujukan BPJS, demografi Dukcapil saat pendaftaran                                 |
| Aliran SSE yang bisa terbuka lama                     | papan antrean TV, papan IGD, papan bed, eskalasi EWS                                          |
| Penolakan yang wajib tetap tercatat                   | kirim order yang diblokir CDS: `cds_alerts` `diblokir` di-commit dulu, lalu 422 `CDS_BLOCKED` |

Izin, cek modul, dan `@Audited` tetap berjalan, masing-masing di transaksi pendek. Akses data di handler wajib lewat `TenantDb.transaction(fn)`.

### Mode presentasi dan mode api

Sumber data dipilih saat permintaan, bukan saat build. `DATA_SOURCE=demo` hanya berlaku bila `APP_ENV` lokal atau demo. Selain itu web memakai mode api.

- Di mode demo, layar membaca toko keadaan demo (`apps/web/src/lib/demo/store/**`, ADR-0085) dan API tidak dipanggil.
- Di mode api, pengambil data `apps/web/src/lib/server/data/**` memanggil `api()`. Domain yang backend-nya belum ada memanggil `notImplemented()`, dan layar hibridanya menampilkan "Belum tersambung".
- Bentuk data toko demo adalah acuan bentuk respons API (ADR-0023 keputusan 4).

Rinciannya ada di [Peta kode: satu layar, dua sumber data](./19-peta-kode.md#web-satu-layar-dua-sumber-data).

## Lapisan keamanan

### RLS: isolasi antar-RS di database

- Setiap tabel domain punya `tenant_id` dan kebijakan `tenant_isolation` dengan `FORCE ROW LEVEL SECURITY`. `app_current_tenant()` melempar `TENANT_REQUIRED` bila `app.tenant_id` kosong, jadi lupa menyetel tenant langsung ketahuan.
- Aplikasi memakai role `simrs_app` tanpa `BYPASSRLS`. Hanya `simrs_migrator` yang memiliki tabel, dan role itu tidak dipakai saat aplikasi berjalan.
- FK komposit `(tenant_id, id)` mencegah baris menunjuk baris RS lain. Saat migrasi menambahkannya, FK itu dibungkus `NO FORCE`/`FORCE`.
- Worker lintas tenant hanya memakai `app_active_tenant_ids()`, lalu memproses tiap tenant di transaksi bertenant (ADR-0008). Setiap fungsi `SECURITY DEFINER` wajib `SET search_path = <skema>, pg_temp`.

### RBAC + ABAC: siapa boleh membuka pasien mana

| Lapis                | Di mana                                                                         | Isi                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Izin peran (RBAC)    | `@RequirePermission(sumber, aksi)` + matriks per RS                             | 16 peran sistem, katalog izin di `@simrs/shared`. Menghasilkan lingkup `all`, `unit`, atau `relationship`.                                                                                                                                                                                                                                                                                                                 |
| Relasi pasien (ABAC) | `PatientAccessService` (`apps/api/src/modules/authz/patient-access.service.ts`) | `all`: semua pasien. `relationship`: relasi aktif di `access_relationships` (DPJP, rawat bersama, konsultan, perawat penanggung jawab) atau akses darurat yang belum kedaluwarsa. `unit`: semua dasar `relationship`, ditambah pasien yang **lokasinya kini** di unit penugasan (`app_patient_location`: unit bed yang ditempati, atau unit kunjungan aktif bila belum punya bed). Transfer bed memindah akses (ADR-0031). |
| Daftar dan pencarian | `patientAccessSql()`                                                            | Predikat SQL yang sama, disaring sebelum `LIMIT`.                                                                                                                                                                                                                                                                                                                                                                          |
| Tim perawatan        | `CareTeamService` (`apps/api/src/infra/clinical/care-team.service.ts`)          | Anggota `encounter_participants` otomatis mendapat baris `access_relationships` di transaksi yang sama. Keluar dari tim menutup relasi pada akhir hari berikutnya (WIB). Hanya satu DPJP utama aktif per kunjungan (`PRIMARY_DPJP_EXISTS`).                                                                                                                                                                                |
| Akses darurat        | modul `authz`                                                                   | Alasan wajib, berbatas waktu, petugas privasi diberi tahu, wajib ditinjau di layar Audit.                                                                                                                                                                                                                                                                                                                                  |

Rekam medis yang digabung (MPI) dianggap satu orang (`app_patient_group`): relasi ke salah satunya berlaku untuk semuanya. Penolakan ABAC dilempar sebagai `AuditedDenial` dan selalu tercatat sebagai bahan temuan "akses ditolak berulang".

Izin tanda tangan (`clinical.sign`, `consent.sign`) diperiksa **endpoint pemanggil**, bukan layanan PDF. Co-sign CPPT residen hanya oleh DPJP utama, rawat bersama, atau DPJP kunjungan, dan tidak atas catatan sendiri (`COSIGN_NOT_ALLOWED`).

### Audit

- `@Audited({ action, resource, patientId, … })` di handler, atau `TenantDb.audit()` di service (mis. satu entri `read` per pasien yang tampil di daftar). Keduanya ditulis **di transaksi yang sama** dengan datanya. Bila audit gagal, respons tidak dikirim.
- `audit_events` append-only. Hash berantai dihitung trigger, dan jangkar hash tiap jam disimpan di bucket WORM (ADR-0072).
- Detail audit hanya **nama field**, bukan nilainya. Alasan yang diketik pengguna masuk kolom `reason`.

### Data pasien (PHI) tidak bocor lewat jalur samping

| Jalur           | Penjaga                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outbox          | Payload hanya ID dan kode. Isi dibaca worker saat mengirim (ADR-0017).                                                                                                      |
| Event domain    | `assertDomainEventPayload`: kunci `…Id` harus UUID, kunci lain hanya angka, boolean, atau token enum. Teks bebas ditolak sebagai galat program.                             |
| SSE             | `pg_notify` hanya `{ tenant_id, id }`. Isi baris dibaca ulang lewat RLS tenant pelanggan. Muatan kanal klinis berisi ID, kode status, dan angka, tanpa nama atau diagnosis. |
| Notifikasi      | Tanpa PHI, hanya jenis kejadian dan tautan ke layar berizin.                                                                                                                |
| Kolom identitas | NIK, no. BPJS, IHS, alamat, dan no. HP dienkripsi per kolom, dicari lewat blind index, dan tampil tersamar (ADR-0015).                                                      |
| Log dan galat   | Tanpa PHI, ditelusuri lewat `requestId`.                                                                                                                                    |

## Pola entri klinis berversi

Entri klinis tidak pernah ditimpa (CLAUDE.md §4.2, ADR-0004, ADR-0028). Semua modul klinis menulis lewat **`ClinicalRecordService`** (`apps/api/src/infra/clinical/clinical-record.service.ts`) dan tidak membuat logika versi sendiri.

![Diagram rekam medis immutable: entri versi 1, koreksi menjadi versi 2 yang menggantikan versi 1, dan addendum setelah TTE](./gambar/diagram-rekam-medis-immutable.svg)

**Tabel berversi** (`CLINICAL_TABLES`): `observations`, `diagnostic_reports`, `conditions`, `procedures`, `allergy_intolerances`, `cppt_entries`, `handovers`, `consult_requests`, `consult_responses`, `consents`, `discharge_summaries`, `triage_assessments`, `nursing_care_plans`. Setiap baris membawa `root_id`, `version`, `supersedes_id`, `addendum_of`, `status` (`final`/`entered_in_error`), `correction_reason`, `occurred_at` (waktu kejadian dari klien), `recorded_at` (jam server, diisi trigger), serta `author_user_id` + `author_role`. View `<tabel>_current` hanya berisi versi yang belum digantikan.

**Langkah di service** (contoh `CpptService.create`):

1. `clinicalEncounter(db, access, encounterId, 'write')`: kunjungan ada di tenant ini, pasien boleh dibuka pelaku (ABAC), dan kunjungan tidak batal. Kunjungan yang sudah selesai tetap boleh ditulisi; entrinya ditandai "terlambat".
2. `records.prepare(tabel, { patientId, encounterId, occurredAt, revision })` menghasilkan kolom versi. `revision` salah satu dari:
   - `baru`: versi 1;
   - `koreksi`: hanya penulis asli, wajib alasan. Versi yang sudah digantikan → 409 `RECORD_SUPERSEDED`; versi ber-TTE → 409 `RECORD_LOCKED`;
   - `addendum`: PPA lain menambah catatan pada versi final.

   **Penulis selalu dari sesi**. Body yang memuat penulis atau waktu catat ditolak skema ketat.

3. `records.insert(() => tx.<tabel>.create(…))` menyimpan baris. Galat trigger dipetakan ke kode stabil `CLINICAL_ERRORS` (`@simrs/shared`), dan pesan database tidak pernah diteruskan.
4. Efek samping di transaksi yang sama, bila relevan:
   - staging SATUSEHAT `held`;
   - peristiwa biaya;
   - event domain (mis. `cppt.finalized`);
   - `db.audit({ action: 'create' | 'correct', patientId, … })`.
5. **Salah entri** memakai `records.enteredInError(tabel, id, reason)`: versi baru berstatus `entered_in_error`, dan isi aslinya tetap terbaca.

**Penjaga di database:**

- `app_reject_mutation` menolak UPDATE/DELETE, juga bagi pemilik tabel;
- `app_clinical_guard` menjaga rantai versi, satu pengganti per versi, alasan koreksi, dan kunci TTE lewat `documents`.

Jadi aturan tetap berlaku walau ada bug di service.

**Konkurensi.** `lockVersion()` (advisory lock per versi) menyerialkan koreksi dengan permintaan TTE atas versi yang sama. Satu diagnosis utama per kunjungan dijaga kunci per kunjungan (`PRIMARY_DIAGNOSIS_EXISTS`).

**Rute.** Bacaan per kunjungan memakai bentuk kanonik `/api/v1/encounters/:id/<sumber>` (mis. `observations`, `cppt`, `conditions`, `assessments`, `context`). Tulisan memakai awalan modul (`/api/v1/cppt/entries`, `/api/v1/diagnosis/conditions`). Rute eMAR 3.5 masih berbentuk `/api/v1/nursing/emar/:encounterId`.

**Draf** (`/api/v1/drafts/:encounterId/:kind`) bukan rekam medis. Draf hanya milik penulisnya, boleh diubah dan dihapus, dan dibersihkan job worker 48 jam setelah kunjungan selesai atau batal.

**eMAR (3.5)** memakai tabel append-only sendiri (`medication_administrations`, dijaga trigger). Gerbangnya:

- pindaian gelang milik pemberi yang masih berlaku;
- cek ganda high-alert oleh sesi perawat/bidan kedua, terikat isi dosis;
- dosis atau jadwal tunggal;
- alasan wajib untuk dosis terlambat, ditunda, atau ditolak.

Lihat ADR-0077.

## TTE dan PDF klinis

Dokumen klinis legal (resep, kelak resume dan persetujuan) diterbitkan sebagai PDF deterministik lalu ditandatangani elektronik lewat outbox (ADR-0029).

1. **`ClinicalPdfService.issue()`** (`apps/api/src/modules/documents/clinical-pdf.service.ts`) berjalan di transaksi permintaan:
   - memeriksa ABAC pasien;
   - membaca identitas pasien dan kop RS **dari database**, bukan dari klien;
   - membuat kode verifikasi sebelum render, sehingga QR ikut ter-hash;
   - me-render PDF dengan `@simrs/pdf`;
   - menyimpan berkas (SHA-256) dan baris `documents`;
   - bila diminta TTE, menulis `document_signatures` `pending` + outbox `tte.sign` atas nama **pengguna sesi**.
2. **`ClinicalSigningService.issueSigned(tabel, versionId, …)`** (`apps/api/src/infra/clinical/clinical-signing.service.ts`) menjalankan langkah 1 di bawah `lockForSigning`. Versi yang sudah digantikan tidak bisa ditandatangani. Setelah dokumen bertanda tangan tersimpan, versi sumber terkunci: koreksi → `RECORD_LOCKED`, perubahan lewat addendum. Ini titik sambung untuk entri berversi seperti resume (3.6) dan persetujuan (3.7). Di `master`, layanan ini belum punya pemanggil.
3. **Worker** (`apps/worker/src/outbox/tte.ts`) mengirim **hash** dokumen ke penyelenggara TTE (lokal: mock `/tte/sign`), bukan isinya. Sertifikat dan tanda tangan disimpan atomik. Gagal permanen menandai tanda tangan `failed`.
4. **Verifikasi QR** (`/verification`) bersifat publik dan tanpa PHI: RS, jenis dokumen, penanda tangan, waktu, dan sidik digital.

Pemakai saat ini: resep di modul `orders` memanggil `ClinicalPdfService.issue()`. TTE hanya dibuat bila penulis memegang `clinical.sign`; resep residen berstatus `needs_review`.

## Staging SATUSEHAT dan peristiwa biaya

Fase 3 mencatat **sekarang** apa yang kelak dikirim ke SATUSEHAT (fase 7) dan ditagih (fase 5), agar tidak ada entri yang tertinggal (ADR-0032). Keduanya ditulis di transaksi yang sama dengan entrinya.

| Layanan                                                                              | Isi                                                                                                                                                                          | Idempotensi                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `SatusehatRecorder.record(resource, sourceId, revision)`                             | Pesan outbox berstatus `held` (tidak diklaim dispatcher). Payload hanya ID sumber + revisi. Fase 7 melepasnya berurutan, mulai dari Encounter.                               | Kunci outbox per operasi × sumber × revisi               |
| `BillableRecorder.record({ encounterId, patientId, sourceType, sourceId, kind, … })` | Baris `billable_events` **tanpa harga**. Fase 5 memberi harga. Jenis: `visite`, `admisi`, `transfer`, `pulang`, `igd`, `lab`, `radiologi`, `tindakan`, `obat`, `konsultasi`. | Unik per sumber × id × jenis; pencatatan ulang diabaikan |

Pemanggil di `master`:

- **SATUSEHAT:**
  - `Encounter` dari ADT dan triase;
  - `Observation` dari tanda vital, hasil, dan askep;
  - `DiagnosticReport`, `Condition`;
  - `ServiceRequest`/`MedicationRequest` dari order;
  - `MedicationAdministration` dari eMAR.
- **Biaya:**
  - visite DPJP dari CPPT;
  - admisi, transfer, dan pulang dari ADT;
  - order;
  - obat yang benar-benar `given` dari eMAR.

## Event domain, outbox, dan idempotensi

**Event domain** (`apps/api/src/infra/events/domain-events.ts`) berjalan **sinkron di dalam transaksi penerbit**. `publish()` menyimpan event ke `domain_events`, lalu menjalankan semua penangan berurutan di transaksi yang sama. Bila penangan gagal, seluruh permintaan batal. Dengan begitu reaksi selalu konsisten dengan perubahan asalnya, mis. task ID BPJS dari `encounter.registered` dan jadwal eMAR dari `order.activated`. Nama event dan skemanya ada di `@simrs/shared` (`DOMAIN_EVENT_NAMES`).

**Outbox** (`enqueueOutbox` di `@simrs/db`) berstatus `pending → processing → sent`. Gagal sementara → `failed` lalu dijadwal ulang dengan backoff eksponensial. Gagal permanen atau habis percobaan → `dead` (DLQ). Status `held` adalah staging yang belum dikirim. Operasi per tujuan didaftarkan di `apps/worker/src/outbox/operations.ts`:

- Dukcapil;
- TTE;
- email dan WhatsApp;
- kode cadangan login;
- Antrean BPJS dan task ID;
- HFIS;
- SEP;
- rujukan/SPRI/surat kontrol;
- Aplicare.

Rinciannya di [Cara sistem bekerja: integrasi lewat outbox](./01-cara-kerja-sistem.md#integrasi-lewat-outbox).

**Idempotency-Key** (`IdempotencyService`, `apps/api/src/common/idempotency.ts`) dipakai untuk tindakan yang tidak boleh terjadi dua kali, seperti registrasi dan kirim order:

- kunci UUID dari header dikunci dengan advisory lock;
- kunci sama + isi sama → hasil yang sama diulang;
- kunci sama + isi atau pengguna berbeda → 409 `IDEMPOTENCY_KEY_REUSED`;
- tanpa kunci → 400 `IDEMPOTENCY_KEY_REQUIRED`.

## Waktu nyata (SSE)

Perubahan yang perlu tampil seketika dialirkan dengan Server-Sent Events (ADR-0026):

1. Trigger tabel memanggil `pg_notify(kanal, '{"tenant_id":…,"id":…}')` saat commit.
2. **`PgNotificationHub`** memegang **satu** koneksi `LISTEN` per instans API dan meneruskan notifikasi hanya ke pelanggan dengan kanal dan tenant yang sama.
3. **`SseService.stream()`** membaca baris lewat `withTenant` (RLS) dalam transaksi pendek. Layanan ini juga mengurus:
   - pemutaran ulang `Last-Event-ID`;
   - potret awal;
   - heartbeat 15 detik;
   - umur koneksi maksimal 5 menit, sehingga sesi dan izin diperiksa ulang secara berkala;
   - batas aliran per perangkat (2) dan per pengguna (5).
4. Web meneruskan aliran lewat Route Handler BFF tanpa memberi token ke peramban, mis. `apps/web/src/app/(perangkat)/display/antrean/events/route.ts`.

| Aliran           | Endpoint                                | Izin                                                | Pemakai web                |
| ---------------- | --------------------------------------- | --------------------------------------------------- | -------------------------- |
| Papan antrean TV | `GET /api/v1/queue/displays/:id/events` | perangkat display                                   | Display antrean (mode api) |
| Papan IGD        | `GET /api/v1/triage/board/events`       | `clinical.read`                                     | belum (W3)                 |
| Papan bed        | `GET /api/v1/adt/beds/events`           | `bed.read`, disaring unit untuk lingkup bukan `all` | belum (W3)                 |
| Eskalasi EWS     | `GET /api/v1/clinical/streams/ews`      | `clinical.read`                                     | belum (W4)                 |

Berlangganan aliran staf dicatat di audit (`read`).

## Gerbang tutup kunjungan (DischargeGate)

`POST /api/v1/adt/discharges` memanggil `DischargeGate` sebelum memulangkan pasien. Hasil `{ ok: false, reasons }` menjadi 409 `DISCHARGE_BLOCKED`. Kontraknya ada di `apps/api/src/modules/adt/discharge-gate.ts`. Saat ini yang terpasang `BasicDischargeGate`, yang hanya menolak kunjungan rawat jalan (ditutup lewat pemeriksaan poli).

**(rencana, potongan 3.6)** Potongan 3.6 mengganti provider `DISCHARGE_GATE` dengan aturan lengkap:

- rawat inap: disposisi + resume final ber-TTE;
- rujuk: surat rujukan;
- **meninggal** (keputusan K-1, 7 Okt 2026): hanya dokter yang berelasi dengan pasien (DPJP, rawat bersama, atau dokter jaga yang punya akses); wajib jam kematian, sebab kematian ICD-10, dan surat keterangan kematian ber-TTE (`clinical.sign`); admisi ditolak.

Sampai itu terpasang, peran ber-`bed.write` lingkup `all` masih bisa memulangkan dengan disposisi apa pun (dicatat di `docs/05-keamanan.md`).

## Peta modul API per fase

Semua modul ada di `apps/api/src/modules/<modul>/` dan didaftarkan sekali di `AppModule`. Polanya `controller` (tipis) → `service` (aturan) → `repository` (Prisma). Tes integrasi ada di `apps/api/test/*.test.ts`. Tabel lengkap per modul, termasuk endpoint dan tingkat kematangan, ada di [Peta kode: peta modul API](./19-peta-kode.md#peta-modul-api).

| Fase            | Modul API                                                                                                                                                                 | Status di `master`                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0 Fondasi       | `src/common`, `src/infra` (sesi, audit, RLS, outbox, SSE, event domain, lookup, penyimpanan objek, batas laju); `dev-tools`                                               | Selesai                                                        |
| 1 Platform      | `tenancy`, `facility`, `auth`, `iam`, `authz`, `devices`, `audit`, `mpi`, `ref`, `forms`, `documents`, `numbering`, `notifications`, `settings`                           | Selesai, dipakai layar mode api                                |
| 2 Front office  | `scheduling`, `booking`, `registration`, `queue`, `kiosk`, `sep`, `referral`, `patient-portal-gateway`                                                                    | Selesai. `booking` belum punya layar web; dipakai lewat API.   |
| 3 Klinis RME    | `encounter`, `drafts`, `diagnosis`, `results`, `summary`, `nursing`, `cppt`, `assessment`, `worklist`, `adt`, `triage`, `orders`, `cds`                                   | API jadi (3.1–3.5). Layar mode api menyusul W1–W5b.            |
| 3 Klinis RME    | `discharge` (3.6), `consent` (3.7), `consult`, `care-packages` (3.8)                                                                                                      | Kerangka modul kosong. `DischargeGate` sementara ada di `adt`. |
| 4–9             | belum ada modul. Nama rencana di `docs/01-arsitektur.md` §2 dan [Peta kode](./19-peta-kode.md#lapisan-berikutnya-fase-4-9)                                                | Layar hanya mode presentasi                                    |
| 10 (lebih awal) | bukan modul API: backup terenkripsi (`infra/backup`), jangkar audit (`apps/worker/src/audit`), rotasi kunci kolom (`apps/worker/src/key-rotation`, `pnpm db:rotate-keys`) | Selesai                                                        |

## Daftar periksa modul backend baru

Untuk agen dan pengembang yang menambah potongan:

1. **Kontrak dulu.** Skema zod di `packages/shared`. Bentuk respons mengikuti toko demo layar yang sama. Kode galat baru masuk katalog galat dengan kode stabil.
2. **Migrasi:**
   - nama di rentang slot agen;
   - tabel baru `tenant_id` + RLS `FORCE` + `tenant_isolation`;
   - FK komposit dibungkus `NO FORCE`/`FORCE`;
   - grant minimal ke `simrs_app`;
   - fungsi `SECURITY DEFINER` dengan `SET search_path`;
   - indeks manual didaftarkan di `MANUAL_INDEXES` (`packages/db/test/schema-guard.test.ts`);
   - `prisma migrate diff` kosong.
3. **Controller:** `@TenantScoped()`, `@RequireModule(...)`, `@RequirePermission(...)` di setiap handler, `@Audited(...)` dengan `patientId` untuk data pasien, dan `ZodValidationPipe`.
4. **Service:**
   - akses pasien lewat `PatientAccessService`/`clinicalEncounter`;
   - entri klinis lewat `ClinicalRecordService`;
   - TTE lewat `ClinicalSigningService`;
   - staging lewat `SatusehatRecorder`/`BillableRecorder`;
   - tim perawatan lewat `CareTeamService`;
   - tindakan sekali jadi lewat `IdempotencyService`;
   - efek luar lewat outbox, reaksi antarmodul lewat event domain tanpa PHI;
   - jangan menulis ulang pola-pola ini di modul.
5. **Tes integrasi API:** isolasi tenant, izin per peran, ABAC (relasi/unit/darurat), audit tercatat, galat stabil, dan balapan bila ada kunci.
6. **Web mode api:** pengambil data di `lib/server/data/**`, Server Action dengan cek sesi + izin sendiri, dan status layar di `screens.ts`. Tidak boleh ada tombol mati, 500, atau galat konsol. E2E mode api + `e2e/demo/semua-layar.spec.ts` tetap hijau.
7. **Dokumentasi:** ADR untuk keputusan baru, panduan fitur `docs/panduan/10–20`, dan halaman ini bila pola berubah.

Langkah praktis membuat modul baru ada di [Tutorial](./03-tutorial.md). Pembagian agen dan slot backend ada di `docs/13-pembagian-tugas-cd-cx.md` §0.

## Lihat juga

- [Cara sistem bekerja](./01-cara-kerja-sistem.md): gambaran tanpa kode.
- [Cara kode bekerja](./02-cara-kerja-kode.md): rincian per modul dan per potongan.
- [Peta kode](./19-peta-kode.md): letak berkas dan tingkat kematangan.
- [Fitur klinis (RME)](./12-fitur-klinis.md): layar dan API klinis.
- ADR: 0002 (RLS), 0003 (outbox), 0004/0028 (entri berversi), 0017 (outbox tanpa PHI), 0025 (lookup sinkron), 0026 (SSE), 0029 (PDF + TTE), 0031 (ABAC unit), 0032 (staging), 0077 (eMAR).
