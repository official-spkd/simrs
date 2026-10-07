# Tutorial

Langkah praktis untuk pengembang baru. Konsepnya dijelaskan di [Cara sistem bekerja](./01-cara-kerja-sistem.md) dan [Cara kode bekerja](./02-cara-kerja-kode.md). Perintah ditulis untuk Windows (PowerShell atau Git Bash); di Linux/macOS/WSL sama, kecuali yang ditandai.

## 1. Menyiapkan mesin

Prasyarat: Node 24.7 atau lebih baru (argon2id bawaan, ADR-0011), Git, dan salah satu dari Docker (disarankan; Docker Desktop, atau OrbStack di macOS) atau Postgres portabel.

```powershell
# pnpm lewat corepack, dipasang ke folder pengguna (tanpa hak admin)
corepack enable --install-directory "$env:APPDATA\npm" pnpm

# di root repo
pnpm install
pnpm env:init              # buat .env dengan kunci enkripsi acak (tidak menimpa .env yang ada)
pnpm doctor                 # memeriksa Node, pnpm, Docker, port
```

Isi `.env` yang perlu diperhatikan:

| Variabel                                  | Nilai lokal                                  | Catatan                                                                                                                               |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                 | `local`                                      | Wajib untuk Swagger, endpoint `/dev`, dan area superadmin. Tidak disetel = produksi.                                                  |
| `HOST`                                    | `127.0.0.1`                                  | API dan mock tidak terbuka ke jaringan                                                                                                |
| `FIELD_ENCRYPTION_KEY`, `FIELD_HASH_KEY`  | acak 32 byte base64 (dibuat `pnpm env:init`) | Wajib. Hilang = rahasia MFA dan data terenkripsi tidak terbaca; simpan cadangannya. Ganti kunci: [Rotasi kunci](./05-rotasi-kunci.md) |
| `AUDIT_ANCHOR_KEY`                        | acak 32 byte base64 (dibuat `pnpm env:init`) | Kunci HMAC jangkar audit (ADR-0072), beda dari kunci kolom. Wajib di produksi; kosong = jangkar tidak ditulis                         |
| `AUDIT_ANCHOR_BUCKET`, `…_RETENTION_DAYS` | kosong · `1`                                 | Bucket WORM (`simrs-audit-anchors`, object lock) + masa kunci objek. Wajib di produksi; kosong = jangkar hanya di DB                  |
| `ALLOW_DEV_TENANT_HEADER`                 | `true`                                       | Lokal saja: boleh memanggil API dengan header `X-Tenant-Id` tanpa login (Swagger, curl). Diabaikan di staging/produksi                |
| `TRUST_PROXY`                             | `loopback`                                   | Alamat web/reverse proxy di depan API (IP klien asli untuk audit dan batas laju). Wajib di produksi                                   |
| `RATE_LIMIT_STORE`                        | `auto`                                       | Penghitung batas laju di Redis; tanpa Redis (lokal) jatuh ke memori + peringatan. Produksi wajib Redis                                |
| `MINIO_CONSOLE_PORT`                      | `9001`                                       | ubah bila port bentrok (mis. Laravel Herd memakai 9001)                                                                               |
| `STORAGE_DRIVER`                          | `disk` atau `s3`                             | Berkas dokumen: `disk` = folder `STORAGE_DISK_ROOT` (hanya lokal), `s3` = MinIO Docker. Staging/produksi wajib `s3`                   |
| `S3_*`                                    | lihat `.env.example`                         | MinIO lokal (`S3_BUCKET_DOCUMENTS=simrs-documents`). Produksi: kredensial khusus aplikasi, bukan root                                 |

### Mesin baru (macOS)

Repo ada di GitHub (privat): `https://github.com/faris315mfaf-ai/simrs`. `.env` dan `.local/` (database lokal, akun
presentasi, keadaan simulasi, tangkapan QA) **tidak** ikut git: di mesin baru dibuat ulang. Semua data lokal fiktif,
jadi cukup di-seed ulang (kunci `.env` baru membuat data terenkripsi dari mesin lama tidak terbaca, dan itu tidak
masalah).

```bash
git clone https://github.com/faris315mfaf-ai/simrs.git && cd simrs
nvm install && nvm use            # Node 24 dari .nvmrc (atau Homebrew node@24); Node ≥ 24.7
corepack enable                   # pnpm, versinya dari "packageManager" di package.json
pnpm install
pnpm env:init                     # .env baru dengan kunci acak
pnpm doctor
open -a OrbStack                  # Docker lewat OrbStack (atau Docker Desktop for Mac)
pnpm infra:up && pnpm infra:ps    # Postgres, Redis, MinIO, Mailpit
pnpm build && pnpm db:deploy && pnpm db:seed
pnpm db:akun-presentasi           # 16 akun presentasi (kredensial di .local/)
pnpm dev:demo                     # mode presentasi; atau pnpm dev
pnpm --filter @simrs/web exec playwright install chromium   # E2E di macOS memakai Chromium, bukan Edge
```

Yang perlu diketahui di Mac (dicoba 5 Okt 2026, Apple Silicon):

- **`node` harus v24.** Bila `node -v` menunjukkan versi lain karena alat lain menaruh `node`-nya lebih dulu di
  `PATH` (contoh: Hermes Agent memasang Node 26 di `~/.local/bin`), awali setiap terminal dengan
  `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"` (sesuaikan versinya: `ls ~/.nvm/versions/node`).
  Node 25 ke atas juga tidak lagi membawa corepack.
- `pnpm install` menjalankan skrip pasang `@embedded-postgres/darwin-arm64` (diizinkan di `allowBuilds`,
  `pnpm-workspace.yaml`), jadi `pnpm pg:portable` juga jalan di Apple Silicon.
