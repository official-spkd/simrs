# 05 · Keamanan dan kepatuhan

Rujukan: KMK 1596/2024 (MRMIK), Permenkes 24/2022 tentang Rekam Medis, UU 27/2022 tentang Pelindungan Data Pribadi, ketentuan TTE. Ringkasan per elemen ada di `03-regulasi-mrmik.md`. Dokumen ini menerjemahkannya ke kontrol teknis yang wajib dibangun.

## 1. Kontrol wajib dan tempatnya

| Kontrol | Komponen | Fase | Kriteria teknis |
|---|---|---|---|
| Akun per orang, tanpa akun bersama | P02 | 1 | Satu `user` = satu orang; login dicatat; akun nonaktif otomatis saat penugasan berakhir |
| MFA | P02 | 1 | TOTP untuk semua staf; peran sensitif (admin, keuangan, rekam medis) wajib; login cepat (PIN 6 digit) hanya di perangkat terdaftar dalam unit, sesi pendek |
| Sesi | P02 | 1 | Akses token 15 menit, refresh token rotasi; timeout idle 15 menit di area klinis; kunci layar cepat |
| Kebijakan password | P02 | 1 | Panjang ≥ 12, cek daftar bocor (lokal: daftar statis), argon2id |
| RBAC + ABAC | P03 | 1 | Izin = peran × unit × relasi pasien × jenis formulir; ditegakkan di guard API **dan** di query (filter) |
| Break-the-glass | P03 | 1 | Alasan wajib, durasi 60 menit, notifikasi ke petugas privasi, laporan harian |
| Audit trail | P04 | 1 | Semua baca/ubah/cetak/ekspor data pasien; hash berantai; tidak bisa di-UPDATE/DELETE oleh role aplikasi; laporan anomali (akses malam, volume tak wajar, akses pasien VIP/karyawan) |
| Koreksi berversi | P04, K* | 1–3 | Tidak ada UPDATE pada entri final; koreksi = versi baru + alasan; tampilan diff v1→v2 |
| TTE | P10 | 3 | Dokumen final (resume, consent, hasil, resep) ditandatangani; hash disimpan; verifikasi tanda tangan saat dibuka |
| Isolasi tenant | P01, db | 0–1 | RLS + tes otomatis |
| Perangkat publik (anjungan, TV) | P02, F04, F05 | 2 | Prinsipal perangkat terdaftar per unit dengan izin tetap (ADR-0027), bukan akun staf; anjungan tanpa ID pasien/RM/NIK di jawaban, token pencarian sekali pakai, batas pencarian dan tiket per perangkat, audit atas nama perangkat; TV hanya papan yang terikat (SSE tanpa PHI) |
| Endpoint publik tanpa login | F08 | 2 | Tanpa PHI (skema jawaban ketat), kode booking + tanggal lahir di body, perbandingan waktu-konstan, batas laju per IP **dan** batas tanggal lahir salah per kode booking (404 seragam, diaudit), audit setiap percobaan; RS tak dikenal = RS dengan F08 mati (jawaban dan kerja database sama). Sisa risiko: lihat §6 |
| Enkripsi | db, infra | 1 | TLS di semua koneksi (produksi); kolom identitas dienkripsi; backup terenkripsi |
| Persetujuan privasi | P05 | 1 | Persetujuan umum dan pembukaan data (mis. ke asuransi) dicatat dan bisa dicabut |
| Hak subjek data (UU PDP) | B09 | 8 | Permintaan salinan RM, koreksi data identitas, log siapa mengakses RM pasien |
| Downtime | P13 | 10 | Prosedur dan mode edge; formulir cetak darurat; sinkron ulang dengan rekonsiliasi |
| Backup 3 lokasi | infra | 10 | RPO ≤ 15 menit, RTO ≤ 4 jam (usulan, konfirmasi NFR) |

## 2. Model izin (ringkas)

```
izin = { sumber: "cppt", aksi: "write", lingkup: { unit: "melati", relasi: "perawat-ruangan" } }
```
- Peran bawaan: `admin_tenant`, `petugas_pendaftaran`, `perawat`, `bidan`, `dokter`, `dokter_residen` (wajib co-sign), `apoteker`, `analis_lab`, `radiografer`, `kasir`, `koder`, `akuntan`, `petugas_rm`, `manajemen`, `auditor_mutu`, `petugas_privasi`.
- Relasi pasien dihitung dari `staff_assignments` + `access_relationships` + lokasi pasien saat ini.
- Formulir klinis menyatakan PPA yang boleh menulis (`form_definitions.write_roles`).

## 3. Aturan PHI di kode

- Jangan menulis nama, NIK, nomor BPJS, diagnosis ke log aplikasi atau pesan error. Pakai ID internal.
- Respons API tidak mengembalikan NIK utuh kecuali endpoint khusus yang diaudit; tampilan default tersamar (`3174••••••••0012`).
- Ekspor (PDF/Excel) selalu diaudit dan diberi watermark nama pengakses + waktu.
- Seed dan tes hanya data fiktif.

## 4. Keamanan aplikasi

