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
infra/        skrip SQL init Postgres; backup/ = @simrs/backup (backup terenkripsi + uji restore, ADR-0071)
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
3. `AppModule.forRoot(env)` menyusun modul: Logger (pino), Infra (env, Prisma, Redis, penghitung batas laju), Throttler, Health, Tenancy, dan DevTools (hanya bila `devTools`).
4. `configureApp(app, env)` (`src/bootstrap.ts`), urutannya penting:
   header keamanan → matikan `X-Powered-By` → body JSON maks 1 MB → logger → prefix `/api/v1` (kecuali `/health`, `/ready`) → CORS (hanya `WEB_BASE_URL`) → Swagger (hanya `devTools`).
5. Batas waktu koneksi HTTP disetel, lalu server mendengar di `HOST:API_PORT` (default `127.0.0.1:4000`).

Tes memakai `configureApp` yang sama lewat `test/helpers.ts`, sehingga perilaku tes sama dengan runtime.

### Jalur satu permintaan

```
Express:  securityHeaders → CORS → body parser (1 MB) → pino-http (X-Request-Id)
Nest:     IpThrottlerGuard (global: per IP + endpoint kredensial)
          → AuthGuard (@TenantScoped: token → tenant, pengguna, peran) → UserThrottlerGuard (@TenantScoped: per pengguna)
          → pipe validasi (zod / ParseUUID)
          → TenantTransactionInterceptor:
              cek @RequirePermission (ditolak → audit access_denied di-commit lebih dulu, lalu 403)
              → BEGIN · set_config(app.tenant_id) · cek @RequireModule
              → Controller → Service → Repository (TenantDb.tx(), RLS aktif)
              → tulis audit (@Audited + TenantDb.audit) · COMMIT
Galat:    di mana pun → ROLLBACK (data + audit batal) → AppErrorFilter → { code, message, details?, requestId }
```

Satu permintaan = satu transaksi database. Konsekuensinya: data dan jejak auditnya selalu konsisten, nomor dokumen yang dialokasikan ikut batal bila permintaan gagal, dan **handler tidak boleh memanggil sistem eksternal** (transaksi masih terbuka) — kirim lewat outbox.

