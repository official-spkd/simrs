# Cara kode bekerja

Panduan untuk pengembang yang akan meneruskan kode ini. Bacalah bersama `CLAUDE.md` (aturan kerja) dan [Cara sistem bekerja](./01-cara-kerja-sistem.md) (gambaran besar). Semua path di bawah relatif terhadap root repo.

## Struktur repo

```
apps/
  api/        NestJS 12 · REST + Swagger · port 4000
  worker/     NestJS standalone + BullMQ · mengirim outbox
  web/        Next.js 16 (App Router) + Tailwind 4 · port 3000
  mock/       Fastify 5 · tiruan 7 sistem eksternal + panel kendali · port 4100
packages/
  shared/     kode bersama tanpa I/O: uang, tanggal, galat, env, id, katalog komponen, kripto integrasi
  db/         Prisma 7 + PostgreSQL 16: skema, migrasi (dengan RLS), withTenant, outbox, utilitas tes
  ui/         token desain Klinis Bersih + komponen React
  config/     tsconfig, ESLint, Prettier bersama
docs/         dokumen proyek, ADR, PROGRESS, panduan ini (docs/panduan)
design/       token + mockup acuan (read-only)
infra/        skrip SQL init Postgres
scripts/      doctor.mjs (cek prasyarat), pg-portable.mjs (Postgres tanpa Docker)
```

Aturan dependensi (tidak boleh dibalik):

```
apps/web    ──▶ packages/ui, packages/shared
apps/api    ──▶ packages/db, packages/shared
apps/worker ──▶ packages/db, packages/shared
apps/mock   ──▶ packages/shared
packages/db ──▶ packages/shared
```

- `packages/shared` dan `packages/db` dibangun dengan **tsup** ke `dist/` (ESM + CJS + d.ts). Aplikasi memakai hasil build, jadi setelah mengubah paket jalankan `pnpm build` atau `pnpm dev` (watch).
- `packages/ui` adalah paket sumber; Next.js mentranspilasinya langsung (`transpilePackages`).
- Turborepo mengatur urutan: `lint`, `typecheck`, `test`, dan `dev` menunggu `^build` paket yang dibutuhkan.

## API: dari start sampai respons

### Urutan start (`apps/api/src/main.ts`)

1. `load-env.ts` membaca `.env` root.
2. `loadApiEnv()` (`src/config/env.ts`) memvalidasi env dengan zod. Bila ada yang salah, proses berhenti dengan daftar nama variabel (nilainya tidak dicetak). Di sini juga dihitung `devTools` dari `APP_ENV`.
3. `AppModule.forRoot(env)` menyusun modul: Logger (pino), Infra (env, Prisma, Redis), Throttler, Health, Tenancy, dan DevTools (hanya bila `devTools`).
4. `configureApp(app, env)` (`src/bootstrap.ts`), urutannya penting:
   header keamanan → matikan `X-Powered-By` → body JSON maks 1 MB → logger → prefix `/api/v1` (kecuali `/health`, `/ready`) → CORS (hanya `WEB_BASE_URL`) → Swagger (hanya `devTools`).
5. Batas waktu koneksi HTTP disetel, lalu server mendengar di `HOST:API_PORT` (default `127.0.0.1:4000`).

Tes memakai `configureApp` yang sama lewat `test/helpers.ts`, sehingga perilaku tes sama dengan runtime.

### Jalur satu permintaan

```
Express:  securityHeaders → CORS → body parser (1 MB) → pino-http (X-Request-Id)
Nest:     ThrottlerGuard (global) → AuthGuard (@TenantScoped: token → tenant, pengguna, peran) → pipe validasi (zod / ParseUUID)
          → TenantTransactionInterceptor:
              cek @RequirePermission (ditolak → audit access_denied di-commit lebih dulu, lalu 403)
              → BEGIN · set_config(app.tenant_id) · cek @RequireModule
              → Controller → Service → Repository (TenantDb.tx(), RLS aktif)
              → tulis audit (@Audited + TenantDb.audit) · COMMIT
Galat:    di mana pun → ROLLBACK (data + audit batal) → AppErrorFilter → { code, message, details?, requestId }
```

Satu permintaan = satu transaksi database. Konsekuensinya: data dan jejak auditnya selalu konsisten, nomor dokumen yang dialokasikan ikut batal bila permintaan gagal, dan **handler tidak boleh memanggil sistem eksternal** (transaksi masih terbuka) — kirim lewat outbox.

### Fondasi di `src/common` dan `src/infra`

| Berkas                                     | Isi                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `common/tenant-scoped.decorator.ts`        | `@TenantScoped()` = `AuthGuard` + `TenantTransactionInterceptor` (+ dokumentasi bearer Swagger)             |
| `common/require-permission.decorator.ts`   | `@RequirePermission(resource, action)`: cek matriks peran; lingkupnya di `TenantDb.permissionScope()`       |
| `common/tenant-transaction.interceptor.ts` | Satu transaksi ber-RLS per permintaan, cek `@RequireModule`, tulis audit sebelum commit                     |
| `common/request-context.ts`                | Konteks permintaan (AsyncLocalStorage): tenant, transaksi, pelaku + peran, lingkup izin, antrean audit      |
| `infra/tenant-db.ts`                       | `TenantDb`: pintu repository ke transaksi permintaan; gagal keras bila dipakai di luar permintaan bertenant |
| `common/audited.decorator.ts`              | `@Audited` + pembantu `resultId`, `paramId`, `param(name)`, `queryPatientId`, `changedFields`, `bodyReason` |
| `common/require-module.decorator.ts`       | `@RequireModule(code)` untuk feature flag per RS                                                            |
| `common/pagination.ts`                     | `toPage()` untuk paginasi kursor `{ items, nextCursor }`                                                    |

Contoh modul lengkap: `modules/facility/` (P01), `modules/settings/` (P10, P12), dan `modules/iam/` (P03).

### Autentikasi dan sesi (P02)

Alur login (endpoint publik, `modules/auth/auth.controller.ts`):

```
POST /api/v1/auth/login       { tenantCode?, username, password, trustedDeviceToken? }
  → RS dari subdomain (produksi) atau tenantCode (lokal/staging)
  → kata sandi argon2id benar?  ya → { status: 'mfa_required', challengeToken }   (tantangan 5 menit, maks 5 percobaan)
                                 ya, perangkat tepercaya sah → { status: 'authenticated', accessToken, … }  (langkah kode dilewati)
                                 ya, belum punya MFA → { status: 'mfa_enrollment_required', accessToken, … }  (sesi terbatas)
                                 tidak → hitungan gagal + audit di-commit, lalu 401 (pesan seragam)
POST /api/v1/auth/mfa/backup-code { challengeToken, channel: whatsapp|email } → kode 6 digit lewat outbox (maks 3, jeda 30 dtk)
POST /api/v1/auth/mfa/verify  { challengeToken, code, trustDevice? } → { accessToken, refreshToken, …, trustedDevice }
POST /api/v1/auth/refresh     { refreshToken } → token baru (rotasi; token lama dipakai lagi → sesi dicabut)
```

