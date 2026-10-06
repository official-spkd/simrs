# Fitur klinis (RME)

Halaman ini menjelaskan tujuh layar rekam medis elektronik (lapisan K): pemeriksaan poli, CPOE, IGD, tempat tidur,
rawat inap dengan CPPT dan eMAR, resume medis, dan tablet persetujuan tindakan. Setiap layar memuat gerbang
keselamatan yang tidak bisa dilewati diam-diam (CLAUDE.md §4.9) dan mengikuti pola rekam medis immutable: koreksi
menjadi versi baru, data final terkunci, perubahan sesudah TTE lewat addendum.

> Status 6 Okt 2026: ketujuh layar berjalan di mode presentasi dengan data fiktif (`pnpm dev:demo`). Di mode api
> semuanya masih "Belum tersambung" (potongan W1–W5b). Backend yang sudah ada: infrastruktur entri klinis (3.1),
> diagnosis, tanda vital, hasil, ringkasan (3.2a), CPPT + co-sign + worklist (3.2b), ADT, papan bed, triase, gelang,
> Aplicare (3.3, sudah digabung ke master), dan CPOE + CDS + resep (3.4). eMAR (3.5), resume (3.6), dan persetujuan
> tindakan (3.7) belum.

![Diagram rekam medis immutable: entri versi 1, koreksi menjadi versi 2 yang menggantikan versi 1, dan addendum setelah TTE](./gambar/diagram-rekam-medis-immutable.svg)

Posisi layar-layar ini dalam perjalanan pasien rawat jalan:

![Diagram alur rawat jalan: anjungan, SEP, antrean, poli, CPOE, lab dan farmasi, kasir, klaim](./gambar/diagram-alur-rawat-jalan.svg)

