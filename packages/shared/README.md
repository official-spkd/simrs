# @simrs/shared

Kode bersama untuk API, worker, web, dan mock.

- `@simrs/shared`: uang `bigint` rupiah (`formatRupiah`, `parseRupiah`), tanggal Asia/Jakarta (`formatTanggalWaktu`), kode galat stabil, skema env zod, UUID v7, katalog 81 komponen, konstanta outbox.
- `@simrs/shared/node`: hanya Node. Tanda tangan dan enkripsi respons BPJS, HMAC webhook TPDI.

`pnpm build` menghasilkan `dist/` (ESM + CJS + d.ts). `pnpm dev` = build watch.
