# Serah-terima · PK-5 · Pelangi Klinis fase 2: manajemen, back office, sistem

- Diperbarui: Rab, 7 Okt 2026
- Status: **siap integrasi** (lihat hasil gerbang di bawah)
- Pemilik sesi: Claude Code (agen PK-5)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-aa7b0db7ea0f1cd2b`
- Branch: `worktree-agent-aa7b0db7ea0f1cd2b` (berbasis 51aa3ed, sudah menggabung `origin/master` ddc3397)
- Acuan: ADR-0091, `docs/08-desain-ui.md`, papan C14, C15, C16, C38, C39, C40, C42, C44, F1–F5.
- Batas: hanya gaya/tata letak; perilaku, reducer, Server Action, data demo, dan teks yang dipakai tes tidak diubah (kecuali isi halaman Fondasi UI).
- Sumber daya: DB `simrs_test_codex_c` (127.0.0.1:5433), slot E2E 4530/3530/3531/4630, `E2E_TMP_NAME=simrs-demo-e2e-cxc`.

## Sudah dikerjakan

1. **Kelas bersama** `apps/web/src/components/backoffice/styles.ts` (bukan modul klien, aman untuk komponen server):
   - `CARD`/`CARD_BASE` (putih/90, garis putih, `shadow-card`), `H1` (22 px bold, `tracking-[-0.02em]`), `H2` (15 px);
   - `TH_BASE` (12 px ink-500 tanpa latar), `TABLE_HOVER`/`ROW_HOVER` (`hover:bg-brand-50/60`), `ROW_SELECTED` (gradien brand-100 → putih);
   - `SOFT`, `PROGRESS_*`, `KPI_TINTS` (gradien satu rona 100 → 50; samudra, zamrud, anggrek, toska, bougenvil, batu; tanpa kunyit/koral), `CATEGORY_FILLS` (urutan F5).
2. **Kit** `backoffice/kit.tsx` dan `platform/parts.tsx`:
   - `Panel` memakai kartu Pelangi dan judul 15 px;
   - `PageHead`/`ScreenHeader` memakai h1 baru;
   - `TableWrap` memasang sorotan baris, dan `TH` tanpa latar;
   - `PickRow` terpilih bergradien;
   - `StageTrack`/`FlowSteps` mengikuti papan: aktif = gradien domain, selesai = zamrud;
   - `FlashLine` memakai `bg-alert-*`;
   - `ConfirmDialog` memakai `shadow-float` dan `animate-pal-in`.
     Perubahan ini ikut dirender di Onkologi, PPI, PPRA, Dokumen, RM administratif, dan Rujukan.
3. **KPI**: `components/manajemen/kpi-tile.tsx` (`KpiTile`) menggantikan `KpiCard` di semua baris KPI manajemen, akses, platform, dan operasional.
   - Rona bergiliran per kartu seperti C14, ditambah `shine-once`.
   - Arah/status tetap tertulis dengan warna status.
4. **Dasbor direksi**:
   - kartu Pelangi dengan judul h2;
   - bauran penjamin memakai warna kategori F5 (hex lama dihapus);
   - bilah kapasitas bergradien;
   - "Perlu keputusan direksi" berupa kotak lembut, dengan tombol tandai primer dan tautan sekunder.
5. **Layar lain**:
   - Hampir semua layar: h1 bold dengan tracking rapat, dan kartu `border-line bg-white` diganti kartu Pelangi.
   - Tabel di akses/audit/formulir/perangkat: kepala 12 px ink-500, hover brand, dan baris terpilih bergradien.
   - Command center: alert `bg-alert-*` dan bilah BOR bergradien.
   - Roster, posisi, dan notifikasi belum dibaca memakai gradien pilihan brand.
   - Kepala kartu memakai `bg-card-header`.
   - Popover (menu data, panduan) dan dialog undang memakai `shadow-float` dan `animate-pal-in`.
   - `AppPageView`: status berupa chip 100/800.
   - `interface-card`: rona status 50 → putih.
6. **Hex lama** di lingkup PK-5 sudah habis, kecuali putih:
   - role-matrix → kunyit;
   - sparkbars → koral-500/brand-300;
   - struktur/dokumen → brand-50;
   - scenario-task-card → `bg-alert-*`.
7. **Fondasi UI `/dev/ui`** dibangun ulang menjadi galeri Pelangi Klinis:
   - ramp dari `ramps` dengan kontras WCAG dihitung;
   - warna status;
   - gradien per domain dan kartu `DOMAINS`;
   - warna kategori dan grafik satu seri;
   - skala Poppins dan IBM Plex Mono;
   - material kaca, radius, jarak, dan pola gerak yang bisa diputar ulang;
   - demo komponen interaktif tetap ada.
     Teks "IBM Plex Sans", "teal", dan "#B42318" sudah hilang. `e2e/smoke.spec.ts` kini mengharapkan h1 "Pelangi Klinis" (maksud tes sama).

## Catatan integrasi

- `components/manajemen/phone-frame.tsx` dikembalikan ke versi master agar perubahan PK-1 yang menang. PK-5 tidak mengubah file itu.
- Komponen di `components/{ppi,ppra,dokumen,pengalaman,onkologi,rekam-medis-adm}` tidak disentuh karena tidak tercantum di lingkup PK-5. Komponen itu sudah ikut bergaya Pelangi lewat `Panel`/`TableWrap`/`TH` dari kit, tetapi kelas lokalnya belum ditinjau.
- `KpiCard` dari `@simrs/ui` tidak punya `className`/pilihan rona, jadi PK-5 memakai `KpiTile` lokal. Calon komponen bersama: `KpiCard` dengan prop `ramp` (packages/ui, di luar lingkup).
- Sorotan baris tabel dipasang di pembungkus (`[&_tbody_tr:hover>td]`). Baris berlatar status (koral) ikut diberi rona brand tipis saat kursor di atasnya.

## Gerbang

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (apps/web: 143 berkas, 969 tes): hijau.
- E2E terarah (slot cxc; manajemen, dasbor, fe5-backoffice, fondasi, akses, audit, notifikasi, panduan, smoke), putaran 1: 124 lulus, 3 gagal, 1 dilewati.
  - Dua kegagalan nyata di `/dev/ui` (desktop + tablet): kotak alasan pembatalan diukur saat animasi skala (42 px). Animasi di kotak itu sudah dihapus.
  - Satu kegagalan B03 SDM [demo-desktop]: NIK tidak tampil. Penyebabnya keadaan toko demo bersama yang dipakai paralel dengan proyek tablet, dan tes yang sama lulus di tablet.
  - Ulangan terarah ketiga tes itu: 9/9 lulus.
- Penjalan E2E lokal: `scratchpad/pk5/run-e2e.sh` (memuat `cx3/env.sh`; perlu `pnpm turbo run build --filter='./packages/*'` lebih dulu).
