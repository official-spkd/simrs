# Rencana fase 7 · Integration hub dan SATUSEHAT

Disusun 5 Okt 2026 oleh agen Q. Keputusan terbuka diambil otomatis dengan opsi paling baku, aman, dan sederhana, ditandai **(keputusan diambil, disetujui otomatis 5 Okt 2026)**. ADR memakai blok 0051–0057.

## 1. Ringkasan

Fase 7 membangun:

- **I01 integration hub:**
  - konektor per sistem dengan kredensial per RS terenkripsi + rotasi;
  - lajur kirim per tujuan (tanpa head-of-line blocking), circuit breaker, jeda kirim;
  - status/volume/latensi/DLQ per tujuan;
  - kirim ulang dan abaikan yang diaudit;
  - kepatuhan SATUSEHAT per resource (MRMIK 2b).
- **I02 SATUSEHAT:**
  - token OAuth2;
  - registrasi Organization/Location;
  - lookup IHS pasien dan praktisi;
  - pengiriman resource dari outbox dengan urutan Encounter → anak → Encounter selesai;
  - pemetaan di **`packages/fhir` (dibuat baru, dengan tes snapshot)**.
- **I03 BPJS lengkap:** kredensial per RS (keputusan fase 2 #11), Aplicare, web service Mobile JKN yang dipanggil BPJS (keputusan fase 2 #7), VClaim/Antrean/HFIS di hub.
- **I04 Kemenkes (struktur):** RS Online (bed) + kerangka SIRS RL.
- **I05:** Dukcapil/TTE/WhatsApp (efek DLQ ke domain, fallback SMS, kirim ulang) + bank/TPDI dari fase 6.
- **I06 device gateway** (simulasi HL7 v2 dari mock).
- **I12 FHIR server internal baca-saja** (opsional, flag modul).

Layar Integrasi (`/sistem/integrasi`) disambungkan ke API; jalur demo tetap hidup.

### 1.1 Prasyarat dan antarmuka yang dibutuhkan

**Dari fase 2:**

- Konektor BPJS (VClaim, Antrean, HFIS) + operasi outbox-nya.
- Lookup sinkron ADR-0025 (akan memakai kredensial DB).
- Seam konektor worker, `{ defer }` dengan batas umur, `onDead`, P11.
- Prinsipal perangkat ADR-0027 (untuk gateway I06).
- Tabel `practitioners` (NIK; ditambah `ihs_number` bila belum), `external_ids`, `encounters` + `encounter_status_history`.
- Layanan booking/antrean untuk WS Mobile JKN.
- Publisher event domain di dalam transaksi.

**Dari fase 3 (klinis RME):**

- Event domain di dalam transaksi, payload hanya ID `{ entityType, entityId, lineageId, version, encounterId, patientId }`:
  - `encounter.registered|status_changed|finished`
  - `condition.recorded|corrected`
  - `observation.validated` (TTV)
  - `procedure.completed`
  - `allergy.recorded`
  - `medication_request.finalized`
  - `medication_administration.recorded`
  - `discharge_summary.signed`
  - `bed.status_changed`
- **Tabel klinis berversi wajib punya `lineage_id` (= id versi 1)**, supaya satu rantai koreksi = satu resource SATUSEHAT (PUT); status `final`/`entered-in-error`.
- Kolom kode baku `system`/`code`/`display`:
  - ICD-10, ICD-9-CM;
  - LOINC + satuan UCUM;
  - KFA, atau tanda "belum dipetakan";
  - racikan beserta daftar bahan KFA.
- DPJP (practitioner_id) dan lokasi encounter.
- Peran diagnosis utama/sekunder.

**Dari fase 4 (penunjang):**

- Event `service_request.sent` (lab/rad), `specimen.collected`, `lab_result.validated`, `diagnostic_report.released`, `medication_dispense.completed`.
- Accession/barcode.
- Fungsi `ingestInstrumentResult(tx, { accession, loinc, value, unit, flag, deviceId })` yang membuat hasil **draf/belum tervalidasi**.
- Jadwal kamar operasi (untuk WS jadwal operasi).

**Dari fase 5:** konektor E-Klaim (target `eklaim`) didaftarkan ke registri hub.

**Dari fase 6:**

- `integration_connections`, `integration_secrets`, `IntegrationSecretsService`;
- modul `webhooks`, pemroses inbound;
- konektor TPDI/BTN.

Bila data fase 3/4 belum siap saat 7.3b, tes memakai pabrik data DB. E2E DoD-1 menunggu DoD fase 3/4. Bagian 7.0b, 7.1, dan 7.2 boleh mulai lebih awal **(keputusan diambil, disetujui otomatis 5 Okt 2026)**.

## 2. Potongan kerja (urut dependensi)

### 7.0a · Kontrak bersama (`packages/shared`)

**Izin:**

- `integration` (read, manage)
- `integration.dlq` (resend, dismiss)
- `integration.credentials` (read, rotate)
- `fhir` (read)
- izin perangkat `device.hl7.ingest`

**Bawaan:**

- admin_tenant: semua `integration.*`.
- manajemen dan petugas_rm: `integration.read`.
- petugas_rm: `fhir.read`.

**Target:**

- `INTEGRATION_TARGETS` ditambah `kemenkes`, `lis`, `pacs`, `sms` (mock ikut mendaftar).
- `interfaceOf(target, operation)` memetakan ke kartu hub (`bpjs-vclaim`, `bpjs-antrean`, `bpjs-aplicare`, dst.).

**Ambang status:**

- lambat = p95 di atas ambang per target;
- gangguan = circuit terbuka atau galat ≥ 50% dalam 15 menit;
- dijeda.

**Kebijakan retry SATUSEHAT:** 12× dengan batas jeda 30 menit; defer maksimal 24 jam.

**Kontrak zod:**

- `integrations/satusehat/contract.ts`: token, OperationOutcome, Bundle searchset.
- `integrations/bpjs/aplicare.ts`, `integrations/bpjs/mobile-jkn-ws.ts`.
- `integrations/kemenkes/{rsonline,sirs}.ts`.
- `integrations/hl7v2/`: parser/serializer murni ORM^O01, ORU^R01, ACK.

**Kode galat stabil:**

- `SATUSEHAT_PATIENT_NOT_FOUND`, `SATUSEHAT_PATIENT_IHS_MISSING`, `SATUSEHAT_PRACTITIONER_IHS_MISSING`
- `SATUSEHAT_LOCATION_UNREGISTERED`, `SATUSEHAT_KFA_UNMAPPED`, `SATUSEHAT_CODE_INVALID`
- `SATUSEHAT_VALIDATION`, `SATUSEHAT_RATE_LIMITED`, `SATUSEHAT_ENCOUNTER_DIAGNOSIS_PENDING`
- `INTEGRATION_PAUSED`, `CREDENTIAL_TEST_FAILED`

**Revisi skema:** bagian integrasi `schemas/manajemen.ts` pindah ke `schemas/integration.ts`:

- kartu dinamis (`.min(1)`, bukan panjang tetap);
- status `dijeda`;
- ID DLQ = UUID (sekarang regex `dlq-\d{3,6}`);
- `replicationLagSeconds` dan `backups` nullable (P13/infra fase 10);
- skema input resend/dismiss/pause/rotate.

### 7.0b · `packages/fhir` (paket baru, paralel dengan 7.0c/7.0d)

**Kerangka:** sama dengan `packages/shared` (`package.json` `@simrs/fhir`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `README.md`). Dependensi runtime hanya `zod`.

**Isi `src/`:**

- `types.ts`: tipe FHIR R4 minimal buatan sendiri.
- `systems.ts`: URL sistem:
  - NIK, IHS, `http://sys-ids.kemkes.go.id/encounter/{orgId}`;
  - ICD-10, ICD-9-CM, LOINC, UCUM, KFA, SNOMED;
  - v3 ActCode AMB/EMER/IMP;
  - kategori observation/condition.
- `datetime.ts`: offset WIB `+07:00`, deterministik.
- `errors.ts`: `FhirMappingError` + kode stabil.
- `map/*.ts`: fungsi murni `toFhir<Resource>(input, ctx)` untuk:
  - Encounter (statusHistory, classHistory, diagnosis), Condition, Observation;
  - Procedure, ServiceRequest, Specimen, DiagnosticReport;
  - Medication (racikan + ingredient), MedicationRequest, MedicationDispense, MedicationAdministration;
  - AllergyIntolerance, Composition, Organization, Location;
  - ImagingStudy (kerangka).
- Input = tipe domain milik paket, bukan Prisma. Referensi (IHS, ID lokasi, ID Encounter/Condition SATUSEHAT) sudah ter-resolve di input.
- `ctx.mode`: `satusehat` | `local` (untuk I12).
- `validate/*.ts`: syarat minimal profil SATUSEHAT dengan zod.
- `canonical.ts`: JSON kanonik untuk hash perubahan.

**Tes (`test/`):**

- Fixture fiktif dengan kode dari `SEED_REF_SAMPLES`.
- `toMatchFileSnapshot('__snapshots__/<nama>.json')` per resource dan per varian (RJ/IGD/RI, koreksi, entered-in-error).
- Tes negatif: KFA kosong, racikan tanpa bahan, Observation tanpa UCUM, Encounter selesai tanpa diagnosis.
- Determinisme: input sama → output identik.
- Tes tanpa PHI: tidak ada nama/NIK di resource klinis.
- Tes zona waktu.

**Kebijakan snapshot:** diperbarui hanya dengan `-u` sadar dan ditinjau di PR.

**DoD:** 1, 2.

### 7.0c · Skema DB + migrasi + seed (`packages/db`)

**Koneksi dan kredensial:**

- `integration_connections` diperluas ke semua sistem (bpjs, satusehat, eklaim, dukcapil, tte, tpdi, btn, whatsapp, sms, email, kemenkes, lis, pacs). Kolom baru:
  - `paused_at`, `paused_by`, `pause_reason`, `pause_until`;
  - `circuit_open_until`, `consecutive_failures`.
- `integration_secrets` untuk:
  - BPJS: `cons_id`, `secret_key`, `user_key`
  - SATUSEHAT: `client_id`, `client_secret`
  - E-Klaim, Dukcapil, TTE, Kemenkes

**Jejak pengiriman:**

- `delivery_attempts`:
  - kolom baru `target`, `operation`, `cycle` (backfill dari `outbox_messages`);
  - indeks `(tenant_id, target, started_at)`;
  - append-only.
- `outbox_messages`:
  - kolom baru `cycle`, `resent_at/by`, `dismissed_at/by/reason`;
  - status `dismissed`;
  - trigger membekukan `target`/`operation`/`idempotency_key`/`payload`.
- REVOKE DELETE pada `outbox_messages`, `delivery_attempts`, `inbound_events`.

**SATUSEHAT:**

- `satusehat_resource_links`:
  - Kolom: entity_type, lineage_id, encounter_id, patient_id, resource_type, resource_id, last_sent_version, last_sent_hash, status (pending|sent|failed|skipped), last_error_code, first_queued_at, sent_at.
  - Unik per (tenant, entity_type, lineage_id).
  - `resource_id` beku setelah terisi.
- `practitioners`: `ihs_number`, `ihs_status`, `ihs_checked_at` (bila belum ada).

**BPJS WS, Kemenkes, perangkat:**

- `bpjs_ws_clients`: username, hash argon2id, aktif.
- `bpjs_ws_tokens`: hash token, kedaluwarsa, dicabut.
- `kemenkes_report_submissions`: kode, periode, status, sha256, message id, kode respons.
- `device_messages`:
  - Kolom: device_id, arah, tipe, control_id unik per perangkat+arah, `raw_enc`, status, error_code, entitas terkait.
  - `raw_enc` = AES-GCM, tujuan `device_message`.
  - Append-only kecuali status.

**Lain-lain:**

- Migrasi data izin.
- Seed kredensial lokal dari env.

**Tes:** RLS, trigger beku, schema-guard, satu secret aktif, semantik `cycle`.

### 7.0d · Mock (`apps/mock`)

**SATUSEHAT** (`systems/satusehat.ts`):

- Kredensial klien per tenant → org; TTL token bisa diatur (mode uji 5 detik).
- Lookup Patient dan Practitioner per NIK. NIK berakhiran 9999 → tidak ditemukan (selaras dengan aturan Dukcapil).
- POST/PUT/GET semua resource, disimpan per org.
- **Validasi yang memaksa urutan:** anak harus merujuk Encounter yang sudah ada; Encounter `finished` wajib diagnosis merujuk Condition yang ada.
- Validasi format:
  - Encounter: identifier per org, `Patient/P…`, Practitioner, Location terdaftar, serviceProvider.
  - Kode ICD-10; LOINC + check digit (`lokal-*` ditolak); KFA + aturan racikan.
- Pencarian Encounter per identifier.
- 429 dengan `Retry-After`; 5xx/timeout.
- `GET /_panel/api/satusehat/received?org=`: log berurutan untuk tes DoD.

**BPJS:**

- Aplicare.
- Pemanggil WS Mobile JKN: panel/API memanggil `/api/v1/bpjs-ws/<KODE_RS>/…` dengan kredensial uji per tenant.

**Kemenkes:** RS Online (bed) + SIRS RL dengan validasi bentuk.

**LIS/PACS:**

- Penerima ORM dengan skenario gagal.
- Tombol "Analyzer: kirim hasil" mengirim ORU^R01 ke gateway sebagai perangkat.

**SMS:** `/sms/send`.

**Saklar global:** `POST /_panel/api/scenario/all` + tombol "Matikan semua eksternal".

**Tes:** mock.

### 7.1a · Inti hub di worker

**Registri konektor** `apps/worker/src/connectors/registry.ts`:

- Base URL dari env per mode; lokal → mock. Pemeriksaan origin anti-SSRF dipertahankan.
- Strategi autentikasi per target:
  - BPJS: tanda tangan (fase 2);
  - SATUSEHAT: OAuth2 bearer, cache token per tenant + refresh single-flight + ulang sekali saat 401;
  - TPDI: API key;
  - BTN: client credentials/mTLS;
  - Kemenkes;
  - generik.
- Timeout per target.
- Kredensial per tenant dari `IntegrationSecretsService`.
- **Kredensial env dipindah ke DB.** Lookup sinkron API (ADR-0025) ikut membaca DB.

**Dispatcher** `apps/worker/src/outbox/outbox.dispatcher.ts`:

- **Lajur per (tenant, target)**: klaim per target, konkurensi terbatas per target (mis. SATUSEHAT 4, BPJS 4, lainnya 2) + batas global. Menutup utang "dispatcher berurutan per tenant".
- **Circuit breaker** per (tenant, target):
  - terbuka setelah 5 galat sementara berturut;
  - jeda 30 detik, naik eksponensial sampai 5 menit;
  - half-open dengan satu probe;
  - **saat terbuka, pesan tidak dicoba dan percobaan tidak terpakai**.
- **Jeda:** target dijeda tidak diklaim; `pause_until` melanjutkan otomatis.
- `recordOutboxAttempt` mengisi `target`/`operation`/`cycle`.

**Registri `onDead` lengkap:**

- SEP (fase 2)
- TTE → tanda tangan `failed` (menutup utang ADR-0020 bila belum)
- Dukcapil → verifikasi `error`
- TPDI/BTN (fase 6)
- SATUSEHAT → link `failed`
- Kemenkes → pengiriman `failed`
- ORM → tanda "tidak sampai ke alat" pada order

**Tes:**

- SATUSEHAT lambat tidak menunda BPJS (diukur);
- siklus circuit, tanpa konsumsi percobaan;
- jeda;
- kredensial RSFA ≠ RSFB (diperiksa mock);
- refresh token;
- SSRF;
- `onDead` atomik.

**DoD:** 2, 3.

### 7.1b · API hub (`apps/api/src/modules/integration-hub/`)

Semua endpoint di bawah `/api/v1/integration`.

**Pemantauan** (`integration.read`):

- `GET overview`:
  - kartu: status, volume per jam 24 jam, gagal hari ini, p95, jam bergalat;
  - statistik webhook masuk + penolakan;
  - kepatuhan SATUSEHAT per resource;
  - ringkasan kredensial dan status jeda.
- `GET dead-letters?target&cursor` dan `GET dead-letters/:id`:
  - payload hanya ID;
  - baris request terakhir, cuplikan respons non-sensitif;
  - percobaan per siklus.
- `GET compliance.csv`: diaudit `export`, bukti untuk surveior MRMIK 2b.

**Antrean gagal:**

- `POST dead-letters/resend {ids ≤ 50}` (`integration.dlq.resend`):
  - dead → pending, `cycle`+1, `attempts` 0;
  - **idempotency key tetap**;
  - ditolak 409 `INTEGRATION_PAUSED` bila target dijeda;
  - audit per pesan.
- `POST dead-letters/dismiss {ids, reason ≥ 10}`.

**Kendali** (`integration.manage`, alasan wajib, diaudit):

- `POST connectors/:system/pause|resume`
- `POST pause-all|resume-all`
- `POST connectors/:system/test`: panggilan sinkron di luar transaksi (pola ADR-0025), hanya status + latensi.

**Kredensial:**

- `GET credentials` (`integration.credentials.read`): metadata saja.
- `POST credentials/:system/:name/rotate {value, totpCode}` (`rotate` + step-up TOTP):
  - pending → uji koneksi → aktif;
  - tumpang tindih 0 untuk BPJS/SATUSEHAT, 24 jam untuk secret webhook;
  - audit tanpa nilai.

**Tes:** `apps/api/test/integration-hub.test.ts`:

- manajemen hanya baca; perawat 403;
- DLQ RSFB → 404; hitungan hanya tenant sendiri;
- semantik resend (siklus, kunci tetap, riwayat utuh);
- dismiss wajib alasan;
- kredensial tidak pernah keluar;
- step-up gagal diaudit;
- metrik tepat pada fixture percobaan.

**DoD:** 2, 3.

### 7.2 · Layar Integrasi (api) + status di sidebar

**Halaman `app/(staf)/sistem/integrasi/`:**

- `page.tsx` memakai `requireScreen('integrasi')`.
- Jalur demo `demo-integrasi.tsx` = isi sekarang, dibekukan.
- Jalur api `api-integrasi.tsx` memakai ulang `integration-hub.tsx` dan `dead-letter-queue.tsx`.
- `actions.ts` dipecah menjadi `demo-actions.ts` (simulasi lama) + `actions.ts`: resend, dismiss, pause-all/resume-all.
- "Uji mode downtime"/"Pulihkan" di mode api = jeda/lanjut semua konektor eksternal.
- `kredensial-dialog.tsx` untuk rotasi.
- Bagian "Registrasi SATUSEHAT": lokasi tanpa ID, praktisi tanpa IHS.

**Data:**

- `lib/server/data/integration.ts`, dipecah dari `manajemen.ts`.
- Status integrasi di sidebar (`lib/nav.ts`) dari overview, cache 30 detik. Menutup utang menu statis.

**Tes:**

- unit pemetaan;
- E2E `apps/web/e2e/integrasi.spec.ts`: DLQ muncul setelah 422 mock → kirim ulang setelah perbaikan; jeda/lanjut; kredensial tersamar; gerbang peran;
- `e2e/demo/manajemen.spec.ts` tetap hijau.

**DoD:** 2, 3.

### 7.3a · SATUSEHAT identitas

**Operasi outbox:**

- `satusehat.patient.lookup`
  - Pemicu: event NIK terverifikasi Dukcapil (P05) atau `encounter.registered` tanpa IHS.
  - `prepare` mendekripsi NIK; operasi `sensitive`.
  - `onSuccess` menyimpan IHS di `patient_identifiers` (sistem `ihs`, terenkripsi + hash, `verified`).
  - IHS berbeda dari yang sudah ada → tidak ditimpa + tanda tinjauan MPI `IHS_CONFLICT`.
  - Tidak ditemukan → DLQ `SATUSEHAT_PATIENT_NOT_FOUND`.
- `satusehat.practitioner.lookup`.
- `satusehat.location.register`: POST Location dengan identifier + managingOrganization → `locations.satusehat_location_id`.
- `satusehat.organization.verify` terhadap `tenants.satusehat_org_id`.

**API** (`integration.manage`, diaudit):

- `GET /api/v1/integration/satusehat/registry`
- `POST …/locations/register {locationIds}`
- `POST …/practitioners/lookup`

**Gabung MPI:** tidak dikirim ke SATUSEHAT; IHS pasien yang dipertahankan dipakai. Menutup utang P05 dengan penjelasan.

**Tes:**

- IHS tidak pernah polos di outbox/`delivery_attempts`;
- tidak ditemukan → DLQ; setelah NIK diperbaiki → lookup baru berhasil;
- konflik IHS tidak menimpa;
- token kedaluwarsa, 401/429;
- isolasi kredensial.

**DoD:** 1, 2.

### 7.3b · SATUSEHAT resource dari event domain

**API** `apps/api/src/modules/satusehat/listeners.ts`:

- Listener dalam transaksi → upsert link `pending` + outbox `satusehat.resource.sync`.
- Kunci idempotensi `ss:<type>:<lineage>:v<version>`.

**Worker** `apps/worker/src/satusehat/sync.ts` + `readers/*.ts` (membaca tabel fase 3/4), langkah per pesan:

1. Versi ≤ yang sudah terkirim, atau hash tak berubah → `skip`.
2. Resolusi referensi; ketergantungan belum siap (Encounter belum terkirim, lookup IHS menunggu) → `defer`, maksimal 24 jam, lalu galat permanen berkode.
3. Validasi pra-kirim lewat `packages/fhir` (mis. KFA belum dipetakan) → DLQ tanpa memanggil SATUSEHAT.
4. Kirim:
   - belum ada `resource_id` → POST;
   - sudah ada → PUT;
   - setelah kegagalan ambigu atas POST → cari per identifier dulu.
5. `onSuccess` mengisi link.

**Aturan khusus:**

- Encounter `finished` menunggu semua Condition final terkirim (maks. 6 jam → `SATUSEHAT_ENCOUNTER_DIAGNOSIS_PENDING`).
- `entered-in-error` → PUT status.
- Metrik kepatuhan per resource dari tabel link.

**Tes** (worker + mock + DB):

- **Satu kunjungan RJ lengkap terkirim berurutan** (diperiksa lewat log mock): Encounter → Condition/Observation/Procedure/MedicationRequest/Dispense → Encounter selesai dengan diagnosis.
- LOINC salah → 422 → DLQ berkode dengan payload ID → data diperbaiki → kirim ulang → 201.
- Koreksi → PUT ke resource yang sama.
- Event ganda → 1 pesan.
- Timeout setelah POST → tanpa Encounter ganda.
- Isolasi tenant (org/kredensial).
- Tidak ada PHI di cuplikan respons.

**DoD:** 1, 2.

### 7.4 · BPJS lengkap (I03)

**Kredensial per RS** (dari 7.1a). VClaim/Antrean/HFIS tampil sebagai kartu terpisah di hub.

**Aplicare:**

- Listener `bed.status_changed` → `bpjs.aplicare.update`: keadaan terkini per kelas, kunci per menit sebagai debounce.
- Job sinkron penuh harian.

**WS Mobile JKN** (`apps/api/src/modules/bpjs-ws/`):

- Rute `/api/v1/bpjs-ws/:tenantCode/{auth, statusantrean, ambilantrean, sisaantrean, batalantrean, checkin, pasienbaru, jadwaloperasirs, jadwaloperasipasien}`. Nama dicocokkan dengan spesifikasi resmi.
- Autentikasi:
  - username/sandi argon2id → token buram 256 bit tersimpan hash, TTL sesuai spesifikasi;
  - header `x-token`/`x-username`;
  - salah sandi → kunci sementara; rate limit.
- Respons `{ metadata: { code, message }, response }`.
- Memanggil layanan booking/antrean fase 2 (sumber `mobile_jkn`), MPI untuk pasien baru, dan jadwal OK fase 4 (bila belum ada → daftar kosong).
- Audit aktor `bpjs-ws`.
- Kelola kredensial WS lewat `integration.credentials.rotate`.

**Tes:**

- sandi salah → 401 + kunci; token kedaluwarsa;
- token RSFA di path RSFB → 401;
- ambil antrean mematuhi CHECK kuota;
- batal melepas kuota;
- debounce Aplicare;
- kredensial per tenant.

**Utang:** iCare, Apotek Online, PCare, monitoring klaim/histori pelayanan.

### 7.5 · Kemenkes (I04, struktur)

- Konektor `kemenkes`.
- RS Online bed: pola sama dengan Aplicare.
- Registri laporan SIRS RL di shared.
- Generator bulanan (P11) untuk 1–2 laporan dari data yang ada (kunjungan RJ per poli; kegiatan rawat inap bila ADT siap); laporan lain "belum tersedia".
- `kemenkes_report_submissions` + outbox `kemenkes.sirs.submit`; kirim ulang dari hub.

**Tes:** hanya agregat (tanpa PHI), batas periode WIB, idempoten per periode.

**Utang:** SISRUTE, SITB, surveilans.

### 7.6 · I05 layanan pendukung

- **Dukcapil:** kredensial per tenant; kirim ulang DLQ menjalankan verifikasi baru dengan nomor permintaan baru (aturan ADR-0017). Menutup utang P05.
- **TTE:** `onDead` → tanda tangan `failed` + status dokumen.
- **WhatsApp:** galat permanen "nomor tidak terdaftar" → `notify.sms` (mockup d7).
- **Email/WhatsApp/SMS:** kredensial tingkat platform di MVP.
- **Bank/TPDI:** kartu hub + statistik webhook dari fase 6.

**Tes:** efek `onDead` atomik; fallback hanya untuk kode tersebut; isolasi tenant.

### 7.7 · I06 device gateway (simulasi; flag modul `I06`, bawaan mati)

**Keluar:**

- `service_request.sent` → `lis.orm.send` / `pacs.orm.send` (ORM^O01, ACK AA/AE).
- `device_messages` terenkripsi.

**Masuk:**

- `POST /api/v1/device-gateway/hl7`:
  - prinsipal perangkat + `device.hl7.ingest`;
  - `text/plain` ≤ 64 KB, raw-body sebelum transaksi;
  - disimpan → jawab ACK AA/AR.
- Worker memetakan OBX (LOINC, nilai, UCUM, flag) ke `ingestInstrumentResult` sebagai **draf** (validasi analis S01; nilai kritis S09 setelah validasi).
- Listener MLLP di server edge → fase 10.

**Tes:**

- parser golden (escape, repetisi);
- accession tak dikenal → AE;
- `control_id` ganda idempoten;
- perangkat tenant lain ditolak; token staf 403;
- hasil selalu draf;
- raw terenkripsi;
- flag mati → 404.

### 7.8 · I12 FHIR server baca-saja (flag modul `I12`, bawaan mati)

**Rute** `apps/api/src/modules/fhir-server/`:

- `GET /api/v1/fhir/r4/metadata`
- `Patient/:id`, `Encounter/:id`
- `Encounter?patient=`, `Condition?patient=|encounter=`, `Observation?patient=&category=`, `AllergyIntolerance?patient=`

**Format:**

- `application/fhir+json`, Bundle searchset dengan kursor.
- Pemetaan `packages/fhir` mode `local`.
- Identifier hanya RM + IHS; NIK tidak disertakan.

**Akses:** sesi staf + `fhir.read` + ABAC `PatientAccessService` + audit `read` per pasien; kelompok rekam medis (`app_patient_group`) dihormati.

**Tes:** flag mati 404; tanpa izin 403; lingkup relasi; isolasi tenant; audit; snapshot respons.

**Utang:** klien mitra OAuth.

### 7.9 · Penutup fase 7

- **E2E DoD-1:** `apps/web/e2e/satusehat-rj.spec.ts`. Kunjungan RJ lengkap lewat layar/API fase 2–4 → log mock berurutan. Bila layar klinis belum siap: tes integrasi worker.
- **E2E DoD-2:** mock menolak kode → DLQ terlihat di hub → perbaikan data atau koreksi berversi → kirim ulang → terkirim.
- **E2E DoD-3:** `downtime.spec.ts`. Mock "matikan semua", lalu jalankan pendaftaran (SEP pending), CPPT, order, hasil lab, bayar tunai, intent TPDI `draft`:
  - semuanya 2xx;
  - circuit terbuka dan DLQ tidak membanjir;
  - setelah dipulihkan → antrean terkuras dengan urutan terjaga;
  - diulang dengan varian jeda semua.
- **Review keamanan:** SSRF, secret, endpoint publik webhook/WS/gateway, PHI di log/cuplikan, ABAC I12.
- **ADR-0051…0057.**
- **Dokumen:** docs/06 (§1 kredensial, §4 SATUSEHAT, WS Mobile JKN, gateway), docs/04, panduan, PROGRESS, QA visual, regresi demo.

## 3. Paralelisasi (maks. 4 agen sekaligus)

| Gelombang | Potongan                |
| --------- | ----------------------- |
| A         | 7.0a                    |
| B         | 7.0b ∥ 7.0c ∥ 7.0d      |
| C         | 7.1a ∥ 7.5 ∥ 7.7 ∥ 7.8  |
| D         | 7.1b ∥ 7.3a ∥ 7.4 ∥ 7.6 |
| E         | 7.2 ∥ 7.3b              |
| F         | 7.9                     |

**Kepemilikan berkas:**

- `packages/fhir/**`: 7.0b.
- `schema.prisma` + migrasi: 7.0c.
- `apps/mock/src/systems/{satusehat,bpjs,kemenkes,devices}.ts`: 7.0d.
- `apps/worker/src/outbox/outbox.dispatcher.ts` + `apps/worker/src/connectors/**`: 7.1a saja.
- `apps/worker/src/satusehat/identity.ts`: 7.3a; `satusehat/sync.ts` + `readers/**`: 7.3b.
- API:
  - `modules/integration-hub/**`: 7.1b;
  - `modules/satusehat/**`: 7.3a membuat, 7.3b menambah `listeners.ts`;
  - `modules/bpjs-ws/**`: 7.4;
  - `modules/device-gateway/**`: 7.7;
  - `modules/fhir-server/**`: 7.8.
- Web `app/(staf)/sistem/integrasi/**` + `lib/server/data/integration.ts` + `lib/nav.ts`: 7.2.
- Peta `OUTBOX_OPERATIONS`, `INBOUND_HANDLERS`, `onDead`, `PERMISSION_CATALOG`, `INTEGRATION_TARGETS`, `screens.ts`: satu baris per potongan.
- PROGRESS: hanya agen penggabung.

## 4. Keputusan (semua **(keputusan diambil, disetujui otomatis 5 Okt 2026)**)

1. **Kredensial** di `integration_secrets` (kunci terpisah, hanya-tulis, berversi). docs/06 §1 ("tenant_settings terenkripsi") diperbarui.
   - Base URL dari env per mode, tidak bisa diubah per RS (anti-SSRF); RS hanya memilih sandbox/produksi.
2. **Sinkron SATUSEHAT = keadaan terkini** per rantai versi (`lineage_id`):
   - koreksi = PUT;
   - urutan lewat `defer`;
   - cari per identifier sebelum POST ulang setelah galat ambigu.
3. **`packages/fhir`:**
   - tipe FHIR minimal sendiri (tanpa `@types/fhir`);
   - snapshot JSON lewat `toMatchFileSnapshot`;
   - `display` Patient/Practitioner dihilangkan (minimisasi data);
   - waktu ber-offset `+07:00`.
4. **IHS pasien:**
   - di-lookup setelah NIK terverifikasi atau saat registrasi;
   - tidak ditemukan → DLQ berkode;
   - gabung MPI tidak dikirim (IHS yang dipertahankan dipakai).
   - IHS praktisi di `practitioners.ihs_number`.
5. **Organization ID** = `tenants.satusehat_org_id`. Location didaftarkan lewat aksi hub.
6. **"Uji mode downtime" di mode api = jeda semua konektor eksternal.** Pesan tetap menunggu dan tidak dihitung gagal; wajib alasan; diaudit. Lag replikasi dan backup tampil "tersedia fase 10" (P13).
7. **Kirim ulang DLQ** = siklus baru dengan idempotency key sama. **Abaikan** wajib alasan. Keduanya diaudit; bawaan hanya admin_tenant.
8. **Lajur per target + circuit breaker**; percobaan tidak terpakai selama circuit terbuka.
9. **Metrik dihitung langsung** dari `delivery_attempts` (target/operation didenormalisasi + indeks) untuk 24 jam. Rollup per jam = utang.
10. **Rotasi kredensial:** step-up TOTP, uji koneksi sebelum aktif; tumpang tindih 0 (BPJS/SATUSEHAT) atau 24 jam (secret webhook).
11. **WS Mobile JKN:** path per kode RS + username/sandi per RS (argon2id) → token buram berumur pendek; format respons BPJS.
12. **Aplicare/RS Online:** keadaan terkini per kelas, debounce 1 menit.
13. **I04 hanya struktur:** RS Online + kerangka SIRS RL.
14. **I06:** transport HTTP di lokal, MLLP di edge (fase 10); hasil alat selalu draf; raw HL7 terenkripsi.
15. **I12:** baca-saja, flag mati bawaan, sesi staf + ABAC + audit.
16. **Kanal email/WhatsApp/SMS:** kredensial platform, bukan per RS, di MVP.
17. **Fase 7 boleh mulai sebagian** (7.0b, 7.1, 7.2) sebelum DoD fase 3/4.
18. **Retry SATUSEHAT:** 12× dengan batas jeda 30 menit; defer maksimal 24 jam.

**ADR fase 7:**

- 0051 hub, lajur, circuit, jeda
- 0052 kirim ulang dan abaikan DLQ
- 0053 sinkron SATUSEHAT
- 0054 `packages/fhir`
- 0055 WS Mobile JKN
- 0056 device gateway
- 0057 FHIR server internal

## 5. Risiko dan utang

**Risiko:**

- **Profil SATUSEHAT nyata lebih ketat dari mock** → validator HAPI opsional (profil Docker `fhir`, docs/06) + uji sandbox sebelum produksi.
- **Ketergantungan bentuk data fase 3/4:** `lineage_id`, event dalam transaksi, kode baku.
- **Duplikasi POST** saat timeout.
- **429 dan kuota per organisasi.**
- **Balapan refresh token** antar-worker.
- **KFA belum dipetakan / LOINC lokal** → DLQ besar di awal; kepatuhan tampil di hub.
- **Throughput dan biaya kueri metrik.**
- **Kunci `INTEGRATION_SECRET_KEY`** dipegang API dan worker.
- **Endpoint publik** (WS BPJS, gateway): enumerasi dan brute force → rate limit, kunci, audit.
- **HL7 dari alat nyata** lebih beragam.
- **Paparan PHI lewat I12.**
- **Semantik downtime vs edge P13** (fase 10).
- **Spesifikasi resmi** BPJS WS/Aplicare/Kemenkes harus dicocokkan (catatan docs/06).

**Utang:**

- iCare, Apotek Online, PCare, SISRUTE, SITB, surveilans, RL lengkap;
- listener MLLP + DICOM worklist;
- ImagingStudy penuh;
- pemetaan form P07 → Questionnaire;
- OAuth mitra I12;
- rollup metrik;
- KMS/secret manager produksi;
- kredensial kanal pesan per RS.

**Utang yang ditutup:**

- dispatcher berurutan per tenant;
- DLQ Dukcapil tanpa kirim ulang;
- status TTE saat DLQ;
- menu sidebar statis untuk status integrasi;
- penggabungan MPI ke SATUSEHAT (dengan penjelasan);
- kredensial BPJS env tunggal (keputusan fase 2 #11).

## 6. Definisi selesai fase 7 → potongan

| Kriteria                                                                                                            | Potongan                          |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Satu kunjungan RJ lengkap terkirim ke mock SATUSEHAT dengan urutan benar                                            | 7.0b, 7.0d, 7.1a, 7.3a, 7.3b, 7.9 |
| Galat 422 masuk DLQ dengan payload yang bisa ditelusuri; kirim ulang berhasil setelah perbaikan data                | 7.0b, 7.1a, 7.1b, 7.2, 7.3b, 7.9  |
| Mode downtime mock (semua eksternal mati) tidak menghentikan layanan klinis                                         | 7.0d, 7.1a, 7.1b, 7.2, 7.9        |
| Aturan umum (migrasi, seed, tes izin + isolasi, audit, teks Indonesia, lint/typecheck/test hijau, demo tetap hidup) | setiap potongan; diperiksa di 7.9 |

---

### Temuan kode yang memengaruhi rencana

1. **Dispatcher memblokir lintas tujuan.** `apps/worker/src/outbox/http-connector.ts` mengirim semua tujuan ke satu `MOCK_BASE_URL`. `outbox.dispatcher.ts` memproses pesan berurutan per tenant, sehingga SATUSEHAT yang timeout menahan BPJS. Ditangani di 7.1a.
2. **Hak DELETE dan perubahan raw.** `simrs_app` punya DELETE pada `outbox_messages`, `delivery_attempts`, dan `inbound_events` (migrasi `20261003000000_fondasi`), dan `inbound_events` belum dibekukan. Ditangani di 6.0b/7.0c.
3. **Fungsi SECURITY DEFINER tidak bisa membaca tabel FORCE-RLS.** Tabel dengan FORCE RLS juga mengikat pemilik tabel, jadi fungsi seperti itu tidak bisa membaca `integration_connections`. Karena itu webhook memakai kode RS di path lewat `app_resolve_tenant_by_code`.
4. **Kontrak demo tidak cocok untuk data nyata.**
   - `packages/shared/src/schemas/btn.ts` memakai `.min(1)` dan ID `PCR-…`, serta mencampur skema kamar operasi (OR).
   - `schemas/manajemen.ts` memakai DLQ `dlq-\d{3,6}` dan kartu antarmuka berpanjang tetap.
   - Semua direvisi di 6.0a/7.0a.
5. **Mock TPDI masih kurang.** Panel mendeklarasikan `amountOverride` tetapi tidak memakainya. Mock juga belum mendukung multi-merchant, refund, mutasi lengkap, atau pembiayaan BTN. Ditangani di 6.0d.
