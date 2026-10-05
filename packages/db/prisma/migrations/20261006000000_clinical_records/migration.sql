-- Fase 3 · potongan 3.0b skema I: pola entri klinis berversi + catatan inti (rencana fase 3 §2, ADR-0004, ADR-0028).
-- Bagian tengah dibangkitkan prisma migrate diff (skema multi-berkas prisma/schema/clinical.prisma); bawah manual:
-- CHECK, indeks unik parsial, trigger rantai versi/kunci TTE/kode baku, view _current, RLS, hak akses.
-- Tabel ber-FORCE RLS yang dirujuk FK baru dibuat NO FORCE sementara, dikembalikan di akhir berkas.
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_definitions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" TEXT;

-- AlterTable
ALTER TABLE "form_responses" ADD COLUMN     "encounter_id" UUID;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "confidential" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "clinical_drafts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clinical_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_attestations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "user_role" TEXT NOT NULL,
    "note" TEXT,
    "attested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "ended_by" UUID,
    "end_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "encounter_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_substances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "drug_substances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_packages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "setting" TEXT NOT NULL,
    "form_code" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "form_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "display" TEXT NOT NULL,
    "value_numeric" DECIMAL(14,4),
    "value_unit" TEXT,
    "value_text" TEXT,
    "components" JSONB,
    "interpretation" TEXT,
    "reference_range" TEXT,
    "ews_score" INTEGER,
    "ews_max_param" INTEGER,
    "diagnostic_report_id" UUID,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "display" TEXT NOT NULL,
    "conclusion" TEXT,

    CONSTRAINT "diagnostic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conditions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "role" TEXT,
    "code_system" TEXT NOT NULL DEFAULT 'icd10',
    "code" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "clinical_status" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "code_system" TEXT NOT NULL DEFAULT 'icd9cm',
    "code" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergy_intolerances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "substance_id" UUID,
    "text" TEXT,
    "category" TEXT,
    "criticality" TEXT,
    "reaction" TEXT,

    CONSTRAINT "allergy_intolerances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cppt_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "ppa" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "instruction" TEXT,
    "cosign_required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cppt_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handovers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "background" TEXT NOT NULL,
    "assessment" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "to_user_id" UUID,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consult_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "to_unit_id" UUID,
    "to_user_id" UUID,
    "question" TEXT NOT NULL,

    CONSTRAINT "consult_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consult_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "findings" TEXT NOT NULL,
    "assessment" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "accept_comanagement" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "consult_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "form_definition_id" UUID,
    "procedure" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "refusal_reason" TEXT,
    "information" JSONB NOT NULL,
    "informer_user_id" UUID NOT NULL,
    "explained_at" TIMESTAMPTZ(3) NOT NULL,
    "document_id" UUID,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_signatures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "signer_kind" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "relation" TEXT,
    "method" TEXT NOT NULL,
    "image_document_id" UUID,
    "staff_user_id" UUID,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discharge_summaries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "disposition" TEXT NOT NULL,
    "discharge_condition" TEXT NOT NULL,
    "follow_up" TEXT,
    "reconciliation_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "document_id" UUID,

    CONSTRAINT "discharge_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discharge_medications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "summary_id" UUID NOT NULL,
    "drug_id" UUID,
    "name" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "discharge_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discharge_summary_sources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "summary_id" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,

    CONSTRAINT "discharge_summary_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_drafts_tenant_id_author_user_id_idx" ON "clinical_drafts"("tenant_id", "author_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_drafts_tenant_id_id_key" ON "clinical_drafts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_drafts_tenant_id_encounter_id_kind_author_user_id_key" ON "clinical_drafts"("tenant_id", "encounter_id", "kind", "author_user_id");

-- CreateIndex
CREATE INDEX "clinical_attestations_tenant_id_encounter_id_idx" ON "clinical_attestations"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_attestations_tenant_id_id_key" ON "clinical_attestations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_attestations_tenant_id_target_type_target_id_kind__key" ON "clinical_attestations"("tenant_id", "target_type", "target_id", "kind", "user_id");

-- CreateIndex
CREATE INDEX "encounter_participants_tenant_id_encounter_id_idx" ON "encounter_participants"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "encounter_participants_tenant_id_user_id_idx" ON "encounter_participants"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_participants_tenant_id_id_key" ON "encounter_participants"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drug_substances_tenant_id_id_key" ON "drug_substances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drug_substances_tenant_id_code_key" ON "drug_substances"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "form_packages_tenant_id_id_key" ON "form_packages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "form_packages_tenant_id_setting_form_code_key" ON "form_packages"("tenant_id", "setting", "form_code");

-- CreateIndex
CREATE INDEX "observations_tenant_id_encounter_id_idx" ON "observations"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "observations_tenant_id_patient_id_category_idx" ON "observations"("tenant_id", "patient_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "observations_tenant_id_id_key" ON "observations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "observations_tenant_id_root_id_version_key" ON "observations"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "diagnostic_reports_tenant_id_encounter_id_idx" ON "diagnostic_reports"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "diagnostic_reports_tenant_id_patient_id_idx" ON "diagnostic_reports"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_reports_tenant_id_id_key" ON "diagnostic_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_reports_tenant_id_root_id_version_key" ON "diagnostic_reports"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "conditions_tenant_id_encounter_id_idx" ON "conditions"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "conditions_tenant_id_patient_id_kind_idx" ON "conditions"("tenant_id", "patient_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "conditions_tenant_id_id_key" ON "conditions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conditions_tenant_id_root_id_version_key" ON "conditions"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "procedures_tenant_id_encounter_id_idx" ON "procedures"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "procedures_tenant_id_patient_id_idx" ON "procedures"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "procedures_tenant_id_id_key" ON "procedures"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "procedures_tenant_id_root_id_version_key" ON "procedures"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "allergy_intolerances_tenant_id_patient_id_idx" ON "allergy_intolerances"("tenant_id", "patient_id");

-- CreateIndex
CREATE INDEX "allergy_intolerances_tenant_id_encounter_id_idx" ON "allergy_intolerances"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "allergy_intolerances_tenant_id_id_key" ON "allergy_intolerances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "allergy_intolerances_tenant_id_root_id_version_key" ON "allergy_intolerances"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "cppt_entries_tenant_id_encounter_id_occurred_at_idx" ON "cppt_entries"("tenant_id", "encounter_id", "occurred_at");

-- CreateIndex
CREATE INDEX "cppt_entries_tenant_id_patient_id_idx" ON "cppt_entries"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "cppt_entries_tenant_id_id_key" ON "cppt_entries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cppt_entries_tenant_id_root_id_version_key" ON "cppt_entries"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "handovers_tenant_id_encounter_id_idx" ON "handovers"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "handovers_tenant_id_id_key" ON "handovers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "handovers_tenant_id_root_id_version_key" ON "handovers"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "consult_requests_tenant_id_encounter_id_idx" ON "consult_requests"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "consult_requests_tenant_id_to_user_id_idx" ON "consult_requests"("tenant_id", "to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "consult_requests_tenant_id_id_key" ON "consult_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "consult_requests_tenant_id_root_id_version_key" ON "consult_requests"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "consult_responses_tenant_id_request_id_idx" ON "consult_responses"("tenant_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "consult_responses_tenant_id_id_key" ON "consult_responses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "consult_responses_tenant_id_root_id_version_key" ON "consult_responses"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "consents_tenant_id_encounter_id_idx" ON "consents"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "consents_tenant_id_patient_id_idx" ON "consents"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "consents_tenant_id_id_key" ON "consents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "consents_tenant_id_root_id_version_key" ON "consents"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "consent_signatures_tenant_id_id_key" ON "consent_signatures"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_signatures_tenant_id_consent_id_signer_kind_key" ON "consent_signatures"("tenant_id", "consent_id", "signer_kind");

-- CreateIndex
CREATE INDEX "discharge_summaries_tenant_id_encounter_id_idx" ON "discharge_summaries"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "discharge_summaries_tenant_id_patient_id_idx" ON "discharge_summaries"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "discharge_summaries_tenant_id_id_key" ON "discharge_summaries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discharge_summaries_tenant_id_root_id_version_key" ON "discharge_summaries"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "discharge_medications_tenant_id_summary_id_idx" ON "discharge_medications"("tenant_id", "summary_id");

-- CreateIndex
CREATE UNIQUE INDEX "discharge_medications_tenant_id_id_key" ON "discharge_medications"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discharge_summary_sources_tenant_id_id_key" ON "discharge_summary_sources"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discharge_summary_sources_tenant_id_summary_id_section_sour_key" ON "discharge_summary_sources"("tenant_id", "summary_id", "section", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_source_type_source_id_idx" ON "documents"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "form_responses_tenant_id_encounter_id_idx" ON "form_responses"("tenant_id", "encounter_id");

-- AddForeignKey
ALTER TABLE "clinical_drafts" ADD CONSTRAINT "clinical_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_drafts" ADD CONSTRAINT "clinical_drafts_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_drafts" ADD CONSTRAINT "clinical_drafts_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_drafts" ADD CONSTRAINT "clinical_drafts_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_attestations" ADD CONSTRAINT "clinical_attestations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_attestations" ADD CONSTRAINT "clinical_attestations_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_attestations" ADD CONSTRAINT "clinical_attestations_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_attestations" ADD CONSTRAINT "clinical_attestations_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_substances" ADD CONSTRAINT "drug_substances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_packages" ADD CONSTRAINT "form_packages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "observations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "observations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_diagnostic_report_id_fkey" FOREIGN KEY ("tenant_id", "diagnostic_report_id") REFERENCES "diagnostic_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "diagnostic_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "diagnostic_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "conditions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "conditions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "procedures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "procedures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_tenant_id_substance_id_fkey" FOREIGN KEY ("tenant_id", "substance_id") REFERENCES "drug_substances"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "allergy_intolerances"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "allergy_intolerances"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cppt_entries" ADD CONSTRAINT "cppt_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cppt_entries" ADD CONSTRAINT "cppt_entries_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cppt_entries" ADD CONSTRAINT "cppt_entries_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cppt_entries" ADD CONSTRAINT "cppt_entries_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cppt_entries" ADD CONSTRAINT "cppt_entries_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "cppt_entries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cppt_entries" ADD CONSTRAINT "cppt_entries_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "cppt_entries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_tenant_id_to_user_id_fkey" FOREIGN KEY ("tenant_id", "to_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "handovers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "handovers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_to_unit_id_fkey" FOREIGN KEY ("tenant_id", "to_unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_to_user_id_fkey" FOREIGN KEY ("tenant_id", "to_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "consult_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "consult_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_responses" ADD CONSTRAINT "consult_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_responses" ADD CONSTRAINT "consult_responses_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_responses" ADD CONSTRAINT "consult_responses_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_responses" ADD CONSTRAINT "consult_responses_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_responses" ADD CONSTRAINT "consult_responses_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "consult_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_responses" ADD CONSTRAINT "consult_responses_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "consult_responses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_responses" ADD CONSTRAINT "consult_responses_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "consult_responses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_informer_user_id_fkey" FOREIGN KEY ("tenant_id", "informer_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_form_definition_id_fkey" FOREIGN KEY ("tenant_id", "form_definition_id") REFERENCES "form_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "consents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "consents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_signatures" ADD CONSTRAINT "consent_signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_signatures" ADD CONSTRAINT "consent_signatures_tenant_id_consent_id_fkey" FOREIGN KEY ("tenant_id", "consent_id") REFERENCES "consents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_signatures" ADD CONSTRAINT "consent_signatures_tenant_id_image_document_id_fkey" FOREIGN KEY ("tenant_id", "image_document_id") REFERENCES "documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_signatures" ADD CONSTRAINT "consent_signatures_tenant_id_staff_user_id_fkey" FOREIGN KEY ("tenant_id", "staff_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "discharge_summaries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "discharge_summaries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_medications" ADD CONSTRAINT "discharge_medications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_medications" ADD CONSTRAINT "discharge_medications_tenant_id_summary_id_fkey" FOREIGN KEY ("tenant_id", "summary_id") REFERENCES "discharge_summaries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summary_sources" ADD CONSTRAINT "discharge_summary_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summary_sources" ADD CONSTRAINT "discharge_summary_sources_tenant_id_summary_id_fkey" FOREIGN KEY ("tenant_id", "summary_id") REFERENCES "discharge_summaries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Pola entri klinis berversi (ADR-0004, ADR-0028)
-- =====================================================================

-- Rantai versi dan kunci TTE. BEFORE INSERT pada setiap tabel klinis berversi:
-- - `recorded_at` selalu jam server (MRMIK 8b), apa pun kiriman aplikasi;
-- - koreksi/salah entri: versi pendahulu ada, akar sama, versi = pendahulu + 1, pasien dan kunjungan sama, dan versi
--   pendahulu belum ber-TTE (dokumen sumbernya punya tanda tangan pending/signed) → selain itu `RECORD_LOCKED`;
-- - addendum: entri tujuan final dan terkini, pasien dan kunjungan sama.
-- Dua koreksi serentak atas versi yang sama: indeks unik `<tabel>_supersedes_once` menolak yang kedua.
-- SECURITY INVOKER: tunduk RLS pemanggil (baris tenant lain tidak terlihat = tidak ditemukan).
CREATE FUNCTION app_clinical_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  prev record;
  n integer;
BEGIN
  NEW.recorded_at := statement_timestamp();
  IF NEW.supersedes_id IS NOT NULL THEN
    EXECUTE format(
      'SELECT id, root_id, version, patient_id, encounter_id FROM %I WHERE tenant_id = $1 AND id = $2',
      TG_TABLE_NAME) INTO prev USING NEW.tenant_id, NEW.supersedes_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE EXCEPTION 'CLINICAL_CHAIN: versi yang dikoreksi tidak ditemukan di %', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
    IF NEW.root_id <> prev.root_id OR NEW.version <> prev.version + 1 OR NEW.patient_id <> prev.patient_id
       OR NEW.encounter_id IS DISTINCT FROM prev.encounter_id THEN
      RAISE EXCEPTION 'CLINICAL_CHAIN: koreksi harus melanjutkan rantai versi yang sama (akar, versi + 1, pasien, kunjungan)'
        USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM documents d
      JOIN document_signatures s ON s.tenant_id = d.tenant_id AND s.document_id = d.id
      WHERE d.tenant_id = NEW.tenant_id AND d.source_type = TG_TABLE_NAME AND d.source_id = NEW.supersedes_id
        AND d.voided_at IS NULL AND s.status <> 'failed') THEN
      RAISE EXCEPTION 'RECORD_LOCKED: versi ber-TTE tidak bisa digantikan; tambahkan addendum' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.addendum_of IS NOT NULL THEN
    EXECUTE format(
      'SELECT t.id, t.patient_id, t.encounter_id, t.status, '
      || 'EXISTS (SELECT 1 FROM %I s WHERE s.tenant_id = t.tenant_id AND s.supersedes_id = t.id) AS superseded '
      || 'FROM %I t WHERE t.tenant_id = $1 AND t.id = $2',
      TG_TABLE_NAME, TG_TABLE_NAME) INTO prev USING NEW.tenant_id, NEW.addendum_of;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 OR prev.status <> 'final' OR prev.superseded THEN
      RAISE EXCEPTION 'RECORD_NOT_FINAL: addendum hanya atas versi final terkini' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.patient_id <> prev.patient_id OR NEW.encounter_id IS DISTINCT FROM prev.encounter_id THEN
      RAISE EXCEPTION 'CLINICAL_CHAIN: addendum harus untuk pasien dan kunjungan yang sama' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- Kode baku hanya dari data rujukan (CLAUDE.md §4.10): ICD-10 (conditions), ICD-9-CM (procedures), LOINC
-- (observations, diagnostic_reports; boleh tanpa kode). Kode nonaktif ditolak untuk entri baru.
CREATE FUNCTION app_clinical_code_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  r jsonb := to_jsonb(NEW);
BEGIN
  IF r->>'code' IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ref.concepts c WHERE c.system = r->>'code_system' AND c.code = r->>'code' AND c.active) THEN
    RAISE EXCEPTION 'REF_CODE_UNKNOWN: kode % % tidak ada di data rujukan', r->>'code_system', r->>'code'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

DO $do$
DECLARE
  t text;
  versioned CONSTANT text[] := ARRAY[
    'observations', 'diagnostic_reports', 'conditions', 'procedures', 'allergy_intolerances', 'cppt_entries',
    'handovers', 'consult_requests', 'consult_responses', 'consents', 'discharge_summaries'];
BEGIN
  FOREACH t IN ARRAY versioned LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (status IN (''final'', ''entered_in_error''))',
      t, t || '_status_valid');
    -- Versi 1 = akar tanpa pendahulu; versi berikutnya selalu menggantikan versi sebelumnya dengan alasan; salah
    -- entri selalu versi baru beralasan; addendum adalah akar baru (bukan koreksi).
    EXECUTE format($c$ALTER TABLE %I ADD CONSTRAINT %I CHECK (
      version >= 1
      AND (version = 1) = (supersedes_id IS NULL)
      AND (version = 1) = (id = root_id)
      AND (supersedes_id IS NULL) = (correction_reason IS NULL)
      AND (correction_reason IS NULL OR char_length(btrim(correction_reason)) BETWEEN 10 AND 500)
      AND (status = 'final' OR supersedes_id IS NOT NULL)
      AND NOT (supersedes_id IS NOT NULL AND addendum_of IS NOT NULL)
      AND (addendum_of IS NULL OR addendum_of <> id))$c$, t, t || '_version_chain');
    EXECUTE format($c$ALTER TABLE %I ADD CONSTRAINT %I CHECK (
      author_role ~ '^[a-z][a-z0-9_]{2,40}$'
      AND occurred_at <= recorded_at + interval '5 minutes')$c$, t, t || '_author_time');
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (tenant_id, supersedes_id) WHERE supersedes_id IS NOT NULL',
      t || '_supersedes_once', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()',
      t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app_clinical_guard()',
      t || '_clinical_guard', t);
    -- Versi terkini tiap entri (ADR-0004 `_current`); security_invoker: RLS pemanggil tetap berlaku.
    EXECUTE format(
      'CREATE VIEW %I WITH (security_invoker = true) AS SELECT r.* FROM %I r WHERE NOT EXISTS ('
      || 'SELECT 1 FROM %I n WHERE n.tenant_id = r.tenant_id AND n.supersedes_id = r.id)',
      t || '_current', t, t);
  END LOOP;
END $do$;

CREATE TRIGGER conditions_code_guard BEFORE INSERT ON "conditions"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_code_guard();
CREATE TRIGGER procedures_code_guard BEFORE INSERT ON "procedures"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_code_guard();
CREATE TRIGGER observations_code_guard BEFORE INSERT ON "observations"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_code_guard();
CREATE TRIGGER diagnostic_reports_code_guard BEFORE INSERT ON "diagnostic_reports"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_code_guard();

-- =====================================================================
-- Batasan domain per tabel klinis
-- =====================================================================
ALTER TABLE "observations" ADD CONSTRAINT observations_values_valid CHECK (
  category IN ('vital', 'lab', 'imaging', 'survei', 'cairan')
  AND (code_system IS NULL) = (code IS NULL)
  AND (code_system IS NULL OR code_system = 'loinc')
  AND char_length(display) BETWEEN 1 AND 200
  AND (interpretation IS NULL OR interpretation IN ('normal', 'tinggi', 'rendah', 'abnormal', 'kritis'))
  AND (components IS NULL OR jsonb_typeof(components) = 'object')
  AND (value_text IS NULL OR char_length(value_text) <= 2000)
  AND (ews_score IS NULL OR (category = 'vital' AND ews_score BETWEEN 0 AND 20))
  AND (ews_max_param IS NULL OR (category = 'vital' AND ews_max_param BETWEEN 0 AND 3))
  AND (ews_score IS NULL) = (ews_max_param IS NULL));

ALTER TABLE "diagnostic_reports" ADD CONSTRAINT diagnostic_reports_values_valid CHECK (
  category IN ('lab', 'radiologi', 'lainnya')
  AND (code_system IS NULL) = (code IS NULL)
  AND (code_system IS NULL OR code_system = 'loinc')
  AND char_length(display) BETWEEN 1 AND 200
  AND (conclusion IS NULL OR char_length(conclusion) <= 4000));

ALTER TABLE "conditions" ADD CONSTRAINT conditions_values_valid CHECK (
  kind IN ('encounter', 'problem_list')
  AND (kind = 'encounter') = (role IS NOT NULL)
  AND (role IS NULL OR role IN ('utama', 'sekunder', 'komplikasi'))
  AND code_system = 'icd10'
  AND clinical_status IN ('active', 'resolved')
  AND char_length(display) BETWEEN 1 AND 500
  AND (note IS NULL OR char_length(note) <= 500));

ALTER TABLE "procedures" ADD CONSTRAINT procedures_values_valid CHECK (
  code_system = 'icd9cm'
  AND char_length(display) BETWEEN 1 AND 500
  AND (note IS NULL OR char_length(note) <= 500));

-- NKDA eksplisit tanpa isi; alergi wajib zat terkode atau teks, kategori, dan kritikalitas.
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT allergy_intolerances_values_valid CHECK (
  (kind = 'nkda' AND substance_id IS NULL AND text IS NULL AND category IS NULL AND criticality IS NULL
     AND reaction IS NULL)
  OR (kind = 'alergi' AND (substance_id IS NOT NULL OR text IS NOT NULL)
     AND category IN ('obat', 'makanan', 'lingkungan', 'lainnya')
     AND criticality IN ('rendah', 'tinggi', 'tidak_diketahui')
     AND (text IS NULL OR char_length(text) BETWEEN 1 AND 120)
     AND (reaction IS NULL OR char_length(reaction) <= 300)));

ALTER TABLE "cppt_entries" ADD CONSTRAINT cppt_entries_values_valid CHECK (
  ppa IN ('dpjp', 'residen', 'perawat', 'bidan', 'farmasi', 'gizi')
  AND format IN ('soap', 'adime')
  AND jsonb_typeof(content) = 'object'
  AND (instruction IS NULL OR char_length(instruction) <= 2000)
  -- Hanya catatan residen yang menunggu co-sign DPJP (keputusan fase 3 no. 4).
  AND (NOT cosign_required OR ppa = 'residen'));

ALTER TABLE "handovers" ADD CONSTRAINT handovers_values_valid CHECK (
  char_length(situation) BETWEEN 1 AND 1000 AND char_length(background) <= 1000
  AND char_length(assessment) BETWEEN 1 AND 1000 AND char_length(recommendation) BETWEEN 1 AND 1000);

ALTER TABLE "consult_requests" ADD CONSTRAINT consult_requests_values_valid CHECK (
  kind IN ('konsultasi', 'rawat_bersama', 'alih_rawat')
  AND urgency IN ('biasa', 'segera')
  AND (to_unit_id IS NOT NULL OR to_user_id IS NOT NULL)
  AND char_length(question) BETWEEN 1 AND 2000);

ALTER TABLE "consult_responses" ADD CONSTRAINT consult_responses_values_valid CHECK (
  char_length(findings) <= 2000 AND char_length(assessment) BETWEEN 1 AND 2000
  AND char_length(recommendation) BETWEEN 1 AND 2000);

-- Penolakan/pencabutan wajib alasan ≥ 10 (SAFETY_REASON_MIN); tujuh butir informasi wajib.
ALTER TABLE "consents" ADD CONSTRAINT consents_values_valid CHECK (
  decision IN ('setuju', 'tolak', 'dicabut')
  AND (decision = 'setuju') = (refusal_reason IS NULL)
  AND (refusal_reason IS NULL OR char_length(btrim(refusal_reason)) BETWEEN 10 AND 500)
  AND jsonb_typeof(information) = 'array' AND jsonb_array_length(information) = 7
  AND char_length(procedure) BETWEEN 1 AND 200
  AND explained_at <= recorded_at + interval '5 minutes');

ALTER TABLE "consent_signatures" ADD CONSTRAINT consent_signatures_values_valid CHECK (
  signer_kind IN ('pasien', 'wali', 'saksi_keluarga', 'saksi_petugas')
  AND method IN ('goresan', 'nama')
  AND char_length(btrim(signer_name)) BETWEEN 3 AND 80
  AND (relation IS NULL OR char_length(relation) <= 40)
  AND (signer_kind = 'saksi_petugas') = (staff_user_id IS NOT NULL)
  AND (method = 'goresan') = (image_document_id IS NOT NULL));

ALTER TABLE "discharge_summaries" ADD CONSTRAINT discharge_summaries_values_valid CHECK (
  kind IN ('rawat_inap', 'rawat_jalan')
  AND jsonb_typeof(sections) = 'object'
  AND disposition IN ('pulang', 'rujuk', 'pulang_paksa', 'meninggal', 'pindah_rawat')
  AND char_length(discharge_condition) BETWEEN 1 AND 200
  AND (follow_up IS NULL OR char_length(follow_up) <= 1000));

ALTER TABLE "discharge_medications" ADD CONSTRAINT discharge_medications_values_valid CHECK (
  change IN ('baru', 'lanjut', 'ubah_dosis', 'dihentikan')
  AND char_length(name) BETWEEN 1 AND 120 AND char_length(sig) BETWEEN 1 AND 160);

ALTER TABLE "discharge_summary_sources" ADD CONSTRAINT discharge_summary_sources_values_valid CHECK (
  section ~ '^[a-z][a-z0-9_-]{1,40}$' AND source_type ~ '^[a-z][a-z_]{2,40}$');

-- =====================================================================
-- Draf, atestasi, tim perawatan, master
-- =====================================================================
ALTER TABLE "clinical_drafts" ADD CONSTRAINT clinical_drafts_values_valid CHECK (
  kind ~ '^[a-z][a-z0-9_:-]{1,60}$' AND jsonb_typeof(content) = 'object');

ALTER TABLE "clinical_attestations" ADD CONSTRAINT clinical_attestations_values_valid CHECK (
  kind IN ('cosign', 'verify', 'review_order')
  AND user_role ~ '^[a-z][a-z0-9_]{2,40}$'
  AND (note IS NULL OR char_length(note) <= 500));
-- Satu co-sign per entri: dari dua DPJP yang co-sign serentak, satu ditolak.
CREATE UNIQUE INDEX clinical_attestations_one_cosign
  ON "clinical_attestations" (tenant_id, target_type, target_id) WHERE kind = 'cosign';

-- Atestasi hanya atas entri klinis yang ada, untuk pasien yang sama. Daftar tabel diganti saat tabel order (3.0c)
-- tersedia.
CREATE FUNCTION app_clinical_attestation_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  target_patient uuid;
  n integer;
BEGIN
  IF NOT NEW.target_type = ANY (ARRAY[
       'cppt_entries', 'observations', 'diagnostic_reports', 'conditions', 'procedures', 'allergy_intolerances',
       'handovers', 'consult_requests', 'consult_responses', 'consents', 'discharge_summaries']) THEN
    RAISE EXCEPTION 'CLINICAL_ATTESTATION: jenis target % tidak dikenal', NEW.target_type USING ERRCODE = 'P0001';
  END IF;
  EXECUTE format('SELECT patient_id FROM %I WHERE tenant_id = $1 AND id = $2', NEW.target_type)
    INTO target_patient USING NEW.tenant_id, NEW.target_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 OR target_patient <> NEW.patient_id THEN
    RAISE EXCEPTION 'CLINICAL_ATTESTATION: entri target tidak ditemukan untuk pasien ini' USING ERRCODE = 'P0001';
  END IF;
  NEW.attested_at := statement_timestamp();
  RETURN NEW;
END $fn$;
CREATE TRIGGER clinical_attestations_guard BEFORE INSERT ON "clinical_attestations"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_attestation_guard();

ALTER TABLE "encounter_participants" ADD CONSTRAINT encounter_participants_values_valid CHECK (
  role IN ('dpjp_utama', 'rawat_bersama', 'konsultan', 'perawat_pj')
  AND (ended_at IS NULL OR ended_at >= started_at)
  AND (ended_at IS NULL) = (ended_by IS NULL)
  AND (end_reason IS NULL OR char_length(end_reason) <= 300));
CREATE UNIQUE INDEX encounter_participants_one_primary
  ON "encounter_participants" (tenant_id, encounter_id) WHERE role = 'dpjp_utama' AND ended_at IS NULL;
CREATE UNIQUE INDEX encounter_participants_one_active_role
  ON "encounter_participants" (tenant_id, encounter_id, user_id, role) WHERE ended_at IS NULL;

-- Periode tutup-sekali: baris tidak dihapus; hanya kolom penutup yang boleh diisi, sekali.
CREATE FUNCTION app_encounter_participant_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  closing CONSTANT text[] := ARRAY['ended_at', 'ended_by', 'end_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: tim perawatan tidak dihapus; akhiri periodenya' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
     OR (to_jsonb(NEW) - closing) IS DISTINCT FROM (to_jsonb(OLD) - closing) THEN
    RAISE EXCEPTION 'PARTICIPANT_CLOSED: periode tim perawatan hanya bisa diakhiri sekali' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER encounter_participants_guard BEFORE UPDATE OR DELETE ON "encounter_participants"
  FOR EACH ROW EXECUTE FUNCTION app_encounter_participant_guard();

ALTER TABLE "drug_substances" ADD CONSTRAINT drug_substances_values_valid CHECK (
  code ~ '^[a-z0-9][a-z0-9 -]{0,59}$'
  AND char_length(name) BETWEEN 1 AND 120
  AND cardinality(classes) <= 10
  AND array_to_string(classes, '|') ~ '^([a-z0-9][a-z0-9 -]{0,59}(\|[a-z0-9][a-z0-9 -]{0,59})*)?$');

ALTER TABLE "form_packages" ADD CONSTRAINT form_packages_values_valid CHECK (
  setting IN ('rawat_jalan', 'igd', 'rawat_inap')
  AND form_code ~ '^[a-z][a-z0-9_]{2,40}$'
  AND sort_order BETWEEN 0 AND 1000);

-- =====================================================================
-- Perubahan tabel lama
-- =====================================================================
-- Dokumen asal entri klinis (kunci TTE versi itu): keduanya ada atau keduanya kosong.
ALTER TABLE "documents" ADD CONSTRAINT documents_source_valid CHECK (
  (source_type IS NULL) = (source_id IS NULL)
  AND (source_type IS NULL OR source_type ~ '^[a-z][a-z_]{2,40}$'));

-- =====================================================================
-- RLS
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clinical_drafts', 'clinical_attestations', 'encounter_participants', 'drug_substances', 'form_packages',
    'observations', 'diagnostic_reports', 'conditions', 'procedures', 'allergy_intolerances', 'cppt_entries',
    'handovers', 'consult_requests', 'consult_responses', 'consents', 'consent_signatures', 'discharge_summaries',
    'discharge_medications', 'discharge_summary_sources'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $do$;

-- Anak append-only (tanda tangan persetujuan, obat pulang, sumber resume) dan atestasi.
CREATE TRIGGER clinical_attestations_append_only BEFORE UPDATE OR DELETE ON "clinical_attestations"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER consent_signatures_append_only BEFORE UPDATE OR DELETE ON "consent_signatures"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER discharge_medications_append_only BEFORE UPDATE OR DELETE ON "discharge_medications"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER discharge_summary_sources_append_only BEFORE UPDATE OR DELETE ON "discharge_summary_sources"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER drug_substances_no_delete BEFORE DELETE ON "drug_substances"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER form_packages_no_delete BEFORE DELETE ON "form_packages"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- =====================================================================
-- Hak akses: entri klinis hanya SELECT/INSERT (default privileges DB `simrs` memberi UPDATE/DELETE, dicabut).
-- Draf: penulis mengubah/menghapus (API); master: kolom bisnis saja.
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    FOREACH t IN ARRAY ARRAY[
      'clinical_attestations', 'encounter_participants', 'drug_substances', 'form_packages', 'observations',
      'diagnostic_reports', 'conditions', 'procedures', 'allergy_intolerances', 'cppt_entries', 'handovers',
      'consult_requests', 'consult_responses', 'consents', 'consent_signatures', 'discharge_summaries',
      'discharge_medications', 'discharge_summary_sources'] LOOP
      EXECUTE format('GRANT SELECT, INSERT ON %I TO simrs_app', t);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM simrs_app', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY[
      'observations', 'diagnostic_reports', 'conditions', 'procedures', 'allergy_intolerances', 'cppt_entries',
      'handovers', 'consult_requests', 'consult_responses', 'consents', 'discharge_summaries'] LOOP
      EXECUTE format('GRANT SELECT ON %I TO simrs_app', t || '_current');
    END LOOP;
    GRANT SELECT, INSERT, DELETE ON "clinical_drafts" TO simrs_app;
    REVOKE UPDATE, TRUNCATE ON "clinical_drafts" FROM simrs_app;
    GRANT UPDATE (content, updated_at) ON "clinical_drafts" TO simrs_app;
    GRANT UPDATE (ended_at, ended_by, end_reason) ON "encounter_participants" TO simrs_app;
    GRANT UPDATE (name, classes, active, updated_at, updated_by) ON "drug_substances" TO simrs_app;
    GRANT UPDATE (required, sort_order, active, updated_at, updated_by) ON "form_packages" TO simrs_app;
    -- EP 10c: penanda pasien rahasia diubah lewat aplikasi (diaudit).
    GRANT UPDATE (confidential) ON "patients" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;