- Image `minio/minio` dan `minio/mc` tidak bisa ditarik lagi; `docker-compose.yml` memakai build komunitas
  `pgsty/minio` dan `pgsty/mc` (drop-in).
- **Port bentrok** dengan aplikasi lain di Mac diatasi lewat `.env`:

| Gejala                                                   | Ubah                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localhost:5432` sudah dipakai (mis. Postgres Homebrew)  | Sebelum `pnpm infra:up`: `POSTGRES_PORT=5433` dan port yang sama di keempat URL database (`DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `TEST_DATABASE_URL`, `TEST_APP_DATABASE_URL`). `pnpm infra:up`, `pnpm with-pg`, `pnpm doctor`, dan `pnpm demo:cek` mengikuti `POSTGRES_PORT`                                                                                      |
| `localhost:3000`/`4000` dijawab aplikasi lain lewat IPv6 | Buka web di `http://127.0.0.1:3000` (diizinkan `allowedDevOrigins` di `next.config.ts`). `API_BASE_URL` dan `TPDI_WEBHOOK_TARGET` memakai `127.0.0.1:4000` (bawaan `.env.example`). `WEB_BASE_URL` tetap `http://localhost:3000`: tes CORS API mematok nilai itu. `pnpm doctor` memeriksa tiap port di `127.0.0.1` dan `::1` dan menandai yang dijawab aplikasi lain |

### Pilihan A: Docker (jalur utama)

Butuh virtualisasi aktif. Di Windows: aktifkan VT-x/AMD-V di BIOS, jalankan `wsl --install --no-distribution` di PowerShell **Administrator**, restart, lalu buka Docker Desktop. Di macOS: OrbStack (`open -a OrbStack`) atau Docker Desktop.

```powershell
pnpm infra:up        # Postgres, Redis, MinIO, Mailpit
pnpm infra:ps        # semua harus "healthy"
```

### Pilihan B: Postgres portabel (tanpa Docker)

Untuk mesin yang belum bisa menjalankan Docker. Hanya Postgres; Redis, MinIO, dan Mailpit tetap butuh Docker.

```powershell
pnpm pg:portable     # biarkan jendela ini terbuka; Ctrl+C untuk berhenti
```

Atau nyalakan Postgres hanya selama satu perintah, lalu otomatis dimatikan:

```powershell
pnpm with-pg pnpm test
```

