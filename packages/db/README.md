# @simrs/db

Prisma 7 (driver adapter `pg`) + PostgreSQL 16 dengan RLS per tenant (ADR-0002, ADR-0008).

- `withTenant(prisma, tenantId, fn)`: transaksi dengan `SET LOCAL app.tenant_id`. Di luar itu query ke tabel domain **gagal** (`TENANT_REQUIRED`).
- `listActiveTenantIds(prisma)`: ID tenant aktif untuk worker (fungsi `SECURITY DEFINER` sempit).
- Outbox: `enqueueOutbox` (idempoten per key), `claimDueOutbox` (`SKIP LOCKED`), `recordOutboxAttempt` (retry eksponensial → DLQ `dead`).
- Tabel fase 0: `tenants`, `outbox_messages`, `delivery_attempts`, `inbound_events`, `audit_events` (append-only).

| Perintah                       | Fungsi                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm db:migrate` (root)       | `prisma migrate dev` sebagai `simrs_migrator`                                           |
| `pnpm db:deploy`               | `prisma migrate deploy`                                                                 |
| `pnpm db:seed`                 | 2 tenant RS fiktif                                                                      |
| `pnpm --filter @simrs/db test` | Tes RLS + outbox di `simrs_test` (migrate deploy + upsert, tidak destruktif)            |
| `pnpm db:import-breached`      | Ganti daftar kata sandi bocor `ref.breached_passwords` (HIBP `SHA1:hitungan` atau teks) |

`data/breached-passwords-sample.txt` hanya contoh kecil untuk lokal/uji; produksi wajib mengimpor daftar resmi (mis. Pwned Passwords, N teratas), lihat `docs/panduan/03-tutorial.md`.

Kebijakan RLS, GRANT, trigger, dan fungsi ditulis manual di `migration.sql`. Untuk migrasi baru: `prisma migrate dev --create-only`, lalu tambahkan blok RLS untuk tabel domain baru.
