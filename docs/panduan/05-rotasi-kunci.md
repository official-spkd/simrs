# Rotasi kunci enkripsi kolom

Runbook operator untuk mengganti kunci enkripsi kolom (`FIELD_ENCRYPTION_KEY`) dan kunci blind index (`FIELD_HASH_KEY`) tanpa henti layanan. Keputusan dan alasannya: ADR-0015 bagian "Pembaruan 5 Okt 2026". Jalankan dulu di staging dengan salinan data produksi yang sudah dianonimkan.

## 1. Yang dilindungi kunci kolom

| Tabel                 | Kolom                                                | Kunci                                    |
| --------------------- | ---------------------------------------------------- | ---------------------------------------- |
| `patients`            | `address_enc`, `phone_enc` · `phone_hash`            | enkripsi · hash                          |
| `patient_identifiers` | `value_enc` (NIK, BPJS, IHS, paspor) · `value_hash`  | enkripsi · hash                          |
| `patient_contacts`    | `name_enc`, `phone_enc`, `address_enc`               | enkripsi                                 |
| `coverages`           | `member_no_enc` (no. anggota asuransi/perusahaan)    | enkripsi                                 |
| `patient_links`       | `survivor_snapshot_enc` (berisi ciphertext dan hash) | enkripsi + isi bersarang (enkripsi/hash) |
| `users`               | `phone_enc` (no. HP staf)                            | enkripsi                                 |
| `mfa_factors`         | `secret_enc` (rahasia TOTP)                          | enkripsi                                 |
| `login_challenges`    | `otp_enc` (kode cadangan login, berlaku 5 menit)     | enkripsi                                 |
| `registered_devices`  | `pin_hash` (argon2id dari lada HMAC) · `pin_key_id`  | hash (lada PIN)                          |

Tidak terpengaruh: kata sandi (argon2id tanpa kunci), token sesi, token perangkat tepercaya, dan token perangkat PIN (SHA-256 tanpa kunci), serta kode verifikasi dokumen.

## 2. Format env: cincin kunci

```bash
# Kunci baru: openssl rand -base64 32 (satu untuk enkripsi, satu untuk hash; JANGAN sama)
FIELD_ENCRYPTION_KEYS=v2:<base64 baru>,v1:<base64 lama>
FIELD_HASH_KEYS=v2:<base64 baru>,v1:<base64 lama>
# Format lama tetap didukung sebagai kunci v1. Bila cincin memuat v1, nilainya wajib sama (atau kosongkan).
FIELD_ENCRYPTION_KEY=<base64 lama>
FIELD_HASH_KEY=<base64 lama>
```

- **Kunci pertama = kunci aktif**: semua tulisan baru memakainya. Kunci lain hanya untuk membaca data lama.
- ID kunci `v1`…`v999`. Ciphertext berawalan ID kuncinya (`v2.…`); blind index kunci v1 tetap 64 hex, kunci lain `v2:<64 hex>`.
- Pencarian sama-persis (NIK, BPJS, cek NIK ganda, deteksi rekam medis ganda) memakai hash untuk **semua** kunci di cincin, jadi baris yang belum dienkripsi ulang tetap ditemukan.
- API, worker, CLI rotasi, dan server edge (ADR-0070) harus memakai cincin yang **sama**. Konfigurasi salah (format, panjang, ID ganda, kunci dipakai ulang, v1 berbeda, kunci enkripsi = kunci hash) membuat aplikasi gagal start dengan pesan `Konfigurasi env tidak valid → …` tanpa mencetak nilai kunci.

## 3. Langkah rotasi

### Tahap 0 · Persiapan

1. Simpan kunci lama dan kunci baru di brankas rahasia (pemegang kunci sama dengan kunci backup). **Kunci lama tetap disimpan selama masih ada backup yang dibuat sebelum rotasi** (backup berisi data berkunci lama).
2. Backup database (`infra/backup`) dan pastikan uji restore terakhir lolos.
3. Catat keadaan awal: `pnpm db:rotate-keys --dry-run` (semua kolom `v1=…`, tanpa baris `!`).

### Tahap A · Pasang kunci baru sebagai kunci baca (belum aktif)

