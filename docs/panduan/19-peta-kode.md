# Peta kode

Halaman ini memetakan **di mana kode tiap fitur berada** dan **seberapa matang** tiap bagian. Bacalah setelah [Cara kode bekerja](./02-cara-kerja-kode.md), yang menjelaskan mekanismenya (permintaan API, RLS, outbox, sesi web). Penjelasan per layar ada di halaman fitur, mulai dari [Fitur platform](./10-fitur-platform.md).

> Status 6 Okt 2026 (putaran 2): fase 0–2 selesai, fase 3 (klinis RME) berjalan dengan API potongan 3.1–3.4 tergabung. Registri `SCREENS` berisi **80 layar**: 68 demo, 11 hibrida (demo + api), 1 khusus api. 49 layar demo baru (FE1–FE5) menutup semua komponen katalog yang punya layar; backend-nya menyusul per fase. Peta per fase: [Peta alur semua fase](./20-peta-alur-semua-fase.md). Status resmi selalu di `docs/PROGRESS.md`.

## Gambaran besar

![Diagram arsitektur: kanal → web Next.js (BFF) → API NestJS → PostgreSQL dengan RLS → outbox → worker → sistem luar (lokal: mock)](./gambar/diagram-arsitektur.svg)

| Bagian          | Folder                 | Isi singkat                                                                            |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| Web (BFF)       | `apps/web/src`         | Halaman Next.js, Server Action, gerbang layar, data dummy mode presentasi              |
| API             | `apps/api/src/modules` | 40 modul per bounded context; fondasi di `src/common` dan `src/infra`                  |
| Worker          | `apps/worker/src`      | Pengirim outbox (`outbox/`), job berkala (`jobs/`), jangkar audit, rotasi kunci        |
| Mock            | `apps/mock/src`        | Tiruan BPJS, E-Klaim, SATUSEHAT, Dukcapil, TTE, TPDI, BTN + panel kendali (`panel/`)   |
| Kontrak bersama | `packages/shared/src`  | Skema zod, izin, komponen, uang, tanggal, mesin aturan klinis (`clinical/`)            |
| Database        | `packages/db`          | Skema Prisma multi-berkas, migrasi dengan RLS, seed, `withTenant`, helper tes          |
| UI              | `packages/ui/src`      | Token desain dan komponen dasar (`AppShell`, `PatientBanner`, `SafetyGate`, `Tabs`, …) |
| PDF             | `packages/pdf`         | PDF klinis deterministik (resep, resume) untuk TTE                                     |

## Web: satu layar, dua sumber data

![Diagram satu layar dua sumber data: page.tsx memanggil requireScreen; mode presentasi memakai komponen demo dan fixture, mode api memeriksa izin lalu memanggil API](./gambar/diagram-layar-demo-api.svg)

Setiap layar fase 2–10 tinggal di **rute finalnya**. Sumber datanya ditentukan saat permintaan, bukan saat build:

1. `webEnv().dataSource` bernilai `demo` hanya bila `APP_ENV=local` **dan** `DATA_SOURCE=demo` (`apps/web/src/lib/server/web-env.ts`). Di luar itu `api`.
2. Registri `SCREENS` (`apps/web/src/lib/screens.ts`) menyimpan untuk tiap layar: `id`, `route`, `mockup`, `components`, `phase`, `status` (`belum` → `demo` → `api`), `demoRoles` (posisi pemakai di mode presentasi), `permission` (izin sungguhan untuk layar hibrida), dan `apiOnly`.
3. Menu (`apps/web/src/lib/nav.ts`) dan gerbang halaman membaca registri yang sama lewat `screenOpen()`.

### Tiga jenis layar

| Jenis          | Gerbang di `page.tsx`                                | Contoh                                                                                                                 | Mode api                                    |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Hibrida (11)   | `requireScreen(id)` (`lib/server/screen-guard.ts`)   | Pendaftaran, Jadwal, Anjungan, Display, 7 layar klinis pertama (poli, CPOE, IGD, bed, rawat inap, resume, persetujuan) | Sesi + izin; tanpa izin → "Akses ditolak"   |
| Demo saja (68) | `requireDemoScreen(id)` (`lib/server/demo-guard.ts`) | Semua layar fase 4–10, 10 layar RME FE2, 5 layar platform FE1, Rujukan, Info publik                                    | 404, menu redup                             |
| Api saja (1)   | `requireScreen(id)` + `apiOnly: true` di registri    | Kendali antrean (`/antrean`)                                                                                           | Terbuka sesuai izin; di mode presentasi 404 |

Layar fase 1 (Akses, Audit, MPI, Formulir, Notifikasi, PIN) bukan bagian registri: halamannya langsung memanggil `requireSession()` dan API.

### Berkas per layar hibrida

Contoh lengkap: `apps/web/src/app/(staf)/pendaftaran/`.