| Bagian             | Berkas                                  | Catatan                                                                                                                          |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Format token       | `infra/auth/session-tokens.ts`          | `sa1`/`sr1`/`sc1`/`st1`.`<tenant>`.`<id>`.`<rahasia>`; DB hanya menyimpan hash (`st1` = perangkat tepercaya 12 jam, ADR-0022)    |
| Siklus sesi        | `infra/auth/session-store.ts`           | buat, validasi (idle, kedaluwarsa, akun nonaktif), rotasi, cabut                                                                 |
| Guard              | `infra/auth/auth.guard.ts`              | dipasang `@TenantScoped()`; tenant dari sesi; header berbeda → `TENANT_MISMATCH`                                                 |
| Sesi belum lengkap | `@AllowIncompleteSession()`             | hanya `/auth/me`, `/auth/logout`, `/auth/password`, `/auth/mfa/enroll*`; lainnya `403 MFA_REQUIRED` / `PASSWORD_CHANGE_REQUIRED` |
| Kripto             | `@simrs/shared/node`                    | `hashPassword`/`verifyPassword` (argon2id), `verifyTotp` (RFC 6238, anti-replay), `encryptField` (AES-256-GCM per tenant)        |
| Kebijakan sandi    | `@simrs/shared` → `checkPasswordPolicy` | panjang ≥ pengaturan RS (min 12), bukan sandi umum, tanpa nama pengguna/kode RS                                                  |
| Batas laju         | `@AuthRateLimited()`                    | throttler `auth` (`AUTH_RATE_LIMIT_PER_MIN`, bawaan 10/menit per IP)                                                             |

Mode header pengembang (`X-Tenant-Id` tanpa login) hanya hidup bila `APP_ENV=local` dan `ALLOW_DEV_TENANT_HEADER=true`; tes modul memakainya, tes auth memakai token sungguhan (`apps/api/test/helpers.ts` → `createTestUser`, `login`). Alasan desain: ADR-0011.

### Otorisasi (P03)

Izin = **sumber × aksi × lingkup**. Katalog sumber dan aksi ada di `packages/shared/src/authz.ts` (`PERMISSION_CATALOG`). Lingkupnya `all` (seluruh data RS), `unit` (unit kerja), atau `relationship` (hanya pasien yang punya relasi dengan pengguna).

| Bagian                      | Berkas                                                  | Catatan                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peran dan matriks bawaan    | `@simrs/shared` → `SYSTEM_ROLES`, `DEFAULT_ROLE_GRANTS` | 16 peran sistem, dibuat per RS oleh `ensureSystemRoles` (seed, persiapan tes). Matriks bawaan hanya diisi saat peran dibuat, jadi penyesuaian RS tidak pernah ditimpa. Bawaan mengikuti hak minimum.                                                                                                           |
| Penugasan                   | tabel `staff_assignments`                               | Pengguna × peran × unit × masa berlaku. Sesi memakai **satu** penugasan: otomatis bila hanya satu, selain itu dipilih pengguna (`GET /auth/assignments`, `POST /auth/assignment`). Penugasan berakhir → izin sesi hilang di permintaan berikutnya.                                                             |
| Pemeriksaan                 | `@RequirePermission(resource, action)`                  | Dicek interceptor sebelum transaksi permintaan. Ditolak → audit `access_denied` di-commit lebih dulu, lalu `403`. Lingkup yang lolos dibaca service lewat `TenantDb.permissionScope()`.                                                                                                                        |
| Cache matriks               | `infra/permission-matrix.ts`                            | Izin per tenant × peran di memori proses. Perubahan di layar Akses membuang cache setelah commit (`TenantDb.afterCommit`) lalu disiarkan ke instans lain (Redis pub/sub); TTL `AUTHZ_CACHE_TTL_SECONDS` (bawaan 30) = jaring pengaman. Redis putus → baca database. Penolakan tetap diaudit.                   |
| Akses pasien (ABAC)         | `modules/authz/patient-access.service.ts`               | `assert(patientId)`: lingkup `all` → boleh. Selain itu wajib relasi aktif (`access_relationships`: DPJP, perawat penanggung jawab, rawat bersama, konsultan, petugas unit) atau akses darurat yang masih berlaku. Lingkup `unit` diperlakukan sama sampai data kunjungan (ADT) ada.                            |
| Akses darurat               | `modules/authz/break-glass.service.ts`                  | Alasan klinis 20–500 karakter, berlaku `break_glass.duration_minutes` (bawaan 60), notifikasi ke semua petugas privasi aktif (tanpa PHI), audit `break_glass` berisi pasien dan alasan. Ditinjau petugas privasi, tidak boleh meninjau milik sendiri. Alasan dan waktu tidak bisa diubah (hak kolom database). |
| Kelola pengguna dan matriks | `modules/iam/`                                          | Lihat aturan pengaman di bawah.                                                                                                                                                                                                                                                                                |

Aturan pengaman di `IamService`:

- Admin tidak bisa menonaktifkan, mereset sandi/MFA, atau menambah peran **akunnya sendiri** lewat menu admin.
- Selalu tersisa **minimal satu admin aktif**. Pemeriksaannya dikunci per tenant (`lockTenantScope`), sehingga dua admin yang saling menonaktifkan bersamaan tidak sama-sama lolos. Tanpa kunci, keduanya lolos di READ COMMITTED (sudah dibuktikan tes).
- Izin `iam.users.write` dan `iam.roles.write` (`ACCESS_ADMIN_GRANTS`) tidak bisa dicabut dari `admin_tenant`.
- Bila izin kelola pengguna didelegasikan ke peran lain, pemegangnya **tidak bisa menyentuh akun atau peran setara admin** (mereset, menonaktifkan, memberi atau mencabut peran admin). Ini menutup eskalasi hak lewat delegasi.
- Kata sandi sementara hanya dikembalikan sekali di respons, tidak masuk log maupun audit, dan wajib diganti saat login pertama. Menonaktifkan atau mereset akun mencabut seluruh sesinya.
- Penugasan yang belum mulai bisa dibatalkan: disimpan sebagai rentang kosong (akhir = awal), tidak dihapus. Alasannya tercatat di kolom `reason` audit.
- Perubahan matriks diaudit sebagai selisih (`added`/`removed`, format `grantDiffEntry`) dan berlaku di permintaan berikutnya, di semua instans API (cache dibuang setelah commit + siaran Redis). Penulisan matriks dikunci per tenant (`ROLE_MATRIX_LOCK`) bersama sinkron izin katalog.