```bash
FIELD_ENCRYPTION_KEYS=v1:<lama>,v2:<baru>
FIELD_HASH_KEYS=v1:<lama>,v2:<baru>
```

Terapkan ke **semua** instans API dan worker (serta edge), lalu mulai ulang satu per satu. Tujuannya: sebelum ada data v2, semua instans sudah bisa membacanya. Tulisan masih memakai v1.

### Tahap B · Jadikan kunci baru aktif

Tukar urutan setelah semua instans menjalankan tahap A:

```bash
FIELD_ENCRYPTION_KEYS=v2:<baru>,v1:<lama>
FIELD_HASH_KEYS=v2:<baru>,v1:<lama>
```

Mulai ulang semua instans. Sejak ini data baru memakai v2; data lama tetap terbaca dan tercari lewat v1. PIN yang didaftarkan sesudahnya dilada dengan kunci hash v2 (`pin_key_id = v2`); PIN lama tetap berlaku.

### Tahap C · Enkripsi ulang data lama

```bash
pnpm db:rotate-keys --dry-run                 # rencana + pemeriksaan kunci, tidak menulis
pnpm db:rotate-keys --run                     # semua tenant (juga tenant nonaktif)
pnpm db:rotate-keys --run --tenant RSFA       # satu RS (tenant nonaktif: pakai UUID-nya)
pnpm db:rotate-keys --run --batch 100 --pause-ms 500   # lebih pelan di jam sibuk
```

Atau biarkan worker yang menjalankan: `FIELD_KEY_ROTATION=auto` (putaran tiap `FIELD_KEY_ROTATION_INTERVAL_MINUTES`, hanya selama cincin masih memuat lebih dari satu kunci).

Sifat job:

- Satu transaksi pendek per batch (`FIELD_KEY_ROTATION_BATCH`, bawaan 200 baris) dengan jeda `FIELD_KEY_ROTATION_PAUSE_MS`; menunggu kunci baris paling lama 5 detik, jadi tidak menahan transaksi aplikasi.
- **Bisa dihentikan kapan saja** (Ctrl+C, worker berhenti, server mati). Kursor per tenant × tabel tersimpan di `field_key_rotations`; menjalankan lagi melanjutkan dari batch terakhir yang selesai.
- Idempoten dan aman berjalan bersamaan dengan aplikasi (compare-and-swap per baris) maupun dengan pelari lain (worker + CLI menunggu bergiliran per batch).
- Gagal tertutup: sebelum menulis, setiap versi kunci yang ada di data diperiksa (ID ada di cincin, contoh baris bisa didekripsi, blind index cocok). Bila ada masalah, tenant itu dihentikan tanpa menulis apa pun (lihat §5).
- Satu entri audit `update` · `field_key_rotation` per tenant (jumlah baris per tabel, tanpa nilai).

### Tahap D · Verifikasi

```bash
pnpm db:rotate-keys --dry-run
```

Siap bila untuk **setiap** tenant: semua kolom hanya `v2=…` (kolom hash: `v2`), `perlu ditulis ulang 0`, tanpa baris `!`, dan baris terakhir berbunyi `Semua tenant siap: kunci lama boleh dihapus dari cincin`. Status per tabel (`putaran …: dipindai, ditulis ulang, gagal, sisa`) juga tercetak; baris yang gagal tercatat kodenya (`last_error`) dan ID baris terakhir (`last_failed_id`) di `field_key_rotations`.

Uji sampel di aplikasi: cari pasien lama dengan NIK, buka identitas utuh, login staf lama (MFA), dan masuk dengan PIN.

### Tahap E · PIN masuk cepat

Lada PIN bergantung pada kunci hash, dan PIN tidak bisa dienkripsi ulang (sistem tidak mengetahui PIN-nya). Pilih salah satu:

- **Rotasi terencana**: biarkan kunci hash lama di cincin minimal 30 hari setelah tahap B. PIN lama kedaluwarsa sendiri (masa berlaku maks. 30 hari) dan staf mendaftar ulang PIN dengan kunci baru. `--dry-run` menampilkan `PIN aktif per kunci lada: v1=…`.
- **Kunci lama diduga bocor**: `pnpm db:rotate-keys --run --revoke-old-pins` mencabut segera semua PIN berlada kunci lama (alasan `key_rotated`, sesi PIN-nya ikut berakhir, tercatat di audit). Staf masuk dengan sandi + kode verifikasi lalu mendaftar PIN lagi.