Skrip ini menyimpan data di `.local/pg-data` dan menjalankan `infra/postgres/init.sql` sekali, sehingga role dan database sama dengan versi Docker. Dari `.env`, `with-pg` hanya meneruskan koneksi Postgres (`POSTGRES_PORT`, `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `TEST_DATABASE_URL`, `TEST_APP_DATABASE_URL`) dan `TZ`; variabel lain (mis. `NODE_ENV`, kunci enkripsi) dibaca sendiri oleh setiap aplikasi dari `.env`, jadi perintah berperilaku sama seperti tanpa `with-pg`. Daftar dan alasannya ada di kepala `scripts/with-pg.mjs`.

### Siapkan database pengembangan

```powershell
pnpm build           # bangun paket bersama (shared, db)
pnpm db:deploy       # terapkan semua migrasi ke database simrs
pnpm db:seed         # 3 tenant RS fiktif (RSCM, RSFA, RSFB) + tenant PLATFORM (operator)
```

Per RS, seed mengisi struktur (15 unit, kamar, bed), formulir Morse, pasien fiktif (RSCM dan RSFA 200, RSFB 30), dan
**34 staf fiktif** lintas 17 peran (dokter per poli/bangsal/OK/IGD/penunjang, residen, perawat, bidan, apoteker, analis
lab, radiografer, pendaftaran, kasir, koder, rekam medis, akuntan, manajemen, mutu, privasi, admin SIM RS) beserta
penugasan unitnya. Daftarnya ada di `SEED_STAFF` (`packages/db/src/seed-data.ts`). Nama pengguna staf = NIP fiktif
berawalan `9999` (mis. `999901292022022025`), no. HP fiktif `0813-0000-1xxx` (tersimpan terenkripsi). Seed aman diulang:
akun yang sudah ada tidak diubah.

Staf seed **tidak punya kata sandi** dan belum mendaftarkan MFA, jadi tidak bisa masuk; di **Pengguna & akses** statusnya
**Belum diaktifkan** (ada di filter status). Untuk memakai salah satunya, admin SIM RS memilih staf itu lalu **Reset kata
sandi**: sandi sementara tampil sekali, dan saat login pertama staf wajib mendaftarkan aplikasi autentikator lalu mengganti
sandi (sama dengan undangan biasa). Admin seed yang belum diaktifkan tidak dihitung sebagai admin aktif, jadi admin
terakhir yang bisa masuk tetap tidak bisa dinonaktifkan atau dicabut perannya.

Front office (fase 2) ikut di-seed per RS, selaras dengan layar mode presentasi: layanan antrean poli **PD**, **JT**,
**SR**, **PR** (dengan kode poli BPJS INT/JAN/SAR/PAR), loket pendaftaran **A**, farmasi **F**; 16 dokter fiktif (11
tertaut akun staf seed; enam dokter poli punya kode dokter HFIS fiktif 99001–99006, sama dengan mock BPJS); templat jadwal mingguan Senin–Sabtu dengan kuota JKN/non-JKN; penjamin BPJS, Umum, dan satu
asuransi fiktif; papan antrean **Rawat Jalan Lantai 2**. Sesi per tanggal belum di-seed (dibangkitkan job jadwal).
Seed juga menjalankan sinkron izin (seperti `pnpm db:sync-permissions`), jadi izin baru di katalog sampai ke peran RS
yang sudah ada cukup dengan `pnpm db:seed`.

### Buat akun untuk masuk

Tidak ada akun yang bisa langsung dipakai. Buat admin RS dan operator platform (untuk membuka panduan ini) lewat CLI:

```powershell
pnpm db:create-admin --tenant RSFA --username admin.rsfa --name "Admin RS Fiktif"
pnpm db:create-admin --tenant PLATFORM --username superadmin --name "Operator Platform"
```

Pengembangan lokal difokuskan ke **RSCM** (data tetap fiktif; kode Kemenkes/BPJS/SATUSEHAT-nya juga fiktif). Untuk mencoba semua layar dengan satu akun, buat akun demo yang memegang 17 posisi (dokter, perawat, kasir, petugas rekam medis, admin, dan seterusnya):

```powershell
pnpm db:create-demo --tenant RSCM --username demo.rscm --name "Akun Demo RSCM"
```

Untuk presentasi tanpa mengetik sandi dan kode, buat akun presentasi (16 akun fiktif, satu per posisi; hanya lokal):

```powershell
pnpm db:akun-presentasi      # kredensial disimpan di .local/demo-accounts.json (jangan dibagikan)
pnpm dev:demo                # mode presentasi
```

Di http://localhost:3000/masuk muncul bagian **Masuk cepat · mode presentasi**: klik posisi yang ingin ditunjukkan (mis. Perawat, Dokter, Kasir, Manajemen). Web menjalankan login biasa (sandi + kode verifikasi) di server atas nama Anda. Panel panduan simulasi berpindah akun otomatis saat membuka layar posisi lain.

Saat masuk, kolom Kode RS sudah terisi `RSCM` (atur lewat `LOGIN_TENANT_CODE`). Setelah kode TOTP, pilih posisi di langkah **Pilih posisi dan unit kerja**; menu dan hak akses mengikuti posisi itu. Pindah posisi tanpa keluar lewat tautan **Ganti posisi** di kanan atas (tercatat di jejak audit). Perintah ini menolak berjalan di luar `APP_ENV=local`, karena satu akun dengan semua peran meniadakan pemisahan tugas.

Seed hanya mengisi **contoh** data rujukan (72 kode yang sudah dipakai mockup, versi `contoh-mockup`). Dataset resmi diimpor dari CSV (kolom `code,display`; wilayah `code,name`), sekali per versi:

```powershell
pnpm db:import-ref --system icd10 --file .\icd10.csv --version 2019 --source WHO --dry-run   # validasi dulu
pnpm db:import-ref --system icd10 --file .\icd10.csv --version 2019 --source WHO --replace
pnpm db:import-ref --system wilayah --file .\wilayah.csv --version 2024 --source Kemendagri
```

Satu baris tidak valid membatalkan seluruh berkas dan dilaporkan per baris. `--replace` menonaktifkan kode yang tidak ada di versi baru, tanpa menghapusnya (ADR-0018).

Daftar kata sandi bocor (kata sandi baru yang ada di daftar ditolak) juga diisi operator. Lokal cukup contoh kecil yang ikut di repo; produksi wajib memakai daftar resmi, mis. berkas Pwned Passwords (Have I Been Pwned, baris `SHA1:hitungan`) yang diunduh operator di luar SIM RS. Perintah ini mengambil N hitungan terbesar dan menyimpan hanya SHA-1-nya:

```powershell
pnpm db:import-breached --file packages\db\data\breached-passwords-sample.txt --source contoh --version 1
pnpm db:import-breached --file .\pwned-passwords-sha1.txt --source "HIBP Pwned Passwords" --version v8 --top 100000 --dry-run
pnpm db:import-breached --file .\pwned-passwords-sha1.txt --source "HIBP Pwned Passwords" --version v8 --top 100000
```

Berkas teks (satu kata sandi per baris, urut paling umum) juga diterima. Isi daftar lama diganti dalam satu transaksi; baris rusak membatalkan seluruh impor. Daftar statis kecil di kode tetap berlaku walau tabel kosong.

Setelah izin baru ditambahkan ke katalog (`PERMISSION_CATALOG` + matriks bawaan di `packages/shared/src/authz.ts`), bawa izin itu ke peran RS yang sudah berjalan:

```powershell
pnpm db:sync-permissions --dry-run            # tampilkan rencana per RS, tanpa menyimpan
pnpm db:sync-permissions                      # semua tenant aktif
pnpm db:sync-permissions --tenant RSCM        # satu tenant saja
pnpm db:sync-permissions --reconcile --dry-run   # + rencana menyamakan peran sistem dengan matriks bawaan
pnpm db:sync-permissions --reconcile             # + terapkan pada peran yang belum pernah diubah RS
```

Hanya menambah izin yang baru di katalog ke peran yang memilikinya di matriks bawaan; tidak pernah mencabut, tidak mengubah lingkup yang disesuaikan RS, dan tidak memberi lagi izin yang pernah dicabut admin (dibaca dari jejak audit). Satu transaksi per tenant, setiap perubahan diaudit, aman dijalankan berulang. API yang sedang berjalan memakai izin baru paling lambat setelah `AUTHZ_CACHE_TTL_SECONDS` (bawaan 30 detik).

Bila **matriks bawaan** berubah untuk izin yang sudah ada (mis. lingkup perawat `relationship` → `unit`), jalankan `--reconcile --dry-run` lebih dulu dan baca dua bagian per RS: `✓` peran yang akan disamakan (belum pernah diubah RS) dan `? tinjau admin` peran yang pernah diubah RS (tidak disentuh, sampaikan selisihnya ke admin RS untuk diputuskan di layar Akses). Setelah rencana disetujui, jalankan tanpa `--dry-run`. Database tes lama yang matriksnya tertinggal cukup `pnpm db:sync-permissions --reconcile` dengan `MIGRATOR_DATABASE_URL` database tes, tidak perlu dibuat ulang.

Kata sandi sementara dicetak sekali. Saat login pertama di http://localhost:3000/masuk (kode RS `RSCM`, `RSFA`, atau `PLATFORM`): pindai kode QR dengan aplikasi autentikator (Google/Microsoft Authenticator), masukkan kodenya, lalu buat kata sandi baru.

## 2. Menjalankan dan memeriksa

```powershell
pnpm dev             # api + worker + web + mock sekaligus (Turborepo; butuh Docker untuk Redis)
pnpm dev:lokal       # tanpa Docker: Postgres portabel + API + web + worker + mock (Ctrl+C berhenti)
pnpm dev:demo        # sama, dalam mode presentasi: layar fase 2–10 memakai data dummy fiktif (ADR-0023)
```

| Alamat                                   | Yang terlihat                                                        |
| ---------------------------------------- | -------------------------------------------------------------------- |
| http://localhost:3000/masuk              | Layar masuk (kode RS → sandi → kode TOTP → posisi dan unit)          |
| http://localhost:3000                    | Web staf. Operator platform melihat kartu "Status sistem" (`/ready`) |
| http://localhost:3000/superadmin/panduan | Panduan ini (akun `superadmin_platform`)                             |
| http://localhost:3000/dev/ui             | Galeri token dan komponen (akun `superadmin_platform`)               |
| http://127.0.0.1:4000/docs               | Swagger API                                                          |
| http://127.0.0.1:4000/ready              | Kesehatan DB, Redis, penyimpanan berkas (JSON)                       |
| http://localhost:3000/verifikasi/{kode}  | Verifikasi QR dokumen bertanda tangan (publik, tanpa data pasien)    |
| http://127.0.0.1:4100                    | Panel kendali mock (termasuk kotak masuk email & WhatsApp)           |
| http://localhost:8025                    | Mailpit (email lokal)                                                |

Pemeriksaan cepat:

```powershell
curl.exe -s http://127.0.0.1:4000/health
curl.exe -s http://127.0.0.1:4000/ready
curl.exe -s -H "X-Tenant-Id: 0199a000-0000-7000-8000-000000000001" http://127.0.0.1:4000/api/v1/tenancy/current
```

Tanpa header `X-Tenant-Id` hasilnya `400 TENANT_REQUIRED`. Itu disengaja. Header ini hanya bekerja di lokal (`ALLOW_DEV_TENANT_HEADER=true`); di staging/produksi semua akses wajib login (`POST /api/v1/auth/login` → kode TOTP → `Authorization: Bearer …`).

## 3. Mengirim pesan outbox contoh

Tujuan: melihat sendiri alur API → outbox → worker → mock, termasuk retry dan DLQ. Butuh Postgres dan Redis (Docker).

**Langkah 1. Buat pesan** (PowerShell):

```powershell
$h = @{ 'X-Tenant-Id' = '0199a000-0000-7000-8000-000000000001' }
$msg = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4000/api/v1/dev/outbox-ping `
  -Headers $h -ContentType 'application/json' -Body '{"target":"satusehat"}'
$msg
```

**Langkah 2. Lihat statusnya.** Dalam ±2 detik worker mengirimnya, dan status berubah dari `pending` menjadi `sent`:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/v1/dev/outbox/$($msg.id)" -Headers $h
```

Di panel mock (http://127.0.0.1:4100), tabel "Pesan outbox diterima" menampilkan idempotency key yang sama.

**Langkah 3. Uji kegagalan.** Di panel mock, pilih mode **Gagal** untuk SATUSEHAT lalu Terapkan. Ulangi langkah 1–2. Status menjadi `failed`, `attempts` bertambah, dan `nextAttemptAt` makin jauh (backoff). Setelah 8 percobaan statusnya `dead` (DLQ), dan log worker mencatat peringatan `DLQ:`.

**Langkah 4. Pemulihan.** Kembalikan mode ke **Normal**. Pesan yang masih `failed` terkirim pada jadwal berikutnya.

## 4. Membuat modul API baru

Contoh: master **hari libur RS** (`holidays`), yang nanti dipakai jadwal dokter (F01). Pola ini berlaku untuk semua modul. Contoh nyata yang sudah ada dan bisa ditiru: `apps/api/src/modules/facility/` (P01).

### 4a. Model dan migrasi dengan RLS

Tambahkan model di berkas domainnya, `packages/db/prisma/schema/<domain>.prisma` (skema multi-berkas). Setiap referensi ke tabel tenant lain memakai **FK komposit `(tenantId, …)`**, karena FK tidak tunduk RLS: tanpa itu sebuah baris bisa menunjuk (dan memastikan keberadaan) baris milik RS lain.

```prisma
/// F01 · Hari libur RS (berlaku untuk seluruh faskes atau satu faskes).
model Holiday {
  id         String   @id @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  facilityId String?  @map("facility_id") @db.Uuid
  date       DateTime @db.Date
  name       String
  active     Boolean  @default(true)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  createdBy  String?  @map("created_by") @db.Uuid
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  updatedBy  String?  @map("updated_by") @db.Uuid

  tenant   Tenant    @relation(fields: [tenantId], references: [id])
  facility Facility? @relation(fields: [tenantId, facilityId], references: [tenantId, id])

  @@unique([tenantId, facilityId, date])
  @@map("holidays")
}
```

Tambahkan relasi balik (`holidays Holiday[]`) di model `Tenant` dan `Facility`. Lalu buat migrasi **tanpa langsung menerapkannya**:

```powershell
pnpm --filter @simrs/db exec prisma migrate dev --create-only --name holidays
```

Buka `migration.sql` yang baru. **Di baris paling atas**, matikan sementara `FORCE` RLS pada setiap tabel lama yang dirujuk FK baru (di sini `facilities`). Validasi FK berjalan sebagai pemilik tabel tanpa konteks tenant, sehingga tanpa baris ini migrasi gagal `TENANT_REQUIRED`, bahkan bila tabel barunya masih kosong.

```sql
-- Validasi FK baru ke tabel ber-FORCE RLS tidak punya konteks tenant. Seluruh migrasi berjalan dalam
-- satu transaksi, jadi aplikasi tidak pernah melihat tabel tanpa FORCE.
ALTER TABLE "facilities" NO FORCE ROW LEVEL SECURITY;
```

Lalu **tambahkan blok ini di bawahnya**. Tabel domain tanpa blok ini adalah kebocoran data antar-RS.

```sql
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holidays" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "holidays"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Master tidak dihapus (pakai kolom active). DELETE dicabut eksplisit karena default privileges
-- di init.sql memberikannya otomatis untuk tabel baru.
GRANT SELECT, INSERT, UPDATE ON "holidays" TO simrs_app;
REVOKE DELETE, TRUNCATE ON "holidays" FROM simrs_app;

-- Pasang lagi FORCE yang dimatikan di atas.
ALTER TABLE "facilities" FORCE ROW LEVEL SECURITY;
```

Hal yang sama berlaku bila menambah kolom FK ke tabel lama yang ber-`FORCE` (contoh nyata: migrasi `20261004030000_authz` membungkus `users`, `units`, `auth_sessions`). Tes `packages/db/test/schema-guard.test.ts` gagal bila ada tabel yang lupa dipasang `FORCE` lagi.

Terapkan: `pnpm db:migrate`, lalu `pnpm --filter @simrs/db build`. Migrasi yang sudah diterapkan di mana pun **tidak diubah lagi**; perbaikan selalu migrasi baru.

### 4b. Skema validasi bersama

Skema zod disimpan di `packages/shared/src/schemas/` agar dipakai API dan web. Contoh `holiday.ts`:

```ts
import { z } from 'zod';

export const createHolidaySchema = z.strictObject({
  facilityId: z.uuid().optional(),
  date: z.iso.date(),
  name: z.string().trim().min(2).max(120),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
```

Ekspor dari `packages/shared/src/index.ts`, lalu `pnpm --filter @simrs/shared build`. `strictObject` menolak field tak dikenal, sehingga klien tidak bisa menyelipkan `tenantId` atau field lain.

### 4c. Repository, service, controller

**Repository** (`apps/api/src/modules/holidays/holidays.repository.ts`) memakai `TenantDb`: transaksi permintaan yang sudah ber-RLS. Jangan membuka transaksi sendiri dan jangan menerima `tenantId` dari luar.

```ts
import { Injectable } from '@nestjs/common';
import { newId, type CreateHolidayInput } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

const HOLIDAY_SELECT = { id: true, facilityId: true, date: true, name: true, active: true } as const;

@Injectable()
export class HolidaysRepository {
  constructor(private readonly db: TenantDb) {}

  list() {
    return this.db
      .tx()
      .holiday.findMany({ where: { active: true }, orderBy: { date: 'asc' }, select: HOLIDAY_SELECT });
  }

  create(input: CreateHolidayInput) {
    const actor = this.db.actorUserId();
    return this.db.tx().holiday.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        facilityId: input.facilityId,
        date: new Date(input.date),
        name: input.name,
        createdBy: actor,
        updatedBy: actor,
      },
      select: HOLIDAY_SELECT,
    });
  }
}
```

**Service** berisi aturan bisnis dan melempar `AppError` berkode. Galat database yang umum tidak perlu ditangkap: tanggal ganda (unik, P2002) otomatis menjadi `409 CONFLICT` dan referensi faskes yang tidak valid (P2003) menjadi `400` oleh `AppErrorFilter`.

```ts
import { Injectable } from '@nestjs/common';
import { AppError, type CreateHolidayInput } from '@simrs/shared';
import { HolidaysRepository } from './holidays.repository';

