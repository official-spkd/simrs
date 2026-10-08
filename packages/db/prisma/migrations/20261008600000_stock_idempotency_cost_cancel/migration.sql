-- Fase 4 potongan 4.6a-2 · S05 stok depo: faktur unik per pemasok, harga per baris penerimaan + harga pokok batch
-- rata-rata tertimbang, pembatalan mutasi yang tersangkut `dikirim`, dan penonaktifan lokasi yang masih punya mutasi
-- dalam perjalanan ditolak. Revisi ADR-0036 (harga batch tidak lagi beku).

ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_receipts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_batches" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_locations" NO FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 1. Harga per baris penerimaan di ledger (`receipt` wajib, jenis lain kosong). Baris lama diisi dari harga batch.
-- ---------------------------------------------------------------------
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost" BIGINT;
ALTER TABLE "stock_movements" DISABLE TRIGGER "stock_movements_append_only";
UPDATE "stock_movements" m SET "unit_cost" = b."unit_cost"
  FROM "stock_batches" b
  WHERE m."kind" = 'receipt' AND b."tenant_id" = m."tenant_id" AND b."id" = m."stock_batch_id";
ALTER TABLE "stock_movements" ENABLE TRIGGER "stock_movements_append_only";
ALTER TABLE "stock_movements" ADD CONSTRAINT stock_movements_unit_cost_valid CHECK (
  ("kind" = 'receipt') = ("unit_cost" IS NOT NULL) AND ("unit_cost" IS NULL OR "unit_cost" >= 0));

-- ---------------------------------------------------------------------
-- 2. Satu faktur pemasok diterima sekali. Faktur ganda yang sudah ada (hanya data uji fiktif sebelum potongan ini)
--    diberi akhiran nomor penerimaan agar indeks unik bisa dibuat.
-- ---------------------------------------------------------------------
ALTER TABLE "stock_receipts" DISABLE TRIGGER "stock_receipts_append_only";
UPDATE "stock_receipts" r SET "invoice_no" = r."invoice_no" || ' · ' || r."receipt_no"
  WHERE EXISTS (
    SELECT 1 FROM "stock_receipts" o
    WHERE o."tenant_id" = r."tenant_id" AND o."supplier_id" = r."supplier_id" AND o."invoice_no" = r."invoice_no"
      AND (o."received_at", o."id") < (r."received_at", r."id"));
ALTER TABLE "stock_receipts" ENABLE TRIGGER "stock_receipts_append_only";
CREATE UNIQUE INDEX "stock_receipts_tenant_id_supplier_id_invoice_no_key"
  ON "stock_receipts"("tenant_id", "supplier_id", "invoice_no");

-- ---------------------------------------------------------------------
-- 3. Harga pokok batch = rata-rata tertimbang, diperbarui HANYA oleh fungsi ledger saat penerimaan. Batch tetap tidak
--    bisa dihapus dan kolom lain tetap beku (pengganti trigger append-only batch).
-- ---------------------------------------------------------------------
DROP TRIGGER "stock_batches_append_only" ON "stock_batches";
CREATE FUNCTION app_stock_batch_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: batch stok tidak bisa dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - 'unit_cost') IS DISTINCT FROM (to_jsonb(OLD) - 'unit_cost') THEN
    RAISE EXCEPTION 'APPEND_ONLY: hanya harga pokok rata-rata batch yang diperbarui ledger' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER stock_batches_guard BEFORE UPDATE OR DELETE ON "stock_batches"
  FOR EACH ROW EXECUTE FUNCTION app_stock_batch_guard();

