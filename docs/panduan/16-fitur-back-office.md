# Fitur back office

Halaman ini menjelaskan dua layar back office: Logistik (rantai pasok obat dan BHP) dan Mutu & keselamatan pasien. Keduanya dipakai manajemen untuk memutuskan, bukan untuk pelayanan langsung ke pasien. Isinya: apa yang tampil, aturan yang menjaganya, dan di mana kodenya.

> Status 6 Okt 2026: kedua layar hanya berjalan di **mode presentasi** (data dummy fiktif, ADR-0023). Backend fase 8 (back office) belum dibangun. Aksi divalidasi Server Action lalu dibuang dengan pesan "(simulasi, tidak disimpan)". Di luar mode presentasi rute ini menjawab 404.

## Ringkasan layar

| Layar              | Rute                  | Peran (mode presentasi) | Komponen | Status        |
| ------------------ | --------------------- | ----------------------- | -------- | ------------- |
| Logistik           | `/manajemen/logistik` | Manajemen, Apoteker     | B01      | demo · fase 8 |
| Mutu & keselamatan | `/manajemen/mutu`     | Auditor mutu, Manajemen | B06      | demo · fase 8 |

Posisi lain melihat "Layar ini untuk posisi lain" dengan tautan **Ganti posisi**. Sumber kebenaran: registri `SCREENS` di `apps/web/src/lib/screens.ts`. Data kedua layar lewat satu pintu, `apps/web/src/lib/server/data/manajemen.ts`, dan divalidasi skema `packages/shared/src/schemas/manajemen.ts`.

## Logistik

![Layar Logistik: indikator persediaan, tabel item di bawah titik pesan ulang dengan saringan kelas dan kotak centang, panel kedaluwarsa dan pengadaan berjalan di kanan](./gambar/logistik.png)

| Hal      | Isi                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rute     | `/manajemen/logistik`                                                                                                                                                                |
| Pemakai  | manajemen, apoteker                                                                                                                                                                  |
| Komponen | B01 supply chain generik                                                                                                                                                             |
| Status   | demo (mode presentasi); backend fase 8 belum dibangun                                                                                                                                |
| Mockup   | `design/mockups/Logistik.dc.html`                                                                                                                                                    |
| Kode web | `apps/web/src/app/(staf)/manajemen/logistik/` · `apps/web/src/components/manajemen/{reorder-row,po-draft-panel,expiry-panel,procurement-list}.tsx` · `apps/web/src/lib/manajemen.ts` |
| Kode API | belum ada (rencana `modules/supply-chain`; `docs/rencana/fase-8-back-office.md`)                                                                                                     |

**Tujuan.** Manajemen dan apoteker melihat item yang harus dipesan ulang, membuat usulan PO, memantau obat yang mendekati kedaluwarsa, dan mengikuti pengadaan yang sedang berjalan.

**Alur.**

1. Buka **Manajemen › Logistik**. Judul "Rantai pasok · stok dan pengadaan". Wilayah "Indikator logistik": Nilai persediaan (Rp 4,82 M), Perputaran, Stockout bulan ini (dengan jumlah item VEN-V), Akurasi opname (sasaran ≥ 98%), dan Lead time rata-rata.
2. Tabel "Item di bawah titik pesan ulang" memuat Item, Kelas, Stok, ROP, Cukup, dan Usulan. Rumusnya tertulis: ROP = pemakaian harian rata-rata 90 hari × lead time + stok pengaman.
3. Saring kelas dengan **Semua kelas**, **ABC-A**, atau **VEN-V**.
4. Kolom Cukup memberi label teks, mis. "Kritis · 4 hari" untuk stok di bawah 7 hari. Bar "Usulan PO" di atas tabel merangkum item kritis.
5. Centang item (mis. "Masukkan Enoksaparin 60 mg/0,6 mL ke usulan PO"), lalu tekan **Buat usulan PO (N)**. Bar menampilkan estimasi total.
6. Panel "Draf usulan PO-2610-032" muncul dengan baris (kuantitas × harga, kanal, pemasok), total, dan chip "Mendesak · ada stok kritis" atau "Rutin". Tekan **Ajukan ke direktur** atau **Batal**.
7. Setelah diajukan, baris item berlabel "Masuk PO-2610-032" dan PO baru masuk daftar "Pengadaan berjalan" dengan lima tahap: usulan, persetujuan, PO / e-katalog, kirim, terima dan cek mutu.
8. Posisi Manajemen melihat tombol **Setujui** pada PO di tahap usulan. Posisi lain melihat "Menunggu persetujuan posisi Manajemen".
9. Panel "Kedaluwarsa ≤ 90 hari" memberi chip "ED N hari" dan dua tindakan: **Pindahkan ke** depo pemakai terbesar (nama depo tertulis di tombol) atau **Retur ke distributor**.
10. **Stok opname** menampilkan info opname terakhir dan jadwal berikutnya.

