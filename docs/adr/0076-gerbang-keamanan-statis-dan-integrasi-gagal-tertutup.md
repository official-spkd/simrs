# ADR-0076 · Gerbang keamanan statis rute API dan integrasi gagal tertutup

Status: diterima · 6 Okt 2026 · Komponen: P02, P03, P04 (API lintas modul), I* (worker outbox), infra, apps/mock

## Konteks

Review keamanan lintas repo 6 Okt 2026 (api, worker, web, db, mock, infra; prioritas modul fase 3) menemukan pola
yang bukan bug satu modul, melainkan bawaan yang gagal terbuka:

- Endpoint `@TenantScoped()` tanpa `@RequirePermission` terbuka bagi semua staf yang login. Kepatuhan hanya dijaga
  daftar periksa manual (`docs/panduan/02` dan docs/05 §5).
- `INTEGRATION_MODE` berbawaan `mock` di semua lingkungan, dan konektor HTTP generik worker selalu mengirim ke
  `MOCK_BASE_URL` apa pun modenya. Produksi yang lupa menyetel variabel ini akan mengirim NIK, nama, dan tanggal lahir
  (verifikasi Dukcapil) serta isi notifikasi ke alamat mock tanpa TLS.
- Potongan respons (300 karakter) di `delivery_attempts` disimpan kecuali operasi menyatakan `sensitive`, sehingga
  operasi yang lupa (Dukcapil) menyimpan respons yang bisa memuat data pribadi.
- Mock integrasi (tanpa autentikasi, rahasia mock bawaan) bisa dijalankan di produksi atau di 0.0.0.0, dan Docker
  Compose lokal membuka Postgres/Redis/MinIO/Mailpit ke semua antarmuka jaringan dengan kata sandi lokal yang diketahui.

## Keputusan

1. **Gerbang statis rute API** (`apps/api/test/route-security.test.ts`). Tes membaca metadata Nest semua controller
   dan mewajibkan setiap endpoint masuk satu golongan:
   - staf: `AuthGuard` + `TenantTransactionInterceptor` + `@RequirePermission`;
   - perangkat: `DeviceGuard` + interceptor, tanpa `@RequirePermission` (ADR-0027);
   - swalayan akun sendiri tanpa izin matriks: daftar `SELF_SERVICE` (profil, sesi, MFA, PIN milik sendiri, notifikasi);
   - publik: daftar `PUBLIC`, wajib `@AuthRateLimited()`/`@PublicRateLimited()` kecuali probe kesehatan dan
     verifikasi tanda tangan berkode 256 bit.
   Juga: `@AllowIncompleteSession` hanya di endpoint swalayan, dan endpoint POST/PUT/PATCH/DELETE berizin `read` harus
   terdaftar dengan alasan (`MUTATING_WITH_READ`). Menambah entri ke daftar = keputusan sadar yang terlihat di review.
2. **Integrasi gagal tertutup.** `loadApiEnv`/`loadWorkerEnv` menolak `APP_ENV=production` dengan
   `INTEGRATION_MODE=mock` (termasuk bila tidak disetel). Di luar mode mock, `HttpConnector` tidak pernah menghubungi
   `MOCK_BASE_URL`: pesan gagal sementara (dicoba ulang lalu DLQ) sampai konektor nyata fase 7 tersedia; lookup
   Dukcapil di API sudah gagal tertutup (503, isi manual).
3. **Potongan respons outbox opt-in.** Konektor HTTP generik menyimpan potongan respons hanya bila operasi menyatakan
   `sensitive: false` (bawaan sama dengan operasi BPJS). Badan respons dibaca maks. 64 KB lewat aliran, bukan
   `res.text()` lalu dipotong.
4. **Mock hanya untuk pengembangan.** `apps/mock` menolak start bila `APP_ENV`/`NODE_ENV` = `production` atau `HOST`
   bukan loopback (kecuali `MOCK_ALLOW_REMOTE=true` untuk jaringan kontainer tertutup).
5. **Infra lokal hanya di loopback.** Semua port Docker Compose dipublikasikan di `127.0.0.1`. Berkas ini tidak untuk
   server edge/staging/produksi.
6. **Lingkup unit ADT** (ADR-0031): pembatalan/alokasi permintaan bed oleh peran berlingkup unit hanya oleh unit
   tujuan (unit bed yang dipesan, atau unit yang diminta selama belum dialokasi) atau pihak yang berhak atas pasiennya;
   transfer berlingkup unit hanya ke bed di unit sendiri atau bed yang sudah dipesan untuk kunjungan itu.

## Konsekuensi

+ Endpoint baru yang lupa izin, lupa transaksi ber-RLS, atau terbuka tanpa batas laju gagal di `pnpm test`, bukan
  ditemukan saat review fase.
+ Kesalahan konfigurasi produksi pada integrasi berhenti saat start, bukan membocorkan data pribadi diam-diam.
− Tes dan skrip yang membangun env produksi wajib menyetel `INTEGRATION_MODE` (`sandbox`/`production`) secara eksplisit.
− Operasi outbox HTTP baru yang ingin potongan respons di layar Integrasi harus menyatakan `sensitive: false`.
− Klien di mesin lain (mis. tablet uji) tidak bisa lagi memakai Postgres/Redis/MinIO pengembang secara langsung;
  pakai API/web (yang tetap bind sesuai `HOST`).
