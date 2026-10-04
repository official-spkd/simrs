# Rencana fase 9 · Kanal: dasbor, aplikasi pasien, aplikasi dokter (I07–I09)

Disusun 5 Okt 2026 oleh agen R. Keputusan di §4 diambil dan disetujui otomatis 5 Okt 2026. ADR 0065–0069. Draf ADR Expo ada di 9.0c.

## 1. Ringkasan

Fase 9 membangun backend nyata untuk:

- **I09 dasbor direksi:** BOR, ALOS, kunjungan, waktu tunggu, klaim, bauran penjamin, pendapatan vs anggaran, mutu, kapasitas, dan alert keputusan.
  - Sumber: read-model `kpi_daily` dari data operasional.
  - Drill-down terbatas dan diaudit.
  - Layar `/manajemen/dasbor` dipindah ke API; jalur demo tetap.
- **`apps/mobile` (Expo)**, satu aplikasi dengan dua mode:
  - **Pasien (I07):** booking, antrean real-time, hasil, resume, obat, tagihan + bayar lewat TPDI, pengajuan cicilan, gula darah mandiri, keluarga, data & privasi.
  - **Klinisi (I08):** pasien saya, nilai kritis + read-back, co-sign TTE, order cepat dengan CDS.
- **Autentikasi pasien terpisah** dari staf, data minimal, persetujuan akses keluarga.
- **Notifikasi push** tanpa PHI.

Pratinjau web `/pratinjau/aplikasi-*` tetap khusus mode presentasi (ADR-0023 §8).

**Urutan pengerjaan:**

1. Kontrak, lalu DB.
2. ADR + kerangka Expo + push (paralel).
3. API dasbor, realm pasien, dan API klinisi.
4. Layar web dasbor dan dua mode aplikasi.
5. Penutup: E2E DoD.

**Prasyarat:**

- DoD fase 2–8 hijau.
- SSE ADR-0026, prinsipal perangkat ADR-0027, PIN 10c-2 (`registered_devices`).
- Gateway publik F08 (info jadwal/kuota tanpa login di aplikasi).

**Antarmuka yang dibutuhkan:**

| Fase | Antarmuka                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | `BookingService.create/cancel({source:'aplikasi'})`                                                                                                  |
| 2    | `QueueService.positionOf(ticketId)` + `pg_notify` antrean (hub SSE menyaring per penerima di server)                                                 |
| 2    | Endpoint publik F08                                                                                                                                  |
| 2    | Operasi WhatsApp pasien                                                                                                                              |
| 2    | P11                                                                                                                                                  |
| 3    | K01 query "pasien saya"                                                                                                                              |
| 3    | K07 `cosign(entryId)` + TTE P08                                                                                                                      |
| 3    | K09 `placeOrder` + evaluasi CDS + override beralasan + order set/favorit                                                                             |
| 3    | K13 daftar resume ber-TTE per pasien                                                                                                                 |
| 3    | K14 ringkasan pasien                                                                                                                                 |
| 3    | ADT: okupansi bed real-time + event masuk/pindah/pulang (BOR, ALOS, kapasitas)                                                                       |
| 4    | S01 hasil per pasien dengan status validasi klinis + status "dibaca DPJP"                                                                            |
| 4    | S09 event `critical_result.created` (ID penerima) + `CriticalResultsService.acknowledge(id, {readBackValue, channel:'app'})` yang menghentikan timer |
| 4    | S05 daftar obat aktif + aturan pakai                                                                                                                 |
| 4    | S06 kasus OK hari ini                                                                                                                                |
| 5    | U03 tagihan per pasien (status, total bigint)                                                                                                        |
| 5    | U05 statistik klaim (diajukan / dibayar / pending)                                                                                                   |
| 5    | Pendapatan harian per penjamin (U03/U07)                                                                                                             |
| 5    | Hasil grouper vs tarif RS (proksi margin JKN)                                                                                                        |
| 6    | `PaymentsService.createIntent({invoiceId, channel, initiatedBy:'patient'})` idempoten                                                                |
| 6    | Event `payment.status_changed`                                                                                                                       |
| 6    | `FinancingService.applyPatient({invoiceId, tenor, consentId})`                                                                                       |
| 6    | Panel mock "Bayar"                                                                                                                                   |
| 7    | (opsional) ringkasan DLQ kritis untuk alert                                                                                                          |
| 8    | B06 `quality_indicator_results_current`                                                                                                              |
| 8    | B09 `ReleaseOfInformationService.createFromPatient` + log akses                                                                                      |
| 8    | B13 undangan survei / pengaduan                                                                                                                      |
| 8    | B01 stockout VEN-V (alert)                                                                                                                           |

