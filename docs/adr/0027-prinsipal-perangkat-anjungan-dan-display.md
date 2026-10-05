# ADR-0027 · Prinsipal perangkat: anjungan dan display TV masuk sebagai perangkat terdaftar per unit

Status: diterima · 5 Okt 2026 · Komponen: F04 (display antrean), F05 (anjungan), P02, P03, P04

## Konteks

Anjungan mandiri (F05) dan TV antrean (F04) menyala sepanjang hari di ruang publik. Mode presentasi membukanya dengan login staf, dan itu tidak boleh terbawa ke produksi:

- sesi staf membawa izin manusia (data pasien),
- sesi staf berakhir 15 menit (idle) atau maksimal 8 jam,
- akun bersama dilarang (docs/05 §1).

Rencana fase 2 §4 keputusan #2 menetapkan: **perangkat terdaftar per unit dengan izin tetap**, bukan akun staf.

PIN masuk cepat (ADR-0024 §10) sudah menyiapkan tabel umum `registered_devices` (kolom `kind`) untuk dipakai ulang di sini.

## Keputusan

1. **Jenis perangkat baru di tabel yang sama.** `registered_devices.kind` bertambah `kiosk` dan `queue_display` (nama jenis dari katalog izin potongan 0a, `DEVICE_KINDS`) (migrasi `20261005151000_device_principals`). Aturan yang dijaga CHECK database:
   - terikat **unit** (FK komposit tenant),
   - tanpa akun, posisi, atau PIN,
   - kredensial maksimal 366 hari,
   - display boleh terikat satu papan `queue_displays` (FK komposit, opsional).
2. **Didaftarkan admin, bukan oleh perangkat.**
   - Admin (izin `iam.users.write`, sama dengan pencabutan PIN perangkat) membuat perangkat di **Sistem → Pengguna dan akses → Perangkat** (`POST /api/v1/iam/devices`).
   - API membalas **kode pendaftaran sekali pakai**: 10 karakter Crockford base32 (50 bit), tampil `XXXXX-XXXXX`, berlaku 15 menit, hanya ditampilkan sekali.
   - Database hanya menyimpan HMAC kode (`FIELD_HASH_KEY`, tujuan `device_enrolment`), sehingga isi database yang bocor tidak bisa ditebak offline.
   - Kode unik per tenant selama masih menunggu.
3. **Perangkat menukar kode tanpa login staf.**
   - Di perangkat itu, `/perangkat/daftar` (publik) mengirim kode RS + kode ke `POST /api/v1/devices/enrol`. Endpoint ini memakai batas laju endpoint kredensial.
   - Hasilnya token buram `dv1.<tenant>.<id>.<rahasia 256 bit>`; database hanya menyimpan SHA-256 rahasianya.
   - Web (BFF) menyimpan token di cookie `simrs_device`: httpOnly, SameSite=Lax, `__Host-` + Secure di luar lokal, berumur sampai kredensial kedaluwarsa. Cookie ini milik perangkat dan tidak dihapus saat staf keluar.
   - Pendaftaran terjadi sekali: penjaga database hanya mengizinkan transisi `token_hash`/`enrolled_at`/kode dibuang, satu kali, sebelum kode kedaluwarsa. Selebihnya baris tidak bisa diubah, dan pencabutan final.
4. **Izin tetap, tidak pernah izin manusia.**
   - Izin per jenis dari katalog izin (`DEVICE_GRANTS`, potongan 0a): `kiosk` → `kiosk.use`, `queue_display` → `queue.display.read`. Sumber izin ini khusus perangkat (`DEVICE_ONLY_RESOURCES`), bukan bagian matriks peran, dan tidak bisa diberikan ke peran manusia atau diubah RS.
   - Endpoint perangkat memakai `@DeviceScoped(izin?)` = `DeviceGuard` + batas laju per perangkat + `TenantTransactionInterceptor`.
   - `DeviceGuard` hanya menerima token `dv1` dan memeriksanya di database setiap permintaan: terdaftar, tidak dicabut, belum kedaluwarsa, rahasia cocok waktu-konstan. Token staf di endpoint perangkat → 403. Izin yang tidak dimiliki jenisnya → audit `access_denied` (di-commit) lalu 403. `@RequirePermission` (matriks manusia) ditolak untuk pelaku perangkat.
5. **Perangkat tidak bisa membuka endpoint staf.** `AuthGuard` (`@TenantScoped()`) mengenali token `dv1`:
   - perangkat yang sah dicatat `access_denied` (`resource_type = staff_endpoint`) lalu 403,
   - token perangkat palsu atau dicabut → 401 tanpa menulis audit atas nama tenant di token.
6. **Audit tanpa kolom baru.** Hash berantai audit memakai daftar kolom eksplisit, jadi pelaku perangkat dicatat dengan `actor_user_id`/`actor_role` kosong dan `details.deviceId` + `details.deviceKind` di setiap entri (`AuditMeta.device`).
   - Pendaftaran perangkat: `create registered_device` (jenis + unit, tanpa kode).
   - Penukaran kode: `login` dengan `method: device_enrolment`. Gagal → `login_failed` dengan alasan `bad_code`, `code_expired`, atau `bad_code_format`.
   - Pencabutan: `deactivate registered_device`.