- OWASP ASVS L2 sebagai acuan; rate limit login, OTP, dan webhook.
- Validasi semua input dengan zod; output encoding di web (React default) + CSP ketat.
- CSRF: API berbasis token di header; cookie refresh `httpOnly`, `secure`, `SameSite=strict`.
- Upload: batasi tipe dan ukuran, pindai (produksi), simpan di MinIO dengan nama acak, akses lewat URL bertanda tangan berumur pendek.
- Dependensi: `pnpm audit` di CI; kunci versi (`pnpm-lock.yaml`).
- Rahasia: `.env` lokal; produksi memakai secret manager. Rotasi secret webhook TPDI dan kredensial BPJS/SATUSEHAT terjadwal.

## 5. Checklist review keamanan per PR (dipakai `/review-keamanan`)

- [ ] Semua query modul baru tunduk RLS (tidak ada koneksi role migrator di runtime)
- [ ] Endpoint baru punya guard izin + tes 403 untuk peran yang tidak berhak + tes tenant lain
- [ ] Akses data pasien tercatat di audit
- [ ] Tidak ada PHI di log/pesan error
- [ ] Entri klinis tidak di-UPDATE/DELETE; koreksi berversi
- [ ] Panggilan eksternal lewat outbox; webhook diverifikasi + idempotent
- [ ] Uang `bigint`; jurnal seimbang
- [ ] Tidak ada rahasia di kode atau di commit
- [ ] Gerbang statis rute hijau (`apps/api/test/route-security.test.ts`, ADR-0076): endpoint baru masuk golongan staf
      (izin), perangkat, swalayan, atau publik (batas laju); entri baru di daftar pengecualian disertai alasan
- [ ] Lingkup `unit`/`relationship` ditegakkan di service untuk SETIAP id yang diterima (pasien, kunjungan, bed,
      permintaan, entri), bukan hanya di endpoint baca; tes 403 dari unit lain
- [ ] Potret awal SSE dan laporan/daftar berisi PHI mencatat audit per pasien (`patientId`)
- [ ] Operasi outbox HTTP baru: payload hanya ID; potongan respons hanya bila `sensitive: false` (ADR-0076)
- [ ] Redirect setelah login/aksi memakai `safeNextPath` (diperiksa ulang SETELAH normalisasi URL)
- [ ] Konfigurasi produksi gagal aman: variabel baru yang berbahaya bila bawaan (mock, disk, memori) ditolak saat start

## 6. Sisa risiko yang diterima

- **Keberadaan RS lewat endpoint publik (F08).** RS tak dikenal, RS nonaktif, dan RS dengan F08 mati dijawab 404
  `NOT_FOUND` yang sama dan menjalankan kerja database yang setara (resolver + satu transaksi bertenant + baca modul).
  Yang tersisa: (1) variasi waktu jaringan/cache Postgres masih bisa membedakan secara statistik bila penyerang
  mengulang banyak permintaan, ditekan batas laju per IP; (2) RS dengan F08 aktif memang terbuka (jadwalnya publik);
  (3) jalur lain yang menerima kode RS (pendaftaran perangkat `/devices/enrol`; masuk staf hanya di luar produksi,
  produksi memakai host) punya penanganan sendiri dan belum diseragamkan dengan ini. Bila daftar RS dianggap rahasia,
  pakai host per RS (bukan kode di path) dan samakan jalur-jalur itu.
- **Batas tanggal lahir salah per kode booking** bisa dipakai orang lain untuk mengunci status booking seorang pasien
  (kode booking `YYMMDD` + 4 digit bisa ditebak). Dampaknya hanya layanan informasi publik selama jendela batas;
  booking, check-in, dan antrean tidak terpengaruh. Penghitung berada di Redis bersama; bila Redis gagal, hitungan
  sementara per instans API (endpoint ini juga memakai batas endpoint kredensial yang gagal tertutup di produksi).
- **Host permintaan dari `X-Forwarded-Host` (web BFF → API).** Di produksi RS ditentukan dari host. Web mengambil
  host dari `X-Forwarded-Host`/`Host` permintaan masuk dan API mempercayai web (`TRUST_PROXY`). Reverse proxy di depan
  web WAJIB menimpa (bukan menambah) `X-Forwarded-Host` dan `Host`; bila tidak, klien bisa memilih RS lain saat login
  (kredensial RS itu tetap dibutuhkan, tetapi kontrol per subdomain seperti allowlist IP/WAF bisa dilewati).
- **Pulang/meninggal lewat `bed.write`.** Sampai gerbang tutup kunjungan potongan 3.6 (`DischargeGate`: resume final
  ber-TTE, surat kematian, surat rujukan) terpasang, peran ber-`bed.write` lingkup `all` (admisi) bisa memulangkan
  kunjungan IGD/rawat inap dengan disposisi apa pun, termasuk `meninggal`. Tercatat di audit dan event domain.
- **Infra lokal.** Docker Compose memakai kata sandi lokal yang diketahui, Redis tanpa kata sandi, dan kredensial root
  MinIO juga dipakai aplikasi; semua port hanya di loopback (ADR-0076). Lingkungan bersama/edge wajib memakai rahasia
  sendiri, Redis ber-`requirepass`, dan pengguna MinIO berkebijakan terbatas ke bucket aplikasi.
- **Dependensi pengembangan.** `pnpm audit --prod` bersih. Tersisa advisori dev-only: `deepmerge-ts` < 8 (lewat
  `@prisma/config`, butuh naik mayor) dan `esbuild` < 0.28.1 (pembacaan berkas dev server di Windows, lewat tsup/vite);
  tidak terjangkau input pengguna. Naikkan bersama pembaruan prisma/tsup berikutnya.
