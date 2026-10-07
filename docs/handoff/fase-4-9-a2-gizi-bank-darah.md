# Serah-terima · fase 4 · 4.9 Gizi + Bank darah (A2)

- Diperbarui: 7 Oktober 2026, malam (WIB)
- Status: selesai, siap digabung orkestrator
- Pemilik sesi: Claude Code (agen A2)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a45e0d816db28866a`
- Branch: `worktree-agent-a45e0d816db28866a` (master terbaru sudah digabung)
- Tujuan: API + layar Gizi (S07) dan Bank darah (S08) mode api. Gerbang wajib: gelang ↔ kantong dan petugas kedua.
- Sumber daya: DB `simrs_test_fe2`, port 4030/3030/3031/4130, migrasi blok 20261008500000–20261008599999.

## Sudah dikerjakan

- Migrasi `20261008500000_blood_bank_safety` (ADR-0105). Tabel baru:
  - `blood_issue_checks`: cek ganda pertama;
  - `transfusions`: gelang ↔ kantong + verifikasi petugas kedua;
  - `transfusion_vitals`.

  Perubahan tabel lama:
  - `blood_issues.issue_check_id` + CHECK NOT VALID + trigger petugas kedua;
  - `blood_components.abo_rule` + gerbang 4.0b diganti aturan per komponen;
  - kunci golongan di `blood_requests`;
  - indeks `diet_orders_one_active`.

- API:
  - `nutrition`: `/nutrition/diet-types`, `/nutrition/diet-orders` (+ `/:id/end`), `/nutrition/meal-list`,
    `/nutrition/meal-services`, `/encounters/:id/diet-orders`;
  - `blood-bank`: `/blood/board`, `/blood/requests` (+ `/:id`, `/:id/receive`, `/:id/group`), `/blood/crossmatches`,
    `/blood/units`, `/blood/issue-checks`, `/blood/issues`, `/blood/transfusions` (+ `/:id/verify|vitals|finish|stop`),
    `/blood/reactions`.
- Tampilan layanan/ruangan: `apps/api/src/infra/clinical/support-access.ts`.
- Shared:
  - kontrak `schemas/gizi-darah.ts`;
  - `rules/blood.ts` (aturan per komponen, butir cek ganda, deteksi reaksi);
  - galat S08 baru di `SUPPORT_ERRORS`;
  - izin `blood_bank.request/transfuse`, gizi perawat/bidan lingkup unit, dokter gizi + darah.
- Web:
  - `api-gizi.tsx`, `api-bank-darah.tsx`;
  - `components/penunjang/{gizi,bank-darah}-api.tsx`;
  - `lib/server/data/penunjang/penunjang-api{,-actions}.ts`;
  - cetak `/cetak/gizi`;
  - E2E `gizi-bank-darah-api.spec.ts`; `penunjang-gerbang.spec.ts` (CONNECTED + depo dari master).
- Docs: ADR-0105, pembaruan ADR-0037, panduan 13 dan 20.

## Validasi

- build, lint, typecheck, dan test penuh hijau: api 604, web 1014, db 239, shared 295, worker 132.
- `prisma migrate diff --from-config-datasource --to-schema` kosong di DB slot.
- E2E: `gizi-bank-darah-api`, `penunjang-gerbang`, `smoke`, `konsultasi-api`, `persetujuan`, `rekam-api`, dan
  `demo/semua-layar` → 73 lolos, 1 dilewati (bawaan).

## Kendala dan langkah berikutnya

- RS yang sudah berjalan perlu `pnpm db:sync-permissions --reconcile` untuk izin baru (`blood_bank.request/transfuse`,
  gizi perawat/bidan unit, dokter gizi + darah).
- Belum dibuat:
  - notifikasi reaksi transfusi ke DPJP/bank darah;
  - pemusnahan kantong kedaluwarsa;
  - pembatalan permintaan darah;
  - puasa (NPO), skrining MST, dan verifikasi order diet (ada di demo, di luar §4.9).
- Petugas kedua di perangkat yang sama perlu keluar-masuk akun (step-up belum ada, sama dengan ADR-0096).
