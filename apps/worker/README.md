# @simrs/worker

NestJS standalone + BullMQ. Mengirim pesan `outbox_messages` ke sistem eksternal (lokal: `apps/mock`).

Alur per putaran (default tiap 2 detik, job scheduler BullMQ `outbox-dispatch`):

1. `app_active_tenant_ids()` → daftar tenant (ADR-0008).
2. Per tenant, dalam transaksi singkat ber-RLS: klaim pesan jatuh tempo (`FOR UPDATE SKIP LOCKED`, lease 60 detik).
3. Kirim HTTP **di luar** transaksi dengan header `Idempotency-Key`.
4. Catat `delivery_attempts`. Hasilnya `sent`, atau `failed` dengan backoff eksponensial + jitter, atau `dead` (DLQ). DLQ terjadi setelah 8 percobaan, atau langsung bila galatnya permanen (4xx selain 408/425/429, atau operasi belum didukung).

Fase 0 hanya mengenal operasi `ping` → `POST <MOCK_BASE_URL>/<target>/_echo`. Konektor per sistem menyusul di fase 2–7.

Env: `OUTBOX_POLL_MS` (2000), `OUTBOX_BATCH_SIZE` (50), `OUTBOX_HTTP_TIMEOUT_MS` (10000).
`pnpm dev`, `pnpm test` (butuh Docker: Postgres + Redis).