7. **Pencabutan oleh admin** (`POST /api/v1/iam/devices/:id/revoke`, juga untuk kode yang belum dipakai) berlaku di permintaan berikutnya, karena tidak ada sesi perangkat yang di-cache.
   - Aliran SSE yang sedang terbuka berhenti paling lama 5 menit kemudian: umur koneksi ADR-0026 memaksa sambung ulang, dan sambung ulang itu memeriksa ulang perangkat.
   - Batas laju: throttler `user` yang sama (`USER_RATE_LIMIT_PER_MIN`) dengan pelacak tenant + id perangkat. Batas lookup anjungan per menit (`kiosk.lookup_rate_per_min`) ditambahkan modul anjungan (potongan 6).
8. **Web.**
   - Di mode api, `/kiosk` dan `/display/…` dibuka perangkat, bukan sesi staf. Proxy: tanpa cookie perangkat → `/perangkat/daftar?lanjut=…`.
   - Halaman memanggil `requireDevice(jenis)` (DAL, `GET /api/v1/devices/me`). Perangkat jenis lain melihat penjelasan, bukan data.
   - Mode presentasi tidak berubah: tetap di balik login staf.

## Konsekuensi

+ Tidak ada akun staf bersama di ruang publik. Perangkat yang dicuri atau cookie yang disalin hanya membuka layar jenisnya di satu RS, bisa dicabut kapan pun, dan setiap aksinya tercatat dengan id perangkat.
+ Modul anjungan (potongan 6) dan display (potongan 4b) cukup memasang `@DeviceScoped('kiosk.use' | 'queue.display.read')`. `LookupGateway` dan `SseService` bekerja apa adanya karena hanya membaca tenant + pelaku dari konteks permintaan.
− Siapa pun yang memegang profil peramban perangkat bisa memakai layar itu sampai dicabut. Mitigasinya: izin tetap yang sempit, layar tanpa data pasien utuh (keputusan §4 #3), dan audit per perangkat.
− Satu kueri `registered_devices` per permintaan perangkat; penanda `last_used_at` ditulis paling sering 5 menit sekali.
− Izin kelola perangkat memakai `iam.users`; izin tersendiri (mis. `iam.devices`) bisa dipisah bila RS membutuhkannya.

## Pembaruan 5 Okt 2026 · anjungan (potongan 6) dan review keamanan (potongan 9)

Modul anjungan (`modules/kiosk`) memakai prinsipal ini apa adanya. Keputusan tambahan:

1. **Token pencarian, bukan ID pasien.** Identifikasi (NIK, kartu BPJS, kode booking hari ini) + tanggal dan bulan
   lahir yang diketik (DDMM, lihat revisi di bawah) menjawab nama tersamar + tanggal lahir tanpa tahun dan token
   `kl1.<256 bit>` berumur 180 detik. Token sekali pakai,
   hanya di perangkat yang sama, hanya hash-nya disimpan (`kiosk_lookups`); check-in, tiket, dan registrasi menukarnya.
   Token perangkat lain → 410 yang sama, tercatat. Header `Idempotency-Key` yang sama → tiket yang sama.
2. **Anti-enumerasi.** Jawaban identifikasi selalu 200 dengan baris jejak yang sama (ditemukan atau tidak, tanpa nilai
   yang diketik); `kiosk.lookup_rate_per_min` per perangkat dan `kiosk.lookup_rate_per_tenant_per_min` per RS (bawaan
   10 dan 60) dihitung dari jejak itu di bawah kunci advisori pencarian se-RS; pelanggaran 429 tetap tercatat
   (`AuditedDenial` dengan kode/status sendiri, alasan `rate_limited` / `tenant_rate_limited`). NIK ganda → tidak
   ditemukan.
3. **Sumber daya bersama dibatasi per perangkat** (review keamanan potongan 9): tiket loket tanpa identitas 6 per menit
   (nomor harian per layanan terbatas 999), "panggil petugas" sekali per 60 detik (sentuhan ulang tidak membuat
   notifikasi baru), cetak tiket hanya untuk tiket yang tercatat bagi perangkat itu hari ini (`kiosk_tickets`).
4. **Registrasi anjungan memakai alur loket** (`RegistrationService`, potongan 5a) atas nama perangkat; hal yang butuh
   petugas (persetujuan umum belum ada, rujukan belum tercatat, kuota penuh) → 422 `KIOSK_NEEDS_COUNTER` dan tawaran
   nomor loket.

### Revisi keputusan fase 2 §4 #3 (5 Okt 2026, orkestrator dengan mandat pemilik produk)

Temuan review keamanan potongan 9: tanpa faktor kedua, siapa pun di depan anjungan bisa mengetahui bahwa pemilik
NIK/kartu/kode booking (kode `YYMMDD` + 4 digit bisa ditebak berurutan) adalah pasien RS ini, lalu memakai tokennya untuk
check-in atau registrasi. Keputusan baru:

- Pasien mengetik nomor identitas **dan** tanggal + bulan lahir (`DDMM`, keypad kedua dengan target sentuh yang sama).
  Keduanya dikirim dalam satu permintaan (`kioskIdentifySchema.birthDdmm`), jadi API tidak pernah memberi tahu bahwa
  nomornya saja yang cocok.
- DDMM salah → jawaban persis sama dengan "tidak ditemukan" (200 `{found:false}`, tanpa token, baris jejak
  `found=false`), dibandingkan waktu-konstan, tetap dihitung batas laju, dan dicatat audit dengan pasien kandidatnya
  (`details.birthMismatch`) sebagai bahan tinjauan petugas privasi.
- Batas pencarian per RS (`kiosk.lookup_rate_per_tenant_per_min`, bawaan 60/menit) di atas batas per perangkat, agar
  enumerasi tidak bisa dibagi ke banyak anjungan.
- Nama tersamar + tanggal lahir tanpa tahun tetap ditampilkan sesudahnya sebagai konfirmasi ("Apakah ini data Anda?").