CREATE OR REPLACE FUNCTION app_stock_apply_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  b record;
  q integer;
  on_hand bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  IF NEW.kind = 'receipt' THEN
    -- Kunci baris batch: harga rata-rata dihitung dari saldo semua lokasi sebelum penerimaan ini.
    SELECT drug_id, expiry_date, unit_cost INTO b FROM stock_batches
      WHERE tenant_id = NEW.tenant_id AND id = NEW.stock_batch_id FOR UPDATE;
  ELSE
    SELECT drug_id, expiry_date, unit_cost INTO b FROM stock_batches
      WHERE tenant_id = NEW.tenant_id AND id = NEW.stock_batch_id;
  END IF;
  IF b.drug_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: batch stok tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind IN ('dispense', 'usage')
     AND b.expiry_date <= (statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'BATCH_EXPIRED: batch kedaluwarsa tidak boleh dikeluarkan ke pasien' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind = 'receipt' THEN
    SELECT coalesce(sum(quantity), 0) INTO on_hand FROM stock_balances
      WHERE tenant_id = NEW.tenant_id AND stock_batch_id = NEW.stock_batch_id;
    IF on_hand > 0 AND NEW.unit_cost IS DISTINCT FROM b.unit_cost THEN
      UPDATE stock_batches
        SET unit_cost = round((b.unit_cost::numeric * on_hand + NEW.unit_cost::numeric * NEW.quantity)
                              / (on_hand + NEW.quantity))::bigint
        WHERE tenant_id = NEW.tenant_id AND id = NEW.stock_batch_id;
    ELSIF on_hand <= 0 AND NEW.unit_cost IS DISTINCT FROM b.unit_cost THEN
      UPDATE stock_batches SET unit_cost = NEW.unit_cost
        WHERE tenant_id = NEW.tenant_id AND id = NEW.stock_batch_id;
    END IF;
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

-- ---------------------------------------------------------------------
-- 4. Pembatalan mutasi `dikirim` (beralasan, sekali); status hanya maju dari `dikirim`.
-- ---------------------------------------------------------------------
ALTER TABLE "stock_transfers" ADD COLUMN "cancelled_by" UUID,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
  ADD COLUMN "cancel_reason" TEXT;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_cancelled_by_fkey"
  FOREIGN KEY ("tenant_id", "cancelled_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" DROP CONSTRAINT stock_transfers_values_valid;
ALTER TABLE "stock_transfers" ADD CONSTRAINT stock_transfers_values_valid CHECK (
  transfer_no ~ '^MUT-\d{4}-\d{4}$' AND from_stock_location_id <> to_stock_location_id
  AND status IN ('dikirim', 'diterima', 'dibatalkan') AND (status = 'diterima') = (received_at IS NOT NULL)
  AND (received_at IS NULL) = (received_by IS NULL) AND jsonb_typeof(items) = 'array'
  AND (status = 'dibatalkan') = (cancelled_at IS NOT NULL) AND (cancelled_at IS NULL) = (cancelled_by IS NULL)
  AND (status <> 'dibatalkan' OR char_length(btrim(coalesce(cancel_reason, ''))) BETWEEN 10 AND 500));
CREATE FUNCTION app_stock_transfer_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF OLD.status <> 'dikirim' THEN
    RAISE EXCEPTION 'CONFLICT: mutasi ini sudah % dan tidak bisa diubah', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'dibatalkan' THEN
    NEW.cancelled_at := statement_timestamp();
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER stock_transfers_guard BEFORE UPDATE ON "stock_transfers"
  FOR EACH ROW EXECUTE FUNCTION app_stock_transfer_guard();
GRANT UPDATE (cancelled_by, cancelled_at, cancel_reason) ON "stock_transfers" TO simrs_app;

-- ---------------------------------------------------------------------
-- 5. Lokasi yang masih punya mutasi `dikirim` (masuk atau keluar) tidak bisa dinonaktifkan.
-- ---------------------------------------------------------------------
CREATE FUNCTION app_stock_location_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF OLD.active AND NOT NEW.active AND EXISTS (
    SELECT 1 FROM stock_transfers
    WHERE tenant_id = NEW.tenant_id AND status = 'dikirim'
      AND (from_stock_location_id = NEW.id OR to_stock_location_id = NEW.id)) THEN
    RAISE EXCEPTION 'STOCK_LOCATION_IN_TRANSIT: lokasi masih punya mutasi dalam perjalanan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER stock_locations_transit_guard BEFORE UPDATE OF active ON "stock_locations"
  FOR EACH ROW EXECUTE FUNCTION app_stock_location_guard();

ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_batches" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_locations" FORCE ROW LEVEL SECURITY;
