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
Nest:     ThrottlerGuard (global) → TenantGuard (per controller) → pipe validasi (zod / ParseUUID)
          → Controller → Service → Repository → PrismaService.forTenant(tenantId, fn)
DB:       BEGIN · set_config('app.tenant_id', $1, true) · query (RLS aktif) · COMMIT
Galat:    di mana pun → AppErrorFilter → { code, message, details?, requestId }
```

### Anatomi modul

Contoh nyata: `apps/api/src/modules/tenancy/`.

| Berkas                  | Tanggung jawab                               | Boleh                                              | Tidak boleh                             |
| ----------------------- | -------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| `tenancy.controller.ts` | Rute, guard, pipe validasi                   | memanggil service                                  | menyentuh Prisma, menulis aturan bisnis |
| `tenancy.service.ts`    | Aturan bisnis, lempar `AppError` berkode     | memanggil repository dan service publik modul lain | menyentuh Prisma langsung               |
| `tenancy.repository.ts` | Akses data, selalu lewat `forTenant`         | Prisma, `select` eksplisit                         | aturan bisnis                           |
| `tenant-context.ts`     | `TenantGuard` + dekorator `@CurrentTenant()` |                                                    |                                         |
| `tenancy.module.ts`     | Mendaftarkan semuanya                        |                                                    |                                         |

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

| Fungsi                    | Guna                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `app_current_tenant()`    | Dipanggil semua kebijakan RLS. Melempar `TENANT_REQUIRED` bila `app.tenant_id` kosong. |
| `app_active_tenant_ids()` | `SECURITY DEFINER`, hanya mengembalikan ID tenant aktif untuk worker (ADR-0008).       |
| `app_reject_mutation()`   | Trigger yang menolak `UPDATE`/`DELETE` di tabel append-only (`audit_events`).          |

### Helper di `@simrs/db`

| Ekspor                                        | Guna                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `createPrismaClient({ connectionString })`    | Klien Prisma 7 dengan driver adapter `pg`.                                                   |
| `withTenant(prisma, tenantId, fn)`            | Transaksi + `SET LOCAL app.tenant_id`. Semua akses data domain lewat sini.                   |
| `enqueueOutbox(tx, tenantId, envelope)`       | Tulis pesan outbox di transaksi domain; idempoten per kunci.                                 |
| `claimDueOutbox(tx, limit, now)`              | Ambil pesan jatuh tempo + lease (`SKIP LOCKED`).                                             |
| `recordOutboxAttempt(tx, msg, result)`        | Catat percobaan; tentukan `sent` / `failed` + jadwal ulang / `dead`.                         |
| `@simrs/db/testing` → `prepareTestDatabase()` | Persiapan tes **tidak destruktif**: `migrate deploy` + upsert tenant fiktif ke `simrs_test`. |

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

| Path                      | Isi                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx`          | Root: font IBM Plex, `lang="id"`, CSS global                                                                    |
| `app/(staf)/layout.tsx`   | Kerangka staf (sidebar + konten). Keputusan akses superadmin dibuat di sini (server) lalu diteruskan ke sidebar |
| `app/(staf)/page.tsx`     | Beranda + status `/ready` API                                                                                   |
| `app/(staf)/superadmin/…` | Area superadmin: layout dengan gerbang akses, panduan ini                                                       |
| `app/(staf)/dev/ui/`      | Galeri token dan komponen (Fondasi)                                                                             |
| `components/`             | Komponen khusus web: `staff-sidebar.tsx`, `markdown.tsx`                                                        |
| `lib/nav.ts`              | Menu dan rute (nyalakan `available: true` saat layar selesai)                                                   |
| `lib/access.ts`           | Gerbang area superadmin                                                                                         |
| `lib/guide.ts`            | Daftar halaman panduan, pembaca berkas, daftar isi                                                              |
| `lib/api.ts`              | Klien API bertipe (respons divalidasi zod)                                                                      |

Aturan web:

- Komponen **server** secara default. `'use client'` hanya untuk yang butuh interaksi (sidebar, tab, galeri Fondasi).
- Komponen klien tidak membaca env atau rahasia; keputusan dibuat di server lalu dikirim sebagai prop.
- `next.config.ts` memasang header keamanan dan hanya mengambil `APP_ENV`, `API_BASE_URL`, `WEB_BASE_URL` dari `.env` root.

### Panduan superadmin (halaman ini)

- Konten = berkas `docs/panduan/*.md`. Daftar halaman tetap di `GUIDE_PAGES` (`lib/guide.ts`); slug dari URL hanya dicocokkan dengan daftar itu, tidak pernah dipakai sebagai path berkas.
- Dirender oleh `components/markdown.tsx` (react-markdown + GFM) sebagai komponen server. HTML mentah di Markdown **tidak** dirender, jadi konten tidak bisa menyisipkan skrip.
- Tautan antar-berkas (`./02-cara-kerja-kode.md#…`) otomatis menjadi rute aplikasi, sehingga tautan bekerja di GitHub maupun di aplikasi.
- Gerbang: `superadminAccess()` di `lib/access.ts`. Fase 1 menggantinya dengan sesi + peran `superadmin_platform` (ADR-0010).

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
| E2E              | `apps/web/e2e` (Playwright, Edge di Windows)                                                                                             | web jalan        | `pnpm --filter @simrs/web test:e2e` |

Aturan:

- Tes integrasi memakai database **`simrs_test`** (bukan `simrs`). Persiapannya tidak menghapus data; setiap tes memakai ID/kunci unik.
- Setiap modul baru wajib punya tes **isolasi tenant** (tenant B tidak melihat data tenant A) dan tes **izin** (peran tak berhak → 403, mulai fase 1).
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

- [ ] Semua akses data lewat `forTenant` / `withTenant`; tidak ada koneksi role migrator di runtime.
- [ ] Tabel domain baru: `tenant_id` + `ENABLE` + `FORCE` RLS + kebijakan `tenant_isolation` + GRANT minimal.
- [ ] Input divalidasi zod (`strictObject` untuk body); output memakai `select` eksplisit.
- [ ] Galat memakai `AppError` dengan kode dari `ERROR_CODES`; tidak ada detail internal ke klien.
- [ ] Tidak ada PHI (nama, NIK, diagnosis) di log atau pesan galat.
- [ ] Panggilan eksternal lewat outbox; tidak ada `fetch` ke sistem luar di dalam transaksi.
- [ ] Endpoint khusus pengembangan berada di modul yang hanya didaftarkan saat `devTools`.
- [ ] Tes isolasi tenant ada dan hijau.
- [ ] Tidak ada rahasia di kode atau commit (`.env` tidak pernah di-commit).
