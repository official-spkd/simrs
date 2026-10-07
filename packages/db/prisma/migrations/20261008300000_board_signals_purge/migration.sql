-- ADR-0104 · Pembersihan sinyal papan IGD/bed (`board_signals`). Sinyal hanya pemicu muat ulang layar; potret papan
-- dikirim ulang setiap sambung SSE, jadi baris lama tidak berguna. Role aplikasi tidak punya DELETE (append-only dari
-- sisi aplikasi): satu fungsi sempit SECURITY DEFINER menghapus sinyal tenant AKTIF (RLS FORCE tetap berlaku pada
-- pemilik) yang lebih tua dari batas, per batch, dengan umur minimum tetap agar tidak bisa dipakai menghapus sinyal
-- yang masih relevan. Dipanggil job worker `board.signals-cleanup` (P11).
CREATE FUNCTION app_purge_board_signals(p_before timestamptz, p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_before timestamptz := least(p_before, now() - interval '10 minutes');
  v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'BOARD_SIGNALS_PURGE_LIMIT: batch 1–5000' USING ERRCODE = 'P0001';
  END IF;
  WITH old AS (
    SELECT id FROM board_signals
    WHERE tenant_id = v_tenant AND created_at < v_before
    ORDER BY created_at
    LIMIT p_limit
  )
  DELETE FROM board_signals b USING old WHERE b.id = old.id AND b.tenant_id = v_tenant;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $fn$;
REVOKE ALL ON FUNCTION app_purge_board_signals(timestamptz, integer) FROM PUBLIC;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT EXECUTE ON FUNCTION app_purge_board_signals(timestamptz, integer) TO simrs_app;
  END IF;
END $do$;
