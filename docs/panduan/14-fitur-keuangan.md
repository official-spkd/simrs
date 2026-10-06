# Fitur keuangan

Halaman ini menjelaskan lima layar keuangan: Kasir, Klaim & koding, Akuntansi, Pembayaran digital TPDI × BTN, dan Pembiayaan BTN. Isinya ditulis untuk orang yang perlu tahu apa yang terjadi di layar, aturan apa yang menjaga uang, dan di mana kodenya. Uang selalu `bigint` rupiah, setiap mutasi uang menghasilkan jurnal berpasangan, dan dana pasien tidak pernah transit di TPDI.

> Status 6 Okt 2026: kelima layar hanya berjalan di **mode presentasi** (data dummy fiktif, ADR-0023, `pnpm dev:demo`). Backend fase 5 (keuangan) dan fase 6 (TPDI × BTN) belum dibangun. Setiap aksi divalidasi Server Action lalu dibuang; pesan umpan balik berakhiran "(simulasi, tidak disimpan)". Di luar mode presentasi rute ini menjawab 404, dan jalur data api masih `notImplemented`.

![Alur pasien rawat jalan dari pendaftaran sampai kasir dan klaim](./gambar/diagram-alur-rawat-jalan.svg)

Layar keuangan ada di ujung perjalanan pasien. Tindakan klinis menjadi baris tagihan (charge capture), kasir menyelesaikan tagihan, koder mengirim klaim, lalu akuntansi menerima jurnalnya.

## Ringkasan layar

| Layar              | Rute                   | Peran (mode presentasi) | Komponen      | Status        |
| ------------------ | ---------------------- | ----------------------- | ------------- | ------------- |
| Kasir              | `/keuangan/kasir`      | Kasir                   | U02, U03      | demo · fase 5 |
| Klaim & koding     | `/keuangan/klaim`      | Koder klinis            | U05, U06      | demo · fase 5 |
| Akuntansi          | `/keuangan/akuntansi`  | Akuntan                 | U04, U07, U09 | demo · fase 5 |
| Pembayaran digital | `/keuangan/pembayaran` | Kasir, Akuntan          | I05, U09      | demo · fase 6 |
| Pembiayaan BTN     | `/keuangan/pembiayaan` | Akuntan, Manajemen      | U04           | demo · fase 6 |

Posisi lain yang membuka rute ini melihat pesan "Layar ini untuk posisi lain" dengan tautan **Ganti posisi**. Sumber kebenaran tabel ini adalah registri `SCREENS` di `apps/web/src/lib/screens.ts`.

Semua layar mengambil data hanya lewat satu pintu per domain: `apps/web/src/lib/server/data/keuangan.ts` (Kasir, Klaim, Akuntansi) dan `apps/web/src/lib/server/data/btn.ts` (Pembayaran, Pembiayaan). Data dummy divalidasi skema zod yang sama dengan kontrak API kelak (`packages/shared/src/schemas/keuangan.ts`, `btn.ts`). Pasien skenario Simulasi (Tn. Suryo, Tn. Hartono, Ny. Ratna) diproyeksikan dari mesin skenario; lihat [Simulasi dan operasional](./18-simulasi-dan-operasional.md).

## Kasir

![Layar Kasir: antrean tagihan di kiri, rincian tagihan dari charge capture dengan sumber tiap baris di tengah, pembagian penjamin dan panel pembayaran di kanan](./gambar/kasir.png)

