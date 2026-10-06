# Serah-terima · CX-4

- Status: **audit awal selesai; QA seluruh frontend belum selesai**.
- Pemilik: Codex. Bukti berasal dari `codex/cx-1`, worktree `/Users/godam/.codex/worktrees/cx-1-7568/simrs`, master `1ce8485` + potongan CX-1.
- Scope: konsistensi aliran Penunjang/Integrasi dan akses awal 16 layar; inventaris keseluruhan ada di CX-0. Keuangan/backoffice masih dikerjakan Claude CX-2/CX-3.
- Sumber daya: slot Codex A 4510/3510/3511/4610, `simrs_test_codex_a`, tidak memakai slot Claude atau database pengembangan.

## Bukti yang tersedia

| Pemeriksaan                                        | Hasil                                                                                   | Batas                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| CPOE → Lab → Gateway → validasi dokter → Integrasi | E2E nyata lulus desktop/tablet; identitas pasien/order, hasil dan persistensi diperiksa | Resep tanpa instruksi terstruktur tertahan; diet belum ada publisher                                        |
| Farmasi → Depo                                     | unit + E2E pengurangan sekali, FEFO dan pemeriksa kedua dua akun lulus                  | Logistik/charge masih menunggu pemilik lain                                                                 |
| Bank darah                                         | dua akun, reload, bedside, reaksi, multi-kantong lulus                                  | Tidak menguji perangkat medis nyata                                                                         |
| Seluruh route demo                                 | E2E semua layar desktop/tablet, akses peran, galat JS, overflow lulus                   | Tidak sama dengan klik setiap tombol                                                                        |
| Nama kontrol awal Penunjang/Integrasi              | 12 pengujian per kelompok posisi × desktop/tablet, mencakup 16 layar, lulus             | Fokus pada `main`, kontrol terlihat pada keadaan awal                                                       |
| Target sentuh awal ≥44 px                          | Tombol jam makan Gizi 36→44 px; tautan Lab 15→44 px; pengujian akhir 0 target kecil     | Select/textarea diukur dari kontrol, checkbox/radio dari label klik. Dialog/tab tambahan belum semua diukur |
| Kontras token teks                                 | 9 pasangan warna solid di tabel berikut ≥4,5:1                                          | Perhitungan dari token, bukan seluruh DOM/opacity/background gambar                                         |

## Perhitungan kontras token

Sumber dibaca langsung `packages/ui/src/theme.css`, nilai sRGB → luminansi relatif `(terang + 0,05)/(gelap + 0,05)`. Tidak mengubah token bersama milik integrator.

| Teks / latar         | Rasio   |
| -------------------- | ------- |
| ink-900 / white      | 16,38:1 |
| ink-700 / white      | 8,80:1  |
| ink-500 / white      | 5,49:1  |
| ink-500 / canvas     | 5,11:1  |
| white / brand-600    | 5,47:1  |
| brand-700 / brand-50 | 6,84:1  |
| danger / danger-bg   | 5,75:1  |
| warning / warning-bg | 6,20:1  |
| success / success-bg | 5,85:1  |

## Tindak lanjut setelah branch pemilik lain digabung

1. Selesaikan kontrak resep/diet dan pelanggan hasil/eMAR/charge. Uji pasien/order yang sama tanpa mengambil rincian fixture pasien lain.
2. Bandingkan Kasir → pembayaran → piutang → jurnal → BTN dari invoice dan saldo toko yang sama; gunakan bigint rupiah.
3. Bandingkan Logistik → GRN → Depo → Farmasi dengan batch/depo yang sama. Kandidat perbedaan fixture PCT2512 dan invoice tercatat di CX-0; verifikasi terhadap implementasi akhir Claude sebelum menyebut bug transaksi.
4. Audit agregat contoh Lab/OK/hub: jelaskan cakupan atau hitung dari sumber yang sama. Jangan menyamakan total contoh satu hari dengan jumlah sampel yang tersedia dalam worklist demo.
5. Uji keyboard/fokus/dialog/tooltip/alasan nonaktif dan target sentuh pada tab/keadaan lanjutan. Ukur kontras dari style DOM efektif, termasuk hover/focus dan alpha; jangan menganggap tabel token sebagai sertifikasi seluruh UI.
6. Jalankan perjalanan pasien lengkap dan semua layar setelah CX-2/CX-3 masuk master; integrator memperbarui PROGRESS berdasarkan bukti aktual.

## Log dan pengulangan

- `/private/tmp/simrs-cx1-ready-e2e.{log,json}`: **98 lulus**, 0 gagal, 0 flaky, desktop/tablet.
- `/private/tmp/simrs-cx1-touch-e2e.{log,json}`: **38 lulus**, 0 gagal, 0 flaky; 12 kasus akses, semua lampiran target kecil kosong.
- `e2e/demo/penunjang-akses.spec.ts` menyimpan lampiran JSON ukuran dan gagal bila nama/target awal belum memenuhi gerbang.
- Perintah/slot dan lint/typecheck/912 tes frontend tercatat di CX-1.

Tidak menyatakan seluruh frontend selesai sebelum bagian QA lintas pemilik di atas ditutup. Tidak mengubah implementasi keuangan/backoffice atau status fase milik CD-0.
