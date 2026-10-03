# @simrs/api

NestJS 12 di `http://127.0.0.1:4000`. Swagger (hanya `APP_ENV` local/staging): `/docs`, JSON di `/docs/openapi.json`.

| Endpoint                       | Fungsi                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `GET /health`                  | Liveness (tidak dibatasi rate limit)                                            |
| `GET /ready`                   | DB + Redis + MinIO; 503 bila ada yang gagal, isi tetap merinci tiap pemeriksaan |
| `GET /api/v1/tenancy/current`  | Tenant aktif (fase 0: header `X-Tenant-Id`, hanya non-produksi)                 |
| `POST /api/v1/dev/outbox-ping` | Non-produksi: pesan outbox contoh `{ target }` ke mock                          |
| `GET /api/v1/dev/outbox/:id`   | Non-produksi: status kirim + percobaan                                          |

Struktur: `src/main.ts` (start) → `src/app.module.ts` (`AppModule.forRoot(env)`) → `src/bootstrap.ts` (header keamanan, body limit, prefix, CORS, Swagger) → `src/modules/<konteks>/` (controller → service → repository). Penjelasan lengkap: `docs/panduan/02-cara-kerja-kode.md`.

`pnpm dev`, `pnpm build`, `pnpm test`. Tes butuh Postgres (Docker atau `pnpm pg:portable`); persiapan tes memakai `@simrs/db/testing` dan tidak menghapus data.