| Hal      | Isi                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/keuangan/kasir` (`?pilih=<id tagihan>`)                                                                                                                     |
| Pemakai  | kasir                                                                                                                                                         |
| Komponen | U02 charge capture, U03 billing dan kasir                                                                                                                     |
| Status   | demo (mode presentasi); backend fase 5 belum dibangun                                                                                                         |
| Mockup   | `design/mockups/Kasir.dc.html`                                                                                                                                |
| Kode web | `apps/web/src/app/(staf)/keuangan/kasir/` · `apps/web/src/components/keuangan/` · `apps/web/src/lib/keuangan.ts` · `apps/web/src/lib/server/data/keuangan.ts` |
| Kode API | belum ada (rencana modul `charge-capture`, `billing`, `guarantor`, `cash-bank`; `docs/01-arsitektur.md` §2)                                                   |

**Tujuan.** Kasir menyelesaikan tagihan pasien yang sudah pulang. Baris tagihan datang dari charge capture (order, eMAR, lab, radiologi, OK, ADT) lengkap dengan sumbernya, jadi kasir tidak mengetik ulang item.

**Alur.**

1. Buka **Keuangan › Kasir**. Kolom kiri "Antrean tagihan" berisi nomor loket (`K-…`), penjamin, porsi pasien, dan status teks: Masih dirawat, Belum final, Siap dibayar, Siap ditutup, atau Lunas.
2. Pilih tagihan. Kanan atas tampil banner pasien (nama, umur, RM, alergi, penjamin, DPJP) dan kartu kunjungan dengan chip penjamin, naik kelas, SEP, dan status.
3. Periksa "Rincian tagihan". Baris dikelompokkan per kategori (kolom Kategori, Item, Jumlah, Sumber). Tekan **Buka semua kategori** untuk melihat semua baris. Baris paling bawah: **Total tarif RS**.
4. Bila ada layanan yang belum tertangkap otomatis, tekan **Tambah item manual**. Isi Nama item, Kategori, Kuantitas, Harga satuan (Rp), dan "Alasan item manual (wajib, minimal 15 karakter)", lalu **Ajukan item manual**. Baris baru berlabel "Manual" dan menampilkan alasannya.
5. Baca kartu "Pembagian penjamin": tarif RS, tarif INA-CBG, porsi penjamin, tanggungan pasien, dan sisa bayar.
6. Tekan **Finalkan tagihan**. Tombol ini aktif hanya bila pasien sudah pulang. Setelah final, tagihan terkunci.
7. Di panel "Pembayaran", pilih metode lalu penuhi syaratnya (tabel di bawah). Tombol **Selesaikan dan cetak kuitansi** aktif setelah syarat metode terpenuhi.
8. Hasilnya kotak "Lunas" dengan nomor kuitansi `KW-…` dan jam. Pilih **Cetak kuitansi** atau **Tagihan berikutnya**.
9. Bila pasien tidak membayar apa pun (mis. JKN sesuai hak kelas), tekan **Tutup kunjungan (pasien bayar Rp 0)**.
10. Di akhir shift, tekan **Tutup shift** di kepala layar, lalu **Ya, tutup shift**. Rekap kas dikirim ke akuntansi (simulasi).

| Metode                        | Syarat sebelum selesai                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| QRIS (via TPDI, acquirer BTN) | QR dinamis berlaku 10 menit. Menunggu webhook TPDI; di demo tekan **Simulasikan pembayaran diterima**                      |
| Virtual Account BTN           | VA berlaku 24 jam. Menunggu webhook TPDI; di demo tekan **Simulasikan pembayaran VA**                                      |
| Debit / kredit                | Centang "Struk EDC approved diterima"                                                                                      |
| Tunai                         | Uang diterima ≥ sisa tagihan; kembalian dihitung otomatis                                                                  |
| Transfer bank                 | Nomor referensi minimal 6 karakter dan sudah dicocokkan dengan mutasi BTN                                                  |
| Cicilan BTN                   | Pilih tenor 3, 6, atau 12 bulan, **Ajukan pembiayaan ke BTN**, lalu empat langkah simulasi sampai dana cair ke rekening RS |

Contoh data dummy: Ny. Endang Wijaya, `INV-2610-02217`, rawat inap pneumonia 5 hari. Total tarif RS Rp 17.217.500. BPJS hak kelas 2 menanggung tarif INA-CBG. Pasien naik kelas 1 atas permintaan, jadi menanggung selisih Rp 1.250.400 (tarif kelas 1 Rp 7.863.200 − kelas 2 Rp 6.612.800, tarif simulasi). Deposit VA Rp 1.000.000 sudah masuk, jadi sisa bayar Rp 250.400. Bayar QRIS menghasilkan kuitansi `KW-2610-02217`.

![Formulir Tambah item manual: nama, kategori, kuantitas, dan harga sudah terisi, tetapi Ajukan item manual masih nonaktif karena alasan belum ditulis](./gambar/kasir--item-manual.png)

**Gerbang keselamatan dan aturan bisnis.**

- Total tagihan = jumlah baris (bigint). Baris = kuantitas × harga satuan. E2E menjumlahkan atribut `data-line-amount` dan membandingkannya dengan `data-total-amount`.
- Item manual wajib: nama ≥ 3 huruf, kuantitas bilangan bulat 1–99 ("2.5" ditolak, bukan dipotong), harga Rp 1 sampai Rp 100.000.000, dan alasan ≥ 15 karakter. Aturan yang sama (`manualLineProblems`) dipakai tombol dan Server Action. Alasan tercatat di jejak audit (versi produksi).
- Item manual dan finalisasi hanya untuk tagihan berjalan. Tagihan final terkunci; koreksi lewat unit asal. Tagihan lunas tidak bisa diubah.
- Finalisasi dan pembayaran menunggu pasien pulang.
- Server tidak memercayai nominal dari klien. `kasirAction` membaca ulang tagihan, menghitung sisa dari baris + item manual (`invoiceSettlement`), dan menolak nominal yang beda ("Nominal tidak sesuai sisa tagihan").
- Pembagian penjamin dihitung, bukan diketik. BPJS membayar tarif INA-CBG; pasien hanya menanggung selisih naik kelas. Asuransi membayar sampai plafon; ekses ditagihkan ke pasien. Umum membayar seluruhnya. Tarif RS = porsi penjamin + porsi pasien + selisih yang ditanggung RS.
- Tagihan pasien skenario hanya maju lewat tugas skenario, bukan aksi lokal kasir.
- Jurnal otomatis tertulis di panel: Kas/Bank BTN ••••4417 (D) · uang muka/piutang pasien (K). Piutang BPJS tetap terbuka sampai klaim dibayar.
- Dana QRIS, VA, dan EDC masuk langsung ke rekening operasional RS di BTN, bukan ke TPDI.

**Rencana backend.** Izin terencana `billing.write`. Fase 5 membangun charge capture dari event domain (`modules/charge-capture/consumers/`, potongan 5.4), penjaminan (5.6), serta kasir + shift (5.7). Kanal VA/QRIS/EDC terintegrasi dan cicilan masuk di fase 6 (`docs/rencana/fase-5-keuangan.md`, `fase-6-pembayaran-tpdi-btn.md`).

## Klaim & koding

![Layar Klaim dan koding: indikator klaim di atas, daftar klaim per status di kiri, tabel diagnosis ICD-10 dan prosedur ICD-9-CM, hasil grouper, dan kelengkapan berkas di kanan](./gambar/klaim.png)

| Hal      | Isi                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/keuangan/klaim` (`?status=<status>&pilih=<id klaim>`)                                                                           |
| Pemakai  | koder                                                                                                                             |
| Komponen | U05 klaim BPJS dan INA-CBG, U06 koding klinis                                                                                     |
| Status   | demo (mode presentasi); backend fase 5 belum dibangun                                                                             |
| Mockup   | `design/mockups/Klaim.dc.html`                                                                                                    |
| Kode web | `apps/web/src/app/(staf)/keuangan/klaim/` · `apps/web/src/components/keuangan/claim-*.tsx` · `apps/web/src/lib/keuangan-klaim.ts` |
| Kode API | belum ada (rencana modul `claims`, `coding`; konektor E-Klaim di worker)                                                          |