Contoh data dummy: Enoksaparin masuk usulan `PO-2610-032` bernilai Rp 41.400.000. Kanal pengadaan yang dipakai: e-katalog, PO distributor, kontrak KSO, dan PO darurat.

**Gerbang keselamatan dan aturan bisnis.**

- **Buat usulan PO** nonaktif dengan alasan tertulis sampai ada item dicentang ("Centang item dulu untuk membuat usulan."). Selama draf masih terbuka, draf baru ditahan ("Selesaikan draf yang terbuka dulu.").
- Total draf = jumlah subtotal (kuantitas × harga satuan), dihitung dengan bigint.
- Server tidak memercayai total dari klien. `submitPoAction` membaca harga katalog, menolak item tak dikenal atau ganda, lalu menghitung ulang total.
- Draf bertanda mendesak bila ada item PO darurat atau stok di bawah 7 hari.
- Hari cukup dibulatkan ke bawah agar tidak optimistis. ROP dibulatkan ke atas.
- Dispensing memakai FEFO: batch dengan kedaluwarsa terdekat keluar lebih dulu.
- Kode KFA item hanya dari daftar seed (dijaga tes).
- Persetujuan PO hanya untuk posisi Manajemen (`canApprove`).

**Rencana backend.** Izin terencana `inventory.write`. Fase 8 membangun `modules/supply-chain`: master item generik, kebijakan stok ABC-VEN, ROP → usulan PO, persetujuan, PO, penerimaan barang (stok + hutang + jurnal), retur, kedaluwarsa/FEFO, dan stok opname. Layar dipindah ke mode api; jalur demo tetap diuji.

## Mutu & keselamatan

![Layar Mutu dan keselamatan pasien: ringkasan indikator memenuhi sasaran, daftar indikator mutu dengan tren enam bulan, laporan insiden keselamatan pasien dengan nomor RM saja, dan matriks risiko](./gambar/mutu.png)

