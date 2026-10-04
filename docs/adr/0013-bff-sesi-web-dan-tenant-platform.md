# ADR-0013 · Web sebagai BFF dengan cookie httpOnly, proxy pembaru sesi, dan tenant PLATFORM

Status: diterima · 4 Okt 2026 · peta refresh antar-instans dan CSP ber-nonce: lihat ADR-0073 (5 Okt 2026)

## Konteks
Login API (ADR-0011) mengembalikan token buram akses + refresh berotasi dengan deteksi pemakaian ulang. Web harus memakainya tanpa membuka token ke JavaScript browser (XSS), tetap aman dari CSRF, dan tidak membuat sesi tercabut gara-gara permintaan paralel. Area superadmin (ADR-0010) harus berpindah dari gerbang `APP_ENV` ke peran `superadmin_platform`. Batas laju login per IP di API tidak boleh berubah menjadi batas untuk seluruh RS saat semua permintaan datang dari server web.

## Keputusan
1. **Web = Backend-for-Frontend.** Browser hanya berbicara dengan Next. Token disimpan di cookie `httpOnly`, `SameSite=Lax`, `path=/`; di luar lokal `Secure` + prefiks `__Host-`. Server Component/Action memanggil API lewat satu pintu (`lib/server/api.ts`, `server-only`); komponen klien tidak pernah melihat token. Mutasi memakai Server Action (POST + pemeriksaan Origin = Host bawaan Next), jadi CSRF tertutup.
2. **Langkah login dihitung dari server**, bukan memori browser: cookie tantangan MFA (5 menit) dan `/auth/me` menentukan langkah (akun → verifikasi/daftar MFA → ganti sandi → unit). Memuat ulang halaman selalu menampilkan langkah yang benar; langkah tidak bisa dilompati.
3. **Proxy (Next 16) memperbarui sesi.** Cookie akses dibuang browser 60 detik sebelum token kedaluwarsa. Proxy melihat cookie refresh tanpa cookie akses → memanggil `/auth/refresh` **sekali per refresh token** (peta janji di memori proses, disimpan 30 detik, kunci = hash token) lalu meneruskan cookie baru ke render permintaan itu juga. Tanpa ini, prefetch/tab paralel memicu deteksi pemakaian ulang dan sesi tercabut. Refresh ditolak → cookie dihapus, halaman dialihkan ke `/masuk?alasan=sesi-berakhir`.
4. **Pemeriksaan sesi di setiap halaman (DAL).** `requireSession()` (React `cache`) dipanggil di layout untuk identitas/menu **dan** di setiap halaman, karena layout tidak menghentikan halaman anak dirender. Proxy hanya pemeriksaan optimistis; penegakan izin tetap di API.
5. **IP klien.** API memakai `TRUST_PROXY` (wajib di produksi; `true`/`*` ditolak). Web meneruskan entri **paling kanan** `X-Forwarded-For` (yang ditambahkan reverse proxy tepercaya; entri kiri bisa dipalsukan klien) + host + user agent. Di produksi web wajib berada di belakang reverse proxy yang menulis `X-Forwarded-For`.
6. **Tenant PLATFORM.** Kolom `tenants.kind` (`hospital` | `platform`, hanya satu platform: indeks unik parsial). Tenant PLATFORM hanya berisi peran `superadmin_platform` (panduan, kelola akun platform, audit; tanpa data pasien). `PROTECTED_ROLES` = `admin_tenant` + `superadmin_platform`. Izin `platform.*` tidak bisa diberikan ke peran RS. Web: superadmin = tenant `platform` **dan** izin `platform.guide.read`; selain itu area `/superadmin` dan `/dev/ui` 404.
7. **Tanpa akun bawaan.** Admin pertama tenant mana pun dibuat lewat CLI operator `pnpm db:create-admin --tenant <KODE> --username … --name …` (role migrator). Sandi sementara dicetak sekali; MFA dan ganti sandi wajib saat login pertama; pembuatan tercatat di audit.
8. **QR pendaftaran MFA** dibuat di server dengan `uqr` (MIT, tanpa dependensi) dan dikirim sebagai data URI SVG di `<img>` (bukan markup sisipan). Kunci manual ditampilkan sebagai cadangan.
9. **E2E stack penuh.** Playwright menjalankan API (port 4010, DB `simrs_test`) dan web build produksi (port 3010, `NODE_ENV=production` eksplisit); akun uji dibuat langsung di `simrs_test`.

## Konsekuensi
+ Token tidak terbaca skrip; sesi bertahan saat banyak permintaan paralel; logout/pencabutan berlaku di permintaan berikutnya.
+ Batas laju login tetap per pengguna sungguhan; audit mencatat IP klien asli.
+ Area superadmin bisa dipakai di produksi dengan akun yang diaudit, tanpa gerbang env.
− Peta refresh di memori hanya berlaku untuk satu instans web. Banyak instans butuh sticky session atau penyimpanan bersama (Redis) untuk peta itu, dan `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` yang sama.
− Pengembang lokal perlu `pnpm db:create-admin` + aplikasi autentikator untuk masuk (tidak ada jalan pintas tanpa login di web).
− PIN perangkat dan OTP cadangan (WhatsApp/email) di mockup belum dibangun (P11, potongan 10).