Bila kunci lama dihapus sementara masih ada PIN berladanya, PIN itu dicabut `key_rotated` saat dipakai (audit `login_failed` alasan `pin_key_retired`) — tidak gagal diam-diam.

### Tahap F · Pensiunkan kunci lama

```bash
FIELD_ENCRYPTION_KEYS=v2:<baru>
FIELD_HASH_KEYS=v2:<baru>
FIELD_ENCRYPTION_KEY=
FIELD_HASH_KEY=
```

Terapkan ke semua instans, mulai ulang, lalu `pnpm db:rotate-keys --dry-run` sekali lagi (tidak boleh ada `FIELD_KEY_UNKNOWN`). Kunci lama tetap di brankas sampai backup terakhir yang memuatnya kedaluwarsa.

## 4. Rollback

| Keadaan                            | Langkah                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Di tahap A atau B, ada masalah     | Kembalikan cincin ke tahap sebelumnya (atau hanya kunci lama); data v2 yang sudah tertulis tetap terbaca selama v2 masih di cincin.                                                                        |
| Di tahap C/D, ingin kembali ke v1  | Jadikan v1 aktif lagi (`v1:<lama>,v2:<baru>`), terapkan ke semua instans, lalu `pnpm db:rotate-keys --run`: job menulis ulang semua data ke kunci aktif (v1). Hapus v2 setelah verifikasi seperti tahap D. |
| Setelah tahap F, data tak terbaca  | Pasang lagi kunci lama dari brankas sebagai kunci baca (`v2:<baru>,v1:<lama>`) dan jalankan `--dry-run` untuk melihat sumbernya. Tanpa kunci lama, data berkunci lama tidak bisa dipulihkan.               |
| Restore backup dari sebelum rotasi | Backup berisi data v1: pasang cincin yang memuat v1 (dari brankas), lalu ulangi tahap C.                                                                                                                   |

## 5. Galat dan artinya

| Kode                        | Arti                                                                                         | Tindakan                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `FIELD_KEY_UNKNOWN:<id>`    | Data memakai kunci yang tidak ada di cincin (dipensiunkan terlalu cepat atau lupa dipasang). | Pasang lagi kunci itu sebagai kunci baca, lalu ulangi tahap C.    |
| `FIELD_DECRYPT_FAILED:<id>` | Ada kunci dengan ID itu, tetapi isinya salah (salah salin) atau data rusak.                  | Periksa nilai kunci di semua instans; bandingkan dengan brankas.  |
| `BLIND_INDEX_MISMATCH:<id>` | Kunci hash dengan ID itu tidak cocok dengan hash tersimpan (kunci hash salah).               | Periksa `FIELD_HASH_KEYS`; jangan tertukar dengan kunci enkripsi. |
| `FIELD_FORMAT`              | Nilai tersimpan bukan format enkripsi kolom.                                                 | Selidiki baris itu (`last_failed_id`); jangan dipaksa.            |

Pesan galat, log, status, dan audit hanya memuat kode, nama tabel/kolom, ID kunci, dan jumlah baris — tidak pernah nilai, plaintext, maupun kunci.

## 6. Catatan teknis

- Nilai yang tidak boleh diubah aplikasi (identifier pasien, snapshot penggabungan, kontak pasien append-only) ditulis ulang lewat fungsi database sempit (`app_rekey_patient_identifier`, `app_rekey_patient_link`, `app_rekey_patient_contact`, `app_rekey_coverage_member` untuk penjaminan yang terkunci sejak SEP terbit): hanya bila versi kuncinya berganti, compare-and-swap, dan tetap tunduk RLS. Hak kolom role aplikasi tidak bertambah.
- Daftar tenant job = `app_key_rotation_tenant_ids()` (semua tenant, juga yang nonaktif, karena retensi rekam medis): hanya ID, pola ADR-0008.
- Kode: `packages/shared/src/security/field-keys.ts` (cincin), `field-crypto.ts` (format), `packages/db/src/key-rotation.ts` (job), `packages/db/scripts/rotate-keys.ts` (CLI), `apps/worker/src/key-rotation/` (job worker).
