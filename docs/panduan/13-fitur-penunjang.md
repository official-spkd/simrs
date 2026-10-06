# Fitur penunjang

Halaman ini menjelaskan empat layar penunjang (lapisan S): laboratorium dengan nilai kritis, radiologi, farmasi, dan
kamar operasi. Layar-layar ini menerima order dari CPOE dan mengembalikan hasil, obat, atau laporan operasi ke rekam
medis pasien. Setiap layar punya gerbang keselamatan yang ditegakkan ulang di Server Action, bukan hanya di tombol.

> Status 6 Okt 2026: keempat layar berjalan di mode presentasi dengan data fiktif (`pnpm dev:demo`). Fase 4 belum
> dimulai, jadi belum ada modul API lab, radiologi, farmasi, atau kamar operasi. Yang sudah ada di API hanya modul
> `results` (fase 3 potongan 3.2a: observasi dan laporan hasil berkode, izin `result`) dan CPOE + CDS (3.4) sebagai
> sumber order. Di mode api keempat rute ini 404.

Posisi layar penunjang dalam perjalanan pasien rawat jalan (CPOE → lab dan farmasi → kasir):

![Diagram alur rawat jalan: anjungan, SEP, antrean, poli, CPOE, lab dan farmasi, kasir, klaim](./gambar/diagram-alur-rawat-jalan.svg)