Konsep dasarnya ada di [Cara sistem bekerja](./01-cara-kerja-sistem.md#rekam-medis-dan-jejak-audit). Cara mode
presentasi dan simulasi pasien dibawakan ada di [Simulasi dan operasional](./18-simulasi-dan-operasional.md).

## Ringkasan layar

| Layar                  | Rute                   | Peran (mode presentasi)                              | Komponen      | Status                                     |
| ---------------------- | ---------------------- | ---------------------------------------------------- | ------------- | ------------------------------------------ |
| Pemeriksaan poli       | `/klinis/poli`         | dokter, dokter residen, perawat, bidan               | K01, K02      | 🟨 demo; API worklist, CPPT, diagnosis ada |
| Order dan resep (CPOE) | `/klinis/order`        | dokter, dokter residen                               | K09           | 🟨 demo; API CPOE + CDS ada (3.4)          |
| IGD                    | `/klinis/igd`          | dokter, dokter residen, perawat, petugas pendaftaran | K03           | 🟨 demo; API triase + papan IGD ada (3.3)  |
| Tempat tidur           | `/klinis/tempat-tidur` | perawat, petugas pendaftaran, manajemen              | K05           | 🟨 demo; API ADT + papan bed ada (3.3)     |
| Rawat inap             | `/klinis/rawat-inap`   | dokter, dokter residen, perawat, bidan               | K04, K07, K12 | 🟨 demo; API CPPT ada, eMAR belum (3.5)    |
| Resume medis           | `/klinis/resume`       | dokter, dokter residen                               | K13           | 🟨 demo; API belum (3.6)                   |
| Persetujuan tindakan   | `/tablet/persetujuan`  | dokter, perawat                                      | K11           | 🟨 demo; API belum (3.7, modul kerangka)   |

Legenda: 🟨 berjalan di mode presentasi, belum tersambung ke API · ✅ tersambung · ⬜ belum dibangun.

Semua layar di atas adalah layar hibrida (`requireScreen`): mode presentasi memakai jalur `demo-*.tsx` yang
dibekukan, mode api memeriksa `ScreenDef.permission` lalu menampilkan "Akses ditolak" atau "Belum tersambung".
Server Action mode presentasi (`actions-demo.ts`) memeriksa ulang posisi, kontrak zod, dan gerbang keselamatan,
tetapi tidak menyimpan apa pun. Umpan baliknya berakhiran "(simulasi, tidak disimpan)".

## Pemeriksaan poli

![Layar Pemeriksaan poli: antrean Poli Penyakit Dalam di kiri, banner pasien Ny. Rohana Siregar dengan alergi amoksisilin, kartu tanda vital, dan formulir CPPT SOAP](./gambar/poli.png)

| Hal      | Isi                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/klinis/poli` (`?pasien=<id>` = kunjungan yang dibuka)                                                                                                                                              |
| Pemakai  | dokter, dokter residen, perawat, bidan                                                                                                                                                               |
| Komponen | K01 worklist klinis, K02 rawat jalan                                                                                                                                                                 |
| Status   | demo (mode presentasi); API worklist, CPPT, diagnosis, tanda vital, dan ringkasan pasien ada, layar belum disambung (W1)                                                                             |
| Mockup   | `design/mockups/Main.dc.html`                                                                                                                                                                        |
| Kode web | `apps/web/src/app/(staf)/klinis/poli/` · `apps/web/src/components/klinis/poli-*.tsx`, `soap-*.tsx`, `vitals-card.tsx` · `apps/web/src/lib/server/data/klinis/poli.ts` · `apps/web/src/lib/klinis.ts` |
| Kode API | `apps/api/src/modules/worklist/` · `cppt/` · `diagnosis/` · `nursing/` (tanda vital) · `summary/` · `assessment/` · `drafts/`                                                                        |

**Tujuan.** Satu layar kerja dokter dan perawat poli: antrean hari ini, banner pasien dengan alergi, tanda vital,
CPPT dalam format SOAP dengan diagnosis ICD-10, dan rencana tindak lanjut.

**Alur.**

1. Buka **Pemeriksaan poli**. Kolom kiri "Antrean hari ini" memuat 7 pasien Poli Penyakit Dalam. Cari dengan nama,
   No. RM, atau nomor antrean, atau saring dengan chip **Semua**, **Menunggu**, dan **Hasil**.
2. Dokter menekan **Panggil berikutnya · PD-026** (nomor mengikuti pasien menunggu berikutnya). Pasien dipanggil
   jadi "Diperiksa"; pasien yang sedang diperiksa sebelumnya jadi "Dijeda". Posisi lain melihat catatan
   "Pemanggilan pasien dilakukan dokter pemeriksa."
3. Klik nama pasien, misalnya Ny. Rohana Siregar. Banner pasien tampil dengan nama, umur, RM, NIK tersamar, penjamin,
   dan "Alergi: Amoksisilin".
4. Kartu tanda vital menulis "TANDA VITAL · diukur perawat 07.36". Nilai di luar batas diberi teks **Tinggi** atau
   **Rendah**, bukan hanya warna.
5. Perawat atau bidan menekan **Ukur ulang tanda vital**, mengisi tekanan darah, nadi, suhu, dan SpO2, lalu
   **Simpan tanda vital**.
6. Dokter mengisi **S · Subjektif** dan **O · Objektif**, lalu **+ Tambah diagnosis** dan memilih kode di
   **Pilih kode ICD-10** (mis. E11.9 Diabetes melitus tipe 2 tanpa komplikasi). Diagnosis pertama jadi diagnosis
   utama.
7. Bagian **P · Rencana** memuat baris LAB, RAD, OBAT, TINDAKAN, dan KONTROL. Dokter membuka CPOE lewat
   **Order penunjang**, **Tulis resep (CPOE)**, atau **Buka CPOE** di banner.
8. Tekan **Simpan draf** bila belum selesai, atau **Tanda tangani dan selesai**. Status berubah menjadi
   "Kunjungan selesai · ditandatangani <jam>" beserta ringkasan diagnosis utama, order, dan tindak lanjut, serta
   tautan **Lanjut ke kasir**.
9. Dokter residen melihat tombol **Simpan dan minta co-sign DPJP**. Catatannya berstatus "Menunggu co-sign DPJP"
   dan kunjungan belum selesai.

**Gerbang keselamatan dan aturan bisnis.**

- **Tanda tangani dan selesai** nonaktif sampai ada minimal satu diagnosis. Alasannya tertulis: "Isi minimal satu
  diagnosis (A · Asesmen ICD-10) agar kunjungan bisa diselesaikan." Server menolak hal yang sama.
- Kode ICD-10 hanya dari daftar contoh di `ICD10_OPTIONS` (`lib/klinis.ts`); kode lain ditolak server.
- CPPT dokter hanya untuk dokter dan dokter residen. Perawat dan bidan melihat "CPPT dokter hanya bisa diubah posisi
  dokter" dan tidak melihat tautan CPOE.
- Tanda vital hanya diisi perawat atau bidan. Format tekanan darah wajib `sistolik/diastolik`; isian lain ditolak
  dengan "Isi dengan format sistolik/diastolik, mis. 120/80."
- Tekanan darah ≥ 140/90 ditandai Tinggi, sistolik < 90 ditandai Rendah.
- CPPT dokter residen tidak final sebelum co-sign DPJP.
- Kunjungan yang diminta (`?pasien=`) tetapi tidak ada di antrean hari ini menghasilkan 404, agar tidak membuka
  rekam pasien lain secara diam-diam.
- Pasien skenario Simulasi (Tn. Suryo Adi Nugroho) hanya maju lewat tugas skenario. S/O mengikuti naskah, diagnosis
  dibatasi ke kode skenario, dan Server Action menolak penyimpanan langsung.

**Mode api.** Izin layar `clinical.write`. Peran yang memegangnya melihat "Belum tersambung" sampai potongan W1;
peran lain melihat "Akses ditolak". TTE CPPT di API tetap memakai izin `clinical.sign`.

## Order dan resep (CPOE)

![Layar CPOE: daftar kunjungan hari ini dengan chip alergi per pasien](./gambar/order.png)

| Hal      | Isi                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rute     | `/klinis/order` (pilih kunjungan) · `/klinis/order/<encounterId>` (CPOE satu kunjungan)                                                                                  |
| Pemakai  | dokter, dokter residen                                                                                                                                                   |
| Komponen | K09 CPOE dan order set                                                                                                                                                   |
| Status   | demo (mode presentasi); API katalog, order set, pratinjau CDS, kirim, dan batal ada (3.4), layar belum disambung (W2)                                                    |
| Mockup   | `design/mockups/CPOE.dc.html`                                                                                                                                            |
| Kode web | `apps/web/src/app/(staf)/klinis/order/` · `apps/web/src/components/klinis/cpoe-*.tsx` · `apps/web/src/lib/klinis-cds.ts` · `apps/web/src/lib/server/data/klinis/cpoe.ts` |
| Kode API | `apps/api/src/modules/orders/` · `apps/api/src/modules/cds/` · mesin aturan `packages/shared/src/clinical/cds.ts`                                                        |

**Tujuan.** Dokter menulis order lab, radiologi, obat, tindakan, dan tindak lanjut dari katalog atau order set.
CDS memeriksa setiap item terhadap alergi, obat rutin, riwayat, interaksi, dan fungsi ginjal sebelum order
dikirim dengan TTE.

**Alur.**

1. Buka **Order & resep (CPOE)**. Pilih kunjungan di "Kunjungan hari ini". Pasien skenario yang sedang dibawakan
   tampil teratas dengan chip "Langkah Simulasi aktif".

   ![CPOE Ny. Rohana Siregar: katalog dan order set di kiri, order per jenis di tengah, ringkasan dan tombol kirim di kanan](./gambar/order--detail.png)

2. Kepala layar memuat banner pasien, BB, dan eGFR. eGFR < 45 ditandai "rendah".
3. Cari item di **Cari pemeriksaan, obat, tindakan**, atau terapkan order set institusi (mis. "Kontrol hipertensi +
   DM tipe 2", "Nyeri dada akut (SKA)", "Pneumonia komunitas", "Pra-operasi elektif dewasa"). Item masuk sebagai
   draf, dikelompokkan LABORATORIUM, RADIOLOGI, OBAT, TINDAKAN, dan TINDAK LANJUT.
4. Setiap baris menunjukkan hasil CDS. Contoh Ny. Rohana: tambah "Amoksisilin 500 mg kapsul" memunculkan gerbang
   merah "CDS memblokir Amoksisilin 500 mg kapsul" karena pasien alergi amoksisilin.

   ![Gerbang CDS merah: amoksisilin diblokir karena alergi, dengan tombol alternatif dan Override dengan alasan](./gambar/order--cds-blokir.png)

5. Selesaikan blok dengan salah satu cara: ganti ke alternatif aman (mis. Tn. Darmawan Putra, alergi ibuprofen:
   **Ganti parasetamol 500 mg** untuk asam mefenamat), hapus item, atau **Override dengan alasan** lalu
   **Simpan alasan dan lanjut**.
6. Periksa kolom kanan: "Pemeriksaan sebelum kirim", hasil penunjang terbaru, dan "Estimasi biaya pasien".
7. Tekan **Kirim N order (TTE)**. Layar menulis "N order terkirim pukul <jam>".

**Gerbang keselamatan dan aturan bisnis.**

- Temuan CDS tingkat blok menahan tombol kirim. Alasannya tertulis, mis. "Belum bisa dikirim: 1 order diblokir CDS
  (amoksisilin). Ganti alternatif, hapus, atau override dengan alasan."
- Override wajib alasan klinis minimal 10 karakter (`CPOE_OVERRIDE_MIN_REASON`). Override tercatat di baris order:
  "Override alergi oleh <dokter> · alasan: …".
- Server Action `sendOrdersAction` menghitung ulang CDS di server. Order yang masih diblokir ditolak dengan kode
  `CDS_BLOCKED`, bukan hanya tombol yang dimatikan. API 3.4 melakukan hal yang sama (422 `CDS_BLOCKED`, penolakan
  dicatat di `cds_alerts` dan audit `denied`).
- Urutan temuan CDS: blok, lalu peringatan alergi, alergi silang, riwayat, interaksi, dosis ginjal, perubahan dosis,
  dan biaya di luar paket penjamin.
- Estimasi biaya dihitung `bigint` rupiah. Pasien umum membayar seluruh tarif; pasien BPJS atau asuransi hanya item di
  luar paket. Bila ada item di luar paket, layar meminta persetujuan biaya pasien.
- Hanya dokter dan dokter residen. Perawat yang membuka CPOE melihat "Layar ini untuk posisi lain".
- Kunjungan pasien skenario (Tn. Suryo, Tn. Hartono Wibisono) mengikuti langkah Simulasi: katalog dan order set
  nonaktif dengan catatan "Pasien simulasi: order mengikuti langkah skenario.", dan kirim hanya lewat
  **Kirim resep (TTE)** setelah rencana terapi, gerbang CDS skenario, dan PRB selesai.
- Kunjungan tak dikenal menghasilkan 404.

**Mode api.** Izin layar `order.write`. Sampai potongan W2 halaman menampilkan "Belum tersambung". Di API, resep
penulis tanpa `clinical.sign` (residen) berstatus `needs_review` untuk DPJP.

## IGD

![Papan pelacakan IGD: ringkasan IGD, filter level triase dan zona, daftar pasien dengan nomor triase dan lama tinggal](./gambar/igd.png)

| Hal      | Isi                                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/klinis/igd` (`?pilih=<encounterId>` = pasien di panel triase)                                                                                                             |
| Pemakai  | dokter, dokter residen, perawat, petugas pendaftaran                                                                                                                        |
| Komponen | K03 IGD dan triase                                                                                                                                                          |
| Status   | demo (mode presentasi); API triase, papan IGD + SSE, status alur, dan SEP IGD ada (3.3), layar belum disambung (W3)                                                         |
| Mockup   | `design/mockups/IGD.dc.html`                                                                                                                                                |
| Kode web | `apps/web/src/app/(staf)/klinis/igd/` · `apps/web/src/components/rawat-inap/triage-*.tsx` · `apps/web/src/lib/rawat-inap.ts` · `apps/web/src/lib/server/data/klinis/igd.ts` |
| Kode API | `apps/api/src/modules/triage/` · `apps/api/src/modules/encounter/` (SEP IGD) · mesin triase `packages/shared/src/clinical/triage.ts`                                        |

**Tujuan.** Papan pelacakan pasien IGD dengan lama tinggal, zona, dan status alur, plus panel triase lima level (skala
ATS) dengan saran sistem dari tanda vital.

**Alur.**

1. Buka **IGD**. Kepala layar menunjukkan bed terpakai dan ambulans menuju. Region "Ringkasan IGD" memuat Triase 1–2,
   Waktu tunggu dokter, Boarding > 4 jam, dan Pulang tanpa diperiksa.
2. Saring papan dengan **Semua level** atau level tertentu (mis. **Level 4 · Semi-urgen**) dan dengan zona (Area
   triase, Resusitasi, Akut, Fast track).
3. Klik pasien, mis. Ny. Lestiani Hapsari. Panel "Triase pasien" menampilkan waktu tiba, penghitung "Lama di IGD",
   keluhan utama, dan ubin tanda vital bertulisan Tinggi atau Rendah.

   ![Panel triase dengan saran sistem level 2, pilihan level 1 sampai 5, dan gerbang keselamatan bila level diturunkan](./gambar/igd--triase.png)

4. Pilih level di "Level triase". Saran sistem diberi tanda "(saran sistem)". Teks anjuran menyesuaikan level,
   misalnya "Urgen: zona akut, dokter ≤ 30 menit, ulang tanda vital tiap 30 menit."
5. Bila level lebih rendah dari saran, gerbang "Level 3 di bawah saran sistem (triase 2)" muncul. Pilih
   **Kembali ke level 2 (saran sistem)** atau **Tetap lanjut dengan alasan klinis**, isi alasan, lalu
   **Simpan alasan dan lanjut**.
6. Centang order awal yang perlu, lalu tekan **Simpan triase N** (atau "… dan tempatkan di bed …" bila bed sudah
   ada). Papan langsung menulis level baru, mis. "3 · Urgen".
7. Dari panel, **Minta bed** membuka Tempat tidur dan **Rawat inap** membuka daftar rawat inap.
8. **Pasien tanpa identitas** dan **+ Triase pasien baru** menambah pasien ke area triase (hanya di layar ini).
9. Skenario IGD → rawat inap: pasien anonim "Pasien laki-laki ±60 th · identitas belum dicocokkan" diidentifikasi
   dulu (**Pasang gelang dan buka kunjungan IGD**), lalu **Simpan tanda vital**, triase, dan
   **Tempatkan di bed resusitasi 2 dan pasang monitor**.

**Gerbang keselamatan dan aturan bisnis.**

- Turun dari saran sistem wajib alasan klinis minimal 10 karakter (`SAFETY_REASON_MIN`). Tanpa alasan, tombol simpan
  nonaktif dan server menolak dengan "Level di bawah saran sistem wajib disertai alasan klinis (minimal 10 karakter)."
  Override tercatat di jejak audit dan ditinjau komite mutu.
- Batas protokol: level di bawah batas pasien ditolak, mis. nyeri dada wajib minimal urgen sampai sindrom koroner
  disingkirkan.
- Saran dan batas protokol dibaca server dari data IGD, bukan dari klien.
- Triase hanya oleh perawat, dokter, atau dokter residen. Petugas pendaftaran membuka papan untuk identifikasi dan
  admisi, dan melihat alasan tertulis "Triase oleh perawat/dokter".
- Pasien skenario: triase terkunci sampai identitas dicocokkan dan gelang terpasang, lalu sampai tanda vital dicatat.
- Lama tinggal ≥ 4 jam ditulis "Lewat 4 jam"; triase 1–2 yang menunggu dokter > 10 menit ditulis "Dokter lewat 10
  menit". Batas 4 jam dari pengaturan `bed.boarding_alert_hours`.

**Mode api.** Izin layar `clinical.read`, agar petugas pendaftaran ikut membuka papan. Aksi klinis diperiksa API
dengan izin sendiri (triase `triage.write`). Sampai potongan W3 halaman menampilkan "Belum tersambung".

## Tempat tidur

![Manajemen tempat tidur: ubin ringkasan status bed, filter bangsal dan status, peta bed bangsal, dan daftar permintaan bed](./gambar/bed.png)

| Hal      | Isi                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rute     | `/klinis/tempat-tidur` (`?bangsal=<kode>` atau `?bangsal=semua`)                                                                                                   |
| Pemakai  | perawat, petugas pendaftaran, manajemen                                                                                                                            |
| Komponen | K05 bed management                                                                                                                                                 |
| Status   | demo (mode presentasi); API papan bed + SSE, status manual, permintaan dan alokasi bed, admisi, transfer, Aplicare ada (3.3), layar belum disambung (W3)           |
| Mockup   | `design/mockups/BedManagement.dc.html`                                                                                                                             |
| Kode web | `apps/web/src/app/(staf)/klinis/tempat-tidur/` · `apps/web/src/lib/rawat-inap.ts` (`BED_STATUS_META`, `filterBeds`) · `apps/web/src/lib/server/data/klinis/bed.ts` |
| Kode API | `apps/api/src/modules/adt/` (`bed-board.service.ts`, `bed-ops.service.ts`, `aplicare-sync.service.ts`, `adt.service.ts`)                                           |

**Tujuan.** Peta bed per bangsal dengan status bertulisan, alokasi bed ke permintaan dari IGD atau admisi elektif,
dan perputaran status bed (pulang, kotor, dibersihkan, siap).

**Alur.**

1. Buka **Tempat tidur**. Kepala layar menulis "Ketersediaan bed terkirim ke BPJS dan Kemenkes · <jam>".
2. Region "Ringkasan status bed" memuat Terisi, Siap pakai, Dipesan, Kotor · dibersihkan, dan Rusak.
3. Saring dengan **Bangsal**, **Kelas**, dan **Status**. Layar menulis jumlah yang tampil, mis. "1 dari 286 bed
   ditampilkan". Ganti tampilan **Peta bed** atau **Daftar**.
4. Pilih bed berstatus Siap di peta. Kartu "Bed terpilih" menampilkan rincian dan satu aksi status berikutnya.
5. Di "Permintaan bed", tekan **Alokasikan Ny. Maria ke bed M-xxx**. Layar menulis "… dialokasikan ke M-xxx ·
   dipesan …". Chip kandidat bed (**Tampilkan bed … di peta**) memilih bed itu di peta.
6. Ubah status bed lewat kartu bed terpilih: **Pasien tiba · tandai terisi**, **Pasien sudah pulang**,
   **Tandai dibersihkan**, **Selesai dibersihkan · siap pakai**, atau **Perbaikan selesai · siap pakai**.
7. Pasien skenario punya "Tugas admisi": **Cek kepesertaan BPJS**, **Terbitkan SPRI dan SEP rawat inap**,
   **Tanda tangani persetujuan**, dan **Transfer dan serah terima SBAR**.

**Gerbang keselamatan dan aturan bisnis.**

- Status selalu bertulisan (Siap, Terisi, Pulang hari ini, Dipesan, Kotor, Dibersihkan, Rusak), bukan hanya warna.
- Alokasi hanya ke bed berstatus Siap. Tanpa bed terpilih tombol menulis "(pilih bed Siap dulu)". Bed yang disiapkan
  untuk pasien skenario tidak bisa dipakai permintaan lain.
- Permintaan dari IGD yang menunggu ≥ 4 jam ditulis "Lewat 4 jam". Bangsal ≥ 90% terisi ditulis "Hampir penuh".
- Chip kandidat bed berukuran sentuh minimal 44 px.
- Di API, status manual memakai `baseVersion` (beda versi → 409 `BED_VERSION_CONFLICT`), alokasi ke bed tidak siap →
  409 `BED_NOT_AVAILABLE`, dan hunian ganda dicegah constraint EXCLUDE.
- Setiap perubahan status bed rawat inap ber-kelas memicu outbox Aplicare (`bpjs.aplicare.update`).

**Mode api.** Izin layar `bed.read` (manajemen hanya membaca). Sampai potongan W3 halaman menampilkan "Belum
tersambung". Detail API ada di
[Cara kode bekerja](./02-cara-kerja-kode.md#adt-papan-bed-triase-igd-gelang-aplicare-k03-k04-k05-fase-3-potongan-3-3).

## Rawat inap

![Daftar pasien rawat inap dengan filter bangsal dan kolom bed, pasien, diagnosis, DPJP, hari rawat, EWS, dan penanda](./gambar/ranap.png)

| Hal      | Isi                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/klinis/rawat-inap` (daftar) · `/klinis/rawat-inap/<encounterId>?tab=ringkasan\|cppt\|obs\|askep\|hasil`                                                                                               |
| Pemakai  | dokter, dokter residen, perawat, bidan                                                                                                                                                                  |
| Komponen | K04 rawat inap, K07 CPPT dan serah terima, K12 asuhan keperawatan dan eMAR                                                                                                                              |
| Status   | demo (mode presentasi); API CPPT + co-sign + serah terima (3.2b), tanda vital + EWS (3.2a), gelang (3.3) ada; eMAR + askep belum (3.5); layar belum disambung (W4)                                      |
| Mockup   | `design/mockups/Ranap.dc.html`                                                                                                                                                                          |
| Kode web | `apps/web/src/app/(staf)/klinis/rawat-inap/` (`cppt-panel.tsx`, `emar-gate.tsx`, `emar-dose.tsx`, `emar-panel.tsx`) · `apps/web/src/lib/rawat-inap.ts` · `apps/web/src/lib/server/data/klinis/ranap.ts` |
| Kode API | `apps/api/src/modules/cppt/` · `nursing/` (tanda vital + EWS) · `adt/` (gelang) · mesin `packages/shared/src/clinical/{emar,ews}.ts`                                                                    |

**Tujuan.** Rekam rawat inap per pasien dalam lima tab: Ringkasan, CPPT & eMAR, Observasi & EWS, Asuhan keperawatan,
dan Hasil. Pemberian obat terkunci sampai gelang pasien terpindai.

**Alur.**

1. Buka **Rawat inap**. Daftar memuat bed, pasien, diagnosis, DPJP, hari rawat, EWS, dan penanda (mis. "Menunggu
   co-sign DPJP"). Saring dengan "Filter bangsal", lalu klik pasien, mis. Ny. Endang Wijaya.
2. Judul menjadi "Rawat inap · Bangsal Melati M-203". Banner pasien memuat "Alergi: Amoksisilin".

   ![Rekam rawat inap Ny. Endang Wijaya: tab CPPT dan eMAR dengan grid jadwal obat terkunci dan CPPT terintegrasi](./gambar/ranap--detail.png)

3. Di tab **CPPT & eMAR**, grid eMAR terkunci dengan pesan "Pemberian obat terkunci sampai gelang pasien cocok".
   Tekan **Pindai gelang**. Status menjadi "✓ Pasien benar · gelang terpindai … · RM …".

   ![eMAR setelah gelang terpindai: slot jadwal obat bisa dipilih, dosis kewaspadaan tinggi bertanda cek ganda](./gambar/ranap--emar-terbuka.png)

4. Pilih satu slot dosis (mis. "Insulin aspart sesuai skala jam 12.00"). Tekan **Pindai label obat**, lalu
   **Catat pemberian**. Obat kewaspadaan tinggi minta nama perawat kedua di "Cek ganda: nama perawat kedua".
5. Dosis terlambat (mis. Omeprazol 40 mg injeksi jam 08.00) memakai **Catat pemberian terlambat** dengan
   "Alasan keterlambatan".
6. Di "CPPT terintegrasi", saring per profesi, lalu **+ Tulis CPPT (SOAP)** dan **Simpan dan tanda tangani**.
7. Untuk catatan sendiri tekan **Koreksi CPPT …**, ubah isi, isi "Alasan koreksi", lalu
   **Simpan koreksi (versi baru)**. Untuk catatan PPA lain tekan **Addendum atas CPPT …** lalu **Simpan addendum**.
8. DPJP (posisi dokter) menekan **Setujui co-sign DPJP** pada catatan residen yang "Menunggu co-sign DPJP".
9. Tab **Observasi & EWS** menampilkan tabel tanda vital dengan skor EWS. Tab **Asuhan keperawatan** memuat
   intervensi shift ini. Tab **Hasil** memuat hasil penunjang terbaru.
10. Pasien skenario (Tn. Hartono, Ny. Ratna Sari) punya region "Perjalanan rawat (simulasi)" dengan tombol
    **Lompat ke hari 1 pagi** dan seterusnya, yang terbuka setelah semua dosis jadwal pertama tercatat.

**Gerbang keselamatan dan aturan bisnis.**

- eMAR terkunci sampai gelang cocok dengan RM pasien kunjungan. Gelang yang salah ditolak: "Gelang tidak cocok
  dengan pasien kunjungan ini; pindai ulang gelang yang benar."
- Gelang tak terbaca membuka gerbang "Gelang tidak terbaca: identitas belum terverifikasi" dengan pilihan
  **Pindai ulang gelang** atau **Verifikasi manual dua identitas**. Override wajib alasan minimal 10 karakter,
  tercatat, dan ditinjau komite keselamatan pasien.
- Setiap dosis diperiksa ulang di server: slot harus bisa dicatat, label obat harus cocok dengan obat slot, dosis
  terlambat wajib alasan minimal 10 karakter.
- Obat kewaspadaan tinggi wajib cek ganda oleh petugas lain: "Cek ganda harus oleh petugas lain, bukan pemberi
  obat."
- Pemberian obat hanya oleh perawat, bidan, atau dokter.
- CPPT: S dan A wajib ("S wajib diisi."). Koreksi hanya oleh penulisnya, wajib alasan minimal 10 karakter, dan
  disimpan sebagai versi baru. Versi lama tetap tampil dengan label "Versi lama · digantikan koreksi (tetap
  tersimpan)". Catatan PPA lain hanya bisa diberi addendum; catatan aslinya tidak berubah.
- Co-sign hanya oleh DPJP (posisi dokter) atas entri residen yang memang menunggu co-sign.
- EWS dewasa: 0–4 rendah, 5–6 sedang (atau satu parameter bernilai 3), ≥ 7 tinggi.
- Fakta dosis (terlambat, kewaspadaan tinggi) dibaca dari rekam server, bukan dari klien.

**Mode api.** Izin layar `clinical.write`. Sampai potongan W4 halaman daftar dan detail menampilkan "Belum
tersambung" (rute detail mode api memberi 200, bukan 404). Endpoint eMAR baru dibangun di potongan 3.5.

## Resume medis

![Resume medis Ny. Endang Wijaya: isi resume per bagian dengan sumber datanya dan panel kelengkapan 12 butir dengan tombol TTE](./gambar/resume.png)

| Hal      | Isi                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/klinis/resume` (daftar) · `/klinis/resume/<encounterId>`                                                                                          |
| Pemakai  | dokter, dokter residen                                                                                                                              |
| Komponen | K13 resume dan dokumen pulang                                                                                                                       |
| Status   | demo (mode presentasi); API belum (potongan 3.6; modul `discharge` masih kerangka), layar belum disambung (W5b)                                     |
| Mockup   | `design/mockups/Resume.dc.html`                                                                                                                     |
| Kode web | `apps/web/src/app/(staf)/klinis/resume/` · `apps/web/src/lib/rawat-inap.ts` (`resumeSignBlocker`) · `apps/web/src/lib/server/data/klinis/resume.ts` |
| Kode API | `apps/api/src/modules/discharge/` (kerangka) · aturan `packages/shared/src/clinical/resume.ts`                                                      |

**Tujuan.** Resume medis pulang yang menarik isi dari rekam medis (asesmen, CPPT, observasi, hasil, eMAR, laporan
operasi) tanpa input ulang, dengan 12 butir kelengkapan sebelum TTE DPJP.

**Alur.**

1. Buka **Resume medis**. Bila langkah resume skenario sedang aktif, layar langsung membuka resume pasien skenario.
   Selain itu tampil daftar resume yang sedang disiapkan.
2. Buka resume, mis. "Resume medis · Ny. Endang Wijaya". Setiap bagian diberi label sumber, mis. "dari CPPT",
   "dari eMAR", "dari hasil lab dan radiologi".
3. Periksa obat pulang. Bagian rekonsiliasi menulis "Sumber: perlu konfirmasi DPJP" sampai dokter menekan
   **Konfirmasi DPJP**. Setelah itu daftar obat pulang dikunci untuk resep pulang.
4. Panel "Kelengkapan dan tanda tangan" menunjukkan jumlah butir, mis. 12/12, dan daftar centang.
5. Tekan **Tanda tangani resume (TTE)**. Status menjadi "Resume final · TTE" dan semua centang terkunci.
6. Pasien skenario memakai **Himpun resume** dan pilihan rekonsiliasi skenario; TTE-nya mengikuti giliran Simulasi.

**Gerbang keselamatan dan aturan bisnis.**

- TTE terkunci sampai 12 butir lengkap. Alasannya tertulis: "TTE terkunci: lengkapi N butir lagi (…)". Kedua belas
  butir: identitas, anamnesis, pemeriksaan fisik masuk dan pulang, hasil penunjang penting, diagnosis berkode,
  prosedur ICD-9-CM, ringkasan terapi dari eMAR, rekonsiliasi obat pulang, edukasi, instruksi pulang, jadwal kontrol,
  serta kondisi dan cara pulang.
- Rekonsiliasi obat pulang wajib dikonfirmasi DPJP; server menolak TTE tanpa konfirmasi.
- TTE hanya oleh DPJP (posisi dokter). Dokter residen bisa menyiapkan resume tetapi melihat "Resume disiapkan; TTE
  hanya oleh DPJP (posisi dokter)."
- Setelah final, perubahan hanya lewat addendum berversi.
- Server memeriksa ulang: resume dikenal, sudah disiapkan, belum final, bukan milik pasien skenario, dan 12 butir
  lengkap.

**Mode api.** Izin layar `clinical.write`; TTE resume di API kelak memakai `clinical.sign`. Sampai potongan 3.6 dan
W5b halaman menampilkan "Belum tersambung".

## Persetujuan tindakan

![Tablet persetujuan tindakan pemasangan kateter vena sentral untuk Tn. Hendro Gunawan (persetujuan diberikan istri): langkah informasi dengan butir yang harus dipahami](./gambar/consent.png)

| Hal      | Isi                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/tablet/persetujuan` (dokumen di tablet ini) · `/tablet/persetujuan/<consentId>` (layar penuh, kerangka `perangkat`)                                          |
| Pemakai  | dokter, perawat                                                                                                                                                |
| Komponen | K11 persetujuan dan edukasi                                                                                                                                    |
| Status   | demo (mode presentasi); API belum (potongan 3.7; modul `consent` masih kerangka), layar belum disambung (W5a)                                                  |
| Mockup   | `design/mockups/Consent.dc.html`                                                                                                                               |
| Kode web | `apps/web/src/app/(perangkat)/tablet/persetujuan/` · `apps/web/src/components/rawat-inap/signature-pad.tsx` · `apps/web/src/lib/server/data/klinis/consent.ts` |
| Kode API | `apps/api/src/modules/consent/` (kerangka)                                                                                                                     |

**Tujuan.** Pasien atau keluarga membaca informasi tindakan di tablet, menyatakan paham per butir, lalu
menandatangani bersama saksi. Dokter pelaksana menutup dengan TTE. Pasien juga bisa menolak tindakan dengan alasan.

**Alur.**

1. Buka **Persetujuan tindakan**. Bila ada dokumen skenario yang sedang gilirannya, tablet langsung membukanya.
   Selain itu tampil "Dokumen di tablet ini".
2. Langkah **Informasi**: centang ketujuh butir "Saya memahami: …". Ukuran teks bisa diperbesar atau diperkecil.
3. Tekan **Lanjut ke tanda tangan**. Pasien atau keluarga menandatangani di bantalan, atau mengisi "Atau ketik nama
   lengkap sebagai tanda tangan" lalu **Pakai nama ketik**.
4. Tekan **Lanjut ke saksi**. Saksi keluarga menandatangani, lalu centang "Saksi kedua (petugas): … hadir dan
   menyaksikan penandatanganan".
5. Tekan **Lanjut ke TTE dokter**, lalu dokter menekan **Tanda tangani (TTE)**. Status menjadi "Dokumen final · TTE".
6. Untuk menolak, tekan **Saya menolak tindakan**, tulis alasan dengan kata-kata pasien, lalu **Catat penolakan**.
   Status menjadi "Ditolak pasien" dan dokumen terkunci.

**Gerbang keselamatan dan aturan bisnis.**

- **Lanjut ke tanda tangan** nonaktif sampai ketujuh butir dicentang. Server memeriksa himpunan butir yang persis
  sama.
- Tanda tangan pasien atau keluarga dan saksi harus atas nama yang tercantum di dokumen.
- Saksi kedua dari petugas wajib hadir sebelum TTE.
- TTE hanya oleh dokter pelaksana (posisi dokter). Perawat bisa mendampingi dan mencatat penolakan, tetapi tidak
  bisa TTE.
- Penolakan wajib alasan minimal 10 karakter; tanpa alasan muncul "Alasan penolakan wajib diisi". Rancangannya,
  DPJP diberi notifikasi (mode presentasi tidak mengirim notifikasi nyata).
- Dokumen final atau ditolak terkunci: penolakan dan tanda tangan ulang ditolak; perubahan hanya lewat addendum.
- Dokumen milik skenario (Tn. Hartono, Ny. Ratna Sari) hanya bisa diproses pada giliran tugasnya. Di luar giliran,
  tablet hanya bisa dibaca dengan status "Menunggu giliran persetujuan di Simulasi." Persetujuan operasi Ny. Ratna
  final bersama SEP rawat inap pada langkah Admisi elektif.

**Mode api.** Izin layar `consent.write`, dibuka dengan sesi staf di tablet (tanpa prinsipal perangkat). TTE di API
kelak memakai `consent.sign`. Sampai potongan 3.7 dan W5a halaman menampilkan "Belum tersambung".

## Tes yang menjaga layar ini

E2E mode presentasi (Playwright, proyek `demo-desktop` dan `demo-tablet`):

- `apps/web/e2e/demo/klinis.spec.ts`: antrean poli, banner + alergi, TTV, tanda tangan butuh diagnosis, CDS
  amoksisilin diblokir sampai alasan ≥ 10 karakter, alternatif aman, kunjungan tak dikenal 404, perawat ditolak di
  CPOE, CPOE pasien skenario terkunci, status IGD dan bed bertulisan, CSP ber-nonce.
- `apps/web/e2e/demo/rawat-inap.spec.ts`: triase turun wajib alasan, alokasi bed, eMAR terkunci sampai gelang cocok,
  cek ganda, dosis terlambat, koreksi dan addendum CPPT, TTE resume 12 butir, persetujuan tablet dan penolakan.
- `apps/web/e2e/demo/semua-layar.spec.ts`: jaring pengaman semua layar dan QA visual.
- `apps/web/e2e/smoke.spec.ts`: mode api menampilkan "Belum tersambung" atau "Akses ditolak" di layar klinis dan rute
  detailnya.

Unit:

- `apps/web/src/lib/klinis.test.ts`, `klinis-cds.test.ts`, `rawat-inap.test.ts`, `rawat-inap-gates.test.ts`,
  `rawat-inap-scenario.test.ts`, `screens.test.ts`, `apps/web/src/lib/demo/fixtures/fixtures.test.ts`.
- `packages/shared/src/clinical/clinical.test.ts` (CDS, EWS, triase, eMAR, resume).
- API: `apps/api/test/clinical-infra.test.ts`, `clinical-records.test.ts`, `clinical-notes.test.ts`,
  `orders.test.ts`, `adt-triage.test.ts`, `admission.test.ts`.

## Lihat juga

- [Fitur penunjang](./13-fitur-penunjang.md): lab, radiologi, farmasi, dan kamar operasi yang menerima order CPOE.
- [Fitur front office](./11-fitur-front-office.md): pendaftaran, SEP, dan antrean sebelum pasien sampai di poli.
- [Fitur keuangan](./14-fitur-keuangan.md): kasir dan klaim setelah kunjungan selesai.
- [Cara kode bekerja · CPOE + CDS](./02-cara-kerja-kode.md#cpoe-cds-resep-k09-fase-3-potongan-3-4) dan
  [CPPT, co-sign, worklist](./02-cara-kerja-kode.md#cppt-co-sign-verifikasi-dpjp-serah-terima-asesmen-worklist-fase-3-potongan-3-2b).
- [Siapa boleh apa](./01-cara-kerja-sistem.md#siapa-boleh-apa): RBAC, ABAC, dan break-the-glass.
- [Simulasi dan operasional](./18-simulasi-dan-operasional.md) dan [Peta kode](./19-peta-kode.md).
- Rencana: `docs/rencana/fase-3-klinis-rme.md`; status: `docs/PROGRESS.md`.
