-- ADR-0026: fungsi NOTIFY generik `app_notify_row('<kanal>')` (payload hanya tenant_id + id) seperti yang ditulis
-- ADR itu untuk potongan 0b. Migrasi 0b memasang fungsi khusus `app_notify_queue_call()` dengan kanal dan payload yang
-- sama; trigger `queue_calls_notify` kini memakai fungsi generik agar tabel berikutnya (papan IGD/bed, hasil kritis)
-- cukup menambah trigger. Perilaku tidak berubah.
CREATE OR REPLACE FUNCTION app_notify_row() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify(TG_ARGV[0], json_build_object('tenant_id', NEW.tenant_id, 'id', NEW.id)::text);
  RETURN NULL;
END $fn$;

DROP TRIGGER queue_calls_notify ON "queue_calls";
CREATE TRIGGER queue_calls_notify AFTER INSERT ON "queue_calls"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('queue_calls');
DROP FUNCTION app_notify_queue_call();
