-- Fase 1 · P04: hash berantai audit per tenant (MRMIK 2.1c, 10c).
-- seq, prev_hash, hash, dan occurred_at diisi trigger (bukan aplikasi): server adalah satu-satunya sumber
-- waktu dan urutan. Kanonikalisasi memakai larik JSON agar nilai berisi pemisah tidak bisa membuat tabrakan.
-- Hasil akhir kolom/indeks identik dengan schema.prisma (tidak ada drift).

-- 1. Kolom baru (tanpa NOT NULL/unik dulu, agar baris lama bisa diisi ulang).
ALTER TABLE "audit_events" ADD COLUMN "details" JSONB;
ALTER TABLE "audit_events" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'success';
ALTER TABLE "audit_events" ADD COLUMN "seq" BIGINT;

-- 2. Bentuk kanonik satu baris untuk di-hash.
CREATE OR REPLACE FUNCTION app_audit_canonical(e audit_events) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(
    e.tenant_id::text,
    e.seq::text,
    to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    e.actor_user_id::text,
    e.actor_role,
    e.patient_id::text,
    e.resource_type,
    e.resource_id,
    e.action,
    e.outcome,
    e.reason,
    e.ip,
    e.user_agent,
    e.request_id,
    e.details,
    e.prev_hash
  )::text
$$;

CREATE OR REPLACE FUNCTION app_audit_hash(e audit_events) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(app_audit_canonical(e), 'UTF8')), 'hex')
$$;

-- 3. Isi ulang baris lama per tenant (urut waktu, lalu id). Pemilik tabel (migrator) membaca `tenants`
--    tanpa konteks (NO FORCE), lalu menyetel konteks per tenant karena audit_events tetap FORCE RLS.
ALTER TABLE "audit_events" DISABLE TRIGGER audit_events_append_only;
DO $$
DECLARE
  t uuid;
  r audit_events;
  n bigint;
  prev text;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    n := 0;
    prev := NULL;
    FOR r IN SELECT * FROM audit_events WHERE tenant_id = t ORDER BY occurred_at, id LOOP
      n := n + 1;
      r.seq := n;
      r.prev_hash := prev;
      r.occurred_at := date_trunc('milliseconds', r.occurred_at);
      r.hash := app_audit_hash(r);
      UPDATE audit_events
        SET seq = r.seq, prev_hash = r.prev_hash, occurred_at = r.occurred_at, hash = r.hash
        WHERE id = r.id;
      prev := r.hash;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
ALTER TABLE "audit_events" ENABLE TRIGGER audit_events_append_only;

-- 4. Kunci struktur akhir (sama dengan schema.prisma).
ALTER TABLE "audit_events" ALTER COLUMN "seq" SET NOT NULL;
ALTER TABLE "audit_events" ALTER COLUMN "seq" SET DEFAULT 0;
ALTER TABLE "audit_events" ALTER COLUMN "hash" SET NOT NULL;
ALTER TABLE "audit_events" ALTER COLUMN "hash" SET DEFAULT '';
CREATE UNIQUE INDEX "audit_events_tenant_id_seq_key" ON "audit_events"("tenant_id", "seq");
CREATE INDEX "audit_events_tenant_id_actor_user_id_occurred_at_idx" ON "audit_events"("tenant_id", "actor_user_id", "occurred_at");

-- 5. Trigger rantai. Kunci advisory per tenant menyerialkan penambahan audit dalam satu tenant
--    sehingga dua transaksi tidak bisa mengambil prev_hash yang sama. Nilai dari aplikasi untuk
--    seq/prev_hash/hash/occurred_at selalu ditimpa.
CREATE OR REPLACE FUNCTION app_audit_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_seq bigint;
  v_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit_chain:' || NEW.tenant_id::text, 0));
  SELECT seq, hash INTO v_seq, v_hash
    FROM audit_events WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  NEW.seq := COALESCE(v_seq, 0) + 1;
  NEW.prev_hash := v_hash;
  NEW.occurred_at := date_trunc('milliseconds', clock_timestamp());
  NEW.hash := app_audit_hash(NEW);
  RETURN NEW;
END $$;

CREATE TRIGGER audit_events_chain
  BEFORE INSERT ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION app_audit_chain();

-- 6. Verifikasi rantai tenant aktif (konteks RLS wajib). Mengembalikan jumlah baris yang diperiksa dan seq
--    pertama yang rusak (NULL bila utuh). Mendeteksi baris diubah, disisipkan, atau dihapus di tengah.
CREATE OR REPLACE FUNCTION app_verify_audit_chain()
RETURNS TABLE (checked bigint, first_broken_seq bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_events;
  expected_prev text := NULL;
  n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_events WHERE tenant_id = app_current_tenant() ORDER BY seq LOOP
    n := n + 1;
    IF r.seq <> n
       OR r.prev_hash IS DISTINCT FROM expected_prev
       OR r.hash IS DISTINCT FROM app_audit_hash(r) THEN
      checked := n;
      first_broken_seq := r.seq;
      RETURN NEXT;
      RETURN;
    END IF;
    expected_prev := r.hash;
  END LOOP;
  checked := n;
  first_broken_seq := NULL;
  RETURN NEXT;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT EXECUTE ON FUNCTION app_audit_canonical(audit_events) TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_audit_hash(audit_events) TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_verify_audit_chain() TO simrs_app;
  END IF;
END $$;