@Injectable()
export class HolidaysService {
  constructor(private readonly repo: HolidaysRepository) {}

  list() {
    return this.repo.list();
  }

  create(input: CreateHolidayInput) {
    if (new Date(input.date).getUTCFullYear() < 2000) {
      throw new AppError('VALIDATION_FAILED', 'Tanggal libur tidak wajar', 400);
    }
    return this.repo.create(input);
  }
}
```

**Controller** tetap tipis. Tiga dekorator wajib dipahami:

| Dekorator               | Fungsi                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@TenantScoped()`       | Menetapkan tenant + membuka **satu transaksi ber-RLS untuk seluruh permintaan**. Wajib untuk semua controller yang menyentuh data tenant.            |
| `@Audited({...})`       | Menulis jejak audit **di transaksi yang sama**. Bila permintaan gagal, data dan auditnya sama-sama batal; bila audit gagal, data tidak dikembalikan. |
| `@RequireModule('F01')` | Endpoint hanya aktif bila modul aktif untuk RS ini (P10). Modul mati → `403 MODULE_DISABLED`.                                                        |
| `@RequirePermission(…)` | Peran pengguna harus memegang izin sumber × aksi itu (P03). Tidak berhak → `403 FORBIDDEN` + audit `access_denied`.                                  |

```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHolidaySchema, type CreateHolidayInput } from '@simrs/shared';
import { Audited, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { HolidaysService } from './holidays.service';

@ApiTags('holidays (F01)')
@TenantScoped()
@RequireModule('F01')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @RequirePermission('facility', 'read')
  list() {
    return this.holidays.list();
  }

  @Post()
  @RequirePermission('facility', 'write')
  @Audited({ action: 'create', resource: 'holiday', resourceId: resultId })
  create(@Body(new ZodValidationPipe(createHolidaySchema)) body: CreateHolidayInput) {
    return this.holidays.create(body);
  }
}
```

