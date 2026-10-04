-- Fase 1 · P02: kode cadangan login (WhatsApp/email) dan "percayai perangkat ini 12 jam" (mockup Login).
-- NO FORCE sementara pada users (dirujuk FK baru), dikembalikan di akhir berkas.
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "login_challenges" ADD COLUMN     "otp_channel" TEXT,
ADD COLUMN     "otp_enc" TEXT,
ADD COLUMN     "otp_sends" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otp_sent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_token_hash_key" ON "trusted_devices"("token_hash");

-- CreateIndex
CREATE INDEX "trusted_devices_tenant_id_user_id_idx" ON "trusted_devices"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_tenant_id_id_key" ON "trusted_devices"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan
-- =====================================================================
ALTER TABLE "login_challenges" ADD CONSTRAINT login_challenges_otp_consistent CHECK (
  (otp_enc IS NULL) = (otp_channel IS NULL) AND (otp_enc IS NULL) = (otp_sent_at IS NULL)
  AND (otp_channel IS NULL OR otp_channel IN ('whatsapp', 'email'))
  AND otp_sends BETWEEN 0 AND 3);
ALTER TABLE "trusted_devices" ADD CONSTRAINT trusted_devices_token_hash_format CHECK (token_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE "trusted_devices" ADD CONSTRAINT trusted_devices_window
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '12 hours');
ALTER TABLE "trusted_devices" ADD CONSTRAINT trusted_devices_user_agent_length
  CHECK (user_agent IS NULL OR char_length(user_agent) <= 200);

-- =====================================================================
-- RLS + hak akses: sisip/baca; ubah hanya penanda pakai/pencabutan; tidak dihapus (jejak).
-- =====================================================================
ALTER TABLE "trusted_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trusted_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "trusted_devices"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "trusted_devices" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "trusted_devices" FROM simrs_app;
    GRANT UPDATE (last_used_at, revoked_at) ON "trusted_devices" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
