# Tutorial

Langkah praktis untuk pengembang baru. Konsepnya dijelaskan di [Cara sistem bekerja](./01-cara-kerja-sistem.md) dan [Cara kode bekerja](./02-cara-kerja-kode.md). Perintah ditulis untuk Windows (PowerShell atau Git Bash); di Linux/macOS/WSL sama, kecuali yang ditandai.

## 1. Menyiapkan mesin

Prasyarat: Node 22 atau lebih baru, Git, dan salah satu dari Docker Desktop (disarankan) atau Postgres portabel.

```powershell
# pnpm lewat corepack, dipasang ke folder pengguna (tanpa hak admin)
corepack enable --install-directory "$env:APPDATA\npm" pnpm

# di root repo
pnpm install
copy .env.example .env      # Git Bash: cp .env.example .env
pnpm doctor                 # memeriksa Node, pnpm, Docker, port
```

Isi `.env` yang perlu diperhatikan:

| Variabel                                 | Nilai lokal         | Catatan                                                                              |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `APP_ENV`                                | `local`             | Wajib untuk Swagger, endpoint `/dev`, dan area superadmin. Tidak disetel = produksi. |
| `HOST`                                   | `127.0.0.1`         | API dan mock tidak terbuka ke jaringan                                               |
| `FIELD_ENCRYPTION_KEY`, `FIELD_HASH_KEY` | acak 32 byte base64 | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`        |
| `JWT_*_SECRET`                           | acak panjang        | jangan dipakai ulang di lingkungan lain                                              |
| `MINIO_CONSOLE_PORT`                     | `9001`              | ubah bila port bentrok (mis. Laravel Herd memakai 9001)                              |

### Pilihan A: Docker (jalur utama)

Butuh virtualisasi aktif. Di Windows: aktifkan VT-x/AMD-V di BIOS, jalankan `wsl --install --no-distribution` di PowerShell **Administrator**, restart, lalu buka Docker Desktop.

```powershell
pnpm infra:up        # Postgres, Redis, MinIO, Mailpit
pnpm infra:ps        # semua harus "healthy"
```

### Pilihan B: Postgres portabel (tanpa Docker)

Untuk mesin yang belum bisa menjalankan Docker. Hanya Postgres; Redis, MinIO, dan Mailpit tetap butuh Docker.

```powershell
pnpm pg:portable     # biarkan jendela ini terbuka; Ctrl+C untuk berhenti
```

Skrip ini menyimpan data di `.local/pg-data` dan menjalankan `infra/postgres/init.sql` sekali, sehingga role dan database sama dengan versi Docker.

### Siapkan database pengembangan

```powershell
pnpm build           # bangun paket bersama (shared, db)
pnpm db:deploy       # terapkan semua migrasi ke database simrs
pnpm db:seed         # 2 tenant RS fiktif
```

## 2. Menjalankan dan memeriksa

```powershell
pnpm dev             # api + worker + web + mock sekaligus (Turborepo)
```

| Alamat                                   | Yang terlihat                                                         |
| ---------------------------------------- | --------------------------------------------------------------------- |
| http://localhost:3000                    | Web staf. Kartu "Status sistem" di Beranda menampilkan hasil `/ready` |
| http://localhost:3000/superadmin/panduan | Panduan ini                                                           |
| http://localhost:3000/dev/ui             | Galeri token dan komponen                                             |
| http://127.0.0.1:4000/docs               | Swagger API                                                           |
| http://127.0.0.1:4000/ready              | Kesehatan DB, Redis, MinIO (JSON)                                     |
| http://127.0.0.1:4100                    | Panel kendali mock                                                    |
| http://localhost:8025                    | Mailpit (email lokal)                                                 |

Pemeriksaan cepat:

```powershell
curl.exe -s http://127.0.0.1:4000/health
curl.exe -s http://127.0.0.1:4000/ready
curl.exe -s -H "X-Tenant-Id: 0199a000-0000-7000-8000-000000000001" http://127.0.0.1:4000/api/v1/tenancy/current
```

Tanpa header `X-Tenant-Id` hasilnya `400 TENANT_REQUIRED`. Itu disengaja.

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

Contoh: master **unit layanan** (`units`, bagian dari P01). Pola ini berlaku untuk semua modul.

### 4a. Model dan migrasi dengan RLS

Tambahkan model di `packages/db/prisma/schema.prisma`:

```prisma
/// P01 · Unit layanan (instalasi, poli, bangsal, depo). Master: tidak dihapus, dinonaktifkan.
model Unit {
  id        String   @id @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  code      String
  name      String
  kind      String
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, code])
  @@map("units")
}
```

Tambahkan juga `units Unit[]` di model `Tenant`. Lalu buat migrasi **tanpa langsung menerapkannya**:

```powershell
pnpm --filter @simrs/db exec prisma migrate dev --create-only --name units
```

Buka berkas `migration.sql` yang baru dan **tambahkan blok RLS di bawahnya**. Tabel domain tanpa blok ini adalah kebocoran data antar-RS.

```sql
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "units"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Master data tidak dihapus (pakai kolom active).
GRANT SELECT, INSERT, UPDATE ON "units" TO simrs_app;
REVOKE DELETE ON "units" FROM simrs_app;
```

Terapkan: `pnpm db:migrate`, lalu `pnpm --filter @simrs/db build`.

### 4b. Skema validasi bersama

Skema zod disimpan di `packages/shared` agar dipakai API dan web, misalnya `packages/shared/src/schemas/unit.ts`:

```ts
import { z } from 'zod';