**Tujuan.** Koder memeriksa kode diagnosis dan prosedur, menjalankan grouper INA-CBG, melengkapi berkas, lalu mengirim klaim ke E-Klaim. Koder juga menanggapi klaim pending dan dispute dari verifikator BPJS.

**Alur.**

1. Buka **Keuangan › Klaim & koding**. Wilayah "Indikator klaim" berisi Klaim bulan ini (1.284), Nilai diajukan, Rata-rata koding, Pending verifikator, dan Dispute.
2. Saring daftar per status: Perlu koding, Terkirim, Pending BPJS, Layak bayar, Dispute, Dibayar.
3. Pilih berkas. Kepala berkas memuat pasien, SEP, kelas, DPJP, dan status resume.
4. Periksa tabel "Diagnosis ICD-10" (peran utama, sekunder, perlu bukti, sementara) dan "Prosedur ICD-9-CM".
5. Bila ada catatan "Saran koding", pilih tombol terima kode saran (mis. **Terima J13**) atau **Kirim query ke DPJP**.
6. Baca "Hasil grouper INA-CBG (simulasi)": kode CBG, tarif kelas, perbandingan tarif RS vs INA-CBG, dan special CMG.
7. Di "Kelengkapan berkas", centang berkas yang sudah ada.
8. Kirim dengan tombol sesuai status: **Final dan kirim E-Klaim** (perlu koding), **Kirim tanggapan ke verifikator** (pending), atau **Ajukan penyelesaian dispute** (dispute). Hasilnya "Terkirim ke E-Klaim HH.MM" dan berkas terkunci.

