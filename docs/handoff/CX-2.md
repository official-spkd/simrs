# Serah-terima · CX-2 · Keuangan + BTN interaktif

- Diperbarui: Sel, 6 Okt 2026 · 17.05 WIB
- Status: **siap integrasi**
- Pemilik sesi: Claude Code (agen CX-2, diambil alih dari Codex atas permintaan pemilik produk)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-aac763b7fb119f820`
- Branch dan commit terakhir: `cd/cx-2` (lihat `git log -1 cd/cx-2`; `master` 35c4b80 sudah digabung: CD-2 klinis + CX-1 penunjang/integrasi)
- Tujuan dan kriteria selesai: `docs/13-pembagian-tugas-cd-cx.md` §1 dan §7 CX-2.
- Rencana/otorisasi pengguna: tugas CX-2 dari orkestrator (front end mode presentasi; tanpa API backend, migrasi, dependensi baru).
- Kepemilikan file/modul: `app/(staf)/keuangan/**`, `components/{keuangan,btn}/**` (kecuali `components/btn/ok-*`, milik layar Kamar operasi CX-1), `lib/{keuangan*,btn*}.ts` (kecuali `lib/btn-ok.ts`), fixture keuangan/btn, `lib/server/data/{keuangan*,btn}.ts`, sebelas baris di `lib/demo/store/registry.ts`, bagian "Aliran keuangan dan BTN (CX-2)" + tabel COA di `docs/panduan/19-peta-kode.md`.
- Sumber daya: DB `simrs_test_codex_b` (Postgres 127.0.0.1:5433), slot E2E 4520/3520/3521/4620, `E2E_TMP_NAME=simrs-demo-e2e-cxb`. Skrip env di scratchpad sesi (`cx2/env.sh`, `cx2/run-e2e.sh`), tanpa `.env`, kunci kolom acak lokal.

## Sudah dikerjakan

Sebelas domain toko demo (ADR-0085), satu baris registri masing-masing. Semua pelaku dari sesi (`ev.actor`); stempel `at` = jam demo server (`demoStamp`, hari 5 Okt 2026) agar jurnal selalu di periode demo. Setiap mutasi uang membawa `jurnal` seimbang (`autoJurnalSchema`) yang dibaca domain `akuntansi`.

| Domain           | Berkas                           | Layar                           | Server Action                                   |
| ---------------- | -------------------------------- | ------------------------------- | ----------------------------------------------- |
| `tagihan`        | `lib/keuangan-tagihan-toko.ts`   | Kasir, Charge capture           | `kasir/actions.ts`, `charge-capture/actions.ts` |
| `akuntansi`      | `lib/keuangan-akuntansi-toko.ts` | Akuntansi                       | `akuntansi/actions.ts`                          |
| `klaim`          | `lib/keuangan-klaim-toko.ts`     | Klaim & koding, Workbench koder | `klaim/actions.ts`, `koding/actions.ts`         |
| `piutang`        | `lib/keuangan-piutang-toko.ts`   | Penjaminan & piutang            | `piutang/actions.ts`                            |
| `pembayaran-btn` | `lib/btn-pembayaran-toko.ts`     | Pembayaran digital              | `pembayaran/actions.ts`                         |
| `pembiayaan-btn` | `lib/btn-pembiayaan-toko.ts`     | Pembiayaan BTN                  | `pembiayaan/actions.ts`                         |
| `kas-bank`       | `lib/keuangan-kasbank-toko.ts`   | Kas & bank                      | `kas-bank/actions.ts`                           |
| `hutang`         | `lib/keuangan-hutang-toko.ts`    | Hutang usaha                    | `hutang/actions.ts`                             |
| `jasa-pelayanan` | `lib/keuangan-jaspel-toko.ts`    | Jasa pelayanan                  | `jasa-pelayanan/actions.ts`                     |
| `tarif`          | `lib/keuangan-tarif-toko.ts`     | Tarif & paket                   | `tarif/actions.ts`                              |
| `costing`        | `lib/keuangan-costing-toko.ts`   | Costing & case-mix              | generik (validate murni)                        |

### Alur yang kini bertahan + mengalir

- **Pendaftaran → Charge capture → Kasir:** `kunjungan.terdaftar` membuat tagihan rawat jalan `INV-2610-024xx` (ADM-RJ Rp 30.000, antrean K-021…) + event charge capture. Order CPOE ber-tarif, pemberian obat eMAR, dan CPPT poli final (konsultasi KNS-SP) menambah baris ke tagihan berjalan pasien itu. Event tertahan menahan finalisasi di Kasir (barrier); tindak lanjutnya (minta tarif/kelas/koreksi, admisi menetapkan kelas, coba ulang/reprice, batal manual beralasan) tersimpan dan barisnya masuk tagihan.
- **Kasir lunas → Akuntansi + Klaim + Piutang + BTN + Kas:** `tagihan.bayar`/`tagihan.tutup` → jurnal pelunasan + pengakuan pendapatan (KPI pendapatan, kas & bank, piutang BPJS, umur piutang ikut), berkas klaim BPJS baru (kode dari CPPT/resume/SEP, grouper dari estimasi INA-CBG) atau billing final klaim yang ada, piutang asuransi, transaksi TPDI + baris rekonsiliasi (QRIS/VA), transaksi laci 1 (tunai), pengajuan cicilan dicairkan (cicilan BTN). Tutup/buka shift tersimpan; pembayaran ditolak selama shift tertutup.
- **Klaim final → piutang BPJS → Pembiayaan BTN:** kirim E-Klaim, hasil verifikasi BPJS (mock, tombol "Catat hasil verifikasi BPJS: layak bayar") → `klaim.verifikasi` → batch baru di pool pembiayaan; pengajuan → persetujuan → pencairan (jurnal) → pembayaran BPJS auto-debit (dua jurnal).
- **Pembayaran VA/QRIS → rekonsiliasi 3 arah:** "Jalankan rekonsiliasi" memadankan transaksi toko → jurnal yang menunggu rekonsiliasi di Akuntansi terposting.
- **Koding → Klaim:** validasi/versi koding di Workbench mengubah tag klaim pasien yang sama; `diagnosis.dicatat` RME menambah kode ke berkas koder; `resume.final` menandai resume final di klaim RI.
- **Akuntansi:** pemetaan akun + persetujuan penyetuju kedua, pemadanan mutasi bank, ekspor, tutup periode. Periode tertutup menolak aksi akuntansi dan semua mutasi uang bertanggal periode itu.
- Piutang (batch/kirim/pelunasan/penyesuaian), Kas & bank (tutup/buka laci, padanan, pengecualian, lepas padanan), Hutang (nota kredit, selisih, verifikasi, persetujuan berjenjang, batch, bayar), Jasa pelayanan (tahap + ekspor), Tarif (usulan + keputusan), Costing (telaah komite): semua tersimpan dengan jejak "oleh <pengguna sesi>".

### Gerbang (pengguna sesi / "Bertindak sebagai")

- Pembuat ≠ penyetuju dibandingkan dengan **id pengguna sesi** (bukan nama dari dropdown): pemetaan jurnal ↔ penyetuju kedua, penyesuaian piutang, usulan tarif, faktur (pemverifikasi ≠ tingkat 1 ≠ tingkat 2), rekap jasa pelayanan, refund (pengaju ≠ tingkat 1 ≠ tingkat 2). Data contoh tanpa id dibandingkan dengan nama. Superadmin demo "Bertindak sebagai" Akuntan bisa menjadi penyetuju kedua pemetaan presentasi.akuntan.
- **K-2 (usulan, menunggu konfirmasi pemilik produk):** tutup periode diblokir selama ada jurnal menunggu penyetuju kedua; dialog menampilkan syaratnya.
- Nominal, pembagian penjamin, dan jurnal selalu dihitung server dari data server; tagihan pasien skenario tetap lewat Simulasi.

### Utang bug 6 Okt

- **Kode akun penggajian 2-1410/2-1420 bentrok jaspel:** jasa pelayanan pindah ke 2-1440 "Utang jasa pelayanan" + 2-1430 "Utang PPh 21" (sama dengan Penggajian). Berkas Penggajian (CX-3) tidak diubah. **Untuk CX-3:** bila Penggajian membayar jasa pelayanan, debitkan 2-1440 (`AKUN_LANJUT.utangJaspel`), jangan 2-1410.
- **INV-02203/02209:** label laci Kas & bank kini INV-2610-02206/02211 (02203 = tagihan Kasir Ny. Sri Wahyuni, 02209 = EDC BTN Tn. Gilang); dijaga tes. Pelunasan QRIS Endang (INV-2610-02217) di Kasir melunasi transaksi TPDI yang sama di Pembayaran digital; simulasi webhook untuk invoice antrean Kasir ditolak dengan arahan ke Kasir.

### Kontrak kejadian

- **Diterbitkan:** `tagihan` · `tagihan.bayar`/`tagihan.tutup`, `klaim` · `klaim.verifikasi`, `pembayaran-btn` · `rekonsiliasi`, plus `jurnal` di semua kejadian mutasi uang. Rinci di `docs/panduan/19-peta-kode.md` → "Aliran keuangan dan BTN (CX-2)".
- **Dilanggan:** `pendaftaran` · `kunjungan.terdaftar`; `klinis-order` · `order.ditandatangani`; `rekam-medis` · `emar.diberikan`, `diagnosis.dicatat`; `klinis-poli` · `cppt.ditandatangani` (final) / `cppt.cosign`; `resume-medis` · `resume.final`.
- **Disepakati, belum dipasang:** `logistik` · `penerimaan.dicatat` {grn, po, supplier, title, items, total, poTotal, tanggal, jatuhTempo} → Hutang lewat `applyReceipt` (skema `receiptContractSchema`, sudah cocok dengan `lib/logistik-toko.ts` di `cd/cx-3`). **Permintaan untuk CD-0 saat CX-3 digabung:** tambah di `hutangDomain` (`lib/keuangan-hutang-toko.ts`) `subscriptions: [on(logisticsDomain, (s, ev) => ev.data.type === 'penerimaan.dicatat' ? applyReceipt(s, ev.data) : s)]` (impor `logisticsDomain` dari `lib/logistik-toko.ts`), lalu tes `lib/keuangan-toko.test.ts` (hutang) sudah menguji `applyReceipt`.
- **Tidak dilanggan, beralasan:** domain `penunjang` (CX-1) tidak membawa tarif; charge lab/radiologi/obat sudah tertagih saat order CPOE ditandatangani, jadi melanggan dispensing/validasi akan menagih dua kali. `tempat-tidur` · `bed.status` dan `klinis-igd` · `pasien.meninggal` belum dipakai (tagihan kamar harian dan catatan klaim kematian bisa ditambahkan kemudian).

### Sisa label "tidak disimpan" (beralasan)

- Tidak ada lagi di domain keuangan/BTN. `lib/btn-ok.ts` dan `components/btn/ok-*` milik layar Kamar operasi (CX-1, sudah dimigrasikan di sana).
- Tetap lokal (bukan aksi yang mengubah data): filter/tab/pilihan baris, isian formulir sebelum dikirim, langkah kanal sebelum "Selesaikan" di Kasir (QRIS dibayar, webhook VA, struk EDC, tahap BTN cicilan) yang mensimulasikan pihak luar, pilihan batch pembiayaan sebelum diajukan.

### Permintaan untuk CD-0 / CD-5

1. Gabungkan; pasang langganan Logistik di atas setelah CX-3 masuk.
2. Panduan `docs/panduan/14-fitur-keuangan.md`: kode 2-1410/2-1420 jasa pelayanan → 2-1440/2-1430; alur kini tersimpan dan mengalir; K-2 menunggu konfirmasi.
3. `packages/shared` `JOURNAL_SOURCES` hanya kasir/klaim/tpdi-btn/logistik: jurnal piutang & jasa pelayanan memakai sumber `klaim`, kas & bank `kasir`, hutang `logistik` (referensi menyebut asal). Tambah sumber saat backend U07 dibangun.

## Validasi

- Sel, 6 Okt 2026 · 16.55 (setelah gabung `master` 35c4b80): `pnpm lint` · lolos; `pnpm typecheck` · lolos; `pnpm --filter @simrs/web test` · 130 berkas, 932 tes lolos (baru `lib/keuangan-toko.test.ts`: 20 tes, termasuk tes properti 500 pembagian penjamin acak → jurnal seimbang, skema menolak jurnal tidak seimbang, pembuat ≠ penyetuju per domain, K-2, periode terkunci, alur antardomain).
- E2E slot CX-2 `demo-desktop` + `demo-tablet`: `e2e/demo/{keuangan,btn,fe4-keuangan,superadmin-demo,semua-layar,toko-demo}.spec.ts` · **84 lolos, 0 gagal**. Termasuk dua tes aliran baru (pendaftaran → charge capture → kasir → klaim → pembiayaan + jurnal; kasir QRIS → rekonsiliasi 3 arah → jurnal terposting) dan cek bertahan (muat ulang) di setiap layar.

## Kendala dan langkah berikutnya

- Penyetuju kedua (pemetaan akun, refund tingkat 1/2, faktur tingkat 2) butuh pengguna lain di ruang data yang sama; akun uji E2E punya ruang sendiri, jadi E2E hanya membuktikan pemblokiran (persetujuan penuh diuji unit). Di presentasi: akun presentasi + Superadmin demo "Bertindak sebagai".
- Jam demo server mulai 10.45 saat proses web menyala lalu berjalan; setelah restart jam bisa lebih awal dari kejadian sebelumnya (hanya tampilan).

## Pengambilalihan

Agen CX-2 berhenti setelah laporan akhir; tidak ada server yang dibiarkan berjalan. Penerus: CD-0 (integrasi).