Hari libur memakai izin `facility` yang sudah ada di katalog. Sumber izin baru ditambahkan di `PERMISSION_CATALOG` dan `DEFAULT_ROLE_GRANTS` (`packages/shared/src/authz.ts`); ingat bahwa bawaan hanya diisi untuk peran yang baru dibuat, jadi RS yang sudah berjalan mendapat izin baru lewat layar Akses atau migrasi data.

Untuk data pasien, isi juga `patientId` di `@Audited` (atau panggil `TenantDb.audit(...)` dari service untuk setiap pasien yang tampil di daftar). Untuk perubahan, pakai `details: changedFields` agar audit mencatat **nama** field yang berubah, bukan nilainya.

Daftarkan provider di `holidays.module.ts`, lalu tambahkan `HolidaysModule` ke daftar `imports` di `AppModule.forRoot`. Handler **tidak boleh** memanggil sistem eksternal (transaksi masih terbuka); kirim lewat outbox (§6).

### 4d. Tes wajib

`apps/api/test/holidays.test.ts`. Minimal: tenant B tidak melihat data tenant A, input salah ditolak, data ganda menjadi `CONFLICT`, dan perubahan tercatat di audit. Contoh lengkap pola tes ada di `apps/api/test/facility.test.ts`.

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, TENANT_A, TENANT_B } from './helpers';

