-- Pertahankan prioritas galat gerbang gelang skema II: scan salah/absen/milik petugas lain ditolak dahulu.
-- PostgreSQL menjalankan trigger sejenis menurut nama. Penjaga dosis tambahan berjalan setelah guard gelang.
ALTER TRIGGER medication_administrations_dose_guard ON medication_administrations
  RENAME TO medication_administrations_safety_guard;