Contoh data dummy: klaim Ny. Endang berisi J18.9 (utama), E11.9 (sekunder), N17.9 (perlu bukti), prosedur 89.65 dan 99.18. Grouper awal J-4-15-II kelas 2 Rp 6.612.800 (estimasi). Berkas 6/7 lengkap; yang kurang "Bukti klinis N17.9 di CPPT". Saran koding: kultur sputum mendukung J13. Setelah **Terima J13** dan bukti N17.9 dicentang, grouper naik ke J-4-15-III Rp 9.104.300 (naik Rp 2.491.500). Kode CBG di data dummy web bergaya INA-CBG dengan tarif berlabel simulasi; mock E-Klaim di `apps/mock` memakai kode `SIM-*`.

**Gerbang keselamatan dan aturan bisnis.**

- Tombol kirim nonaktif sampai semua berkas lengkap. Alasannya tertulis, mis. "Belum bisa dikirim: lengkapi 1 berkas (…)".
- Grouping ditahan bila pasien masih dirawat, resume medis belum final ber-TTE, atau kode utama tidak sesuai bukti klinis.
- Skenario IGD (Tn. Hartono): sistem menandai I20.0 (angina) yang tidak cocok dengan troponin dan EKG. Pilihannya ikuti saran "Kembali ke I21.4", atau "Kirim query ke DPJP (klaim ditahan)" dengan alasan tertulis (minimal 10 karakter di server).
- Kode hanya dari daftar contoh seed (`ICD10_NAME`, `ICD9_NAME` di fixture). Kode di luar daftar membuat fixture gagal dibangun.
- Tarif RS vs INA-CBG dibandingkan dengan bigint (`claimRatio`), termasuk persen dan selisih.
- Setelah terkirim, berkas dikunci untuk verifikasi BPJS dan jurnal piutang BPJS terbentuk di Akuntansi.

**Rencana backend.** Izin terencana `claim.write`. Fase 5 membangun koding + grouping (potongan 5.5), klaim final → kirim → status → dibayar (5.10), konektor E-Klaim lewat outbox (5.1b), dan mock E-Klaim lengkap (5.1c).

## Akuntansi

![Layar Akuntansi: indikator keuangan, tabel jurnal otomatis seimbang dengan saringan sumber, umur piutang dan rekonsiliasi bank di kanan, tombol tutup periode di atas](./gambar/akuntansi.png)

