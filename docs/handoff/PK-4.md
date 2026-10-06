# Serah-terima · PK-4

- Diperbarui: 7 Okt 2026 (Asia/Jakarta)
- Status: selesai (menunggu integrasi)
- Pemilik sesi: Claude Code
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-adab48bb2f0abc352`
- Branch: `worktree-agent-adab48bb2f0abc352` (turunan 51aa3ed)
- Tujuan: fase 2 Pelangi Klinis (ADR-0091) untuk domain KEUANGAN (rona toska): menyelaraskan tampilan layar keuangan dengan papan C12-Kasir, C13-Klaim, C35-Pembayaran, C36-Pembiayaan, dan C37-Akuntansi.
- Lingkup: hanya gaya dan tata letak. Tidak ada perubahan perilaku, reducer, Server Action, data demo, atau teks.
- Kepemilikan file:
  - `apps/web/src/app/(staf)/keuangan/**`
  - `apps/web/src/components/keuangan/**`
  - `apps/web/src/components/btn/**` kecuali `ok-*` (milik agen penunjang).
  - `components/penggajian/` tidak disentuh karena berada di grup BACK OFFICE (bougenvil), bukan KEUANGAN.
- Sumber daya: DB tes `simrs_test_codex_b` (Postgres 127.0.0.1:5433), port E2E 4520/3520/3521/4620, `E2E_TMP_NAME=simrs-demo-e2e-cxb`.

## Sudah dikerjakan

- **Kartu.**
  - `rounded-card border border-line bg-white` diganti menjadi `rounded-card border border-white/95 bg-white/90 shadow-card` (setara `Card` @simrs/ui).
  - Elemen semantik (`nav`/`section`/`li`) dipertahankan, jadi `Card` tidak dipakai langsung.
- **Judul.**
  - h1 memakai `text-h1 font-bold tracking-[-0.02em]` (22 px).
  - Remah/sub-judul tetap `text-caption text-ink-500`.
- **KPI.** Semua `KpiCard` di lingkup memakai `tinted`: gradien 100 → 50 satu rona, domain untuk netral dan rona status untuk nada lain.
- **Daftar kiri + detail kanan.**
  - Baris terpilih memakai `bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]`. Hover memakai `hover:bg-brand-50/60`.
  - Pola lama `shadow-[inset_3px_0_0_…]` dihapus dari transaksi, refund, dan cicilan.
  - Pola yang sama dipasang di antrean tagihan, daftar klaim, tabel tarif, penagihan piutang, berkas koding, kontrak pembagian, dan paket tarif.
- **Chip filter buatan sendiri** (daftar klaim, kasus costing) disamakan dengan `FilterChip`: terpilih `bg-nav-active` putih, idle putih/90.
- **Tombol utama buatan sendiri** ("Selesaikan dan cetak kuitansi", aksi cicilan) memakai `bg-btn-primary` + `shadow-button`. Keadaan nonaktif mengikuti gaya `Button`.
- **Kotak status.**
  - Ditukar ke gradien satu rona: `bg-alert-success|critical|warning|info`, dengan border status yang sama.
  - Gradien rgba kunyit lama pada tutup periode dan akuntansi juga diganti.
  - `money-flow.tsx` sengaja tetap datar (tanpa gradien) sesuai aturan alur dana.
- **Dialog.** Scrim `rgba(15,23,42,0.28)` + blur 3 px + `shadow-float`, seperti palet di papan.
- **Pil mode TPDI.** SANDBOX `kunyit-100/800`, PRODUKSI `brand-100/800`.
- **Kepala tabel.** Isian `bg-subtle` dihapus agar menyatu dengan kartu kaca, seperti `.tbl` di papan.
- **Hex lama dipetakan ke token.**

  | Hex lama | Token |
  |---|---|
  | `#F4C98E` | `kunyit-200` |
  | `#6E8BC7`, `#6FB5AC` | `brand-300` |
  | `#C7A23A` | `brand-200` |
  | `#C9564B` | `koral-500` |
  | `#F4F6F8` | `batu-100` |
  | `#C9DDF7` | `samudra-100` |
  | `#9DB7E8` | `samudra-300` |
  | `#F4F8FE` | `samudra-50` |
  | `#E8EEF9` | `samudra-100` |
  | `#F7FCFB` | `brand-50/60` |
  | `#9FB0BF` | `batu-400` |

  Sisa hex hanya `#FFFFFF` di SVG QR (`payment-methods.tsx`), dan putih memang boleh.
- **ADR-0005.** Teks alur dana dan "TPDI tidak menampung dana" tidak berubah.

## Validasi

- `turbo run typecheck lint --filter=@simrs/web`: lolos.
- `apps/web pnpm test`: 969 lolos.
- E2E terarah (`keuangan.spec`, `fe4-keuangan.spec`, `btn.spec`, slot `simrs_test_codex_b`, port 4520/3520/3521/4620): 42 lolos (1,5 mnt).
- Catatan lingkungan:
  - Worktree tidak punya `.env`, sehingga API E2E gagal start. Variabel dimuat baca-saja dari `.env` checkout utama ke environment proses tes. `.env` tidak disalin atau diubah.
  - `@simrs/pdf` perlu dibangun sekali (`turbo run build --filter=./packages/*`).

## Kendala dan langkah berikutnya

Butuh komponen bersama (tidak diubah karena `packages/ui` di luar lingkup):
- Utilitas `bg-row-selected` (gradien brand-100 → putih 40 %) di `theme.css`, supaya string panjang ini tidak berulang di setiap domain.
- Komponen `ProgressBar` bergradien domain (`.prog` di papan C36). Layar pembiayaan belum punya bilah pemakaian plafon. Menambahkannya berarti menambah isi, sehingga ditunda.
- Footer aksi kaca (`.foot` di papan) belum ada sebagai pola bersama. Tombol aksi tetap di posisi lamanya.

## Pengambilalihan

Agen PK-4 berhenti setelah laporan akhir. Tidak ada proses yang ditinggalkan berjalan.