| Berkas                          | Peran                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `page.tsx`                      | Komponen server: `requireScreen`, lalu cabang demo atau api                                |
| `demo-<layar>.tsx`              | Jalur mode presentasi (dibekukan saat jalur api dibangun)                                  |
| `actions-demo.ts`               | Server Action demo; setiap action memanggil `assertDemo()` (action = endpoint POST publik) |
| `api-<layar>.tsx`               | Jalur api (komponen server yang memanggil `api()`)                                         |
| `actions.ts` / `actions-api.ts` | Server Action api: cek sesi + input sendiri, panggil API lewat BFF                         |
| `*-client.tsx`, panel           | Bagian interaktif (`'use client'`); tidak membaca env atau rahasia                         |

Layar klinis yang jalur api-nya belum dibangun (W1–W5) menampilkan `ScreenNotConnected` ("Belum tersambung", `components/screen-gate.tsx`), contohnya `app/(staf)/klinis/poli/page.tsx`.

### Data dummy dan aturan murni

| Lapisan               | Lokasi                                                                                | Catatan                                                                            |
| --------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pengambil data        | `lib/server/data/<domain>.ts`, `front-office/*`, `klinis/*`                           | Memilih fixture (demo) atau API; divalidasi skema `packages/shared/src/schemas/`   |
| Fixture               | `lib/demo/fixtures/*.ts`                                                              | Pasien fiktif (`pasien.ts`, roster satu tempat per pasien), staf, RS, waktu demo   |
| ID fixture            | `lib/demo/fixtures/ids.ts`                                                            | UUID v7 konstan; layar dan E2E mengimpornya, tidak menulis literal                 |
| Aturan bisnis murni   | `lib/<domain>.ts` (mis. `klinis-cds.ts`, `rawat-inap.ts`, `keuangan.ts`, `btn-ok.ts`) | Tanpa I/O, diuji unit; aturan klinis memanggil mesin `@simrs/shared/clinical`      |
| Mesin skenario        | `lib/demo/engine/` (`run.ts` putar ulang murni)                                       | Tiga skenario di `lib/demo/skenario/` (rawat jalan, IGD → rawat inap, elektif BTN) |
| Keadaan simulasi      | `lib/server/demo/store.ts`                                                            | Berkas JSON per akun demo (`DEMO_STATE_DIR`), berisi urutan aksi saja              |
| Akun presentasi       | `lib/server/demo/accounts.ts`, `login.ts`                                             | "Masuk cepat · mode presentasi" di `/masuk`                                        |
| Komponen bersama demo | `components/{klinis,rawat-inap,penunjang,keuangan,btn,manajemen,front-office}/`       | Dipakai layar demo per domain                                                      |

Penjelasan pemakaian mode presentasi untuk presentasi ada di [Simulasi dan operasional](./18-simulasi-dan-operasional.md).

### Pola bersama layar lanjutan (FE1–FE5)

Layar demo putaran 2 memakai beberapa bagian bersama. Pakai ulang bagian ini untuk layar baru di domain yang sama.

| Bagian                   | Lokasi                                                                                                                                                                                              | Dipakai untuk                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kit back office          | `components/backoffice/kit.tsx`                                                                                                                                                                     | `Panel` berjudul, `FlashLine` umpan balik berjam, `StageTrack` jejak tahap yang tidak bisa dilompati, tombol nonaktif beralasan, konfirmasi beralasan (fase 8–9) |
| Kepala bagan RME         | `components/rme/chart-header.tsx` (`RmeChartHeader`), `patient-picker.tsx`, `feedback.tsx`                                                                                                          | Judul + banner pasien wajib (nama, umur, RM, alergi, penjamin) + konteks kunjungan + navigasi antarlayar RME untuk pasien yang sama                              |
| Sub-menu integrasi       | `components/integrasi/integrasi-subnav.tsx` (`IntegrasiSubnav`, `INTEGRASI_LINKS`)                                                                                                                  | Hub + satu layar per konektor (SATUSEHAT, BPJS, Kemenkes, perangkat, API publik)                                                                                 |
| Jurnal berpasangan       | `components/keuangan/jurnal-pasangan.tsx` (`JurnalPasangan`), `alasan-form.tsx`                                                                                                                     | Setiap mutasi uang menampilkan akun, debit, kredit, total, dan "Seimbang (debit = kredit)" dalam teks; nilai `bigint` rupiah                                     |
| Bagian platform          | `components/platform/parts.tsx`, `codes.tsx`                                                                                                                                                        | Papan struktur, pengaturan, data rujukan, dokumen, penjadwal                                                                                                     |
| Tahap penunjang          | `components/penunjang/stage-steps.tsx`                                                                                                                                                              | Tahap berurutan (kultur, ekspertise, crossmatch) di layar penunjang lanjutan                                                                                     |
| Data server per kelompok | `lib/server/data/penunjang-lanjut.ts`, `keuangan-lanjut.ts`, `integrasi-lanjut.ts`, `backoffice.ts`, `platform.ts`, `klinis/rme.ts`                                                                 | Pengambil data mode presentasi; setiap fungsi memanggil `assertDemo()`. Hasil kritis membaca keadaan skenario (`scenarioRuns`)                                   |
| Aturan murni per layar   | `lib/rme-*.ts`, `lib/penunjang-*.ts`, `lib/keuangan-*.ts`, `lib/integrasi-*.ts`, `lib/platform-*.ts`, `lib/operasional-*.ts`, dan satu berkas per layar back office (`lib/sdm.ts`, `lib/ppi.ts`, …) | Gerbang dan perhitungan tanpa I/O, masing-masing dengan `*.test.ts`                                                                                              |
| Fixture per layar        | `lib/demo/fixtures/<layar>.ts` (mis. `rme-cppt.ts`, `penunjang-depo.ts`, `kas-bank.ts`, `golive.ts`)                                                                                                | Data dummy fiktif; ID tetap dari `ids.ts`                                                                                                                        |