| Hal      | Isi                                                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/keuangan/akuntansi`                                                                                                                                                                                          |
| Pemakai  | akuntan                                                                                                                                                                                                        |
| Komponen | U04 penjaminan dan piutang, U07 akuntansi, U09 kas dan bank                                                                                                                                                    |
| Status   | demo (mode presentasi); backend fase 5 belum dibangun                                                                                                                                                          |
| Mockup   | `design/mockups/Akuntansi.dc.html`                                                                                                                                                                             |
| Kode web | `apps/web/src/app/(staf)/keuangan/akuntansi/` · `apps/web/src/components/keuangan/{accounting-workspace,journal-table,period-close,bank-recon-card,aging-card}.tsx` · `apps/web/src/lib/keuangan-akuntansi.ts` |
| Kode API | belum ada (rencana modul `accounting`, `cash-bank`)                                                                                                                                                            |

**Tujuan.** Akuntan memantau jurnal otomatis dari kasir, klaim, TPDI/BTN, dan logistik. Akuntan memetakan akun yang belum lengkap, memadankan mutasi bank, lalu menutup periode.

**Alur.**

1. Buka **Keuangan › Akuntansi**. Wilayah "Indikator keuangan": Pendapatan MTD, Piutang BPJS, Kas dan bank, Utang jatuh tempo 7 hari.
2. Baca "Jurnal otomatis periode berjalan". Tiap jurnal menampilkan baris debit/kredit dan totalnya. Saring lewat tombol Sumber: Semua, Kasir, Klaim, TPDI/BTN, Logistik.
3. Status jurnal tertulis: Terposting, Menunggu rekonsiliasi, Menunggu penyetuju kedua, atau Perlu pemetaan akun.
4. Jurnal `JU-26100417` (penurunan nilai piutang klaim dispute) belum punya akun lawan. Pilih akun di "Akun lawan (kredit)", mis. `1-1390` Cadangan kerugian penurunan nilai — piutang BPJS. Pesannya: "siap diposting setelah disetujui penyetuju kedua".
5. Di samping, baca "Umur piutang" (Rp juta) dan "Rekonsiliasi bank otomatis". Rekening BTN penampungan klaim ••••9021 punya 2 transfer BPJS yang belum dipadankan; tekan **Padankan 2 mutasi**.
6. Tekan **Tutup periode Oktober**. Dialog "Tutup periode Oktober 2026?" menampilkan syarat sebagai daftar teks. Tekan **Tutup periode** bila semua syarat terpenuhi, atau **Batal**.
7. Setelah ditutup, banner menyatakan periode ditutup dan jurnal dikunci. **Ekspor laporan** mengekspor jurnal dan neraca saldo (simulasi).

**Gerbang keselamatan dan aturan bisnis.**

- Setiap jurnal seimbang: total debit = total kredit, satu sisi per baris. E2E membandingkan `data-total-debit` dan `data-total-credit`; tes unit memeriksanya di setiap langkah tiga skenario.
- Jurnal tanpa akun lawan tidak bisa diposting. Pemetaan butuh penyetuju kedua (pembuat ≠ penyetuju).
- Tutup periode hanya bila semua jurnal terpetakan dan rekonsiliasi bank tanpa selisih. Server memeriksa syarat terhadap papan versi server (`periodCloseCheck`); klien hanya mengirim id jurnal dan rekening, bukan hitungan.
- Jurnal terposting tidak bisa diedit, hanya dibalik. Periode tertutup dikunci; membuka ulang butuh direktur keuangan.
- Porsi umur piutang dihitung dengan bigint dan selalu berjumlah 100%.

**Rencana backend.** Izin terencana `accounting.write`. Fase 5 membangun inti buku besar dengan satu aturan posting per sumber di `modules/accounting/posting-rules/<sumber>.ts` (potongan 5.3), pencocok mutasi bank di `modules/cash-bank/matchers/` (5.8), serta laporan dan tutup periode (5.11).

## Pembayaran digital TPDI × BTN

![Layar Pembayaran digital: diagram alur dana dari pasien lewat kanal BTN langsung ke rekening operasional RS, TPDI hanya orkestrasi, indikator pembayaran, dan tab Transaksi, Rekonsiliasi, Refund, Konfigurasi](./gambar/pembayaran.png)

| Hal      | Isi                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/keuangan/pembayaran`                                                                                                                              |
| Pemakai  | kasir, akuntan                                                                                                                                      |
| Komponen | I05 konektor layanan pendukung (bank, TPDI), U09 kas dan bank                                                                                       |
| Status   | demo (mode presentasi); backend fase 6 belum dibangun                                                                                               |
| Mockup   | `design/mockups/PembayaranBTN.dc.html`                                                                                                              |
| Kode web | `apps/web/src/app/(staf)/keuangan/pembayaran/` · `apps/web/src/components/btn/` · `apps/web/src/lib/btn.ts` · `apps/web/src/lib/server/data/btn.ts` |
| Kode API | belum ada (rencana modul `webhooks`, `payments`, `reconciliation`)                                                                                  |

**Tujuan.** Layar ini memantau pembayaran VA, QRIS, dan EDC lewat TPDI × BTN, merekonsiliasi tiga sumber, mengelola refund, dan mengatur kanal. Layar ini juga menunjukkan bahwa TPDI tidak menampung dana (ADR-0005).