Pengecualian hanya untuk dua pola fase 2: lookup baca-saja ke BPJS/Dukcapil (ADR-0025) dan aliran SSE (ADR-0026). Keduanya memakai `@NoRequestTransaction()`, lihat [Lookup sinkron, SSE, dan event domain](#lookup-sinkron-sse-dan-event-domain-fase-2).

### Fondasi di `src/common` dan `src/infra`

| Berkas                                       | Isi                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `common/tenant-scoped.decorator.ts`          | `@TenantScoped()` = `AuthGuard` + `UserThrottlerGuard` + `TenantTransactionInterceptor` (+ bearer Swagger)          |
| `common/require-permission.decorator.ts`     | `@RequirePermission(resource, action)`: cek matriks peran; lingkupnya di `TenantDb.permissionScope()`               |
| `common/tenant-transaction.interceptor.ts`   | Satu transaksi ber-RLS per permintaan, cek `@RequireModule`, tulis audit sebelum commit                             |
| `common/request-context.ts`                  | Konteks permintaan (AsyncLocalStorage): tenant, transaksi, pelaku + peran, lingkup izin, antrean audit              |
| `infra/tenant-db.ts`                         | `TenantDb`: pintu repository ke transaksi permintaan; gagal keras bila dipakai di luar permintaan bertenant         |
| `common/audited.decorator.ts`                | `@Audited` + pembantu `resultId`, `paramId`, `param(name)`, `queryPatientId`, `changedFields`, `bodyReason`         |
| `common/require-module.decorator.ts`         | `@RequireModule(code)` untuk feature flag per RS                                                                    |
| `common/pagination.ts`                       | `toPage()` untuk paginasi kursor `{ items, nextCursor }`                                                            |
| `infra/rate-limit.ts`                        | Throttler `default` (IP), `auth` (kredensial), `user` (pengguna) + `IpThrottlerGuard`, `UserThrottlerGuard`         |
| `infra/rate-limit.storage.ts`                | `RateLimitStorage`: penghitung batas laju di Redis (Lua atomik), cadangan memori, gagal tertutup                    |
| `common/no-request-transaction.decorator.ts` | `@NoRequestTransaction()`: handler tanpa transaksi permintaan (hanya lookup ADR-0025 dan SSE ADR-0026)              |
| `infra/lookup/`                              | `LookupGateway` + antarmuka `LookupConnector` (lookup sinkron, batas 5 dtk, audit sebelum/sesudah)                  |
| `infra/realtime/`                            | `PgNotificationHub` (satu koneksi LISTEN per instans) + `SseService` (aliran SSE)                                   |
| `infra/events/`                              | `DomainEvents` (event domain sinkron di dalam transaksi) + daftar nama/payload di `domain-event-map.ts`             |
| `infra/auth/device.guard.ts`                 | `DeviceGuard` + `@DeviceScoped()` (`common/device-scoped.decorator.ts`): prinsipal perangkat anjungan/TV (ADR-0027) |

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
POST /api/v1/auth/mfa/backup-options { challengeToken } → { channels } yang diizinkan RS untuk akun ini (kosong = wajib aplikasi)
POST /api/v1/auth/mfa/backup-code { challengeToken, channel: whatsapp|email } → kode 6 digit lewat outbox (maks 3, jeda 30 dtk)
  → ditolak 403 (diaudit access_denied) bila kanal dimatikan RS atau akun memegang peran login.totp_only_roles
POST /api/v1/auth/mfa/verify  { challengeToken, code, trustDevice? } → { accessToken, refreshToken, …, trustedDevice }
POST /api/v1/auth/refresh     { refreshToken } → token baru (rotasi; token lama dipakai lagi → sesi dicabut)

PIN masuk cepat (ADR-0024, modules/auth/pin.controller.ts + pin.service.ts):
POST /api/v1/auth/pin/devices   (sesi penuh, bukan sesi PIN) { name, pin, password } → { id, token: 'sd1…', expiresAt }
  → hanya posisi layanan berunit (PIN_LOGIN_ROLES), bukan tenant PLATFORM, maks 5 per akun, PIN tidak lemah
GET  /api/v1/auth/pin/devices   → PIN aktif milik akun · POST /api/v1/auth/pin/devices/:id/revoke → hapus
POST /api/v1/auth/pin/accounts  { deviceTokens[] } → nama + posisi akun ber-PIN di peramban ini (layar masuk)
POST /api/v1/auth/pin/login     { deviceToken, pin } → { status: 'authenticated', accessToken, … }
  → percobaan dicadangkan + di-commit SEBELUM PIN diperiksa; salah ke-5 → PIN dicabut (details.pin = 'revoked')
  → sesi 2 jam, idle 5 menit, posisi terkunci ke posisi pendaftaran (auth_sessions.device_id)
POST /api/v1/iam/pin-devices/:id/revoke (iam.users.write) → admin mencabut PIN perangkat pengguna lain
POST /api/v1/iam/trusted-devices/:id/revoke (iam.users.write) → admin mencabut perangkat tepercaya (st1)
  → GET /api/v1/iam/users/:id memuat pinDevices + trustedDevices yang masih berlaku
Pengaturan RS (P12): pin.enabled, pin.allowed_roles, login.backup_code_channels, login.totp_only_roles;
  /auth/me → pin: { available, reason } (aturan + pengaturan RS, dihitung API; web hanya menampilkan)
```

| Bagian             | Berkas                                  | Catatan                                                                                                                                           |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format token       | `infra/auth/session-tokens.ts`          | `sa1`/`sr1`/`sc1`/`st1`/`sd1`.`<tenant>`.`<id>`.`<rahasia>`; DB hanya menyimpan hash (`st1` perangkat tepercaya, `sd1` PIN)                       |
| PIN perangkat      | `infra/auth/pin-devices.ts`             | tabel `registered_devices` (jenis `staff_pin`); PIN = argon2id dari HMAC kunci hash (`pin_key_id` = kunci ladanya); pencabutan bersama (ADR-0024) |
| Siklus sesi        | `infra/auth/session-store.ts`           | buat, validasi (idle, kedaluwarsa, akun nonaktif), rotasi, cabut                                                                                  |
| Guard              | `infra/auth/auth.guard.ts`              | dipasang `@TenantScoped()`; tenant dari sesi; header berbeda → `TENANT_MISMATCH`                                                                  |
| Sesi belum lengkap | `@AllowIncompleteSession()`             | hanya `/auth/me`, `/auth/logout`, `/auth/password`, `/auth/mfa/enroll*`; lainnya `403 MFA_REQUIRED` / `PASSWORD_CHANGE_REQUIRED`                  |
| Kripto             | `@simrs/shared/node`                    | `hashPassword`/`verifyPassword` (argon2id), `verifyTotp` (RFC 6238, anti-replay), `encryptField` (AES-256-GCM per tenant)                         |
| Kebijakan sandi    | `@simrs/shared` → `checkPasswordPolicy` | panjang ≥ pengaturan RS (min 12), bukan sandi umum, tanpa nama pengguna/kode RS                                                                   |
| Sandi bocor        | `@simrs/db` → `isBreachedPassword`      | `ref.breached_passwords` (SHA-1, diisi `pnpm db:import-breached`), kueri hanya rentang awalan 20 bit                                              |
| Batas laju         | `@AuthRateLimited()`                    | throttler `auth` (`AUTH_RATE_LIMIT_PER_MIN`, bawaan 10/menit per IP)                                                                              |

Mode header pengembang (`X-Tenant-Id` tanpa login) hanya hidup bila `APP_ENV=local` dan `ALLOW_DEV_TENANT_HEADER=true`; tes modul memakainya, tes auth memakai token sungguhan (`apps/api/test/helpers.ts` → `createTestUser`, `login`). Alasan desain: ADR-0011.

### Otorisasi (P03)

Izin = **sumber × aksi × lingkup**. Katalog sumber dan aksi ada di `packages/shared/src/authz.ts` (`PERMISSION_CATALOG`). Lingkupnya `all` (seluruh data RS), `unit` (unit kerja), atau `relationship` (hanya pasien yang punya relasi dengan pengguna).

| Bagian                      | Berkas                                                  | Catatan                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peran dan matriks bawaan    | `@simrs/shared` → `SYSTEM_ROLES`, `DEFAULT_ROLE_GRANTS` | 16 peran sistem, dibuat per RS oleh `ensureSystemRoles` (seed, persiapan tes). Matriks bawaan hanya diisi saat peran dibuat, jadi penyesuaian RS tidak pernah ditimpa. Bawaan mengikuti hak minimum.                                                                                                                                                                          |
| Penugasan                   | tabel `staff_assignments`                               | Pengguna × peran × unit × masa berlaku. Sesi memakai **satu** penugasan: otomatis bila hanya satu, selain itu dipilih pengguna (`GET /auth/assignments`, `POST /auth/assignment`). Penugasan berakhir → izin sesi hilang di permintaan berikutnya.                                                                                                                            |
| Pemeriksaan                 | `@RequirePermission(resource, action)`                  | Dicek interceptor sebelum transaksi permintaan. Ditolak → audit `access_denied` di-commit lebih dulu, lalu `403`. Lingkup yang lolos dibaca service lewat `TenantDb.permissionScope()`.                                                                                                                                                                                       |
| Cache matriks               | `infra/permission-matrix.ts`                            | Izin per tenant × peran di memori proses. Perubahan di layar Akses membuang cache setelah commit (`TenantDb.afterCommit`) lalu disiarkan ke instans lain (Redis pub/sub); TTL `AUTHZ_CACHE_TTL_SECONDS` (bawaan 30) = jaring pengaman. Redis putus → baca database. Penolakan tetap diaudit.                                                                                  |
| Akses pasien (ABAC)         | `modules/authz/patient-access.service.ts`               | `assert(patientId)`: lingkup `all` → boleh. `relationship` → relasi aktif (`access_relationships`: DPJP, perawat penanggung jawab, rawat bersama, konsultan, petugas unit) atau akses darurat yang masih berlaku. `unit` → itu semua ditambah kunjungan aktif pasien di unit penugasan sesi (ADR-0031). Daftar/pencarian memakai predikat SQL yang sama (`patientAccessSql`). |
| Akses darurat               | `modules/authz/break-glass.service.ts`                  | Alasan klinis 20–500 karakter, berlaku `break_glass.duration_minutes` (bawaan 60), notifikasi ke semua petugas privasi aktif (tanpa PHI), audit `break_glass` berisi pasien dan alasan. Ditinjau petugas privasi, tidak boleh meninjau milik sendiri. Alasan dan waktu tidak bisa diubah (hak kolom database).                                                                |
| Kelola pengguna dan matriks | `modules/iam/`                                          | Lihat aturan pengaman di bawah.                                                                                                                                                                                                                                                                                                                                               |

Aturan pengaman di `IamService`:

- Admin tidak bisa menonaktifkan, mereset sandi/MFA, atau menambah peran **akunnya sendiri** lewat menu admin.
- Selalu tersisa **minimal satu admin aktif**, yaitu admin yang bisa masuk (status aktif dan sudah punya kata sandi; MFA belum wajib). Admin yang belum diaktifkan, mis. admin seed, tidak dihitung. Pemeriksaannya dikunci per tenant (`lockTenantScope`), sehingga dua admin yang saling menonaktifkan bersamaan tidak sama-sama lolos. Tanpa kunci, keduanya lolos di READ COMMITTED (sudah dibuktikan tes).
- Izin `iam.users.write` dan `iam.roles.write` (`ACCESS_ADMIN_GRANTS`) tidak bisa dicabut dari `admin_tenant`.
- Bila izin kelola pengguna didelegasikan ke peran lain, pemegangnya **tidak bisa menyentuh akun atau peran setara admin** (mereset, menonaktifkan, memberi atau mencabut peran admin). Ini menutup eskalasi hak lewat delegasi.
- Kata sandi sementara hanya dikembalikan sekali di respons, tidak masuk log maupun audit, dan wajib diganti saat login pertama. Menonaktifkan atau mereset akun mencabut seluruh sesinya. Reset sandi juga cara mengaktifkan staf seed yang belum punya kredensial (`seedStaff`): baris `user_credentials` pertamanya dibuat saat itu. Sebelumnya akun itu tampil **Belum diaktifkan** (`activated: false` di `/iam/users`, filter `status=not_activated`).
- Penugasan yang belum mulai bisa dibatalkan: disimpan sebagai rentang kosong (akhir = awal), tidak dihapus. Alasannya tercatat di kolom `reason` audit.
- Perubahan matriks diaudit sebagai selisih (`added`/`removed`, format `grantDiffEntry`) dan berlaku di permintaan berikutnya, di semua instans API (cache dibuang setelah commit + siaran Redis). Penulisan matriks dikunci per tenant (`ROLE_MATRIX_LOCK`) bersama sinkron izin katalog.

**Izin baru di katalog.** Matriks bawaan hanya diisi saat peran dibuat, jadi izin yang ditambahkan ke `PERMISSION_CATALOG` belakangan tidak otomatis sampai ke RS yang sudah berjalan. Setelah menambah izin + bawaannya, jalankan `pnpm db:sync-permissions` (lihat Tutorial). Sinkron (`syncRolePermissions` di `packages/db/src/permission-sync.ts`) hanya **menambah** izin yang baru di katalog ke peran yang memilikinya di matriks bawaan, dengan lingkup bawaannya:

- "Baru" = belum ada di catatan katalog RS (`tenant_settings` kunci `authz.permission_catalog`, internal, tidak tampil di API pengaturan). RS yang belum pernah disinkron memakai `PERMISSION_CATALOG_BASELINE` (katalog 5 Okt 2026; jangan diubah). Setelah sinkron, catatan = catatan lama ∪ katalog saat ini, jadi izin yang kemudian dicabut admin tidak pernah dianggap baru lagi.
- Peran yang sudah punya baris untuk sumber × aksi itu (lingkup apa pun) tidak disentuh; izin yang pernah dicabut admin dari peran itu menurut jejak audit (`details.removed`) tidak diberikan lagi, juga bila pencabutan terjadi sebelum sinkron pertama. Tidak ada yang dicabut.
- `platform.*` tidak pernah diberikan ke peran RS. Peran bawaan yang belum ada hanya dilaporkan (dibuat oleh `ensureSystemRoles`).
- Setiap penambahan diaudit per peran (`role_permissions`, `via: cli`, pelaku `system`), begitu pula perubahan catatan (`tenant_setting`). Jalan ulang tanpa perubahan katalog tidak menulis apa pun.

**Langkah menambah izin baru** (mis. izin layar fase 2):

1. Tambahkan sumber/aksi di `PERMISSION_CATALOG` dan pemegangnya di `DEFAULT_ROLE_GRANTS` (`packages/shared/src/authz.ts`), dengan hak minimum. Izin `platform.*` hanya di `PLATFORM_ROLE_GRANTS`. Jangan ubah `PERMISSION_CATALOG_BASELINE`.
2. Pasang `@RequirePermission(sumber, aksi)` di endpoint, dengan tes `403` untuk peran yang tidak berhak (token sungguhan, bukan mode header).
3. Database tes tidak perlu dibuat ulang: `prepareTestDatabase` menjalankan sinkron yang sama untuk tenant seed (RSFA, RSFB, PLATFORM), dan tenant uji baru (`createTestTenant`) langsung memakai matriks bawaan terbaru.
4. Database pengembangan, lalu setiap lingkungan setelah deploy: `pnpm db:sync-permissions --dry-run`, periksa rencana per RS, lalu `pnpm db:sync-permissions`. API yang sedang berjalan memakai izin baru paling lambat `AUTHZ_CACHE_TTL_SECONDS`.
5. Sinkron hanya membawa izin yang **baru di katalog**. Menambah izin lama ke bawaan peran lain tidak ikut disinkron; RS mengaturnya lewat layar Akses.

Mode header pengembang memakai peran `DEV_ROLE` yang melewati matriks, jadi **jangan dipakai untuk menguji izin**. Tes izin memakai token sungguhan: `createTestUser(TENANT_A, { roles: [{ code: 'perawat' }] })` lalu `login(app, user)`. Contoh lengkapnya di `apps/api/test/authz.test.ts`.

### Layar Audit (P04)

Modul `apps/api/src/modules/audit/` melayani layar `/sistem/audit`. Semua endpoint membaca `audit_events` lewat RLS biasa; tidak ada jalur khusus.

| Endpoint                                  | Izin           | Isi                                                                                                                                                            |
| ----------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /audit/events`, `/audit/events/:seq` | `audit.read`   | Daftar berfilter (pasien, pengguna, peran, kelompok aksi, rentang waktu, hasil) berpaginasi kursor `seq`; detail berisi hash. Membuka detail ikut diaudit.     |
| `GET /audit/verify?mode=`                 | `audit.read`   | Keutuhan jejak (ADR-0072): `checkpoint` (bawaan) sejak jangkar sah terakhir + cocokkan semua jangkar; `full` hitung ulang semua. Web: `?verifikasi=1`/`penuh`. |
| `GET /audit/anomalies?days=`              | `audit.read`   | Temuan: gagal masuk/akses ditolak berulang, akses di luar jam dinas, volume tak wajar, akses darurat belum ditinjau. Hari lampau dari ringkasan harian.        |
| `POST /audit/anomalies/review`            | `audit.review` | Tinjauan temuan. Disimpan sebagai entri audit (`action=review`, `resource_type=audit_anomaly`, `resource_id`=kunci temuan), bukan tabel baru.                  |
| `GET /audit/anomalies/reviews?key=`       | `audit.read`   | Riwayat tinjauan satu temuan, terbaru dulu: peninjau, waktu, keputusan, catatan; `effective` = yang berlaku. Pembukaannya diaudit dengan kunci temuan.         |
| `GET /audit/export`                       | `audit.export` | CSV bukti akreditasi: BOM UTF-8, maks. 92 hari / 10.000 baris, sel berawalan `= + - @` diberi `'` (anti formula injection). Ekspor ikut diaudit.               |

- **Kunci temuan** berbentuk `jenis:pengguna:tanggal WIB` (`AUDIT_ANOMALY_KEY` di `@simrs/shared`). Kunci yang sama di hari yang sama = temuan yang sama, sehingga tinjauan tetap melekat walau jumlah kejadian bertambah.
- **Ambang** diatur per RS lewat pengaturan: `audit.night_hours`, `audit.volume_threshold`, `audit.burst_threshold`. Peran jaga malam (`NIGHT_SHIFT_ROLES`) tidak dihitung sebagai akses di luar jam dinas.
- Peninjau tidak boleh meninjau temuan atau akses darurat **miliknya sendiri** (`409`), dan akses darurat yang sudah ditinjau tidak bisa ditinjau ulang.
- Temuan **boleh ditinjau ulang** (layar: "Buka kembali tinjauan"): entri `review` baru ditambahkan dan yang terbaru berlaku; riwayatnya tampil di detail temuan. Kunci bertanggal mendatang (`400`) atau berisi akun di luar RS ini (`404`) ditolak, karena entri tinjauan tidak bisa dihapus.
- Jendela `days` dimulai **00.00 WIB** (`days - 1` hari sebelum hari ini), sehingga hari pertama dihitung utuh dan jumlah per kunci temuan sama di rentang mana pun.
- Query SQL temuan mengelompokkan per hari dengan `AT TIME ZONE 'Asia/Jakarta'` secara eksplisit, tidak bergantung pada zona sesi database.

**Jangkar hash dan ringkasan harian (ADR-0072).** Rantai hash tidak berkunci, jadi superuser database bisa memotong ekornya atau menulis ulang seluruhnya. Penutupnya:

- **Jangkar.** Job `audit.anchor` (tiap jam) menandatangani kepala rantai (HMAC, `AUDIT_ANCHOR_KEY`, kunci turunan per tenant) dan menyimpannya di `audit_anchors` + bucket WORM (`AUDIT_ANCHOR_BUCKET`, Object Lock COMPLIANCE, versi pertama objek yang dibaca). Jangkar di bucket yang hilang dari database dipulihkan job (`source = worm`).
- **Pemeriksaan.** `verifyAuditTrail` (`@simrs/db`) mencocokkan setiap jangkar dengan entri di seq-nya (`TRUNCATION_DETECTED`, `ANCHOR_MISMATCH`, `ANCHOR_TAMPERED`, `ANCHOR_KEY_UNKNOWN`), lalu menghitung ulang hash sejak titik periksa (`CHAIN_BROKEN`). Perubahan mentah sebelum titik periksa hanya tertangkap mode `full`.
- **Ringkasan.** Job `audit.daily-summary` (00.20 WIB) menulis `audit_daily_summaries` + `…_items` (per pengguna × jenis, tanpa PHI) untuk hari yang sudah final, berkunci parameter (jam malam, peran jaga, daftar aksi). `auditAnomalyBuckets` membaca ringkasan untuk hari lampau dan menghitung langsung sisanya; hasilnya sama dengan agregasi langsung (dibuktikan tes). SQL temuan ada di `packages/db/src/audit-anomaly.ts`, dipakai keduanya.
- **Tes penyerang** memakai `asTestSuperuser` (`@simrs/db/testing`): superuser Postgres dengan trigger mati, hanya di DB uji.

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
- Pencarian nama memakai `app_search_patient_names(teks)` (tabel `search.patient_names` + indeks trigram, disalin trigger dari `patients.name_search`), lalu pasiennya dibaca lewat `patients` dengan RLS. Jangan menulis kueri `%`/`<%` langsung ke `patients`: di bawah RLS operator trigram tidak bisa memakai indeks (ADR-0015, pembaruan 5 Okt 2026).

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

| Bagian                              | Isi                                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@simrs/shared` → `documents`       | Jenis dokumen, jenis berkas dari magic bytes (`detectDocumentType`), `sanitizeFileName`, skema API, kode verifikasi `sv1.<tenant>.<acak>`                                          |
| `infra/object-storage.ts`           | `ObjectStorage` (`put`/`open`/`check`, tanpa hapus) + driver `disk` (hanya `APP_ENV=local`) dan `s3`; `verifiedContent` mencocokkan hash/ukuran DB saat unduh (stream)             |
| `infra/s3-client.ts`, `sigv4.ts`    | Re-ekspor klien S3 minimal di `@simrs/shared/node` (`packages/shared/src/s3/`, dipakai juga backup): SigV4, gaya path, `If-None-Match: *`, checksum SHA-256; `/ready` = HeadBucket |
| `common/raw-upload.middleware.ts`   | Body biner unggahan dibaca sebelum transaksi dibuka (koneksi pool tidak ditahan klien lambat); batas 10 MB → 413 setelah klien selesai mengirim                                    |
| `documents` / `document_signatures` | Trigger: dokumen tidak bisa diubah/dihapus, batal sekali beralasan, tidak untuk dokumen yang ditandatangani; hash tanda tangan = hash dokumen; `signed` terkunci                   |
| API `modules/documents/`            | `POST/GET /patients/:id/documents`, `GET /documents/:id[/content]`, `POST /documents/:id/void`, `POST /documents/:id/signatures`; publik `GET /verification/signatures/:code`      |
| Worker `outbox/tte.ts`              | `tte.sign`: kirim hash + ID penanda tangan ke `/tte/sign`, simpan hasil atomik, audit `system`; DLQ → tanda tangan `failed` + audit `sign` (`onDead`)                              |
| Web `app/verifikasi/[code]/`        | Halaman verifikasi QR publik (dikecualikan dari login di `proxy.ts`)                                                                                                               |

Kunci objek selalu `<tenant>/<tahun>/<bulan>/<uuid>` buatan server. Tes driver S3 memakai MinIO lokal di bucket uji `simrs-test-<acak>` yang dibuat dan dihapus tes (`apps/api/test/s3-test-bucket.ts`); suite API dokumen (`documents.suite.ts`) dijalankan untuk kedua driver.

Unggah dari web: kirim isi berkas sebagai `application/octet-stream` dengan header `X-Document-Kind`, `X-Document-Title`, `X-Document-Filename` (UTF-8 di-percent-encode). Header dan query tidak masuk log API; judul dokumen bisa memuat PHI, jadi jangan pernah taruh di path URL.

### Notifikasi (P09)

`NotificationsService.notify(penerima, { kind, title, body, link }, kanal)` dipanggil di dalam transaksi modul lain (contoh: akses darurat). Ia menulis `notifications` (in-app) lalu mengantrekan `notify.email` / `notify.whatsapp` ke outbox dengan payload ID saja (ADR-0021).

- Isi tanpa PHI; `link` wajib path internal (`notificationLinkSchema`).
- API: `GET /notifications?unread=&limit=`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all` (hanya milik sendiri).
- Worker `outbox/notify.ts`: alamat dibaca saat kirim, no. HP didekripsi (`staff_phone`), akun nonaktif/tanpa alamat dilewati, respons tidak disimpan.
- Mock: `POST /email/send`, `POST /whatsapp/send`, kotak masuk `GET /messages` dan panel.
- Web: lonceng di header (`components/notification-bell.tsx`, jumlah dari layout), halaman `app/(staf)/notifikasi/`.

### Front office (fase 2, skema potongan 0b)

Tabel F01–F07 ada di migrasi `20261005101000_front_office` (rencana: `docs/rencana/fase-2-front-office.md`). Aturan yang
dijamin database, bukan hanya kode:

| Aturan                      | Penjaga                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Kuota tidak terlampaui      | CHECK `schedule_sessions_quota` (`booked_* <= quota_*`); reservasi lewat `reserveQuota` (20 serentak untuk 1 sisa → 1 lolos) |
| Nomor tidak berubah         | Hak kolom + trigger `app_immutable_columns`: kode booking, nomor tiket, nomor kunjungan, task ID BPJS dan waktunya           |
| Jejak append-only           | `app_reject_mutation`: `queue_calls`, `encounter_status_history`, `hfis_schedule_snapshots`, `patient_contacts`              |
| SEP                         | `app_sep_guard`: `issued` beku kecuali batal, `cancelled` beku; koreksi = versi baru (sekali); satu rantai SEP per kunjungan |
| Penjaminan                  | Terkunci (`locked_at`) begitu SEP-nya terbit; `app_coverage_guard` menolak perubahan sesudahnya                              |
| Papan antrean real-time     | `queue_calls` memicu `pg_notify('queue_calls', {tenant_id, id})`: tanpa nomor, nama, atau isi lain                           |
| Persetujuan umum rawat inap | `privacy_consents.encounter_id`: satu aktif per jenis × penerima × kunjungan (rawat jalan: tanpa kunjungan)                  |
| Booking JKN                 | CHECK `appointments_jkn_reference`: `jkn_visit_kind` 1–4 + `reference_number` wajib untuk keranjang `jkn`                    |
| Rujukan/SPRI draf           | `number` boleh kosong hanya selama `pending`; jenis, pasien, dan nomor yang sudah terisi tetap (`app_referral_guard`)        |

Nilai status/jenis (mis. `booked`, `checked_in`; `AMB`/`EMER`/`IMP`; `pending`/`issued`) dibatasi CHECK di migrasi dan
mengikuti kontrak bersama `packages/shared` (potongan 0a).

Migrasi `20261005102000_worker_failure_states` (untuk worker potongan 1a) menambah keadaan gagal permanen yang terlihat di
domain: tanda tangan TTE `failed` (pending → failed → pending untuk kirim ulang; `signed` tetap final), status verifikasi
identifier `error`, dan `outbox_messages.requeued_at` (kirim ulang manual memulai jendela retry baru).

### Booking (F02, fase 2 potongan 3)

API `modules/booking/` di `/api/v1/booking/appointments` (kontrak `@simrs/shared` `schemas/booking.ts`; izin
`booking.read`/`write`/`cancel`; modul `F02`). Kanal dari API staf selalu `loket`.

| Aksi                              | Yang terjadi (satu transaksi permintaan)                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /`                          | Cek pasien aktif (JKN: kartu BPJS + NIK), sesi poli dibuka (bukan lewat, bukan cuti tanpa pengganti, ≤ `booking.max_days_ahead`), lalu `reserveQuota` (penuh → `QUOTA_FULL`)   |
|                                   | Kode booking P08 `booking_code` (YYMMDD tanggal layanan + 4 digit), nomor poli cadangan (`allocateQueueNumber`), estimasi = jam mulai + urutan × `queue.avg_service_minutes`   |
|                                   | JKN: outbox `bpjs.antrean.add` (payload `{ appointmentId }`); ganda pasien × poli × tanggal → `BOOKING_DUPLICATE` (juga indeks unik parsial `appointments_one_active_per_day`) |
| `POST /:id/cancel`                | `releaseQuota`, nomor poli batal, JKN yang (mungkin) terdaftar → outbox `bpjs.antrean.batal`, event `booking.cancelled`                                                        |
| `POST /:id/reschedule`            | Batal + booking baru (kode baru) di sesi lain, atomik                                                                                                                          |
| `POST /:id/check-in`              | Hanya hari layanan: `checked_in`, JKN mendapat tiket loket pendaftaran (`A-031`), event `booking.checked_in`                                                                   |
| `GET /`, `/:id`, `/by-code/:code` | Setiap booking yang tampil dicatat audit per pasien (`search`/`read`)                                                                                                          |

Task ID BPJS (1, 99) TIDAK dikirim modul ini: mesin task ID modul antrean (potongan 4a) bereaksi pada event di atas.
Worker (`apps/worker/src/outbox/booking.ts`) mengisi status kirim booking (`bpjs_sync_status`, `bpjs_cancel_status`:
`not_required`/`pending`/`sent`/`rejected`/`dead` + kode galat, tanpa pesan BPJS mentah). Batal menunggu tambah terkirim
(`defer`) dan dilewati bila booking tidak pernah terdaftar. Job `booking.no-show` (23.30 WIB) dan `booking.reminder`
(18.00 WIB, WhatsApp H-1 tanpa poli/dokter, satu pesan per booking) ada di `apps/worker/src/jobs/booking-jobs.ts`.

### Lookup sinkron, SSE, dan event domain (fase 2)

Infrastruktur bersama front office (potongan 1b). Semuanya modul global yang sudah terdaftar di `AppModule`, begitu juga kerangka modul `scheduling`, `booking`, `registration`, `queue`, `kiosk`, `sep`, `referral`, dan `patient-portal-gateway` (F01–F08). Potongan berikutnya cukup mengisi folder modulnya; `app.module.ts` tidak perlu diubah lagi.

**Handler tanpa transaksi permintaan.** `@NoRequestTransaction()` dipasang di handler (controllernya tetap `@TenantScoped()`). Interceptor tetap menjalankan `@RequirePermission`, `@RequireModule`, dan `@Audited`, masing-masing di transaksi pendek. Handler berjalan dengan `tx: null`:

- `TenantDb.tx()` langsung → galat program,
- `TenantDb.transaction(fn)` membuka transaksi pendek bertenant. Di dalamnya repository, `TenantDb.audit()`, dan event domain bekerja seperti biasa; tidak boleh bersarang.

Hanya untuk dua pola di bawah. Peninjau menolak pemakaian lain.

**Lookup sinkron (ADR-0025).** Untuk cek peserta/rujukan VClaim dan demografi Dukcapil yang ditunggu pengguna. Semua penulisan ke sistem luar tetap lewat outbox.

```ts
@NoRequestTransaction()
@RequirePermission('patient', 'read')
@Post(':patientId/bpjs-eligibility')
check(@Param('patientId') patientId: string, @Body() body: EligibilityInput) {
  return this.gateway.lookup(this.pesertaConnector, { cardNo: body.cardNo }, {
    patientId,
    persist: (out) => this.repo.saveSnapshot(patientId, out), // opsional, transaksi pendek ke-3
  });
}
```

- Urutan: audit `requested` di-commit → konektor dipanggil tanpa transaksi (maks 5 dtk, `AbortSignal`) → audit `completed` + `persist`, atomik.
- Gagal/terlambat → audit `failed` → 503 `BPJS_UNAVAILABLE` (BPJS) atau `INTEGRATION_UNAVAILABLE` (Dukcapil). `AppError` dari konektor (penolakan bisnis berkode) diteruskan apa adanya.
- Konektor = `LookupConnector<I, O>` (`infra/lookup/lookup-connector.ts`): `name` (mis. `bpjs.vclaim.peserta`, jadi `resource_type` audit), `target`, `call(input, signal)`, `summarize?` (fakta tanpa PHI untuk audit). Disuntikkan modul domain lewat token DI-nya sendiri. Klien BPJS bersama ada di `@simrs/shared/node`. Tes memakai `apps/api/test/fakes/fake-lookup-connector.ts`.
- Masukan/keluaran tidak pernah masuk log atau audit.

**SSE (ADR-0026).** Event berasal dari `pg_notify` yang dipicu trigger `AFTER INSERT` (fungsi `app_notify_row('<kanal>')`, payload hanya `{ tenant_id, id }`). Fungsi ini dipasang migrasi `20261005161000_notify_row` dan dipakai `queue_calls`. `PgNotificationHub` memegang satu koneksi `LISTEN` per instans (dibuka saat pelanggan pertama, sambung ulang otomatis) dan meneruskan notifikasi ke pelanggan kanal + tenant yang sama.

```ts
const queueCalls: SseChannel<QueueCallView> = {
  name: 'queue_calls',
  load: (tx, id) => loadCallView(tx, id),                       // null → tidak dikirim
  replay: (tx, afterId, limit) => callsAfter(tx, afterId, limit),  // untuk Last-Event-ID
};

@NoRequestTransaction()
@RequirePermission('queue', 'read')
@Get('display/stream')
stream(@Req() req: Request, @Res() res: Response, @Query('services') services: string) {
  this.sse.stream(req, res, queueCalls, { filter: (e) => wanted(e, services) });
}
```

- Setiap event dibaca di transaksi pendek `withTenant` tenant pelanggan (RLS). Hasil `load` dibagi ke semua koneksi selama 2 dtk.
- `id:` event = id baris (UUID v7). `Last-Event-ID` (atau query `lastEventId` dari BFF) memanggil `replay`; replay juga dijalankan setelah koneksi LISTEN tersambung ulang. Lebih dari 200 event atau kanal tanpa `replay` → `event: reset` (klien memuat ulang snapshot).
- Heartbeat `: ping` 15 dtk; umur koneksi maks 5 menit lalu klien menyambung ulang (sesi dan izin diperiksa ulang); klien lambat diputus; langganan dilepas saat klien putus.
- Header `X-Accel-Buffering: no` dan `Cache-Control: no-store, no-transform` agar proxy tidak menahan aliran.

**Event domain.** `DomainEvents` (`infra/events/domain-events.ts`) sinkron di dalam transaksi penerbit. Nama dan payload (ID saja, tanpa PHI) ada di `domain-event-map.ts`; daftar namanya sementara disalin dari rencana potongan 0a dan diganti impor dari `@simrs/shared` setelah 0a tergabung.

```ts
// Modul pemakai, mis. mesin task ID di modul queue:
onModuleInit() {
  this.events.on('booking.checked_in', (e, { tx }) => this.taskIds.record(tx, e.payload.appointmentId, 1),
    { label: 'queue.task-id' });
}
// Penerbit (service, di dalam transaksi permintaan atau TenantDb.transaction()):
await this.events.publish('booking.checked_in', { appointmentId, patientId });
```

- `publish` lebih dulu menyimpan event ke tabel `domain_events` (append-only, RLS; nama, payload, waktu, request ID, pengguna/perangkat pelaku) di transaksi yang sama, baru menjalankan penangan. `id` event = id barisnya; event ikut commit/batal bersama perubahan asalnya.
- Payload dijaga "tanpa PHI" (`assertDomainEventPayload`): kunci `…Id` berisi UUID/null, `…Ids` larik UUID, kunci lain hanya null/boolean/angka/token enum huruf kecil. Database menambah CHECK objek datar (tanpa objek bersarang).
- Penangan berjalan berurutan dengan transaksi yang sama. Penangan gagal → seluruh permintaan batal, termasuk tulisan penerbit dan baris event.
- `publish` di luar transaksi → galat program. Rantai lebih dari 8 tingkat dianggap siklus.
- Efek ke sistem luar dari penangan tetap lewat outbox.
- Konsumen yang datang belakangan (charge capture fase 5, SATUSEHAT fase 7) membaca `domain_events`; penangan dalam proses hanya untuk reaksi yang harus atomik dengan perubahan asalnya.

### Prinsipal perangkat anjungan dan display (ADR-0027)

Anjungan (`kiosk`) dan TV antrean (`queue_display`) masuk sebagai **perangkat terdaftar per unit**, bukan akun staf. Barisnya ada di `registered_devices`, tabel yang sama dengan PIN (`staff_pin`).

```
Admin  POST /api/v1/iam/devices { kind, name, unitId, queueDisplayId? }   (iam.users.write)
         → { id, device, enrolmentCode: 'XXXXX-XXXXX', enrolmentExpiresAt }   kode tampil sekali, 15 menit
Perangkat  /perangkat/daftar (web, publik) → POST /api/v1/devices/enrol { tenantCode, code }
         → { token: 'dv1…', expiresAt, device }   → cookie httpOnly `simrs_device`
Perangkat  GET /api/v1/devices/me (Bearer dv1…) → identitas + izin tetap
Admin  GET /api/v1/iam/devices · POST /api/v1/iam/devices/:id/revoke
```

- **Endpoint perangkat**: `@DeviceScoped('kiosk.use' | 'queue.display.read')` (`common/device-scoped.decorator.ts`). Isinya `DeviceGuard` + batas laju per perangkat + transaksi permintaan biasa. Repository tetap memakai `TenantDb`; pelaku ada di `TenantDb.actor().devicePrincipal`.
- **Izin tetap per jenis** (`DEVICE_GRANTS` di katalog izin `@simrs/shared`), tidak pernah izin manusia. Token staf di endpoint perangkat → 403; `@RequirePermission` di endpoint perangkat ditolak.
- **Token perangkat di endpoint staf** → 403 + audit `access_denied`. Semua audit pelaku perangkat membawa `details.deviceId`/`deviceKind`; audit tidak punya kolom baru.
- **Validasi tiap permintaan di database**, jadi pencabutan berlaku seketika. Kode pendaftaran disimpan sebagai HMAC dan hanya bisa dipakai sekali (dijaga trigger database).
- **Web mode api**: proxy mengalihkan `/kiosk` dan `/display/…` tanpa cookie perangkat ke `/perangkat/daftar`. Halaman memanggil `requireDevice(jenis)` (`lib/server/device.ts`). Admin mengelola perangkat di `/sistem/akses/perangkat`. Mode presentasi tetap memakai login staf.
- **E2E**: global setup mendaftarkan satu anjungan + satu display uji (`e2e/support/devices.ts`, `useTestDevice(context, 'kiosk')`).

### Antrean dan task ID BPJS (F04)

Modul `modules/queue/` (potongan 4a), kontrak `@simrs/shared` `schemas/queue.ts`.

| Endpoint `/api/v1/queue/…`                                 | Izin         | Isi                                                                                                                                       |
| ---------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET services`                                             | `queue.read` | Layanan aktif; klinisi berlingkup `unit` hanya layanan unit sesinya                                                                       |
| `GET services/:id/tickets?serviceDate&status`              | `queue.read` | Tiket hari ini (tanpa identitas pasien, hanya ID); estimasi panggil = posisi × `queue.avg_service_minutes`                                |
| `POST services/:id/tickets {appointmentId?, encounterId?}` | `queue.call` | Tiket loket (`allocateQueueNumber`, `<kode>-<3 digit>`); tertaut pasien → audit `create`                                                  |
| `POST services/:id/call-next {counter}`                    | `queue.call` | FIFO, nomor cadangan booking dilewati, `SKIP LOCKED` (dua loket tidak memanggil tiket yang sama); kosong → 409 `QUEUE_EMPTY`              |
| `POST tickets/:id/{call,recall,skip,start,finish}`         | `queue.call` | Transisi tiket; salah keadaan → 409 `TICKET_STATE_INVALID`; "panggil" tiket yang pernah dipanggil = ulang                                 |
| `GET displays`                                             | `queue.read` | Daftar display + layanannya (admin mengikat TV ke display)                                                                                |
| `GET displays/:id/board`                                   | `queue.read` | Papan untuk staf (pratinjau, kendali antrean)                                                                                             |
| `GET display/board`                                        | perangkat*   | Papan TV (`queueBoardSchema`): maks. 4 poli, panggilan terakhir (`calling` null bila belum ada) + riwayat                                 |
| `GET display/events`                                       | perangkat*   | SSE: `queue.board` (potret papan) saat tersambung, lalu `queue.call` (kanal `queue_calls`, hanya layanan display, replay `Last-Event-ID`) |
| `GET bpjs-tasks?appointmentId=`                            | `queue.read` | Status task ID per booking (chip task 1–3); dibaca = audit `read` dengan pasien booking                                                   |

\* `@DeviceScoped('queue.display.read')` (ADR-0027): display = `registered_devices.queue_display_id` perangkat pemanggil,
bukan parameter URL, jadi TV tidak bisa membaca papan display lain. Perangkat tanpa display terikat → 409.

- Setiap aksi menulis `queue_calls` (append-only; sumber waktu panggil/mulai/selesai) dan menerbitkan event domain
  `queue.ticket_called|started|finished`. Tiket bertaut pasien diaudit `update` (`details.queueAction`).
- Lingkup `unit`: layanan harus milik unit sesi pengguna (`actor.unitId`); penolakan = `AuditedDenial` (tercatat
  `access_denied` walau permintaan batal).
- `QueueService.attachAppointment(ticketId, appointmentId)` untuk registrasi walk-in (potongan 5a).

**Mesin task ID** (`bpjs-task.engine.ts`) mendengar event domain (bukan tombol): `booking.checked_in` → 1, panggilan
pertama tiket loket → 2, `encounter.registered` rawat jalan → 3, poli mulai/selesai → 4/5, batal → 99 (pemetaan
`bpjsTaskForEvent`). Aturan: hanya booking `jkn`; satu baris per (booking, task) di `bpjs_queue_tasks` dengan waktu =
waktu event (ms), tidak pernah ditimpa; tidak ada task setelah 99; walk-in: tiket loket yang tertaut booking mengisi
task 1 (waktu ambil tiket) dan 2 (panggilan pertama) bila belum ada task lebih tinggi. Tiap task baru → outbox
`bpjs.antrean.updatewaktu` (payload `{ queueTaskId }`, kunci `outboxKey`). Worker (`outbox/bpjs-antrean.ts`) menunda
task yang task sebelumnya masih `pending` (`defer.afterMessageId`), mengirim `waktu` = `occurred_at`, lalu menandai
`sent` / `rejected` + kode (`BPJS_TASK_GANDA` = sudah tercatat → `sent`) / `dead` + kode (DLQ akhir hari layanan). Job no-show booking (worker, F02) mencatat task 99 lewat helper yang sama, `insertBpjsQueueTask` (`@simrs/db`).

### Anjungan mandiri (F05)

Modul `modules/kiosk/` (potongan 6), kontrak `@simrs/shared` `schemas/kiosk.ts`. Semua endpoint
`@DeviceScoped('kiosk.use')` (ADR-0027): token staf → 403, pelaku audit = perangkat (`details.deviceId/deviceKind`).

| Endpoint `/api/v1/kiosk/…`                                                  | Isi                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST identify {purpose, method, value, birthDdmm}`                         | NIK / kartu BPJS (blind index) / kode booking hari ini **dan** tanggal + bulan lahir (DDMM; salah = sama dengan tidak ditemukan) → `{found:false}` atau nama tersamar + tanggal lahir tanpa tahun + token `kl1.` (180 detik, sekali pakai, perangkat yang sama)                                                                                |
| `POST check-in {lookupToken}` + `Idempotency-Key`                           | `BookingService.checkIn` (sumber tiket `anjungan`, tiket loket untuk semua penjamin) → event `booking.checked_in` (task 1); sudah check-in → tiket loketnya dicetak ulang                                                                                                                                                                      |
| `POST tickets {serviceKind, lookupToken?}`                                  | Loket tanpa identitas; farmasi/kasir dengan token (tiket menunggu milik pasien dipakai ulang); `QueueService.issueKioskTicket`                                                                                                                                                                                                                 |
| `GET tickets/:id/print`                                                     | HTML 80 mm tanpa skrip (CSP `default-src 'none'`), hanya tiket di `kiosk_tickets` perangkat ini hari ini; selain itu 404 tercatat                                                                                                                                                                                                              |
| `POST assist`                                                               | Notifikasi in-app ke petugas pendaftaran (unit anjungan didahulukan), tanpa PHI                                                                                                                                                                                                                                                                |
| `GET sessions`                                                              | Sesi dokter hari ini untuk pasien umum (`kioskSessionOptionSchema`, informasi publik)                                                                                                                                                                                                                                                          |
| `POST register {payer, lookupToken, sessionId?}` + `Idempotency-Key` (UUID) | Registrasi mandiri: memakai ulang `RegistrationService.registerOutpatient` (5a: kunjungan, penjaminan, SEP `pending` lewat outbox, task 3) → tiket poli; BPJS = booking JKN hari ini + rujukan/surat kontrol tercatat (diagnosa awal dari rujukan itu); persetujuan umum harus sudah ada; galat yang butuh petugas → 422 `KIOSK_NEEDS_COUNTER` |

- **Anti-enumerasi**: jawaban identifikasi selalu 200 dengan baris jejak `kiosk_lookups` (ditemukan atau tidak, tanpa
  nilai yang diketik); `kiosk.lookup_rate_per_min` per perangkat dihitung dari tabel itu di bawah kunci advisori per
  perangkat → 429 `RATE_LIMITED` yang tetap tercatat (`AuditedDenial` dengan kode/status sendiri). NIK ganda → tidak
  ditemukan. Token perangkat lain → 410 yang sama, tercatat.
- **Batas per perangkat lain** (review keamanan potongan 9): tiket loket tanpa identitas 6/menit (`kiosk_tickets`,
  429 tercatat) dan "panggil petugas" sekali per 60 detik (tautan notifikasi `/antrean?perangkat=<id>`; sentuhan ulang
  mengembalikan waktu panggilan pertama tanpa notifikasi baru).
- **Idempotensi**: token ditandai terpakai bersama tiketnya (`used_at`, `idempotency_key`, `ticket_id`; pemicu
  `app_kiosk_lookup_guard` + hak kolom). Kunci yang sama → tiket yang sama; kunci lain → 410.
- **Web** (`app/(perangkat)/kiosk/`): mode api = `live-kiosk-client.tsx` + Server Action `actions.ts` (token perangkat
  dari cookie httpOnly; browser hanya memegang token `kl1` berumur pendek). Tiket dicetak lewat `iframe srcdoc` berisi
  HTML API. Layar kembali ke awal setelah 90 detik tanpa sentuhan. Jalur demo dibekukan (`demo-kiosk.tsx`).
- **Registrasi** tidak menyalin logika 5a: `KioskService.register` menukar token (`claim()`), menyusun
  `OutpatientRegistrationInput`, lalu memanggil `RegistrationService` dengan kunci idempotensi yang sama. Web:
  `kioskNextStep` (BPJS + booking → daftar ke poli; umum → pilih dokter; booking lain → check-in).

### Registrasi rawat jalan dan SEP (F03/F06, fase 2 potongan 5a)

Modul `modules/registration/` (F03) dan `modules/sep/` (F06), kontrak `@simrs/shared` `schemas/registration.ts`.

| Endpoint `/api/v1/…`                               | Izin              | Isi                                                                                                                   |
| -------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST registration/outpatient` + `Idempotency-Key` | `encounter.write` | Registrasi rawat jalan (rincian di bawah); 201 `registrationResultSchema`                                             |
| `GET registration/encounters/:id`                  | `encounter.read`  | Kunjungan + penjaminan + SEP terbaru + tiket poli + booking; lingkup relasi butuh relasi aktif (`app_patient_group`)  |
| `GET registration/desk`                            | `encounter.write` | Antrean loket admisi menunggu + kuota dokter hari ini (`SchedulingService.todayQuotas`), tanpa daftar pasien          |
| `GET registration/encounters/:id/print`            | `documents.print` | Lembar cetak loket (`printableVisitSchema`: tiket poli + ringkasan SEP, no. kartu tersamar), audit `print` per pasien |
| `POST registration/dukcapil-lookup {nik}`          | `patient.write`   | Lookup sinkron demografi (mock `/dukcapil/verify`); tidak disimpan                                                    |
| `POST sep/eligibility-checks?patientId=`           | `coverage.read`   | Lookup sinkron VClaim peserta (no. kartu/NIK di body); tidak aktif = hasil, tidak ditemukan = 422 `BPJS_REJECTED`     |
| `GET sep/referrals?patientId=`                     | `coverage.read`   | Rujukan FKTP VClaim per no. kartu pasien (dibaca server) + surat kontrol RS; hasil VClaim disimpan di `referrals`     |
| `GET sep/:id`, `PATCH sep/:id`                     | `coverage.*`      | Baca; revisi SEP terbit = versi baru `pending` (alasan wajib) + outbox `bpjs.vclaim.sep.update`                       |
| `POST sep/:id/retry`, `POST sep/:id/cancel`        | `coverage.write`  | Kirim ulang setelah ditolak/DLQ (urut outbox baru); batal SEP terbit + outbox `bpjs.vclaim.sep.delete`                |
| `GET/POST patients/:id/contacts`                   | `patient.*`       | Kontak/penanggung jawab (terenkripsi, append-only, no. HP tersamar)                                                   |

Registrasi rawat jalan (satu transaksi permintaan):

1. `IdempotencyService.claim` (`src/common/idempotency.ts`): header wajib UUID (`IDEMPOTENCY_KEY_REQUIRED`), advisory
   lock per tenant × lingkup × kunci (permintaan serentak berurutan), sidik SHA-256 isi + pelaku; sudah ada + sama →
   respons dibangun ulang (audit `read`), beda → 409 `IDEMPOTENCY_KEY_REUSED`. Hasil dicatat di `idempotency_keys`.
2. Pasien aktif (BPJS: kartu + NIK), sesi poli HARI INI, persetujuan umum rawat jalan aktif atau isian petugas
   (`GENERAL_CONSENT_REQUIRED`; keputusan #9: rawat jalan sampai dicabut, `encounter_id` null).
3. Booking: `appointmentId` yang dibawa, booking aktif hari ini di poli itu, atau walk-in baru lewat
   `BookingService.createForVisit` (kanal loket, kuota, JKN → `bpjs.antrean.add`). `BookingService.markArrived` →
   `checked_in`; tiket loket yang dibawa (`counterTicketId`) ditautkan (`QueueService.attachAppointment`, task 1–2 diisi
   dari tiket itu), tanpa tiket → event `booking.checked_in` (task 1).
4. Kunjungan `RJ-YYMM-NNNNNN` (`arrived`) + riwayat status; satu kunjungan aktif per booking (indeks unik
   `encounters_one_per_appointment` → `ENCOUNTER_DUPLICATE`); nomor poli cadangan dilepas ke antrean berurutan.
5. Penanggung jawab, penjaminan (asuransi/perusahaan: no. anggota terenkripsi), relasi akses DPJP
   (`access_relationships` `dpjp`, sumber kunjungan, berlaku s.d. akhir hari berikutnya; dokter tanpa akun dilewati).
6. BPJS: rujukan/surat kontrol dicari di `referrals` (milik pasien lain → 422, kedaluwarsa → `REFERRAL_EXPIRED`) atau
   dicatat baru; SEP v1 `pending` + outbox `bpjs.vclaim.sep.insert:<sep>:1`. BPJS tidak dihubungi di sini.
7. Event `encounter.registered` → task 3.

Worker `apps/worker/src/outbox/sep.ts` (`defineBpjsOperation`, sensitif, data dibaca + didekripsi saat kirim):

- **insert bertahap**, satu panggilan BPJS per pesan, tahap dari keadaan baris: `peserta` (kelas hak belum ada → cek
  kepesertaan; tidak aktif → `failed`) → `insert` → `issued` (penjaminan terkunci trigger, event `sep.issued` di
  `domain_events`). Jawaban `BPJS_SEP_GANDA` → tahap `histori` (histori pelayanan per kartu + tanggal): nomor yang
  cocok dipakai (kiriman sebelumnya timeout padahal sudah diproses), tidak cocok/dipakai kunjungan lain → `failed`.
  SEP tidak pernah diterbitkan dua kali.
- Kunci pesan `<operasi>:<sep>:<urut>` (`seps.sync_seq`); pesan yang urutnya bukan urut terbaru dilewati.
- **update** (versi ≥ 2) → `issued`; **delete** (SEP `cancelled`) → status kirim saja (`BPJS_SEP_TIDAK_DITEMUKAN` = sudah
  hilang → `sent`). Ditolak → `failed` + `last_error_code` + `rejection_reason`; DLQ → `failed` + `BPJS_DLQ`
  (`sync_status` `dead`). Status kirim terakhir di `seps.sync_status|synced_at|sync_error_code`.
- **Teks asli BPJS tidak pernah ke layar atau log.** `rejection_reason` menyimpan teks asli untuk ditinjau di database;
  API mengirim `rejectionReason` = pesan baku dari `last_error_code` (`sepFailureMessage` → `bpjsStaffMessage` di
  `@simrs/shared`). Lookup yang ditolak (422 `BPJS_REJECTED`) hanya membawa `details.reason`; web menampilkan
  `bpjsStaffMessage(reason)`. Kode yang tidak dikenal → "Ditolak BPJS; periksa di VClaim".

Task ID untuk kunjungan ini (mesin `BpjsTaskEngine`, worker `bpjs-antrean.ts`): walk-in tanpa panggilan tiket loket
mendapat task 1 (check-in) lalu task 2 dan 3 pada saat didaftarkan, karena Antrean BPJS menolak lompatan 1 → 3. Selama
`bpjs.antrean.add` booking masih `pending` (mis. setelah gangguan BPJS), `updatewaktu` menunggu pesan tambah itu;
tambah antrean memakai nomor poli booking walau cadangannya sudah dilepas registrasi.

### IGD, admisi rawat inap, SPRI, surat kontrol, rujukan (F03/F06/F07, fase 2 potongan 7)

Modul `modules/registration/` (`AdmissionService`, memakai bagian bersama `RegistrationService`: penjaminan,
persetujuan umum, relasi dokter, hasil) dan `modules/referral/`; kontrak `schemas/registration.ts` dan
`schemas/referral.ts`. Migrasi `20261005220000_igd_admission_referrals`.

| Endpoint `/api/v1/…`                                    | Izin               | Isi                                                                                                                                        |
| ------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST registration/emergency` + `Idempotency-Key`       | `encounter.write`  | IGD `EMER` `arrived`: pasien MPI atau tanpa identitas (rekam medis baru "Tn. X"/"Ny. X" `unidentified`); penjamin opsional; SEP menyusul   |
| `POST registration/admissions` + `Idempotency-Key`      | `encounter.write`  | Admisi `IMP` `planned`: unit rawat inap + DPJP + rencana masuk, kunjungan asal dan/atau SPRI, persetujuan umum per admisi                  |
| `GET registration/encounters?class&status&unitId…`      | `encounter.read`   | Daftar kunjungan + pasien (nama, RM, `unidentified`); ABAC: unit dipaksa ke unit penugasan, relasi = pasien berelasi; audit per pasien     |
| `POST registration/encounters/:id/cancel`               | `encounter.cancel` | Batal IGD `arrived` atau admisi `planned` (rawat jalan lewat booking); riwayat status + event `encounter.cancelled`                        |
| `POST referrals/control-letters`                        | `referral.write`   | Modul F06. Surat kontrol (butuh SEP asal terbit) atau SPRI (penjamin BPJS); baris `pending` tanpa nomor + outbox VClaim                    |
| `POST referrals/outgoing`, `POST referrals/internal`    | `referral.write`   | Rujukan keluar (BPJS → outbox, butuh SEP terbit; selain itu nomor `RK-…`); rujukan internal antarpoli `RIN-…` + relasi `konsultan`         |
| `GET referrals[?patientId/encounterId]`, `GET :id`      | `referral.read`    | Lingkup selain `all` wajib menyebut pasien/kunjungan (ABAC)                                                                                |
| `POST referrals/:id/cancel`, `POST referrals/:id/retry` | `referral.write`   | Batal: bernomor BPJS → `cancelled` + outbox hapus; belum bernomor + ditolak/DLQ → batal lokal; sedang dikirim → 409. Kirim ulang urut baru |

Aturan penting:

- **Satu IGD aktif dan satu admisi aktif per pasien** (`encounters_one_active_emergency|admission`), satu admisi per SPRI
  (`encounters_one_per_referral`). Kolom `arrival_mode`, `source_encounter_id`, `referral_id` tetap setelah disisipkan
  (trigger `encounters_immutable`). CHECK `encounters_class_fields`: IGD wajib cara datang, admisi wajib rencana masuk.
- **Pasien tanpa identitas** tidak dideteksi duplikatnya saat dibuat (belum ada atribut). Setelah dikenali, petugas RM
  mengisi identitas lewat `PATCH /patients/:id` (`unidentified: false`); deteksi duplikat MPI memasukkan pasangan ke
  antrean, lalu digabung lewat alur MPI biasa (ADR-0016).
- **SEP IGD dan SEP rawat inap belum diterbitkan otomatis**: kode poli BPJS IGD belum ditetapkan (docs/06), SEP rawat inap
  terbit saat pasien benar-benar masuk (ADT fase 3). Penjaminan BPJS IGD dicatat tanpa isian rujukan
  (`emergencyCoverageInputSchema`).
- **Rujukan berjenis** di satu tabel `referrals`: `planned_date`, `target_unit_id` (SPRI), `service_type`/`referral_type`/
  `bpjs_poli_code`/`note` (rujukan keluar; `note` juga alasan rujukan internal), status kirim `sync_*` (pola SEP), dan
  pembatalan berjejak. Rujukan batal beku kecuali status kirim (`app_referral_guard`); nomor boleh kosong bila dibatalkan
  sebelum BPJS memberi nomor.

Worker `apps/worker/src/outbox/referral.ts` (`defineBpjsOperation`, payload `{ referralId }`, data dibaca saat kirim):
`bpjs.vclaim.rencanakontrol.insert` (no. SEP asal, kode DPJP HFIS, kode poli tujuan), `bpjs.vclaim.spri.insert` (no. kartu
didekripsi dari penjaminan, poli DPJP dari templat jadwal), `bpjs.vclaim.rujukan.insert` (masa berlaku dari BPJS), dan
`bpjs.vclaim.rencanakontrol.delete` / `bpjs.vclaim.rujukan.delete`. Terbit → nomor + `active` + `sent`; ditolak →
`rejected` + kode (tanpa nomor); DLQ → `dead` + `BPJS_DLQ`; hapus yang sudah tidak ada di BPJS → `sent`. Kunci
`<operasi>:<rujukan>:<urut>` (`referrals.sync_seq`); pesan urut lama dilewati.

**Surat kontrol/SPRI tidak idempoten di VClaim** (kiriman yang timeout setelah BPJS memprosesnya bisa menerbitkan surat
kedua). Pola histori SEP: bila kiriman sebelumnya mungkin sudah diproses, worker lebih dulu `GET` daftar surat milik
kartu pada bulan tanggal rencana (`VCLAIM_ENDPOINTS.rencanaKontrolListByKartu`, filter tanggal rencana):

- "mungkin sudah diproses" = pesan ini pernah dicoba (`attempts > 0`), atau kirim ulang petugas setelah DLQ (pesan urut
  sebelumnya `dead`). Kirim ulang setelah **ditolak** (jawaban pasti) langsung insert;
- surat yang cocok (jenis, SEP asal untuk surat kontrol, tanggal rencana, poli, DPJP) dan belum dipakai baris lain →
  nomornya dipakai; tidak ada / "data tidak ditemukan" → pesan urut berikutnya yang langsung insert;
- pencarian ditolak dengan alasan lain → DLQ, agar kirim ulang berikutnya tetap mencari dulu.

Sisa celah: worker mati di antara jawaban BPJS dan pencatatan percobaan (pesan diklaim ulang setelah lease dengan
`attempts` yang sama). Rujukan keluar (`bpjs.vclaim.rujukan.insert`) belum memakai pola ini.

### Gateway informasi publik (F08)

`modules/patient-portal-gateway/`: endpoint **tanpa login dan tanpa PHI** untuk situs/aplikasi publik RS.

```
GET  /api/v1/public/:tenantCode/schedules?date=YYYY-MM-DD   jadwal + sisa kuota (hari ini s.d. booking.max_days_ahead)
GET  /api/v1/public/:tenantCode/queues[/:serviceCode]        nomor dipanggil, jumlah menunggu, perkiraan menit
POST /api/v1/public/:tenantCode/bookings/status              { bookingCode, birthDate } di BODY → status booking
```

- **RS** dari kode di path (`app_resolve_tenant_by_code`, hanya RS aktif). RS tak dikenal atau modul F08 mati → 404 `NOT_FOUND` yang sama. Semua bacaan di transaksi tenant (RLS) yang dibuka service, karena tidak ada sesi.
- **Tanpa PHI**: setiap jawaban di-`parse` skema ketat `@simrs/shared` public-info, jadi kolom di luar kontrak tidak bisa terkirim. Tes menegaskan kunci jawaban dan tidak adanya nama, tanggal lahir, no. RM, atau id pasien.
- **Status booking tahan enumerasi**: tanggal lahir dibandingkan waktu-konstan; kode tidak ada, tanggal lahir salah, atau kode milik RS lain → 404 `BOOKING_NOT_FOUND` yang identik. Setiap percobaan diaudit tanpa kode/tanggal lahir: berhasil = `read appointment` + id pasien; gagal = `denied` + alasan internal (`not_found`/`birth_date_mismatch`/`too_many_failures`).
- **Batas per kode booking** (apa pun IP-nya): tanggal lahir salah untuk booking yang ada dihitung di `RateLimitStorage.addFailure` (kunci = hash kode RS + kode booking, Redis bersama, cadangan memori). Setelah `BOOKING_STATUS_MAX_FAILURES` (bawaan 10) dalam `BOOKING_STATUS_FAILURE_WINDOW_MINUTES` (bawaan 1440) sejak salah pertama, kode itu dijawab 404 seragam, juga untuk tanggal lahir yang benar, dan diaudit `too_many_failures`. Pasien yang terkunci bertanya ke loket/WhatsApp RS.
- **Batas laju**: batas umum per IP + throttler `public` (`@PublicRateLimited()`, `PUBLIC_RATE_LIMIT_PER_MIN`) untuk jadwal/antrean; status booking memakai batas endpoint kredensial (`@AuthRateLimited()`).
- **Sementara** membaca tabel 0b langsung (`public-info.repository.ts`). Ganti ke service publik modul `scheduling`/`queue`/`booking` setelah tersedia; kontraknya tetap.

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

### Batas laju

`@nestjs/throttler` dengan tiga batas per menit, masing-masing **per endpoint** (`infra/rate-limit.ts`):

| Throttler | Pelacak                                                    | Env (bawaan)                    | Dipasang                                                                       | Header                         |
| --------- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| `default` | IP klien (`req.ip`, mengikuti `TRUST_PROXY`), tanpa tenant | `RATE_LIMIT_PER_MIN` (600)      | `IpThrottlerGuard` global, sebelum login dicek                                 | `X-RateLimit-*`, `Retry-After` |
| `auth`    | IP klien, hanya endpoint `@AuthRateLimited()`              | `AUTH_RATE_LIMIT_PER_MIN` (10)  | `IpThrottlerGuard` global                                                      | akhiran `-auth`                |
| `user`    | tenant + ID pengguna dari sesi (lintas IP)                 | `USER_RATE_LIMIT_PER_MIN` (300) | `UserThrottlerGuard` di `@TenantScoped()` sesudah AuthGuard, sebelum transaksi | akhiran `-user`                |

Lewat batas → `429 RATE_LIMITED` dan endpoint itu diblokir untuk pelacak tersebut selama satu menit. `/health` dan `/ready` tidak dibatasi; mode header pengembang (tanpa pengguna) hanya kena batas IP.

Penghitung disimpan di Redis oleh `RateLimitStorage` (`infra/rate-limit.storage.ts`) lewat `RedisService`, sehingga semua instans API berbagi hitungan. Satu skrip Lua atomik per hit (jendela geser + penanda blokir, waktu dari jam Redis). Kunci `simrs:rl:<nama database>:{<throttler>:<sha256>}`: hash dari endpoint + pelacak, jadi IP dan ID pengguna tidak tersimpan apa adanya; awalan per database memisahkan pengembangan, E2E, dan worktree lain yang memakai Redis yang sama (ganti dengan `RATE_LIMIT_REDIS_PREFIX`).

| `RATE_LIMIT_STORE`              | Redis terjangkau | Redis tidak terjangkau / gagal                                                                                                                                           |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto` (bawaan), non-produksi   | Redis            | Saat start: memori proses + peringatan (diputuskan sekali, seperti `OUTBOX_SCHEDULER=auto`). Gagal di tengah jalan: memori sementara + peringatan                        |
| `redis`, atau produksi (`auto`) | Redis            | Endpoint kredensial (`auth`) **gagal tertutup**: `503`, dicatat sekali per gangguan. Batas lain sementara di memori instans. Dicoba lagi tiap 5 detik; pemulihan dicatat |
| `memory`                        | –                | Memori proses. Ditolak di produksi                                                                                                                                       |

Setiap hit Redis dibatasi 500 ms (Redis macet tidak menahan permintaan). Gagal tertutup berarti login, MFA, ganti sandi, dan refresh sesi tidak bisa selama Redis mati di produksi; sesi yang masih berlaku tetap bisa dipakai sampai token aksesnya habis.

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

Galat yang muncul setelah respons mulai dikirim (mis. aliran SSE) hanya dicatat di log lalu koneksi ditutup, karena status HTTP tidak bisa diubah lagi.

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

| Fungsi                           | Guna                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_current_tenant()`           | Dipanggil semua kebijakan RLS. Melempar `TENANT_REQUIRED` bila `app.tenant_id` kosong.                                                                          |
| `app_active_tenant_ids()`        | `SECURITY DEFINER`, hanya mengembalikan ID tenant aktif untuk worker (ADR-0008).                                                                                |
| `app_reject_mutation()`          | Trigger yang menolak `UPDATE`/`DELETE` di tabel append-only (`audit_events`).                                                                                   |
| `app_audit_chain()`              | Trigger `BEFORE INSERT` audit: menetapkan `seq`, waktu server, `prev_hash`, dan `hash` (sha256 dari bentuk kanonik) di bawah kunci per tenant.                  |
| `app_verify_audit_chain()`       | Mengembalikan jumlah baris yang diperiksa dan `seq` pertama yang rusak (NULL bila utuh).                                                                        |
| `app_verify_audit_chain_from()`  | Seperti di atas, mulai dari titik periksa `(seq, hash)` (baris itu ikut dihitung ulang); juga mengembalikan baris terakhir yang lolos (ADR-0072).               |
| `app_audit_anchor_guard()`       | Trigger `audit_anchors`: `recorded_at` dari jam database, tolak jangkar bertanggal masa depan.                                                                  |
| `app_search_patient_names(teks)` | P05 · `SECURITY DEFINER`: kandidat nama mirip (`patient_id`, `score`) dari `search.patient_names` milik tenant `app_current_tenant()`; indeks trigram terpakai. |
| `app_sync_patient_name()`        | Trigger `patients` → `search.patient_names` (INSERT, UPDATE `name_search`).                                                                                     |
| `app_validate_patient_fks()`     | Operator/migrator: hitung baris yatim lalu `VALIDATE` FK relasi/akses darurat → pasien; ada yatim → peringatan, FK tetap `NOT VALID`, tanpa hapus.              |

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
| `seedHospitalStructure(tx, tenantId)`             | Seed · Gedung, 15 unit, kamar, dan bed fiktif (`SEED_UNITS`, `SEED_ROOMS`); upsert per kode.             |
| `reserveQuota` · `releaseQuota`                   | F01/F02 · Pesan/kembalikan satu tempat kuota sesi (UPDATE bersyarat atomik); null = penuh.               |
| `allocateQueueNumber(tx, tenantId, layanan, tgl)` | F04 · Nomor antrean `PD-027` berikutnya per layanan per hari WIB (urutan P08, maks. 999).                |
| `seedFrontOffice(prisma, tenantId)`               | Seed · Layanan antrean, praktisi, templat jadwal, penjamin, papan antrean; idempoten.                    |
| `seedStaff(prisma, tenantId, { encKeyB64 })`      | Seed · Staf fiktif `SEED_STAFF` + penugasan, tanpa sandi/MFA; idempoten per NIP, transaksi per staf.     |
| `enqueueOutbox(tx, tenantId, envelope)`           | Tulis pesan outbox di transaksi domain; idempoten per kunci.                                             |
| `claimDueOutbox(tx, limit, now)`                  | Ambil pesan jatuh tempo + lease (`SKIP LOCKED`).                                                         |
| `recordOutboxAttempt(tx, msg, result, opts)`      | Catat percobaan: `sent` / `failed` + jadwal ulang / `dead`; opsi `maxAttempts`, `capMs`, `deadline`.     |
| `deferOutboxMessage(tx, msg, { until, reason })`  | Kembalikan pesan ke `pending` tanpa menambah percobaan (dipakai `defer`).                                |
| `@simrs/db/testing` → `prepareTestDatabase()`     | Persiapan tes **tidak destruktif**: `migrate deploy` + upsert tenant fiktif ke `simrs_test(_<nama>)`.    |

## Worker

Berkas di `apps/worker/src/`:

1. `outbox/outbox.scheduler.ts` mendaftarkan _job scheduler_ BullMQ `outbox-dispatch` (tiap `OUTBOX_POLL_MS`, default 2000 ms) dengan concurrency 1. Tanpa Redis di luar produksi memakai timer (`OUTBOX_SCHEDULER=auto`, logikanya di `infra/scheduler-mode.ts`). Kunci Redis memakai prefiks `BULLMQ_PREFIX` (bawaan `bull`); tes memakai prefiks unik karena Redis dipakai bersama.
2. `outbox/outbox.dispatcher.ts` → `dispatchOnce()`: ambil daftar tenant → per tenant klaim pesan dalam transaksi singkat → siapkan permintaan (`prepare`, boleh membaca DB tenant) → kirim **di luar** transaksi, atau tunda (`defer`) → catat hasil di transaksi baru, bersama `onSuccess` (sebelum "terkirim") atau `onDead` (sesudah pindah ke DLQ) secara atomik.
3. `outbox/http-connector.ts` mengirim HTTP dengan header `Idempotency-Key` dan batas waktu, lalu mengklasifikasikan hasil (`classifyStatus`): 2xx terkirim; 5xx/408/425/429/jaringan dicoba ulang; 4xx lain permanen.
4. `outbox/bpjs-connector.ts` + `outbox/bpjs-operation.ts`: konektor BPJS (lihat di bawah).
5. `outbox/operations.ts` memetakan nama operasi → `{ prepare, onSuccess?, onDead?, retry?, sensitive? }` (tipe di `operation-types.ts`). Peta disuntikkan lewat token `OUTBOX_OPERATION_REGISTRY` agar tes bisa menambah operasi uji.
6. `jobs/`: job berkala per tenant (P11, lihat di bawah).

| Operasi               | Isi                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ping`                | Uji saluran ke `/<sistem>/_echo` di mock.                                                                                                                                      |
| `dukcapil.nik.verify` | P05 · Payload `{ patientId, identifierId }`; NIK dibaca + didekripsi saat dikirim ke `/dukcapil/verify-data`; hasil `verified`/`mismatch`/`not_found` + audit pelaku `system`. |

Payload outbox tidak boleh memuat PHI; worker memegang kunci kolom yang sama dengan API (ADR-0017).

### Kebijakan retry per operasi

`retry: { maxAttempts?, capMs?, untilEndOfServiceDay?, maxDeferMs? }` di operasi. Tanpa kebijakan: 8 percobaan, jeda backoff maks. 5 menit, lalu DLQ (ADR-0003). `untilEndOfServiceDay: true` mencoba ulang sampai **00.00 WIB berikutnya dari saat pesan dibuat, atau dari `requeued_at` bila dikirim ulang manual** (hari layanan), tanpa batas hitungan kecuali `maxAttempts` diisi; jadwal ulang yang jatuh pada/sesudah batas itu membuat pesan DLQ dengan catatan `batas waktu coba ulang terlewati`. Preset `SERVICE_DAY_RETRY` (jeda maks. 10 menit) dipakai SEP dan task ID BPJS (keputusan fase 2 #13); setelah DLQ, pengiriman ulang manual lewat tombol kirim ulang di domain.

### Tunda (`defer`)

`prepare` boleh mengembalikan `{ defer: { untilMs } }` (epoch ms) atau `{ defer: { afterMessageId } }` (+ `reason` opsional tanpa PHI). Pesan kembali `pending` **tanpa menambah percobaan** dan tanpa baris `delivery_attempts`; alasannya tampil di `last_error` sebagai `ditunda: …`. Untuk `afterMessageId` worker menjadwalkan ulang setelah percobaan berikutnya pesan prasyarat; prasyarat yang DLQ atau tidak ada membuat pesan ini ikut DLQ (urutan tidak mungkin dipenuhi). Penundaan tidak tanpa ujung: yang melewati umur `maxDeferMs` (bawaan 24 jam dari saat pesan dibuat) atau batas hari layanan menjadi DLQ. Cari pesan prasyarat dengan `ctx.findMessage({ target, idempotencyKey })`. Pola task ID BPJS:

```ts
const prev = await ctx.findMessage({
  target: 'bpjs',
  idempotencyKey: `antrean-task:${kodeBooking}:${taskId - 1}`,
});
if (prev && prev.status !== 'sent') return { defer: { afterMessageId: prev.id } };
```

### `onDead`

`onDead(tx, msg)` berjalan di transaksi yang sama dengan perpindahan ke DLQ (juga setelah `onSuccess` melempar), dengan `msg.status = 'dead'` dan `msg.lastError` terisi: tandai status domain "gagal" agar terlihat di layar. Bila `onDead` melempar, perubahannya dibatalkan, pesan tetap DLQ, dan `last_error` diberi catatan `onDead gagal`. Contoh: `tte.sign` mencatat audit `sign` berstatus `failed`.

### Konektor BPJS

Klien HTTP ada **satu** di `@simrs/shared/node` (`BpjsClient`, juga dipakai API untuk lookup sinkron, ADR-0025): header `X-cons-id`/`X-timestamp`/`X-signature`/`user_key`, lalu dekode lewat dekoder kontrak bersama (`decodeVclaimResponse`/`decodeAntreanResponse`: amplop, dekripsi AES-256-CBC + LZ-string dengan timestamp permintaan, validasi skema zod). Kode stabil hanya satu sumber, `@simrs/shared` `integrations/bpjs/common.ts`: penolakan `BPJS_REJECTIONS` + `classifyBpjsRejection` (awal pesan baku mock, lalu pola cadangan, selain itu `BPJS_TIDAK_DIKENAL`), gangguan `BPJS_FAILURES` + `classifyBpjsFailure`, label layar `bpjsErrorLabel`. Kredensial dari env (`BPJS_BASE_URL`, `BPJS_CONS_ID`, `BPJS_SECRET_KEY`, `BPJS_USER_KEY`); kosong di luar produksi = nilai mock (`<MOCK_BASE_URL>/bpjs`), di produksi wajib diisi.

| Jawaban BPJS                                                | Hasil outbox                             | Diteruskan ke                      |
| ----------------------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| `metaData.code` 200 (Aplicare: 1)                           | terkirim                                 | `onAccepted(tx, msg, response)`    |
| HTTP 200 + kode ≠ 200 (galat bisnis, mis. `BPJS_SEP_GANDA`) | **terkirim** (jawaban sudah pasti)       | `onRejected(tx, msg, { code, … })` |
| Timeout, jaringan, 5xx, 429, pemeliharaan                   | gagal, dicoba ulang (`BPJS_UNAVAILABLE`) | –                                  |
| 401/403, respons tak terbaca                                | DLQ (`BPJS_AUTH`, `BPJS_PROTOCOL`)       | `onDead`                           |

Operasi BPJS dibangun dengan `defineBpjsOperation({ prepare, response?, onAccepted?, onRejected?, onDead?, retry?, sensitive? })`. `prepare` mengembalikan `{ service: 'vclaim' | 'antrean' | 'aplicare', method, path, body? }` (bangun dari tabel kontrak, mis. `{ service: 'vclaim', ...VCLAIM_ENDPOINTS.sepInsert }` atau `bpjsPath(VCLAIM_ENDPOINTS.pesertaByNik.path, params)`), `skip`, atau `defer`; `response` = skema kontrak dari `@simrs/shared` (mis. `vclaimSepInsertResponseSchema`). Bawaan: `retry = SERVICE_DAY_RETRY`, `sensitive = true` (jejak pengiriman hanya menyimpan kode, bukan pesan/isi respons). Penolakan tanpa `onRejected` dianggap galat permanen (DLQ) agar tidak hilang diam-diam. Respons yang tidak cocok dengan skema `response` = `BPJS_PROTOCOL` (DLQ).

### Job berkala (P11)

`jobs/periodic-jobs.ts` berisi peta `PERIODIC_JOBS` (nama `<konteks>.<job>` → `{ schedule, module?, run }`). Jadwal `{ everyMs }` (10 detik–24 jam) atau `{ dailyAt: 'HH:MM' }` (WIB). `PeriodicScheduler` menjalankan `run({ tenantId, now, tx })` sekali per tenant aktif; tenant yang modulnya (`module`) nonaktif dilewati; galat satu tenant dicatat tanpa menghentikan tenant lain. Dengan Redis: satu job scheduler BullMQ per job di antrean `periodic` (concurrency 1; cron harian ber-`tz` Asia/Jakarta; jadwal yang sudah dihapus dari peta ikut dihapus saat start). Tanpa Redis di luar produksi: timer berurutan. Job **wajib idempoten** (jadwal bisa terlewat atau terulang) dan efek ke sistem luar lewat outbox. Potongan berikutnya menambah satu baris per job, mis. `scheduling.generate-sessions`, `scheduling.hfis-pull`, `booking.no-show`, `booking.reminder`. Job yang butuh env/klien lain (mis. `audit.anchor` dan `audit.daily-summary` dari `src/audit/`, ADR-0072) didaftarkan lewat factory `PERIODIC_JOB_REGISTRY` di `worker.module.ts`.

## Mock

`apps/mock/src/`:

| Berkas                            | Isi                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server.ts`                       | Membangun Fastify; hook skenario per sistem (normal, lambat, gagal, acak, timeout); log 50 request; penerima `_echo`                                                                                                                                                     |
| `systems/*.ts`                    | Satu berkas per sistem: `eklaim`, `satusehat`, `dukcapil`, `tte`, `tpdi`, `btn`, `messaging`                                                                                                                                                                             |
| `systems/bpjs/`                   | BPJS (I03): VClaim 2.0 (+ pulang SEP, ubah/hapus surat, rujukan keluar), Antrean RS + urutan task ID, HFIS, Aplicare; aturan data fiktif di `peserta.ts`, `rujukan.ts`, `master.ts` (poli INT/JAN/SAR/PAR, dokter HFIS 99001–99006); `panel.ts` = API inspeksi untuk E2E |
| `panel/panel.ts`, `panel/html.ts` | API dan HTML panel kendali                                                                                                                                                                                                                                               |
| `state.ts`                        | State di memori (hilang saat restart, disengaja)                                                                                                                                                                                                                         |
| `fixtures.ts`                     | Data fiktif deterministik dari NIK                                                                                                                                                                                                                                       |
| `config.ts`                       | Env + titik injeksi untuk tes (`sendWebhook`, `now`, `random`)                                                                                                                                                                                                           |

Mode `timeout` **memproses** permintaan lalu menahan jawabannya (meniru jawaban BPJS yang hilang: SEP sudah terbit, RS tidak tahu), berbeda dengan `gagal` yang menolak tanpa memproses. Aturan kartu/NIK/rujukan fiktif dan daftar API panel ada di `apps/mock/README.md`.

## Web

`apps/web/src/`:

| Path                          | Isi                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx`              | Root: font IBM Plex, `lang="id"`, CSS global                                                                                  |
| `proxy.ts`                    | Proxy Next 16: CSP ber-nonce per permintaan; belum login → `/masuk?lanjut=…`; cookie akses habis → perbarui sesi sekali       |
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
| `lib/server/screen-guard.ts`  | Gerbang layar hibrida demo/api: `requireScreen()` (demo → `requireDemoScreen`, api → sesi + izin `ScreenDef.permission`)      |
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
- Layar hibrida (fase 2, keputusan #4: jalur demo dipertahankan): layar yang punya `permission` di registri (Pendaftaran `encounter.write`, Jadwal `schedule.read`, Anjungan `kiosk.use`, Display antrean `queue.display.read`) memakai `requireScreen('<id>')`. Mode presentasi → jalur demo yang dibekukan di `demo-<layar>.tsx` + `actions-demo.ts`; mode api → sesi + izin sungguhan, tanpa izin "Akses ditolak", dengan izin halaman api (sementara "Belum tersambung", diisi potongan fase 2). Menu di mode api juga mengikuti izin itu. Data per layar di `lib/server/data/front-office/{jadwal,antrean,pendaftaran,kiosk}.ts`.
- Antrean (F04, potongan 4b): display TV mode api dibuka perangkat display terdaftar yang terikat ke papan (`requireDevice('queue_display')`). Halaman memuat potret papan dari API dengan token perangkat, lalu `lib/queue-sse.ts` membuka `EventSource` ke BFF `app/(perangkat)/display/antrean/events/route.ts`, yang meneruskan aliran SSE API apa adanya (token dari cookie httpOnly, `Last-Event-ID` diteruskan, `X-Accel-Buffering: no`). Event `queue.call` diterapkan ke papan oleh `applyQueueEvent` (`lib/queue-board.ts`); `reset` membuka aliran baru tanpa `Last-Event-ID` agar server mengirim potret penuh. Suara panggilan memakai nada Web Audio + Web Speech `id-ID` dan diaktifkan petugas sekali di TV. Staf memanggil dari "Kendali antrean" (`/antrean`, `queue.read`; tombol aksi `queue.call`), layar khusus mode api (`apiOnly` di registri).
- Pendaftaran (F03/F06, potongan 5b): mode api di `app/(staf)/pendaftaran/api-pendaftaran.tsx`. Klien
  (`pendaftaran-api-client.tsx` + panel `patient-panel`, `new-patient-form`, `payer-panel`, `visit-panel`) hanya
  memanggil Server Action `actions-api.ts` (BFF; NIK/no. kartu selalu di body). Alurnya: panggil nomor loket
  (`queue.call`, tiket ditautkan ke registrasi untuk task 2) → cari pasien MPI atau pasien baru (Dukcapil mengisi
  formulir, cek duplikat NIK/no. BPJS/nama + tanggal lahir sebelum disimpan) → BPJS: cek kepesertaan, pilih rujukan
  (VClaim mati → nomor rujukan manual) dan diagnosa awal ICD-10, atau umum → dokter + kuota hari ini → penanggung jawab
  → persetujuan umum (cukup sekali untuk rawat jalan) → `POST registration/outpatient` dengan Idempotency-Key dari klien
  (dipakai ulang selama isi sama, `idempotencyFor` di `lib/registration-api.ts`). Hasil di `/pendaftaran?kunjungan=<id>`
  (`registration-done.tsx`): nomor poli, chip SEP (menunggu/terbit/ditolak/gagal + alasan + "Kirim ulang SEP" untuk
  `coverage.write`), chip task 1–3; halaman memuat ulang sendiri tiap 3 dtk (20 dtk setelah 5 menit) sampai semua
  selesai. Cetak tiket + SEP: `app/cetak/pendaftaran/[encounterId]` (di luar kerangka staf, `@page` 80 mm, dialog cetak
  browser), data dari `GET registration/encounters/:id/print`. Aturan tampilan murni + tesnya di `lib/registration-api.ts`.
- Skema respons per domain ditulis di `packages/shared/src/schemas/<domain>.ts` (kontrak yang nanti dipenuhi API); halaman mengambil data lewat `lib/server/data/<domain>.ts`, yang memilih fixture (`lib/demo/`) atau API.
- Id fixture opak: pasien, kunjungan, persetujuan, dokter, tagihan, klaim, sampel, resep, dan seterusnya memakai UUID v7 konstan dari `lib/demo/fixtures/ids.ts` (nama orang hanya di kunci dan komentar). Layar, tes, dan E2E mengimpor konstanta itu, tidak menulis id sebagai literal; `ids.test.ts` menolak id yang memuat nama orang fiktif.
- Pasien fiktif dan tempatnya pada jam demo (Sen, 5 Okt 2026 · 10.45) hanya diatur di `lib/demo/fixtures/pasien.ts`: `PASIEN` (identitas), `ROSTER` (satu tempat per pasien; tempat kedua hanya bila sah dan beralasan) dan `ANTREAN_POLI_PD` (nomor antrean untuk layar Pemeriksaan dan papan TV). Saat menambah pasien atau baris fixture layar mana pun, perbarui roster; `fixtures.test.ts` menolak pasien yang muncul di dua tempat atau di tempat yang tidak tercatat.
- Server E2E ketiga (`next start` port 3011 atau `E2E_DEMO_PORT`, `DATA_SOURCE=demo`) menjalankan spesifikasi di `apps/web/e2e/demo/`; suite lain tetap di mode `api`.

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
        PIN        (cookie simrs_pin ada) POST /auth/pin/accounts → kartu "Masuk dengan PIN"
                   pinLoginAction ──► POST /auth/pin/login ──► cookie sesi ──► ?lanjut (langkah 2–3 dilewati)
/akun/pin          registerPinAction ──► POST /auth/pin/devices ──► token sd1 ke cookie simrs_pin (tidak ke browser)
halaman staf       proxy: cookie akses habis + refresh ada → refreshSession() sekali per token → cookie baru
                   requireSession() → GET /auth/me (sekali per render) → identitas, peran, unit, izin
```

| Hal                  | Aturan                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie               | `simrs_at` (akses), `simrs_rt` (refresh), `simrs_mfa*` (tantangan). httpOnly, SameSite=Lax, path /; di luar lokal Secure + `__Host-`.                |
| Cookie perangkat     | `simrs_td` (perangkat tepercaya) dan `simrs_pin` (token PIN, maks 8 akun, 30 hari) milik perangkat: tidak dihapus saat keluar.                       |
| Umur cookie akses    | 60 detik lebih pendek dari token akses, agar proxy sempat memperbarui sebelum API menolak.                                                           |
| Refresh paralel      | `refreshSession()`: janji per hash refresh token 30 detik di memori + peta bersama Redis (`SET NX`, hasil terenkripsi) antar-instans web (ADR-0073). |
| Tujuan setelah login | `?lanjut=` hanya path internal (`safeNextPath`: tanpa `//`, skema, backslash, karakter kendali).                                                     |
| IP klien ke API      | Entri paling kanan `X-Forwarded-For` (ditambahkan reverse proxy tepercaya). API mempercayainya hanya dari alamat `TRUST_PROXY`.                      |
| Menu                 | Dari `permissions` di `/auth/me` (kenyamanan saja); izin tetap ditegakkan API.                                                                       |

## UI dan sistem desain

- Token ada di `packages/ui/src/theme.css` sebagai tema Tailwind v4, misalnya `bg-brand-600`, `text-ink-700`, `rounded-card`. Sumbernya `design/tokens.json`.
- Komponen dasar: `AppShell`, `Sidebar`, `Button`, `Field`, `Chip`/`StatusChip`/`FilterChip`, `Alert`, `Card`/`KpiCard`, `Tabs`/`TabList`/`TabPanel`, `RadioSegmented`, `SafetyGate`, `PatientBanner`, `Icon`.
- Tab memakai satu primitif ARIA dari `@simrs/ui` (gaya `pil`, `segmen`, `garis`; `keepMounted` untuk menjaga isian tab lain). Jangan membuat tab lokal di layar. Pilihan nilai/mode tanpa panel (rentang, mode, kanal) memakai `RadioSegmented` (pola radio), bukan tab.
- Setiap kontrol interaktif ≥ 44 px (token `touch`); komponen `@simrs/ui` sudah memenuhinya, jadi kelas `h-11` tambahan pada `Button size="sm"` tidak diperlukan lagi.
- Layar dibangun dengan membaca mockup `design/mockups/<Layar>.dc.html` (markup + blok `<script type="text/x-dc">`), lalu ditulis ulang sebagai React. Jangan menyalin runtime mockup.

## Paket shared

| Modul                            | Isi utama                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `money.ts`                       | Uang = `bigint` rupiah. `formatRupiah(1250400n)` → `Rp 1.250.400`. Float ditolak.                                                                                                                                                                                                                                                                  |
| `datetime.ts`                    | `formatTanggalWaktu()` → `Sen, 5 Okt 2026 · 07.10` (Asia/Jakarta), `periodYYMM()` untuk penomoran                                                                                                                                                                                                                                                  |
| `env.ts`                         | Potongan skema env, `parseEnv()`, `devToolsAllowed()`                                                                                                                                                                                                                                                                                              |
| `errors.ts`                      | `ERROR_CODES`, `AppError`, skema body galat                                                                                                                                                                                                                                                                                                        |
| `ids.ts`                         | `newId()` UUID v7                                                                                                                                                                                                                                                                                                                                  |
| `outbox.ts`                      | Target integrasi, status, `backoffDelayMs()`, skema amplop                                                                                                                                                                                                                                                                                         |
| `components.ts`                  | 81 kode komponen (dibangkitkan dari `docs/02-katalog-komponen.md`)                                                                                                                                                                                                                                                                                 |
| `integrations/bpjs/`             | Kontrak kabel BPJS (I03) dipakai mock, worker, API: tabel endpoint + `bpjsPath()`, skema zod VClaim/Antrean/HFIS, `BPJS_REJECTIONS` + `classifyBpjsRejection()` (galat bisnis HTTP 200 → kode stabil), `BPJS_FAILURES` + `classifyBpjsFailure()` (gangguan), `bpjsErrorLabel()`, `checkAntreanTask()` (urutan task ID), `decodeAplicareResponse()` |
| `node.ts` (`@simrs/shared/node`) | Kripto khusus Node: tanda tangan + enkripsi BPJS, `decodeVclaimResponse`/`decodeAntreanResponse` (amplop → `ok`/`rejected`/`invalid`), `BpjsClient` (klien bertanda tangan di atas dekoder itu), HMAC TPDI                                                                                                                                         |

## Strategi tes

| Jenis            | Lokasi                                                                                                                                                            | Butuh            | Perintah                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------- |
| Unit             | `packages/shared`, `packages/ui`, `apps/web/src/**/*.test.ts`, `apps/api/test/error-filter.test.ts`, `apps/worker/test/classify.test.ts`                          | –                | `pnpm test`                         |
| Integrasi DB     | `packages/db/test` (RLS, append-only, outbox)                                                                                                                     | Postgres         | `pnpm --filter @simrs/db test`      |
| Integrasi API    | `apps/api/test` (HTTP sungguhan + DB; batas laju di Redis dengan awalan kunci per run)                                                                            | Postgres + Redis | `pnpm --filter @simrs/api test`     |
| Integrasi worker | `apps/worker/test`                                                                                                                                                | Postgres + Redis | `pnpm --filter @simrs/worker test`  |
| Mock             | `apps/mock/src/mock.test.ts`                                                                                                                                      | –                | `pnpm --filter @simrs/mock test`    |
| E2E              | `apps/web/e2e` (Playwright; Edge di Windows, Chromium di macOS/Linux): mock :4110 + API :4010 + worker + web build :3010/:3011 di DB tes, akun uji langsung di DB | Postgres         | `pnpm --filter @simrs/web test:e2e` |

Aturan:

- Tes integrasi memakai database **`simrs_test`** (bukan `simrs`), atau `simrs_test_<nama>` per salinan repo paralel; nama lain ditolak `assertTestDatabase`. Persiapannya tidak menghapus data; setiap tes memakai ID/kunci unik.
- Salinan repo paralel (git worktree) memakai `.env`, database tes, dan slot E2E sendiri (`E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_DEMO_PORT`, `E2E_MOCK_PORT`, `E2E_TMP_NAME`); lihat [Tutorial §7](./03-tutorial.md#beberapa-salinan-repo-sekaligus-git-worktree).
- Stack E2E (`apps/web/playwright.config.ts`, urutan nyala: mock → API → worker → web → web presentasi → global setup):
  - Mock E2E di `E2E_MOCK_PORT` (bawaan port API + 100). Semua URL `.env` yang menunjuk mock pengembangan (`MOCK_BASE_URL`, `BPJS_BASE_URL`, …) dialihkan ke mock ini untuk API dan worker; `TPDI_WEBHOOK_TARGET` mock menunjuk API E2E.
  - Worker outbox di DB tes dengan `OUTBOX_SCHEDULER=interval` (poll 500 ms, batas HTTP 2 dtk), bukan BullMQ: Redis dipakai bersama semua salinan repo dan `pnpm dev`. Worker tidak punya port HTTP; Playwright menunggu baris log tetap `Worker outbox siap` (`webServer.wait.stdout`, dicetak `apps/worker/src/main.ts` setelah bootstrap).
  - Worker E2E memproses **semua** pesan outbox di database tes (semua tenant, termasuk sisa tes integrasi). Jangan menjalankan `pnpm test` dan E2E bersamaan pada database tes yang sama: pesan yang diharapkan tes API/worker tetap menunggu akan ikut terkirim.
  - Helper: `e2e/support/mock.ts` (`setMockScenario(sistem, 'normal' | 'lambat' | 'gagal' | 'timeout')`, `resetMockState()`, `mockState()`, `mockEchoCount()`), `e2e/support/outbox.ts` (pesan `ping` uji + keadaan pesan untuk `expect.poll`), `e2e/support/slot.ts` (port slot).
  - Skenario mock berlaku global untuk semua tes yang sedang berjalan. Spesifikasi yang mengubahnya: `test.describe.configure({ mode: 'serial' })`, hanya di proyek desktop (tambahkan berkasnya ke `testIgnore` proyek tablet), memakai sistem yang tidak dipakai spesifikasi lain, dan mengembalikan skenario ke `normal` di `afterEach`. Contoh: `e2e/infrastruktur.spec.ts` (sistem `eklaim`). Jangan menjalankannya dengan `--repeat-each`: salinan grup serial berjalan paralel di worker Playwright lain dan saling mengembalikan skenario.
  - Global setup mereset mock dan memanggil `registerTestDevices()` (`e2e/support/devices.ts`), titik perluasan perangkat uji anjungan/TV yang masih kosong sampai prinsipal perangkat (ADR-0027) ada.
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
- [ ] Endpoint anjungan/TV memakai `@DeviceScoped(izin)`, bukan `@TenantScoped()`; perangkat tidak pernah memegang izin manusia (ADR-0027).
- [ ] `@NoRequestTransaction()` hanya untuk lookup baca-saja lewat `LookupGateway` (ADR-0025) dan aliran `SseService` (ADR-0026); akses data di dalamnya lewat `TenantDb.transaction()`.
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
