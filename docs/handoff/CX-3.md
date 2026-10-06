# Serah-terima · CX-3 · Back office + manajemen + aplikasi interaktif

- Diperbarui: Sel, 6 Okt 2026
- Status: **berjalan** (gerbang akhir sedang dijalankan)
- Pemilik sesi: Claude Code (mengambil alih tugas Codex atas permintaan pemilik produk, 6 Okt 2026)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a67bd17b71094c816`
- Branch dan commit terakhir: `cd/cx-3` (lihat `git log -1 cd/cx-3`; `master` CD-2 + CX-1 sudah digabung)
- Tujuan dan kriteria selesai: `docs/13-pembagian-tugas-cd-cx.md` §1 dan §7 CX-3.
- Rencana/otorisasi pengguna: tugas CX-3 dari orkestrator (front end mode presentasi saja; tanpa API backend, migrasi, dependensi baru; `docs/PROGRESS.md` tidak diubah).
- Kepemilikan file/modul: §2 baris "Back office + manajemen + aplikasi". Di luar milik sendiri hanya: satu baris per domain di `lib/demo/store/registry.ts`, satu langganan `on(logisticsDomain, …)` di `lib/keuangan-hutang-toko.ts` (izin orkestrator), satu baris PO-2610-031 di fixture `logistik-terima.ts` (fixture milik domain), bagian "Aliran back office, manajemen, dan aplikasi (CX-3)" + dua kalimat di `docs/panduan/19-peta-kode.md`.
- Sumber daya: DB `simrs_test_codex_c` (Postgres 127.0.0.1:5433), slot E2E 4530/3530/3531/4630, `E2E_TMP_NAME=simrs-demo-e2e-cxc`. Skrip env di scratchpad sesi (`cx3/env.sh`, `cx3/run-e2e.sh`), tanpa `.env`, kunci kolom acak lokal.

## Sudah dikerjakan

Delapan belas domain toko demo (ADR-0085), satu berkas `lib/<domain>-toko.ts` masing-masing; bagian bersama `lib/backoffice-toko.ts` (jam demo, pelaku tersimpan, `sameUserBlock`, `roleBlock`), alat tes `lib/backoffice-toko.testing.ts`, dan hook klien `components/backoffice/use-toko.ts` (`useTokoAction`).

| Domain            | Layar                             | Server Action                                                                                      |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `logistik`        | Logistik (B01)                    | sendiri (`manajemen/logistik/actions.ts`: nomor PO/GRN, harga, total, jatuh tempo dihitung server) |
| `penggajian`      | Penggajian (B05)                  | generik                                                                                            |
| `rekam-medis-adm` | RM administratif (B09)            | generik                                                                                            |
| `regulasi`        | Dokumen regulasi (B12)            | generik                                                                                            |
| `dataset-riset`   | Dataset riset (I11)               | generik                                                                                            |
| `ppra`            | PPRA (B08)                        | generik                                                                                            |
| `kredensial`      | Kredensial (B04)                  | generik                                                                                            |
| `sdm`             | SDM (B03)                         | generik                                                                                            |
| `ppi`             | PPI (B07)                         | generik                                                                                            |
| `aset`            | Aset (B02)                        | generik                                                                                            |
| `pengaduan`       | Pengaduan/pengalaman pasien (B13) | generik                                                                                            |
| `pendidikan`      | Pendidikan klinik (B10)           | generik                                                                                            |
| `command-center`  | Command center (I09)              | generik (keputusan alert)                                                                          |
| `mutu`            | Mutu (B06)                        | generik (hitung ulang) + langganan klinis                                                          |
| `dasbor`          | Dasbor direksi (I09)              | generik (tanda tindak lanjut)                                                                      |
| `aplikasi-pasien` | Pratinjau aplikasi pasien (I07)   | sendiri (`pratinjau/aplikasi-pasien/actions.ts`: slot booking dari Jadwal dokter)                  |
| `aplikasi-dokter` | Pratinjau aplikasi dokter (I08)   | generik (co-sign) + read-back ke `hasil-kritis` (`pratinjau/aplikasi-dokter/actions.ts`)           |

### Alur yang kini bertahan + mengalir

- **Logistik:** ROP → draf → usulan PO (tersimpan, item terkunci) → setujui (Manajemen, pengusul ≠ penyetuju) → terbit PO → dikirim pemasok → terima barang (batch, kedaluwarsa ≥ 6 bulan, rantai dingin) → stok naik, item keluar dari daftar ROP, nilai persediaan naik, **kejadian `penerimaan.dicatat` untuk Hutang**. Kedaluwarsa FEFO pindah/retur tersimpan. Dasbor ikut: butir stok enoksaparin berubah teks sesuai tahap PO dan hilang setelah barang diterima.
- **Penggajian:** impor jaspel → hitung (penyusun = pengguna sesi) → setujui (pengguna lain, Akuntan/Manajemen) → posting jurnal berpasangan → kirim slip. Kembali ke draf mempertahankan PPh 21.
- **RM administratif:** ROI verifikasi (sesi) → setuju (Petugas privasi/Manajemen, ≠ pemverifikasi dan ≠ penerima) → penuhi/tolak beralasan; pinjam/kembali/pengingat berkas; pemusnahan berurutan (usul komite RM/Manajemen, setuju + berita acara direktur ≠ pengusul). Masuk dari klinis: `kunjungan.ditutup` dan `pasien.meninggal` (SKK diarsip permanen).
- **Dokumen:** telaah → setuju (Auditor mutu/Manajemen, ≠ penyusun) → terbit (versi lama usang) → tinjau ulang: **versi baru disusun pengguna yang memulai** (utang bug 6 Okt); pengingat baca dan bukti akreditasi tersimpan.
- **Dataset riset:** etik → de-identifikasi (k-anonimitas dihitung ulang di toko) → setuju rilis (Petugas privasi, ≠ penyusun de-identifikasi dan ≠ pemohon) → ekstrak → unduhan; jejak akses atas nama sesi.
- **PPRA:** putusan setuju/tolak hanya tim PPRA (Apoteker/Dokter, bukan residen) dan **bukan penulis resep**; kedaluwarsa 24 jam ditolak; audit Gyssens dan modul aktif/tidak per RS tersimpan.
- **Kredensial ← SDM:** verifikasi berkas → telaah (Dokter, bukan praktisinya) → komite (Dokter, **≠ penelaah**) → RKK + SPK (Manajemen). Melanggan `sdm/sip.diperbarui`: SIP baru di SDM membuka verifikasi yang tertahan dan uji CPOE tidak lagi `LICENSE_EXPIRED`.
- **SDM:** SIP baru, pengingat, buka NIK beralasan (jejak), pegawai keluar, jadwal dinas draf → terbit → revisi. Gerbang terbit kini memblokir **> 40 jam/minggu** dan **jeda malam → siang** (utang bug 6 Okt; dulu hanya warna dan hanya malam → pagi).
- **PPI → Mutu:** konfirmasi/tolak suspek HAI, sensus harian, observasi 5 momen, audit bundle, penempatan isolasi; observasi tangan mengubah INM-01 di Mutu (352/400 → 352/401).
- **Aset:** kalibrasi laik/tidak laik (tiket otomatis bernomor), tiket berurutan; konfirmasi unit oleh pengguna lain dari penyelesai perbaikan.
- **Pengaduan → Mutu:** grading → tindak lanjut → jawab → tutup (catatan atas nama sesi); jawaban dalam SLA masuk INM-12 (87% → 88%); skor survei rendah → pengaduan bernomor.
- **Pendidikan:** verifikasi/kembalikan logbook dan naik tingkat hanya posisi Dokter.
- **Command center:** bed per ruang dari papan Tempat tidur (`tempat-tidur`), IGD dari papan IGD (`klinis-igd`: triase, admisi → "menunggu bed"), antrean loket + poli dari papan antrean (`antrean`/`pendaftaran`); diperbarui otomatis (`DemoPolling`); "Maju 15 menit" (simulasi lokal) dihapus. Keputusan alert tersimpan, terkunci ke isi alert (permintaan bed IGD baru → alert terbuka lagi), hanya Manajemen.
- **Mutu/Dasbor dari toko:** lima indikator mesin indikator dari PPI, pengaduan, dan resume final klinis (`mutu` melanggan `resume-medis/resume.final`); kematian IGD (`klinis-igd/pasien.meninggal`) untuk telaah mutu; "Hitung ulang" tercatat. Dasbor: kapasitas rawat inap kelas/ICU/isolasi + BOR hari ini dari papan bed, pasien IGD menunggu dari papan IGD, kebersihan tangan dari PPI, stok enoksaparin + tahap PO dari Logistik; tanda tindak lanjut direksi tersimpan (dulu `sessionStorage`).
- **Aplikasi pasien:** posisi antrean poli **hidup** dari papan antrean (notifikasi tersisa ≤ 3 / giliran), booking jadwal dari Jadwal dokter (kuota JKN tersisa, bukan cuti; kode `BK-2610-041`…; batal), gula darah dan akses keluarga tersimpan; melanggan `jadwal/cuti.dicatat` (booking ditandai, notifikasi).
- **Aplikasi dokter:** read-back nilai kritis pasien non-skenario dicatat ke **`hasil-kritis/laporan.dicatat`** atas nama dokter sesi → Lab dan Pusat hasil kritis menutupnya. Co-sign CPPT residen tersimpan (Dokter). Tn. Hartono (pasien skenario) tetap lewat tugas Simulasi; read-back lokal "tidak disimpan" dihapus (tombol nonaktif beralasan).

### Kontrak kejadian

Rinci di `docs/panduan/19-peta-kode.md` → "Aliran back office, manajemen, dan aplikasi (CX-3)".

- **Diterbitkan:** `logistik/penerimaan.dicatat` {`grn`, `po`, `supplier`, `title`, `items[]`, `total`, `poTotal` (rupiah string digit), `coldChainOk`, `tanggal`, `jatuhTempo`, `jam`} → **Hutang usaha (CX-2)**; `penggajian/run.diposting` {`number`, `journal[]`} → Akuntansi (CX-2, opsional); `aplikasi-pasien/booking.dibuat` {`code`, `patientId`, `slotId`, `doctorId`, `poliCode`, `date`, `start`, …} → Pendaftaran/anjungan + kuota (CD-3); `aplikasi-dokter/cosign.ditandatangani` → CPPT/Kelengkapan (CD-2); `pendidikan/tingkat.dinaikkan` → aturan co-sign (CD-2); `sdm/sip.diperbarui`; keadaan `ppra.moduleOn` dan `kredensial.granted` → CPOE `orderHold`/`orderGuard` (CD-2).
- **Dilanggan:** `jadwal/cuti.dicatat`, `sdm/sip.diperbarui`, `resume-medis/resume.final`, `klinis-igd/pasien.meninggal`, `rekam-medis/kunjungan.ditutup`.
- **Ditulis ke domain lain:** `hasil-kritis/laporan.dicatat` dari aplikasi dokter (Server Action sendiri, gerbang: posisi Dokter/residen, nilai read-back sama dengan laporan, bukan pasien skenario, belum dilaporkan).
- **Dibaca (tanpa menulis):** papan Tempat tidur, papan IGD, papan antrean, Jadwal dokter, Pusat hasil kritis (`lib/server/data/manajemen-live.ts`, `getPatientAppHome`, `getDoctorAppInbox`).

### Permintaan untuk pemilik domain lain

1. **CX-1:** tambah nilai `via: 'aplikasi'` pada `criticalEventSchema` (`lib/penunjang-kritis.ts`); kini read-back aplikasi dokter memakai `via: 'pusat'` dengan `recipientRole` "Dokter · read-back aplikasi dokter". Stok gudang Logistik belum disatukan dengan saldo batch Depo.
2. **CX-2:** langganan Hutang `on(logisticsDomain, …)` → `applyReceipt` **sudah dipasang** di `lib/keuangan-hutang-toko.ts` (satu baris, diizinkan orkestrator sesuai permintaan handoff CX-2); E2E B01 membuktikan GRN-2610-0145 → faktur draf `INV/2610-0145`. Tagihan di aplikasi pasien masih fixture; jasa pelayanan Penggajian masih `SERVICE_FEES` fixture (belum dari layar Jasa pelayanan).
3. **CD-2:** langgani `aplikasi-dokter/cosign.ditandatangani`, `pendidikan/tingkat.dinaikkan`, dan baca `kredensial.granted`/`ppra.moduleOn` di CPOE.
4. **CD-3:** langgani `aplikasi-pasien/booking.dibuat` untuk kuota slot dan check-in anjungan dengan kode `BK-…`.
5. **CD-0:** tidak ada perubahan registri layar/menu yang wajib.

### Sisa keadaan klien / label (beralasan)

- Tidak ada lagi label "(simulasi, tidak disimpan)" di layar CX-3.
- Hanya keadaan tampilan yang tetap di klien: pilihan tab/saringan, isian formulir sebelum dikirim, NIK utuh yang dibuka (hanya untuk penampil itu; jejak pembukaannya tersimpan), uji penegakan CPOE di Kredensial (kueri), "Keluar" pratinjau ponsel aplikasi dokter, dan stok opname (informasi).
- "Tarif iuran simulasi" di Penggajian = persentase iuran contoh (bukan label penyimpanan).
- Kapasitas IGD bed dan kamar operasi di Dasbor, pendapatan, ALOS, dan bauran penjamin tetap profil fixture (belum ada sumber toko).

## Validasi

(diperbarui di akhir)

## Kendala dan langkah berikutnya

- Pemisahan tugas positif (dua pengguna berbeda) diuji di tes unit domain; E2E memakai akun uji yang ruang datanya terpisah per akun, jadi E2E membuktikan gerbang "pengguna sama ditolak" + alur lintas posisi untuk satu pengguna. Perjalanan dua akun presentasi menjadi bagian CD-4.

## Pengambilalihan

Agen CX-3 berhenti setelah laporan akhir; tidak ada server yang dibiarkan berjalan. Penerus: CD-0 (integrasi).