![Alur dana: pasien membayar lewat VA atau QRIS BTN, dana langsung masuk rekening RS di BTN, TPDI hanya membuat tagihan dan mengirim webhook bertanda tangan HMAC](./gambar/diagram-pembayaran-btn.svg)

**Alur.**

1. Buka **Keuangan › Pembayaran digital**. Bagian "Alur dana" menunjukkan Pasien → Kanal BTN (VA BTN, QRIS · acquirer BTN, EDC BTN) → Rekening operasional RS BTN ••••4417. Kotak "TPDI · orkestrasi" berlabel "tidak menampung dana".
2. Baris status menampilkan koneksi TPDI (webhook terakhir, latensi p95), API BTN mutasi H2H, dan mode SANDBOX atau PRODUKSI.
3. Wilayah "Indikator pembayaran": Penerimaan digital hari ini, Transaksi berhasil, Menunggu bayar, Pengecualian rekonsiliasi.
4. Tab **Transaksi**: pilih baris di "Daftar transaksi". "Detail transaksi" menampilkan jejak status, webhook TPDI yang diterima, dan payload ringkas.
5. Untuk VA/QRIS yang menunggu, tekan **Simulasikan pembayaran (webhook TPDI)**. Hasilnya "Webhook TPDI diterima, tagihan lunas" dan tanda "✓ HMAC valid". Contoh: Ny. Endang `INV-2610-02217 · Rp 250.400`.
6. Contoh callback ganda: transaksi Tn. Sutan Batubara menampilkan event kedua sebagai "duplikat · diabaikan" dan "Dikreditkan sekali per event id: Rp 5.000.000".
7. Tab **Rekonsiliasi** (lencana "3 selisih"): tabel "Rekonsiliasi 3 arah · hari ini" membandingkan Kasir SIM RS, Laporan TPDI, dan Mutasi BTN. **Jalankan rekonsiliasi** menarik ulang data. Untuk tiap pengecualian, pilih tindakan, isi "Catatan penyelesaian (wajib)", lalu **Terapkan**. Baris berubah menjadi "Ditangani".
8. Tab **Refund**: lima tahap Diajukan → Supervisor kasir → Manajer keuangan → Transfer BTN → Dana kembali. Tombolnya **Ajukan refund**, **Setujui sebagai supervisor kasir**, **Setujui sebagai manajer keuangan**, dan **Simulasikan dana diterima pasien**.
9. Tab **Konfigurasi**: merchant dan rekening tujuan, kanal aktif, masa berlaku VA (12/24/48 jam) dan QRIS (5/10/15 menit), mode koneksi TPDI (Sandbox/Produksi), serta webhook TPDI → SIM RS (HMAC-SHA256, timestamp ditolak bila selisih > 5 menit). **Rotasi secret** meminta konfirmasi **Ya, rotasi sekarang**. Simpan dengan **Simpan konfigurasi**.

Contoh tindakan pengecualian dari data dummy: "Tandai lunas di kasir (TPDI + BTN cocok)", "Minta TPDI kirim ulang webhook", "Catat Rp 14.000 sebagai beban MDR QRIS", dan "Catat sebagai titipan tak teridentifikasi".

**Gerbang keselamatan dan aturan bisnis.**

- Dana tidak transit di TPDI. Rekening tujuan semua transaksi adalah rekening operasional RS di BTN; tes fixture memeriksanya. Fee TPDI ditagih terpisah, tidak dipotong dari dana.
- Webhook idempoten: hanya event `payment.paid` dengan tanda tangan sah yang dikreditkan, dan satu event id hanya dihitung sekali (`creditedAmount`).
- Pelunasan simulasi hanya untuk VA/QRIS yang masih menunggu dan bukan pasien skenario. Server memeriksa ulang (`canSimulatePay`).
- Pengecualian rekonsiliasi wajib tindakan dan catatan minimal 10 karakter. Selisih nominal tidak menjadi lunas otomatis.
- Refund: nominal tidak boleh melebihi kelebihan deposit atau nominal transaksi asal, alasan wajib, keterangan minimal 15 karakter. Dua penyetuju berbeda tingkat. Tahap tidak boleh mundur dari tahap di server.
- Konfigurasi menolak bila semua kanal dimatikan ("Minimal satu kanal pembayaran harus aktif").
- Nominal disimpan tak bertanda (bigint); hanya penyesuaian rekonsiliasi yang boleh negatif.

