-- P01/P03 · Jenis tenant: RS, atau satu tenant khusus operator platform (peran superadmin_platform, ADR-0013).
-- tenants adalah registri tanpa FORCE RLS (ADR-0008), jadi tidak perlu pembungkus NO FORCE.
ALTER TABLE "tenants" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'hospital';
ALTER TABLE "tenants" ADD CONSTRAINT tenants_kind_valid CHECK (kind IN ('hospital', 'platform'));

-- Hanya boleh ada satu tenant platform. Indeks parsial tidak dimodelkan Prisma (diabaikan saat diff);
-- keberadaannya dijaga packages/db/test/schema-guard.test.ts.
CREATE UNIQUE INDEX tenants_single_platform ON "tenants" (kind) WHERE kind = 'platform';