## Pola menambah layar baru

1. **Daftarkan** layar di `SCREENS` (`apps/web/src/lib/screens.ts`): `id` sama dengan id menu, `route` final dari `docs/08-desain-ui.md` §4, `mockup`, `components`, `phase`, `status: 'belum'`, `plannedPermission`, `demoRoles`, `layout`.
2. **Menu**: tambah item di `NAV_GROUPS` (`apps/web/src/lib/nav.ts`) dengan id yang sama. Status `belum` membuatnya redup.
3. **Data**: skema respons di `packages/shared/src/schemas/<domain>.ts`, fixture fiktif di `lib/demo/fixtures/` (ID dari `ids.ts`, pasien baru juga masuk `ROSTER`), pengambil data di `lib/server/data/<domain>.ts`.
4. **Aturan**: logika murni (total, gerbang, validasi) di `lib/<domain>.ts` + tes unit `lib/<domain>.test.ts`. Gerbang keselamatan memakai `SafetyGate` dari `@simrs/ui`; alasan override minimal sesuai `SAFETY_REASON_MIN`.
5. **Halaman**: `app/(staf)/<rute>/page.tsx` memanggil `requireDemoScreen('<id>')` (atau `requireScreen` bila layar hibrida). Bila `allowed=false`, tampilkan ajakan ganti posisi (`components/demo-access-denied.tsx`). Server Action di `actions.ts` memanggil `assertDemo()`.
6. **Nyalakan**: ubah `status` ke `demo`. E2E jaring pengaman `e2e/demo/semua-layar.spec.ts` otomatis menguji layar baru itu.
7. **Tes alur**: spesifikasi di `apps/web/e2e/demo/<domain>.spec.ts` untuk alur utama dan gerbang keselamatan.
8. **Dokumentasi**: jalankan `pnpm docs:gambar` agar `docs/panduan/gambar/<id>.png` tertangkap otomatis (langkah kunci: tambahkan tes di `apps/web/e2e/docs/tangkap-layar.spec.ts`), lalu tambahkan bagian layar di halaman fitur `docs/panduan/1x-fitur-*.md`.
9. **Saat backend jadi**: tambahkan izin ke `PERMISSION_CATALOG`, isi `permission` di registri, buat `api-<layar>.tsx` + `actions.ts`, pindahkan jalur demo ke `demo-<layar>.tsx`, lalu ubah `status` ke `api` bila jalur demo tidak dipertahankan.

