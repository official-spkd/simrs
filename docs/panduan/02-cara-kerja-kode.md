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
POST /api/v1/auth/login       { tenantCode?, username, password }
  → RS dari subdomain (produksi) atau tenantCode (lokal/staging)
  → kata sandi argon2id benar?  ya → { status: 'mfa_required', challengeToken }   (tantangan 5 menit, maks 5 percobaan)
                                 ya, belum punya MFA → { status: 'mfa_enrollment_required', accessToken, … }  (sesi terbatas)
                                 tidak → hitungan gagal + audit di-commit, lalu 401 (pesan seragam)
POST /api/v1/auth/mfa/verify  { challengeToken, code } → { accessToken, refreshToken, … }
POST /api/v1/auth/refresh     { refreshToken } → token baru (rotasi; token lama dipakai lagi → sesi dicabut)
```

| Bagian             | Berkas                                  | Catatan                                                                                                                          |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Format token       | `infra/auth/session-tokens.ts`          | `sa1`/`sr1`/`sc1`.`<tenant>`.`<id>`.`<rahasia>`; DB hanya menyimpan hash                                                         |
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
- Perubahan matriks diaudit sebagai selisih (`added`/`removed`) dan berlaku di permintaan berikutnya.

Mode header pengembang memakai peran `DEV_ROLE` yang melewati matriks, jadi **jangan dipakai untuk menguji izin**. Tes izin memakai token sungguhan: `createTestUser(TENANT_A, { roles: [{ code: 'perawat' }] })` lalu `login(app, user)`. Contoh lengkapnya di `apps/api/test/authz.test.ts`.

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

### Fungsi database

| Fungsi                     | Guna                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_current_tenant()`     | Dipanggil semua kebijakan RLS. Melempar `TENANT_REQUIRED` bila `app.tenant_id` kosong.                                                         |
| `app_active_tenant_ids()`  | `SECURITY DEFINER`, hanya mengembalikan ID tenant aktif untuk worker (ADR-0008).                                                               |
| `app_reject_mutation()`    | Trigger yang menolak `UPDATE`/`DELETE` di tabel append-only (`audit_events`).                                                                  |
| `app_audit_chain()`        | Trigger `BEFORE INSERT` audit: menetapkan `seq`, waktu server, `prev_hash`, dan `hash` (sha256 dari bentuk kanonik) di bawah kunci per tenant. |
| `app_verify_audit_chain()` | Mengembalikan jumlah baris yang diperiksa dan `seq` pertama yang rusak (NULL bila utuh).                                                       |

### Helper di `@simrs/db`

| Ekspor                                        | Guna                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `createPrismaClient({ connectionString })`    | Klien Prisma 7 dengan driver adapter `pg`.                                                               |
| `withTenant(prisma, tenantId, fn)`            | Transaksi + `SET LOCAL app.tenant_id`. Dipakai interceptor permintaan API, worker, dan seed.             |
| `allocateNumber(tx, tenantId, kind)`          | P08 · Nomor dokumen berikutnya (No. RM, kunjungan, invoice, jurnal); atomik, batal bila transaksi batal. |
| `isModuleEnabled(tx, code)`                   | P10 · Modul aktif untuk tenant (baris `tenant_modules` atau bawaan katalog).                             |
| `verifyAuditChain(tx)`                        | P04 · Periksa hash berantai audit tenant aktif.                                                          |
| `ensureSystemRoles(tx, tenantId)`             | P03 · Buat 16 peran sistem + matriks bawaan bila belum ada (idempoten, tidak menimpa penyesuaian RS).    |
| `roleGrantScope(tx, role, resource, action)`  | P03 · Lingkup izin peran untuk satu aksi, atau `null`.                                                   |
| `activeAssignments(tx, userId)`               | P03 · Penugasan pengguna yang berlaku sekarang.                                                          |
| `lockTenantScope(tx, scope)`                  | Kunci transaksi per tenant untuk aturan lintas baris (cegah write skew), mis. "minimal satu admin".      |
| `enqueueOutbox(tx, tenantId, envelope)`       | Tulis pesan outbox di transaksi domain; idempoten per kunci.                                             |
| `claimDueOutbox(tx, limit, now)`              | Ambil pesan jatuh tempo + lease (`SKIP LOCKED`).                                                         |
| `recordOutboxAttempt(tx, msg, result)`        | Catat percobaan; tentukan `sent` / `failed` + jadwal ulang / `dead`.                                     |
| `@simrs/db/testing` → `prepareTestDatabase()` | Persiapan tes **tidak destruktif**: `migrate deploy` + upsert tenant fiktif ke `simrs_test`.             |

