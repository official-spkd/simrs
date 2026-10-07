# Serah-terima · fase 4 potongan 4.1a (infrastruktur penunjang: API + worker)

- Diperbarui: 7 Okt 2026 malam WIB
- Status: selesai, menunggu tinjauan DOC + penggabungan orkestrator
- Pemilik sesi: Claude Code (agen A5)
- Branch: `worktree-agent-a0d98d16252d27a40`
- Rencana: `docs/rencana/fase-4-penunjang.md` §4.1a; ADR-0035 (ingest analyzer), ADR-0026 (SSE), ADR-0027 (perangkat)
- Migrasi: `20261008110000_support_infra` (rentang slot 20261008100000–199999)

## Yang dibangun

- **Analyzer lab = prinsipal perangkat** `lab_analyzer` (`DEVICE_KINDS`/`DEVICE_GRANTS` → `lab.analyzer.ingest`).
  Admin mendaftarkannya di Akses → Perangkat; gateway menukar kode di `POST /api/v1/devices/lis/enrol` dan menerima
  token `dv1` + kunci HMAC (32 bita, sekali tampil). Kunci disimpan terenkripsi (`registered_devices.hmac_key_enc`,
  tujuan `device_hmac`) dan ikut rotasi kunci kolom. Kode analyzer tidak berlaku di `/perangkat/daftar` (peramban),
  kode anjungan/TV tidak berlaku di jalur gateway.
- **Ingest** `POST /api/v1/devices/lis/hl7`: body mentah (≤ 256 KB, tipe `application/hl7-v2`, `text/plain`, ER7),
  HMAC `timestamp.body` ≤ 5 menit (salah/kedaluwarsa → 401 tanpa menyimpan, penolakan diaudit), MSH-10 = idempotency
  key (ulang → ACK AA tanpa baris baru; isi beda → 409 + ACK AR), PID/NK1 diredaksi (dijaga CHECK DB), ACK AA = diterima.
  Batas laju per perangkat (`UserThrottlerGuard`).
- **Pemroses pesan masuk generik** (worker `InboundProcessor`/`InboundScheduler`, env `INBOUND_POLL_MS`,
  `INBOUND_BATCH_SIZE`): klaim per tenant hanya untuk sumber yang punya penangan, penangan + penanda `processed` satu
  transaksi, gagal → `failed` + backoff (2 dtk × 2^n, maks. 5 menit) atau `dead` (permanen/8 percobaan); galat
  tersimpan tanpa PHI. Peta penangan `apps/worker/src/inbound/handlers.ts` **masih kosong**: 4.2 menambah
  `['lis-hl7', …]` (penangan memakai `ctx.tx` + `ctx.recordEvent`, galat aman lewat `RetryableInboundError` /
  `PermanentInboundError`).
- **Kerangka modul API:** `lab` (ingest + `ResultsQueryService` F3-9: hasil rilis terbaru per LOINC + eGFR CKD-EPI
  2021), `critical-results` (`raise()` idempoten per hasil/ekspertise, `hasOpenCritical`, `hasOpenCriticalForStudy`),
  `radiology`, `pharmacy-clinical`, `dispensing`, `micro-pa`, `diagnostics`, `nutrition`, `blood-bank` (kosong).
  `surgery` (4.7) dan `stock` (4.6a) dibuat potongannya sendiri (berjalan paralel).
- **SSE** `GET /api/v1/support/streams/{lab-worklist,pharmacy-queue,surgery-board?date=,critical}`: trigger
  `pg_notify` di riwayat status lab/farmasi/OK dan tabel nilai kritis; muatan ID + status + waktu; saring lingkup
  `all`/`unit`/`relationship` (+ penerima eskalasi untuk kanal kritis).
- **Job P11:** `critical.escalation` (tiap menit; tingkat 1 pada batas → DPJP utama + perawat PJ + petugas unit pelapor
  pemegang `critical_result:report`; tingkat 2 pada batas + langkah → pemegang `critical_result:review`; sekali per
  tingkat via indeks unik; in-app + WhatsApp tanpa PHI; event `critical_result.escalated`), `stock.expiry` dan
  `stock.below-minimum` (harian 00.05 WIB, ringkasan per depo ke pemegang `stock:read` di unit depo, sekali per hari).
- **Notifikasi:** inti `notifyStaff` dipindah ke `@simrs/db` (dipakai API dan worker).
- **Mock/E2E:** `POST /_panel/api/lis/credentials` + `mockLis.configure()`; spesifikasi `e2e/penunjang-ingest.spec.ts`
  (hanya proyek desktop karena kredensial mock = keadaan bersama).

## Catatan untuk potongan berikutnya

- 4.2: daftarkan penangan `lis-hl7`; barcode tak dikenal → `RetryableInboundError` (pesan aman) atau permanen sesuai
  kebijakan; chip "analyzer terhubung" bisa membaca `registered_devices.last_used_at` atau `inbound_events.received_at`.
- 4.3: endpoint daftar/lapor/metrik; kanal SSE kritis sudah memancarkan `raised`/`reported`/`escalated`.
- "Kepala unit/ruangan" belum dimodelkan di struktur RS; penerima eskalasi memakai peran/tim yang ada (lihat di atas).
- **Event yang ditulis worker** (`WORKER_EMITTED_EVENTS` di `@simrs/shared`: `critical_result.raised`,
  `critical_result.escalated`): worker hanya menyimpan baris `domain_events`; penangan in-process API tidak berjalan
  untuknya. Supaya tidak ada jalur yang diam-diam mati: `DomainEvents.on()` API MENOLAK (galat saat start) penangan
  untuk event di daftar itu, dan `recordDomainEvent` worker menolak event di luar daftar. Reaksi atas event ini wajib
  lewat jalur yang berlaku untuk kedua penulis: outbox/notifikasi di transaksi penulis, `pg_notify`/SSE dari tabel
  sumber (`support_critical`), atau pembaca ulang `domain_events` (fase 5/7). Menambah nama ke daftar = pastikan belum
  ada penangan in-process untuknya.
