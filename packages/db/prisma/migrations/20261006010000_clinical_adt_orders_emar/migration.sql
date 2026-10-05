-- Fase 3 · potongan 3.0c skema II: ADT + bed (EXCLUDE btree_gist), gelang, triase, order/CDS, eMAR, askep, singkatan,
-- staging biaya + outbox held (rencana fase 3 §3.0c, ADR-0028). Bagian tengah dibangkitkan prisma migrate diff
-- (prisma/schema/{adt,orders,nursing}.prisma); bawah manual: CHECK, EXCLUDE, indeks parsial, trigger, fungsi,
-- app_patient_location, RLS, hak akses. Tabel ber-FORCE RLS yang dirujuk FK baru (atau berisi baris dan diberi FK
-- baru) dibuat NO FORCE sementara, dikembalikan di akhir berkas.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "locations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "drug_substances" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "observations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "diagnostic_reports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "discharge_medications" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "diagnostic_reports" ADD COLUMN     "service_request_id" UUID;

-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "service_request_id" UUID;

-- CreateTable
CREATE TABLE "bed_status" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'siap',
    "version" INTEGER NOT NULL DEFAULT 1,
    "encounter_id" UUID,
    "note" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "bed_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_status_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bed_status_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "encounter_id" UUID,
    "note" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "bed_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "care_class" TEXT NOT NULL,
    "unit_id" UUID,
    "isolation" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'menunggu',
    "allocated_location_id" UUID,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_by" UUID,
    "allocated_at" TIMESTAMPTZ(3),
    "allocated_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "close_reason" TEXT,

    CONSTRAINT "bed_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "ended_by" UUID,

    CONSTRAINT "bed_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_wristbands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "patient_wristbands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wristband_scans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "wristband_id" UUID,
    "matched" BOOLEAN NOT NULL,
    "scanned_code" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wristband_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_assessments" (
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
    "scale" TEXT NOT NULL DEFAULT 'ATS',
    "vitals" JSONB NOT NULL,
    "discriminators" TEXT[],
    "suggested_level" INTEGER NOT NULL,
    "max_level" INTEGER NOT NULL,
    "chosen_level" INTEGER NOT NULL,
    "override_reason" TEXT,
    "reasons" TEXT[],

    CONSTRAINT "triage_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ed_status_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "zone" TEXT,
    "location_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "ed_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "medication_request_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_administrations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "medication_request_id" UUID NOT NULL,
    "schedule_id" UUID,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "wristband_scan_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "user_role" TEXT NOT NULL,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "double_check_user_id" UUID,
    "label_code" TEXT NOT NULL,

    CONSTRAINT "medication_administrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_diagnoses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "nursing_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_care_plans" (
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
    "diagnosis_id" UUID NOT NULL,
    "goals" TEXT NOT NULL,
    "interventions" JSONB NOT NULL,
    "evaluation" TEXT,

    CONSTRAINT "nursing_care_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abbreviations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "abbreviations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billable_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "billable_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orderables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "unit_id" UUID,
    "coverage" TEXT NOT NULL DEFAULT 'ditanggung',
    "priority" TEXT NOT NULL DEFAULT 'rutin',
    "keywords" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "orderables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drugs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "substance_id" UUID,
    "code_system" TEXT,
    "code" TEXT,
    "dosage_form" TEXT NOT NULL,
    "strength" TEXT,
    "fornas" BOOLEAN NOT NULL DEFAULT false,
    "high_alert" BOOLEAN NOT NULL DEFAULT false,
    "coverage" TEXT NOT NULL DEFAULT 'ditanggung',
    "keywords" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "drugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "order_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_set_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_set_id" UUID NOT NULL,
    "orderable_id" UUID,
    "drug_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_set_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "order_set_id" UUID,
    "ordered_by" UUID NOT NULL,
    "ordered_role" TEXT NOT NULL,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "ordered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_group_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "orderable_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "priority" TEXT NOT NULL,
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_group_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "drug_id" UUID,
    "compound" JSONB,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "custom_times" TEXT[],
    "duration_days" INTEGER,
    "instructions" TEXT,
    "high_alert" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_request_id" UUID,
    "medication_request_id" UUID,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cds_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aktif',
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "cds_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cds_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "order_group_id" UUID,
    "service_request_id" UUID,
    "medication_request_id" UUID,
    "line_index" INTEGER NOT NULL,
    "rule_code" TEXT NOT NULL,
    "rule_version" INTEGER,
    "level" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "override_reason" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_role" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cds_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bed_status_tenant_id_unit_id_status_idx" ON "bed_status"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bed_status_tenant_id_id_key" ON "bed_status"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bed_status_tenant_id_location_id_key" ON "bed_status"("tenant_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "bed_status_events_tenant_id_id_key" ON "bed_status_events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bed_status_events_tenant_id_bed_status_id_version_key" ON "bed_status_events"("tenant_id", "bed_status_id", "version");

-- CreateIndex
CREATE INDEX "bed_requests_tenant_id_status_requested_at_idx" ON "bed_requests"("tenant_id", "status", "requested_at");

-- CreateIndex
CREATE INDEX "bed_requests_tenant_id_encounter_id_idx" ON "bed_requests"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "bed_requests_tenant_id_id_key" ON "bed_requests"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "bed_assignments_tenant_id_encounter_id_idx" ON "bed_assignments"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "bed_assignments_tenant_id_patient_id_idx" ON "bed_assignments"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "bed_assignments_tenant_id_id_key" ON "bed_assignments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "patient_wristbands_tenant_id_encounter_id_idx" ON "patient_wristbands"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_wristbands_tenant_id_id_key" ON "patient_wristbands"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_wristbands_tenant_id_code_key" ON "patient_wristbands"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "wristband_scans_tenant_id_encounter_id_scanned_at_idx" ON "wristband_scans"("tenant_id", "encounter_id", "scanned_at");

-- CreateIndex
CREATE UNIQUE INDEX "wristband_scans_tenant_id_id_key" ON "wristband_scans"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "triage_assessments_tenant_id_encounter_id_idx" ON "triage_assessments"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "triage_assessments_tenant_id_id_key" ON "triage_assessments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "triage_assessments_tenant_id_root_id_version_key" ON "triage_assessments"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "ed_status_events_tenant_id_encounter_id_changed_at_idx" ON "ed_status_events"("tenant_id", "encounter_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "ed_status_events_tenant_id_id_key" ON "ed_status_events"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "medication_schedules_tenant_id_encounter_id_scheduled_at_idx" ON "medication_schedules"("tenant_id", "encounter_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "medication_schedules_tenant_id_id_key" ON "medication_schedules"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_schedules_tenant_id_medication_request_id_schedu_key" ON "medication_schedules"("tenant_id", "medication_request_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "medication_administrations_tenant_id_encounter_id_occurred__idx" ON "medication_administrations"("tenant_id", "encounter_id", "occurred_at");

-- CreateIndex
CREATE INDEX "medication_administrations_tenant_id_medication_request_id_idx" ON "medication_administrations"("tenant_id", "medication_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_administrations_tenant_id_id_key" ON "medication_administrations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nursing_diagnoses_tenant_id_id_key" ON "nursing_diagnoses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nursing_diagnoses_tenant_id_code_key" ON "nursing_diagnoses"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "nursing_care_plans_tenant_id_encounter_id_idx" ON "nursing_care_plans"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "nursing_care_plans_tenant_id_id_key" ON "nursing_care_plans"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "nursing_care_plans_tenant_id_root_id_version_key" ON "nursing_care_plans"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "abbreviations_tenant_id_id_key" ON "abbreviations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "abbreviations_tenant_id_kind_term_key" ON "abbreviations"("tenant_id", "kind", "term");

-- CreateIndex
CREATE INDEX "billable_events_tenant_id_encounter_id_idx" ON "billable_events"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "billable_events_tenant_id_id_key" ON "billable_events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "billable_events_tenant_id_source_type_source_id_kind_key" ON "billable_events"("tenant_id", "source_type", "source_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "orderables_tenant_id_id_key" ON "orderables"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orderables_tenant_id_kind_name_key" ON "orderables"("tenant_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "drugs_tenant_id_id_key" ON "drugs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drugs_tenant_id_name_key" ON "drugs"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "order_sets_tenant_id_id_key" ON "order_sets"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_sets_tenant_id_code_key" ON "order_sets"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "order_set_items_tenant_id_order_set_id_idx" ON "order_set_items"("tenant_id", "order_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_set_items_tenant_id_id_key" ON "order_set_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "order_groups_tenant_id_encounter_id_idx" ON "order_groups"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_groups_tenant_id_id_key" ON "order_groups"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_groups_tenant_id_idempotency_key_key" ON "order_groups"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "service_requests_tenant_id_encounter_id_idx" ON "service_requests"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "service_requests_tenant_id_patient_id_idx" ON "service_requests"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_tenant_id_id_key" ON "service_requests"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "medication_requests_tenant_id_encounter_id_idx" ON "medication_requests"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "medication_requests_tenant_id_patient_id_idx" ON "medication_requests"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_requests_tenant_id_id_key" ON "medication_requests"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "order_status_events_tenant_id_service_request_id_idx" ON "order_status_events"("tenant_id", "service_request_id");

-- CreateIndex
CREATE INDEX "order_status_events_tenant_id_medication_request_id_idx" ON "order_status_events"("tenant_id", "medication_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_events_tenant_id_id_key" ON "order_status_events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cds_rules_tenant_id_id_key" ON "cds_rules"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cds_rules_tenant_id_code_version_key" ON "cds_rules"("tenant_id", "code", "version");

-- CreateIndex
CREATE INDEX "cds_alerts_tenant_id_encounter_id_idx" ON "cds_alerts"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "cds_alerts_tenant_id_decision_decided_at_idx" ON "cds_alerts"("tenant_id", "decision", "decided_at");

-- CreateIndex
CREATE UNIQUE INDEX "cds_alerts_tenant_id_id_key" ON "cds_alerts"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "bed_status" ADD CONSTRAINT "bed_status_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_status" ADD CONSTRAINT "bed_status_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_status" ADD CONSTRAINT "bed_status_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_status" ADD CONSTRAINT "bed_status_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_status_events" ADD CONSTRAINT "bed_status_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_status_events" ADD CONSTRAINT "bed_status_events_tenant_id_bed_status_id_fkey" FOREIGN KEY ("tenant_id", "bed_status_id") REFERENCES "bed_status"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_requests" ADD CONSTRAINT "bed_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_requests" ADD CONSTRAINT "bed_requests_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_requests" ADD CONSTRAINT "bed_requests_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_requests" ADD CONSTRAINT "bed_requests_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_requests" ADD CONSTRAINT "bed_requests_tenant_id_allocated_location_id_fkey" FOREIGN KEY ("tenant_id", "allocated_location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_wristbands" ADD CONSTRAINT "patient_wristbands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_wristbands" ADD CONSTRAINT "patient_wristbands_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_wristbands" ADD CONSTRAINT "patient_wristbands_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wristband_scans" ADD CONSTRAINT "wristband_scans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wristband_scans" ADD CONSTRAINT "wristband_scans_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wristband_scans" ADD CONSTRAINT "wristband_scans_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wristband_scans" ADD CONSTRAINT "wristband_scans_tenant_id_wristband_id_fkey" FOREIGN KEY ("tenant_id", "wristband_id") REFERENCES "patient_wristbands"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wristband_scans" ADD CONSTRAINT "wristband_scans_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "triage_assessments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "triage_assessments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ed_status_events" ADD CONSTRAINT "ed_status_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ed_status_events" ADD CONSTRAINT "ed_status_events_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ed_status_events" ADD CONSTRAINT "ed_status_events_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_service_request_id_fkey" FOREIGN KEY ("tenant_id", "service_request_id") REFERENCES "service_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_service_request_id_fkey" FOREIGN KEY ("tenant_id", "service_request_id") REFERENCES "service_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_medications" ADD CONSTRAINT "discharge_medications_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drugs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_tenant_id_medication_request_id_fkey" FOREIGN KEY ("tenant_id", "medication_request_id") REFERENCES "medication_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_medication_request_id_fkey" FOREIGN KEY ("tenant_id", "medication_request_id") REFERENCES "medication_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "medication_schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_wristband_scan_id_fkey" FOREIGN KEY ("tenant_id", "wristband_scan_id") REFERENCES "wristband_scans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_double_check_user_id_fkey" FOREIGN KEY ("tenant_id", "double_check_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_diagnoses" ADD CONSTRAINT "nursing_diagnoses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_plans" ADD CONSTRAINT "nursing_care_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_plans" ADD CONSTRAINT "nursing_care_plans_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_plans" ADD CONSTRAINT "nursing_care_plans_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_plans" ADD CONSTRAINT "nursing_care_plans_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_plans" ADD CONSTRAINT "nursing_care_plans_tenant_id_diagnosis_id_fkey" FOREIGN KEY ("tenant_id", "diagnosis_id") REFERENCES "nursing_diagnoses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_plans" ADD CONSTRAINT "nursing_care_plans_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "nursing_care_plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_plans" ADD CONSTRAINT "nursing_care_plans_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "nursing_care_plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abbreviations" ADD CONSTRAINT "abbreviations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_events" ADD CONSTRAINT "billable_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_events" ADD CONSTRAINT "billable_events_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_events" ADD CONSTRAINT "billable_events_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderables" ADD CONSTRAINT "orderables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderables" ADD CONSTRAINT "orderables_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drugs" ADD CONSTRAINT "drugs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drugs" ADD CONSTRAINT "drugs_tenant_id_substance_id_fkey" FOREIGN KEY ("tenant_id", "substance_id") REFERENCES "drug_substances"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sets" ADD CONSTRAINT "order_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_set_items" ADD CONSTRAINT "order_set_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_set_items" ADD CONSTRAINT "order_set_items_tenant_id_order_set_id_fkey" FOREIGN KEY ("tenant_id", "order_set_id") REFERENCES "order_sets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_set_items" ADD CONSTRAINT "order_set_items_tenant_id_orderable_id_fkey" FOREIGN KEY ("tenant_id", "orderable_id") REFERENCES "orderables"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_set_items" ADD CONSTRAINT "order_set_items_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drugs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_tenant_id_order_set_id_fkey" FOREIGN KEY ("tenant_id", "order_set_id") REFERENCES "order_sets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_tenant_id_ordered_by_fkey" FOREIGN KEY ("tenant_id", "ordered_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_order_group_id_fkey" FOREIGN KEY ("tenant_id", "order_group_id") REFERENCES "order_groups"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_orderable_id_fkey" FOREIGN KEY ("tenant_id", "orderable_id") REFERENCES "orderables"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_requests" ADD CONSTRAINT "medication_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_requests" ADD CONSTRAINT "medication_requests_tenant_id_order_group_id_fkey" FOREIGN KEY ("tenant_id", "order_group_id") REFERENCES "order_groups"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_requests" ADD CONSTRAINT "medication_requests_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_requests" ADD CONSTRAINT "medication_requests_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_requests" ADD CONSTRAINT "medication_requests_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drugs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_tenant_id_service_request_id_fkey" FOREIGN KEY ("tenant_id", "service_request_id") REFERENCES "service_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_tenant_id_medication_request_id_fkey" FOREIGN KEY ("tenant_id", "medication_request_id") REFERENCES "medication_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_rules" ADD CONSTRAINT "cds_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_alerts" ADD CONSTRAINT "cds_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_alerts" ADD CONSTRAINT "cds_alerts_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_alerts" ADD CONSTRAINT "cds_alerts_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_alerts" ADD CONSTRAINT "cds_alerts_tenant_id_order_group_id_fkey" FOREIGN KEY ("tenant_id", "order_group_id") REFERENCES "order_groups"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_alerts" ADD CONSTRAINT "cds_alerts_tenant_id_service_request_id_fkey" FOREIGN KEY ("tenant_id", "service_request_id") REFERENCES "service_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_alerts" ADD CONSTRAINT "cds_alerts_tenant_id_medication_request_id_fkey" FOREIGN KEY ("tenant_id", "medication_request_id") REFERENCES "medication_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_alerts" ADD CONSTRAINT "cds_alerts_tenant_id_decided_by_fkey" FOREIGN KEY ("tenant_id", "decided_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Tabel klinis berversi baru: triase dan rencana asuhan keperawatan (pola ADR-0028, sama dengan 3.0b)
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['triage_assessments', 'nursing_care_plans'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (status IN (''final'', ''entered_in_error''))',
      t, t || '_status_valid');
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
    EXECUTE format(
      'CREATE VIEW %I WITH (security_invoker = true) AS SELECT r.* FROM %I r WHERE NOT EXISTS ('
      || 'SELECT 1 FROM %I n WHERE n.tenant_id = r.tenant_id AND n.supersedes_id = r.id)',
      t || '_current', t, t);
  END LOOP;
END $do$;

-- Triase ATS: level 1–5; pilihan tidak boleh di bawah batas protokol; turun dari saran wajib alasan ≥ 10
-- (keputusan fase 3 no. 6); naik bebas.
ALTER TABLE "triage_assessments" ADD CONSTRAINT triage_assessments_values_valid CHECK (
  scale = 'ATS'
  AND jsonb_typeof(vitals) = 'object'
  AND cardinality(discriminators) <= 6
  AND suggested_level BETWEEN 1 AND 5 AND max_level BETWEEN 1 AND 5 AND chosen_level BETWEEN 1 AND 5
  AND suggested_level <= max_level
  AND chosen_level <= max_level
  AND (chosen_level <= suggested_level OR char_length(btrim(coalesce(override_reason, ''))) >= 10)
  AND (override_reason IS NULL OR char_length(override_reason) <= 500)
  AND cardinality(reasons) <= 20);

ALTER TABLE "nursing_care_plans" ADD CONSTRAINT nursing_care_plans_values_valid CHECK (
  char_length(goals) BETWEEN 1 AND 2000
  AND jsonb_typeof(interventions) = 'array'
  AND (evaluation IS NULL OR char_length(evaluation) <= 2000));

-- Atestasi kini juga atas order (tinjau order residen) dan triase/askep.
CREATE OR REPLACE FUNCTION app_clinical_attestation_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  target_patient uuid;
  n integer;
BEGIN
  IF NOT NEW.target_type = ANY (ARRAY[
       'cppt_entries', 'observations', 'diagnostic_reports', 'conditions', 'procedures', 'allergy_intolerances',
       'handovers', 'consult_requests', 'consult_responses', 'consents', 'discharge_summaries',
       'triage_assessments', 'nursing_care_plans', 'order_groups', 'service_requests', 'medication_requests']) THEN
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

-- =====================================================================
-- ADT dan bed
-- =====================================================================
ALTER TABLE "bed_status" ADD CONSTRAINT bed_status_values_valid CHECK (
  status IN ('siap', 'dipesan', 'terisi', 'pulang', 'kotor', 'dibersihkan', 'rusak')
  AND version >= 1
  AND (status IN ('dipesan', 'terisi', 'pulang')) = (encounter_id IS NOT NULL)
  AND (note IS NULL OR char_length(note) <= 200));
ALTER TABLE "bed_status_events" ADD CONSTRAINT bed_status_events_values_valid CHECK (
  to_status IN ('siap', 'dipesan', 'terisi', 'pulang', 'kotor', 'dibersihkan', 'rusak')
  AND (from_status IS NULL OR from_status IN ('siap', 'dipesan', 'terisi', 'pulang', 'kotor', 'dibersihkan', 'rusak'))
  AND version >= 1);

-- Status bed: hanya bed (`locations.kind = 'bed'`) di unitnya; perubahan wajib versi + 1 (konkurensi optimistis,
-- `baseVersion` di API), lokasi/unit tetap, waktu dari server; setiap perubahan dicatat ke jejak append-only.
CREATE FUNCTION app_bed_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: status bed tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM locations l
                   WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.location_id AND l.kind = 'bed'
                     AND l.unit_id = NEW.unit_id) THEN
      RAISE EXCEPTION 'BED_LOCATION: lokasi bukan bed di unit ini' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'BED_VERSION_CONFLICT: status bed baru mulai dari versi 1' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.location_id <> OLD.location_id OR NEW.unit_id <> OLD.unit_id OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'BED_LOCATION: lokasi status bed tetap' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'BED_VERSION_CONFLICT: status bed sudah diubah petugas lain' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.changed_at := statement_timestamp();
  RETURN NEW;
END $fn$;
CREATE TRIGGER bed_status_guard BEFORE INSERT OR UPDATE OR DELETE ON "bed_status"
  FOR EACH ROW EXECUTE FUNCTION app_bed_status_guard();

CREATE FUNCTION app_bed_status_log() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO bed_status_events (id, tenant_id, bed_status_id, from_status, to_status, version, encounter_id, note,
                                 changed_at, changed_by)
  VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
          NEW.version, NEW.encounter_id, NEW.note, NEW.changed_at, NEW.changed_by);
  RETURN NULL;
END $fn$;
CREATE TRIGGER bed_status_log AFTER INSERT OR UPDATE ON "bed_status"
  FOR EACH ROW EXECUTE FUNCTION app_bed_status_log();
-- Papan bed real-time (ADR-0026): payload hanya tenant_id + id jejak.
CREATE TRIGGER bed_status_events_notify AFTER INSERT ON "bed_status_events"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('bed_board');

ALTER TABLE "bed_requests" ADD CONSTRAINT bed_requests_values_valid CHECK (
  origin IN ('igd', 'ok', 'poli', 'lainnya')
  AND care_class ~ '^[a-z][a-z0-9_]{1,30}$'
  AND status IN ('menunggu', 'dialokasi', 'selesai', 'batal')
  AND (status = 'menunggu' OR status = 'batal' OR allocated_location_id IS NOT NULL)
  AND (allocated_location_id IS NULL) = (allocated_at IS NULL)
  AND (status IN ('selesai', 'batal')) = (closed_at IS NOT NULL)
  AND (status <> 'batal' OR char_length(btrim(coalesce(close_reason, ''))) >= 10)
  AND (note IS NULL OR char_length(note) <= 300));
CREATE UNIQUE INDEX bed_requests_one_open_per_encounter
  ON "bed_requests" (tenant_id, encounter_id) WHERE status IN ('menunggu', 'dialokasi');

-- Permintaan bed: identitas permintaan tetap; permintaan tertutup beku.
CREATE FUNCTION app_bed_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['status', 'allocated_location_id', 'allocated_at', 'allocated_by', 'closed_at',
                                   'closed_by', 'close_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: permintaan bed tidak dihapus; batalkan dengan alasan' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('selesai', 'batal') OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'BED_REQUEST_CLOSED: permintaan bed tertutup atau kolom tetap diubah' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER bed_requests_guard BEFORE UPDATE OR DELETE ON "bed_requests"
  FOR EACH ROW EXECUTE FUNCTION app_bed_request_guard();

-- Hunian: satu bed tidak dihuni dua kunjungan, satu kunjungan satu bed, pada saat yang sama (btree_gist).
ALTER TABLE "bed_assignments" ADD CONSTRAINT bed_assignments_values_valid CHECK (
  (ended_at IS NULL OR ended_at > started_at)
  AND (ended_at IS NULL) = (end_reason IS NULL)
  AND (end_reason IS NULL OR end_reason IN ('transfer', 'pulang', 'batal')));
ALTER TABLE "bed_assignments" ADD CONSTRAINT bed_assignments_no_double_occupancy
  EXCLUDE USING gist (tenant_id WITH =, location_id WITH =, tstzrange(started_at, ended_at, '[)') WITH &&);
ALTER TABLE "bed_assignments" ADD CONSTRAINT bed_assignments_one_bed_per_encounter
  EXCLUDE USING gist (tenant_id WITH =, encounter_id WITH =, tstzrange(started_at, ended_at, '[)') WITH &&);

-- Penempatan hanya ke lokasi bed; periode ditutup sekali (ended_at, end_reason, ended_by), tidak dihapus.
CREATE FUNCTION app_bed_assignment_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  closing CONSTANT text[] := ARRAY['ended_at', 'end_reason', 'ended_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: penempatan bed tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM locations l WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.location_id
                     AND l.kind = 'bed') THEN
      RAISE EXCEPTION 'BED_LOCATION: lokasi bukan bed' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
     OR (to_jsonb(NEW) - closing) IS DISTINCT FROM (to_jsonb(OLD) - closing) THEN
    RAISE EXCEPTION 'BED_ASSIGNMENT_CLOSED: penempatan bed hanya bisa diakhiri sekali' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER bed_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON "bed_assignments"
  FOR EACH ROW EXECUTE FUNCTION app_bed_assignment_guard();

-- Gelang: kode acak (bukan RM), satu aktif per kunjungan; batal tutup-sekali beralasan.
ALTER TABLE "patient_wristbands" ADD CONSTRAINT patient_wristbands_values_valid CHECK (
  code ~ '^[A-Z0-9]{8,32}$'
  AND (voided_at IS NULL) = (voided_by IS NULL)
  AND (voided_at IS NULL) = (void_reason IS NULL)
  AND (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 10 AND 300));
CREATE UNIQUE INDEX patient_wristbands_one_active
  ON "patient_wristbands" (tenant_id, encounter_id) WHERE voided_at IS NULL;
CREATE FUNCTION app_wristband_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  closing CONSTANT text[] := ARRAY['voided_at', 'voided_by', 'void_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: gelang tidak dihapus; batalkan' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
     OR (to_jsonb(NEW) - closing) IS DISTINCT FROM (to_jsonb(OLD) - closing) THEN
    RAISE EXCEPTION 'WRISTBAND_VOIDED: gelang hanya bisa dibatalkan sekali' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER patient_wristbands_guard BEFORE UPDATE OR DELETE ON "patient_wristbands"
  FOR EACH ROW EXECUTE FUNCTION app_wristband_guard();

-- Pindaian gelang: append-only; waktu dari server; "cocok" hanya bila menunjuk gelang aktif kunjungan ini dengan kode
-- yang sama (ditetapkan database, bukan klien).
ALTER TABLE "wristband_scans" ADD CONSTRAINT wristband_scans_values_valid CHECK (
  matched = (wristband_id IS NOT NULL) AND char_length(scanned_code) BETWEEN 1 AND 64);
CREATE FUNCTION app_wristband_scan_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.scanned_at := statement_timestamp();
  IF NEW.wristband_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM patient_wristbands w
       WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.wristband_id AND w.encounter_id = NEW.encounter_id
         AND w.patient_id = NEW.patient_id AND w.code = NEW.scanned_code AND w.voided_at IS NULL) THEN
    RAISE EXCEPTION 'WRISTBAND_MISMATCH: gelang tidak cocok dengan kunjungan ini' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER wristband_scans_guard BEFORE INSERT ON "wristband_scans"
  FOR EACH ROW EXECUTE FUNCTION app_wristband_scan_guard();

ALTER TABLE "ed_status_events" ADD CONSTRAINT ed_status_events_values_valid CHECK (
  status IN ('registrasi', 'triase', 'resusitasi', 'pemeriksaan', 'tunggu-dokter', 'tunggu-lab', 'observasi',
             'tunggu-bed', 'siap-pulang')
  AND (zone IS NULL OR zone IN ('T', 'R', 'B', 'K')));
CREATE TRIGGER ed_status_events_notify AFTER INSERT ON "ed_status_events"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('ed_board');

-- Lokasi kini pasien (ADR-0031, lingkup unit tingkat bed): kunjungan aktif kelompok rekam medis (ADR-0016) beserta
-- unit dan bed yang sedang ditempati (null bila belum/tanpa bed). SECURITY INVOKER: tunduk RLS pemanggil.
CREATE FUNCTION app_patient_location(p_patient uuid)
RETURNS TABLE (encounter_id uuid, unit_id uuid, location_id uuid)
LANGUAGE sql STABLE AS $fn$
  SELECT e.id, coalesce(l.unit_id, e.unit_id), ba.location_id
  FROM encounters e
  LEFT JOIN bed_assignments ba
    ON ba.tenant_id = e.tenant_id AND ba.encounter_id = e.id AND ba.ended_at IS NULL
  LEFT JOIN locations l ON l.tenant_id = ba.tenant_id AND l.id = ba.location_id
  WHERE e.patient_id IN (SELECT app_patient_group(p_patient))
    AND e.status IN ('planned', 'arrived', 'in_progress')
$fn$;

-- =====================================================================
-- Order dan CDS
-- =====================================================================
ALTER TABLE "orderables" ADD CONSTRAINT orderables_values_valid CHECK (
  kind IN ('lab', 'radiologi', 'tindakan', 'kontrol')
  AND (code_system IS NULL) = (code IS NULL)
  AND (code_system IS NULL OR code_system IN ('loinc', 'icd9cm'))
  AND coverage IN ('ditanggung', 'fornas', 'tidak-ditanggung')
  AND priority IN ('rutin', 'cito')
  AND char_length(name) BETWEEN 1 AND 160);
CREATE TRIGGER orderables_code_guard BEFORE INSERT OR UPDATE ON "orderables"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_code_guard();

ALTER TABLE "drugs" ADD CONSTRAINT drugs_values_valid CHECK (
  (code_system IS NULL) = (code IS NULL)
  AND (code_system IS NULL OR code_system = 'kfa')
  AND coverage IN ('ditanggung', 'fornas', 'tidak-ditanggung')
  AND char_length(name) BETWEEN 1 AND 160 AND char_length(dosage_form) BETWEEN 1 AND 40);
CREATE TRIGGER drugs_code_guard BEFORE INSERT OR UPDATE ON "drugs"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_code_guard();

ALTER TABLE "order_sets" ADD CONSTRAINT order_sets_values_valid CHECK (
  code ~ '^[a-z0-9][a-z0-9-]{2,60}$' AND char_length(name) BETWEEN 1 AND 120);
ALTER TABLE "order_set_items" ADD CONSTRAINT order_set_items_one_target CHECK (
  (orderable_id IS NULL) <> (drug_id IS NULL));

ALTER TABLE "order_groups" ADD CONSTRAINT order_groups_values_valid CHECK (
  char_length(idempotency_key) BETWEEN 8 AND 200
  AND request_hash ~ '^[0-9a-f]{64}$'
  AND ordered_role ~ '^[a-z][a-z0-9_]{2,40}$');

ALTER TABLE "service_requests" ADD CONSTRAINT service_requests_values_valid CHECK (
  priority IN ('rutin', 'cito')
  AND (code_system IS NULL) = (code IS NULL)
  AND (instructions IS NULL OR char_length(instructions) <= 300));

-- Racikan: satu obat ATAU satu racikan; frekuensi baku (`MEDICATION_FREQUENCIES`); jam khusus HH.MM.
ALTER TABLE "medication_requests" ADD CONSTRAINT medication_requests_values_valid CHECK (
  (drug_id IS NULL) <> (compound IS NULL)
  AND (compound IS NULL OR (jsonb_typeof(compound) = 'object' AND jsonb_typeof(compound->'components') = 'array'))
  AND frequency IN ('1x1_pagi', '1x1_siang', '1x1_sore', '1x1_malam', '2x1', '3x1', '3x1_makan', '4x1', 'prn', 'stat')
  AND cardinality(custom_times) <= 8
  AND array_to_string(custom_times, ',') ~ '^(([01][0-9]|2[0-3])\.[0-5][0-9](,([01][0-9]|2[0-3])\.[0-5][0-9])*)?$'
  AND (duration_days IS NULL OR duration_days BETWEEN 1 AND 90)
  AND char_length(dose) BETWEEN 1 AND 40 AND char_length(route) BETWEEN 1 AND 30
  AND (instructions IS NULL OR char_length(instructions) <= 300));

-- Order milik kiriman yang sama kunjungannya.
CREATE FUNCTION app_order_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_groups g WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.order_group_id
                   AND g.encounter_id = NEW.encounter_id AND g.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: order harus untuk kunjungan kirimannya' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER service_requests_group_guard BEFORE INSERT ON "service_requests"
  FOR EACH ROW EXECUTE FUNCTION app_order_line_guard();
CREATE TRIGGER medication_requests_group_guard BEFORE INSERT ON "medication_requests"
  FOR EACH ROW EXECUTE FUNCTION app_order_line_guard();

ALTER TABLE "order_status_events" ADD CONSTRAINT order_status_events_values_valid CHECK (
  (service_request_id IS NULL) <> (medication_request_id IS NULL)
  AND status IN ('aktif', 'dibatalkan', 'selesai')
  AND (status <> 'dibatalkan' OR char_length(btrim(coalesce(reason, ''))) BETWEEN 10 AND 500));

ALTER TABLE "cds_rules" ADD CONSTRAINT cds_rules_values_valid CHECK (
  code ~ '^[a-z0-9][a-z0-9-]{2,79}$'
  AND version >= 1
  AND status IN ('aktif', 'nonaktif')
  AND jsonb_typeof(definition) = 'object'
  AND definition->>'kind' IN ('cross_reactivity', 'interaction', 'history', 'renal', 'duplicate'));

-- Override temuan blok wajib alasan ≥ 10; peringatan cukup "diterima"; blok tanpa override = "diblokir".
ALTER TABLE "cds_alerts" ADD CONSTRAINT cds_alerts_values_valid CHECK (
  level IN ('info', 'warn', 'block')
  AND rule IN ('aman', 'alergi', 'alergi-silang', 'interaksi', 'riwayat', 'dosis', 'biaya', 'ginjal', 'duplikasi',
               'singkatan')
  AND decision IN ('diterima', 'override', 'diblokir')
  AND (decision = 'override') = (override_reason IS NOT NULL)
  AND (override_reason IS NULL OR char_length(btrim(override_reason)) BETWEEN 10 AND 500)
  AND (decision <> 'override' OR level = 'block')
  AND (level <> 'block' OR decision IN ('override', 'diblokir'))
  AND (decision <> 'diblokir' OR order_group_id IS NULL)
  AND line_index >= 0
  AND decided_role ~ '^[a-z][a-z0-9_]{2,40}$'
  AND char_length(message) BETWEEN 1 AND 500);

-- =====================================================================
-- eMAR
-- =====================================================================
CREATE FUNCTION app_medication_schedule_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM medication_requests m WHERE m.tenant_id = NEW.tenant_id
                   AND m.id = NEW.medication_request_id AND m.encounter_id = NEW.encounter_id) THEN
    RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: jadwal harus untuk kunjungan ordernya' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER medication_schedules_guard BEFORE INSERT ON "medication_schedules"
  FOR EACH ROW EXECUTE FUNCTION app_medication_schedule_guard();

ALTER TABLE "medication_administrations" ADD CONSTRAINT medication_administrations_values_valid CHECK (
  status IN ('given', 'held', 'refused')
  AND user_role ~ '^[a-z][a-z0-9_]{2,40}$'
  AND (reason IS NULL OR char_length(reason) <= 500)
  AND (status = 'given' OR char_length(btrim(coalesce(reason, ''))) >= 10)
  AND (NOT late OR char_length(btrim(coalesce(reason, ''))) >= 10)
  AND (double_check_user_id IS NULL OR double_check_user_id <> user_id)
  AND char_length(label_code) BETWEEN 1 AND 64
  AND occurred_at <= recorded_at + interval '5 minutes');
-- Satu dosis "diberikan" per jadwal (dosis ganda ditolak).
CREATE UNIQUE INDEX medication_administrations_one_given
  ON "medication_administrations" (tenant_id, schedule_id) WHERE status = 'given' AND schedule_id IS NOT NULL;

-- Gerbang gelang (keputusan fase 3 no. 8, tidak ada jalur melewati pindai): pindaian cocok, kunjungan sama, perawat
-- sama, dan tidak lebih lama dari `emar.scan_valid_minutes` (pengaturan RS, bawaan 10). Order dan jadwal milik
-- kunjungan yang sama; obat kewaspadaan tinggi wajib cek ganda.
CREATE FUNCTION app_medication_administration_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  scan record;
  n integer;
  valid_minutes integer;
  high_alert boolean;
BEGIN
  NEW.recorded_at := statement_timestamp();
  SELECT s.matched, s.encounter_id, s.user_id, s.scanned_at INTO scan
  FROM wristband_scans s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.wristband_scan_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 OR NOT scan.matched OR scan.encounter_id <> NEW.encounter_id THEN
    RAISE EXCEPTION 'WRISTBAND_MISMATCH: pemberian obat wajib pindaian gelang yang cocok untuk kunjungan ini'
      USING ERRCODE = 'P0001';
  END IF;
  IF scan.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'WRISTBAND_SCAN_REQUIRED: pindaian gelang milik petugas lain' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce((SELECT (value #>> '{}')::integer FROM tenant_settings
                   WHERE tenant_id = NEW.tenant_id AND key = 'emar.scan_valid_minutes'), 10)
    INTO valid_minutes;
  IF NEW.recorded_at - scan.scanned_at > make_interval(mins => valid_minutes) THEN
    RAISE EXCEPTION 'WRISTBAND_SCAN_REQUIRED: pindaian gelang kedaluwarsa; pindai ulang' USING ERRCODE = 'P0001';
  END IF;
  SELECT m.high_alert INTO high_alert FROM medication_requests m
  WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.medication_request_id AND m.encounter_id = NEW.encounter_id
    AND m.patient_id = NEW.patient_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: order obat bukan milik kunjungan ini' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.schedule_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM medication_schedules ms WHERE ms.tenant_id = NEW.tenant_id AND ms.id = NEW.schedule_id
         AND ms.medication_request_id = NEW.medication_request_id) THEN
    RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: jadwal bukan milik order ini' USING ERRCODE = 'P0001';
  END IF;
  IF high_alert AND NEW.status = 'given' AND NEW.double_check_user_id IS NULL THEN
    RAISE EXCEPTION 'DOUBLE_CHECK_REQUIRED: obat kewaspadaan tinggi wajib cek ganda perawat kedua'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER medication_administrations_guard BEFORE INSERT ON "medication_administrations"
  FOR EACH ROW EXECUTE FUNCTION app_medication_administration_guard();

-- =====================================================================
-- Askep, singkatan, staging
-- =====================================================================
ALTER TABLE "nursing_diagnoses" ADD CONSTRAINT nursing_diagnoses_values_valid CHECK (
  code ~ '^[a-z0-9][a-z0-9-]{1,40}$' AND char_length(name) BETWEEN 1 AND 160);
ALTER TABLE "abbreviations" ADD CONSTRAINT abbreviations_values_valid CHECK (
  kind IN ('token', 'pattern') AND char_length(term) BETWEEN 1 AND 60 AND char_length(suggestion) BETWEEN 1 AND 120);

ALTER TABLE "billable_events" ADD CONSTRAINT billable_events_values_valid CHECK (
  kind IN ('visite', 'admisi', 'transfer', 'pulang', 'igd', 'lab', 'radiologi', 'tindakan', 'obat', 'konsultasi')
  AND source_type ~ '^[a-z][a-z_]{2,40}$'
  AND quantity BETWEEN 1 AND 1000);

-- Outbox: status `held` = staging SATUSEHAT (ADR-0032) yang tidak diklaim dispatcher sampai dilepas fase 7.
ALTER TABLE "outbox_messages" ADD CONSTRAINT outbox_messages_status_valid CHECK (
  status IN ('pending', 'processing', 'sent', 'failed', 'dead', 'held'));

-- =====================================================================
-- Append-only (juga pemilik tabel) dan master tanpa hapus
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bed_status_events', 'wristband_scans', 'ed_status_events', 'order_groups',
                           'service_requests', 'medication_requests', 'order_status_events', 'cds_rules', 'cds_alerts',
                           'medication_schedules', 'medication_administrations', 'billable_events'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()',
      t || '_append_only', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['orderables', 'drugs', 'order_sets', 'nursing_diagnoses', 'abbreviations'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()',
      t || '_no_delete', t);
  END LOOP;
END $do$;

-- =====================================================================
-- RLS
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bed_status', 'bed_status_events', 'bed_requests', 'bed_assignments', 'patient_wristbands', 'wristband_scans',
    'triage_assessments', 'ed_status_events', 'orderables', 'drugs', 'order_sets', 'order_set_items', 'order_groups',
    'service_requests', 'medication_requests', 'order_status_events', 'cds_rules', 'cds_alerts',
    'medication_schedules', 'medication_administrations', 'nursing_diagnoses', 'nursing_care_plans', 'abbreviations',
    'billable_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $do$;

-- =====================================================================
-- Hak akses
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    FOREACH t IN ARRAY ARRAY[
      'bed_status', 'bed_status_events', 'bed_requests', 'bed_assignments', 'patient_wristbands', 'wristband_scans',
      'triage_assessments', 'ed_status_events', 'orderables', 'drugs', 'order_sets', 'order_set_items',
      'order_groups', 'service_requests', 'medication_requests', 'order_status_events', 'cds_rules', 'cds_alerts',
      'medication_schedules', 'medication_administrations', 'nursing_diagnoses', 'nursing_care_plans',
      'abbreviations', 'billable_events'] LOOP
      EXECUTE format('GRANT SELECT, INSERT ON %I TO simrs_app', t);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM simrs_app', t);
    END LOOP;
    GRANT SELECT ON triage_assessments_current, nursing_care_plans_current TO simrs_app;
    GRANT UPDATE (status, version, encounter_id, note, changed_at, changed_by) ON "bed_status" TO simrs_app;
    GRANT UPDATE (status, allocated_location_id, allocated_at, allocated_by, closed_at, closed_by, close_reason)
      ON "bed_requests" TO simrs_app;
    GRANT UPDATE (ended_at, end_reason, ended_by) ON "bed_assignments" TO simrs_app;
    GRANT UPDATE (voided_at, voided_by, void_reason) ON "patient_wristbands" TO simrs_app;
    GRANT UPDATE (name, unit_id, coverage, priority, keywords, active, updated_at, updated_by) ON "orderables" TO simrs_app;
    GRANT UPDATE (name, substance_id, dosage_form, strength, fornas, high_alert, coverage, keywords, active,
                  updated_at, updated_by) ON "drugs" TO simrs_app;
    GRANT UPDATE (name, description, active, updated_at, updated_by) ON "order_sets" TO simrs_app;
    -- Isi order set disusun ulang (hapus + sisip) oleh pengelola `order.manage`.
    GRANT DELETE ON "order_set_items" TO simrs_app;
    GRANT UPDATE (name, active, updated_at, updated_by) ON "nursing_diagnoses" TO simrs_app;
    GRANT UPDATE (suggestion, active, updated_at, updated_by) ON "abbreviations" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "drug_substances" FORCE ROW LEVEL SECURITY;
ALTER TABLE "observations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "diagnostic_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "discharge_medications" FORCE ROW LEVEL SECURITY;