Langkah membangun layar dari mockup dijelaskan juga di [Tutorial](./03-tutorial.md#5-membuat-layar-web-dari-mockup).

## Peta modul API

Semua modul ada di `apps/api/src/modules/<modul>/`, terdaftar sekali di `AppModule`. Pola: `controller` (tipis) → `service` (aturan) → `repository` (Prisma, transaksi bertenant). Tes integrasi API ada di `apps/api/test/*.test.ts` (bukan di folder modul).

Tingkat kematangan:

- **Selesai**: endpoint lengkap, tes integrasi (termasuk isolasi tenant dan izin), dipakai layar mode api.
- **API jadi**: endpoint dan tes ada, tetapi layar web mode api belum tersambung (layar masih demo).
- **Sebagian**: sebagian fungsi katalog sudah ada; sisanya menunggu potongan berikutnya.
- **Kerangka**: modul kosong yang sudah didaftarkan agar potongan berikutnya tidak mengubah `AppModule`.

### Platform (fase 0–1)

| Modul           | Komponen | Endpoint utama                            | Kematangan | Catatan                                                            |
| --------------- | -------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `tenancy`       | P01      | `/tenancy`                                | Selesai    | Konteks tenant + baca tenant aktif                                 |
| `facility`      | P01      | `/facility`                               | Selesai    | Faskes, unit, ruang → kamar → bed; dipakai registrasi dan ADT      |
| `auth`          | P02      | `/auth`, `/auth/pin`, `/auth/pin/devices` | Selesai    | Login, MFA TOTP, sesi buram, kode cadangan, PIN perangkat          |
| `iam`           | P02/P03  | `/iam`                                    | Selesai    | Pengguna, penugasan, matriks izin per RS                           |
| `authz`         | P03      | `/authz`                                  | Selesai    | Akses darurat (break-the-glass) + ABAC akses pasien                |
| `devices`       | P02      | `/iam/devices`, `/devices`                | Selesai    | Prinsipal perangkat anjungan dan display (ADR-0027)                |
| `audit`         | P04      | `/audit`                                  | Selesai    | Jejak, verifikasi rantai + jangkar, anomali, akses darurat, ekspor |
| `mpi`           | P05      | `/mpi`, `/patients`                       | Selesai    | Identitas terenkripsi, cari, rekam medis ganda, gabung berjejak    |
| `ref`           | P06      | `/ref`                                    | Selesai    | ICD-10, ICD-9-CM, LOINC, KFA, wilayah (skema `ref`, hanya baca)    |
| `forms`         | P07      | `/forms`                                  | Selesai    | Definisi formulir berversi + isian append-only                     |
| `documents`     | P08      | `/documents…`, `/verification`            | Selesai    | Berkas pasien, TTE lewat outbox, verifikasi QR publik              |
| `numbering`     | P08      | (tanpa endpoint)                          | Selesai    | Layanan penomoran per tenant untuk modul lain                      |
| `notifications` | P09      | `/notifications`                          | Selesai    | In-app + email/WhatsApp lewat outbox, tanpa PHI                    |
| `settings`      | P10/P12  | `/settings`                               | Selesai    | Pengaturan per RS (mis. PIN, kanal kode cadangan)                  |
| `dev-tools`     | —        | `/dev`                                    | Selesai    | Hanya `APP_ENV` lokal/staging; tidak terdaftar di produksi         |

### Front office (fase 2)

| Modul                    | Komponen | Endpoint utama                            | Kematangan | Catatan                                                             |
| ------------------------ | -------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `scheduling`             | F01      | `/scheduling`                             | Selesai    | Jadwal, kuota, cuti/pengganti, sinkron HFIS                         |
| `booking`                | F02      | `/booking/appointments`                   | API jadi   | Belum ada layar web booking (dipakai Mobile JKN/aplikasi lewat API) |
| `registration`           | F03      | `/registration`, `/patients/:id/contacts` | Selesai    | Rawat jalan, IGD, admisi rawat inap; Idempotency-Key                |
| `queue`                  | F04      | `/queue`, `/queue/displays`               | Selesai    | Antrean, task ID BPJS 1–7, papan display + SSE                      |
| `kiosk`                  | F05      | `/kiosk`                                  | Selesai    | Anjungan dengan prinsipal perangkat                                 |
| `sep`                    | F06      | `/sep`                                    | Selesai    | SEP berversi, kirim ulang, batal; SEP IGD/ranap otomatis            |
| `referral`               | F07      | `/referrals`                              | Selesai    | Rujukan, SPRI, rencana kontrol                                      |
| `patient-portal-gateway` | F08      | `/public/:tenantCode`                     | Selesai    | Informasi publik tanpa PHI + batas laju                             |

### Klinis RME (fase 3)

| Modul           | Komponen | Endpoint utama                | Kematangan | Catatan                                                                              |
| --------------- | -------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `encounter`     | K02      | `/encounters`                 | API jadi   | Konteks kunjungan + banner; SEP IGD otomatis                                         |
| `drafts`        | K        | `/drafts`                     | API jadi   | Draf klinis per penulis (ADR-0028), dibersihkan job worker                           |
| `diagnosis`     | K08      | `/encounters/…`, `/diagnosis` | API jadi   | ICD-10, ICD-9-CM, problem list, alergi + NKDA                                        |
| `results`       | K08      | `/results`                    | API jadi   | Muara hasil penunjang (observasi, laporan)                                           |
| `summary`       | K14      | `/summary`, `/encounters/…`   | API jadi   | Ringkasan pasien (hanya membaca modul lain)                                          |
| `nursing`       | K12      | `/encounters/…`               | Sebagian   | Tanda vital + NEWS2 + eskalasi; eMAR dan askep menyusul potongan 3.5                 |
| `cppt`          | K07      | `/cppt`, `/encounters/…`      | API jadi   | CPPT multi-PPA, co-sign residen, verifikasi DPJP, serah terima SBAR                  |
| `assessment`    | K06      | `/encounters/…`               | API jadi   | Asesmen lewat formulir P07 dengan `encounterId`                                      |
| `worklist`      | K01      | `/worklist`                   | API jadi   | Pasien per DPJP/unit/shift + tugas pribadi                                           |
| `adt`           | K04/K05  | `/adt`, `/encounters/…`       | API jadi   | Admisi, transfer, papan bed, gelang, Aplicare (potongan 3.3)                         |
| `triage`        | K03      | `/triage`, `/encounters/…`    | API jadi   | Saran ATS dari server, triase berversi, papan IGD + SSE                              |
| `orders`        | K09      | `/orders`, `/encounters/…`    | API jadi   | Katalog, order set, pratinjau CDS, kirim (Idempotency-Key), batal, resep PDF ber-TTE |
| `cds`           | K09      | `/cds`                        | API jadi   | Evaluasi CDS dengan basis pengetahuan per RS (ADR-0030)                              |
| `consent`       | K11      | —                             | Kerangka   | Isi di potongan 3.7 (tablet persetujuan + TTE)                                       |
| `discharge`     | K13      | —                             | Kerangka   | Isi di potongan 3.6 (resume, rekonsiliasi obat, tutup kunjungan)                     |
| `consult`       | K10      | —                             | Kerangka   | Isi di potongan 3.8 (konsultasi, rawat bersama, ganti DPJP)                          |
| `care-packages` | K15      | —                             | Kerangka   | Isi di potongan 3.8 (paket formulir + kelengkapan)                                   |

Fondasi klinis bersama ada di `apps/api/src/infra/clinical/` (`ClinicalRecordService`: versi, koreksi, salah entri, addendum, kunci TTE; staging SATUSEHAT `held` dan `billable_events`). Lihat [diagram rekam medis immutable](./12-fitur-klinis.md) dan ADR-0028.

### Lapisan berikutnya (fase 4–9)

Belum ada modul API. Layarnya sudah ada di mode presentasi; nama modul yang direncanakan ada di `docs/01-arsitektur.md` §2:

| Lapisan     | Modul rencana                                                                                                                                                                  | Layar mode presentasi                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Penunjang   | `lab`, `micro-pa`, `radiology`, `pharmacy-clinical`, `dispensing`, `surgery`, `nutrition`, `blood-bank`, `critical-results`, `diagnostics`                                     | Lab, Radiologi, Farmasi, Kamar operasi, Hasil kritis, Depo, Bank darah, Gizi, Mikrobiologi & PA, Diagnostik lain |
| Keuangan    | `tariff`, `charge-capture`, `billing`, `guarantor`, `claims`, `coding`, `accounting`, `fee-sharing`, `cash-bank`, `payables`                                                   | Kasir, Klaim, Akuntansi, Tarif, Charge capture, Piutang, Workbench koder, Jasa pelayanan, Kas & bank, Hutang     |
| Pembayaran  | `payments`, `financing` (TPDI × BTN)                                                                                                                                           | Pembayaran digital, Pembiayaan BTN                                                                               |
| Integrasi   | `integration-hub`, `satusehat`, `bpjs`, `kemenkes`, `device-gateway`, `fhir-server`                                                                                            | Integrasi, SATUSEHAT, BPJS, Kemenkes, Perangkat medis, API publik                                                |
| Back office | `supply-chain`, `assets`, `hr`, `credentialing`, `payroll`, `quality`, `ipc`, `ams`, `medical-records-admin`, `education`, `oncology`, `regulatory-docs`, `patient-experience` | 13 layar fase 8 ([Fitur back office](./16-fitur-back-office.md))                                                 |
| Kanal       | `executive-dashboard`, `costing`, `warehouse`, aplikasi `apps/mobile`                                                                                                          | Dasbor, Command center, Costing, Dataset riset, pratinjau aplikasi pasien dan dokter                             |

Modul klinis fase 3 yang API-nya sudah ada (worklist, CPPT, asesmen, diagnosis, ringkasan) juga punya layar demo baru (FE2); layar itu belum memanggil API sampai potongan W fase 3 menyambungkannya.

## Fondasi API, worker, dan mock

| Lokasi                    | Isi                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/common/`    | Decorator `@Audited`, `@RequirePermission`, `@TenantScoped`, `@RequireModule`, pipa zod, filter galat, idempotensi, paginasi        |
| `apps/api/src/infra/`     | Penulis audit, sesi + guard, lookup sinkron (`lookup/`), SSE (`realtime/`), event domain (`events/`), penyimpanan objek, batas laju |
| `apps/worker/src/outbox/` | Penjadwal + dispatcher outbox, konektor HTTP/BPJS, operasi per tujuan (SEP, antrean, HFIS, Aplicare, Dukcapil, TTE, notifikasi)     |
| `apps/worker/src/jobs/`   | Job berkala per tenant (sesi jadwal, booking no-show, pembersihan draf klinis)                                                      |
| `apps/worker/src/audit/`  | Jangkar hash audit tiap jam + ringkasan harian anomali                                                                              |
| `apps/mock/src/systems/`  | Tiruan tiap sistem luar; `panel/` = panel kendali skenario                                                                          |

![Diagram outbox: transaksi domain menulis outbox, worker mengirim dengan retry eksponensial lalu DLQ; webhook masuk diverifikasi HMAC dan disimpan sebelum diproses](./gambar/diagram-outbox.svg)

## Tes per lapisan

| Lapisan                     | Lokasi                            | Perintah                                    |
| --------------------------- | --------------------------------- | ------------------------------------------- |
| Unit paket bersama          | `packages/*/src/**/*.test.ts`     | `pnpm test`                                 |
| Integrasi API (Postgres)    | `apps/api/test/*.test.ts`         | `pnpm --filter @simrs/api test`             |
| Unit web (aturan, komponen) | `apps/web/src/**/*.test.{ts,tsx}` | `pnpm --filter @simrs/web test`             |
| E2E mode api                | `apps/web/e2e/*.spec.ts`          | `pnpm --filter @simrs/web test:e2e`         |
| E2E mode presentasi         | `apps/web/e2e/demo/*.spec.ts`     | idem (proyek `demo-desktop`, `demo-tablet`) |
| Tangkap layar dokumentasi   | `apps/web/e2e/docs/*.spec.ts`     | `pnpm docs:gambar`                          |

## Utang dari mode front end dulu

Mode presentasi (ADR-0023) membangun layar sebelum backend. Akibatnya ada keputusan yang baru "dipinjam" di web dan wajib dibayar saat backend fase itu dibangun. Daftar ini disusun dari `apps/web/src/lib/screens.ts`, `apps/web/src/lib/*.ts`, fixture, dan komentar kode per 6 Okt 2026. Periksa ulang daftar ini di awal setiap fase.

### Izin rencana yang belum ada di katalog

58 dari 80 layar memakai `plannedPermission` yang **belum ada** di `PERMISSION_CATALOG` (`packages/shared`). Di mode presentasi layar dibatasi per posisi (`demoRoles`) hanya di UI. Saat backend dibangun: tambahkan sumber + aksi ke katalog, beri ke peran di matriks bawaan, jalankan `pnpm db:sync-permissions`, lalu isi `permission` di registri.

| Fase | Izin rencana (layar)                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `jobs.manage` (penjadwal)                                                                                                                                                                                                                                                                                                    |
| 3    | `cppt.write` (cppt), `diagnosis.write` (diagnosis), `consult.write` (konsul), `education.write` (edukasi, juga pendidikan), `nursing.write` (askep), `care-package.write` (paket)                                                                                                                                            |
| 4    | `lab.write` (lab, mikro), `radiology.write` (rad), `pharmacy.write` (farmasi), `surgery.write` (ok), `critical_result.report` (kritis), `stock.write` (depo), `blood.write` (bank-darah), `nutrition.write` (gizi), `diagnostic.write` (diagnostik)                                                                          |
| 5    | `billing.write` (kasir), `billing.read` (charge), `claim.write` (klaim, koding), `accounting.write` (akuntansi), `tariff.write` (tarif), `receivable.write` (piutang), `fee_sharing.read` (jaspel), `cashbank.write` (kas-bank), `payable.write` (hutang)                                                                    |
| 6    | `payment.write` (pembayaran), `financing.write` (pembiayaan)                                                                                                                                                                                                                                                                 |
| 7    | `integration.read` (integrasi), `integration.manage` (satusehat, bpjs, kemenkes, perangkat, api-publik)                                                                                                                                                                                                                      |
| 8    | `inventory.write` (logistik), `quality.read` (mutu), `record.release.read` (rm-adm), `hr.read` (sdm), `credential.verify` (kredensial), `ipc.read` (ppi), `asset.write` (aset), `payroll.approve` (penggajian), `ams.approve` (ppra), `regdoc.approve` (regdok), `complaint.write` (pengaduan), `oncology.verify` (onkologi) |
| 9    | `dashboard.read` (dasbor, command-center), `costing.read` (costing), `dataset.approve` (dataset-riset), `preview.read` (app-pasien, app-dokter; pratinjau, kemungkinan tidak perlu izin sungguhan)                                                                                                                           |
| 10   | `simulation.use` (simulasi; hanya non-produksi), `system.downtime.manage` (downtime), `backup.read` (cadangan), `golive.read` (golive)                                                                                                                                                                                       |

Catatan: beberapa layar memakai satu aksi untuk banyak langkah (mis. `claim.write` untuk klaim dan koding, `education.write` untuk edukasi pasien dan pendidikan klinik). Saat katalog dibuat, pisahkan aksi yang butuh pemisahan tugas (menyusun ≠ menyetujui), seperti yang sudah ditegakkan di aturan web (`lib/keuangan-tarif.ts`, `lib/penggajian.ts`, `lib/dataset-riset.ts`, regdok).

### Peran yang belum ada di katalog

Katalog `SYSTEM_ROLES` berisi 16 peran. Rencana fase menambah peran berikut; sampai itu layar dibuka untuk peran pengganti:

| Peran rencana      | Sumber keputusan                        | Layar terdampak (mode presentasi) | Pengganti sementara di `demoRoles` |
| ------------------ | --------------------------------------- | --------------------------------- | ---------------------------------- |
| `nutrisionis`      | rencana fase 4 keputusan #21 (F3-10)    | Gizi                              | perawat, dokter                    |
| `petugas_logistik` | rencana fase 8 (ADR-0063, direncanakan) | Logistik                          | manajemen, apoteker                |
| `petugas_sdm`      | rencana fase 8                          | SDM, Penggajian                   | manajemen, akuntan                 |
| `komite_medik`     | rencana fase 8                          | Kredensial, Pendidikan klinik     | manajemen, dokter                  |
| `komite_ppi`       | rencana fase 8                          | PPI                               | auditor mutu, perawat              |
| `tim_ppra`         | rencana fase 8                          | PPRA                              | apoteker, dokter                   |

Menambah peran berarti: kode di `SYSTEM_ROLES`, matriks izin bawaan, seed staf fiktif, persona akun presentasi (`PRESENTATION_PERSONAS`), dan `docs/05-keamanan.md` §2.

### Kode akun (COA) baru dari layar keuangan lanjutan

Layar FE4 memakai 16 kode akun yang belum ada di fixture akuntansi sebelumnya. Bagan akun sungguhan (U07) wajib memuatnya, atau memetakannya ke akun RS:

| Kode   | Nama di fixture                              | Kode   | Nama di fixture                          |
| ------ | -------------------------------------------- | ------ | ---------------------------------------- |
| 1-1110 | Kas kasir (laci loket)                       | 2-1410 | Utang jasa pelayanan                     |
| 1-1140 | Bank mitra ••••7730 (penggajian dan pemasok) | 2-1420 | Utang PPh 21 jasa pelayanan              |
| 1-1210 | Piutang settlement EDC                       | 4-1300 | Pendapatan layanan non-JKN               |
| 1-1340 | Piutang asuransi swasta                      | 4-1950 | Potongan dan penyesuaian tagihan         |
| 1-1350 | Piutang perusahaan kerja sama                | 4-3100 | Pendapatan lain-lain (selisih lebih kas) |
| 2-1120 | Utang penerimaan belum difakturkan           | 5-1100 | Beban jasa pelayanan                     |
| 2-1290 | Titipan dana belum teridentifikasi           | 6-1200 | Beban administrasi bank (MDR EDC)        |
|        |                                              | 6-1210 | Beban administrasi rekening bank         |
|        |                                              | 6-1300 | Beban selisih kurang kas                 |

Kode lama yang dipakai bersama (1-1120, 1-1130, 1-13xx, 1-1410, 2-1110, 2-1210, 2-1310, 4-1x00, 6-2100, 6-3100) ada di `lib/demo/fixtures/keuangan.ts`. Semua kode di atas fiktif untuk demo; COA tiap RS dikonfigurasi saat implementasi.

### Tipe web yang harus menjadi skema zod

58 berkas aturan baru di `apps/web/src/lib/` (mis. `rme-*.ts`, `penunjang-*.ts`, `keuangan-*.ts`, `integrasi-*.ts`, `platform-*.ts`, `operasional-*.ts`, dan satu berkas per layar back office) mengekspor sekitar 350 `interface`/`type` TypeScript, **tanpa** skema zod. Layar putaran 1 sudah memakai kontrak di `packages/shared/src/schemas/`; layar putaran 2 belum. Saat backend sebuah layar dibangun:

1. Pindahkan bentuk data respons ke `packages/shared/src/schemas/<domain>.ts` sebagai skema zod (`strictObject` untuk input), lalu turunkan tipe dengan `z.infer`.
2. Uang tetap `bigint` rupiah di kontrak (bukan `number`), ID UUID v7, waktu ISO 8601.
3. Aturan murni di `lib/<domain>.ts` yang juga berlaku di server (gerbang, perhitungan) pindah ke `packages/shared` agar API dan web memakai satu sumber.

### Keadaan antarlayar yang tidak tersimpan

- Aksi di 49 layar demo baru hanya mengubah keadaan React di peramban (`useState`), ditandai "(simulasi, tidak disimpan)". Muat ulang halaman mengembalikan data awal.
- Keadaan tidak mengalir antarlayar. Contoh: co-sign di CPPT tidak mengubah butir di Kelengkapan rekam medis; pemberian obat di Asuhan keperawatan tidak tercatat di Rawat inap; penerimaan barang di Logistik tidak menambah stok Depo; jurnal kas-bank tidak masuk buku besar Akuntansi; alert command center tidak mengubah papan Tempat tidur.
- Satu-satunya keadaan bersama tetap mesin skenario Simulasi (`lib/server/demo/store.ts`); dari layar baru hanya Pusat hasil kritis yang membacanya (`scenarioRuns` di `lib/server/data/penunjang-lanjut.ts`).
- Saat backend dibangun, aliran ini menjadi event domain (mis. `MedicationAdministered` → charge capture, lihat `docs/01-arsitektur.md` §2), bukan panggilan antarlayar.

### Ambang klinis contoh yang wajib divalidasi komite

Angka berikut ditulis di kode web sebagai contoh agar gerbang bisa didemokan. Semuanya **wajib** ditinjau komite (komite medik, PPI, farmasi dan terapi, mutu) lalu dipindah ke konfigurasi per RS atau basis pengetahuan CDS (ADR-0030) sebelum dipakai pasien sungguhan:

| Ambang contoh                                                                                                                                           | Lokasi kode                                                                       | Komite / pemilik                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| Batas kritis lab: kalium < 2,5 atau > 6,0 mmol/L; natrium < 120 atau > 160; glukosa < 40 atau > 500 mg/dL; Hb < 7 atau > 20 g/dL; trombosit < 20.000/µL | `lib/demo/fixtures/penunjang-kritis.ts` (`CRITICAL_RULES`)                        | Komite medik + laboratorium       |
| Batas lapor hasil kritis 30 menit, eskalasi berjenjang pada batas dan batas + 30 menit                                                                  | `lib/penunjang-skenario.ts` (`CRITICAL_LIMIT_MINUTES`), `lib/penunjang-kritis.ts` | Komite mutu (sasaran KP)          |
| Gerbang pra-kemoterapi: Hb ≥ 10 g/dL, leukosit ≥ 3.000/µL, trombosit ≥ 100.000/µL                                                                       | `lib/demo/fixtures/rme-paket.ts`, `lib/rme-paket.ts`                              | Komite medik (onkologi)           |
| Gerbang onkologi: neutrofil absolut ≥ 1.500/µL, trombosit ≥ 100.000/µL, klirens kreatinin ≥ 30 mL/menit                                                 | `lib/demo/fixtures/onkologi.ts`, `lib/onkologi.ts`                                | Komite medik + farmasi dan terapi |
| Tindak lanjut skor asesmen (contoh Morse ≥ 45 / ≥ 25, nyeri ≥ 7 / ≥ 4, skrining gizi ≥ 2) dan batas asesmen awal 24 jam                                 | `lib/rme-asesmen.ts` (`scoreFollowUp`, `INITIAL_WITHIN_HOURS`)                    | Komite keperawatan + komite medik |
| Verifikasi CPPT oleh DPJP ≤ 24 jam                                                                                                                      | `lib/rme-cppt.ts` (`VERIFY_WITHIN_HOURS`)                                         | Komite medik / rekam medis        |
| Skrining gizi MST ≥ 2 → asuhan gizi ≤ 24 jam                                                                                                            | `lib/penunjang-gizi.ts`                                                           | Tim asuhan gizi                   |
| Kriteria HAIs (kateter urine / ventilator > 2 hari, ILO ≤ 30 hari pasca-operasi)                                                                        | `lib/ppi.ts`                                                                      | Komite PPI                        |
| Persetujuan antibiotik PPRA kedaluwarsa 24 jam                                                                                                          | `lib/ppra.ts` (`APPROVAL_EXPIRY_HOURS`)                                           | Tim PPRA                          |
| Jadwal TTV transfusi (sebelum, 15 menit, 1 jam, selesai)                                                                                                | `lib/penunjang-bank-darah.ts` (`VITALS_PLAN`)                                     | Komite medik + bank darah         |
| Batas hampir kedaluwarsa obat 90 hari                                                                                                                   | `lib/penunjang-depo.ts` (`NEAR_EXPIRY_DAYS`)                                      | Farmasi dan terapi                |
| Alert command center: BOR > 85%, boarding IGD > 120 menit, antrean ≥ 3                                                                                  | `lib/command-center.ts`                                                           | Manajemen + komite mutu           |

Angka ini contoh demo, bukan standar klinis yang disahkan. Di backend, ambang klinis menjadi data berversi (pengaturan RS atau KB CDS) dengan pemilik dan tanggal berlaku, sama seperti formulir P07.

## Lihat juga

- [Cara kode bekerja](./02-cara-kerja-kode.md): mekanisme rinci tiap bagian.
- [Peta alur semua fase](./20-peta-alur-semua-fase.md): setiap layar per fase dengan rute dan sumber datanya.
- [Tutorial](./03-tutorial.md): menyiapkan mesin, membuat modul dan layar.
- [Simulasi dan operasional](./18-simulasi-dan-operasional.md): mode presentasi dan tangkap layar.
- `docs/PROGRESS.md`: status potongan dan utang teknis terbaru.
