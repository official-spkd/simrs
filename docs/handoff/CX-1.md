# Serah-terima · CX-1

- Status: **siap integrasi — potongan Penunjang/Integrasi; batas aliran lintas pemilik di bawah tetap terbuka**.
- Commit fitur tervalidasi: **`98aaa51`** (`feat(web): persist support and integration demo workflows`); gunakan HEAD branch `codex/cx-1` agar checkpoint ini ikut terambil.
- Pemilik: Codex; otorisasi pengguna 6 Okt 2026, backend ditunda.
- Worktree: `/Users/godam/.codex/worktrees/cx-1-7568/simrs`, branch `codex/cx-1`; master terbaru `1ce8485` sudah digabung, termasuk domain CD-3 dan CD-2.
- Slot: DB `simrs_test_codex_a`, PG 5433; API/web/demo/mock 4510/3510/3511/4610; `E2E_TMP_NAME=simrs-demo-e2e-cxa`.
- Integrator: Claude CD-0. Tugas ini tidak merge/push ke master dan tidak mengubah PROGRESS.
- Batas status: siapnya potongan ini tidak berarti seluruh frontend atau backend SIM RS selesai. CX-2/CX-3 sedang dikerjakan Claude; kontrak tambahan di bawah masih dibutuhkan.

## Perubahan yang bisa ditinjau

Domain `penunjang` dan `integrasi` memakai toko CD-1, reducer murni, skema ketat, revisi tampilan, pelaku sesi, baca server, dan `useStoreAction`. Aksi normal bertahan setelah reload/pergantian posisi. Reset ruang RS mengembalikan semua domain. Mode API tetap ditolak; tidak ada backend, migrasi, dependensi, atau kode klinis baru.

Layar: Lab, Radiologi, Farmasi, Depo, Bank darah, Gizi, Mikrobiologi/PA, Diagnostik, OK/Anestesi, Pusat hasil kritis; hub Integrasi, SATUSEHAT, BPJS, Kemenkes, Gateway perangkat, API publik.

Aliran yang telah dipasang:

- CPOE CD-2 ber-TTE → worklist Lab/Radiologi/EKG/Echo. Sumber skema langsung `orderDomain`, pelanggan aktif. Order tak terpetakan/resep kurang lengkap tampil tertahan dengan alasan dan pelaku, bukan hilang.
- Lab baru harus diterima dengan spesimen dan dua identitas sebelum Gateway boleh memasukkan hasil. Pembacaan server menambahkan order baru, tidak hanya memperbarui baris fixture lama.
- ORU Gateway → draf Lab; accession/LOINC/satuan cocok dengan order, flag dihitung katalog, control ID idempoten. Hasil tervalidasi atau kritis yang sudah dilaporkan terkunci. PID disamarkan sebelum log ditulis; ACK berasal dari hasil reducer tersimpan.
- Validasi teknis Lab → dokter → hasil final → resource Integrasi. Hasil final Rad/Mikro/PA/Diagnostik/OK dan dispensing juga menghasilkan metadata antrean. IHS dan Encounter mendahului anak. Pengiriman konektor demo tetap lokal.
- Farmasi → saldo Depo FEFO satu kali. Pemetaan produk memakai KFA atau nama lengkap termasuk kekuatan/sediaan. Produk tanpa pemetaan memakai saldo terbatas per nama dan depo; tidak menyamakan dosis berbeda atau mengarang KFA/harga.
- Gram kultur darah positif/hasil diagnostik kritis → Pusat hasil kritis. Read-back CD-1 kembali ke Penunjang dan proyeksi Integrasi.
- Consent final/ditolak CD-2 → OK/Anestesi. Pasien dan prosedur harus sama; penolakan menahan sign-in/induksi/insisi. Alias spesifik kateter vena sentral untuk akses kemoterapi disamakan dengan prosedur OK.
- Bank darah: dua akun untuk issue/bedside manual, TTV 15 menit, reaksi, multi-kantong dengan riwayat tetap tersimpan. ID sesi menentukan pemisahan tugas, termasuk ketika nama petugas sama. Checklist issue tersimpan tetap berlaku setelah reload yang mengosongkan draft klien.
- High-alert: pembuat dan pemeriksa kedua memakai ID akun berbeda. Gizi/WHO/anestesi/CDS/perbaikan konektor tidak menerima boolean klien sebagai bukti kelulusan.
- Checklist memakai pembaruan optimistis dengan rollback ke keadaan server; tombol final menunggu simpan. Pasien yang mengikuti mesin skenario tetap melalui tugas Simulasi.

## Perubahan inti minimal untuk ditinjau CD-0