export const UNIT_KINDS = ['instalasi', 'poli', 'bangsal', 'depo'] as const;

export const createUnitSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9-]{2,20}$/, 'Kode 2–20 huruf kapital/angka/strip'),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(UNIT_KINDS),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
```

Ekspor dari `packages/shared/src/index.ts`, lalu `pnpm --filter @simrs/shared build`.

### 4c. Repository, service, controller

`apps/api/src/modules/units/units.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { newId, type CreateUnitInput } from '@simrs/shared';
import { PrismaService } from '../../infra/prisma.service';

const UNIT_SELECT = { id: true, code: true, name: true, kind: true, active: true } as const;

@Injectable()
export class UnitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.unit.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: UNIT_SELECT }),
    );
  }

  create(tenantId: string, input: CreateUnitInput) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.unit.create({ data: { id: newId(), tenantId, ...input }, select: UNIT_SELECT }),
    );
  }
}
```

`units.service.ts` berisi aturan bisnis. Contoh: kode unit unik per RS, sehingga pelanggaran unik Prisma (`P2002`) diterjemahkan menjadi `CONFLICT`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import { AppError, type CreateUnitInput } from '@simrs/shared';
import { UnitsRepository } from './units.repository';

@Injectable()
export class UnitsService {
  constructor(private readonly repo: UnitsRepository) {}

  list(tenantId: string) {
    return this.repo.list(tenantId);
  }

  async create(tenantId: string, input: CreateUnitInput) {
    try {
      return await this.repo.create(tenantId, input);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('CONFLICT', 'Kode unit sudah dipakai', 409);
      }
      throw e;
    }
  }
}
```

`units.controller.ts` tetap tipis:

```ts
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createUnitSchema, type CreateUnitInput } from '@simrs/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant-context';
import { UnitsService } from './units.service';

@ApiTags('units')
@UseGuards(TenantGuard)
@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  list(@CurrentTenant() tenantId: string) {
    return this.units.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createUnitSchema)) body: CreateUnitInput,
  ) {
    return this.units.create(tenantId, body);
  }
}
```

Daftarkan di `units.module.ts` (impor `TenancyModule` untuk `TenantGuard`), lalu tambahkan `UnitsModule` ke daftar `imports` di `AppModule.forRoot`.

### 4d. Tes wajib

`apps/api/test/units.test.ts`. Minimal: tenant B tidak melihat unit tenant A, input salah ditolak, dan kode ganda menjadi `CONFLICT`.

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, TENANT_A, TENANT_B } from './helpers';

let app: NestExpressApplication;
beforeAll(async () => (app = await createTestApp()));
afterAll(async () => app?.close());

