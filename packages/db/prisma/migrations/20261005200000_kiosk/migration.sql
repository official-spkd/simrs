-- Fase 2 · potongan 6 (F05 anjungan): jejak pencarian identitas per perangkat anjungan dan tiket yang dicetaknya.
-- `kiosk_lookups`: satu baris per percobaan identifikasi (ditemukan atau tidak) = dasar batas laju per perangkat
-- (`kiosk.lookup_rate_per_min`) dan token `kl1` berumur pendek (hanya hash SHA-256 yang disimpan). Anjungan tidak
-- pernah menerima ID pasien; tindakan lanjutan (check-in, tiket) menukar token ini sekali pakai di perangkat yang sama.
-- `kiosk_tickets`: tiket yang diterbitkan perangkat, satu-satunya tiket yang boleh dicetak (ulang) perangkat itu.
-- Bagian tengah dibangkitkan `prisma migrate diff`; atas dan bawah manual.
-- Validasi FK ke/dari tabel ber-FORCE RLS tidak punya konteks tenant, jadi FORCE dimatikan sementara pada tabel yang
-- dirujuk FK baru; seluruh migrasi satu transaksi, dikembalikan di akhir berkas.
ALTER TABLE "registered_devices" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "queue_tickets" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "kiosk_lookups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "token_hash" TEXT,
    "patient_id" UUID,
    "appointment_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "idempotency_key" TEXT,
    "ticket_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_tickets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_lookups_token_hash_key" ON "kiosk_lookups"("token_hash");

-- CreateIndex
CREATE INDEX "kiosk_lookups_tenant_id_device_id_created_at_idx" ON "kiosk_lookups"("tenant_id", "device_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_lookups_tenant_id_id_key" ON "kiosk_lookups"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "kiosk_tickets_tenant_id_device_id_created_at_idx" ON "kiosk_tickets"("tenant_id", "device_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_tickets_tenant_id_id_key" ON "kiosk_tickets"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_tickets_tenant_id_device_id_ticket_id_key" ON "kiosk_tickets"("tenant_id", "device_id", "ticket_id");

-- AddForeignKey
ALTER TABLE "kiosk_lookups" ADD CONSTRAINT "kiosk_lookups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_lookups" ADD CONSTRAINT "kiosk_lookups_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "registered_devices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_lookups" ADD CONSTRAINT "kiosk_lookups_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_lookups" ADD CONSTRAINT "kiosk_lookups_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_lookups" ADD CONSTRAINT "kiosk_lookups_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "queue_tickets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_tickets" ADD CONSTRAINT "kiosk_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_tickets" ADD CONSTRAINT "kiosk_tickets_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "registered_devices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_tickets" ADD CONSTRAINT "kiosk_tickets_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "queue_tickets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Batasan domain
-- =====================================================================
-- Nilai = `KIOSK_PURPOSES` / `KIOSK_ID_METHODS` (@simrs/shared). Ditemukan ⇔ ada token dan pasien; percobaan yang
-- tidak ditemukan hanya menyimpan jenisnya (tanpa nilai yang diketik). Tiket hanya pada token yang sudah terpakai.
ALTER TABLE "kiosk_lookups" ADD CONSTRAINT kiosk_lookups_valid CHECK (
  purpose IN ('booking', 'bpjs', 'umum', 'farmasi_kasir')
  AND method IN ('nik', 'booking', 'bpjs')
  AND found = (token_hash IS NOT NULL)
  AND found = (patient_id IS NOT NULL)
  AND (found OR (appointment_id IS NULL AND used_at IS NULL))
  AND (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$')
  AND expires_at > created_at
  AND (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 100)
  AND (ticket_id IS NULL OR used_at IS NOT NULL));

-- Pencarian dan tiket anjungan adalah jejak: tidak dihapus, juga oleh pemilik tabel. Baris pencarian hanya boleh
-- ditandai terpakai sekali (token, perangkat, pasien, booking, masa berlaku tetap).
CREATE FUNCTION app_kiosk_lookup_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'KIOSK_LOOKUP_IMMUTABLE: pencarian anjungan % tidak bisa dihapus', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.used_at IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['used_at', 'idempotency_key', 'ticket_id'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['used_at', 'idempotency_key', 'ticket_id']) THEN
    RAISE EXCEPTION 'KIOSK_LOOKUP_IMMUTABLE: pencarian anjungan % sudah terpakai atau tidak bisa diubah', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER kiosk_lookups_guard BEFORE UPDATE OR DELETE ON "kiosk_lookups"
  FOR EACH ROW EXECUTE FUNCTION app_kiosk_lookup_guard();
CREATE TRIGGER kiosk_tickets_append_only BEFORE UPDATE OR DELETE ON "kiosk_tickets"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE "kiosk_lookups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kiosk_lookups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "kiosk_lookups"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE "kiosk_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kiosk_tickets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "kiosk_tickets"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- =====================================================================
-- Hak akses: sisip + baca; pada pencarian hanya kolom pemakaian token yang bisa diubah (default privileges DB `simrs`
-- memberi UPDATE/DELETE, dicabut eksplisit).
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "kiosk_lookups", "kiosk_tickets" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "kiosk_lookups", "kiosk_tickets" FROM simrs_app;
    GRANT UPDATE (used_at, idempotency_key, ticket_id) ON "kiosk_lookups" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "registered_devices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "queue_tickets" FORCE ROW LEVEL SECURITY;