## 2. Potongan kerja (urut dependensi)

### 9.0a · Kontrak bersama (`packages/shared`)

**Izin baru:**

- `dashboard`: read, drilldown, act.
- `budget`: read, write.
- `patient_account`: read, write (loket: aktivasi, tautan keluarga, reset).
- **Izin tetap realm pasien** (bukan katalog peran, seperti prinsipal perangkat): `self.read`, `self.booking`, `self.pay`, `self.observation.write`, `self.privacy`.

**Skema:**

- `executiveDashboardSchema` v2: `marginPercent` boleh null, sumber per KPI.
- `patientAppHomeSchema` v2 dan `doctorAppInboxSchema` v2: buang `mode`/`stepIndex` khusus demo, tambah `labOrdered`. Fixture demo diperbarui.
- `schemas/patient-app.ts`: auth OTP, perangkat, tautan keluarga, observasi mandiri, intent bayar.
- `schemas/clinician-app.ts`.
- Event SSE: `queue.position`, `payment.updated`, `critical.new`.

**Lain-lain:**

- Operasi outbox `notify.push`.
- Pengaturan: `patient_app.otp_ttl_seconds` (300), `patient_app.refresh_days` (30), `patient_app.lab_release_hours` (24), `clinician_app.idle_minutes` (15), `dashboard.alert_rules`.
- Daftar `DASHBOARD_ALERT_RULES`.

**Tes:** skema, fixture demo lolos v2.

### 9.0b · Skema DB (`packages/db`), setelah 9.0a

Aturan sama dengan fase 8.

| Tabel                                          | Isi dan aturan                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `patient_accounts`                             | Satu per pasien per RS; FK ke kelompok `app_patient_group`; HP terenkripsi + hash; status; dibuat via loket/mandiri                           |
| `patient_account_links`                        | Keluarga: hubungan, lingkup `booking`/`lihat`, `consent_id` → `privacy_consents` jenis `family_access` + bukti P08, masa berlaku, `revoked_*` |
| `patient_sessions`                             | Token buram `pa1`/`pr1` hanya hash; deteksi pemakaian ulang                                                                                   |
| `patient_otp_challenges`                       | OTP terenkripsi, maks 3 kirim, 5 coba, jeda 30 detik                                                                                          |
| `mobile_devices`                               | realm `patient`/`staff`, prinsipal, platform, token push terenkripsi, `revoked_at`                                                            |
| `patient_reported_observations`                | Append-only; `measured_at` dari pasien, `recorded_at` dari server; kode null sampai LOINC glukometer diimpor                                  |
| `patient_notifications`                        | Judul tanpa PHI, tautan rute aplikasi, `read_at`                                                                                              |
| `kpi_daily`                                    | Metrik × tanggal WIB × unit/penjamin × pembilang/penyebut; append-only + view current                                                         |
| `revenue_budgets`                              | Bulanan per kategori, bigint                                                                                                                  |
| `dashboard_alerts` + `dashboard_alert_actions` | Append-only                                                                                                                                   |

**Tes db:** RLS, append-only, satu akun aktif per pasien (UNIQUE parsial), tautan kedaluwarsa tidak berlaku.

### 9.0c · ADR-0065 Expo + kerangka `apps/mobile` (paralel dengan 9.0b)

**Draf ADR-0065 · Aplikasi mobile dengan Expo (React Native) di `apps/mobile`**

_Konteks:_ CLAUDE.md §2 dan docs/09 fase 9 menetapkan Expo. Dependensi besar wajib ADR (CLAUDE.md §8). Kebutuhan: iOS + Android, dua mode, push, penyimpanan token aman, biometrik, kontrak zod bersama.

_Keputusan:_