let app: NestExpressApplication;
beforeAll(async () => (app = await createTestApp()));
afterAll(async () => app?.close());

it('hari libur tenant A tidak terlihat oleh tenant B', async () => {
  const name = `Libur uji ${Date.now()}`;
  await request(app.getHttpServer())
    .post('/api/v1/holidays')
    .set('X-Tenant-Id', TENANT_A)
    .send({ date: '2031-12-25', name })
    .expect(201);
  const b = await request(app.getHttpServer())
    .get('/api/v1/holidays')
    .set('X-Tenant-Id', TENANT_B)
    .expect(200);
  expect(b.body.map((h: { name: string }) => h.name)).not.toContain(name);
});
```

Tes izin memakai login sungguhan (mode header melewati matriks):

```ts
import { bearer, createTestUser, login } from './helpers';

it('kasir tidak boleh menambah hari libur', async () => {
  const kasir = await createTestUser(TENANT_A, { roles: [{ code: 'kasir' }] });
  const tokens = await login(app, kasir);
  await request(app.getHttpServer())
    .post('/api/v1/holidays')
    .set(bearer(tokens))
    .send({ date: '2031-12-26', name: 'Uji izin' })
    .expect(403);
});
```

Jalankan `pnpm --filter @simrs/api test` (tanpa Docker: `pnpm with-pg pnpm --filter @simrs/api test`), lalu catat modul di `docs/PROGRESS.md`.

## 5. Membuat layar web dari mockup

1. Baca `docs/08-desain-ui.md` §4 untuk rute dan komponen, lalu buka `design/mockups/<Layar>.dc.html`. Markup di dalam `<x-dc>` memberi tata letak; blok `<script type="text/x-dc">` memberi state, data contoh, dan aturan gerbang.
2. Buat halaman di `apps/web/src/app/(staf)/<rute>/page.tsx` sebagai **komponen server**. Ambil data dari API di server. Bila backend layar itu belum ada (mode presentasi, ADR-0023): awali dengan `await requireDemoScreen('<id>')`, ambil data lewat `lib/server/data/<domain>.ts` (fixture fiktif di `lib/demo/`, divalidasi skema di `packages/shared/src/schemas/`, id dari `lib/demo/fixtures/ids.ts`), dan panggil `assertDemo()` di setiap Server Action. Layar yang sudah punya izin sungguhan tetapi jalur demonya dipertahankan (layar hibrida) memakai `requireScreen('<id>')`: jalur demo di `demo-<layar>.tsx` + `actions-demo.ts`, jalur api di `page.tsx`.
3. Pisahkan bagian interaktif ke komponen `'use client'` kecil. Jangan meneruskan rahasia atau env ke komponen klien.
4. Pakai komponen `@simrs/ui` dan kelas token (`bg-brand-600`, `text-ink-700`, `rounded-card`). Jangan menulis warna heksadesimal baru.
5. Layar klinis wajib menampilkan `PatientBanner`. Tombol yang belum boleh dipakai tetap terlihat, nonaktif, dan alasannya tertulis.
6. Nyalakan menunya: untuk layar fase 2–10 ubah status layar di `apps/web/src/lib/screens.ts` (`belum` → `demo`, atau `api` bila sudah tersambung); menu lain memakai `available: true` di `apps/web/src/lib/nav.ts`.
7. Tambahkan tes Playwright di `apps/web/e2e/` untuk alur utama, termasuk gerbang keselamatan (layar mode presentasi: di `apps/web/e2e/demo/`).

## 6. Menambah endpoint mock dan operasi outbox

**Mock.** Tambahkan rute di `apps/mock/src/systems/<sistem>.ts`, mengikuti kontrak di `docs/06-integrasi.md`. Skenario normal/lambat/gagal otomatis berlaku untuk semua rute berprefiks `/<sistem>`. Tambahkan tes di `apps/mock/src/mock.test.ts` dengan `app.inject(...)`.

**Operasi outbox.** Tambahkan entri di `apps/worker/src/outbox/operations.ts`. Operasi ke BPJS dibangun dengan `defineBpjsOperation` (tanda tangan, dekripsi, dan pemetaan `metaData` sudah ditangani konektor):

```ts
[
  'antrean.updatewaktu',
  defineBpjsOperation({
    prepare: (msg) => ({ service: 'antrean', ...ANTREAN_ENDPOINTS.updateWaktu, body: msg.payload }),
    async onAccepted(tx, msg) {
      /* tandai task terkirim */
    },
    async onRejected(tx, msg, rejection) {
      /* tandai task ditolak + rejection.code, mis. BPJS_TASK_TIDAK_BERURUTAN */
    },
  }),
],
```

Operasi yang butuh data pribadi (mis. NIK) **tidak** menaruhnya di payload: payload cukup berisi ID, lalu `prepare(msg, ctx)` membaca dan mendekripsi lewat `ctx.read(...)`/`ctx.crypto`. Kembalikan `{ skip: 'alasan' }` bila pesan sudah tidak relevan, atau `{ defer: { afterMessageId } }` bila harus menunggu pesan lain (urutan task ID). Bila respons perlu disimpan, isi `onSuccess(tx, msg, body)` (operasi BPJS: `onAccepted`/`onRejected`): ia berjalan di transaksi yang sama dengan pencatatan "terkirim", dan melempar `PermanentOperationError` membuat pesan masuk DLQ. Status domain "gagal" diisi di `onDead(tx, msg)`, atomik dengan perpindahan ke DLQ. Batas coba ulang per operasi lewat `retry` (operasi BPJS bawaannya sampai akhir hari layanan WIB). Respons berisi data pribadi ditandai `sensitive: true`. Contoh lengkap: `apps/worker/src/outbox/dukcapil.ts` (ADR-0017) dan bagian Worker di [Cara kode bekerja](./02-cara-kerja-kode.md#worker).

Lalu dari service domain, di **dalam transaksi yang sama** dengan perubahan datanya:

```ts
await enqueueOutbox(tx, tenantId, {
  target: 'bpjs',
  operation: 'antrean.updatewaktu',
  idempotencyKey: `antrean-${kodeBooking}-task-${taskId}`,
  payload: { kodebooking: kodeBooking, taskid: taskId, waktu: Date.now() },
});
```

Idempotency key harus deterministik dari datanya (bukan acak), agar pengulangan aksi tidak menghasilkan kiriman ganda.

## 7. Menjalankan tes dan sebelum commit

```powershell
pnpm lint
pnpm typecheck
pnpm test                          # unit + integrasi (butuh Postgres; worker dan tes batas laju API juga butuh Redis)
pnpm --filter @simrs/web test:e2e  # Playwright; menyalakan sendiri mock :4110, API :4010, worker, build web :3010 dan :3011 (presentasi)
```

Sebelum commit:

1. Ketiga perintah pertama hijau. Tes yang gagal diperbaiki penyebabnya, bukan dilemahkan.
2. Periksa [daftar periksa keamanan](./02-cara-kerja-kode.md#daftar-periksa-keamanan-per-perubahan).
3. Commit dengan Conventional Commits dan sebut kode komponen, misalnya `feat(units): master unit layanan` dengan badan `Komponen: P01`.
4. Perbarui `docs/PROGRESS.md`. Keputusan arsitektur baru dicatat sebagai ADR di `docs/adr/`; nomornya mengikuti blok per fase di `docs/adr/README.md` (agar agen paralel tidak memakai nomor yang sama).

### Beberapa salinan repo sekaligus (git worktree)

Beberapa cabang bisa dikerjakan dan dites bersamaan (mis. oleh beberapa agen) dengan `git worktree`. Postgres (satu server), Redis, MinIO, Mailpit, dan port `pnpm dev` (3000/4000/4100) dipakai bersama, jadi `pnpm dev` hanya di satu salinan. Yang dipisah per salinan: `.env`, database, dan slot E2E. Penghitung batas laju API di Redis otomatis terpisah per database (awalan kunci `simrs:rl:<nama database>:`).

1. Buat salinan dan `.env`-nya (`.env` tidak ikut git; kunci enkripsinya boleh sama):

   ```bash
   git worktree add ../simrs-pin -b feat/pin     # dari checkout utama
   cd ../simrs-pin
   cp ../simrs/.env .env
   pnpm install && pnpm build
   ```

2. Buat database sendiri sebagai superuser `postgres`, lalu arahkan **keempat** URL database di `.env` salinan itu ke sana (`DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `TEST_DATABASE_URL`, `TEST_APP_DATABASE_URL`):

   ```bash
   docker compose exec postgres psql -U postgres -c "CREATE DATABASE simrs_test_pin OWNER simrs_migrator"
   ```

   Nama wajib `simrs_test_<nama>` (huruf kecil, angka, garis bawah): persiapan tes (`assertTestDatabase` di `@simrs/db/testing`) menolak nama lain agar tes tidak pernah memigrasi atau mengisi database pengembangan. Database kosong cukup; `pnpm test` atau E2E pertama menerapkan migrasi dan seed tenant fiktif sendiri (migrasi memuat `CREATE EXTENSION` dan `GRANT`, ADR-0008).

