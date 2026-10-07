-- Fase 4 · 4.0b · Skema penunjang S01–S10 (rencana fase 4 §4.0b): master lab/radiologi/stok/OK/gizi/darah; lab +
-- spesimen + hasil berversi + validasi + QC; nilai kritis + laporan read-back + eskalasi; mikro/PA; radiologi +
-- ekspertise berversi; farmasi klinis + dispensing; ledger stok + saldo; kamar operasi (EXCLUDE jadwal, daftar tilik
-- WHO, peristiwa, hitung, laporan operasi, BHP); gizi; bank darah. Bagian tengah dibangkitkan `prisma migrate diff`;
-- bagian bawah manual (batasan, trigger, RLS, hak akses).
-- FK komposit ke tabel lama: FORCE RLS dilepas sementara (dipulihkan di akhir berkas).
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "locations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orderables" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "drugs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "registered_devices" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_groups" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "medication_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inbound_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "consents" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "lab_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_no" TEXT NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'diterima',
    "idempotency_key" TEXT NOT NULL,
    "accepted_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_order_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "lab_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specimens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "specimen_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'menunggu',
    "collected_at" TIMESTAMPTZ(3),
    "collected_by" UUID,
    "received_at" TIMESTAMPTZ(3),
    "received_by" UUID,
    "rejected_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "specimens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specimen_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "specimen_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specimen_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
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
    "lab_order_id" UUID NOT NULL,
    "test_definition_id" UUID NOT NULL,
    "loinc" TEXT,
    "name" TEXT NOT NULL,
    "value_numeric" DECIMAL(18,6),
    "value_text" TEXT,
    "unit" TEXT NOT NULL DEFAULT '',
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "ref_low" DECIMAL(14,4),
    "ref_high" DECIMAL(14,4),
    "critical_low" DECIMAL(14,4),
    "critical_high" DECIMAL(14,4),
    "flag" TEXT NOT NULL,
    "delta" BOOLEAN NOT NULL DEFAULT false,
    "delta_compared_result_id" UUID,
    "source" TEXT NOT NULL,
    "inbound_event_id" UUID,
    "comment" TEXT,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_validations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "snapshot_hash" TEXT NOT NULL,
    "qc_override_reason" TEXT,
    "document_id" UUID,
    "validated_by" UUID NOT NULL,
    "validator_role" TEXT NOT NULL,
    "validated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_qc_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "analyzer_id" UUID,
    "test_definition_id" UUID NOT NULL,
    "control_level" INTEGER NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "mean" DECIMAL(18,6) NOT NULL,
    "sd" DECIMAL(18,6) NOT NULL,
    "outcome" TEXT NOT NULL,
    "violations" TEXT[],
    "run_by" UUID NOT NULL,
    "run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_qc_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "lab_result_id" UUID,
    "imaging_report_id" UUID,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "analyte" TEXT NOT NULL,
    "value_text" TEXT NOT NULL,
    "limit_minutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'terbuka',
    "raised_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raised_by" UUID,

    CONSTRAINT "critical_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_result_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "critical_result_id" UUID NOT NULL,
    "recipient_user_id" UUID,
    "recipient_name" TEXT,
    "recipient_role" TEXT,
    "channel" TEXT NOT NULL,
    "read_back_text" TEXT NOT NULL,
    "read_back_confirmed" BOOLEAN NOT NULL,
    "reported_by" UUID NOT NULL,
    "reported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minutes_to_report" INTEGER NOT NULL DEFAULT 0,
    "within_limit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "critical_result_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_result_escalations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "critical_result_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "notified_user_ids" UUID[],
    "escalated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "critical_result_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "micro_isolates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "organism_code" TEXT NOT NULL,
    "growth" TEXT NOT NULL,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "micro_isolates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "micro_susceptibilities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "isolate_id" UUID NOT NULL,
    "antibiotic_code" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "mic_value" DECIMAL(12,4),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "micro_susceptibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "diet_type_id" UUID NOT NULL,
    "texture" TEXT NOT NULL,
    "notes" TEXT,
    "starts_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aktif',
    "ended_at" TIMESTAMPTZ(3),
    "ordered_by" UUID NOT NULL,
    "ordered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diet_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_services" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "diet_order_id" UUID NOT NULL,
    "meal" TEXT NOT NULL,
    "served_at" TIMESTAMPTZ(3) NOT NULL,
    "leftover" TEXT,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bag_no" TEXT NOT NULL,
    "component_id" UUID NOT NULL,
    "abo" TEXT NOT NULL,
    "rh" TEXT NOT NULL,
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'tersedia',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blood_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_no" TEXT NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "units" INTEGER NOT NULL,
    "urgency" TEXT NOT NULL,
    "indication" TEXT NOT NULL,
    "patient_abo" TEXT,
    "patient_rh" TEXT,
    "status" TEXT NOT NULL DEFAULT 'diminta',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blood_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crossmatches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "blood_request_id" UUID NOT NULL,
    "blood_unit_id" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "tested_by" UUID NOT NULL,
    "tested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crossmatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_issues" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "blood_request_id" UUID NOT NULL,
    "blood_unit_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "emergency_reason" TEXT,
    "issued_by" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blood_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfusion_reactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "blood_issue_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reported_by" UUID NOT NULL,
    "reported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfusion_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "expiry_date" DATE NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "supplier_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "stock_batch_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "stock_batch_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "reason" TEXT,
    "encounter_id" UUID,
    "patient_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "received_by" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "from_stock_location_id" UUID NOT NULL,
    "to_stock_location_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dikirim',
    "items" JSONB NOT NULL,
    "sent_by" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" UUID,
    "received_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_by" UUID NOT NULL,
    "adjusted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_prescriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "prescription_no" TEXT NOT NULL,
    "order_group_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "setting" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'telaah',
    "accepted_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pharmacy_prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_prescription_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pharmacy_prescription_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "pharmacy_prescription_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pharmacy_prescription_id" UUID NOT NULL,
    "administratif" BOOLEAN NOT NULL,
    "farmasetik" BOOLEAN NOT NULL,
    "klinis" BOOLEAN NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "medication_request_ids" UUID[],
    "reviewed_by" UUID NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacist_interventions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pharmacy_prescription_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "medication_request_ids" UUID[],
    "recommendation" TEXT NOT NULL,
    "prescriber_user_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacist_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacist_intervention_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "intervention_id" UUID NOT NULL,
    "response" TEXT NOT NULL,
    "note" TEXT,
    "responded_by" UUID NOT NULL,
    "responded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacist_intervention_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pharmacy_prescription_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "prepared_by" UUID NOT NULL,
    "prepared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "has_high_alert" BOOLEAN NOT NULL DEFAULT false,
    "double_checked_by" UUID,
    "double_checked_at" TIMESTAMPTZ(3),
    "handed_over_by" UUID,
    "handed_over_at" TIMESTAMPTZ(3),
    "receiver_kind" TEXT,
    "receiver_name" TEXT,
    "counseling_given" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dispenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispense_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dispense_id" UUID NOT NULL,
    "medication_request_id" UUID NOT NULL,
    "stock_batch_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "label_barcode" TEXT NOT NULL,
    "fefo_override_reason" TEXT,
    "stock_movement_id" UUID NOT NULL,

    CONSTRAINT "dispense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispense_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dispense_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stock_movement_id" UUID,
    "returned_by" UUID NOT NULL,
    "returned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispense_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imaging_studies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "accession" TEXT NOT NULL,
    "service_request_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "modality_id" UUID NOT NULL,
    "modality" TEXT NOT NULL,
    "procedure_id" UUID,
    "contrast" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'terjadwal',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "identity_confirmed_by" UUID,
    "contrast_screening" JSONB,
    "override_reason" TEXT,
    "override_by" UUID,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "ctdi_vol" DECIMAL(10,2),
    "dlp" DECIMAL(10,2),
    "study_instance_uid" TEXT,
    "accepted_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "imaging_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imaging_study_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "imaging_study_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "imaging_study_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imaging_reports" (
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
    "imaging_study_id" UUID NOT NULL,
    "template_code" TEXT,
    "findings" TEXT NOT NULL,
    "impression" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "imaging_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_reports" (
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
    "surgery_case_id" UUID,
    "specimen_site" TEXT NOT NULL,
    "macroscopic" TEXT NOT NULL,
    "microscopic" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "icd10" TEXT,

    CONSTRAINT "pa_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "loinc" TEXT,
    "name" TEXT NOT NULL,
    "orderable_id" UUID,
    "specimen_type" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "result_type" TEXT NOT NULL DEFAULT 'numeric',
    "panel_code" TEXT,
    "analyzer_code" TEXT,
    "delta_limit" DECIMAL(14,4),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "lab_test_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_reference_ranges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "test_definition_id" UUID NOT NULL,
    "sex" TEXT NOT NULL DEFAULT 'any',
    "age_min_days" INTEGER NOT NULL DEFAULT 0,
    "age_max_days" INTEGER,
    "ref_low" DECIMAL(14,4),
    "ref_high" DECIMAL(14,4),
    "critical_low" DECIMAL(14,4),
    "critical_high" DECIMAL(14,4),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "lab_reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_analyzers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_id" UUID NOT NULL,
    "registered_device_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "lab_analyzers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_modalities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_id" UUID NOT NULL,
    "slots_per_day" INTEGER NOT NULL DEFAULT 16,
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "radiology_modalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_procedures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "icd9cm" TEXT,
    "name" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "orderable_id" UUID,
    "contrast" BOOLEAN NOT NULL DEFAULT false,
    "template_code" TEXT,
    "template" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "radiology_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulary_stock_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "unit" TEXT NOT NULL,
    "lasa" BOOLEAN NOT NULL DEFAULT false,
    "min_quantity" INTEGER NOT NULL DEFAULT 0,
    "max_quantity" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "formulary_stock_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_checklist_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "surgery_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "diet_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shelf_life_days" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "blood_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_cases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "case_no" TEXT NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'terjadwal',
    "procedure_name" TEXT NOT NULL,
    "procedure_code" TEXT,
    "consent_id" UUID,
    "checklist_template_id" UUID NOT NULL,
    "cancel_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "surgery_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_case_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "surgery_case_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_case_team" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "surgery_case_team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgical_safety_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "checked_by" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgical_safety_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgical_safety_confirmations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "confirmed_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgical_safety_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "override_reason" TEXT,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "surgery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgical_counts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "counted_by" UUID NOT NULL,
    "counted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgical_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_count_discrepancies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "item_code" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgery_count_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operative_reports" (
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
    "surgery_case_id" UUID NOT NULL,
    "pre_op_diagnosis" JSONB NOT NULL,
    "post_op_diagnosis" JSONB NOT NULL,
    "procedure_codes" TEXT[],
    "findings" TEXT NOT NULL,
    "complications" TEXT NOT NULL DEFAULT '',
    "blood_loss_ml" INTEGER NOT NULL,
    "implants" TEXT NOT NULL DEFAULT '',
    "pa_specimen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "operative_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_supply_usages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "stock_movement_id" UUID NOT NULL,
    "implant" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgery_supply_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_orders_tenant_id_unit_id_status_idx" ON "lab_orders"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE INDEX "lab_orders_tenant_id_encounter_id_idx" ON "lab_orders"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_tenant_id_id_key" ON "lab_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_tenant_id_lab_no_key" ON "lab_orders"("tenant_id", "lab_no");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_tenant_id_idempotency_key_key" ON "lab_orders"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "lab_order_items_tenant_id_lab_order_id_idx" ON "lab_order_items"("tenant_id", "lab_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_order_items_tenant_id_id_key" ON "lab_order_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_order_items_tenant_id_service_request_id_key" ON "lab_order_items"("tenant_id", "service_request_id");

-- CreateIndex
CREATE INDEX "lab_order_status_history_tenant_id_lab_order_id_changed_at_idx" ON "lab_order_status_history"("tenant_id", "lab_order_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "lab_order_status_history_tenant_id_id_key" ON "lab_order_status_history"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "specimens_tenant_id_lab_order_id_idx" ON "specimens"("tenant_id", "lab_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "specimens_tenant_id_id_key" ON "specimens"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "specimens_tenant_id_barcode_key" ON "specimens"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "specimen_events_tenant_id_specimen_id_idx" ON "specimen_events"("tenant_id", "specimen_id");

-- CreateIndex
CREATE UNIQUE INDEX "specimen_events_tenant_id_id_key" ON "specimen_events"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "lab_results_tenant_id_lab_order_id_idx" ON "lab_results"("tenant_id", "lab_order_id");

-- CreateIndex
CREATE INDEX "lab_results_tenant_id_patient_id_loinc_idx" ON "lab_results"("tenant_id", "patient_id", "loinc");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_tenant_id_id_key" ON "lab_results"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_tenant_id_root_id_version_key" ON "lab_results"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "lab_validations_tenant_id_id_key" ON "lab_validations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_validations_tenant_id_lab_order_id_level_round_key" ON "lab_validations"("tenant_id", "lab_order_id", "level", "round");

-- CreateIndex
CREATE INDEX "lab_qc_runs_tenant_id_test_definition_id_control_level_run__idx" ON "lab_qc_runs"("tenant_id", "test_definition_id", "control_level", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "lab_qc_runs_tenant_id_id_key" ON "lab_qc_runs"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "critical_results_tenant_id_status_raised_at_idx" ON "critical_results"("tenant_id", "status", "raised_at");

-- CreateIndex
CREATE INDEX "critical_results_tenant_id_encounter_id_idx" ON "critical_results"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "critical_results_tenant_id_id_key" ON "critical_results"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "critical_result_reports_tenant_id_id_key" ON "critical_result_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "critical_result_reports_tenant_id_critical_result_id_key" ON "critical_result_reports"("tenant_id", "critical_result_id");

-- CreateIndex
CREATE UNIQUE INDEX "critical_result_escalations_tenant_id_id_key" ON "critical_result_escalations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "critical_result_escalations_tenant_id_critical_result_id_le_key" ON "critical_result_escalations"("tenant_id", "critical_result_id", "level");

-- CreateIndex
CREATE INDEX "micro_isolates_tenant_id_lab_order_id_idx" ON "micro_isolates"("tenant_id", "lab_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "micro_isolates_tenant_id_id_key" ON "micro_isolates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "micro_susceptibilities_tenant_id_id_key" ON "micro_susceptibilities"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "micro_susceptibilities_tenant_id_isolate_id_antibiotic_code_key" ON "micro_susceptibilities"("tenant_id", "isolate_id", "antibiotic_code");

-- CreateIndex
CREATE INDEX "diet_orders_tenant_id_encounter_id_idx" ON "diet_orders"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "diet_orders_tenant_id_id_key" ON "diet_orders"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "meal_services_tenant_id_diet_order_id_served_at_idx" ON "meal_services"("tenant_id", "diet_order_id", "served_at");

-- CreateIndex
CREATE UNIQUE INDEX "meal_services_tenant_id_id_key" ON "meal_services"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "blood_units_tenant_id_component_id_abo_rh_status_idx" ON "blood_units"("tenant_id", "component_id", "abo", "rh", "status");

-- CreateIndex
CREATE UNIQUE INDEX "blood_units_tenant_id_id_key" ON "blood_units"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_units_tenant_id_bag_no_key" ON "blood_units"("tenant_id", "bag_no");

-- CreateIndex
CREATE INDEX "blood_requests_tenant_id_encounter_id_idx" ON "blood_requests"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_requests_tenant_id_id_key" ON "blood_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_requests_tenant_id_request_no_key" ON "blood_requests"("tenant_id", "request_no");

-- CreateIndex
CREATE INDEX "crossmatches_tenant_id_blood_request_id_blood_unit_id_idx" ON "crossmatches"("tenant_id", "blood_request_id", "blood_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "crossmatches_tenant_id_id_key" ON "crossmatches"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "blood_issues_tenant_id_blood_request_id_idx" ON "blood_issues"("tenant_id", "blood_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_issues_tenant_id_id_key" ON "blood_issues"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_issues_tenant_id_blood_unit_id_key" ON "blood_issues"("tenant_id", "blood_unit_id");

-- CreateIndex
CREATE INDEX "transfusion_reactions_tenant_id_blood_issue_id_idx" ON "transfusion_reactions"("tenant_id", "blood_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfusion_reactions_tenant_id_id_key" ON "transfusion_reactions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "stock_batches_tenant_id_drug_id_expiry_date_idx" ON "stock_batches"("tenant_id", "drug_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_tenant_id_id_key" ON "stock_batches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_tenant_id_drug_id_batch_no_key" ON "stock_batches"("tenant_id", "drug_id", "batch_no");

-- CreateIndex
CREATE INDEX "stock_balances_tenant_id_stock_location_id_drug_id_idx" ON "stock_balances"("tenant_id", "stock_location_id", "drug_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_tenant_id_id_key" ON "stock_balances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_tenant_id_stock_location_id_stock_batch_id_key" ON "stock_balances"("tenant_id", "stock_location_id", "stock_batch_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_stock_location_id_stock_batch_id__idx" ON "stock_movements"("tenant_id", "stock_location_id", "stock_batch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_ref_type_ref_id_idx" ON "stock_movements"("tenant_id", "ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_tenant_id_id_key" ON "stock_movements"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_receipts_tenant_id_id_key" ON "stock_receipts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_receipts_tenant_id_receipt_no_key" ON "stock_receipts"("tenant_id", "receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_id_key" ON "stock_transfers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_transfer_no_key" ON "stock_transfers"("tenant_id", "transfer_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_tenant_id_id_key" ON "stock_adjustments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "pharmacy_prescriptions_tenant_id_stock_location_id_status_idx" ON "pharmacy_prescriptions"("tenant_id", "stock_location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_prescriptions_tenant_id_id_key" ON "pharmacy_prescriptions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_prescriptions_tenant_id_prescription_no_key" ON "pharmacy_prescriptions"("tenant_id", "prescription_no");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_prescriptions_tenant_id_order_group_id_key" ON "pharmacy_prescriptions"("tenant_id", "order_group_id");

-- CreateIndex
CREATE INDEX "pharmacy_prescription_status_history_tenant_id_pharmacy_pre_idx" ON "pharmacy_prescription_status_history"("tenant_id", "pharmacy_prescription_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_prescription_status_history_tenant_id_id_key" ON "pharmacy_prescription_status_history"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "prescription_reviews_tenant_id_pharmacy_prescription_id_idx" ON "prescription_reviews"("tenant_id", "pharmacy_prescription_id");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_reviews_tenant_id_id_key" ON "prescription_reviews"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "pharmacist_interventions_tenant_id_pharmacy_prescription_id_idx" ON "pharmacist_interventions"("tenant_id", "pharmacy_prescription_id");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacist_interventions_tenant_id_id_key" ON "pharmacist_interventions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacist_intervention_responses_tenant_id_id_key" ON "pharmacist_intervention_responses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacist_intervention_responses_tenant_id_intervention_id_key" ON "pharmacist_intervention_responses"("tenant_id", "intervention_id");

-- CreateIndex
CREATE INDEX "dispenses_tenant_id_pharmacy_prescription_id_idx" ON "dispenses"("tenant_id", "pharmacy_prescription_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispenses_tenant_id_id_key" ON "dispenses"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "dispense_items_tenant_id_dispense_id_idx" ON "dispense_items"("tenant_id", "dispense_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispense_items_tenant_id_id_key" ON "dispense_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dispense_items_tenant_id_label_barcode_key" ON "dispense_items"("tenant_id", "label_barcode");

-- CreateIndex
CREATE UNIQUE INDEX "dispense_items_tenant_id_stock_movement_id_key" ON "dispense_items"("tenant_id", "stock_movement_id");

-- CreateIndex
CREATE INDEX "dispense_returns_tenant_id_dispense_item_id_idx" ON "dispense_returns"("tenant_id", "dispense_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispense_returns_tenant_id_id_key" ON "dispense_returns"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "imaging_studies_tenant_id_modality_id_scheduled_at_idx" ON "imaging_studies"("tenant_id", "modality_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "imaging_studies_tenant_id_unit_id_status_idx" ON "imaging_studies"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_studies_tenant_id_id_key" ON "imaging_studies"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_studies_tenant_id_accession_key" ON "imaging_studies"("tenant_id", "accession");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_studies_tenant_id_service_request_id_key" ON "imaging_studies"("tenant_id", "service_request_id");

-- CreateIndex
CREATE INDEX "imaging_study_status_history_tenant_id_imaging_study_id_cha_idx" ON "imaging_study_status_history"("tenant_id", "imaging_study_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_study_status_history_tenant_id_id_key" ON "imaging_study_status_history"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "imaging_reports_tenant_id_imaging_study_id_idx" ON "imaging_reports"("tenant_id", "imaging_study_id");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_reports_tenant_id_id_key" ON "imaging_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_reports_tenant_id_root_id_version_key" ON "imaging_reports"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "pa_reports_tenant_id_encounter_id_idx" ON "pa_reports"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "pa_reports_tenant_id_id_key" ON "pa_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pa_reports_tenant_id_root_id_version_key" ON "pa_reports"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "lab_test_definitions_tenant_id_orderable_id_idx" ON "lab_test_definitions"("tenant_id", "orderable_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_definitions_tenant_id_id_key" ON "lab_test_definitions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_definitions_tenant_id_code_key" ON "lab_test_definitions"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reference_ranges_tenant_id_id_key" ON "lab_reference_ranges"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reference_ranges_tenant_id_test_definition_id_sex_age_m_key" ON "lab_reference_ranges"("tenant_id", "test_definition_id", "sex", "age_min_days");

-- CreateIndex
CREATE UNIQUE INDEX "lab_analyzers_tenant_id_id_key" ON "lab_analyzers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_analyzers_tenant_id_code_key" ON "lab_analyzers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "radiology_modalities_tenant_id_id_key" ON "radiology_modalities"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "radiology_modalities_tenant_id_code_key" ON "radiology_modalities"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "radiology_procedures_tenant_id_id_key" ON "radiology_procedures"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "radiology_procedures_tenant_id_code_key" ON "radiology_procedures"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_tenant_id_id_key" ON "stock_locations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_tenant_id_code_key" ON "stock_locations"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "formulary_stock_profiles_tenant_id_id_key" ON "formulary_stock_profiles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "formulary_stock_profiles_tenant_id_drug_id_stock_location_i_key" ON "formulary_stock_profiles"("tenant_id", "drug_id", "stock_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_id_key" ON "suppliers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_checklist_templates_tenant_id_id_key" ON "surgery_checklist_templates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_checklist_templates_tenant_id_version_key" ON "surgery_checklist_templates"("tenant_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "diet_types_tenant_id_id_key" ON "diet_types"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "diet_types_tenant_id_code_key" ON "diet_types"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "blood_components_tenant_id_id_key" ON "blood_components"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_components_tenant_id_code_key" ON "blood_components"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "surgery_cases_tenant_id_room_id_starts_at_idx" ON "surgery_cases"("tenant_id", "room_id", "starts_at");

-- CreateIndex
CREATE INDEX "surgery_cases_tenant_id_encounter_id_idx" ON "surgery_cases"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_cases_tenant_id_id_key" ON "surgery_cases"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_cases_tenant_id_case_no_key" ON "surgery_cases"("tenant_id", "case_no");

-- CreateIndex
CREATE INDEX "surgery_case_status_history_tenant_id_surgery_case_id_chang_idx" ON "surgery_case_status_history"("tenant_id", "surgery_case_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_case_status_history_tenant_id_id_key" ON "surgery_case_status_history"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "surgery_case_team_tenant_id_surgery_case_id_idx" ON "surgery_case_team"("tenant_id", "surgery_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_case_team_tenant_id_id_key" ON "surgery_case_team"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgical_safety_checks_tenant_id_id_key" ON "surgical_safety_checks"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgical_safety_checks_tenant_id_surgery_case_id_phase_item_key" ON "surgical_safety_checks"("tenant_id", "surgery_case_id", "phase", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "surgical_safety_confirmations_tenant_id_id_key" ON "surgical_safety_confirmations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgical_safety_confirmations_tenant_id_surgery_case_id_pha_key" ON "surgical_safety_confirmations"("tenant_id", "surgery_case_id", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_events_tenant_id_id_key" ON "surgery_events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_events_tenant_id_surgery_case_id_kind_key" ON "surgery_events"("tenant_id", "surgery_case_id", "kind");

-- CreateIndex
CREATE INDEX "surgical_counts_tenant_id_surgery_case_id_item_code_idx" ON "surgical_counts"("tenant_id", "surgery_case_id", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "surgical_counts_tenant_id_id_key" ON "surgical_counts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "surgery_count_discrepancies_tenant_id_surgery_case_id_idx" ON "surgery_count_discrepancies"("tenant_id", "surgery_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_count_discrepancies_tenant_id_id_key" ON "surgery_count_discrepancies"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "operative_reports_tenant_id_surgery_case_id_idx" ON "operative_reports"("tenant_id", "surgery_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "operative_reports_tenant_id_id_key" ON "operative_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "operative_reports_tenant_id_root_id_version_key" ON "operative_reports"("tenant_id", "root_id", "version");

-- CreateIndex
CREATE INDEX "surgery_supply_usages_tenant_id_surgery_case_id_idx" ON "surgery_supply_usages"("tenant_id", "surgery_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_supply_usages_tenant_id_id_key" ON "surgery_supply_usages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_supply_usages_tenant_id_stock_movement_id_key" ON "surgery_supply_usages"("tenant_id", "stock_movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_tenant_id_id_key" ON "inbound_events"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_accepted_by_fkey" FOREIGN KEY ("tenant_id", "accepted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_tenant_id_lab_order_id_fkey" FOREIGN KEY ("tenant_id", "lab_order_id") REFERENCES "lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_tenant_id_service_request_id_fkey" FOREIGN KEY ("tenant_id", "service_request_id") REFERENCES "service_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_status_history" ADD CONSTRAINT "lab_order_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_status_history" ADD CONSTRAINT "lab_order_status_history_tenant_id_lab_order_id_fkey" FOREIGN KEY ("tenant_id", "lab_order_id") REFERENCES "lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specimens" ADD CONSTRAINT "specimens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specimens" ADD CONSTRAINT "specimens_tenant_id_lab_order_id_fkey" FOREIGN KEY ("tenant_id", "lab_order_id") REFERENCES "lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specimens" ADD CONSTRAINT "specimens_tenant_id_collected_by_fkey" FOREIGN KEY ("tenant_id", "collected_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specimens" ADD CONSTRAINT "specimens_tenant_id_received_by_fkey" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specimen_events" ADD CONSTRAINT "specimen_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specimen_events" ADD CONSTRAINT "specimen_events_tenant_id_specimen_id_fkey" FOREIGN KEY ("tenant_id", "specimen_id") REFERENCES "specimens"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specimen_events" ADD CONSTRAINT "specimen_events_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_lab_order_id_fkey" FOREIGN KEY ("tenant_id", "lab_order_id") REFERENCES "lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_test_definition_id_fkey" FOREIGN KEY ("tenant_id", "test_definition_id") REFERENCES "lab_test_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_delta_compared_result_id_fkey" FOREIGN KEY ("tenant_id", "delta_compared_result_id") REFERENCES "lab_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_inbound_event_id_fkey" FOREIGN KEY ("tenant_id", "inbound_event_id") REFERENCES "inbound_events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "lab_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "lab_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_validations" ADD CONSTRAINT "lab_validations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_validations" ADD CONSTRAINT "lab_validations_tenant_id_lab_order_id_fkey" FOREIGN KEY ("tenant_id", "lab_order_id") REFERENCES "lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_validations" ADD CONSTRAINT "lab_validations_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_validations" ADD CONSTRAINT "lab_validations_tenant_id_validated_by_fkey" FOREIGN KEY ("tenant_id", "validated_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_qc_runs" ADD CONSTRAINT "lab_qc_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_qc_runs" ADD CONSTRAINT "lab_qc_runs_tenant_id_analyzer_id_fkey" FOREIGN KEY ("tenant_id", "analyzer_id") REFERENCES "lab_analyzers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_qc_runs" ADD CONSTRAINT "lab_qc_runs_tenant_id_test_definition_id_fkey" FOREIGN KEY ("tenant_id", "test_definition_id") REFERENCES "lab_test_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_qc_runs" ADD CONSTRAINT "lab_qc_runs_tenant_id_run_by_fkey" FOREIGN KEY ("tenant_id", "run_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_tenant_id_lab_result_id_fkey" FOREIGN KEY ("tenant_id", "lab_result_id") REFERENCES "lab_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_tenant_id_imaging_report_id_fkey" FOREIGN KEY ("tenant_id", "imaging_report_id") REFERENCES "imaging_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_result_reports" ADD CONSTRAINT "critical_result_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_result_reports" ADD CONSTRAINT "critical_result_reports_tenant_id_critical_result_id_fkey" FOREIGN KEY ("tenant_id", "critical_result_id") REFERENCES "critical_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_result_reports" ADD CONSTRAINT "critical_result_reports_tenant_id_recipient_user_id_fkey" FOREIGN KEY ("tenant_id", "recipient_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_result_reports" ADD CONSTRAINT "critical_result_reports_tenant_id_reported_by_fkey" FOREIGN KEY ("tenant_id", "reported_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_result_escalations" ADD CONSTRAINT "critical_result_escalations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_result_escalations" ADD CONSTRAINT "critical_result_escalations_tenant_id_critical_result_id_fkey" FOREIGN KEY ("tenant_id", "critical_result_id") REFERENCES "critical_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_isolates" ADD CONSTRAINT "micro_isolates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_isolates" ADD CONSTRAINT "micro_isolates_tenant_id_lab_order_id_fkey" FOREIGN KEY ("tenant_id", "lab_order_id") REFERENCES "lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_isolates" ADD CONSTRAINT "micro_isolates_tenant_id_recorded_by_fkey" FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_susceptibilities" ADD CONSTRAINT "micro_susceptibilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_susceptibilities" ADD CONSTRAINT "micro_susceptibilities_tenant_id_isolate_id_fkey" FOREIGN KEY ("tenant_id", "isolate_id") REFERENCES "micro_isolates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_tenant_id_diet_type_id_fkey" FOREIGN KEY ("tenant_id", "diet_type_id") REFERENCES "diet_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_tenant_id_ordered_by_fkey" FOREIGN KEY ("tenant_id", "ordered_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_services" ADD CONSTRAINT "meal_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_services" ADD CONSTRAINT "meal_services_tenant_id_diet_order_id_fkey" FOREIGN KEY ("tenant_id", "diet_order_id") REFERENCES "diet_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_services" ADD CONSTRAINT "meal_services_tenant_id_recorded_by_fkey" FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_units" ADD CONSTRAINT "blood_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_units" ADD CONSTRAINT "blood_units_tenant_id_component_id_fkey" FOREIGN KEY ("tenant_id", "component_id") REFERENCES "blood_components"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_tenant_id_component_id_fkey" FOREIGN KEY ("tenant_id", "component_id") REFERENCES "blood_components"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_tenant_id_requested_by_fkey" FOREIGN KEY ("tenant_id", "requested_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossmatches" ADD CONSTRAINT "crossmatches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossmatches" ADD CONSTRAINT "crossmatches_tenant_id_blood_request_id_fkey" FOREIGN KEY ("tenant_id", "blood_request_id") REFERENCES "blood_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossmatches" ADD CONSTRAINT "crossmatches_tenant_id_blood_unit_id_fkey" FOREIGN KEY ("tenant_id", "blood_unit_id") REFERENCES "blood_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossmatches" ADD CONSTRAINT "crossmatches_tenant_id_tested_by_fkey" FOREIGN KEY ("tenant_id", "tested_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_tenant_id_blood_request_id_fkey" FOREIGN KEY ("tenant_id", "blood_request_id") REFERENCES "blood_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_tenant_id_blood_unit_id_fkey" FOREIGN KEY ("tenant_id", "blood_unit_id") REFERENCES "blood_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_tenant_id_issued_by_fkey" FOREIGN KEY ("tenant_id", "issued_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_reactions" ADD CONSTRAINT "transfusion_reactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_reactions" ADD CONSTRAINT "transfusion_reactions_tenant_id_blood_issue_id_fkey" FOREIGN KEY ("tenant_id", "blood_issue_id") REFERENCES "blood_issues"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_reactions" ADD CONSTRAINT "transfusion_reactions_tenant_id_reported_by_fkey" FOREIGN KEY ("tenant_id", "reported_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drugs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_stock_batch_id_fkey" FOREIGN KEY ("tenant_id", "stock_batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drugs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_stock_batch_id_fkey" FOREIGN KEY ("tenant_id", "stock_batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_tenant_id_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_tenant_id_received_by_fkey" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_from_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "from_stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_to_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "to_stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_sent_by_fkey" FOREIGN KEY ("tenant_id", "sent_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_received_by_fkey" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_adjusted_by_fkey" FOREIGN KEY ("tenant_id", "adjusted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescriptions" ADD CONSTRAINT "pharmacy_prescriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescriptions" ADD CONSTRAINT "pharmacy_prescriptions_tenant_id_order_group_id_fkey" FOREIGN KEY ("tenant_id", "order_group_id") REFERENCES "order_groups"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescriptions" ADD CONSTRAINT "pharmacy_prescriptions_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescriptions" ADD CONSTRAINT "pharmacy_prescriptions_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescriptions" ADD CONSTRAINT "pharmacy_prescriptions_tenant_id_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescriptions" ADD CONSTRAINT "pharmacy_prescriptions_tenant_id_accepted_by_fkey" FOREIGN KEY ("tenant_id", "accepted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescription_status_history" ADD CONSTRAINT "pharmacy_prescription_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prescription_status_history" ADD CONSTRAINT "pharmacy_prescription_status_history_tenant_id_pharmacy_pr_fkey" FOREIGN KEY ("tenant_id", "pharmacy_prescription_id") REFERENCES "pharmacy_prescriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_reviews" ADD CONSTRAINT "prescription_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_reviews" ADD CONSTRAINT "prescription_reviews_tenant_id_pharmacy_prescription_id_fkey" FOREIGN KEY ("tenant_id", "pharmacy_prescription_id") REFERENCES "pharmacy_prescriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_reviews" ADD CONSTRAINT "prescription_reviews_tenant_id_reviewed_by_fkey" FOREIGN KEY ("tenant_id", "reviewed_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_interventions" ADD CONSTRAINT "pharmacist_interventions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_interventions" ADD CONSTRAINT "pharmacist_interventions_tenant_id_pharmacy_prescription_i_fkey" FOREIGN KEY ("tenant_id", "pharmacy_prescription_id") REFERENCES "pharmacy_prescriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_interventions" ADD CONSTRAINT "pharmacist_interventions_tenant_id_prescriber_user_id_fkey" FOREIGN KEY ("tenant_id", "prescriber_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_interventions" ADD CONSTRAINT "pharmacist_interventions_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_intervention_responses" ADD CONSTRAINT "pharmacist_intervention_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_intervention_responses" ADD CONSTRAINT "pharmacist_intervention_responses_tenant_id_intervention_i_fkey" FOREIGN KEY ("tenant_id", "intervention_id") REFERENCES "pharmacist_interventions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_intervention_responses" ADD CONSTRAINT "pharmacist_intervention_responses_tenant_id_responded_by_fkey" FOREIGN KEY ("tenant_id", "responded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tenant_id_pharmacy_prescription_id_fkey" FOREIGN KEY ("tenant_id", "pharmacy_prescription_id") REFERENCES "pharmacy_prescriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tenant_id_prepared_by_fkey" FOREIGN KEY ("tenant_id", "prepared_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tenant_id_double_checked_by_fkey" FOREIGN KEY ("tenant_id", "double_checked_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tenant_id_handed_over_by_fkey" FOREIGN KEY ("tenant_id", "handed_over_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_items" ADD CONSTRAINT "dispense_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_items" ADD CONSTRAINT "dispense_items_tenant_id_dispense_id_fkey" FOREIGN KEY ("tenant_id", "dispense_id") REFERENCES "dispenses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_items" ADD CONSTRAINT "dispense_items_tenant_id_medication_request_id_fkey" FOREIGN KEY ("tenant_id", "medication_request_id") REFERENCES "medication_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_items" ADD CONSTRAINT "dispense_items_tenant_id_stock_batch_id_fkey" FOREIGN KEY ("tenant_id", "stock_batch_id") REFERENCES "stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_items" ADD CONSTRAINT "dispense_items_tenant_id_stock_movement_id_fkey" FOREIGN KEY ("tenant_id", "stock_movement_id") REFERENCES "stock_movements"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_returns" ADD CONSTRAINT "dispense_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_returns" ADD CONSTRAINT "dispense_returns_tenant_id_dispense_item_id_fkey" FOREIGN KEY ("tenant_id", "dispense_item_id") REFERENCES "dispense_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_returns" ADD CONSTRAINT "dispense_returns_tenant_id_stock_movement_id_fkey" FOREIGN KEY ("tenant_id", "stock_movement_id") REFERENCES "stock_movements"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_returns" ADD CONSTRAINT "dispense_returns_tenant_id_returned_by_fkey" FOREIGN KEY ("tenant_id", "returned_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_service_request_id_fkey" FOREIGN KEY ("tenant_id", "service_request_id") REFERENCES "service_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_modality_id_fkey" FOREIGN KEY ("tenant_id", "modality_id") REFERENCES "radiology_modalities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_procedure_id_fkey" FOREIGN KEY ("tenant_id", "procedure_id") REFERENCES "radiology_procedures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_identity_confirmed_by_fkey" FOREIGN KEY ("tenant_id", "identity_confirmed_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_override_by_fkey" FOREIGN KEY ("tenant_id", "override_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_tenant_id_accepted_by_fkey" FOREIGN KEY ("tenant_id", "accepted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_study_status_history" ADD CONSTRAINT "imaging_study_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_study_status_history" ADD CONSTRAINT "imaging_study_status_history_tenant_id_imaging_study_id_fkey" FOREIGN KEY ("tenant_id", "imaging_study_id") REFERENCES "imaging_studies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_tenant_id_imaging_study_id_fkey" FOREIGN KEY ("tenant_id", "imaging_study_id") REFERENCES "imaging_studies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "imaging_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "imaging_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "pa_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "pa_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_definitions" ADD CONSTRAINT "lab_test_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_definitions" ADD CONSTRAINT "lab_test_definitions_tenant_id_orderable_id_fkey" FOREIGN KEY ("tenant_id", "orderable_id") REFERENCES "orderables"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reference_ranges" ADD CONSTRAINT "lab_reference_ranges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reference_ranges" ADD CONSTRAINT "lab_reference_ranges_tenant_id_test_definition_id_fkey" FOREIGN KEY ("tenant_id", "test_definition_id") REFERENCES "lab_test_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_analyzers" ADD CONSTRAINT "lab_analyzers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_analyzers" ADD CONSTRAINT "lab_analyzers_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_analyzers" ADD CONSTRAINT "lab_analyzers_tenant_id_registered_device_id_fkey" FOREIGN KEY ("tenant_id", "registered_device_id") REFERENCES "registered_devices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_modalities" ADD CONSTRAINT "radiology_modalities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_modalities" ADD CONSTRAINT "radiology_modalities_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_procedures" ADD CONSTRAINT "radiology_procedures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_procedures" ADD CONSTRAINT "radiology_procedures_tenant_id_orderable_id_fkey" FOREIGN KEY ("tenant_id", "orderable_id") REFERENCES "orderables"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulary_stock_profiles" ADD CONSTRAINT "formulary_stock_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulary_stock_profiles" ADD CONSTRAINT "formulary_stock_profiles_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drugs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulary_stock_profiles" ADD CONSTRAINT "formulary_stock_profiles_tenant_id_stock_location_id_fkey" FOREIGN KEY ("tenant_id", "stock_location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_checklist_templates" ADD CONSTRAINT "surgery_checklist_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_types" ADD CONSTRAINT "diet_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_components" ADD CONSTRAINT "blood_components_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_tenant_id_consent_id_fkey" FOREIGN KEY ("tenant_id", "consent_id") REFERENCES "consents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_tenant_id_checklist_template_id_fkey" FOREIGN KEY ("tenant_id", "checklist_template_id") REFERENCES "surgery_checklist_templates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_case_status_history" ADD CONSTRAINT "surgery_case_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_case_status_history" ADD CONSTRAINT "surgery_case_status_history_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_case_team" ADD CONSTRAINT "surgery_case_team_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_case_team" ADD CONSTRAINT "surgery_case_team_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_case_team" ADD CONSTRAINT "surgery_case_team_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_safety_checks" ADD CONSTRAINT "surgical_safety_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_safety_checks" ADD CONSTRAINT "surgical_safety_checks_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_safety_checks" ADD CONSTRAINT "surgical_safety_checks_tenant_id_checked_by_fkey" FOREIGN KEY ("tenant_id", "checked_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_safety_confirmations" ADD CONSTRAINT "surgical_safety_confirmations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_safety_confirmations" ADD CONSTRAINT "surgical_safety_confirmations_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_safety_confirmations" ADD CONSTRAINT "surgical_safety_confirmations_tenant_id_confirmed_by_fkey" FOREIGN KEY ("tenant_id", "confirmed_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_events" ADD CONSTRAINT "surgery_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_events" ADD CONSTRAINT "surgery_events_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_events" ADD CONSTRAINT "surgery_events_tenant_id_recorded_by_fkey" FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_counts" ADD CONSTRAINT "surgical_counts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_counts" ADD CONSTRAINT "surgical_counts_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_counts" ADD CONSTRAINT "surgical_counts_tenant_id_counted_by_fkey" FOREIGN KEY ("tenant_id", "counted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_count_discrepancies" ADD CONSTRAINT "surgery_count_discrepancies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_count_discrepancies" ADD CONSTRAINT "surgery_count_discrepancies_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_count_discrepancies" ADD CONSTRAINT "surgery_count_discrepancies_tenant_id_recorded_by_fkey" FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operative_reports" ADD CONSTRAINT "operative_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operative_reports" ADD CONSTRAINT "operative_reports_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operative_reports" ADD CONSTRAINT "operative_reports_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operative_reports" ADD CONSTRAINT "operative_reports_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operative_reports" ADD CONSTRAINT "operative_reports_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operative_reports" ADD CONSTRAINT "operative_reports_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "operative_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operative_reports" ADD CONSTRAINT "operative_reports_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "operative_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_supply_usages" ADD CONSTRAINT "surgery_supply_usages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_supply_usages" ADD CONSTRAINT "surgery_supply_usages_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_supply_usages" ADD CONSTRAINT "surgery_supply_usages_tenant_id_stock_movement_id_fkey" FOREIGN KEY ("tenant_id", "stock_movement_id") REFERENCES "stock_movements"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_supply_usages" ADD CONSTRAINT "surgery_supply_usages_tenant_id_recorded_by_fkey" FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Manual · fase 4 (4.0b): batasan nilai, entri klinis berversi, append-only, saldo stok lewat ledger, gerbang
-- keselamatan (nilai kritis, dosis CT, cek ganda, daftar tilik WHO, insisi, hitung kasa, darah), RLS, hak akses.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- Nilai baku (token sama dengan kontrak `@simrs/shared` penunjang-api / kamar-operasi)
-- ---------------------------------------------------------------------
ALTER TABLE "lab_test_definitions" ADD CONSTRAINT lab_test_definitions_values_valid CHECK (
  result_type IN ('numeric', 'text') AND decimals BETWEEN 0 AND 3
  AND (loinc IS NULL OR loinc ~ '^\d{1,7}-\d$') AND (delta_limit IS NULL OR delta_limit > 0));
ALTER TABLE "lab_reference_ranges" ADD CONSTRAINT lab_reference_ranges_values_valid CHECK (
  sex IN ('male', 'female', 'any') AND age_min_days >= 0
  AND (age_max_days IS NULL OR age_max_days > age_min_days)
  AND (ref_low IS NULL OR ref_high IS NULL OR ref_low <= ref_high)
  AND (critical_low IS NULL OR critical_high IS NULL OR critical_low < critical_high));
ALTER TABLE "radiology_modalities" ADD CONSTRAINT radiology_modalities_values_valid CHECK (
  modality IN ('CT', 'DR', 'USG', 'MRI', 'ANGIO') AND slots_per_day BETWEEN 1 AND 200
  AND slot_minutes BETWEEN 5 AND 240);
ALTER TABLE "radiology_procedures" ADD CONSTRAINT radiology_procedures_values_valid CHECK (
  modality IN ('CT', 'DR', 'USG', 'MRI', 'ANGIO') AND (icd9cm IS NULL OR icd9cm ~ '^\d{2}(\.\d{1,2})?$'));
ALTER TABLE "stock_locations" ADD CONSTRAINT stock_locations_kind_valid CHECK (kind IN ('depo', 'gudang', 'ruang', 'ok'));
ALTER TABLE "formulary_stock_profiles" ADD CONSTRAINT formulary_stock_profiles_values_valid CHECK (
  min_quantity >= 0 AND (max_quantity IS NULL OR max_quantity >= min_quantity));
ALTER TABLE "surgery_checklist_templates" ADD CONSTRAINT surgery_checklist_templates_values_valid CHECK (
  version >= 1 AND jsonb_typeof(items) = 'object'
  AND jsonb_typeof(items->'sign-in') = 'array' AND jsonb_typeof(items->'time-out') = 'array'
  AND jsonb_typeof(items->'sign-out') = 'array');
ALTER TABLE "blood_components" ADD CONSTRAINT blood_components_values_valid CHECK (shelf_life_days BETWEEN 1 AND 3650);

ALTER TABLE "lab_orders" ADD CONSTRAINT lab_orders_values_valid CHECK (
  lab_no ~ '^L\d{10}$' AND priority IN ('cito', 'rutin')
  AND status IN ('diterima', 'sampel', 'proses', 'hasil', 'validasi_teknis', 'selesai', 'batal'));
ALTER TABLE "lab_order_items" ADD CONSTRAINT lab_order_items_void_consistent CHECK (
  (voided_at IS NULL) = (void_reason IS NULL)
  AND (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 10 AND 500));
ALTER TABLE "specimens" ADD CONSTRAINT specimens_values_valid CHECK (
  status IN ('menunggu', 'diambil', 'diterima', 'ditolak')
  AND (status <> 'ditolak' OR rejected_reason IS NOT NULL)
  AND (rejected_reason IS NULL OR rejected_reason IN
       ('hemolisis', 'volume_kurang', 'label_tidak_sesuai', 'beku', 'wadah_salah', 'terlambat', 'lainnya')));
ALTER TABLE "specimen_events" ADD CONSTRAINT specimen_events_kind_valid CHECK (kind IN ('diambil', 'diterima', 'ditolak'));
ALTER TABLE "lab_results" ADD CONSTRAINT lab_results_values_valid CHECK (
  (value_numeric IS NULL) <> (value_text IS NULL)
  AND flag IN ('N', 'H', 'L', 'KRITIS') AND source IN ('manual', 'analyzer')
  AND decimals BETWEEN 0 AND 3 AND (loinc IS NULL OR loinc ~ '^\d{1,7}-\d$')
  AND (source = 'analyzer') = (inbound_event_id IS NOT NULL));
ALTER TABLE "lab_validations" ADD CONSTRAINT lab_validations_values_valid CHECK (
  level IN ('teknis', 'klinis') AND round >= 1 AND snapshot_hash ~ '^[0-9a-f]{64}$'
  AND (qc_override_reason IS NULL OR char_length(btrim(qc_override_reason)) BETWEEN 10 AND 500)
  AND (level = 'klinis' OR document_id IS NULL));
ALTER TABLE "lab_qc_runs" ADD CONSTRAINT lab_qc_runs_values_valid CHECK (
  control_level BETWEEN 1 AND 3 AND sd > 0 AND outcome IN ('ok', 'warn', 'reject')
  AND violations <@ ARRAY['1-2s', '1-3s', '2-2s', 'R-4s', '4-1s', '10x']::text[]);
ALTER TABLE "critical_results" ADD CONSTRAINT critical_results_values_valid CHECK (
  source IN ('lab', 'radiology') AND status IN ('terbuka', 'dilaporkan') AND limit_minutes BETWEEN 1 AND 1440
  AND ((source = 'lab') = (lab_result_id IS NOT NULL))
  AND ((source = 'radiology') = (imaging_report_id IS NOT NULL)));
-- Keputusan fase 4 no. 8: penerima = staf terpilih ATAU nama ≥ 5 + peran; read-back wajib.
ALTER TABLE "critical_result_reports" ADD CONSTRAINT critical_result_reports_recipient_required CHECK (
  recipient_user_id IS NOT NULL
  OR (char_length(btrim(coalesce(recipient_name, ''))) >= 5 AND char_length(btrim(coalesce(recipient_role, ''))) >= 3));
ALTER TABLE "critical_result_reports" ADD CONSTRAINT critical_result_reports_read_back_required CHECK (
  read_back_confirmed = true AND char_length(btrim(read_back_text)) BETWEEN 3 AND 500);
ALTER TABLE "critical_result_reports" ADD CONSTRAINT critical_result_reports_channel_valid CHECK (
  channel IN ('telepon', 'langsung') AND minutes_to_report >= 0);
ALTER TABLE "critical_result_escalations" ADD CONSTRAINT critical_result_escalations_level_valid CHECK (level BETWEEN 1 AND 3);
ALTER TABLE "micro_isolates" ADD CONSTRAINT micro_isolates_stage_valid CHECK (stage IN ('awal', 'akhir'));
ALTER TABLE "micro_susceptibilities" ADD CONSTRAINT micro_susceptibilities_values_valid CHECK (
  result IN ('S', 'I', 'R') AND (mic_value IS NULL OR mic_value > 0));

ALTER TABLE "imaging_studies" ADD CONSTRAINT imaging_studies_values_valid CHECK (
  accession ~ '^RAD-\d{4}-\d{4}$' AND modality IN ('CT', 'DR', 'USG', 'MRI', 'ANGIO')
  AND status IN ('terjadwal', 'berlangsung', 'selesai', 'ditandatangani', 'batal')
  AND (override_reason IS NULL OR char_length(btrim(override_reason)) BETWEEN 10 AND 500)
  AND (override_reason IS NULL) = (override_by IS NULL)
  AND (status IN ('terjadwal', 'batal') OR identity_confirmed_by IS NOT NULL)
  AND (ctdi_vol IS NULL OR ctdi_vol BETWEEN 0.01 AND 200) AND (dlp IS NULL OR dlp BETWEEN 0.01 AND 5000));
-- Keputusan fase 4 §4.4: CT tidak bisa selesai tanpa CTDIvol + DLP.
ALTER TABLE "imaging_studies" ADD CONSTRAINT imaging_studies_ct_dose_required CHECK (
  modality <> 'CT' OR status NOT IN ('selesai', 'ditandatangani') OR (ctdi_vol IS NOT NULL AND dlp IS NOT NULL));
ALTER TABLE "pa_reports" ADD CONSTRAINT pa_reports_icd10_valid CHECK (icd10 IS NULL OR icd10 ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$');

ALTER TABLE "stock_batches" ADD CONSTRAINT stock_batches_values_valid CHECK (unit_cost >= 0 AND char_length(btrim(batch_no)) >= 1);
ALTER TABLE "stock_balances" ADD CONSTRAINT stock_balances_quantity_nonnegative CHECK (quantity >= 0);
-- Tanda qty per jenis: masuk positif, keluar negatif, penyesuaian tidak nol.
ALTER TABLE "stock_movements" ADD CONSTRAINT stock_movements_values_valid CHECK (
  kind IN ('receipt', 'transfer_out', 'transfer_in', 'dispense', 'return', 'adjustment', 'usage', 'write_off')
  AND quantity <> 0
  AND (kind NOT IN ('receipt', 'transfer_in', 'return') OR quantity > 0)
  AND (kind NOT IN ('transfer_out', 'dispense', 'usage', 'write_off') OR quantity < 0)
  AND (kind NOT IN ('adjustment', 'write_off') OR char_length(btrim(coalesce(reason, ''))) BETWEEN 10 AND 500)
  AND (kind NOT IN ('dispense', 'usage') OR patient_id IS NOT NULL));
ALTER TABLE "stock_receipts" ADD CONSTRAINT stock_receipts_no_valid CHECK (receipt_no ~ '^TRM-\d{4}-\d{4}$');
ALTER TABLE "stock_transfers" ADD CONSTRAINT stock_transfers_values_valid CHECK (
  transfer_no ~ '^MUT-\d{4}-\d{4}$' AND from_stock_location_id <> to_stock_location_id
  AND status IN ('dikirim', 'diterima') AND (status = 'diterima') = (received_at IS NOT NULL)
  AND (received_at IS NULL) = (received_by IS NULL) AND jsonb_typeof(items) = 'array');
ALTER TABLE "stock_adjustments" ADD CONSTRAINT stock_adjustments_reason_valid CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500);
ALTER TABLE "pharmacy_prescriptions" ADD CONSTRAINT pharmacy_prescriptions_values_valid CHECK (
  prescription_no ~ '^R-\d{4}-\d{4}$' AND setting IN ('rawat_jalan', 'rawat_inap', 'igd', 'ok')
  AND status IN ('telaah', 'ditahan', 'penyiapan', 'serah', 'selesai', 'batal'));
ALTER TABLE "prescription_reviews" ADD CONSTRAINT prescription_reviews_values_valid CHECK (
  decision IN ('setujui', 'tahan', 'sebagian')
  AND (decision = 'setujui' OR char_length(btrim(coalesce(reason, ''))) BETWEEN 10 AND 500)
  AND (decision <> 'setujui' OR (administratif AND farmasetik AND klinis))
  AND (decision <> 'sebagian' OR cardinality(medication_request_ids) > 0));
ALTER TABLE "pharmacist_interventions" ADD CONSTRAINT pharmacist_interventions_values_valid CHECK (
  kind IN ('ganti_obat', 'ubah_dosis', 'hentikan', 'tambah', 'lainnya')
  AND cardinality(medication_request_ids) > 0 AND char_length(btrim(recommendation)) BETWEEN 10 AND 1000);
ALTER TABLE "pharmacist_intervention_responses" ADD CONSTRAINT pharmacist_intervention_responses_valid CHECK (
  response IN ('diterima', 'ditolak', 'diubah'));
-- Keputusan fase 4 no. 12: cek ganda oleh apoteker LAIN; serah obat kewaspadaan tinggi butuh cek ganda.
ALTER TABLE "dispenses" ADD CONSTRAINT dispenses_double_check_other_user CHECK (double_checked_by <> prepared_by);
ALTER TABLE "dispenses" ADD CONSTRAINT dispenses_values_valid CHECK (
  (double_checked_by IS NULL) = (double_checked_at IS NULL)
  AND (handed_over_at IS NULL) = (handed_over_by IS NULL)
  AND (handed_over_at IS NULL OR (receiver_kind IN ('pasien', 'keluarga', 'perawat')
       AND char_length(btrim(coalesce(receiver_name, ''))) >= 3 AND counseling_given))
  AND (handed_over_at IS NULL OR NOT has_high_alert OR double_checked_by IS NOT NULL));
ALTER TABLE "dispense_items" ADD CONSTRAINT dispense_items_values_valid CHECK (
  quantity > 0 AND (fefo_override_reason IS NULL OR char_length(btrim(fefo_override_reason)) BETWEEN 10 AND 500));
ALTER TABLE "dispense_returns" ADD CONSTRAINT dispense_returns_values_valid CHECK (
  quantity > 0 AND condition IN ('layak', 'tidak_layak') AND char_length(btrim(reason)) BETWEEN 10 AND 500
  AND (condition = 'layak') = (stock_movement_id IS NOT NULL));

ALTER TABLE "surgery_cases" ADD CONSTRAINT surgery_cases_values_valid CHECK (
  case_no ~ '^OK-\d{4}-\d{4}$' AND ends_at > starts_at AND priority IN ('elektif', 'cito')
  AND status IN ('terjadwal', 'persiapan', 'berjalan', 'selesai', 'batal')
  AND (status <> 'batal' OR char_length(btrim(coalesce(cancel_reason, ''))) BETWEEN 10 AND 500)
  AND (procedure_code IS NULL OR procedure_code ~ '^\d{2}(\.\d{1,2})?$'));
-- Keputusan fase 4 no. 13: kasus aktif tidak tumpang tindih per kamar.
ALTER TABLE "surgery_cases" ADD CONSTRAINT surgery_cases_no_room_overlap EXCLUDE USING gist (
  tenant_id WITH =, room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status <> 'batal');
ALTER TABLE "surgery_case_team" ADD CONSTRAINT surgery_case_team_role_valid CHECK (role IN
  ('operator', 'asisten', 'anestesi', 'penata_anestesi', 'perawat_instrumen', 'perawat_sirkuler'));
ALTER TABLE "surgical_safety_checks" ADD CONSTRAINT surgical_safety_checks_values_valid CHECK (
  phase IN ('sign-in', 'time-out', 'sign-out') AND source IN ('manual', 'system'));
ALTER TABLE "surgical_safety_confirmations" ADD CONSTRAINT surgical_safety_confirmations_phase_valid CHECK (
  phase IN ('sign-in', 'time-out', 'sign-out'));
ALTER TABLE "surgery_events" ADD CONSTRAINT surgery_events_values_valid CHECK (
  kind IN ('induksi', 'insisi', 'tutup', 'keluar')
  AND (override_reason IS NULL OR (kind = 'insisi' AND char_length(btrim(override_reason)) BETWEEN 15 AND 500)));
ALTER TABLE "surgical_counts" ADD CONSTRAINT surgical_counts_values_valid CHECK (
  kind IN ('awal', 'tambahan', 'akhir') AND quantity BETWEEN 0 AND 1000);
ALTER TABLE "surgery_count_discrepancies" ADD CONSTRAINT surgery_count_discrepancies_action_valid CHECK (
  char_length(btrim(action)) BETWEEN 10 AND 1000);
ALTER TABLE "operative_reports" ADD CONSTRAINT operative_reports_values_valid CHECK (
  cardinality(procedure_codes) BETWEEN 1 AND 10 AND blood_loss_ml BETWEEN 0 AND 20000
  AND jsonb_typeof(pre_op_diagnosis) = 'object' AND jsonb_typeof(post_op_diagnosis) = 'object');

ALTER TABLE "diet_orders" ADD CONSTRAINT diet_orders_values_valid CHECK (
  texture IN ('biasa', 'lunak', 'saring', 'cair', 'sonde') AND status IN ('aktif', 'selesai')
  AND (status = 'selesai') = (ended_at IS NOT NULL));
ALTER TABLE "meal_services" ADD CONSTRAINT meal_services_values_valid CHECK (
  meal IN ('pagi', 'selingan_pagi', 'siang', 'selingan_sore', 'malam')
  AND (leftover IS NULL OR leftover IN ('habis', 'sisa_seperempat', 'sisa_setengah', 'utuh')));
ALTER TABLE "blood_units" ADD CONSTRAINT blood_units_values_valid CHECK (
  abo IN ('A', 'B', 'AB', 'O') AND rh IN ('pos', 'neg') AND expires_at > collected_at
  AND status IN ('tersedia', 'dicadangkan', 'dikeluarkan', 'kedaluwarsa', 'dimusnahkan'));
ALTER TABLE "blood_requests" ADD CONSTRAINT blood_requests_values_valid CHECK (
  request_no ~ '^BD-\d{4}-\d{4}$' AND units BETWEEN 1 AND 20 AND urgency IN ('rutin', 'cito', 'darurat')
  AND status IN ('diminta', 'diproses', 'selesai', 'batal')
  AND (patient_abo IS NULL OR patient_abo IN ('A', 'B', 'AB', 'O'))
  AND (patient_rh IS NULL OR patient_rh IN ('pos', 'neg')));
ALTER TABLE "crossmatches" ADD CONSTRAINT crossmatches_result_valid CHECK (result IN ('cocok', 'tidak_cocok'));
ALTER TABLE "blood_issues" ADD CONSTRAINT blood_issues_emergency_reason_valid CHECK (
  emergency_reason IS NULL OR char_length(btrim(emergency_reason)) BETWEEN 10 AND 500);
ALTER TABLE "transfusion_reactions" ADD CONSTRAINT transfusion_reactions_values_valid CHECK (
  severity IN ('ringan', 'sedang', 'berat') AND char_length(btrim(description)) BETWEEN 10 AND 2000);

-- Satu nilai kritis per hasil lab / per ekspertise.
CREATE UNIQUE INDEX critical_results_one_per_lab_result ON "critical_results" (tenant_id, lab_result_id)
  WHERE lab_result_id IS NOT NULL;
CREATE UNIQUE INDEX critical_results_one_per_imaging_report ON "critical_results" (tenant_id, imaging_report_id)
  WHERE imaging_report_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Entri klinis berversi (pola fase 3 ADR-0028): hasil lab, ekspertise radiologi, laporan PA, laporan operasi.
-- ---------------------------------------------------------------------
DO $do$
DECLARE
  t text;
  versioned CONSTANT text[] := ARRAY['lab_results', 'imaging_reports', 'pa_reports', 'operative_reports'];
BEGIN
  FOREACH t IN ARRAY versioned LOOP
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
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app_clinical_guard()',
      t || '_clinical_guard', t);
    EXECUTE format(
      'CREATE VIEW %I WITH (security_invoker = true) AS SELECT r.* FROM %I r WHERE NOT EXISTS ('
      || 'SELECT 1 FROM %I n WHERE n.tenant_id = r.tenant_id AND n.supersedes_id = r.id)',
      t || '_current', t, t);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- Append-only (ADR-0004): juga berlaku bagi pemilik tabel.
-- ---------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'surgery_checklist_templates', 'lab_order_status_history', 'specimen_events', 'lab_results', 'lab_validations',
    'lab_qc_runs', 'critical_result_reports', 'critical_result_escalations', 'micro_isolates',
    'micro_susceptibilities', 'imaging_study_status_history', 'imaging_reports', 'pa_reports', 'stock_batches',
    'stock_movements', 'stock_receipts', 'stock_adjustments', 'pharmacy_prescription_status_history',
    'prescription_reviews', 'pharmacist_interventions', 'pharmacist_intervention_responses', 'dispense_items',
    'dispense_returns', 'surgery_case_status_history', 'surgical_safety_checks', 'surgical_safety_confirmations',
    'surgery_events', 'surgical_counts', 'surgery_count_discrepancies', 'operative_reports', 'surgery_supply_usages',
    'meal_services', 'crossmatches', 'blood_issues', 'transfusion_reactions'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()',
      t || '_append_only', t);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- Waktu server untuk jejak append-only (klien tidak menentukan waktu catat).
-- ---------------------------------------------------------------------
CREATE FUNCTION app_support_server_time() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  col text := TG_ARGV[0];
BEGIN
  NEW := jsonb_populate_record(NEW, jsonb_build_object(col, statement_timestamp()));
  RETURN NEW;
END $fn$;
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('lab_order_status_history', 'changed_at'), ('specimen_events', 'occurred_at'),
    ('lab_validations', 'validated_at'), ('lab_qc_runs', 'run_at'),
    ('critical_result_escalations', 'escalated_at'), ('micro_isolates', 'recorded_at'),
    ('micro_susceptibilities', 'recorded_at'), ('imaging_study_status_history', 'changed_at'),
    ('stock_receipts', 'received_at'), ('stock_adjustments', 'adjusted_at'),
    ('pharmacy_prescription_status_history', 'changed_at'), ('prescription_reviews', 'reviewed_at'),
    ('pharmacist_interventions', 'created_at'), ('pharmacist_intervention_responses', 'responded_at'),
    ('dispense_returns', 'returned_at'), ('surgery_case_status_history', 'changed_at'),
    ('surgical_safety_checks', 'checked_at'), ('surgical_safety_confirmations', 'confirmed_at'),
    ('surgical_counts', 'counted_at'), ('surgery_count_discrepancies', 'recorded_at'),
    ('surgery_supply_usages', 'recorded_at'), ('meal_services', 'recorded_at'), ('crossmatches', 'tested_at'),
    ('blood_issues', 'issued_at'), ('transfusion_reactions', 'reported_at')) AS v(t, c) LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app_support_server_time(%L)',
      r.t || '_server_time', r.t, r.c);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- S05 · Ledger stok → saldo (keputusan fase 4 no. 9). Saldo HANYA diubah di sini (role aplikasi hanya SELECT);
-- kunci baris saldo per lokasi × batch menyerialkan transaksi serentak sehingga stok tidak pernah negatif.
-- Batch kedaluwarsa (ED ≤ hari ini WIB) tidak boleh keluar ke pasien.
-- ---------------------------------------------------------------------
CREATE FUNCTION app_stock_apply_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  b record;
  q integer;
BEGIN
  NEW.created_at := statement_timestamp();
  SELECT drug_id, expiry_date INTO b FROM stock_batches WHERE tenant_id = NEW.tenant_id AND id = NEW.stock_batch_id;
  IF b.drug_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: batch stok tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind IN ('dispense', 'usage')
     AND b.expiry_date <= (statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'BATCH_EXPIRED: batch kedaluwarsa tidak boleh dikeluarkan ke pasien' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO stock_balances (id, tenant_id, stock_location_id, stock_batch_id, drug_id, quantity, updated_at)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.stock_location_id, NEW.stock_batch_id, b.drug_id, 0, NEW.created_at)
    ON CONFLICT (tenant_id, stock_location_id, stock_batch_id) DO NOTHING;
  UPDATE stock_balances SET quantity = quantity + NEW.quantity, updated_at = NEW.created_at
    WHERE tenant_id = NEW.tenant_id AND stock_location_id = NEW.stock_location_id AND stock_batch_id = NEW.stock_batch_id
      AND quantity + NEW.quantity >= 0
    RETURNING quantity INTO q;
  IF q IS NULL THEN
    RAISE EXCEPTION 'STOCK_INSUFFICIENT: saldo batch di lokasi ini tidak mencukupi' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER stock_movements_apply BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION app_stock_apply_movement();

-- ---------------------------------------------------------------------
-- S09 · Nilai kritis: muncul berstatus terbuka (waktu server); hanya laporan ber-read-back yang menutupnya. Durasi
-- dari waktu server; satu laporan per nilai kritis. Status diubah fungsi pemilik (role aplikasi tanpa UPDATE).
-- ---------------------------------------------------------------------
CREATE FUNCTION app_critical_result_raise() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.raised_at := statement_timestamp();
  NEW.status := 'terbuka';
  RETURN NEW;
END $fn$;
CREATE TRIGGER critical_results_raise BEFORE INSERT ON "critical_results"
  FOR EACH ROW EXECUTE FUNCTION app_critical_result_raise();

CREATE FUNCTION app_critical_result_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: nilai kritis tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status')
     OR NOT (OLD.status = 'terbuka' AND NEW.status = 'dilaporkan')
     OR NOT EXISTS (SELECT 1 FROM critical_result_reports r WHERE r.tenant_id = NEW.tenant_id AND r.critical_result_id = NEW.id) THEN
    RAISE EXCEPTION 'CRITICAL_READBACK_REQUIRED: nilai kritis hanya ditutup lewat laporan ber-read-back'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER critical_results_guard BEFORE UPDATE OR DELETE ON "critical_results"
  FOR EACH ROW EXECUTE FUNCTION app_critical_result_guard();

CREATE FUNCTION app_critical_report_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c record;
BEGIN
  NEW.reported_at := statement_timestamp();
  SELECT raised_at, limit_minutes, status INTO c FROM critical_results
    WHERE tenant_id = NEW.tenant_id AND id = NEW.critical_result_id FOR UPDATE;
  IF c.status IS DISTINCT FROM 'terbuka' THEN
    RAISE EXCEPTION 'CONFLICT: nilai kritis ini sudah dilaporkan' USING ERRCODE = 'P0001';
  END IF;
  NEW.minutes_to_report := greatest(0, floor(extract(epoch FROM NEW.reported_at - c.raised_at) / 60))::integer;
  NEW.within_limit := NEW.minutes_to_report <= c.limit_minutes;
  RETURN NEW;
END $fn$;
CREATE TRIGGER critical_result_reports_before BEFORE INSERT ON "critical_result_reports"
  FOR EACH ROW EXECUTE FUNCTION app_critical_report_before();

CREATE FUNCTION app_critical_report_close() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE critical_results SET status = 'dilaporkan' WHERE tenant_id = NEW.tenant_id AND id = NEW.critical_result_id;
  RETURN NULL;
END $fn$;
CREATE TRIGGER critical_result_reports_close AFTER INSERT ON "critical_result_reports"
  FOR EACH ROW EXECUTE FUNCTION app_critical_report_close();

-- ---------------------------------------------------------------------
-- S01 · Validasi klinis hanya setelah validasi teknis putaran yang sama.
-- ---------------------------------------------------------------------
CREATE FUNCTION app_lab_validation_order() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.level = 'klinis' AND NOT EXISTS (
       SELECT 1 FROM lab_validations v WHERE v.tenant_id = NEW.tenant_id AND v.lab_order_id = NEW.lab_order_id
         AND v.level = 'teknis' AND v.round = NEW.round) THEN
    RAISE EXCEPTION 'VALIDATION_ORDER: validasi klinis hanya setelah validasi teknis' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM critical_results c JOIN lab_results r ON r.tenant_id = c.tenant_id AND r.id = c.lab_result_id
             WHERE c.tenant_id = NEW.tenant_id AND r.lab_order_id = NEW.lab_order_id AND c.status = 'terbuka') THEN
    RAISE EXCEPTION 'CRITICAL_OPEN: nilai kritis belum dilaporkan dengan read-back' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER lab_validations_order BEFORE INSERT ON "lab_validations"
  FOR EACH ROW EXECUTE FUNCTION app_lab_validation_order();

-- ---------------------------------------------------------------------
-- S06 · Daftar tilik WHO, peristiwa intraoperatif, hitung kasa (keputusan fase 4 no. 14).
-- ---------------------------------------------------------------------
CREATE FUNCTION app_surgical_check_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  item jsonb;
BEGIN
  SELECT i INTO item FROM surgery_cases s
    JOIN surgery_checklist_templates t ON t.tenant_id = s.tenant_id AND t.id = s.checklist_template_id,
    jsonb_array_elements(t.items -> NEW.phase) AS i
    WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.surgery_case_id AND i->>'code' = NEW.item_code;
  IF item IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: butir % tidak ada di fase % templat kasus ini', NEW.item_code, NEW.phase
      USING ERRCODE = 'P0001';
  END IF;
  IF coalesce((item->>'system')::boolean, false) AND NEW.source <> 'system' THEN
    RAISE EXCEPTION 'CHECKLIST_INCOMPLETE: butir % diisi sistem, tidak dicentang manual', NEW.item_code
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM surgical_safety_confirmations c
             WHERE c.tenant_id = NEW.tenant_id AND c.surgery_case_id = NEW.surgery_case_id AND c.phase = NEW.phase) THEN
    RAISE EXCEPTION 'CHECKLIST_ORDER: fase % sudah dikonfirmasi', NEW.phase USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER surgical_safety_checks_guard BEFORE INSERT ON "surgical_safety_checks"
  FOR EACH ROW EXECUTE FUNCTION app_surgical_check_guard();

-- Butir hitung yang belum beres: akhir ≠ awal + tambahan (atau belum dihitung akhir) tanpa tindak lanjut.
CREATE FUNCTION app_surgical_unreconciled_counts(p_tenant uuid, p_case uuid) RETURNS integer
LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::integer FROM (
    SELECT item_code,
           sum(quantity) FILTER (WHERE kind IN ('awal', 'tambahan')) AS expected,
           (array_agg(quantity ORDER BY counted_at DESC, id DESC) FILTER (WHERE kind = 'akhir'))[1] AS final
    FROM surgical_counts WHERE tenant_id = p_tenant AND surgery_case_id = p_case
    GROUP BY item_code) x
  WHERE (x.final IS NULL OR x.final IS DISTINCT FROM x.expected)
    AND NOT EXISTS (SELECT 1 FROM surgery_count_discrepancies d
                    WHERE d.tenant_id = p_tenant AND d.surgery_case_id = p_case AND d.item_code = x.item_code)
$fn$;

CREATE FUNCTION app_surgical_confirm_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  required text[] := ARRAY['sign-in', 'time-out', 'sign-out'];
  idx integer := array_position(required, NEW.phase);
  missing integer;
  counted integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':surgery.case:' || NEW.surgery_case_id::text, 0));
  IF idx > 1 AND (SELECT count(*) FROM surgical_safety_confirmations c
                  WHERE c.tenant_id = NEW.tenant_id AND c.surgery_case_id = NEW.surgery_case_id
                    AND c.phase = ANY (required[1:idx - 1])) < idx - 1 THEN
    RAISE EXCEPTION 'CHECKLIST_ORDER: urutan sign in → time out → sign out' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO missing FROM surgery_cases s
    JOIN surgery_checklist_templates t ON t.tenant_id = s.tenant_id AND t.id = s.checklist_template_id,
    jsonb_array_elements(t.items -> NEW.phase) AS i
    WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.surgery_case_id
      AND NOT EXISTS (SELECT 1 FROM surgical_safety_checks k WHERE k.tenant_id = s.tenant_id
                        AND k.surgery_case_id = s.id AND k.phase = NEW.phase AND k.item_code = i->>'code');
  IF missing > 0 THEN
    RAISE EXCEPTION 'CHECKLIST_INCOMPLETE: % butir fase % belum dicentang', missing, NEW.phase USING ERRCODE = 'P0001';
  END IF;
  IF NEW.phase = 'sign-out' THEN
    SELECT count(*) INTO counted FROM surgical_counts
      WHERE tenant_id = NEW.tenant_id AND surgery_case_id = NEW.surgery_case_id;
    IF NOT EXISTS (SELECT 1 FROM surgery_events e WHERE e.tenant_id = NEW.tenant_id
                     AND e.surgery_case_id = NEW.surgery_case_id AND e.kind = 'insisi')
       OR counted = 0 OR app_surgical_unreconciled_counts(NEW.tenant_id, NEW.surgery_case_id) > 0 THEN
      RAISE EXCEPTION 'COUNT_MISMATCH: sign out butuh insisi tercatat dan hitung akhir cocok/ditindaklanjuti'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER surgical_safety_confirmations_guard BEFORE INSERT ON "surgical_safety_confirmations"
  FOR EACH ROW EXECUTE FUNCTION app_surgical_confirm_guard();

CREATE FUNCTION app_surgery_event_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  min_reason integer;
  confirmed text[];
BEGIN
  NEW.recorded_at := statement_timestamp();
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':surgery.case:' || NEW.surgery_case_id::text, 0));
  SELECT coalesce(array_agg(phase), '{}') INTO confirmed FROM surgical_safety_confirmations
    WHERE tenant_id = NEW.tenant_id AND surgery_case_id = NEW.surgery_case_id;
  IF NEW.kind = 'induksi' AND NOT 'sign-in' = ANY (confirmed) THEN
    RAISE EXCEPTION 'CHECKLIST_ORDER: induksi butuh sign in terkonfirmasi' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind = 'insisi' AND NOT 'time-out' = ANY (confirmed) THEN
    SELECT coalesce((SELECT (value #>> '{}')::integer FROM tenant_settings
      WHERE tenant_id = NEW.tenant_id AND key = 'surgery.override_reason_min'), 15) INTO min_reason;
    IF char_length(btrim(coalesce(NEW.override_reason, ''))) < min_reason THEN
      RAISE EXCEPTION 'TIMEOUT_REQUIRED: insisi terkunci sampai time out dikonfirmasi' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.override_reason IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: override hanya untuk insisi sebelum time out' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind IN ('tutup', 'keluar') AND NOT EXISTS (
       SELECT 1 FROM surgery_events e WHERE e.tenant_id = NEW.tenant_id AND e.surgery_case_id = NEW.surgery_case_id
         AND e.kind = CASE NEW.kind WHEN 'tutup' THEN 'insisi' ELSE 'tutup' END) THEN
    RAISE EXCEPTION 'CHECKLIST_ORDER: urutan induksi → insisi → tutup → keluar' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER surgery_events_guard BEFORE INSERT ON "surgery_events"
  FOR EACH ROW EXECUTE FUNCTION app_surgery_event_guard();

-- ---------------------------------------------------------------------
-- S08 · Pengeluaran darah: ABO/Rh kompatibel, crossmatch cocok, belum ED; darurat tanpa crossmatch hanya golongan O
-- beralasan (Rh-negatif bila Rh pasien belum diketahui). Kantong ABO-inkompatibel tidak pernah keluar.
-- ---------------------------------------------------------------------
CREATE FUNCTION app_blood_abo_compatible(patient text, donor text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT donor = 'O' OR patient = 'AB' OR patient = donor
$fn$;

CREATE FUNCTION app_blood_issue_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  u record;
  rq record;
BEGIN
  SELECT * INTO u FROM blood_units WHERE tenant_id = NEW.tenant_id AND id = NEW.blood_unit_id FOR UPDATE;
  SELECT * INTO rq FROM blood_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.blood_request_id;
  IF u.id IS NULL OR rq.id IS NULL OR rq.encounter_id <> NEW.encounter_id OR rq.patient_id <> NEW.patient_id
     OR u.component_id <> rq.component_id THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: kantong/permintaan tidak cocok' USING ERRCODE = 'P0001';
  END IF;
  IF u.status NOT IN ('tersedia', 'dicadangkan') OR u.expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'BATCH_EXPIRED: kantong kedaluwarsa atau tidak tersedia' USING ERRCODE = 'P0001';
  END IF;
  IF (rq.patient_abo IS NOT NULL AND NOT app_blood_abo_compatible(rq.patient_abo, u.abo))
     OR (rq.patient_rh = 'neg' AND u.rh <> 'neg') THEN
    RAISE EXCEPTION 'BLOOD_INCOMPATIBLE: golongan darah kantong tidak kompatibel' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM crossmatches x WHERE x.tenant_id = NEW.tenant_id
                   AND x.blood_request_id = NEW.blood_request_id AND x.blood_unit_id = NEW.blood_unit_id
                   AND x.result = 'cocok') THEN
    IF NEW.emergency_reason IS NULL OR u.abo <> 'O' THEN
      RAISE EXCEPTION 'CROSSMATCH_REQUIRED: crossmatch cocok wajib (darurat: golongan O beralasan)' USING ERRCODE = 'P0001';
    END IF;
    IF rq.patient_rh IS NULL AND u.rh <> 'neg' THEN
      RAISE EXCEPTION 'BLOOD_INCOMPATIBLE: darurat tanpa Rh pasien hanya O Rh-negatif' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER blood_issues_guard BEFORE INSERT ON "blood_issues"
  FOR EACH ROW EXECUTE FUNCTION app_blood_issue_guard();

-- ---------------------------------------------------------------------
-- RLS + kebijakan tenant untuk semua tabel penunjang
-- ---------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lab_test_definitions', 'lab_reference_ranges', 'lab_analyzers', 'radiology_modalities', 'radiology_procedures',
    'stock_locations', 'formulary_stock_profiles', 'suppliers', 'surgery_checklist_templates', 'diet_types',
    'blood_components', 'lab_orders', 'lab_order_items', 'lab_order_status_history', 'specimens', 'specimen_events',
    'lab_results', 'lab_validations', 'lab_qc_runs', 'critical_results', 'critical_result_reports',
    'critical_result_escalations', 'micro_isolates', 'micro_susceptibilities', 'imaging_studies',
    'imaging_study_status_history', 'imaging_reports', 'pa_reports', 'stock_batches', 'stock_balances',
    'stock_movements', 'stock_receipts', 'stock_transfers', 'stock_adjustments', 'pharmacy_prescriptions',
    'pharmacy_prescription_status_history', 'prescription_reviews', 'pharmacist_interventions',
    'pharmacist_intervention_responses', 'dispenses', 'dispense_items', 'dispense_returns', 'surgery_cases',
    'surgery_case_status_history', 'surgery_case_team', 'surgical_safety_checks', 'surgical_safety_confirmations',
    'surgery_events', 'surgical_counts', 'surgery_count_discrepancies', 'operative_reports', 'surgery_supply_usages',
    'diet_orders', 'meal_services', 'blood_units', 'blood_requests', 'crossmatches', 'blood_issues',
    'transfusion_reactions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      || 'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- Hak akses role aplikasi: tanpa DELETE/TRUNCATE di mana pun; entri append-only hanya SELECT/INSERT; data
-- operasional hanya kolom status/jejaknya; saldo stok hanya SELECT (diubah fungsi ledger).
-- ---------------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    FOREACH t IN ARRAY ARRAY[
      'lab_test_definitions', 'lab_reference_ranges', 'lab_analyzers', 'radiology_modalities', 'radiology_procedures',
      'stock_locations', 'formulary_stock_profiles', 'suppliers', 'surgery_checklist_templates', 'diet_types',
      'blood_components', 'lab_orders', 'lab_order_items', 'lab_order_status_history', 'specimens', 'specimen_events',
      'lab_results', 'lab_validations', 'lab_qc_runs', 'critical_results', 'critical_result_reports',
      'critical_result_escalations', 'micro_isolates', 'micro_susceptibilities', 'imaging_studies',
      'imaging_study_status_history', 'imaging_reports', 'pa_reports', 'stock_batches', 'stock_balances',
      'stock_movements', 'stock_receipts', 'stock_transfers', 'stock_adjustments', 'pharmacy_prescriptions',
      'pharmacy_prescription_status_history', 'prescription_reviews', 'pharmacist_interventions',
      'pharmacist_intervention_responses', 'dispenses', 'dispense_items', 'dispense_returns', 'surgery_cases',
      'surgery_case_status_history', 'surgery_case_team', 'surgical_safety_checks', 'surgical_safety_confirmations',
      'surgery_events', 'surgical_counts', 'surgery_count_discrepancies', 'operative_reports', 'surgery_supply_usages',
      'diet_orders', 'meal_services', 'blood_units', 'blood_requests', 'crossmatches', 'blood_issues',
      'transfusion_reactions'] LOOP
      EXECUTE format('REVOKE ALL ON %I FROM simrs_app', t);
      EXECUTE format('GRANT SELECT ON %I TO simrs_app', t);
      IF t <> 'stock_balances' THEN
        EXECUTE format('GRANT INSERT ON %I TO simrs_app', t);
      END IF;
    END LOOP;
    FOREACH t IN ARRAY ARRAY['lab_results', 'imaging_reports', 'pa_reports', 'operative_reports'] LOOP
      EXECUTE format('GRANT SELECT ON %I TO simrs_app', t || '_current');
    END LOOP;
    -- Master: kolom bisnis saja (bukan id/tenant/kode/jejak buat).
    GRANT UPDATE (loinc, name, orderable_id, specimen_type, unit, decimals, result_type, panel_code, analyzer_code,
      delta_limit, sort_order, active, updated_at, updated_by) ON "lab_test_definitions" TO simrs_app;
    GRANT UPDATE (ref_low, ref_high, critical_low, critical_high, age_max_days) ON "lab_reference_ranges" TO simrs_app;
    GRANT UPDATE (name, unit_id, registered_device_id, active, updated_at, updated_by) ON "lab_analyzers" TO simrs_app;
    GRANT UPDATE (name, location_id, slots_per_day, slot_minutes, active, updated_at, updated_by)
      ON "radiology_modalities" TO simrs_app;
    GRANT UPDATE (icd9cm, name, orderable_id, contrast, template_code, template, active, updated_at, updated_by)
      ON "radiology_procedures" TO simrs_app;
    GRANT UPDATE (name, active, updated_at, updated_by) ON "stock_locations" TO simrs_app;
    GRANT UPDATE (unit, lasa, min_quantity, max_quantity, updated_at, updated_by) ON "formulary_stock_profiles" TO simrs_app;
    GRANT UPDATE (name, active, updated_at, updated_by) ON "suppliers" TO simrs_app;
    GRANT UPDATE (name, active, updated_at, updated_by) ON "diet_types" TO simrs_app;
    GRANT UPDATE (name, shelf_life_days, active, updated_at, updated_by) ON "blood_components" TO simrs_app;
    -- Operasional: status + jejaknya.
    GRANT UPDATE (status, received_at, released_at, updated_at) ON "lab_orders" TO simrs_app;
    GRANT UPDATE (voided_at, void_reason) ON "lab_order_items" TO simrs_app;
    GRANT UPDATE (status, collected_at, collected_by, received_at, received_by, rejected_reason, updated_at)
      ON "specimens" TO simrs_app;
    GRANT UPDATE (status, scheduled_at, identity_confirmed_by, contrast_screening, override_reason, override_by,
      started_at, completed_at, ctdi_vol, dlp, study_instance_uid, updated_at) ON "imaging_studies" TO simrs_app;
    GRANT UPDATE (status, received_by, received_at) ON "stock_transfers" TO simrs_app;
    GRANT UPDATE (status, updated_at) ON "pharmacy_prescriptions" TO simrs_app;
    GRANT UPDATE (double_checked_by, double_checked_at, handed_over_by, handed_over_at, receiver_kind, receiver_name,
      counseling_given) ON "dispenses" TO simrs_app;
    GRANT UPDATE (status, starts_at, ends_at, room_id, consent_id, cancel_reason, updated_at) ON "surgery_cases" TO simrs_app;
    GRANT UPDATE (ended_at) ON "surgery_case_team" TO simrs_app;
    GRANT UPDATE (status, ended_at) ON "diet_orders" TO simrs_app;
    GRANT UPDATE (status, updated_at) ON "blood_units" TO simrs_app;
    GRANT UPDATE (status, updated_at) ON "blood_requests" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS tabel lama yang menjadi tujuan FK komposit (lihat awal berkas).
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "orderables" FORCE ROW LEVEL SECURITY;
ALTER TABLE "drugs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "registered_devices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_groups" FORCE ROW LEVEL SECURITY;
ALTER TABLE "medication_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inbound_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;
