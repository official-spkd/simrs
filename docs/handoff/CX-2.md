# Serah-terima · CX-2 · Keuangan + BTN interaktif

- Diperbarui: Sel, 6 Okt 2026 · 16.40 WIB
- Status: **berjalan**
- Pemilik sesi: Claude Code (agen CX-2, diambil alih dari Codex atas permintaan pemilik produk)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-aac763b7fb119f820`
- Branch dan commit terakhir: `cd/cx-2` (lihat `git log -1 cd/cx-2`; basis `master` e997e9c, `master` 1ce8485 (CD-2) sudah digabung)
- Tujuan dan kriteria selesai: `docs/13-pembagian-tugas-cd-cx.md` §1 dan §7 CX-2.
- Rencana/otorisasi pengguna: tugas CX-2 dari orkestrator (front end mode presentasi; tanpa API backend, migrasi, dependensi baru).
- Kepemilikan file/modul: `app/(staf)/keuangan/**`, `components/{keuangan,btn}/**` (kecuali `components/btn/ok-*` milik layar Kamar operasi CX-1), `lib/{keuangan*,btn*}.ts` (kecuali `lib/btn-ok.ts`), fixture keuangan/btn, `lib/server/data/keuangan*.ts`, satu baris per domain di `lib/demo/store/registry.ts`.
- Sumber daya: DB `simrs_test_codex_b` (Postgres 127.0.0.1:5433), slot E2E 4520/3520/3521/4620, `E2E_TMP_NAME=simrs-demo-e2e-cxb`. Skrip env di scratchpad sesi (`cx2/env.sh`, `cx2/run-e2e.sh`), tanpa `.env`, kunci kolom acak lokal.

## Sudah dikerjakan

### Potongan 1 · `tagihan` (Kasir + Charge capture) dan `akuntansi`

- `lib/keuangan-tagihan-toko.ts`: domain `tagihan`. Langganan `pendaftaran` · `kunjungan.terdaftar` → tagihan rawat jalan baru `INV-2610-024xx` (ADM-RJ Rp 30.000) + event charge capture. Item manual, final (ditahan bila ada event charge capture tertahan untuk RM pasien), bayar (6 metode), tutup kunjungan, tutup/buka shift, tindak lanjut event tertahan (minta tarif/kelas/koreksi, admisi menetapkan kelas, coba ulang/reprice, batal baris manual beralasan).
- Langganan klinis (CD-2): `klinis-order` · `order.ditandatangani` (baris ber-tarif → tagihan berjalan pasien; tarif null → event tertahan), `rekam-medis` · `emar.diberikan` (jasa pemberian obat per dosis ke tagihan rawat inap berjalan), `klinis-poli` · `cppt.ditandatangani` final / `cppt.cosign` (konsultasi KNS-SP dari master tarif ke kunjungan rawat jalan hari ini). Tagihan yang sudah final → event tercatat sebagai tagihan susulan.
- `lib/keuangan-akuntansi-toko.ts`: domain `akuntansi`. Jurnal otomatis dari kejadian yang membawa `jurnal` (langganan generik `journalSubscription`), pemetaan akun + persetujuan penyetuju kedua (pembuat ≠ penyetuju dari id pengguna sesi), pemadanan mutasi bank, ekspor, tutup periode. **K-2 (usulan, menunggu konfirmasi pemilik produk):** tutup periode diblokir selama ada jurnal menunggu penyetuju kedua. Periode tertutup menolak aksi akuntansi dan mutasi uang bertanggal periode itu (`periodLock`).
- `lib/keuangan-jurnal.ts`: `autoJurnalSchema` (menolak jurnal tidak seimbang), `patientPaymentJournal`, `recognitionAutoJournal`; akun jasa pelayanan dipindah dari 2-1410/2-1420 (bentrok Penggajian) ke 2-1440 Utang jasa pelayanan + 2-1430 Utang PPh 21 (sama dengan Penggajian).
- `lib/server/data/keuangan-toko.ts`: `keuanganSession`, `demoStamp` (jam demo server, hari 5 Okt 2026), `periodLock`.

## Validasi

- `tsc`, `eslint src`, `vitest` lolos (tes baru `lib/keuangan-toko.test.ts`, termasuk tes properti 500 pembagian penjamin acak → jurnal seimbang).

## Kendala dan langkah berikutnya

- Berikutnya: klaim + koding, piutang, pembayaran/pembiayaan BTN, kas & bank, hutang (kontrak Logistik), jasa pelayanan, tarif, costing; E2E.

## Pengambilalihan

Agen CX-2 masih berjalan.
