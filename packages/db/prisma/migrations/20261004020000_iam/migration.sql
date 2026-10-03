-- Fase 1 · P02 identitas: akun, kredensial (argon2id), MFA TOTP, sesi buram berotasi, tantangan login,
-- pemetaan subdomain → tenant. Bagian tengah dibangkitkan prisma migrate diff; bagian bawah manual.

-- CreateTable
CREATE TABLE "tenant_domains" (
    "host" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("host")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'totp',
    "secret_enc" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "last_used_step" INTEGER,
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_hash" TEXT NOT NULL,
    "access_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "previous_refresh_hash" TEXT,
    "refresh_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_timeout_minutes" INTEGER NOT NULL,
    "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
    "unit_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_challenges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_username_key" ON "users"("tenant_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_tenant_id_user_id_key" ON "user_credentials"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "mfa_factors_tenant_id_user_id_idx" ON "mfa_factors"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_user_id_status_idx" ON "auth_sessions"("tenant_id", "user_id", "status");

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "users" ADD CONSTRAINT users_username_format
  CHECK (username = lower(username) AND username ~ '^[a-z0-9][a-z0-9._@-]{2,99}$');
ALTER TABLE "users" ADD CONSTRAINT users_email_lower CHECK (email IS NULL OR email = lower(email));
ALTER TABLE "users" ADD CONSTRAINT users_status_valid CHECK (status IN ('active', 'disabled'));
ALTER TABLE "users" ADD CONSTRAINT users_failed_nonnegative CHECK (failed_login_count >= 0);
ALTER TABLE "user_credentials" ADD CONSTRAINT user_credentials_argon2id CHECK (password_hash LIKE '$argon2id$%');
ALTER TABLE "mfa_factors" ADD CONSTRAINT mfa_factors_kind_valid CHECK (kind IN ('totp'));
ALTER TABLE "auth_sessions" ADD CONSTRAINT auth_sessions_status_valid CHECK (status IN ('active', 'revoked'));
ALTER TABLE "auth_sessions" ADD CONSTRAINT auth_sessions_idle_range CHECK (idle_timeout_minutes BETWEEN 5 AND 60);
ALTER TABLE "login_challenges" ADD CONSTRAINT login_challenges_attempts_range CHECK (attempts BETWEEN 0 AND 10);
ALTER TABLE "tenant_domains" ADD CONSTRAINT tenant_domains_host_format
  CHECK (host = lower(host) AND host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

-- Satu faktor TOTP aktif per pengguna.
CREATE UNIQUE INDEX mfa_factors_one_active_per_user ON "mfa_factors" ("tenant_id", "user_id") WHERE disabled_at IS NULL;

-- =====================================================================
-- RLS untuk tabel identitas (data tenant). tenant_domains: registri platform, RLS aktif tanpa kebijakan
-- dan tanpa GRANT ke aplikasi (hanya dibaca fungsi SECURITY DEFINER di bawah).
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'user_credentials', 'mfa_factors', 'auth_sessions', 'login_challenges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Penentuan tenant saat login (sebelum ada konteks tenant). Hanya mengembalikan ID tenant aktif.
-- =====================================================================
CREATE OR REPLACE FUNCTION app_resolve_tenant_by_code(p_code text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenants WHERE code = upper(p_code) AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION app_resolve_tenant_by_host(p_host text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.tenant_id FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
  WHERE d.host = lower(p_host) AND t.status = 'active';
$$;

REVOKE ALL ON FUNCTION app_resolve_tenant_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_tenant_by_host(text) FROM PUBLIC;

-- =====================================================================
-- Hak akses. Akun, kredensial, faktor, sesi tidak pernah dihapus aplikasi (nonaktif/dicabut berjejak).
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "users", "user_credentials", "mfa_factors", "auth_sessions", "login_challenges" TO simrs_app;
    REVOKE DELETE, TRUNCATE ON "users", "user_credentials", "mfa_factors", "auth_sessions", "login_challenges" FROM simrs_app;
    REVOKE ALL ON "tenant_domains" FROM simrs_app;
    GRANT EXECUTE ON FUNCTION app_resolve_tenant_by_code(text) TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_resolve_tenant_by_host(text) TO simrs_app;
  END IF;
END $$;