**Izin baru di katalog.** Matriks bawaan hanya diisi saat peran dibuat, jadi izin yang ditambahkan ke `PERMISSION_CATALOG` belakangan tidak otomatis sampai ke RS yang sudah berjalan. Setelah menambah izin + bawaannya, jalankan `pnpm db:sync-permissions` (lihat Tutorial). Sinkron (`syncRolePermissions` di `packages/db/src/permission-sync.ts`) hanya **menambah** izin yang baru di katalog ke peran yang memilikinya di matriks bawaan, dengan lingkup bawaannya:

- "Baru" = belum ada di catatan katalog RS (`tenant_settings` kunci `authz.permission_catalog`, internal, tidak tampil di API pengaturan). RS yang belum pernah disinkron memakai `PERMISSION_CATALOG_BASELINE` (katalog 5 Okt 2026; jangan diubah). Setelah sinkron, catatan = catatan lama ∪ katalog saat ini, jadi izin yang kemudian dicabut admin tidak pernah dianggap baru lagi.
- Peran yang sudah punya baris untuk sumber × aksi itu (lingkup apa pun) tidak disentuh; izin yang pernah dicabut admin dari peran itu menurut jejak audit (`details.removed`) tidak diberikan lagi, juga bila pencabutan terjadi sebelum sinkron pertama. Tidak ada yang dicabut.
- `platform.*` tidak pernah diberikan ke peran RS. Peran bawaan yang belum ada hanya dilaporkan (dibuat oleh `ensureSystemRoles`).
- Setiap penambahan diaudit per peran (`role_permissions`, `via: cli`, pelaku `system`), begitu pula perubahan catatan (`tenant_setting`). Jalan ulang tanpa perubahan katalog tidak menulis apa pun.

Mode header pengembang memakai peran `DEV_ROLE` yang melewati matriks, jadi **jangan dipakai untuk menguji izin**. Tes izin memakai token sungguhan: `createTestUser(TENANT_A, { roles: [{ code: 'perawat' }] })` lalu `login(app, user)`. Contoh lengkapnya di `apps/api/test/authz.test.ts`.

### Layar Audit (P04)

Modul `apps/api/src/modules/audit/` melayani layar `/sistem/audit`. Semua endpoint membaca `audit_events` lewat RLS biasa; tidak ada jalur khusus.

| Endpoint                                  | Izin           | Isi                                                                                                                                                        |
| ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /audit/events`, `/audit/events/:seq` | `audit.read`   | Daftar berfilter (pasien, pengguna, peran, kelompok aksi, rentang waktu, hasil) berpaginasi kursor `seq`; detail berisi hash. Membuka detail ikut diaudit. |
| `GET /audit/verify`                       | `audit.read`   | Periksa seluruh rantai hash tenant. Mahal, jadi web hanya menjalankannya bila diminta (`?verifikasi=1`, tidak terbawa ke tautan lain).                     |
| `GET /audit/anomalies?days=`              | `audit.read`   | Temuan dihitung dari jejak: gagal masuk/akses ditolak berulang, akses pasien di luar jam dinas, volume tak wajar, akses darurat belum ditinjau.            |
| `POST /audit/anomalies/review`            | `audit.review` | Tinjauan temuan. Disimpan sebagai entri audit (`action=review`, `resource_type=audit_anomaly`, `resource_id`=kunci temuan), bukan tabel baru.              |
| `GET /audit/export`                       | `audit.export` | CSV bukti akreditasi: BOM UTF-8, maks. 92 hari / 10.000 baris, sel berawalan `= + - @` diberi `'` (anti formula injection). Ekspor ikut diaudit.           |

- **Kunci temuan** berbentuk `jenis:pengguna:tanggal WIB` (`AUDIT_ANOMALY_KEY` di `@simrs/shared`). Kunci yang sama di hari yang sama = temuan yang sama, sehingga tinjauan tetap melekat walau jumlah kejadian bertambah.
- **Ambang** diatur per RS lewat pengaturan: `audit.night_hours`, `audit.volume_threshold`, `audit.burst_threshold`. Peran jaga malam (`NIGHT_SHIFT_ROLES`) tidak dihitung sebagai akses di luar jam dinas.
- Peninjau tidak boleh meninjau temuan atau akses darurat **miliknya sendiri** (`409`), dan akses darurat yang sudah ditinjau tidak bisa ditinjau ulang.
- Query SQL temuan mengelompokkan per hari dengan `AT TIME ZONE 'Asia/Jakarta'` secara eksplisit, tidak bergantung pada zona sesi database.

### Master Patient Index (P05)

Modul `apps/api/src/modules/mpi/` (rute `/api/v1/patients`). Satu baris `patients` = satu rekam medis dengan nomor RM dari layanan penomoran; identifier eksternal di `patient_identifiers` (ADR-0015).

| Endpoint                                | Izin                    | Catatan                                                                                                                             |
| --------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /patients?q=&birthDate=`           | `patient.read`          | Satu kotak: RM (8 digit, strip opsional), NIK (16), BPJS (13), IHS (`P…`), selain itu nama mirip (pg_trgm). Tanpa kursor, maks. 50. |
| `POST /patients`                        | `patient.write`         | Nomor RM otomatis; NIK/BPJS/IHS/paspor yang sudah aktif di pasien lain → `409` berisi RM pemiliknya.                                |
| `GET /patients/:id`                     | `patient.read`          | Identitas tersamar; alamat utuh; no. HP tersamar.                                                                                   |
| `PATCH /patients/:id`                   | `patient.write`         | Ubah data identitas; rekam medis yang sudah digabung → `409`.                                                                       |
| `PUT /patients/:id/identifiers/:system` | `patient.write`         | Isi/ganti identifier; mengganti wajib `reason`, nilai lama disimpan nonaktif.                                                       |
| `GET /patients/:id/reveal?field=`       | `patient.identity.read` | Nilai utuh NIK/BPJS/IHS/paspor/no. HP, dicatat per pembukaan.                                                                       |

Aturan yang perlu dijaga saat menambah fitur pasien:

- Enkripsi lewat `PatientCrypto` (`@simrs/shared/node`) dan simpan lewat `insertPatient` (`@simrs/db`); jangan menulis NIK, alamat, atau no. HP apa adanya. CHECK database menolak nilai yang bukan format `v1.…`.
- Normalisasi dulu (`normalizeIdentifier`, `normalizePhone`, `normalizePersonName`) agar hash dan pencarian konsisten.
- Setiap pasien yang ditampilkan wajib masuk audit dengan `patientId` (detail `read`, daftar `search`), tanpa teks pencarian atau nilai identitas di `details`.
- Lingkup selain `all` (perawat, dokter) hanya melihat pasien berelasi atau dengan akses darurat aktif, baik di detail (`PatientAccessService.assert`) maupun di query daftar (filter SQL sebelum `LIMIT`). Penolakan ABAC memakai `AuditedDenial` sehingga tetap tercatat.
- Tes membuat pasien fiktif dengan `createTestPatient()` (`apps/api/test/helpers.ts`) atau `createPatient()` (E2E).

#### Rekam medis ganda (layar MPI)

`mpi-match.controller.ts` (rute `/api/v1/mpi`, izin `patient.merge`, lingkup harus `all`):

| Endpoint                                        | Isi                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /mpi/candidates?status=open\|decided\|all` | Antrean (terbuka urut skor + keputusan 30 hari terakhir). Setiap pasangan yang tampil diaudit untuk A dan B. |
| `GET /mpi/candidates/:id`                       | Banding per atribut (tersamar), dampak, keputusan, jejak gabung.                                             |
| `POST /mpi/candidates/:id/merge`                | `{ reason, takeFromB }`: B ditandai `merged`, atribut pilihan B menimpa A, snapshot A terenkripsi.           |
| `POST /mpi/candidates/:id/distinct`, `/reopen`  | "Bukan orang yang sama" dan pembatalannya.                                                                   |
| `POST /mpi/links/:id/undo`                      | Batal gabung ≤ 30 hari; mengembalikan `{ restored, kept }`.                                                  |