1. Expo SDK stabil terbaru, managed workflow, Expo Router, Hermes, versi dikunci di lockfile.
2. Satu aplikasi dua mode, dipilih saat pertama dibuka. Hanya satu realm masuk aktif dalam satu waktu.
3. Paket yang diizinkan: `expo`, `expo-router`, `expo-secure-store`, `expo-local-authentication`, `expo-notifications`, `expo-device`, `expo-constants`, `expo-screen-capture`, `react-native-safe-area-context`, `react-native-screens`, `react-native-svg`. Dev: `jest-expo`, `@testing-library/react-native`.
4. Tanpa state manager, UI kit pihak ketiga, atau pustaka SSE. SSE memakai streaming `expo/fetch`.
5. Klien bicara langsung ke API `/api/v1` (bukan BFF) dengan token buram di SecureStore. Tidak ada PHI tersimpan persisten di perangkat.
6. `@simrs/shared` dipakai langsung. `packages/ui` (DOM) tidak dipakai. Token desain dibangkitkan dari `design/tokens.json`.
7. EAS/rilis toko aplikasi ditunda sampai go-live.

_Konsekuensi:_

- (+) Satu basis kode, kontrak sama dengan web.
- (−) Upgrade SDK ±6 bulanan.
- (−) Metro + pnpm monorepo perlu konfigurasi.
- (−) Push lewat server Expo di luar negeri: payload tanpa PHI + DPIA.
- (−) Ekspor web hanya untuk uji, tidak pernah dideploy.

**Berkas kerangka:**

- `apps/mobile/{package.json, app.config.ts, metro.config.js, tsconfig.json, eslint.config.js, jest.config.js}`
- `app/_layout.tsx`, `app/index.tsx` (pilih RS + mode)
- `src/api/client.ts`: fetch + parse zod + refresh single-flight
- `src/auth/secure-store.ts`: adaptor memori untuk build uji web
- `src/realtime/sse.ts`: Last-Event-ID, backoff, jeda saat latar belakang
- `src/theme/tokens.ts`: dibangkitkan oleh `scripts/gen-mobile-tokens.mjs`
- `src/i18n/id.ts`

**Integrasi rantai alat:**

- Turbo `lint/typecheck/test` mencakup mobile.
- Pengecualian `minimumReleaseAge`/`allowBuilds` di `pnpm-workspace.yaml` bila perlu.
- Pengembangan di simulator iOS / emulator Android (`adb reverse tcp:4000 tcp:4000`); API tetap bind 127.0.0.1.

**Tes:** jest-expo smoke render, klien API menolak respons di luar skema, single-flight refresh.

### 9.0d · Push tanpa PHI (ADR-0067), paralel dengan 9.0b/9.0c

- Operasi worker `apps/worker/src/outbox/push.ts`: payload hanya ID `patient_notifications`/`notifications`. Worker membaca dan mendekripsi token. Isi = jenis kejadian generik. Respons `sensitive`.
- Token `DeviceNotRegistered` → `mobile_devices.revoked_at`.
- Mock `apps/mock/src/systems/push.ts` meniru Expo Push API (`/push/--/api/v2/push/send`), kotak masuk di panel + `GET /messages`.
- API `POST/DELETE /api/v1/me/devices` per realm.
- `NotificationsService.notify` mendapat kanal `push`.

**Tes:**

- Payload tidak memuat nama/RM/nilai (asersi daftar putih kunci).
- Token dicabut setelah galat penyedia.
- Isolasi tenant.

### 9.1a · I09 read-model KPI + alert (ADR-0069)

**Sumber dan metrik:**

- View `kpi_src_*` (`security_invoker`).
- Metrik: BOR (hari rawat ÷ bed × hari), ALOS, kunjungan RJ/hari, waktu tunggu RJ (check-in → mulai poli), % klaim terbayar, kepuasan (B13), pendapatan harian per penjamin, kapasitas (ADT, OK), mutu (dari B06).
- Margin JKN = (tarif INA-CBG − tarif RS) ÷ tarif RS. Penjamin lain `null`.

**Perhitungan dan alert:**