1. `demo/store/registry.ts`: tambah `penunjang` dan `integrasi`; semua domain CD-2/CD-3 tetap ada.
2. `screens.ts`: tambah `dokter` pada `demoRoles` Lab/Radiologi/Farmasi. Petugas teknis tetap posisi pertama. Validasi klinis, ekspertise ber-TTE dan persetujuan CDS memerlukan dokter.
3. `server/demo/state-actions.test.ts`: harapan revalidasi mengikuti `affectedBy('hasil-kritis', allDomains())` dan rute registri, dengan Lab/Pusat hasil kritis tetap wajib. Pelanggan baru menambah rute; tes tetap memeriksa semua pelanggan.
4. `manajemen-aksi.test.ts`: mock commit/rev diperbarui karena aksi hub sudah memakai toko, tanpa menyunting implementasi manajemen milik Claude.

## Kontrak lanjut CD-2 / Claude CX-2 / CX-3

Sumber keluar adalah `supportDomain` (`name: 'penunjang'`, `supportEventSchema`). Pelanggan memakai `on(supportDomain, ...)` dan `reduceSupport` bila perlu proyeksi nilai lengkap. Sertakan pelanggan CPOE/consent, critical, Gateway untuk menjaga cache; atau baca domain Penunjang langsung dari server.

- `released[]` berisi `{ id, patientId, source, by, at }` hasil final baru. Ambil nilai lengkap dari samples/exams/cultures/pathology/diagnostics/operations di proyeksi server; metadata bukan teks hasil.
- `dispensations[]` berisi rxId/patientId/at/by/items untuk pelanggan eMAR dan charge. eMAR/charge/hasil klinis **belum diubah oleh potongan ini**; tidak ada klaim tagihan atau pemberian sudah terjadi.
- CPOE `order.ditandatangani.lines[]` belum menyediakan dosis/rute/frekuensi/jumlah/satuan sebagai field terstruktur. Resep masuk daftar kelengkapan Farmasi. CD-2 harus menambah instruksi resep sebelum alur CPOE → dispensing lengkap dapat dinyatakan lulus.
- Belum ada publisher diet DPJP; order diet baru lintas klinis → Gizi menunggu kontrak CD-2.
- Logistik/Keuangan masih perlu memakai saldo batch/invoice yang sama dengan Depo/Kasir. Audit sumber dan pembagian tindak lanjut tercatat di CX-0.

## Bukti validasi

- `pnpm lint`: **12 tugas lolos**.
- `pnpm typecheck`: **12 tugas lolos**.
- `pnpm --filter @simrs/web test`: **912 tes / 129 berkas lolos**. Termasuk regresi persistensi, revisi basi, reset, peran/mode API, pemalsuan input, dua akun, multi-kantong, saldo FEFO, ORU, CPOE/consent, hasil final → Integrasi.
- E2E akhir desktop + tablet: **98 tes lolos**, workers=1. Termasuk reload/lintas posisi/dua akun, CPOE nyata → Gateway/Lab → Integrasi, reset, pemeriksaan kontrol bernama, semua layar serta regresi BTN.
- Setelah perbaikan akhir ukuran target Gizi/tautan Lab: **38 tes E2E terkait lolos** desktop/tablet, termasuk 12 pengujian akses yang memeriksa nama dan target awal 44 px pada 16 layar. Tidak ada target awal yang gagal ukuran.
- Pengujian ukuran mengukur elemen field sebenarnya, label klik hanya untuk checkbox/radio. Bukti ini terbatas kontrol awal yang terlihat; dialog/tab lain, fokus keyboard seluruh perjalanan dan kontras DOM penuh tetap QA lanjutan. Lihat CX-4.

Log lokal: `/private/tmp/simrs-cx1-ready-{lint,types,unit,e2e}.log`; laporan E2E `/private/tmp/simrs-cx1-ready-e2e.json`. Pengujian target akhir: `/private/tmp/simrs-cx1-touch-e2e.{log,json}`.

Perintah E2E akhir (URL DB berasal dari `.env` worktree, tidak dicatat kredensialnya):

```bash
PATH=/opt/homebrew/bin:$PATH E2E_API_PORT=4510 E2E_WEB_PORT=3510 E2E_DEMO_PORT=3511 E2E_MOCK_PORT=4610 E2E_TMP_NAME=simrs-demo-e2e-cxa pnpm --filter @simrs/web test:e2e e2e/demo/penunjang.spec.ts e2e/demo/fe3-penunjang-integrasi.spec.ts e2e/demo/penunjang-persistensi.spec.ts e2e/demo/penunjang-klinis.spec.ts e2e/demo/penunjang-akses.spec.ts e2e/demo/btn.spec.ts e2e/demo/semua-layar.spec.ts --project=demo-desktop --project=demo-tablet --workers=1
```

## Langkah integrator

Tinjau perubahan inti di atas dan ADR-0090; gabungkan branch hanya setelah gerbang akhir hijau. Jalankan kembali gerbang penuh pada slot CD-0 setelah CX-2/CX-3 masuk. Selesaikan kontrak resep/diet/eMAR/charge/hasil klinis sebelum menandai seluruh perjalanan pasien selesai. Audit inventaris 80 layar ada di CX-0; QA aksesibilitas/konsistensi ada di CX-4.
