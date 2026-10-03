# @simrs/api

NestJS 12 di `http://localhost:4000`. Swagger: `http://localhost:4000/docs` (JSON: `/docs/openapi.json`).

| Endpoint                               | Fungsi                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /health`                          | Liveness                                                                         |
| `GET /ready`                           | DB + Redis + MinIO; 503 bila ada yang gagal (isi tetap merinci tiap pemeriksaan) |
| `GET /api/v1/tenancy/current`          | Tenant aktif (header `X-Tenant-Id` di fase 0; dari token login mulai fase 1)     |
| `POST /api/v1/tenancy/dev/outbox-ping` | Non-produksi: pesan outbox contoh `{ target }` ke mock                           |
| `GET /api/v1/tenancy/dev/outbox/:id`   | Non-produksi: status kirim + percobaan                                           |

Pola yang sudah terpasang:

- Galat standar `{ code, message, details, requestId }` (`src/common/error.filter.ts`); pesan internal tidak bocor ke klien.
- `X-Request-Id` diteruskan atau dibangkitkan (UUID v7); log pino tanpa PHI (hanya metode, path tanpa query, status).
- Akses data hanya lewat `PrismaService.forTenant()` → RLS selalu punya konteks tenant.
- Validasi input dengan `ZodValidationPipe` + skema zod.

`pnpm dev`, `pnpm build`, `pnpm test`. Tes butuh Postgres (Docker atau `pnpm pg:portable`); persiapan tes memakai `@simrs/db/testing` dan tidak menghapus data.
