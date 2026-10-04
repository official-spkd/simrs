# ADR-0011 · Sesi buram berotasi, MFA wajib, argon2id bawaan Node 24

Status: diterima · 4 Okt 2026

## Konteks
P02 menuntut akun per orang, MFA, sesi pendek dengan refresh berotasi, kebijakan kata sandi, dan kunci akun (docs/05 §1). `.env.example` awal menyiapkan rahasia JWT. Login terjadi sebelum ada konteks tenant, padahal semua tabel identitas tunduk RLS.

## Keputusan
1. **Token buram, bukan JWT.** Format `<jenis>.<tenantId>.<id>.<rahasia 256 bit>` (jenis: `sa1` akses, `sr1` refresh, `sc1` tantangan MFA). Database hanya menyimpan hash SHA-256 rahasia; setiap permintaan memvalidasi sesi di database.
   - Logout, penonaktifan akun, dan pencabutan berlaku seketika (JWT tetap sah sampai kedaluwarsa).
   - Tidak ada risiko kebingungan algoritma atau kunci penandatangan bocor; `JWT_*_SECRET` dihapus dari `.env.example`.
   - `tenantId` di token hanya petunjuk untuk membuka transaksi bertenant; memalsukannya membuat sesi tidak ditemukan (RLS).
2. **Refresh berotasi dengan deteksi pemakaian ulang.** Refresh token lama yang dipakai lagi → sesi dicabut dan diaudit (`session_revoked`, alasan `refresh_reuse`). Pembaruan bersyarat mencegah dua rotasi paralel.
3. **MFA wajib untuk semua akun.** Akun tanpa MFA mendapat sesi terbatas yang hanya boleh ke endpoint `@AllowIncompleteSession()` (profil, daftar MFA, ganti sandi, logout); selain itu `403 MFA_REQUIRED`. Hal yang sama untuk `mustChangePassword` (`403 PASSWORD_CHANGE_REQUIRED`). TOTP RFC 6238 dengan anti-replay (`last_used_step`), rahasia terenkripsi AES-256-GCM per tenant.
4. **Kegagalan login di-commit sebelum 401.** Hitungan gagal (atomik), kunci akun, dan audit `login_failed` ditulis di transaksi tersendiri yang pasti commit. Pesan galat seragam + hash tiruan untuk menyamakan waktu (anti-enumerasi).
5. **Penentuan RS saat login.** Produksi: dari host/subdomain (`tenant_domains`, dibaca hanya lewat `app_resolve_tenant_by_host`). Lokal/staging: kolom kode RS (`app_resolve_tenant_by_code`). Keduanya fungsi `SECURITY DEFINER` yang hanya mengembalikan ID tenant aktif.
6. **argon2id bawaan Node** (`crypto.argon2`, Node ≥ 24.7) dengan parameter OWASP (m = 19 MiB, t = 2, p = 1), format PHC agar bisa di-hash ulang saat parameter dinaikkan. Tanpa dependensi native. `engines.node` dinaikkan ke `>=24.7`.
7. **Batas laju khusus kredensial**: throttler `auth` (bawaan 10/menit per IP) untuk endpoint `@AuthRateLimited()`, di samping batas umum dan kunci akun per pengguna.
8. **Mode header pengembang** (`X-Tenant-Id` tanpa login) hanya bila `APP_ENV=local` **dan** `ALLOW_DEV_TENANT_HEADER=true`.

## Konsekuensi
+ Pencabutan sesi seketika; permukaan serangan token kecil; tidak ada dependensi kripto pihak ketiga.
− Satu kueri sesi per permintaan (diindeks PK, `last_seen_at` ditulis paling sering sekali per menit).
− Pengembang wajib Node 24.7+.
− PIN login cepat per perangkat (docs/05) dan OTP cadangan via email/WhatsApp belum dibangun (dicatat di PROGRESS).

## Pembaruan 5 Okt 2026 · daftar kata sandi bocor offline
Daftar statis kecil di `password-policy.ts` kini hanya lapis dasar. Daftar besar disimpan di `ref.breached_passwords` (global, read-only bagi aplikasi, migrasi `20261005140000_breached_passwords`): hanya SHA-1 format Have I Been Pwned, N teratas (bawaan 100 ribu, maks. 2 juta), diisi operator lewat `pnpm db:import-breached` dari berkas resmi `SHA1:hitungan` (dibaca baris demi baris, dipilih hitungan terbesar) atau daftar teks, mengganti isi lama dalam satu transaksi dan gagal tertutup. Repo hanya membawa contoh kecil (`packages/db/data/breached-passwords-sample.txt`); dataset resmi tidak diunduh SIM RS. Saat ganti sandi, API mencari per rentang awalan 20 bit (gaya k-anonymity API rentang HIBP; kueri tidak pernah memuat hash utuh) lalu mencocokkan di aplikasi; hasilnya pelanggaran `common` yang sama. Dipilih tabel database, bukan berkas biner per server, agar semua instans API memakai daftar yang sama tanpa langkah penyebaran tambahan. − Tanpa impor resmi, perlindungan produksi hanya sebesar daftar contoh; langkah impor masuk panduan operator (`docs/panduan/03-tutorial.md`).
