-- P03/P04 · FK pengguna yang belum ada di tabel P03: pemohon dan peninjau akses darurat, relasi akses, dan
-- penerima notifikasi. FK komposit (tenant_id, user) karena FK tidak tunduk RLS.
-- Validasi FK ke/dari tabel ber-FORCE RLS tidak punya konteks tenant (gagal TENANT_REQUIRED), jadi FORCE
-- dimatikan sementara; seluruh migrasi satu transaksi, aplikasi tidak pernah melihat tabel tanpa FORCE.
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "access_relationships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "break_glass_grants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;

-- AddForeignKey
ALTER TABLE "access_relationships" ADD CONSTRAINT "access_relationships_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_tenant_id_reviewed_by_fkey" FOREIGN KEY ("tenant_id", "reviewed_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_recipient_user_id_fkey" FOREIGN KEY ("tenant_id", "recipient_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "access_relationships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "break_glass_grants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