## Worker

Berkas di `apps/worker/src/outbox/`:

1. `outbox.scheduler.ts` mendaftarkan _job scheduler_ BullMQ `outbox-dispatch` (tiap `OUTBOX_POLL_MS`, default 2000 ms) dengan concurrency 1.
2. `outbox.dispatcher.ts` → `dispatchOnce()`: ambil daftar tenant → per tenant klaim pesan dalam transaksi singkat → kirim **di luar** transaksi → catat hasil di transaksi baru.
3. `http-connector.ts` mengirim HTTP dengan header `Idempotency-Key` dan batas waktu, lalu mengklasifikasikan hasil (`classifyStatus`): 2xx terkirim; 5xx/408/425/429/jaringan dicoba ulang; 4xx lain permanen.

Fase 0 hanya mengenal operasi `ping` (ke `/<sistem>/_echo` di mock). Konektor nyata per sistem ditambahkan di fase 2–7 dengan pola yang dijelaskan di `docs/06-integrasi.md`.

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

| Path                      | Isi                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx`          | Root: font IBM Plex, `lang="id"`, CSS global                                                                   |
| `proxy.ts`                | Proxy Next 16: belum login → `/masuk?lanjut=…`; cookie akses habis → perbarui sesi sekali (aman untuk paralel) |
| `app/masuk/`              | Layar masuk: `page.tsx` (menentukan langkah di server), `actions.ts` (Server Action), `steps.tsx` (formulir)   |
| `app/(staf)/layout.tsx`   | Kerangka staf: identitas, unit, dan menu sesuai izin dari sesi; tombol Keluar                                  |
| `app/(staf)/page.tsx`     | Beranda; status `/ready` hanya untuk operator platform                                                         |
| `app/(staf)/superadmin/…` | Area superadmin (peran `superadmin_platform`): panduan ini                                                     |
| `app/(staf)/dev/ui/`      | Galeri token dan komponen (Fondasi), juga khusus operator platform                                             |
| `lib/server/`             | Lapisan akses data (DAL): `api.ts`, `session.ts`, `cookies.ts`, `refresh.ts`, `schemas.ts`, `web-env.ts`       |
| `lib/nav.ts`              | Menu dan rute; `requires` = izin yang dibutuhkan agar menu tampil                                              |
| `lib/guide.ts`            | Daftar halaman panduan, pembaca berkas, daftar isi                                                             |

Aturan web:

- Komponen **server** secara default. `'use client'` hanya untuk yang butuh interaksi (sidebar, formulir, tab, galeri Fondasi).
- Komponen klien tidak membaca env atau rahasia; keputusan dibuat di server lalu dikirim sebagai prop.
- Web adalah **BFF** (ADR-0013): browser tidak pernah memegang token API. Semua panggilan API lewat `api()` di `lib/server/api.ts` (token dari cookie httpOnly, IP/host/user agent klien diteruskan). Respons API divalidasi skema di `lib/server/schemas.ts`; respons di luar bentuk itu ditolak.
- Setiap halaman staf memanggil `requireSession()` (atau `requireSuperadmin()`), **tidak cukup** di layout saja: layout tidak dirender ulang saat navigasi dan tidak menghentikan halaman anaknya.
- Setiap Server Action memeriksa input dan sesinya sendiri (action = endpoint POST publik), dan hanya mengembalikan pesan untuk UI.
- `next.config.ts` memasang header keamanan dan hanya mengambil `APP_ENV`, `API_BASE_URL`, `WEB_BASE_URL` dari `.env` root.

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
| Waktu           | `timestamptz` di DB, ISO 8601 di API, tampilan Asia/Jakarta                               |
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