it('unit tenant A tidak terlihat oleh tenant B', async () => {
  const code = `U-${newId().slice(-8).toUpperCase()}`;
  await request(app.getHttpServer())
    .post('/api/v1/units')
    .set('X-Tenant-Id', TENANT_A)
    .send({ code, name: 'Poli Fiktif', kind: 'poli' })
    .expect(201);
  const b = await request(app.getHttpServer()).get('/api/v1/units').set('X-Tenant-Id', TENANT_B).expect(200);
  expect(b.body.map((u: { code: string }) => u.code)).not.toContain(code);
});
```

Jalankan `pnpm --filter @simrs/api test`, lalu catat modul di `docs/PROGRESS.md`. Mulai fase 1, tambahkan juga tes izin (peran yang tidak berhak menerima 403).

## 5. Membuat layar web dari mockup

1. Baca `docs/08-desain-ui.md` §4 untuk rute dan komponen, lalu buka `design/mockups/<Layar>.dc.html`. Markup di dalam `<x-dc>` memberi tata letak; blok `<script type="text/x-dc">` memberi state, data contoh, dan aturan gerbang.
2. Buat halaman di `apps/web/src/app/(staf)/<rute>/page.tsx` sebagai **komponen server**. Ambil data dari API di server.
3. Pisahkan bagian interaktif ke komponen `'use client'` kecil. Jangan meneruskan rahasia atau env ke komponen klien.
4. Pakai komponen `@simrs/ui` dan kelas token (`bg-brand-600`, `text-ink-700`, `rounded-card`). Jangan menulis warna heksadesimal baru.
5. Layar klinis wajib menampilkan `PatientBanner`. Tombol yang belum boleh dipakai tetap terlihat, nonaktif, dan alasannya tertulis.
6. Nyalakan menunya: ubah `available: true` di `apps/web/src/lib/nav.ts`.
7. Tambahkan tes Playwright di `apps/web/e2e/` untuk alur utama, termasuk gerbang keselamatan.

## 6. Menambah endpoint mock dan operasi outbox

**Mock.** Tambahkan rute di `apps/mock/src/systems/<sistem>.ts`, mengikuti kontrak di `docs/06-integrasi.md`. Skenario normal/lambat/gagal otomatis berlaku untuk semua rute berprefiks `/<sistem>`. Tambahkan tes di `apps/mock/src/mock.test.ts` dengan `app.inject(...)`.

**Operasi outbox.** Tambahkan entri di `apps/worker/src/outbox/operations.ts`:

```ts
[
  'antrean.updatewaktu',
  (msg) => ({ method: 'POST', path: '/bpjs/antrean/antrean/updatewaktu', body: msg.payload }),
],
```

Lalu dari service domain, di **dalam transaksi yang sama** dengan perubahan datanya:

```ts
await enqueueOutbox(tx, tenantId, {
  target: 'bpjs',
  operation: 'antrean.updatewaktu',
  idempotencyKey: `antrean-${kodeBooking}-task-${taskId}`,
  payload: { kodebooking: kodeBooking, taskid: taskId, waktu: Date.now() },
});
```

Idempotency key harus deterministik dari datanya (bukan acak), agar pengulangan aksi tidak menghasilkan kiriman ganda. Konektor nyata yang menambahkan tanda tangan BPJS (`bpjsHeaders` dari `@simrs/shared/node`) dibangun di fase 2.

## 7. Menjalankan tes dan sebelum commit

```powershell
pnpm lint
pnpm typecheck
pnpm test                          # unit + integrasi (butuh Postgres; worker juga butuh Redis)
pnpm --filter @simrs/web test:e2e  # Playwright; web harus jalan di :3000
```

Sebelum commit:

1. Ketiga perintah pertama hijau. Tes yang gagal diperbaiki penyebabnya, bukan dilemahkan.
2. Periksa [daftar periksa keamanan](./02-cara-kerja-kode.md#daftar-periksa-keamanan-per-perubahan).
3. Commit dengan Conventional Commits dan sebut kode komponen, misalnya `feat(units): master unit layanan` dengan badan `Komponen: P01`.
4. Perbarui `docs/PROGRESS.md`. Keputusan arsitektur baru dicatat sebagai ADR di `docs/adr/`.

## 8. Pemecahan masalah

| Gejala                                              | Penyebab dan solusi                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker: "virtualization is not enabled" / galat 500 | Aktifkan virtualisasi di BIOS, `wsl --install --no-distribution` (Admin), restart. Sementara itu pakai `pnpm pg:portable`.                                                            |
| `corepack enable` gagal EPERM                       | Folder Node di Program Files butuh admin. Pakai `--install-directory "$env:APPDATA\npm"`.                                                                                             |
| Port 9001 sudah dipakai                             | Program lain (mis. Laravel Herd). Setel `MINIO_CONSOLE_PORT=9011` di `.env`.                                                                                                          |
| `TENANT_REQUIRED` di tes atau log                   | Query dijalankan di luar `withTenant`/`forTenant`. Bungkus akses data dengan helper itu.                                                                                              |
| `new row violates row-level security policy`        | Menulis baris dengan `tenant_id` berbeda dari konteks. Ambil `tenantId` dari `@CurrentTenant()`, jangan dari body.                                                                    |
| Tes: "prisma migrate deploy gagal untuk simrs_test" | Postgres mati, atau migrasi lama diubah. Jalankan Postgres. Bila checksum ditolak: `pnpm db:test:recreate -- --yes` (menghapus simrs_test saja).                                      |
| Prisma menolak `migrate reset` dari agen AI         | Pengaman Prisma. Reset database hanya oleh manusia secara sadar. Tes tidak pernah membutuhkannya.                                                                                     |
| `/docs` atau `/superadmin` 404                      | `APP_ENV` tidak `local`/`staging`. Periksa `.env`, lalu restart.                                                                                                                      |
| Tes worker: "Redis tidak terjangkau"                | Redis butuh Docker (`pnpm infra:up`). Tes ini sengaja tidak dilewati.                                                                                                                 |
| `pnpm install`: "Ignored build scripts"             | pnpm memblokir skrip instalasi yang belum disetujui. Periksa paketnya, lalu `pnpm approve-builds <paket>` atau tolak dengan `!<paket>`. Keputusan tersimpan di `pnpm-workspace.yaml`. |