- Deteksi: `detectDuplicates` (`@simrs/db`) dipanggil lewat `DuplicateDetector` setelah daftar, ubah identitas, ganti identifier, gabung, dan batal. Logika skor murni ada di `@simrs/shared` (`scorePatientMatch`, `MATCH_THRESHOLD`).
- **Kunci MPI**: alur yang menulis antrean wajib memanggil `lockMpi(tx)` sebelum mengunci/mengubah baris pasien. Tanpa kunci ini dua penggabungan serentak bisa deadlock (ADR-0016).
- Satu orang = kelompok `app_patient_group(id)`; ABAC relasi dan pencarian sudah memakainya. Modul klinis berikutnya juga harus membaca riwayat lewat kelompok ini.

#### Verifikasi NIK dan persetujuan privasi

- NIK yang dicatat (daftar atau ganti) langsung berstatus `pending` dan diantrekan ke outbox (`dukcapil.nik.verify`, kunci `nik-verify:<identifier>:<n>`). `POST /patients/:id/identifiers/nik/verify` (izin `patient.write`) meminta verifikasi ulang; ditolak `409` bila permintaan sebelumnya masih menunggu < 5 menit. Hasilnya diisi worker dan tampil di respons pasien dan tabel banding MPI.
- Persetujuan privasi (`privacy_consents`): `GET/POST /patients/:id/consents`, `POST /patients/:id/consents/:consentId/revoke` (alasan wajib). Satu persetujuan aktif per jenis (dan per penerima untuk pembukaan data); pencabutan hanya mengisi kolom `revoked_*`. Semua diaudit (`read`/`create`/`deactivate`) tanpa nama penerima di detail audit.

### Data rujukan (P06)

Skema `ref` global (tanpa tenant, tanpa RLS, `simrs_app` hanya SELECT) ditulis manual di migrasi `20261004100000` dan **tidak** dimodelkan Prisma; aksesnya lewat fungsi SQL berparameter di `packages/db/src/ref.ts` (ADR-0018).

| Bagian                          | Isi                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ref.code_systems`              | `icd10`, `icd9cm`, `loinc`, `kfa` + URI FHIR, versi dan asal dataset terakhir, jumlah kode aktif                           |
| `ref.concepts`                  | `system` + `code` + `display` + `active` + `extra` (atribut tambahan, mis. KFA `fornas`/`high_alert`)                      |
| `ref.regions`                   | Kode Kemendagri; tingkat dan induk diturunkan dari kode                                                                    |
| `@simrs/shared` → `terminology` | Format kode per sistem, check digit LOINC, tingkat wilayah                                                                 |
| API `modules/ref/`              | `GET /ref/systems`, `/ref/concepts?system=&q=`, `/ref/concepts/:system/:code`, `/ref/regions?parent=&q=` (izin `ref.read`) |
| CLI                             | `pnpm db:import-ref` (role migrator), impor satu berkas dalam satu transaksi, gagal tertutup                               |

Pencarian memakai trigram `<%` dengan ambang yang disetel per transaksi, jadi panggil `searchConcepts`/`listRegions` di dalam transaksi (di API otomatis). Modul lain yang menyimpan kode baku (diagnosis, hasil lab, obat) memvalidasi kodenya ke `ref.concepts` dan menyimpan `system` + `code` + `display` (docs/04 §1).

### Form engine (P07)

Formulir klinis adalah data berversi; isian pasien append-only (ADR-0019).

| Bagian                    | Isi                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@simrs/shared` → `forms` | `formSchemaSchema` (bagian, field, opsi berskor, logika tampil, kategori skor), `formReadyProblems`, `validateAnswers`, `scoreForm`, `diffAnswers`, skema API, contoh `MORSE_FALL_SCALE`                            |
| `form_definitions`        | Satu baris per versi (`code` + `version`). Siklus `draft → submitted → published → archived`; trigger membekukan isi versi terbit; indeks unik: satu berlaku + satu draf terbuka per kode                           |
| `form_responses`          | Append-only (trigger + hanya SELECT/INSERT). Koreksi = baris baru (`root_id`, `supersedes_id` unik, `correction_reason` wajib); `entered_in_error` = salah entri; view `form_responses_current` untuk versi terkini |
| API `modules/forms/`      | `GET/POST /forms`, `GET /forms/:code`, `PUT /forms/:code/draft`, `POST /forms/:code/{drafts,submit,withdraw,publish}` (izin `forms.definition.*`, token `baseUpdatedAt`)                                            |
|                           | `POST /patients/:id/forms/:code/responses`, `GET /patients/:id/form-responses`, `GET /form-responses/:id`, `POST /form-responses/:id/{corrections,void}` (izin `forms.response.*` + `write_roles` + relasi pasien)  |
| Audit                     | Koreksi = `correct` + alasan + kunci field yang berubah (tanpa nilai). `GET /audit/events/:seq` menghitung `change` (diff, penulis asli, pengoreksi) dari dua versi isian dan mencatat pembukaannya                 |

Aturan saat menambah formulir atau layar isian: validasi isian selalu terhadap versi definisi milik isian itu (bukan versi berlaku), ambil versi terkini lewat `supersededBy: { none: {} }` atau view `form_responses_current`, baca riwayat per kelompok rekam medis (`FormsRepository.patientGroup`), dan jangan pernah menulis nilai isian ke `details` audit.

### Dokumen dan TTE (P08)

Berkas di penyimpanan objek, metadata di `documents`, tanda tangan di `document_signatures` (ADR-0020).

