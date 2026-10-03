# ADR-0014 · Zona waktu sesi database dipaksa UTC untuk semua koneksi Prisma

Status: diterima · 4 Okt 2026

## Konteks
Saat membangun layar Audit, filter waktu jejak audit meleset tepat 7 jam. Pengukuran langsung (Postgres portabel dengan `timezone = Asia/Jakarta`, Prisma 7.10 + `@prisma/adapter-pg`):
- `Date` yang ditulis Prisma tersimpan **7 jam lebih awal** dari instan sebenarnya (adapter mengirim waktu UTC tanpa zona, Postgres menafsirkannya dalam zona sesi);
- `timestamptz` yang dibaca Prisma **7 jam lebih lambat** (adapter membuang offset `+07`);
- driver `pg` biasa membaca dengan benar.

Nilai yang ditulis lalu dibaca lewat Prisma tampak konsisten, sehingga tes lama tidak menangkapnya. Yang salah: waktu buatan database (`clock_timestamp()` di trigger audit, `now()` di SQL) terbaca +7 jam; perbandingan SQL antara waktu buatan database dan parameter Prisma meleset 7 jam; dan semua waktu tersimpan bukan instan yang benar bagi konsumen lain (laporan SQL, integrasi). Docker Postgres (zona UTC) tidak terkena; server mana pun yang zonanya disetel lokal akan terkena.

## Keputusan
1. `createPrismaClient` (satu-satunya pembuat klien: API, worker, seed, CLI, tes) mengirim `options: '-c TimeZone=UTC'`. Zona server tidak lagi berpengaruh.
2. Semua tampilan dan pengelompokan per hari tetap dalam Asia/Jakarta secara eksplisit: di aplikasi lewat `@simrs/shared` (`formatTanggalWaktu`, `jakartaParts`), di SQL lewat `AT TIME ZONE 'Asia/Jakarta'`. Tidak ada SQL yang bergantung pada zona sesi.
3. Tes regresi `packages/db/test/time-zone.test.ts` memastikan instan tulis = instan tersimpan dan `now()` database terbaca sesuai jam aplikasi. Postgres portabel tes sengaja tetap ber-zona Asia/Jakarta agar tes ini bermakna.

## Konsekuensi
+ Waktu tersimpan dan terbaca benar di zona server apa pun; kedaluwarsa sesi, jejak audit, dan laporan konsisten.
− Data lokal yang ditulis sebelum perbaikan (seed dan tes, semuanya fiktif) memiliki waktu bergeser −7 jam; tidak dikoreksi.
− Bila kelak ada klien database lain (mis. alat BI), ia harus membaca `timestamptz` dengan offset atau memakai zona UTC.
