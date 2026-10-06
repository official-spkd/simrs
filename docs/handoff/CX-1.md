# Serah-terima · CX-1

- Status: **berjalan — gerbang integrasi belum lengkap**.
- Pemilik: Codex; backend ditunda, otorisasi pengguna 6 Okt 2026.
- Worktree: `/Users/godam/.codex/worktrees/cx-1-7568/simrs`, branch `codex/cx-1`, basis master `c6f3d04`; master `34f38d1` sudah digabung tanpa membuang domain CD-3.
- Slot: DB `simrs_test_codex_a`, PG 5433; API/web/demo/mock 4510/3510/3511/4610; `simrs-demo-e2e-cxa`.
- Integrator: Claude CD-0; jangan merge/push dari tugas ini.

## Implementasi

Domain `penunjang` dan `integrasi` memakai toko CD-1: reducer murni, skema ketat, rev, pelaku sesi, baca server dan `useStoreAction`.
Lab/Radiologi/Farmasi/Depo/Bank darah/Gizi/Mikro-PA/Diagnostik/OK-Anestesi serta hub/SATUSEHAT/BPJS/Kemenkes/Gateway/API publik sudah tersambung.

Aliran yang tersedia:
- ORU Gateway → hasil Lab draf; kode/satuan mengikuti order, flag dihitung katalog, control ID idempoten, hasil final terkunci. PID disamarkan sebelum log kejadian ditulis.
- hasil final Lab/Rad/Mikro/PA/Diagnostik/OK dan dispensing → resource antrean Integrasi; Encounter/IHS mendahului anak.
- serah Farmasi → saldo Depo FEFO untuk produk terpetakan; stok produk belum terpetakan mengikuti saldo resep tersimpan, tanpa KFA/harga baru yang dikarang.
- `state.dispensations` berisi rxId/patientId/at/by/items untuk pelanggan eMAR dan charge.
- Gram kultur darah positif dan diagnostik bertanda kritis → `state.criticals`, dibaca Pusat hasil kritis; laporan read-back tetap domain CD-1.
- dua pemeriksaan darah harus dicatat dua id akun; high-alert pemeriksa kedua dari sesi; boolean klien mengenai validasi/gizi/WHO/induksi/perbaikan integrasi tidak membuka gerbang.
- multi-kantong menyimpan riwayat transfusi, kantong berikutnya bisa dipasang setelah sebelumnya selesai; jumlah issue dibatasi permintaan.

## Penyesuaian integrasi untuk ditinjau CD-0

1. `screens.ts`: disertakan tambahan posisi `dokter` pada `demoRoles` layar `lab`, `rad`, `farmasi`. Validasi klinis/ekspertise/persetujuan CDS sekarang hanya dokter. Posisi petugas teknis tetap dipertahankan. Jangan menurunkan gerbang ke akun teknisi.
2. `state-actions.test.ts:108`: disertakan penyesuaian karena ekspektasi hanya dua route tidak berlaku ketika domain lain melanggan hasil-kritis. Ubah menjadi perbandingan terhadap daftar route dari `affectedBy('hasil-kritis', allDomains())` + `screenById`, lalu pastikan Lab dan Pusat hasil kritis ada. Test tetap membuktikan semua pelanggan direvalidasi, tanpa mengunci jumlah domain. Penyesuaian tes core ini disertakan agar gerbang membuktikan pelanggan baru secara lengkap; perlu ditinjau CD-0.
3. Penyiapan E2E multi-peran/doctor gate membutuhkan perubahan registri #1. Jalankan ulang E2E setelah integrasi.

## Kontrak dengan CD-2/CX-2

- Sumber: `{ name: 'penunjang', eventSchema: supportEventSchema }`; gunakan `on()`.
- Reducer `reduceSupport` bisa dipakai sebagai proyeksi penunjang pada pelanggan yang perlu nilai lengkap. Langganan critical + gateway perlu diterapkan juga atau baca domain penunjang langsung.
- `released[]`: metadata hasil baru `{ id, patientId, source, by, at }`; `dispensations[]` obat tersedia untuk eMAR/charge.
- CD-2 masih membangun kontrak CPOE/consent/diet. Pelanggan kejadian klinis belum ditambahkan sampai bentuk final tersedia. Consent di pra-anestesi saat ini adalah pernyataan dokter demo; sambungkan ke consent CD-2 sebelum perjalanan elektif lintas layar dinyatakan selesai.
- CX-2 akan menambah pelanggan charge pada tahap berikut. Jangan mengklaim uang atau pemberian eMAR sudah berubah sebelum pelanggan terpasang.

## Validasi sementara

- Root lint lolos (12 tugas).
- 13 regresi baru reducer/aksi lolos: persistensi, stale rev, reset, mode API, role, pemalsuan boolean, cek ganda, multi-kantong, Gateway → Lab, Lab → Integrasi, pengurangan stok.
- Web suite: **878 lolos, 1 gagal** dari 879; satu kegagalan ekspektasi route core #2 di atas.
- Typecheck dan E2E sedang diselesaikan; belum status siap integrasi.

## Berikutnya

E2E domain + semua layar, perbaiki ekspektasi lama yang bergantung pada nama petugas rekaan atau label tidak disimpan, kontrak klinis, ADR-0090, gerbang akhir dan commit. Tugas CX-2/CX-3/CX-4 tetap berikutnya, belum selesai.