**Rencana backend.** Izin terencana `payment.write`. Fase 6 membangun penerima webhook di `modules/webhooks` (`POST /api/v1/webhooks/tpdi/:tenantCode`, raw body, verifikasi HMAC, simpan `inbound_events`, jawab 2xx), payment intent di `modules/payments`, dan rekonsiliasi 3 arah di `modules/reconciliation`. Fungsi verifikasi tanda tangan sudah ada: `verifyTpdiWebhook` di `packages/shared/src/integrations/tpdi-signature.ts`.

## Pembiayaan BTN

![Layar Pembiayaan BTN: indikator fasilitas, pool klaim BPJS layak bayar untuk diajukan pencairan, pencairan berjalan, dan alur dana pelunasan dari rekening penampungan](./gambar/pembiayaan.png)

| Hal      | Isi                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/keuangan/pembiayaan` (`?tab=cicilan` membuka tab B)                                                                                           |
| Pemakai  | akuntan, manajemen                                                                                                                              |
| Komponen | U04 penjaminan dan piutang                                                                                                                      |
| Status   | demo (mode presentasi); backend fase 6 belum dibangun                                                                                           |
| Mockup   | `design/mockups/PembiayaanBTN.dc.html`                                                                                                          |
| Kode web | `apps/web/src/app/(staf)/keuangan/pembiayaan/` · `apps/web/src/components/btn/{piutang-*,cicilan-*}.tsx` · `apps/web/src/lib/btn-pembiayaan.ts` |
| Kode API | belum ada (rencana modul `financing`)                                                                                                           |

**Tujuan.** RS mencairkan dana lebih awal atas piutang klaim BPJS yang layak bayar (supply chain financing), dan memantau cicilan biaya pasien yang diputuskan BTN. Pembiayaan adalah produk BTN; SIM RS hanya meneruskan data dan status.

**Alur.**

1. Buka **Keuangan › Pembiayaan BTN**. Judul "Pembiayaan BTN · fasilitas kesehatan (simulasi)" dengan nomor perjanjian fiktif.
2. Tab **A · Pembiayaan piutang BPJS**. Wilayah "Indikator fasilitas": Plafon fasilitas (Rp 15,00 M), Outstanding, Sisa plafon, Klaim layak bayar eligible, Rata-rata hari cair BPJS, Margin berjalan.
3. Di "Pool klaim BPJS", centang batch layak bayar (atau **Pilih semua layak bayar**), lalu **Ajukan pencairan**. Lanjutkan **Simulasi: BTN menyetujui** dan **Simulasi: BTN mencairkan dana**. Dana masuk rekening operasional.
4. Panel "Alur dana pelunasan": BPJS membayar ke rekening penampungan ••••9021, pokok + margin didebit otomatis ke BTN, sisanya diteruskan ke operasional ••••4417. Tekan **BPJS membayar klaim** untuk menyimulasikan.
5. Tab **B · Cicilan biaya pasien**. Pilih pengajuan di "Daftar pengajuan cicilan". "Detail pengajuan" menampilkan nilai pembiayaan, estimasi angsuran, dan timeline.
6. Majukan tahap: **Simulasi: teruskan ke verifikasi BTN**, **Simulasi: BTN menyetujui**, **Simulasi: pasien tanda tangan akad (TTE)**, **Simulasi: BTN mencairkan dana**. Contoh: Ny. Wulan Sari Dewi berakhir "✓ BTN mencairkan Rp 14.200.000".
7. Untuk menolak, tekan **Tolak**, isi "Alasan penolakan dari BTN (wajib)", lalu **Konfirmasi tolak**.

**Gerbang keselamatan dan aturan bisnis.**

- Advance = nilai klaim × 90%, dibulatkan ke bawah. Pokok tidak boleh melebihi advance maupun sisa plafon.
- Hanya batch layak bayar yang belum dijaminkan yang bisa diajukan. Server memeriksa ulang batch dan pokok (`drawdownRequestError`).
- Margin 8% per tahun dihitung harian sejak cair, dibulatkan ke Rp 100.
- Pelunasan otomatis: dana BPJS − (pokok + margin) = sisa ke operasional. Contoh skenario elektif Ny. Ratna: klaim Rp 7.140.000, cair Rp 6.426.000, pelunasan Rp 6.455.600, sisa Rp 684.400.
- Cicilan pasien: alur Diajukan → Verifikasi BTN → Disetujui → Akad TTE → Dicairkan. Tahap tidak boleh mundur. Penolakan hanya sebelum BTN memutuskan (Diajukan atau Verifikasi) dan wajib alasan minimal 10 karakter.
- Estimasi angsuran memakai margin flat 11% per tahun, sama dengan pilihan Cicilan BTN di Kasir (dijaga tes).
- RS menerima pelunasan penuh; angsuran dibayar pasien ke BTN.

**Rencana backend.** Izin terencana `financing.write`. Fase 6 membangun `modules/financing`: pool piutang dan pencairan dibatasi plafon dan advance rate, pelunasan otomatis saat BPJS membayar dengan jurnal, serta mesin status cicilan. Pesan ke BTN dikirim lewat outbox.

## Tes yang menjaga layar ini

| Tes                                                     | Yang dijaga                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/demo/keuangan.spec.ts`                    | Kasir: total = jumlah baris, bayar QRIS sampai kuitansi, item manual ditahan tanpa alasan, posisi lain ditolak. Klaim: tabel kode, grouper, saran J13, kirim. Akuntansi: jurnal seimbang, dialog tutup periode menahan sampai syarat terpenuhi |
| `apps/web/e2e/demo/btn.spec.ts`                         | Pembayaran: pelunasan simulasi + HMAC, callback ganda diabaikan, pengecualian wajib catatan. Pembiayaan: pencairan piutang, lima tahap cicilan, penolakan beralasan                                                                            |
| `apps/web/src/lib/keuangan.test.ts`                     | Total = baris, pembagian penjamin, gerbang item manual, gerbang Server Action kasir, kuantitas bulat, kode klaim hanya dari seed                                                                                                               |
| `apps/web/src/lib/keuangan-klaim.test.ts`               | Klaim lolos kontrak, J13 + bukti N17.9 → J-4-15-III, grouping ditahan, gerbang kirim                                                                                                                                                           |
| `apps/web/src/lib/keuangan-akuntansi.test.ts`           | Jurnal seimbang, umur piutang 100%, syarat tutup periode diperiksa terhadap papan server                                                                                                                                                       |
| `apps/web/src/lib/keuangan-skenario.test.ts`            | Proyeksi tiga skenario ke tiga papan: tagihan = charge capture, jurnal seimbang di setiap langkah                                                                                                                                              |
| `apps/web/src/lib/btn.test.ts`                          | Dana ke rekening RS, idempotensi webhook, rekonsiliasi 3 arah, refund berjenjang                                                                                                                                                               |
| `apps/web/src/lib/btn-pembiayaan.test.ts`               | Aritmetika advance/margin/pelunasan (bigint), pemeriksaan server pencairan, alur cicilan                                                                                                                                                       |
| `apps/web/src/lib/btn-skenario.test.ts`                 | Deposit dan pembiayaan Ny. Ratna, webhook ganda tidak dobel, angka "hari ini"                                                                                                                                                                  |
| `packages/shared/src/integrations/integrations.test.ts` | Tanda tangan HMAC TPDI dan batas umur timestamp                                                                                                                                                                                                |

## Lihat juga

- [Cara sistem bekerja: integrasi lewat outbox](./01-cara-kerja-sistem.md#integrasi-lewat-outbox)
- [Cara kode bekerja: mode presentasi dan data dummy](./02-cara-kerja-kode.md#mode-presentasi-dan-data-dummy-adr-0023)
- [Fitur integrasi](./15-fitur-integrasi.md)
- [Fitur klinis](./12-fitur-klinis.md) dan [Fitur penunjang](./13-fitur-penunjang.md), sumber charge capture
- [Simulasi dan operasional](./18-simulasi-dan-operasional.md)
- [Peta kode](./19-peta-kode.md)
- Dokumen desain: `docs/07-pembayaran-btn-tpdi.md`, `docs/adr/0005-tpdi-non-custodial-btn.md`, `docs/rencana/fase-5-keuangan.md`, `docs/rencana/fase-6-pembayaran-tpdi-btn.md`
