# Naskah presentasi SIM RS (mode presentasi)

Semua nama, nomor, dan angka di layar **fiktif** (lencana "Mode presentasi · data fiktif" selalu tampil). Nama RS
diambil dari tenant (RSCM); kode Kemenkes/BPJS/SATUSEHAT, pasien, dan staf adalah buatan.

## Persiapan (H-1 dan 30 menit sebelum tampil)

1. `pnpm with-pg pnpm db:seed` (sekali, bila database baru) lalu `pnpm with-pg pnpm db:akun-presentasi` (16 akun per
   posisi; ulangi bila kredensial perlu diganti).
2. `pnpm demo` — build produksi lalu menjalankan semua layanan (tanpa jeda kompilasi saat tampil). Untuk latihan
   cepat boleh `pnpm dev:demo`.
3. `pnpm demo:cek` — semua butir harus ✓.
4. Browser: jendela penuh, zoom 100%, resolusi proyektor ≥ 1366×768 (layar anjungan/TV/ponsel otomatis diskalakan).
   Tutup notifikasi sistem. Siapkan tab kedua untuk layar TV antrean bila ingin dua layar.
5. Masuk sebagai **Manajemen** (dr. Satria Wibisana) → buka **Simulasi pasien** → pilih skenario → **Mulai ulang**.
   Panel panduan (pil hijau di kanan bawah) menunjukkan langkah berikutnya dan bisa membuka layar posisi yang tepat
   dengan berganti akun otomatis.

Cadangan bila waktu sempit: di layar Simulasi, **Lompat ke tahap** mengerjakan tugas sebelumnya dengan pilihan
bawaan; **Putar otomatis** menjalankan seluruh skenario (±2 detik per tugas).

## Versi direksi (±20 menit)

| Menit | Adegan                                         | Akun / layar                                                         | Pesan utama                                                                                                                           |
| ----- | ---------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0–3   | Pembuka: kondisi RS hari ini                   | Manajemen → **Dasbor eksekutif**                                     | KPI hari ini/bulan/YTD dihitung dari data operasional; "Perlu keputusan direksi" bisa ditindaklanjuti langsung                        |
| 3–10  | Perjalanan pasien rawat jalan BPJS (Tn. Suryo) | **Simulasi pasien** → Putar otomatis, berhenti di CDS                | Tidak ada ketik ulang dari anjungan sampai klaim; antrean BPJS task 1–7 dan SATUSEHAT terkirim otomatis; CDS mencegah resep berbahaya |
| 10–13 | Ringkasan kunjungan                            | Ringkasan Simulasi                                                   | Lama layanan, waktu tunggu per tahap, tarif tertangkap otomatis (Rp 806.000), pasien bayar Rp 0                                       |
| 13–17 | Pembayaran & pembiayaan BTN                    | Skenario **Elektif · TPDI × BTN** → Lompat ke tahap Kasir/Pembiayaan | Dana pasien langsung ke rekening RS di BTN; cicilan pasien & pembiayaan piutang BPJS mempercepat arus kas                             |
| 17–20 | Tata kelola & keamanan                         | **Integrasi** (Admin), **Mutu & keselamatan** (Auditor mutu)         | Semua akses tercatat; gangguan sistem luar tidak menghentikan layanan; indikator mutu nasional terpantau                              |

## Versi klien / tim RS (±45 menit)

| Menit | Adegan                         | Akun / layar                                                                                                       | Yang ditunjukkan                                                                                                                            |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–5   | Masuk & posisi                 | /masuk → pilih akun                                                                                                | Satu klik per posisi di mode presentasi; produksi memakai NIP + sandi + kode verifikasi; menu mengikuti posisi                              |
| 5–10  | Anjungan & pendaftaran         | Petugas pendaftaran → **Anjungan**, **Pendaftaran**, **Display antrean**, **Jadwal dokter**                        | Kode booking → tiket; cek kepesertaan & SEP; kuota JKN/non-JKN; sinkron HFIS                                                                |
| 10–18 | Poli & order                   | Perawat → **Pemeriksaan poli** (tanda vital); Dokter → SOAP + **CPOE**                                             | Nilai di luar batas ditandai; order set; CDS memblokir (alergi, interaksi, riwayat hipoglikemia) dengan alasan wajib bila di-override       |
| 18–24 | Laboratorium & farmasi         | Analis lab → **Laboratorium**; Apoteker → **Farmasi**                                                              | Hasil analyzer, validasi, nilai kritis + read-back 30 menit; telaah resep, high-alert double check                                          |
| 24–28 | Kasir & klaim                  | Kasir → **Kasir**; Koder → **Klaim & koding**                                                                      | Tagihan dari charge capture (sumber tiap baris); koding ICD dari resume; grouper; status klaim                                              |
| 28–38 | IGD → rawat inap (Tn. Hartono) | Skenario **IGD → rawat inap**: **IGD**, **Tempat tidur**, **Rawat inap**, **Resume medis**, tablet **Persetujuan** | Triase dengan saran sistem; nilai kritis kalium; alokasi bed; eMAR terkunci sampai pindai gelang; resume terhimpun otomatis dan dikunci TTE |
| 38–42 | Kamar operasi & keuangan       | **Kamar operasi** (checklist WHO), **Pembayaran digital**, **Akuntansi**                                           | Insisi terkunci sampai time-out; rekonsiliasi 3 arah; jurnal otomatis seimbang                                                              |
| 42–45 | Aplikasi & penutup             | **Pratinjau aplikasi pasien/dokter**, **Dasbor eksekutif**                                                         | Pasien melihat antrean, hasil, obat; dokter menerima nilai kritis di ponsel                                                                 |

## Pertanyaan yang sering muncul

- **Apakah data ini nyata?** Tidak. Seluruh data fiktif dan tidak tersimpan ke rekam medis; lencana di setiap layar.
- **Apakah sudah tersambung BPJS/SATUSEHAT?** Integrasi berjalan ke mock (tiruan) dengan kontrak yang sama; koneksi
  produksi dilakukan saat implementasi.
- **Bagaimana keamanan login?** Produksi: NIP/email + sandi + kode verifikasi (TOTP), sesi dicabut otomatis saat
  idle, setiap akses tercatat di jejak audit berantai. "Masuk cepat" hanya ada di mode presentasi lokal.
- **Apa yang terjadi bila sistem luar mati?** Pesan antre di outbox dan dikirim ulang otomatis; layanan klinis tetap
  berjalan (lihat layar Integrasi, tombol uji downtime).