| Hal      | Isi                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/manajemen/mutu`                                                                                                                                                   |
| Pemakai  | auditor_mutu, manajemen                                                                                                                                             |
| Komponen | B06 mutu dan keselamatan pasien                                                                                                                                     |
| Status   | demo (mode presentasi); backend fase 8 belum dibangun                                                                                                               |
| Mockup   | tidak ada (gaya mengikuti Dasbor eksekutif)                                                                                                                         |
| Kode web | `apps/web/src/app/(staf)/manajemen/mutu/` · `apps/web/src/components/manajemen/{incident-list,risk-register,trend-sparkline}.tsx` · `apps/web/src/lib/manajemen.ts` |
| Kode API | belum ada (rencana modul `quality`; `docs/rencana/fase-8-back-office.md`)                                                                                           |

**Tujuan.** Auditor mutu dan manajemen memantau Indikator Nasional Mutu (INM) dan indikator mutu prioritas RS (IMP-RS), laporan insiden keselamatan pasien (IKP) beserta investigasinya, dan register risiko.

**Alur.**

1. Buka **Manajemen › Mutu & keselamatan**. Judul "Mutu dan keselamatan pasien · Oktober 2026".
2. Wilayah "Ringkasan mutu": Indikator memenuhi sasaran (N/total), IKP bulan ini (KTD vs tanpa cedera/nyaris), Investigasi terbuka (yang lewat batas waktu ditandai), dan Risiko tinggi/ekstrem.
3. Daftar "Indikator mutu" menampilkan capaian, sasaran, tren enam bulan (garis putus-putus = sasaran), perubahan vs bulan lalu, dan status teks, mis. "Di bawah sasaran".
4. Saring indikator dengan **Semua**, **INM**, **IMP-RS**, atau **Di bawah sasaran**. Contoh: Kepatuhan identifikasi pasien 97%, di bawah sasaran 100%.
5. "Laporan insiden keselamatan pasien" memuat nomor (mis. `IKP-2610-014`), grading, jenis insiden, ringkasan, waktu lapor, unit, nomor RM, dan status investigasi dengan batas waktunya.
6. "Register risiko" berisi matriks 5×5 kemungkinan × dampak (sel berisi id risiko) dan daftar risiko urut skor, lengkap dengan tingkat, mitigasi, pemilik, dan tren.

Layar ini hanya membaca. Tidak ada Server Action; satu-satunya interaksi adalah saringan indikator.

**Gerbang keselamatan dan aturan bisnis.**

- Identitas pasien di laporan IKP hanya nomor RM, tanpa nama. Tes memastikan nama pasien tidak muncul.
- Grading ditulis sebagai teks (Biru · rendah, Hijau · sedang, Kuning · tinggi, Merah · ekstrem), tidak hanya warna. Biru/hijau → investigasi sederhana; kuning/merah → RCA 45 hari.
- Jenis insiden memakai istilah baku: KTD, KNC, KTC, KPC, Sentinel.
- Skor risiko = kemungkinan × dampak. Pita tingkat: 1–3 rendah, 4–6 sedang, 8–12 tinggi, 15–25 ekstrem.
- Capaian dihitung "memenuhi sasaran" secara inklusif (≥ untuk sasaran minimum, ≤ untuk sasaran maksimum).
- Enam indikator pertama sama persis dengan indikator mutu di [Dasbor eksekutif](./17-fitur-kanal-dasbor.md#dasbor-eksekutif); fixture Mutu mengambilnya langsung dari fixture Dasbor, jadi angkanya tidak bisa berbeda.
- Tabel matriks punya judul baris dan kolom untuk pembaca layar.

**Rencana backend.** Izin terencana `quality.read`. Fase 8 membangun mesin indikator (13 INM + IMP-RS dari data transaksi, hasil append-only berversi), IKP yang beku setelah dikirim (koreksi lewat addendum) beserta investigasi dan tindakan, serta register risiko append-only. Peran Auditor mutu mendapat izin `quality.*`, `incident.read/investigate`, dan `risk.*`.

## Tes yang menjaga layar ini

| Tes                                              | Yang dijaga                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/demo/manajemen.spec.ts` (logistik) | Buat usulan PO nonaktif sampai item dipilih, draf PO Rp 41.400.000, ajukan, PO masuk pengadaan berjalan                                                                           |
| `apps/web/e2e/demo/manajemen.spec.ts` (mutu)     | Indikator dan saringan "Di bawah sasaran", IKP hanya nomor RM, matriks risiko tampil                                                                                              |
| `apps/web/src/lib/manajemen.test.ts`             | Fixture lolos kontrak; kode KFA/ICD-9-CM/LOINC hanya dari seed; ROP dan hari cukup; total draf PO bigint; enam indikator = Dasbor; pita risiko dan matriks 25 sel; IKP tanpa nama |
| `apps/web/src/lib/manajemen-aksi.test.ts`        | Ajukan PO hanya untuk posisi layar Logistik; tanpa sesi lengkap diarahkan ke halaman masuk                                                                                        |

## Lihat juga

- [Fitur kanal dan dasbor](./17-fitur-kanal-dasbor.md)
- [Fitur penunjang](./13-fitur-penunjang.md), untuk farmasi dan stok depo
- [Fitur keuangan](./14-fitur-keuangan.md), untuk jurnal logistik di Akuntansi
- [Cara kode bekerja: mode presentasi dan data dummy](./02-cara-kerja-kode.md#mode-presentasi-dan-data-dummy-adr-0023)
- [Simulasi dan operasional](./18-simulasi-dan-operasional.md)
- [Peta kode](./19-peta-kode.md)
- Dokumen desain: `docs/02-katalog-komponen.md` (B01, B06), `docs/rencana/fase-8-back-office.md`
