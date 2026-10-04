-- Fase 1 · P09/P02: no. HP staf (terenkripsi di aplikasi) untuk notifikasi WhatsApp dan kode cadangan login.
ALTER TABLE "users" ADD COLUMN "phone_enc" TEXT;
ALTER TABLE "users" ADD CONSTRAINT users_phone_enc_format
  CHECK (phone_enc IS NULL OR phone_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$');
