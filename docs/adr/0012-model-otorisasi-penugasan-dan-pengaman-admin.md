# ADR-0012 · Model otorisasi: matriks per RS, satu penugasan per sesi, pengaman admin

Status: diterima · 4 Okt 2026

## Konteks
docs/05 §1–2 menetapkan izin = peran × unit × relasi pasien × jenis formulir, ditegakkan di guard API dan di query, dengan 16 peran bawaan dan break-the-glass (alasan wajib, 60 menit, notifikasi petugas privasi). Dokumen tidak mengatur: di mana matriks disimpan, bagaimana sesi memilih peran bila staf punya beberapa penugasan, dan bagaimana mencegah RS terkunci atau eskalasi hak lewat menu admin.

## Keputusan
1. **Katalog izin di kode, matriks di database per RS.** `PERMISSION_CATALOG` (sumber × aksi) dan `DEFAULT_ROLE_GRANTS` ada di `@simrs/shared`; baris `role_permissions` per tenant menyimpan lingkup (`all` | `unit` | `relationship`). `ensureSystemRoles` hanya mengisi matriks bawaan untuk peran yang baru dibuat, sehingga penyesuaian RS tidak pernah ditimpa. Matriks dibaca dari database tiap permintaan: perubahan berlaku seketika.
2. **Satu penugasan per sesi.** `staff_assignments` = pengguna × peran × unit × masa berlaku. Sesi memakai satu penugasan: otomatis bila hanya satu yang berlaku, selain itu dipilih pengguna. Validasi sesi menolak peran bila penugasan berakhir atau perannya nonaktif.
3. **Pemeriksaan di interceptor, sebelum transaksi permintaan.** `@RequirePermission(resource, action)` dicek dalam transaksi pendek tersendiri. Bila ditolak, audit `access_denied` di-commit dulu, baru `403`, sehingga penolakan tidak ikut batal bersama permintaan. Lingkup yang lolos diteruskan ke service (`TenantDb.permissionScope()`) untuk penyaringan query.
4. **ABAC pasien lewat `PatientAccessService`.** Lingkup `all` boleh; lingkup lain wajib relasi aktif (`access_relationships`) atau akses darurat yang berlaku. Lingkup `unit` sementara diperlakukan seperti `relationship` sampai lokasi pasien (ADT) tersedia di fase 2–3.
5. **Akses darurat.** Alasan 20–500 karakter, durasi dari pengaturan `break_glass.duration_minutes`, notifikasi in-app ke semua petugas privasi aktif **tanpa PHI** (identitas pasien dan alasan hanya di layar tinjauan berizin), audit berisi pasien dan alasan. Hak kolom database membuat alasan dan waktu tidak bisa diubah; hanya kolom tinjauan yang bisa diisi, dan peninjau tidak boleh meninjau aksesnya sendiri.
6. **Pengaman admin.**
   - Selalu tersisa minimal satu `admin_tenant` aktif. Pemeriksaan dikunci per tenant (`pg_advisory_xact_lock`, `lockTenantScope`) karena di READ COMMITTED dua admin yang saling menonaktifkan bersamaan sama-sama lolos (write skew; dibuktikan tes).
   - `iam.users.write` dan `iam.roles.write` tidak bisa dicabut dari `admin_tenant`.
   - Peran yang memegang salah satu izin itu dianggap setara admin. Akun dan penugasan setara admin hanya boleh dikelola `admin_tenant`, sehingga izin kelola pengguna yang didelegasikan tidak bisa dipakai mengambil alih akun admin atau membuat admin baru.
   - Lewat menu admin, tidak ada yang bisa menonaktifkan, mereset, atau menambah peran akunnya sendiri.
7. **Penugasan tidak dihapus.** Mengakhiri penugasan mengisi `valid_until` dan alasan. Penugasan yang belum mulai dibatalkan sebagai rentang kosong (`valid_until = valid_from`); CHECK dilonggarkan menjadi `>=` (migrasi `20261004040000_assignment_cancel`).

## Konsekuensi
+ Perubahan izin dan pencabutan peran berlaku di permintaan berikutnya, tanpa menunggu token kedaluwarsa.
+ Penolakan selalu tercatat; eskalasi lewat delegasi tertutup; RS tidak bisa terkunci dari pengaturan aksesnya.
− Satu kueri matriks per permintaan berizin (cache per tenant bila beban naik).
− Izin baru di katalog tidak otomatis masuk ke peran RS yang sudah berjalan; perlu migrasi data atau penyesuaian lewat layar Akses.
− Kunci admin menyerialkan perubahan akun admin dalam satu tenant (jarang, dapat diterima).
