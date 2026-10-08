# Serah-terima · fase 4 potongan 4.2 (S01 laboratorium inti)

- Diperbarui: 7 Okt 2026 malam WIB
- Status: selesai, menunggu tinjauan DOC + penggabungan orkestrator
- Pemilik sesi: Claude Code (agen A5)
- Branch: `worktree-agent-a0d98d16252d27a40`
- Rencana: `docs/rencana/fase-4-penunjang.md` §4.2; ADR-0034 (worklist/ABAC penunjang), ADR-0035 (ingest analyzer)
- Migrasi: `20261008120000_lab_core` (rentang slot 20261008100000–199999)

## Yang dibangun

- **Inti lab di `@simrs/db`** (`src/lab.ts`), dipakai API (input manual, koreksi) DAN worker (hasil analyzer):
  tes yang diharapkan per order (`lab_test_definitions.orderable_id`, order panel lewat kolom baru
  `orderables.lab_panel_code` → `panel_code`), rentang rujukan + batas kritis per jenis kelamin × umur saat sampel,
  flag, delta check terhadap hasil rilis terakhir di kelompok RM, simpan versi hasil, `raiseCriticalResult`, status
  order (`diterima → sampel → proses → hasil`, lalu `validasi_teknis`/`selesai` oleh validasi).
- **API `/api/v1/lab`** (`LabService`):
  - `GET worklist?view=aktif|selesai`: order CPOE lab baru (belum diterima, ≤ 14 hari, status order aktif)
    dikelompokkan per kiriman + order lab unit; audit `search` per pasien saat dimuat.
  - `POST orders` (Idempotency-Key wajib): nomor lab harian, item, satu spesimen per jenis tabung
    (`<nomor lab>-NN`), event `lab.order_accepted`.
  - `POST specimens/:id/collect|receive|reject`: tolak = tabung baru + event `lab.specimen_rejected` + notifikasi
    tim perawatan tanpa PHI.
  - `POST orders/:id/results`: input manual; nilai kritis → `CriticalResultsService.raise()`.
  - `POST orders/:id/validations/technical` (`lab.result:verify`) dan `/clinical` (`lab.result:release`). Endpoint
    dipisah karena izinnya berbeda (rencana menulis satu endpoint `{level}`). Teknis diblokir nilai kritis terbuka
    (`CRITICAL_OPEN`) dan QC ditolak hari ini (`QC_REJECTED`, kecuali alasan override). Klinis = rilis: PDF hasil
    ber-TTE (dokumen `hasil`), `released_at`, hasil ditulis ke muara hasil fase 3 (`observations` kategori `lab`,
    per order CPOE × tes; koreksi = versi observasi baru), event `lab.result_released`, notifikasi DPJP.
  - `POST results/:id/corrections`: versi baru beralasan; order kembali `hasil` (putaran validasi baru); event
    `lab.result_corrected` (+ notifikasi bila sudah rilis).
  - `GET/POST qc` (Westgard dari `rules/lab`), `GET tests`, `GET inbound-issues` (pesan analyzer gagal/berhenti,
    tanpa isi), `GET orders/:id/print` (HTML ber-watermark, audit `print`).
- **ABAC (F3-8, keputusan no. 3):** `PatientAccessService` mendapat dasar akses `support_order`: unit pelaksana melihat
  pasien yang order lab/radiologinya ditujukan ke unit itu (order CPOE ≤ 14 hari, order aktif + 7 hari setelah
  selesai/batal). Diperlukan agar TTE/akses pasien dokter lab berjalan tanpa relasi rawat.
- **Worker `lis-hl7`:** cocok HANYA lewat pengenal OBR-3/OBR-2, ORC-3/ORC-2, SPM-2 (`parseOru` kini mengumpulkan
  `identifiers`; `redactHl7`/HMAC tidak diubah). Hasil analyzer = hasil awal bersumber `analyzer` (pencatat =
  petugas penerima spesimen, peran `analyzer`). Spesimen belum diterima → dicoba lagi; barcode tak dikenal, pesan
  diterima sebelum label dibuat (nomor lab harian terpakai ulang / pesan lama), order batal/ditolak, atau order sudah
  divalidasi → `dead` (tampil di layar Lab). Nilai kritis → `critical_result.raised` (event worker; reaksi lewat SSE
  `support_critical`, lihat `WORKER_EMITTED_EVENTS`).
- **Web:** layar Laboratorium mode api (`api-lab.tsx`, `actions.ts`, `components/penunjang/lab-api-workspace.tsx`,
  cetak lewat Route Handler `/penunjang/lab/cetak/[id]` dengan CSP ketat + sandbox).

## Tes

- `apps/api/test/lab.test.ts` (8), `apps/worker/test/lis-hl7.test.ts` (6), `penunjang-contract.test.ts` (+1 SPM/ORC).
- E2E `e2e/lab-api.spec.ts` (desktop): terima order → terima spesimen → mock analyzer ORU → hasil worker → validasi
  teknis → rilis dokter lab.

## Catatan untuk potongan berikutnya

- 4.3: kanal SSE kritis + `raise()` sudah jalan dari manual dan analyzer; endpoint daftar/lapor/metrik + layar
  `lab-critical-*` menyusul. Layar Lab menautkan ke `/penunjang/hasil-kritis`.
- Chip "analyzer terhubung" dan KPI TAT belum ada (data: `registered_devices.last_used_at`, `lab_orders.received_at`/
  `released_at`).
- Pembatalan order oleh dokter setelah diterima lab (`lab.test_voided`) belum disambungkan (perlu kait `order.cancelled`).
