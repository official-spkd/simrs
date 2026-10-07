# Serah-terima · fase 4 potongan 4.0a + 4.0b (kontrak bersama + skema penunjang)

- Diperbarui: 7 Okt 2026 malam WIB
- Status: selesai, menunggu tinjauan DOC + penggabungan orkestrator
- Pemilik sesi: Claude Code (agen A5)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a0d98d16252d27a40`
- Branch: `worktree-agent-a0d98d16252d27a40` (di atas master `837af390`)
- Rencana: `docs/rencana/fase-4-penunjang.md` §4.0a, §4.0b
- Sumber daya: DB `simrs_test_fe5`; migrasi `20261008100000_support_services` (rentang slot 20261008100000–199999)

## 4.0a · `packages/shared`

- Izin + matriks bawaan fase 4 (`authz.ts`); peran sistem baru `ahli_gizi` (kode PPA CPPT fase 3, bukan
  `nutrisionis`) + persona presentasi, posisi demo, staf seed, peran PIN, `demoRoles` layar Gizi.
- `lab.analyzer.ingest` khusus perangkat; jenis perangkat `lab_analyzer` + `DEVICE_GRANTS` + CHECK
  `registered_devices.kind` + layar perangkat web DITUNDA ke 4.1a (ingest).
- Penomoran (`numbering.ts`), pengaturan (`settings.ts`), `SUPPORT_ERRORS` (`errors.ts`), kontrak inbound
  (`inbound.ts`), 25 event (`domain-events.ts`, muatan datar tanpa kode baku).
- `schemas/penunjang-api.ts` (kontrak API), `schemas/kamar-operasi.ts` (OK dipindah dari `btn.ts`, re-export).
  Kontrak demo `schemas/penunjang.ts` tidak diubah (4.0c memindah fixture ke UUID).
- `rules/{lab,pharmacy,radiology,surgery,blood}.ts`; web lib (`penunjang*.ts`, `btn-ok.ts`) me-re-export.
- `integrations/lis/hl7.ts` (akar) + `integrations/lis/signature.ts` (entri `node`).

## 4.0b · `packages/db`

- Skema Prisma: `support-master.prisma`, `lab.prisma`, `radiology.prisma`, `pharmacy.prisma`, `surgery.prisma`,
  `nutrition-blood.prisma` (59 tabel). Back-relation di model lama ditambah otomatis (`prisma format`).
- Migrasi `20261008100000_support_services`: DDL Prisma + manual (CHECK nilai, entri klinis berversi
  `lab_results`/`imaging_reports`/`pa_reports`/`operative_reports` + view `_current`, append-only, waktu server,
  ledger stok → saldo `app_stock_apply_movement` (SECURITY DEFINER), nilai kritis (raise/guard/report/close), urutan
  validasi lab, daftar tilik + peristiwa + hitung OK, EXCLUDE kamar, darah, RLS + hak akses).
- Seed `seed-support.ts` (`seedSupportMasters`, `seedSupportStock`), dipanggil `prisma/seed.ts`.
- Tes `test/support-services.test.ts` (11) + `schema-guard` diperbarui.

## Validasi

Lihat laporan akhir A5 (build/lint/typecheck/test/migrate diff).

## Kendala dan langkah berikutnya

- `@simrs/db` build d.ts kini butuh heap besar (`--max-old-space-size=8192`, ±6,5 menit, RSS ±5,7 GB; sebelum fase
  4 ±72 detik). Usulan: emit deklarasi dengan `tsc` alih-alih bundel `rollup-plugin-dts`.
- S10 memakai `diagnostic_reports` fase 3; kolom tambahan (jenis S10, isian P07) bila perlu ditambah 4.8.
- Item penerimaan/penyesuaian stok = baris `stock_movements` (rujukan `ref_type`/`ref_id`), bukan tabel item terpisah.
- Panel lab (mis. "Darah lengkap") dipetakan lewat `panel_code` (DL, KIMIA, ELEKTROLIT, LIPID); orderable panel
  belum punya kolom panel di tabel fase 3.