| Bagian                              | Isi                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@simrs/shared` → `documents`       | Jenis dokumen, jenis berkas dari magic bytes (`detectDocumentType`), `sanitizeFileName`, skema API, kode verifikasi `sv1.<tenant>.<acak>`                                     |
| `infra/object-storage.ts`           | `ObjectStorage` + `DiskObjectStorage` (`STORAGE_DRIVER=disk`, `STORAGE_DISK_ROOT`); kunci `<tenant>/<tahun>/<bulan>/<uuid>` selalu buatan server                              |
| `common/raw-upload.middleware.ts`   | Body biner unggahan dibaca sebelum transaksi dibuka (koneksi pool tidak ditahan klien lambat); batas 10 MB → 413 setelah klien selesai mengirim                               |
| `documents` / `document_signatures` | Trigger: dokumen tidak bisa diubah/dihapus, batal sekali beralasan, tidak untuk dokumen yang ditandatangani; hash tanda tangan = hash dokumen; `signed` terkunci              |
| API `modules/documents/`            | `POST/GET /patients/:id/documents`, `GET /documents/:id[/content]`, `POST /documents/:id/void`, `POST /documents/:id/signatures`; publik `GET /verification/signatures/:code` |
| Worker `outbox/tte.ts`              | `tte.sign`: kirim hash + ID penanda tangan ke `/tte/sign`, simpan hasil atomik, audit `system`                                                                                |
| Web `app/verifikasi/[code]/`        | Halaman verifikasi QR publik (dikecualikan dari login di `proxy.ts`)                                                                                                          |

Unggah dari web: kirim isi berkas sebagai `application/octet-stream` dengan header `X-Document-Kind`, `X-Document-Title`, `X-Document-Filename` (UTF-8 di-percent-encode). Header dan query tidak masuk log API; judul dokumen bisa memuat PHI, jadi jangan pernah taruh di path URL.

### Notifikasi (P09)

`NotificationsService.notify(penerima, { kind, title, body, link }, kanal)` dipanggil di dalam transaksi modul lain (contoh: akses darurat). Ia menulis `notifications` (in-app) lalu mengantrekan `notify.email` / `notify.whatsapp` ke outbox dengan payload ID saja (ADR-0021).

- Isi tanpa PHI; `link` wajib path internal (`notificationLinkSchema`).
- API: `GET /notifications?unread=&limit=`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all` (hanya milik sendiri).
- Worker `outbox/notify.ts`: alamat dibaca saat kirim, no. HP didekripsi (`staff_phone`), akun nonaktif/tanpa alamat dilewati, respons tidak disimpan.
- Mock: `POST /email/send`, `POST /whatsapp/send`, kotak masuk `GET /messages` dan panel.
- Web: lonceng di header (`components/notification-bell.tsx`, jumlah dari layout), halaman `app/(staf)/notifikasi/`.

### Anatomi modul

Contoh nyata: `apps/api/src/modules/tenancy/`.

| Berkas                  | Tanggung jawab                                          | Boleh                                              | Tidak boleh                             |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| `tenancy.controller.ts` | Rute, guard, pipe validasi                              | memanggil service                                  | menyentuh Prisma, menulis aturan bisnis |
| `tenancy.service.ts`    | Aturan bisnis, lempar `AppError` berkode                | memanggil repository dan service publik modul lain | menyentuh Prisma langsung               |
| `tenancy.repository.ts` | Akses data lewat `TenantDb.tx()` (transaksi permintaan) | Prisma, `select` eksplisit                         | aturan bisnis                           |
| `tenancy.module.ts`     | Mendaftarkan semuanya                                   |                                                    |                                         |

Modul lain hanya boleh memakai yang diekspor di `*.module.ts`, bukan mengimpor repository modul lain.

`modules/dev-tools/` berisi endpoint bantu pengembangan (`POST /api/v1/dev/outbox-ping`, `GET /api/v1/dev/outbox/:id`). Modul ini **tidak didaftarkan** di produksi, jadi rutenya tidak ada sama sekali.

### Galat dan kode stabil

`AppError(code, message, status, details?)` dari `@simrs/shared` adalah cara resmi melempar galat bisnis. `AppErrorFilter` (`src/common/error.filter.ts`) menerjemahkan semua jenis galat:

| Sumber                   | Kode                                      | HTTP                 |
| ------------------------ | ----------------------------------------- | -------------------- |
| `AppError`               | sesuai yang dilempar                      | sesuai yang dilempar |
| `ZodError`               | `VALIDATION_FAILED` + daftar field        | 400                  |
| RLS tanpa konteks        | `TENANT_REQUIRED`                         | 400                  |
| JSON rusak / body > 1 MB | `VALIDATION_FAILED` / `PAYLOAD_TOO_LARGE` | 400 / 413            |
| Rate limit               | `RATE_LIMITED`                            | 429                  |
| Lainnya                  | `INTERNAL_ERROR` (pesan generik)          | 500                  |

Untuk galat 500, log hanya mencatat **nama, kode, dan frame stack**. Pesan galat dibuang karena galat Prisma bisa mencetak nilai data (`sanitizeForLog`). Daftar kode ada di `packages/shared/src/errors.ts`; tambahkan kode baru di sana, jangan mengarang string di modul.

### Log

pino via `nestjs-pino`. Yang dicatat per permintaan hanya: id, metode, path tanpa query string, status, dan durasi. Header `authorization` dan `cookie` disamarkan. Jangan menulis nama, NIK, diagnosis, atau isi body ke log.

## Database

### Role

| Role             | Dipakai oleh                   | Hak                                                               |
| ---------------- | ------------------------------ | ----------------------------------------------------------------- |
| `postgres`       | `infra/postgres/init.sql` saja | superuser                                                         |
| `simrs_migrator` | migrasi, seed, persiapan tes   | pemilik tabel; tetap tunduk RLS di tabel domain (`FORCE`)         |
| `simrs_app`      | API dan worker saat berjalan   | `SELECT/INSERT/UPDATE/DELETE` sesuai GRANT, **tanpa** `BYPASSRLS` |

### Skema dan migrasi

- Model Prisma: `packages/db/prisma/schema.prisma`. Klien dibangkitkan ke `packages/db/src/generated` (tidak di-commit).
- Migrasi: `packages/db/prisma/migrations/<timestamp>_<nama>/migration.sql`. Bagian `CREATE TABLE` dibangkitkan Prisma; **blok RLS, GRANT, trigger, dan fungsi ditulis manual** di berkas yang sama. Contohnya di migrasi `20261003000000_fondasi`.
- Migrasi yang sudah diterapkan tidak diubah. Perbaikan selalu migrasi baru (contoh: `20261003010000_tenants_registry_owner_read`).
- Waktu: kolom `timestamptz`, sesi Prisma selalu UTC (`createPrismaClient`), tampilan dan pengelompokan per hari **eksplisit** Asia/Jakarta (`jakartaParts` di aplikasi, `AT TIME ZONE 'Asia/Jakarta'` di SQL). Jangan mengandalkan zona server: adapter `pg` Prisma menggeser waktu bila zona sesi bukan UTC (ADR-0014, tes `packages/db/test/time-zone.test.ts`).

### Fungsi database