- Job P11 `kpi.compute`: tiap 15 menit untuk hari ini, 01.45 WIB untuk kemarin.
- Aturan alert di kode: ICU ≥ 90% + IGD menunggu bed, ALOS > sasaran, klaim pending > ambang, stockout VEN-V, nilai kritis < 100%, DLQ kritis. Hasilnya `dashboard_alerts` membuka/menutup.

**Endpoint:**

| Endpoint                                                                          | Izin / audit                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/v1/executive-dashboard?period=` (kontrak v2)                            | `dashboard.read`                                     |
| `GET /executive-dashboard/drilldown/:metric` (daftar kunjungan ber-RM tanpa nama) | `dashboard.drilldown`, audit `read` per baris pasien |
| `POST /executive-dashboard/alerts/:id/actions`                                    | `dashboard.act`, `@Audited`                          |
| `GET/PUT /budgets`                                                                | `budget.*`                                           |

**Tes:**

- BOR/ALOS golden dari data ADT fiktif.
- Batas hari WIB.
- Nilai mutu = hasil B06.
- Drill-down diaudit.
- Isolasi tenant.

### 9.1b · Dasbor web ke API (setelah 9.1a)

**Berkas:** `apps/web/src/app/(staf)/manajemen/dasbor/{page.tsx, api-dasbor.tsx, demo-dasbor.tsx, dashboard-client.tsx, actions.ts}`, `dasbor/rincian/[metric]/page.tsx`, `dasbor/anggaran/page.tsx`.

**Perilaku:** refresh lewat `router.refresh()` tiap 60 detik.

**Tes:**

- Unit: model tampilan, margin null → "belum ada data biaya".
- E2E `apps/web/e2e/dasbor.spec.ts` (api): KPI dari seed, tindak lanjut alert tersimpan, drill-down tanpa nama.
- E2E demo dasbor tetap hijau.

### 9.2a · Realm pasien: aktivasi, masuk OTP, sesi, perangkat, keluarga (ADR-0066)

**Endpoint** (`/api/v1/patient-auth`, throttler `auth`, respons seragam anti-enumerasi):

- `activate/start`: kode RS, RM atau NIK, tanggal lahir, no. HP **yang tercatat di MPI** → OTP lewat WhatsApp bila cocok.
- `activate/verify`.
- `login/start` (no. HP).
- `login/verify` → token. Perangkat dicatat.
- `refresh`: berotasi; pemakaian ulang → semua sesi perangkat dicabut.
- `logout`.

**Prinsipal dan isolasi:**

- Guard `@PatientPrincipal()` di realm pasien. Token staf ditolak di realm pasien, dan sebaliknya (seperti ADR-0027).
- Transaksi bertenant dari token.

**Aktivasi di loket:** `POST /patient-accounts` (`patient_account.write`) untuk pasien tanpa HP tercatat.

**Tautan keluarga:**

- Hanya dibuat di loket, dengan bukti KK/surat kuasa + persetujuan subjek atau wali.
- Anak < 18 tahun: job mengakhiri tautan wali saat 18 tahun.
- Pasien bisa mencabut lewat aplikasi.
- Ganti no. HP hanya di loket.

**Layar staf:** `apps/web/src/app/(staf)/pendaftaran/akun-pasien/page.tsx` (koordinasi dengan pemilik folder fase 2).

**Tes:**

- Enumerasi: waktu dan respons seragam.
- 5 OTP salah → kunci.
- Pemakaian ulang refresh terdeteksi.
- Token staf 401 di realm pasien.
- Tautan kedaluwarsa / dicabut → 403.
- Tenant salah.

### 9.2b · API data pasien (setelah 9.2a)

**Aturan umum** `/api/v1/patient/me/...`:

- ABAC: diri sendiri atau tautan keluarga sesuai lingkup.
- Setiap baca data klinis diaudit `read` dengan aktor `patient`.
- Respons minimal: tanpa NIK, alamat tersamar.

**Endpoint:**

| Endpoint                              | Perilaku                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `home`                                | Kontrak v2                                                                                                        |
| `bookings`                            | Buat / batal lewat F02                                                                                            |
| `queue` + `queue/stream`              | SSE hanya untuk tiket miliknya                                                                                    |
| `lab-results`                         | Hanya setelah validasi klinis **dan** (dibaca DPJP atau 24 jam). Nilai kritis tidak pernah sebelum DPJP menerima. |
| `documents`                           | Resume ber-TTE; unduh diaudit `export`                                                                            |
| `medications`                         | Obat aktif                                                                                                        |
| `invoices`                            | Daftar tagihan                                                                                                    |
| `invoices/:id/payment-intents`        | VA/QRIS lewat fase 6; Idempotency-Key; nominal dari server                                                        |
| `invoices/:id/financing-applications` | Persetujuan data wajib                                                                                            |
| `observations/glucose`                | POST/GET; tidak memicu CDS atau nilai kritis                                                                      |
| `family`                              | Daftar tautan                                                                                                     |
| `privacy`                             | Persetujuan, log akses (tanpa nama staf), permintaan salinan RM → B09                                             |
| `surveys`, `complaints`               | B13                                                                                                               |

**SSE:** event `payment.updated` dan `queue.position` dari hub fase 2.

**Tes:**

- Pasien A tidak menerima event B.
- Lab sebelum syarat rilis → tidak tampil.
- Intent bayar idempoten.
- Webhook mock → status lunas → event terkirim.
- Anggota keluarga lingkup `booking` tidak bisa membaca hasil.

### 9.3 · Aplikasi pasien (mode pasien Expo), setelah 9.0c + 9.2b

**Rute** `apps/mobile/app/(pasien)/`:

- `(tabs)/{beranda,antrean,tagihan,profil}.tsx`
- `hasil-lab.tsx`, `resume.tsx`, `obat.tsx`, `keluarga.tsx`, `privasi.tsx`, `gula-darah.tsx`, `bayar/[invoiceId].tsx`, `daftar-berobat.tsx`
- `(auth)/{masuk-pasien,otp}.tsx`

**Perilaku:**

- Tata letak mengikuti `design/mockups/AppPasien.dc.html`. Target sentuh ≥ 44, teks 16 px.
- Antrean: SSE saat aplikasi aktif, push saat di latar belakang.
- `expo-screen-capture` aktif di hasil lab, resume, dan privasi.
- Buka cepat dengan biometrik melepas refresh token (SecureStore `requireAuthentication`).

**Tes:** jest-expo + RNTL (format rupiah/tanggal, gerbang tombol bayar, galat jaringan berbahasa Indonesia).

### 9.4a · API klinisi + masuk klinisi mobile (setelah 9.0b)

**Masuk:**

- Endpoint auth staf yang ada: sandi + TOTP sekali per perangkat terdaftar (`registered_devices`).
- Buka cepat dengan PIN perangkat (ADR-0024) atau biometrik.
- Kunci idle 15 menit. Step-up re-auth untuk TTE dan override CDS.

**Endpoint klinisi:**

- `/api/v1/clinician/inbox`: agregat tipis K01 + S09 + K07 + verifikasi order + query koder; kontrak v2; izin dan ABAC modul sumber.
- Read-back: `POST /critical-results/:id/acknowledge` (endpoint S09, kanal `app`, nilai baca-ulang wajib cocok).
- Co-sign: endpoint K07 + TTE outbox.
- Order cepat: endpoint K09 (hanya order set/favorit). `CDS_BLOCKED` mengembalikan alasan; override wajib alasan ≥ 10 karakter.

**Notifikasi:** `critical_result.created` → notifikasi in-app + push ke DPJP (tanpa PHI).

**Tes:**

- Read-back nilai tidak cocok → 422.
- Timer berhenti dan durasi tercatat.
- Co-sign tanpa step-up → 403.
- CDS memblokir tanpa alasan.
- Residen tidak bisa co-sign.

### 9.4b · Aplikasi dokter (mode klinisi Expo), setelah 9.0c + 9.4a

**Rute** `apps/mobile/app/(klinisi)/`:

- `(tabs)/{pasien,tugas,jadwal,profil}.tsx`
- `nilai-kritis/[id].tsx`, `cosign/[id].tsx`, `order/[encounterId].tsx`, `pasien/[id].tsx`
- `(auth)/masuk-klinisi.tsx`

**Perilaku:** mengikuti `AppDokter.dc.html`. Banner pasien (nama, umur, RM, alergi) di setiap layar klinis.

**Tes:** RNTL (form read-back, gerbang CDS, kunci idle).

### 9.5 · E2E aplikasi (setelah 9.3, 9.4b)

**Playwright (otomatis):**

- Konfigurasi `apps/web/playwright.config.ts` proyek `mobile`: server statis `expo export -p web` dengan `EXPO_PUBLIC_E2E=1`, viewport 390×844.
- `apps/web/e2e/mobile/pasien.spec.ts`: masuk OTP (kotak masuk mock) → staf memanggil berikutnya → posisi antrean berubah tanpa muat ulang → bayar tagihan → panel mock "Bayar" (webhook) → status "Lunas".
- `apps/web/e2e/mobile/dokter.spec.ts`: validasi hasil kritis di lab → notifikasi (kotak masuk push mock) → read-back di aplikasi → laporan S09 tertutup.

**Maestro (manual sebelum pilot):** alur di `apps/mobile/.maestro/*.yaml` untuk simulator.

**QA visual:** `QA_VISUAL=1` menangkap mode mobile.

### 9.6 · Penutup fase 9

- E2E DoD.
- Review keamanan: permukaan realm pasien, rate limit, payload push.
- ADR-0065…0069.
- Panduan pengembang mobile (`docs/panduan/`).
- Regresi pratinjau demo + E2E demo dasbor.
- PROGRESS.

## 3. Paralelisasi (maks. 4 agen sekaligus)

**Gelombang:**

- 9.0a dikerjakan sendiri.
- **Gelombang A:** 9.0b ∥ 9.0c ∥ 9.0d.
- **Gelombang B:** 9.1a ∥ 9.2a ∥ 9.4a.
- **Gelombang C:** 9.1b ∥ 9.2b ∥ 9.4b.
- **Gelombang D:** 9.3 ∥ 9.5 (infrastruktur E2E disiapkan lebih awal dengan stub).
- 9.6 oleh penggabung.

**Kepemilikan berkas:**

| Berkas                                                                    | Pemilik                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/mobile/{app.config.ts, src/api, src/auth, src/realtime, src/theme}` | 9.0c (bersama)                                                                 |
| `apps/mobile/app/(pasien)/**`                                             | 9.3                                                                            |
| `apps/mobile/app/(klinisi)/**`                                            | 9.4b                                                                           |
| `apps/api/src/modules/executive-dashboard/**`                             | 9.1a                                                                           |
| `patient-app/**` (auth + data)                                            | 9.2a → 9.2b                                                                    |
| `clinician-app/**`                                                        | 9.4a                                                                           |
| `apps/worker/src/outbox/push.ts`, `apps/mock/src/systems/push.ts`         | 9.0d                                                                           |
| `apps/web/src/app/(staf)/manajemen/dasbor/**`                             | 9.1b                                                                           |
| `pendaftaran/akun-pasien/**`                                              | 9.2a                                                                           |
| `pnpm-lock.yaml`                                                          | hanya 9.0c yang menambah dependensi mobile; potongan lain tidak menambah paket |

## 4. Keputusan (keputusan diambil, disetujui otomatis 5 Okt 2026)

1. **Expo:** satu aplikasi dua mode di `apps/mobile`, satu realm aktif dalam satu waktu (ADR-0065).
2. **Akun pasien:** per RS (tenant), dipilih lewat kode/QR RS.
   - Aktivasi mandiri dengan RM/NIK + tanggal lahir + no. HP yang sudah tercatat → OTP WhatsApp. Aktivasi di loket untuk yang lain.
   - OTP 6 digit, 5 menit, maks 3 kirim, 5 percobaan.
   - Sesi buram: akses 15 menit, refresh 30 hari berotasi + deteksi pemakaian ulang.
   - SMS menyusul (ADR-0066).
3. **Akses keluarga:** hanya dibuat di loket dengan bukti + persetujuan. Lingkup `booking`/`lihat`. Tautan wali berakhir saat anak 18 tahun. Bisa dicabut pasien.
4. **Klien mobile:** langsung ke API, token di SecureStore, tanpa cache PHI persisten. Tanpa certificate pinning di MVP; ditinjau ulang sebelum produksi (ADR-0068).
5. **Real-time:** SSE lewat streaming `expo/fetch` saat aktif. Push saat latar belakang. Tanpa WebSocket.
6. **Push:** Expo Push Service. Payload hanya jenis + ID; token terenkripsi; mock lokal (ADR-0067).
7. **Rilis hasil lab ke pasien:** setelah validasi klinis **dan** (dibaca DPJP atau 24 jam). Nilai kritis tidak pernah tampil sebelum DPJP menerima.
8. **Bayar di aplikasi:** hanya VA/QRIS lewat TPDI. Nominal dari server. Cicilan BTN hanya pengajuan dengan persetujuan data (UU PDP).
9. **Gula darah mandiri:** append-only, berlabel "data mandiri pasien". Kode LOINC kosong sampai diimpor (tidak mengarang kode). Tidak memicu CDS/kritis.
10. **Klinisi mobile:** sandi + TOTP per perangkat terdaftar, PIN/biometrik untuk buka cepat, kunci idle 15 menit, step-up untuk TTE dan override. Order cepat hanya order set/favorit dengan CDS yang sama.
11. **Dasbor:** read-model `kpi_daily` di Postgres yang sama (I11 belum ada). Hari ini dihitung tiap 15 menit. Layar polling 60 detik (ADR-0069).
12. **Margin:** JKN = selisih INA-CBG vs tarif RS. Penjamin lain kosong sampai I10 aktif.
13. **Drill-down:** sampai daftar kunjungan ber-RM tanpa nama, diaudit. Membuka pasien memakai izin klinis biasa.
14. **Anggaran:** `revenue_budgets` diisi akuntan bila fase 5 tidak menyediakannya.
15. **Pratinjau web:** `/pratinjau/*` tetap demo-only.
16. **E2E aplikasi:** Playwright terhadap ekspor web khusus uji. Maestro di simulator manual sebelum pilot.
17. **Lokal:** simulator/emulator saja; API tidak dibuka ke LAN.

## 5. Risiko & utang

- **Kecocokan versi:** Expo vs TS 6.0 / Node 24 / pnpm 12. Mitigasi: verifikasi di 9.0c sebelum potongan lain mulai; kunci versi; Metro dikonfigurasi untuk symlink pnpm.
- **Push:** token push = data pribadi, dan server Expo di luar negeri. Mitigasi: payload tanpa PHI, token terenkripsi, DPIA fase 10.
- **Enumerasi / SIM swap / nomor didaur ulang:** respons seragam, rate limit, ganti HP hanya di loket, sesi dicabut saat ganti HP.
- **Waktu rilis hasil** sensitif secara etik: pengaturan per RS, bawaan konservatif.
- **SSE di jaringan seluler:** backoff + replay `Last-Event-ID` + push cadangan.
- **Ekspor web Expo ≠ perangkat asli:** Maestro manual sebelum pilot; daftar pemeriksaan di runbook.
- **Utang yang ditinggalkan:**
  - SMS OTP.
  - Certificate pinning.
  - Rilis toko aplikasi (EAS, akun Apple/Google RS, label privasi).
  - Telekonsultasi video (katalog I07).
  - Agregasi multi-RS dalam satu akun.
  - Mode offline aplikasi.
  - Gudang data I11.
  - SSE kapasitas real-time di dasbor.

## 6. Definisi selesai fase 9 → potongan

| Kriteria                                                                                   | Potongan                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Pasien melihat posisi antrean berubah real-time dan dapat membayar tagihan lewat mock TPDI | 9.0b, 9.0c, 9.0d, 9.2a, 9.2b, 9.3, 9.5, 9.6 |
| Dokter menerima nilai kritis dan melakukan read-back dari aplikasi                         | 9.0d, 9.4a, 9.4b, 9.5, 9.6                  |
| (docs/09) Dasbor direksi dari data operasional                                             | 9.1a, 9.1b                                  |
| (docs/09) Autentikasi pasien terpisah, data minimal, persetujuan akses keluarga            | 9.2a, 9.2b                                  |
| Aturan umum                                                                                | setiap potongan; diperiksa di 9.6           |

---
