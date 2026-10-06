# Serah-terima · CD-1 · Inti toko demo bersama

- Diperbarui: Sel, 6 Okt 2026 · 15.10 WIB
- Status: **siap integrasi**
- Pemilik sesi: Claude Code (agen CD-1)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a69e7630c7b96dc37`
- Branch dan commit terakhir: `cd/cd-1` (lihat `git log -1 cd/cd-1`; basis `master` 52c6d54, master belum bergerak saat E2E akhir)
- Tujuan dan kriteria selesai: `docs/13-pembagian-tugas-cd-cx.md` §6 CD-1. Toko keadaan demo per RS (log kejadian + reducer murni per domain), API tipe-aman, langganan lintas domain, "Mulai ulang data demo", contoh migrasi pelaporan nilai kritis Lab → Pusat hasil kritis, dokumentasi pola.
- Rencana/otorisasi pengguna: tugas CD-1 dari CD-0 (front end mode presentasi saja; tanpa API backend, migrasi, dependensi baru).
- Kepemilikan file/modul: `apps/web/src/lib/demo/store/**` (baru), `apps/web/src/lib/server/demo/state*.ts` (baru), `apps/web/src/components/demo-*.tsx`, ADR-0085, baris ADR README, bagian pola di `docs/panduan/19-peta-kode.md`; contoh migrasi: `components/penunjang/{lab-critical-banner,lab-workspace,kritis-center}.tsx`, `lib/penunjang-kritis.ts`, `app/(staf)/penunjang/{lab,hasil-kritis}/{page,actions}.ts(x)`, dua baris di `lib/server/data/penunjang.ts` dan `penunjang-lanjut.ts` (menerapkan keadaan toko), plus ekspektasi E2E di `e2e/demo/penunjang.spec.ts` dan `fe3-penunjang-integrasi.spec.ts` (label "tidak disimpan" hilang).
- Sumber daya: DB `simrs_test_cd_a` (Postgres 127.0.0.1:5433), slot E2E 4020/3020/3021/4120, `E2E_TMP_NAME=simrs-demo-e2e-cda`. Skrip env di scratchpad sesi (`cd1/env.sh`, `cd1/run-e2e.sh`), tanpa `.env`.

## Sudah dikerjakan

Desain (rinci di ADR-0085 dan `docs/panduan/19-peta-kode.md` bagian "Toko keadaan demo bersama"):

- **Murni** `lib/demo/store/`: `define.ts` (`defineDomain`, `on`, `project`, `affectedBy`), `log.ts` (format berkas, `appendEvent` dengan batas 5.000 kejadian / 16 KB per kejadian / 4 MB per berkas, `resetLog`, `parseLog` tahan rusak), `registry.ts` (`DEMO_DOMAINS`, `StateOf`, `EventOf`), `access.ts` (`canResetDemoData`), `client.ts` (`useStoreAction`, `useDemoDispatch`).
- **Server** `lib/server/demo/`: `state-store.ts` (`DemoStateStore`: kunci per ruang di globalThis, tulis atomik tmp→rename, `commit` = skema → rev basi → `validate` → reducer → batas, `reset`), `state.ts` (`readDomain`, `commitEvent`, `demoSpace`, `demoActor`, `revalidateDomain`, `resetDemoData`; semua `assertDemo()`), `state-actions.ts` (`dispatchDemoEventAction` generik hanya untuk domain `generic: true`, `resetDemoDataAction` berkonfirmasi, `demoDataSummaryAction`).
- **Ruang data**: akun presentasi (`presentasi.*`, termasuk Superadmin demo) berbagi satu ruang per RS; akun lain (akun uji/pengembang) ruang sendiri `<RS>-<id>` (sama dengan aturan toko skenario, ADR-0023 keputusan 9). Ini yang membuat E2E paralel aman.
- **Pelaku** selalu dari sesi (`ev.actor`: id, nama, posisi yang dibawakan, penugasan asli bila "Bertindak sebagai").
- **UI**: lencana "Mode presentasi · data fiktif" kini tombol menu (`components/demo-data-menu.tsx`, dipakai `demo-badge.tsx`) berisi ringkasan aksi tersimpan, mulai ulang terakhir, dan "Mulai ulang data demo" berkonfirmasi untuk admin SIM RS/manajemen/Superadmin demo. Tidak menyentuh `screens.ts`/`nav.ts`/sidebar/layout.
- **Contoh migrasi** domain `hasil-kritis` (`lib/penunjang-kritis.ts`, `criticalDomain`): "Catat pelaporan" di Lab dan Pusat hasil kritis menulis `laporan.dicatat`; pengambil data menerapkan toko ke fixture; banner Lab "Nilai kritis dilaporkan" tetap tampil setelah muat ulang; Pusat hasil kritis menampilkan "oleh <pengguna sesi>"; pasien skenario ditolak (tetap lewat tugas Simulasi). Label "(simulasi, tidak disimpan)" alur ini hilang. Validasi teknis/klinis dan sampel ulang Lab masih simulasi (milik CX-1).
- Dokumentasi: ADR-0085, baris README ADR, bagian pola + diagram `docs/panduan/gambar/diagram-toko-demo.svg` di 19-peta-kode, catatan di "Keadaan antarlayar yang tidak tersimpan".

## Validasi

- `pnpm --filter @simrs/web lint` · lolos.
- `pnpm --filter @simrs/web typecheck` · lolos.
- `pnpm --filter @simrs/web test` · lolos (122 berkas, 866 tes). Tes baru: `lib/demo/store/{define,log,registry}.test.ts`, `lib/server/demo/{state-store,state-actions}.test.ts` (atomik, rev basi, paralel diserialkan, batas ukuran/penuh, mulai ulang, berkas rusak, kunci berkas aman, mode api menolak, pelaku "Bertindak sebagai", hak mulai ulang, ruang presentasi vs akun lain, isolasi RS, aksi generik menolak domain non-generik).
- E2E slot CD-1, proyek `demo-desktop` + `demo-tablet`: `e2e/demo/toko-demo.spec.ts` (baru: aksi → muat ulang → layar kedua → ganti posisi → mulai ulang → kembali awal; mode api 404 + toko tak tersentuh), `penunjang.spec.ts`, `fe3-penunjang-integrasi.spec.ts` · 48 lolos. Gerbang akhir setelah `git merge master` (sudah terbaru): `toko-demo` + `penunjang` + `fe3-penunjang-integrasi` + `semua-layar` di `demo-desktop` + `demo-tablet` · **84 lolos, 0 gagal** (termasuk 4 tes tangkap layar sementara untuk QA visual menu data demo dan banner Lab, tidak di-commit).

## Kendala dan langkah berikutnya

- Permintaan registri untuk CD-0: **tidak ada yang wajib**. Opsional: tampilkan "Mulai ulang data demo" juga di halaman Simulasi/panduan presenter; layout staf sudah memuat lencana di semua layar.
- Untuk agen gelombang 1: ikuti "Menambah domain/kejadian/aliran" di `19-peta-kode.md`. Tambah satu baris per domain di `lib/demo/store/registry.ts`.
- Utang: kunci toko hanya per proses web (cukup untuk `next start` tunggal). Log diputar ulang per render (dibatasi 5.000 kejadian).

## Pengambilalihan

Agen CD-1 berhenti setelah laporan akhir; tidak ada server yang dibiarkan berjalan.
