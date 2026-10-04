-- Fase 1 · P05 MPI (potongan 7b): antrean kemungkinan rekam medis ganda dan jejak penggabungan.
-- Bagian tengah dibangkitkan prisma migrate diff; bagian bawah manual.
-- NO FORCE sementara pada patients (dirujuk FK baru), dikembalikan di akhir berkas (lihat 20261004030000).
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "patient_match_candidates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_a_id" UUID NOT NULL,
    "patient_b_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "decision_reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patient_match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "survivor_id" UUID NOT NULL,
    "merged_id" UUID NOT NULL,
    "candidate_id" UUID,
    "reason" TEXT NOT NULL,
    "taken_attributes" JSONB NOT NULL DEFAULT '[]',
    "survivor_snapshot_enc" TEXT,
    "merged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merged_by" UUID,
    "undone_at" TIMESTAMPTZ(3),
    "undone_by" UUID,
    "undo_reason" TEXT,

    CONSTRAINT "patient_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_match_candidates_tenant_id_status_score_idx" ON "patient_match_candidates"("tenant_id", "status", "score");

-- CreateIndex
CREATE INDEX "patient_match_candidates_tenant_id_patient_a_id_idx" ON "patient_match_candidates"("tenant_id", "patient_a_id");

-- CreateIndex
CREATE INDEX "patient_match_candidates_tenant_id_patient_b_id_idx" ON "patient_match_candidates"("tenant_id", "patient_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_match_candidates_tenant_id_id_key" ON "patient_match_candidates"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "patient_links_tenant_id_survivor_id_idx" ON "patient_links"("tenant_id", "survivor_id");

-- CreateIndex
CREATE INDEX "patient_links_tenant_id_candidate_id_idx" ON "patient_links"("tenant_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_links_tenant_id_id_key" ON "patient_links"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT "patient_match_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT "patient_match_candidates_tenant_id_patient_a_id_fkey" FOREIGN KEY ("tenant_id", "patient_a_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT "patient_match_candidates_tenant_id_patient_b_id_fkey" FOREIGN KEY ("tenant_id", "patient_b_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_links" ADD CONSTRAINT "patient_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_links" ADD CONSTRAINT "patient_links_tenant_id_survivor_id_fkey" FOREIGN KEY ("tenant_id", "survivor_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_links" ADD CONSTRAINT "patient_links_tenant_id_merged_id_fkey" FOREIGN KEY ("tenant_id", "merged_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_links" ADD CONSTRAINT "patient_links_tenant_id_candidate_id_fkey" FOREIGN KEY ("tenant_id", "candidate_id") REFERENCES "patient_match_candidates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT patient_match_candidates_pair_valid
  CHECK (patient_a_id <> patient_b_id);
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT patient_match_candidates_score_range
  CHECK (score BETWEEN 0 AND 99);
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT patient_match_candidates_status_valid
  CHECK (status IN ('open', 'merged', 'distinct', 'superseded'));
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT patient_match_candidates_reasons_array
  CHECK (jsonb_typeof(reasons) = 'array');
-- Keputusan petugas (gabung / bukan orang yang sama) selalu lengkap: kapan, siapa, alasan.
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT patient_match_candidates_decision_valid CHECK (
  (status IN ('merged', 'distinct')) = (decided_at IS NOT NULL)
  AND (decided_at IS NULL) = (decided_by IS NULL)
  AND (decided_at IS NULL) = (decision_reason IS NULL)
  AND (decision_reason IS NULL OR char_length(decision_reason) BETWEEN 10 AND 500));
-- Satu baris per pasangan, apa pun urutannya.
CREATE UNIQUE INDEX patient_match_candidates_pair
  ON "patient_match_candidates" ("tenant_id", LEAST("patient_a_id", "patient_b_id"), GREATEST("patient_a_id", "patient_b_id"));

ALTER TABLE "patient_links" ADD CONSTRAINT patient_links_pair_valid CHECK (survivor_id <> merged_id);
ALTER TABLE "patient_links" ADD CONSTRAINT patient_links_reason_length CHECK (char_length(reason) BETWEEN 10 AND 500);
ALTER TABLE "patient_links" ADD CONSTRAINT patient_links_taken_array CHECK (jsonb_typeof(taken_attributes) = 'array');
ALTER TABLE "patient_links" ADD CONSTRAINT patient_links_snapshot_encrypted
  CHECK (survivor_snapshot_enc IS NULL OR survivor_snapshot_enc LIKE 'v1.%');
ALTER TABLE "patient_links" ADD CONSTRAINT patient_links_undo_valid CHECK (
  (undone_at IS NULL) = (undone_by IS NULL)
  AND (undone_at IS NULL) = (undo_reason IS NULL)
  AND (undo_reason IS NULL OR char_length(undo_reason) BETWEEN 10 AND 500)
  AND (undone_at IS NULL OR undone_at >= merged_at));
-- Rekam medis hanya bisa digabung ke satu rekam medis lain pada satu waktu.
CREATE UNIQUE INDEX patient_links_one_active_per_merged
  ON "patient_links" ("tenant_id", "merged_id") WHERE undone_at IS NULL;

-- =====================================================================
-- Kelompok rekam medis satu orang: akar (rekam medis aktif) + semua yang digabung ke dalamnya, berjenjang.
-- SECURITY INVOKER (bawaan): tunduk RLS pemanggil. Kedalaman dibatasi sebagai pengaman.
-- =====================================================================
CREATE FUNCTION app_patient_group(p_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up (id, merged_into_id, depth) AS (
    SELECT id, merged_into_id, 0 FROM patients WHERE id = p_id
    UNION ALL
    SELECT p.id, p.merged_into_id, up.depth + 1
    FROM patients p JOIN up ON p.id = up.merged_into_id
    WHERE up.depth < 20
  ),
  root AS (SELECT id FROM up WHERE merged_into_id IS NULL LIMIT 1),
  down (id, depth) AS (
    SELECT id, 0 FROM root
    UNION ALL
    SELECT p.id, down.depth + 1
    FROM patients p JOIN down ON p.merged_into_id = down.id
    WHERE down.depth < 20
  )
  SELECT id FROM down
$$;

-- =====================================================================
-- RLS
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_match_candidates', 'patient_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;

-- =====================================================================
-- Hak akses (tanpa hapus).
-- - patient_match_candidates: pasangan dan pihaknya tetap; skor/status/keputusan yang berubah.
-- - patient_links: jejak permanen; hanya kolom pembatalan yang bisa diisi.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "patient_match_candidates", "patient_links" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "patient_match_candidates", "patient_links" FROM simrs_app;
    GRANT UPDATE (score, reasons, status, detected_at, decided_at, decided_by, decision_reason, updated_at)
      ON "patient_match_candidates" TO simrs_app;
    GRANT UPDATE (undone_at, undone_by, undo_reason) ON "patient_links" TO simrs_app;
  END IF;
END $$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