| Fungsi                     | Guna                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_current_tenant()`     | Dipanggil semua kebijakan RLS. Melempar `TENANT_REQUIRED` bila `app.tenant_id` kosong.                                                         |
| `app_active_tenant_ids()`  | `SECURITY DEFINER`, hanya mengembalikan ID tenant aktif untuk worker (ADR-0008).                                                               |
| `app_reject_mutation()`    | Trigger yang menolak `UPDATE`/`DELETE` di tabel append-only (`audit_events`).                                                                  |
| `app_audit_chain()`        | Trigger `BEFORE INSERT` audit: menetapkan `seq`, waktu server, `prev_hash`, dan `hash` (sha256 dari bentuk kanonik) di bawah kunci per tenant. |
| `app_verify_audit_chain()` | Mengembalikan jumlah baris yang diperiksa dan `seq` pertama yang rusak (NULL bila utuh).                                                       |

### Helper di `@simrs/db`

| Ekspor                                            | Guna                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `createPrismaClient({ connectionString })`        | Klien Prisma 7 dengan driver adapter `pg`; sesi database selalu ber-zona UTC (ADR-0014).                 |
| `withTenant(prisma, tenantId, fn)`                | Transaksi + `SET LOCAL app.tenant_id`. Dipakai interceptor permintaan API, worker, dan seed.             |
| `allocateNumber(tx, tenantId, kind)`              | P08 · Nomor dokumen berikutnya (No. RM, kunjungan, invoice, jurnal); atomik, batal bila transaksi batal. |
| `isModuleEnabled(tx, code)`                       | P10 · Modul aktif untuk tenant (baris `tenant_modules` atau bawaan katalog).                             |
| `verifyAuditChain(tx)`                            | P04 · Periksa hash berantai audit tenant aktif.                                                          |
| `ensureSystemRoles(tx, tenantId)`                 | P03 · Buat 16 peran sistem + matriks bawaan bila belum ada (idempoten, tidak menimpa penyesuaian RS).    |
| `roleGrantScope(tx, role, resource, action)`      | P03 · Lingkup izin peran untuk satu aksi, atau `null`.                                                   |
| `roleGrants(tx, role)`                            | P03 · Seluruh izin satu peran (`sumber.aksi` → lingkup) dalam satu kueri; dipakai cache matriks API.     |
| `syncRolePermissions(tx, tenantId, kind, opts)`   | P03 · Tambah izin yang baru di katalog ke peran RS yang sudah ada (CLI `db:sync-permissions`; `dryRun`). |
| `activeAssignments(tx, userId)`                   | P03 · Penugasan pengguna yang berlaku sekarang.                                                          |
| `lockTenantScope(tx, scope)`                      | Kunci transaksi per tenant untuk aturan lintas baris (cegah write skew), mis. "minimal satu admin".      |
| `insertPatient(tx, crypto, record)`               | P05 · Rekam medis baru: nomor RM, nama ternormalisasi, kontak dan identifier terenkripsi + hash.         |
| `detectDuplicates(tx, crypto, patientId)`         | P05 · Hitung ulang kandidat rekam medis ganda satu pasien (ambil `lockMpi` sendiri).                     |
| `lockMpi(tx)`                                     | P05 · Kunci MPI per tenant; ambil sebelum mengunci baris pasien di alur yang menulis antrean.            |
| `searchConcepts` · `getConcept` · `listRegions`   | P06 · Baca data rujukan global (skema `ref`).                                                            |
| `importConcepts` · `importRegions` · `csvRecords` | P06 · Impor gagal-tertutup dari CSV (dipakai CLI dan seed).                                              |
| `enqueueOutbox(tx, tenantId, envelope)`           | Tulis pesan outbox di transaksi domain; idempoten per kunci.                                             |
| `claimDueOutbox(tx, limit, now)`                  | Ambil pesan jatuh tempo + lease (`SKIP LOCKED`).                                                         |
| `recordOutboxAttempt(tx, msg, result)`            | Catat percobaan; tentukan `sent` / `failed` + jadwal ulang / `dead`.                                     |
| `@simrs/db/testing` → `prepareTestDatabase()`     | Persiapan tes **tidak destruktif**: `migrate deploy` + upsert tenant fiktif ke `simrs_test`.             |

## Worker

Berkas di `apps/worker/src/outbox/`:

1. `outbox.scheduler.ts` mendaftarkan _job scheduler_ BullMQ `outbox-dispatch` (tiap `OUTBOX_POLL_MS`, default 2000 ms) dengan concurrency 1.
2. `outbox.dispatcher.ts` → `dispatchOnce()`: ambil daftar tenant → per tenant klaim pesan dalam transaksi singkat → siapkan permintaan (`prepare`, boleh membaca DB tenant) → kirim **di luar** transaksi → catat hasil di transaksi baru, bersama pemrosesan respons (`onSuccess`) secara atomik.
3. `http-connector.ts` mengirim HTTP dengan header `Idempotency-Key` dan batas waktu, lalu mengklasifikasikan hasil (`classifyStatus`): 2xx terkirim; 5xx/408/425/429/jaringan dicoba ulang; 4xx lain permanen.
4. `operations.ts` memetakan nama operasi → `{ prepare, onSuccess?, sensitive? }` (tipe di `operation-types.ts`).

| Operasi               | Isi                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ping`                | Uji saluran ke `/<sistem>/_echo` di mock.                                                                                                                                      |
| `dukcapil.nik.verify` | P05 · Payload `{ patientId, identifierId }`; NIK dibaca + didekripsi saat dikirim ke `/dukcapil/verify-data`; hasil `verified`/`mismatch`/`not_found` + audit pelaku `system`. |

Payload outbox tidak boleh memuat PHI; worker memegang kunci kolom yang sama dengan API (ADR-0017). Konektor nyata per sistem ditambahkan di fase 2–7 dengan pola yang dijelaskan di `docs/06-integrasi.md`.

## Mock

`apps/mock/src/`:

| Berkas                            | Isi                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `server.ts`                       | Membangun Fastify; hook skenario per sistem (normal, lambat, gagal, acak); log 50 request; penerima `_echo` |
| `systems/*.ts`                    | Satu berkas per sistem: `bpjs`, `eklaim`, `satusehat`, `dukcapil`, `tte`, `tpdi`, `btn`                     |
| `panel/panel.ts`, `panel/html.ts` | API dan HTML panel kendali                                                                                  |
| `state.ts`                        | State di memori (hilang saat restart, disengaja)                                                            |
| `fixtures.ts`                     | Data fiktif deterministik dari NIK                                                                          |
| `config.ts`                       | Env + titik injeksi untuk tes (`sendWebhook`, `now`, `random`)                                              |

## Web

`apps/web/src/`:

| Path                          | Isi                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx`              | Root: font IBM Plex, `lang="id"`, CSS global                                                                                  |
| `proxy.ts`                    | Proxy Next 16: belum login → `/masuk?lanjut=…`; cookie akses habis → perbarui sesi sekali (aman untuk paralel)                |
| `app/masuk/`                  | Layar masuk: `page.tsx` (menentukan langkah di server), `actions.ts` (Server Action), `steps.tsx` (formulir)                  |
| `app/(staf)/layout.tsx`       | Kerangka staf: identitas, unit, dan menu sesuai izin dari sesi; tombol Keluar                                                 |
| `app/(staf)/page.tsx`         | Beranda; status `/ready` hanya untuk operator platform                                                                        |
| `app/(staf)/sistem/akses/`    | Layar Pengguna & akses (P03): `page.tsx` (data dari API, filter lewat URL), `actions.ts`, formulir klien                      |
| `app/(staf)/sistem/audit/`    | Layar Audit (P04): jejak + filter lewat URL, panel detail/temuan/akses darurat, `ekspor/route.ts` (unduh CSV lewat BFF)       |
| `app/(staf)/rekam-medis/mpi/` | Layar MPI (P05): antrean, `compare-panel.tsx` (pilih sumber per atribut, keputusan, batal), `actions.ts`                      |
| `app/(staf)/sistem/formulir/` | Pustaka formulir + pembuat formulir (P07): `[code]/form-builder.tsx` (palet, kanvas + pratinjau skor, properti), `actions.ts` |
| `app/(staf)/superadmin/…`     | Area superadmin (peran `superadmin_platform`): panduan ini                                                                    |
| `app/(staf)/dev/ui/`          | Galeri token dan komponen (Fondasi), juga khusus operator platform                                                            |
| `lib/server/`                 | Lapisan akses data (DAL): `api.ts`, `session.ts`, `cookies.ts`, `refresh.ts`, `schemas.ts`, `web-env.ts`                      |
| `lib/server/demo-guard.ts`    | Gerbang mode presentasi (ADR-0023): `requireDemoScreen()` untuk halaman, `assertDemo()` untuk Server Action                   |
| `lib/screens.ts`              | Registri layar fase 2–10: rute, mockup, status `belum`/`demo`/`api`, posisi pemakai di mode presentasi                        |
| `lib/nav.ts`                  | Menu dan rute; `requires` = izin yang dibutuhkan agar menu tampil; layar fase 2–10 mengikuti `lib/screens.ts`                 |
| `lib/guide.ts`                | Daftar halaman panduan, pembaca berkas, daftar isi                                                                            |
| `lib/forms.ts`                | Operasi skema formulir untuk pembuat formulir (tambah/geser/hapus field, opsi, logika tampil, ringkasan kategori skor)        |

Aturan web:

- Komponen **server** secara default. `'use client'` hanya untuk yang butuh interaksi (sidebar, formulir, tab, galeri Fondasi).
- Komponen klien tidak membaca env atau rahasia; keputusan dibuat di server lalu dikirim sebagai prop.
- Web adalah **BFF** (ADR-0013): browser tidak pernah memegang token API. Semua panggilan API lewat `api()` di `lib/server/api.ts` (token dari cookie httpOnly, IP/host/user agent klien diteruskan). Respons API divalidasi skema di `lib/server/schemas.ts`; respons di luar bentuk itu ditolak.
- Setiap halaman staf memanggil `requireSession()` (atau `requireSuperadmin()`), **tidak cukup** di layout saja: layout tidak dirender ulang saat navigasi dan tidak menghentikan halaman anaknya.
- Setiap Server Action memeriksa input dan sesinya sendiri (action = endpoint POST publik), dan hanya mengembalikan pesan untuk UI.
- `next.config.ts` memasang header keamanan dan hanya mengambil `APP_ENV`, `API_BASE_URL`, `WEB_BASE_URL`, `LOGIN_TENANT_CODE`, `DATA_SOURCE` dari `.env` root.
- Kode runtime web tidak boleh mengimpor `@simrs/db` (aturan ESLint `no-restricted-imports`); paket itu hanya untuk tes/E2E.

### Mode presentasi dan data dummy (ADR-0023)

Layar fase 2–10 dibangun di rute finalnya sebelum backend ada, dengan data dummy fiktif:

- `webEnv().dataSource` bernilai `demo` hanya bila `APP_ENV=local` dan `DATA_SOURCE=demo` (`pnpm dev:demo`). Di luar itu `api`.
- Halaman ber-data dummy diawali `const { session, allowed } = await requireDemoScreen('<id>')`: render dinamis, 404 di luar mode demo, dan `allowed=false` bila posisi aktif bukan pemakai layar (tampilkan ajakan "Ganti posisi"). Setiap Server Action ber-data dummy memanggil `assertDemo()`.
- Status layar di `lib/screens.ts`: `belum` → `demo` saat layar dibangun → `api` saat backend tersambung. Menu mengikuti status ini; posisi yang bukan pemakai tidak melihat menunya di mode demo.
- Skema respons per domain ditulis di `packages/shared/src/schemas/<domain>.ts` (kontrak yang nanti dipenuhi API); halaman mengambil data lewat `lib/server/data/<domain>.ts`, yang memilih fixture (`lib/demo/`) atau API.
- Server E2E ketiga (`next start` port 3011, `DATA_SOURCE=demo`) menjalankan spesifikasi di `apps/web/e2e/demo/`; suite lain tetap di mode `api`.

### Panduan superadmin (halaman ini)

- Konten = berkas `docs/panduan/*.md`. Daftar halaman tetap di `GUIDE_PAGES` (`lib/guide.ts`); slug dari URL hanya dicocokkan dengan daftar itu, tidak pernah dipakai sebagai path berkas.
- Dirender oleh `components/markdown.tsx` (react-markdown + GFM) sebagai komponen server. HTML mentah di Markdown **tidak** dirender, jadi konten tidak bisa menyisipkan skrip.
- Tautan antar-berkas (`./02-cara-kerja-kode.md#…`) otomatis menjadi rute aplikasi, sehingga tautan bekerja di GitHub maupun di aplikasi.
- Gerbang: `requireSuperadmin()` di `lib/server/session.ts`: tenant `platform` + izin `platform.guide.read` (peran `superadmin_platform`, ADR-0013). Selain itu 404.

### Sesi web dan alur masuk

```
/masuk  langkah 1  loginAction ──► POST /auth/login ──► cookie tantangan MFA (5 menit)  atau  sesi terbatas (belum MFA)
        langkah 2  verifyMfaAction ──► POST /auth/mfa/verify ──► cookie sesi (akses + refresh)
                   (akun baru) startEnrollmentAction → QR (uqr, data URI) → confirmEnrollmentAction
                   (sandi sementara) changePasswordAction ──► POST /auth/password
        langkah 3  selectUnitAction ──► POST /auth/assignment ──► redirect ke ?lanjut (divalidasi safeNextPath)
halaman staf       proxy: cookie akses habis + refresh ada → refreshSession() sekali per token → cookie baru
                   requireSession() → GET /auth/me (sekali per render) → identitas, peran, unit, izin
```

| Hal                  | Aturan                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie               | `simrs_at` (akses), `simrs_rt` (refresh), `simrs_mfa*` (tantangan). httpOnly, SameSite=Lax, path /; di luar lokal Secure + `__Host-`.             |
| Umur cookie akses    | 60 detik lebih pendek dari token akses, agar proxy sempat memperbarui sebelum API menolak.                                                        |
| Refresh paralel      | `refreshSession()` menyimpan janji per hash refresh token selama 30 detik: banyak permintaan, satu panggilan API. Hanya berlaku satu instans web. |
| Tujuan setelah login | `?lanjut=` hanya path internal (`safeNextPath`: tanpa `//`, skema, backslash, karakter kendali).                                                  |
| IP klien ke API      | Entri paling kanan `X-Forwarded-For` (ditambahkan reverse proxy tepercaya). API mempercayainya hanya dari alamat `TRUST_PROXY`.                   |
| Menu                 | Dari `permissions` di `/auth/me` (kenyamanan saja); izin tetap ditegakkan API.                                                                    |

## UI dan sistem desain

- Token ada di `packages/ui/src/theme.css` sebagai tema Tailwind v4, misalnya `bg-brand-600`, `text-ink-700`, `rounded-card`. Sumbernya `design/tokens.json`.
- Komponen dasar: `AppShell`, `Sidebar`, `Button`, `Field`, `Chip`/`StatusChip`/`FilterChip`, `Alert`, `Card`/`KpiCard`, `Tabs`, `PatientBanner`, `Icon`.
- Layar dibangun dengan membaca mockup `design/mockups/<Layar>.dc.html` (markup + blok `<script type="text/x-dc">`), lalu ditulis ulang sebagai React. Jangan menyalin runtime mockup.

## Paket shared

| Modul                            | Isi utama                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `money.ts`                       | Uang = `bigint` rupiah. `formatRupiah(1250400n)` → `Rp 1.250.400`. Float ditolak.                 |
| `datetime.ts`                    | `formatTanggalWaktu()` → `Sen, 5 Okt 2026 · 07.10` (Asia/Jakarta), `periodYYMM()` untuk penomoran |
| `env.ts`                         | Potongan skema env, `parseEnv()`, `devToolsAllowed()`                                             |
| `errors.ts`                      | `ERROR_CODES`, `AppError`, skema body galat                                                       |
| `ids.ts`                         | `newId()` UUID v7                                                                                 |
| `outbox.ts`                      | Target integrasi, status, `backoffDelayMs()`, skema amplop                                        |
| `components.ts`                  | 81 kode komponen (dibangkitkan dari `docs/02-katalog-komponen.md`)                                |
| `node.ts` (`@simrs/shared/node`) | Kripto khusus Node: tanda tangan + enkripsi BPJS, HMAC TPDI                                       |

## Strategi tes

| Jenis            | Lokasi                                                                                                                                   | Butuh            | Perintah                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------- |
| Unit             | `packages/shared`, `packages/ui`, `apps/web/src/**/*.test.ts`, `apps/api/test/error-filter.test.ts`, `apps/worker/test/classify.test.ts` | –                | `pnpm test`                         |
| Integrasi DB     | `packages/db/test` (RLS, append-only, outbox)                                                                                            | Postgres         | `pnpm --filter @simrs/db test`      |
| Integrasi API    | `apps/api/test` (HTTP sungguhan + DB)                                                                                                    | Postgres         | `pnpm --filter @simrs/api test`     |
| Integrasi worker | `apps/worker/test`                                                                                                                       | Postgres + Redis | `pnpm --filter @simrs/worker test`  |
| Mock             | `apps/mock/src/mock.test.ts`                                                                                                             | –                | `pnpm --filter @simrs/mock test`    |
| E2E              | `apps/web/e2e` (Playwright, Edge di Windows): API :4010 + web build :3010 di DB `simrs_test`, akun uji dibuat langsung di DB             | Postgres         | `pnpm --filter @simrs/web test:e2e` |

Aturan:

- Tes integrasi memakai database **`simrs_test`** (bukan `simrs`). Persiapannya tidak menghapus data; setiap tes memakai ID/kunci unik.
- Setiap modul baru wajib punya tes **isolasi tenant** (tenant B tidak melihat data tenant A) dan tes **izin** dengan token sungguhan (peran tak berhak → 403; lihat `apps/api/test/authz.test.ts`).
- Tes yang butuh infrastruktur gagal dengan pesan jelas bila infrastruktur mati. Tes tidak boleh dilewati diam-diam atau dilemahkan agar hijau.

## Konvensi

| Hal             | Aturan                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------- |
| Bahasa          | Teks UI dan dokumen: Bahasa Indonesia. Kode, nama variabel, commit: Inggris.              |
| ID              | UUID v7 dari aplikasi (`newId()`)                                                         |
| Waktu           | `timestamptz` di DB (sesi UTC), ISO 8601 di API, tampilan Asia/Jakarta                    |
| Uang            | `bigint` rupiah, tanpa desimal; setiap mutasi uang menghasilkan jurnal seimbang (fase 5)  |
| DB              | `snake_case`, tabel jamak, FK `<entitas>_id`, setiap tabel domain punya `tenant_id` + RLS |
| REST            | `/api/v1/<konteks>/<sumber>`, daftar dengan paginasi kursor                               |
| Commit          | Conventional Commits, sebut kode komponen di badan commit                                 |
| Dependensi baru | Besar (ORM, state manager, UI kit) wajib ADR di `docs/adr/`                               |

## Daftar periksa keamanan per perubahan

- [ ] Controller data tenant memakai `@TenantScoped()`; repository memakai `TenantDb`; kode di luar permintaan (worker, seed) memakai `withTenant`. Tidak ada koneksi role migrator di runtime.
- [ ] Setiap endpoint bertenant diberi `@RequirePermission(resource, action)`; data pasien dibuka lewat `PatientAccessService.assert()`.
- [ ] Aturan yang menghitung banyak baris (mis. "minimal satu admin") memakai `lockTenantScope` agar aman saat paralel.
- [ ] Perubahan data diberi `@Audited` (akses data pasien wajib menyertakan `patientId`).
- [ ] FK antar-tabel tenant memakai pasangan `(tenant_id, id)`.
- [ ] Tabel domain baru: `tenant_id` + `ENABLE` + `FORCE` RLS + kebijakan `tenant_isolation` + GRANT minimal.
- [ ] Input divalidasi zod (`strictObject` untuk body); output memakai `select` eksplisit.
- [ ] Galat memakai `AppError` dengan kode dari `ERROR_CODES`; tidak ada detail internal ke klien.
- [ ] Tidak ada PHI (nama, NIK, diagnosis) di log atau pesan galat.
- [ ] Panggilan eksternal lewat outbox; tidak ada `fetch` ke sistem luar di dalam transaksi.
- [ ] Endpoint khusus pengembangan berada di modul yang hanya didaftarkan saat `devTools`.
- [ ] Tes isolasi tenant ada dan hijau.
- [ ] Tidak ada rahasia di kode atau commit (`.env` tidak pernah di-commit).