3. Jalankan E2E di slot sendiri. Bawaannya API :4010, web :3010, web presentasi :3011, mock :4110 (`E2E_MOCK_PORT`, bawaan = port API + 100), dan folder sementara `simrs-demo-e2e` (kredensial akun presentasi uji + keadaan simulasi); dua salinan dengan nilai yang sama saling bertabrakan. Worker outbox E2E tidak memakai port (penjadwal `interval`, bukan BullMQ, karena Redis dipakai bersama):

   ```bash
   E2E_API_PORT=4020 E2E_WEB_PORT=3020 E2E_DEMO_PORT=3021 E2E_MOCK_PORT=4120 E2E_TMP_NAME=simrs-demo-e2e-pin \
     pnpm --filter @simrs/web test:e2e
   ```

   Port yang sudah terpakai membuat Playwright berhenti dengan pesan "… is already used". Port yang diblokir `fetch`/browser (mis. 4190, 5060, 6000, 6665–6669, 10080) ditolak saat konfigurasi dimuat (`e2e/support/slot.ts`); API :4090 karena itu butuh `E2E_MOCK_PORT` eksplisit (bawaannya 4190). Tangkapan `QA_VISUAL=1` masuk ke `.local/qa-visual/` milik salinan itu.

Aturan:

- Migrasi dari cabang yang belum digabung **hanya** diterapkan ke database salinan itu sendiri, tidak ke `simrs` atau database salinan lain. Setelah digabung ke `master`, checkout utama menerapkannya dengan `pnpm db:deploy`.
- Bila migrasi cabang diubah setelah diterapkan (checksum ditolak), `pnpm db:test:recreate -- --yes` di salinan itu hanya membuat ulang database di `TEST_DATABASE_URL`-nya (aturan nama yang sama).
- Di satu salinan, jalankan `pnpm test` dan E2E bergantian, jangan bersamaan: worker E2E mengirim semua pesan outbox di database tes, termasuk pesan yang sedang diperiksa tes integrasi.
- Skenario mock (`setMockScenario`) berlaku untuk **semua** tes yang sedang berjalan. Spesifikasi yang mengubahnya: serial, hanya proyek desktop (daftarkan juga di `testIgnore` proyek tablet), dan kembali `normal` di `afterEach`. Untuk gangguan BPJS yang tidak boleh mengganggu tes lain, pakai gangguan per peserta `setBpjsOutage(noKartu, true)` (`e2e/support/front-office.ts`, panel mock `POST /_panel/api/bpjs/outage`), seperti `e2e/downtime-bpjs.spec.ts`.
- Rantai DoD fase 2 (`e2e/dod-anjungan.spec.ts`): booking lewat API memakai token petugas yang sedang login (`createJknBooking`), lalu anjungan → Kendali antrean → Pendaftaran → TV, dan task 1–3 diperiksa di panel BPJS mock (`mockAntrean`). Butuh sesi poli PD yang cocok dengan HFIS mock (`hfisSession`), jadi dilewati hari Minggu.
- `QA_VISUAL=1` juga menangkap layar fase 2 mode api (Jadwal, Kendali antrean, Pendaftaran, anjungan, TV) ke `.local/qa-visual/api-1366x768/` dan `api-1920x1080/` (`e2e/qa-visual-fase2.spec.ts`; tanpa variabel itu spesifikasinya dilewati).
- Selesai: `git worktree remove ../simrs-pin`. Databasenya tidak ikut terhapus.