Order yang masuk ke layar-layar ini ditulis di [CPOE](./12-fitur-klinis.md#order-dan-resep-cpoe). Cara membawakan
skenario Simulasi ada di [Simulasi dan operasional](./18-simulasi-dan-operasional.md).

## Ringkasan layar

| Layar         | Rute                       | Peran (mode presentasi) | Komponen | Status                                   |
| ------------- | -------------------------- | ----------------------- | -------- | ---------------------------------------- |
| Laboratorium  | `/penunjang/lab`           | analis lab              | S01, S09 | 🟨 demo; API lab belum (fase 4)          |
| Radiologi     | `/penunjang/radiologi`     | radiografer             | S03      | 🟨 demo tanpa mockup; API belum (fase 4) |
| Farmasi       | `/penunjang/farmasi`       | apoteker                | S04, S05 | 🟨 demo; API belum (fase 4)              |
| Kamar operasi | `/penunjang/kamar-operasi` | dokter, perawat         | S06      | 🟨 demo; API belum (fase 4)              |

Legenda: 🟨 berjalan di mode presentasi, belum tersambung ke API · ✅ tersambung · ⬜ belum dibangun.

Berbeda dengan layar klinis, layar penunjang belum hibrida. Halamannya memakai `requireDemoScreen` dan registri
`SCREENS` belum memberi `permission`, hanya `plannedPermission`. Server Action-nya mencari rekaman di server (klien
hanya mengirim id), memeriksa gerbang, lalu membalas "… (simulasi, tidak disimpan)". Atribut keselamatan seperti
nilai kritis, kontras, modalitas, peringatan CDS, dan obat high alert dibaca dari data server, bukan dari kiriman
klien.

## Laboratorium

![Layar Laboratorium: status koneksi analyzer di kepala layar, indikator laboratorium, worklist sampel di kiri, dan tabel hasil berkode LOINC dengan bendera di kanan](./gambar/lab.png)

| Hal      | Isi                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rute     | `/penunjang/lab` (`?pilih=<sampleId>` = sampel yang dibuka)                                                                                                              |
| Pemakai  | analis lab                                                                                                                                                               |
| Komponen | S01 laboratorium patologi klinik, S09 hasil kritis                                                                                                                       |
| Status   | demo (mode presentasi); API lab belum (fase 4 potongan 4.2–4.3); modul `results` fase 3 sudah menerima observasi berkode                                                 |
| Mockup   | `design/mockups/Lab.dc.html`                                                                                                                                             |
| Kode web | `apps/web/src/app/(staf)/penunjang/lab/` · `apps/web/src/components/penunjang/lab-*.tsx` · `apps/web/src/lib/penunjang.ts` · `apps/web/src/lib/server/data/penunjang.ts` |
| Kode API | belum ada modul lab · `apps/api/src/modules/results/` (observasi dan laporan hasil, fase 3)                                                                              |

**Tujuan.** Analis memantau worklist sampel, membaca hasil analyzer berkode LOINC dengan bendera dan delta check,
melaporkan nilai kritis dengan read-back dalam batas waktu, lalu memvalidasi hasil secara teknis dan klinis.

**Alur.**

1. Buka **Laboratorium**. Kepala layar menunjukkan analyzer "terhubung" atau "terputus". Region "Indikator
   laboratorium" memuat Sampel hari ini, TAT rata-rata (rutin), TAT cito, dan Nilai kritis terbuka.
2. "Worklist" diurutkan menurut prioritas, lalu waktu: nilai kritis terbuka, cito, rutin, lalu selesai atau
   inkubasi. Setiap sampel punya nomor (mis. L2610050142) dan status bertulisan.
3. Klik sampel, mis. Ny. Endang Wijaya. "Hasil pemeriksaan" menampilkan nilai, rentang rujukan, kode LOINC (mis.
   LOINC 2160-0 untuk kreatinin), tren, dan bendera **H**, **L**, **KRITIS**, atau **Δ** (delta check).
4. Banner "Nilai kritis terbuka · <pasien>" muncul dengan timer berjalan. Tekan **Catat pelaporan**, isi
   "Nama penerima laporan (DPJP / dokter jaga)", centang **Read-back**, lalu **Simpan pelaporan**.

   ![Form pelaporan nilai kritis: nama penerima laporan, centang read-back, dan pesan galat bila belum lengkap](./gambar/lab--nilai-kritis.png)

5. Banner berubah menjadi "Nilai kritis dilaporkan · <pasien>" dengan "read-back terkonfirmasi" dan waktu lapor.
6. Tekan **Validasi teknis**. Setelah itu tekan **Validasi klinis (TTE Sp.PK)**. Tombol berubah menjadi
   **Tervalidasi**. Layar menyebut hasil dirilis ke CPPT, DPJP, dan SATUSEHAT (simulasi).
7. Bila sampel bermasalah, tekan **Minta ulang sampel** (atau **Batalkan sampel ulang**).
8. Pasien skenario memakai tombol langkahnya: Tn. Suryo (rawat jalan) **Pindai tabung**, **Terima hasil (HL7 ORU)**,
   lalu **Validasi dan rilis**; Tn. Hartono (IGD) **Buka hasil**, lalu pelaporan kalium kritis.

**Gerbang keselamatan dan aturan bisnis.**

- Nilai kritis wajib dilaporkan ke DPJP atau dokter jaga dalam 30 menit (`limitMinutes` di fixture). Timer terus
  berjalan; lewat batas, layar menulis "Melewati batas 30 menit, segera laporkan dengan read-back."
- Pelaporan ditolak tanpa nama penerima minimal 5 karakter ("Nama penerima wajib diisi (minimal 5 karakter).") dan
  tanpa read-back ("Read-back wajib dikonfirmasi sebelum disimpan."). Laporan tanpa read-back tidak sah, jadi nilai
  kritis tetap terbuka.
- Validasi diblokir bila nilai kritis belum dilaporkan dengan read-back, parameter masih diproses analyzer, sampel
  menunggu sampel ulang, atau kultur masih inkubasi. Alasannya tertulis di layar.
- Urutan validasi tetap: teknis oleh analis, lalu klinis oleh dokter Sp.PK dengan TTE.
- Bendera: KRITIS bila melewati batas kritis, H/L bila di luar rentang rujukan. Nilai tepat di batas dianggap masih
  dalam rentang. Status tidak hanya lewat warna.
- Koreksi setelah rilis hanya lewat hasil revisi berversi.

**Mode api.** `ScreenDef` belum punya `permission` (rencana `lab.write`). Di mode api rute 404 dan menu redup sampai
fase 4 membangun backend dan layar hibridanya.

## Radiologi

![Layar Radiologi: papan modalitas dengan slot hari ini, indikator radiologi, worklist pemeriksaan, dan panel ekspertise](./gambar/rad.png)

| Hal      | Isi                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/penunjang/radiologi` (`?pilih=<examId>`)                                                                                                                                               |
| Pemakai  | radiografer                                                                                                                                                                              |
| Komponen | S03 radiologi (RIS)                                                                                                                                                                      |
| Status   | demo (mode presentasi, tanpa mockup); API belum (fase 4 potongan 4.4)                                                                                                                    |
| Mockup   | tidak ada (dibangun tanpa mockup)                                                                                                                                                        |
| Kode web | `apps/web/src/app/(staf)/penunjang/radiologi/` · `apps/web/src/components/penunjang/rad-*.tsx` · `apps/web/src/lib/penunjang-radiologi.ts` · `apps/web/src/lib/server/data/penunjang.ts` |
| Kode API | belum ada                                                                                                                                                                                |

**Tujuan.** Menjadwalkan dan menjalankan pemeriksaan per modalitas, mencatat dosis radiasi, lalu menulis ekspertise
dengan templat yang ditandatangani radiolog.

**Alur.**

1. Buka **Radiologi**. "Papan modalitas · slot hari ini" memuat tiap alat dan pemakaian slotnya (mis. CT scan 64
   slice, 13/18 slot). Region "Indikator radiologi" memuat Pemeriksaan hari ini, Cito terbuka, Menunggu ekspertise,
   dan TAT ekspertise (rutin).
2. "Worklist radiologi" menampilkan kode tindakan (mis. ICD-9-CM 87.03) atau "kode belum dipetakan". Saring dengan
   "Filter status". Alurnya: Terjadwal, Berlangsung, Ekspertise, Ditandatangani.
3. Pemeriksaan terjadwal (mis. Tn. Rizky Ramadhan): centang "Identitas dicek dengan 2 penanda", centang skrining
   kontras bila order berkontras, lalu **Mulai pemeriksaan**.
4. Pemeriksaan berlangsung (mis. CT Ny. Maria Ulfa): isi "CTDIvol (mGy)" dan "DLP (mGy·cm)", lalu
   **Selesai, kirim ke ekspertise**.
5. Di "Ekspertise", pilih templat dan tekan **Terapkan templat**, isi **Temuan** dan **Kesan**, lalu
   **Tandatangani (TTE)**. "Laporan radiologi" menampilkan nama radiolog penanda tangan.
6. Skenario IGD: foto toraks Tn. Hartono muncul di worklist dari order set IGD.

**Gerbang keselamatan dan aturan bisnis.**

- **Mulai pemeriksaan** nonaktif sampai identitas dicek dengan 2 penanda. Order berkontras juga wajib skrining
  (eGFR, riwayat alergi kontras, puasa).
- Pemeriksaan CT wajib dosis sebelum dikirim ke ekspertise: CTDIvol di atas 0 sampai 200 mGy, DLP di atas 0 sampai
  5.000 mGy·cm.
- TTE ekspertise butuh temuan minimal 20 karakter, kesan minimal 10 karakter, dan tidak ada isian templat kosong
  (`__`).
- Kebutuhan kontras dan modalitas dibaca dari order di server, bukan dari input layar.
- Di mode presentasi, posisi radiografer menjalankan TTE atas nama radiolog fiktif di data dummy. Pemisahan peran
  radiografer dan radiolog dibangun di fase 4.

**Mode api.** `ScreenDef` belum punya `permission` (rencana `radiology.write`). Di mode api rute 404 dan menu redup
sampai fase 4.

## Farmasi

![Layar Farmasi: tab Telaah, Penyiapan, dan Serah terima dengan antrean resep di kiri dan item resep berkode KFA di kanan](./gambar/farmasi.png)

| Hal      | Isi                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/penunjang/farmasi`                                                                                                                                                                     |
| Pemakai  | apoteker                                                                                                                                                                                 |
| Komponen | S04 farmasi klinis, S05 dispensing dan depo                                                                                                                                              |
| Status   | demo (mode presentasi); API belum (fase 4 potongan 4.5, 4.6a, 4.6b)                                                                                                                      |
| Mockup   | `design/mockups/Farmasi.dc.html`                                                                                                                                                         |
| Kode web | `apps/web/src/app/(staf)/penunjang/farmasi/` · `apps/web/src/components/penunjang/farmasi-*.tsx` · `apps/web/src/lib/penunjang-farmasi.ts` · `apps/web/src/lib/server/data/penunjang.ts` |
| Kode API | belum ada modul farmasi · sumber resep: `apps/api/src/modules/orders/` (3.4)                                                                                                             |

**Tujuan.** Apoteker menelaah resep (administratif, farmasetik, klinis), menindaklanjuti peringatan CDS, menyiapkan
obat dengan cek ganda untuk obat high alert, lalu menyerahkan obat dan mengurangi stok depo.

**Alur.**

1. Buka **Farmasi**. Tab **Telaah · n** aktif. Pilih resep di "Antrean telaah", mis. Tn. Sutan Batubara.
2. "Item resep" menampilkan obat dengan kode KFA dan status formularium (mis. "KFA 93000387 · Fornas" untuk
   Klopidogrel 75 mg tab). Daftar telaah memuat identitas, SIP dokter, sediaan, stabilitas, interaksi, dosis ginjal,
   duplikasi, dan kontraindikasi.

   ![Peringatan CDS di telaah farmasi: interaksi klopidogrel dengan omeprazol dan dosis ginjal, dengan usulan ke dokter dan pilihan lanjut beralasan](./gambar/farmasi--cds.png)

3. Tindak lanjuti setiap peringatan CDS: **Usulkan ke dokter: ganti pantoprazol** lalu **Simulasi: dokter setuju**,
   atau **Dosis sudah sesuai eGFR**, atau **Tetap lanjut dengan alasan klinis**.
4. Tekan **Setujui dan siapkan**. Resep masuk antrean penyiapan. Pilihan lain: **Tahan resep**, **Lepas tahanan**,
   dan **Siapkan sebagian**.
5. Di tab **Penyiapan**, centang setiap obat setelah diambil, dihitung, dan diberi etiket. Untuk obat high alert,
   pilih "Apoteker kedua", centang konfirmasi hitung ulang, lalu **Konfirmasi cek ganda**. Tekan
   **Selesai disiapkan**.
6. Di tab **Serah terima**, centang empat butir serah terima, pilih penerima (**Pasien sendiri**, **Keluarga**, atau
   **Perawat ruangan** untuk rawat inap), lalu **Serahkan obat**. Layar menulis pengurangan stok depo, mis.
   "Asetosal 80 mg tab 700 → 670 tab".
7. Skenario rawat jalan: resep Tn. Suryo ditelaah, disiapkan, dan diserahkan dari layar ini.

**Gerbang keselamatan dan aturan bisnis.**

- **Setujui dan siapkan** nonaktif selama ada peringatan CDS yang menahan telaah: "Tindak lanjuti N peringatan CDS
  lebih dulu (ikuti saran atau lanjut dengan alasan)." Resep yang ditahan harus dilepas dulu.
- Override peringatan CDS wajib alasan klinis minimal 10 karakter. Server memeriksa bahwa peringatan itu milik resep
  yang sama dan memang menahan telaah.
- Obat high alert wajib cek ganda oleh apoteker kedua yang bertugas hari ini dan bukan apoteker yang menyiapkan:
  "Cek ganda harus oleh apoteker lain, bukan apoteker yang menyiapkan."
- **Selesai disiapkan** dan **Serahkan obat** nonaktif sampai semua centang lengkap ("Lengkapi N centang lagi.").
- Serah terima mencakup identitas dengan 2 penanda, pencocokan obat dengan resep dan etiket, edukasi, dan tanda
  tangan penerima.
- Stok di bawah minimum ditandai "di bawah minimum".

**Mode api.** `ScreenDef` belum punya `permission` (rencana `pharmacy.write`). Di mode api rute 404 dan menu redup
sampai fase 4.

## Kamar operasi

![Layar Kamar operasi: Gantt jadwal kamar OK 1 sampai OK 4, kasus terpilih, daftar tilik keselamatan WHO, dan hitung kasa](./gambar/ok.png)

| Hal      | Isi                                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/penunjang/kamar-operasi` (`?pilih=<caseId>`, mis. `ok3-1`)                                                                                                                              |
| Pemakai  | dokter, perawat                                                                                                                                                                           |
| Komponen | S06 kamar operasi dan anestesi                                                                                                                                                            |
| Status   | demo (mode presentasi); API belum (fase 4 potongan 4.7)                                                                                                                                   |
| Mockup   | `design/mockups/OK.dc.html`                                                                                                                                                               |
| Kode web | `apps/web/src/app/(staf)/penunjang/kamar-operasi/` · `apps/web/src/components/btn/ok-*.tsx` · `apps/web/src/lib/btn-ok.ts` · data `apps/web/src/lib/server/data/btn.ts` (`getOrSchedule`) |
| Kode API | belum ada                                                                                                                                                                                 |

**Tujuan.** Jadwal kamar operasi hari ini dan daftar tilik keselamatan bedah WHO (Sign in, Time out, Sign out) yang
terkunci berurutan, dengan hitung kasa dan instrumen sebelum operasi ditutup.

**Alur.**

1. Buka **Kamar operasi**. "Jadwal kamar" berbentuk Gantt per kamar. Kasus terpilih bawaan adalah Ny. Ratna Sari,
   "OK 2 · Kolesistektomi laparoskopik" dengan "ICD-9-CM 51.23 · Kolesistektomi laparoskopik".
2. Region "Daftar tilik keselamatan" memuat tiga fase. Centang butir **Sign in** (sebelum induksi), lalu
   **Konfirmasi sign in**. Konfirmasi tercatat dengan nama dan jam.
3. Centang butir **Time out** (sebelum insisi), lalu **Konfirmasi time out**. Tombol **Mulai insisi** baru aktif.

   ![Daftar tilik time out lengkap dan terkonfirmasi, tombol Mulai insisi aktif](./gambar/ok--time-out.png)

4. Tekan **Mulai insisi**. Layar menulis "✓ Insisi dicatat <jam>".
5. Isi hitung akhir di "Hitung kasa dan instrumen" (kolom awal dan akhir). Bila semua cocok, butir hitung di Sign out
   tercentang otomatis. Lengkapi **Sign out** (sebelum pasien keluar kamar) dan konfirmasi.
6. Tekan **Catat operasi selesai**, lalu **Pindahkan ke ruang pulih**.
7. Kasus lain dipilih dari Gantt, mis. Ny. Anisa Rahmadani "OK 3 · Seksio sesarea cito".

**Gerbang keselamatan dan aturan bisnis.**

- Fase hanya bisa dikonfirmasi berurutan dan bila semua butirnya lengkap. Sebelum sign in: "Sign in belum
  dikonfirmasi; induksi dan insisi terkunci."
- Insisi terkunci sampai time out dikonfirmasi: "Insisi terkunci: time out belum lengkap".
- Override darurat **Mulai insisi tanpa time out lengkap (darurat)** wajib alasan klinis minimal 15 karakter
  (`OVERRIDE_REASON_MIN`). Server menolak alasan yang lebih pendek.
- Server memeriksa bukti time out saat insisi: daftar tilik harus milik kasus itu, sign in dan time out lengkap dan
  terkonfirmasi, dan insisi belum tercatat. Selain itu ditolak.
- Sign out terkunci sampai insisi dicatat dan butuh hitung akhir kasa, jarum, dan instrumen yang sama dengan hitung
  awal. Bila tidak cocok, layar meminta hitung ulang.
- Operasi hanya bisa dicatat selesai setelah sign out dikonfirmasi.
- Kasus pasien skenario (Ny. Ratna Sari) menunggu langkah operasi di Simulasi; sebelum itu tertulis "Pasien skenario
  Simulasi · menunggu langkah operasi".

**Mode api.** `ScreenDef` belum punya `permission` (rencana `surgery.write`). Di mode api rute 404 dan menu redup
sampai fase 4.

## Tes yang menjaga layar ini

E2E mode presentasi (Playwright):

- `apps/web/e2e/demo/penunjang.spec.ts`: worklist dan hasil ber-LOINC, nilai kritis wajib penerima dan read-back,
  validasi berurutan, skenario IGD read-back, CDS menahan telaah farmasi, cek ganda high alert, stok depo berkurang,
  skenario resep Tn. Suryo, dosis CT wajib, ekspertise ber-TTE, tablet 768 px tanpa scroll horizontal.
- `apps/web/e2e/demo/btn.spec.ts` (blok "kamar operasi"): insisi terkunci sampai time out lengkap, override wajib
  beralasan.
- `apps/web/e2e/demo/semua-layar.spec.ts`: jaring pengaman semua layar dan QA visual.

Unit:

- `apps/web/src/lib/penunjang.test.ts`, `penunjang-farmasi.test.ts`, `penunjang-radiologi.test.ts`,
  `penunjang-skenario.test.ts` (gerbang server per aksi dan skenario).
- `apps/web/src/lib/btn-ok.test.ts` (gerbang time out, hitung kasa).
- `apps/web/src/lib/demo/fixtures/fixtures.test.ts`.

## Lihat juga

- [Fitur klinis (RME)](./12-fitur-klinis.md): CPOE yang mengirim order, rawat inap dan eMAR yang menerima obat.
- [Fitur keuangan](./14-fitur-keuangan.md): tarif penunjang masuk tagihan lewat charge capture.
- [Rekam medis dan jejak audit](./01-cara-kerja-sistem.md#rekam-medis-dan-jejak-audit).
- [Membuat layar web dari mockup](./03-tutorial.md#5-membuat-layar-web-dari-mockup).
- [Simulasi dan operasional](./18-simulasi-dan-operasional.md) dan [Peta kode](./19-peta-kode.md).
- Rencana: `docs/rencana/fase-4-penunjang.md`; status: `docs/PROGRESS.md`.
