-- P03 · Penugasan yang dibatalkan sebelum mulai disimpan sebagai rentang kosong (valid_until = valid_from):
-- tidak pernah aktif, tetapi tetap tercatat (penugasan tidak dihapus). Pembuatan penugasan baru tetap
-- mensyaratkan akhir > awal (divalidasi di layanan).
ALTER TABLE "staff_assignments" DROP CONSTRAINT staff_assignments_period_valid;
ALTER TABLE "staff_assignments" ADD CONSTRAINT staff_assignments_period_valid
  CHECK (valid_until IS NULL OR valid_until >= valid_from);
