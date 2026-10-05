-- Fase 2 · potongan 0b (F01–F07): skema front office. Rencana: docs/rencana/fase-2-front-office.md §2.
-- Master (praktisi, ID eksternal, penjamin, layanan + papan antrean), jadwal + sesi berkuota, salinan HFIS, booking,
-- tiket + panggilan antrean, task ID BPJS, kunjungan + riwayat status, penjaminan, rujukan, SEP berversi, kontak
-- pasien; persetujuan privasi mendapat kunjungan + bukti dokumen.
-- Bagian tengah dibangkitkan `prisma migrate diff` (skema lama → baru); bagian bawah manual (batasan, trigger,
-- indeks parsial, RLS, hak akses). Tabel ber-FORCE RLS yang dirujuk FK baru dibuat NO FORCE sementara (validasi FK
-- tanpa konteks tenant gagal TENANT_REQUIRED), dikembalikan di akhir berkas.
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_identifiers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "privacy_consents" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "privacy_consents" ADD COLUMN     "encounter_id" UUID,
ADD COLUMN     "evidence_document_id" UUID;

-- CreateTable
CREATE TABLE "practitioners" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "profession" TEXT NOT NULL DEFAULT 'dokter',
    "specialty" TEXT,
    "str_number" TEXT,
    "sip_number" TEXT,
    "sip_valid_until" DATE,
    "ihs_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "practitioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_ids" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_services" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit_id" UUID,
    "room" TEXT,
    "floor" SMALLINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "queue_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_displays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "queue_displays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_display_services" (
    "tenant_id" UUID NOT NULL,
    "display_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "queue_display_services_pkey" PRIMARY KEY ("display_id","service_id")
);

-- CreateTable
CREATE TABLE "practitioner_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "practitioner_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "quota_jkn" INTEGER NOT NULL,
    "quota_non_jkn" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "practitioner_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID,
    "practitioner_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'praktik',
    "substitute_practitioner_id" UUID,
    "quota_jkn" INTEGER NOT NULL,
    "quota_non_jkn" INTEGER NOT NULL,
    "booked_jkn" INTEGER NOT NULL DEFAULT 0,
    "booked_non_jkn" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "hfis_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "schedule_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hfis_schedule_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "practitioner_id" UUID,
    "direction" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "hfis_schedule_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_code" TEXT NOT NULL,
    "patient_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "practitioner_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "appointment_date" DATE NOT NULL,
    "quota_bucket" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "estimated_at" TIMESTAMPTZ(3),
    "checked_in_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_tickets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "seq" INTEGER NOT NULL,
    "ticket_no" TEXT NOT NULL,
    "appointment_id" UUID,
    "patient_id" UUID,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "reserved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "queue_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_calls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "counter" TEXT,
    "called_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_by" UUID,

    CONSTRAINT "queue_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bpjs_queue_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "task_id" SMALLINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outbox_message_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bpjs_queue_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "patient_id" UUID NOT NULL,
    "class" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "unit_id" UUID NOT NULL,
    "service_id" UUID,
    "practitioner_id" UUID,
    "appointment_id" UUID,
    "queue_ticket_id" UUID,
    "arrived_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "encounter_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "patient_identifier_id" UUID,
    "priority" SMALLINT NOT NULL DEFAULT 1,
    "class_entitlement" TEXT,
    "care_class" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "locked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "coverages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "ppk_code" TEXT,
    "facility_name" TEXT NOT NULL,
    "target_service_id" UUID,
    "practitioner_id" UUID,
    "encounter_id" UUID,
    "diagnosis_code" TEXT,
    "diagnosis_display" TEXT,
    "issued_on" DATE NOT NULL,
    "valid_until" DATE,
    "visit_no" SMALLINT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "coverage_id" UUID NOT NULL,
    "referral_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "correction_reason" TEXT,
    "sep_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "service_type" TEXT NOT NULL,
    "care_class" TEXT,
    "poli_code" TEXT,
    "diagnosis_code" TEXT,
    "last_error_code" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "seps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "relation" TEXT NOT NULL,
    "name_enc" TEXT NOT NULL,
    "phone_enc" TEXT,
    "address_enc" TEXT,
    "is_guarantor" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "patient_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_tenant_id_id_key" ON "practitioners"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_tenant_id_user_id_key" ON "practitioners"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_tenant_id_ihs_id_key" ON "practitioners"("tenant_id", "ihs_id");