### Backup dan uji restore

Backup terenkripsi tiga lokasi (`pnpm backup:jalankan`), uji restore di kontainer bersih (`pnpm backup:uji-restore`),
dan pemulihan bencana (`pnpm backup:dekripsi`) dijelaskan di [Backup dan restore](./04-backup-restore.md). Untuk
mencobanya di salinan repo: peran `simrs_backup` (§2 halaman itu), `BACKUP_DATABASE_URL` ke database tes salinan
itu, kunci uji dari `pnpm backup:kunci-baru --keluar <folder di luar repo>`, dan `BACKUP_PREFIX` + bucket offsite
sendiri agar tidak bercampur dengan salinan lain.

## 8. Pemecahan masalah

| Gejala                                                       | Penyebab dan solusi                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker: "virtualization is not enabled" / galat 500          | Aktifkan virtualisasi di BIOS, `wsl --install --no-distribution` (Admin), restart. Sementara itu pakai `pnpm pg:portable`.                                                            |
| `corepack enable` gagal EPERM                                | Folder Node di Program Files butuh admin. Pakai `--install-directory "$env:APPDATA\npm"`.                                                                                             |
| Port 9001 sudah dipakai                                      | Program lain (mis. Laravel Herd). Setel `MINIO_CONSOLE_PORT=9011` di `.env`.                                                                                                          |
| `TENANT_REQUIRED` atau "Akses data di luar transaksi tenant" | Controller lupa `@TenantScoped()`, atau kode di luar permintaan (seed, worker) tidak memakai `withTenant`.                                                                            |
| `new row violates row-level security policy`                 | Menulis baris dengan `tenant_id` berbeda dari konteks. Ambil `tenantId` dari `@CurrentTenant()`, jangan dari body.                                                                    |
| Tes: "prisma migrate deploy gagal untuk simrs_test…"         | Postgres mati, database tes belum dibuat, atau migrasi lama diubah. Bila checksum ditolak: `pnpm db:test:recreate -- --yes` (hanya database tes di `TEST_DATABASE_URL`).              |
| Tes: "Persiapan tes menolak database …"                      | `TEST_DATABASE_URL`/`TEST_APP_DATABASE_URL` harus menunjuk `simrs_test` atau `simrs_test_<nama>` ([salinan paralel](#beberapa-salinan-repo-sekaligus-git-worktree)).                  |
| `node -v` bukan v24, atau `corepack` tidak dikenal           | Alat lain menaruh `node`-nya lebih dulu di `PATH`. Lihat [Mesin baru (macOS)](#mesin-baru-macos).                                                                                     |
| Migrasi: "FK … belum divalidasi: N baris merujuk pasien…"    | Relasi/akses darurat lama ke pasien yang tidak ada. Tidak ada yang dihapus; FK tetap memeriksa baris baru. Tes: `pnpm db:test:recreate -- --yes`; lainnya: ADR-0015 (5 Okt 2026).     |
| Prisma menolak `migrate reset` dari agen AI                  | Pengaman Prisma. Reset database hanya oleh manusia secara sadar. Tes tidak pernah membutuhkannya.                                                                                     |
| `/docs` atau `/superadmin` 404                               | `APP_ENV` tidak `local`/`staging`. Periksa `.env`, lalu restart.                                                                                                                      |
| Tes worker/API: "Redis tidak terjangkau"                     | Redis butuh Docker (`pnpm infra:up`). Tes BullMQ dan tes batas laju bersama sengaja tidak dilewati.                                                                                   |
| `pnpm install`: "Ignored build scripts"                      | pnpm memblokir skrip instalasi yang belum disetujui. Periksa paketnya, lalu `pnpm approve-builds <paket>` atau tolak dengan `!<paket>`. Keputusan tersimpan di `pnpm-workspace.yaml`. |
