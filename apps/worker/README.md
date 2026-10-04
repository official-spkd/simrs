# @simrs/worker

NestJS standalone + BullMQ. Mengirim pesan `outbox_messages` ke sistem eksternal (lokal: `apps/mock`) dan menjalankan job berkala per tenant (P11).

Alur per putaran outbox (default tiap 2 detik, job scheduler BullMQ `outbox-dispatch`):

1. `app_active_tenant_ids()` → daftar tenant (ADR-0008).
2. Per tenant, dalam transaksi singkat ber-RLS: klaim pesan jatuh tempo (`FOR UPDATE SKIP LOCKED`, lease 60 detik).
3. `prepare` operasi: permintaan HTTP biasa, permintaan BPJS (`defineBpjsOperation`), `skip`, atau `defer` (tunda tanpa menghabiskan percobaan).
4. Kirim **di luar** transaksi dengan header `Idempotency-Key` (BPJS: header bertanda tangan + dekripsi respons lewat `BpjsClient` dari `@simrs/shared/node`).
5. Catat `delivery_attempts`. Hasilnya `sent` (+ `onSuccess` atomik), `failed` dengan backoff eksponensial + jitter, atau `dead` (DLQ, + `onDead` atomik). Batas percobaan per operasi (`retry`); bawaan 8 percobaan, operasi BPJS sampai akhir hari layanan WIB. Galat permanen (4xx selain 408/425/429, operasi belum didukung) langsung DLQ. Galat bisnis BPJS (HTTP 200 + `metaData.code` ≠ 200) dicatat terkirim sebagai hasil domain "ditolak".

Job berkala: peta `src/jobs/periodic-jobs.ts`, dijalankan `PeriodicScheduler` sekali per tenant aktif (antrean BullMQ `periodic`, atau timer tanpa Redis di luar produksi).

Env: `OUTBOX_POLL_MS` (2000), `OUTBOX_BATCH_SIZE` (50), `OUTBOX_HTTP_TIMEOUT_MS` (10000), `OUTBOX_SCHEDULER` (`auto`), `BULLMQ_PREFIX` (`bull`), `BPJS_BASE_URL`/`BPJS_CONS_ID`/`BPJS_SECRET_KEY`/`BPJS_USER_KEY` (kosong di luar produksi = nilai mock).
`pnpm dev`, `pnpm test` (butuh Postgres + Redis; tes memakai prefiks antrean unik dan mock BPJS sungguhan di port acak).

Rincian pola: `docs/panduan/02-cara-kerja-kode.md` bagian Worker.