-- CreateIndex
CREATE INDEX "external_ids_tenant_id_system_value_idx" ON "external_ids"("tenant_id", "system", "value");

-- CreateIndex
CREATE UNIQUE INDEX "external_ids_tenant_id_id_key" ON "external_ids"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "external_ids_tenant_id_entity_entity_id_system_key" ON "external_ids"("tenant_id", "entity", "entity_id", "system");

-- CreateIndex
CREATE UNIQUE INDEX "payers_tenant_id_id_key" ON "payers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payers_tenant_id_code_key" ON "payers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "queue_services_tenant_id_id_key" ON "queue_services"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_services_tenant_id_code_key" ON "queue_services"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "queue_displays_tenant_id_id_key" ON "queue_displays"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_displays_tenant_id_code_key" ON "queue_displays"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "queue_display_services_tenant_id_display_id_idx" ON "queue_display_services"("tenant_id", "display_id");

-- CreateIndex
CREATE INDEX "practitioner_schedules_tenant_id_practitioner_id_idx" ON "practitioner_schedules"("tenant_id", "practitioner_id");

-- CreateIndex
CREATE INDEX "practitioner_schedules_tenant_id_service_id_weekday_idx" ON "practitioner_schedules"("tenant_id", "service_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "practitioner_schedules_tenant_id_id_key" ON "practitioner_schedules"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "schedule_sessions_tenant_id_service_id_session_date_idx" ON "schedule_sessions"("tenant_id", "service_id", "session_date");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_sessions_tenant_id_id_key" ON "schedule_sessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_sessions_tenant_id_practitioner_id_session_date_st_key" ON "schedule_sessions"("tenant_id", "practitioner_id", "session_date", "start_time");

-- CreateIndex
CREATE INDEX "hfis_schedule_snapshots_tenant_id_fetched_at_idx" ON "hfis_schedule_snapshots"("tenant_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "hfis_schedule_snapshots_tenant_id_id_key" ON "hfis_schedule_snapshots"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_patient_id_idx" ON "appointments"("tenant_id", "patient_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_session_id_idx" ON "appointments"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_booking_code_key" ON "appointments"("tenant_id", "booking_code");

-- CreateIndex
CREATE INDEX "queue_tickets_tenant_id_service_id_service_date_status_idx" ON "queue_tickets"("tenant_id", "service_id", "service_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tickets_tenant_id_id_key" ON "queue_tickets"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tickets_tenant_id_service_id_service_date_seq_key" ON "queue_tickets"("tenant_id", "service_id", "service_date", "seq");

-- CreateIndex
CREATE INDEX "queue_calls_tenant_id_ticket_id_called_at_idx" ON "queue_calls"("tenant_id", "ticket_id", "called_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_calls_tenant_id_id_key" ON "queue_calls"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bpjs_queue_tasks_tenant_id_id_key" ON "bpjs_queue_tasks"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bpjs_queue_tasks_tenant_id_appointment_id_task_id_key" ON "bpjs_queue_tasks"("tenant_id", "appointment_id", "task_id");

-- CreateIndex
CREATE INDEX "encounters_tenant_id_patient_id_idx" ON "encounters"("tenant_id", "patient_id");

-- CreateIndex
CREATE INDEX "encounters_tenant_id_unit_id_status_idx" ON "encounters"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_tenant_id_id_key" ON "encounters"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_tenant_id_number_key" ON "encounters"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "encounter_status_history_tenant_id_encounter_id_changed_at_idx" ON "encounter_status_history"("tenant_id", "encounter_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_status_history_tenant_id_id_key" ON "encounter_status_history"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "coverages_tenant_id_encounter_id_idx" ON "coverages"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "coverages_tenant_id_id_key" ON "coverages"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "referrals_tenant_id_patient_id_idx" ON "referrals"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_tenant_id_id_key" ON "referrals"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_tenant_id_kind_number_key" ON "referrals"("tenant_id", "kind", "number");

-- CreateIndex
CREATE INDEX "seps_tenant_id_encounter_id_idx" ON "seps"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "seps_tenant_id_sep_no_idx" ON "seps"("tenant_id", "sep_no");

-- CreateIndex
CREATE UNIQUE INDEX "seps_tenant_id_id_key" ON "seps"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "patient_contacts_tenant_id_patient_id_idx" ON "patient_contacts"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_contacts_tenant_id_id_key" ON "patient_contacts"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_tenant_id_evidence_document_id_fkey" FOREIGN KEY ("tenant_id", "evidence_document_id") REFERENCES "documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_ids" ADD CONSTRAINT "external_ids_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payers" ADD CONSTRAINT "payers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_services" ADD CONSTRAINT "queue_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_services" ADD CONSTRAINT "queue_services_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_displays" ADD CONSTRAINT "queue_displays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_display_services" ADD CONSTRAINT "queue_display_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_display_services" ADD CONSTRAINT "queue_display_services_tenant_id_display_id_fkey" FOREIGN KEY ("tenant_id", "display_id") REFERENCES "queue_displays"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_display_services" ADD CONSTRAINT "queue_display_services_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "queue_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_schedules" ADD CONSTRAINT "practitioner_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_schedules" ADD CONSTRAINT "practitioner_schedules_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_schedules" ADD CONSTRAINT "practitioner_schedules_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "queue_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "practitioner_schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_tenant_id_substitute_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "substitute_practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "queue_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hfis_schedule_snapshots" ADD CONSTRAINT "hfis_schedule_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hfis_schedule_snapshots" ADD CONSTRAINT "hfis_schedule_snapshots_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "schedule_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "queue_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "queue_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_calls" ADD CONSTRAINT "queue_calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_calls" ADD CONSTRAINT "queue_calls_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "queue_tickets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bpjs_queue_tasks" ADD CONSTRAINT "bpjs_queue_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bpjs_queue_tasks" ADD CONSTRAINT "bpjs_queue_tasks_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "queue_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_queue_ticket_id_fkey" FOREIGN KEY ("tenant_id", "queue_ticket_id") REFERENCES "queue_tickets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_status_history" ADD CONSTRAINT "encounter_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_status_history" ADD CONSTRAINT "encounter_status_history_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_tenant_id_payer_id_fkey" FOREIGN KEY ("tenant_id", "payer_id") REFERENCES "payers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_tenant_id_patient_identifier_id_fkey" FOREIGN KEY ("tenant_id", "patient_identifier_id") REFERENCES "patient_identifiers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_target_service_id_fkey" FOREIGN KEY ("tenant_id", "target_service_id") REFERENCES "queue_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seps" ADD CONSTRAINT "seps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seps" ADD CONSTRAINT "seps_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seps" ADD CONSTRAINT "seps_tenant_id_coverage_id_fkey" FOREIGN KEY ("tenant_id", "coverage_id") REFERENCES "coverages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seps" ADD CONSTRAINT "seps_tenant_id_referral_id_fkey" FOREIGN KEY ("tenant_id", "referral_id") REFERENCES "referrals"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seps" ADD CONSTRAINT "seps_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "seps"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "patient_contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Batasan domain (nilai status/jenis mengikuti rencana fase 2 §2 dan kontrak bersama potongan 0a)
-- =====================================================================
ALTER TABLE "practitioners" ADD CONSTRAINT practitioners_profession_valid
  CHECK (profession IN ('dokter', 'dokter_gigi', 'bidan', 'perawat'));
ALTER TABLE "practitioners" ADD CONSTRAINT practitioners_name_present CHECK (char_length(name) BETWEEN 2 AND 160);

ALTER TABLE "external_ids" ADD CONSTRAINT external_ids_entity_valid
  CHECK (entity IN ('practitioner', 'queue_service', 'unit', 'location', 'patient', 'encounter', 'sep'));
ALTER TABLE "external_ids" ADD CONSTRAINT external_ids_system_format CHECK (system ~ '^[a-z][a-z0-9:_-]{1,60}$');
ALTER TABLE "external_ids" ADD CONSTRAINT external_ids_value_present CHECK (char_length(value) BETWEEN 1 AND 100);

ALTER TABLE "payers" ADD CONSTRAINT payers_kind_valid CHECK (kind IN ('bpjs', 'umum', 'asuransi', 'perusahaan'));
ALTER TABLE "payers" ADD CONSTRAINT payers_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$');

-- Kode layanan = awalan nomor antrean (`PD-027`, `A-031`).
ALTER TABLE "queue_services" ADD CONSTRAINT queue_services_code_format CHECK (code ~ '^[A-Z]{1,2}$');
ALTER TABLE "queue_services" ADD CONSTRAINT queue_services_kind_valid
  CHECK (kind IN ('poli', 'loket', 'farmasi', 'kasir', 'penunjang'));
ALTER TABLE "queue_displays" ADD CONSTRAINT queue_displays_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,29}$');
ALTER TABLE "queue_display_services" ADD CONSTRAINT queue_display_services_position_valid
  CHECK (position BETWEEN 1 AND 20);

ALTER TABLE "practitioner_schedules" ADD CONSTRAINT practitioner_schedules_valid CHECK (
  weekday BETWEEN 1 AND 7
  AND start_time < end_time
  AND quota_jkn >= 0 AND quota_non_jkn >= 0
  AND (valid_until IS NULL OR valid_until >= valid_from));

-- Kuota dijamin database: pemesanan tidak pernah melebihi kuota, apa pun urutan permintaannya.
ALTER TABLE "schedule_sessions" ADD CONSTRAINT schedule_sessions_quota CHECK (
  quota_jkn >= 0 AND quota_non_jkn >= 0
  AND booked_jkn >= 0 AND booked_non_jkn >= 0
  AND booked_jkn <= quota_jkn AND booked_non_jkn <= quota_non_jkn);
ALTER TABLE "schedule_sessions" ADD CONSTRAINT schedule_sessions_valid CHECK (
  kind IN ('praktik', 'cuti')
  AND start_time < end_time
  AND (substitute_practitioner_id IS NULL OR (kind = 'cuti' AND substitute_practitioner_id <> practitioner_id)));

ALTER TABLE "hfis_schedule_snapshots" ADD CONSTRAINT hfis_schedule_snapshots_valid CHECK (
  direction IN ('pull', 'push') AND period_end >= period_start AND jsonb_typeof(payload) IN ('object', 'array'));

ALTER TABLE "appointments" ADD CONSTRAINT appointments_booking_code_format CHECK (booking_code ~ '^[0-9]{10}$');
ALTER TABLE "appointments" ADD CONSTRAINT appointments_valid CHECK (
  quota_bucket IN ('jkn', 'non_jkn')
  AND channel IN ('mobile_jkn', 'aplikasi', 'anjungan', 'loket')
  AND status IN ('booked', 'checked_in', 'cancelled', 'no_show', 'completed'));
ALTER TABLE "appointments" ADD CONSTRAINT appointments_cancel_valid CHECK (
  (status = 'cancelled') = (cancelled_at IS NOT NULL)
  AND (cancelled_at IS NULL OR char_length(cancel_reason) BETWEEN 3 AND 300));

ALTER TABLE "queue_tickets" ADD CONSTRAINT queue_tickets_number_valid CHECK (
  seq BETWEEN 1 AND 999
  AND ticket_no ~ '^[A-Z]{1,2}-[0-9]{3}$'
  AND right(ticket_no, 3)::int = seq);
ALTER TABLE "queue_tickets" ADD CONSTRAINT queue_tickets_valid CHECK (
  source IN ('anjungan', 'loket', 'booking', 'mobile_jkn')
  AND status IN ('waiting', 'called', 'serving', 'done', 'skipped', 'cancelled'));

ALTER TABLE "queue_calls" ADD CONSTRAINT queue_calls_action_valid
  CHECK (action IN ('call', 'recall', 'skip', 'start', 'finish'));

ALTER TABLE "bpjs_queue_tasks" ADD CONSTRAINT bpjs_queue_tasks_valid CHECK (
  task_id IN (1, 2, 3, 4, 5, 6, 7, 99)
  AND status IN ('pending', 'sent', 'rejected', 'dead')
  AND (status <> 'sent' OR sent_at IS NOT NULL));

ALTER TABLE "encounters" ADD CONSTRAINT encounters_valid CHECK (
  class IN ('AMB', 'EMER', 'IMP')
  AND status IN ('planned', 'arrived', 'in_progress', 'finished', 'cancelled')
  AND (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
  AND (status <> 'cancelled' OR char_length(cancel_reason) BETWEEN 3 AND 300));
ALTER TABLE "encounter_status_history" ADD CONSTRAINT encounter_status_history_valid CHECK (
  to_status IN ('planned', 'arrived', 'in_progress', 'finished', 'cancelled')
  AND (from_status IS NULL OR from_status IN ('planned', 'arrived', 'in_progress', 'finished', 'cancelled')));

ALTER TABLE "coverages" ADD CONSTRAINT coverages_valid CHECK (
  status IN ('active', 'cancelled')
  AND priority BETWEEN 1 AND 3
  AND (class_entitlement IS NULL OR class_entitlement IN ('kelas_1', 'kelas_2', 'kelas_3'))
  AND (care_class IS NULL OR care_class IN ('vip', 'kelas_1', 'kelas_2', 'kelas_3')));

ALTER TABLE "referrals" ADD CONSTRAINT referrals_valid CHECK (
  kind IN ('rujukan-fktp', 'rujukan-rs', 'surat-kontrol', 'rujukan-keluar', 'rujukan-internal')
  AND status IN ('active', 'used', 'expired', 'cancelled')
  AND char_length(number) BETWEEN 3 AND 40
  AND (valid_until IS NULL OR valid_until >= issued_on)
  AND (visit_no IS NULL OR visit_no >= 1));

ALTER TABLE "seps" ADD CONSTRAINT seps_valid CHECK (
  status IN ('pending', 'issued', 'failed', 'cancelled')
  AND service_type IN ('rawat_jalan', 'rawat_inap')
  AND (care_class IS NULL OR care_class IN ('kelas_1', 'kelas_2', 'kelas_3')));
-- Terbit = punya nomor dan waktu terbit; batal = waktu + alasan.
ALTER TABLE "seps" ADD CONSTRAINT seps_lifecycle_valid CHECK (
  (status NOT IN ('issued', 'cancelled') OR (sep_no IS NOT NULL AND issued_at IS NOT NULL))
  AND (status = 'cancelled') = (cancelled_at IS NOT NULL)
  AND (cancelled_at IS NULL OR char_length(cancel_reason) BETWEEN 5 AND 300));
-- Versi 1 = akar; versi berikutnya selalu menggantikan versi sebelumnya dengan alasan.
ALTER TABLE "seps" ADD CONSTRAINT seps_version_chain CHECK (
  version >= 1
  AND (version = 1) = (supersedes_id IS NULL)
  AND (supersedes_id IS NULL) = (correction_reason IS NULL)
  AND (correction_reason IS NULL OR char_length(correction_reason) BETWEEN 10 AND 500));
-- Satu versi hanya digantikan sekali; satu rantai SEP per kunjungan (SEP ganda ditolak database).
CREATE UNIQUE INDEX seps_supersedes_once ON "seps" ("tenant_id", "supersedes_id") WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX seps_one_chain_per_encounter ON "seps" ("tenant_id", "encounter_id") WHERE version = 1;

ALTER TABLE "patient_contacts" ADD CONSTRAINT patient_contacts_valid CHECK (
  relation IN ('suami', 'istri', 'anak', 'orang_tua', 'saudara', 'wali', 'lainnya')
  AND status IN ('active', 'removed')
  AND supersedes_id IS DISTINCT FROM id);
-- Data kontak tersimpan terenkripsi (format `encryptField`).
ALTER TABLE "patient_contacts" ADD CONSTRAINT patient_contacts_encrypted CHECK (
  name_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$'
  AND (phone_enc IS NULL OR phone_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$')
  AND (address_enc IS NULL OR address_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$'));
CREATE UNIQUE INDEX patient_contacts_supersedes_once
  ON "patient_contacts" ("tenant_id", "supersedes_id") WHERE supersedes_id IS NOT NULL;

-- Persetujuan umum rawat inap berlaku per admisi: satu aktif per jenis, penerima, DAN kunjungan (null = rawat
-- jalan, berlaku sampai dicabut).
DROP INDEX privacy_consents_one_active;
CREATE UNIQUE INDEX privacy_consents_one_active
  ON "privacy_consents" ("tenant_id", "patient_id", "kind", (COALESCE(lower("recipient"), '')),
                         (COALESCE("encounter_id"::text, '')))
  WHERE revoked_at IS NULL;

-- =====================================================================
-- Kolom yang tidak boleh berubah setelah disisipkan (siapa pun, termasuk pemilik tabel). Daftar kolom = argumen
-- trigger; perbandingan lewat to_jsonb sehingga tipe apa pun bisa dibandingkan.
-- =====================================================================
CREATE FUNCTION app_immutable_columns() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'IMMUTABLE_COLUMN: %.% tidak bisa diubah', TG_TABLE_NAME, col USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END $fn$;

CREATE TRIGGER appointments_immutable BEFORE UPDATE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION app_immutable_columns('booking_code', 'patient_id', 'channel', 'created_at');
CREATE TRIGGER queue_tickets_immutable BEFORE UPDATE ON "queue_tickets"
  FOR EACH ROW EXECUTE FUNCTION app_immutable_columns('service_id', 'service_date', 'seq', 'ticket_no', 'created_at');
CREATE TRIGGER bpjs_queue_tasks_immutable BEFORE UPDATE ON "bpjs_queue_tasks"
  FOR EACH ROW EXECUTE FUNCTION app_immutable_columns('appointment_id', 'task_id', 'occurred_at', 'created_at');
CREATE TRIGGER encounters_immutable BEFORE UPDATE ON "encounters"
  FOR EACH ROW EXECUTE FUNCTION app_immutable_columns('number', 'patient_id', 'class', 'created_at');

-- Append-only (ADR-0004): panggilan antrean, riwayat status kunjungan, salinan HFIS, kontak pasien.
CREATE TRIGGER queue_calls_append_only BEFORE UPDATE OR DELETE ON "queue_calls"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER encounter_status_history_append_only BEFORE UPDATE OR DELETE ON "encounter_status_history"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER hfis_schedule_snapshots_append_only BEFORE UPDATE OR DELETE ON "hfis_schedule_snapshots"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER patient_contacts_append_only BEFORE UPDATE OR DELETE ON "patient_contacts"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Panggilan antrean → SSE (ADR-0026): payload hanya tenant + id (tanpa nomor, nama, atau isi lain); pendengar
-- membaca barisnya sendiri di transaksi bertenant. NOTIFY terkirim saat transaksi commit.
CREATE FUNCTION app_notify_queue_call() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('queue_calls', json_build_object('tenant_id', NEW.tenant_id, 'id', NEW.id)::text);
  RETURN NULL;
END $fn$;
CREATE TRIGGER queue_calls_notify AFTER INSERT ON "queue_calls"
  FOR EACH ROW EXECUTE FUNCTION app_notify_queue_call();

-- SEP: `issued` beku kecuali pembatalan (status -> cancelled + kolom batal); `cancelled` beku seluruhnya; tidak
-- pernah dihapus. Koreksi = versi baru (supersedes_id). `pending`/`failed` masih boleh diperbarui pengirim.
CREATE FUNCTION app_sep_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  cancel_cols CONSTANT text[] := ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_at', 'updated_by'];
  trail_cols CONSTANT text[] := ARRAY['updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SEP_FROZEN: SEP tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'cancelled' AND (to_jsonb(NEW) - trail_cols) IS DISTINCT FROM (to_jsonb(OLD) - trail_cols) THEN
    RAISE EXCEPTION 'SEP_FROZEN: SEP % sudah dibatalkan', OLD.sep_no USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'issued' AND (
       (to_jsonb(NEW) - cancel_cols) IS DISTINCT FROM (to_jsonb(OLD) - cancel_cols)
       OR NEW.status NOT IN ('issued', 'cancelled')
       OR (NEW.status = 'issued' AND (to_jsonb(NEW) - trail_cols) IS DISTINCT FROM (to_jsonb(OLD) - trail_cols))) THEN
    RAISE EXCEPTION 'SEP_FROZEN: SEP % sudah terbit; koreksi = versi baru', OLD.sep_no USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER seps_guard BEFORE UPDATE OR DELETE ON "seps"
  FOR EACH ROW EXECUTE FUNCTION app_sep_guard();

-- Penjaminan terkunci begitu SEP untuknya terbit (diisi trigger di bawah); sejak itu tidak bisa diubah.
CREATE FUNCTION app_coverage_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COVERAGE_LOCKED: penjaminan tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'COVERAGE_LOCKED: penjaminan terkunci sejak SEP terbit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER coverages_guard BEFORE UPDATE OR DELETE ON "coverages"
  FOR EACH ROW EXECUTE FUNCTION app_coverage_guard();

CREATE FUNCTION app_lock_coverage_on_sep() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status = 'issued' THEN
    UPDATE coverages SET locked_at = now()
    WHERE tenant_id = NEW.tenant_id AND id = NEW.coverage_id AND locked_at IS NULL;
  END IF;
  RETURN NULL;
END $fn$;
CREATE TRIGGER seps_lock_coverage AFTER INSERT OR UPDATE OF status ON "seps"
  FOR EACH ROW EXECUTE FUNCTION app_lock_coverage_on_sep();

-- =====================================================================
-- RLS
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'practitioners', 'external_ids', 'payers', 'queue_services', 'queue_displays', 'queue_display_services',
    'practitioner_schedules', 'schedule_sessions', 'hfis_schedule_snapshots', 'appointments', 'queue_tickets',
    'queue_calls', 'bpjs_queue_tasks', 'encounters', 'encounter_status_history', 'coverages', 'referrals', 'seps',
    'patient_contacts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $do$;

-- =====================================================================
-- Hak akses: tidak ada DELETE di mana pun. Kolom identitas/nomor/waktu kejadian tidak masuk hak UPDATE.
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    -- Master dan jadwal: dikelola dari layar (nonaktif, bukan hapus).
    GRANT SELECT, INSERT, UPDATE ON "practitioners", "external_ids", "payers", "queue_services", "queue_displays",
      "queue_display_services", "practitioner_schedules", "schedule_sessions" TO simrs_app;
    -- Sisanya: sisip + baca; ubah hanya kolom tertentu (di bawah). Default privileges DB `simrs` (init.sql)
    -- memberi UPDATE/DELETE seluruh tabel, jadi dicabut eksplisit dulu.
    GRANT SELECT, INSERT ON "hfis_schedule_snapshots", "queue_calls", "encounter_status_history", "patient_contacts",
      "appointments", "queue_tickets", "bpjs_queue_tasks", "encounters", "coverages", "referrals", "seps" TO simrs_app;
    REVOKE UPDATE ON "hfis_schedule_snapshots", "queue_calls", "encounter_status_history", "patient_contacts",
      "appointments", "queue_tickets", "bpjs_queue_tasks", "encounters", "coverages", "referrals", "seps" FROM simrs_app;
    REVOKE DELETE, TRUNCATE ON "practitioners", "external_ids", "payers", "queue_services", "queue_displays",
      "queue_display_services", "practitioner_schedules", "schedule_sessions", "hfis_schedule_snapshots",
      "appointments", "queue_tickets", "queue_calls", "bpjs_queue_tasks", "encounters", "encounter_status_history",
      "coverages", "referrals", "seps", "patient_contacts" FROM simrs_app;
    -- Booking: kode booking, pasien, kanal tetap; sesi/tanggal boleh berubah (jadwal ulang).
    GRANT UPDATE (session_id, practitioner_id, service_id, appointment_date, quota_bucket, status, estimated_at,
                  checked_in_at, cancelled_at, cancelled_by, cancel_reason, updated_at, updated_by)
      ON "appointments" TO simrs_app;
    -- Tiket: nomor tetap; pasien/booking bisa dikaitkan belakangan (walk-in).
    GRANT UPDATE (appointment_id, patient_id, status, reserved, updated_at, updated_by) ON "queue_tickets" TO simrs_app;
    -- Task BPJS: task dan waktu kejadian tetap; hanya status kirim.
    GRANT UPDATE (status, outbox_message_id, sent_at, last_error_code, updated_at) ON "bpjs_queue_tasks" TO simrs_app;
    -- Kunjungan: nomor, pasien, kelas tetap.
    GRANT UPDATE (status, unit_id, service_id, practitioner_id, appointment_id, queue_ticket_id, arrived_at,
                  started_at, ended_at, cancel_reason, updated_at, updated_by)
      ON "encounters" TO simrs_app;
    -- Penjaminan: sampai terkunci (trigger).
    GRANT UPDATE (payer_id, patient_identifier_id, priority, class_entitlement, care_class, status, locked_at,
                  updated_at, updated_by)
      ON "coverages" TO simrs_app;
    GRANT UPDATE (target_service_id, practitioner_id, encounter_id, valid_until, visit_no, status, updated_at,
                  updated_by)
      ON "referrals" TO simrs_app;
    -- SEP: hasil kirim dan pembatalan; isi klinis/administratif = versi baru.
    GRANT UPDATE (sep_no, status, last_error_code, issued_at, cancelled_at, cancelled_by, cancel_reason, updated_at,
                  updated_by)
      ON "seps" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_identifiers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "privacy_consents" FORCE ROW LEVEL SECURITY;
