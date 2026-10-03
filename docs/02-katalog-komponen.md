> Disalin dari dokumen "Blueprint SIM RS: Katalog Komponen" (3 Okt 2026). Sumber kebenaran untuk kode komponen dan dependensi. Tambahan pasca-dokumen: modul `payments` dan `financing` (lihat 07-pembayaran-btn-tpdi.md).

# Blueprint SIM RS: Katalog Komponen

2026-10-03 · Muhammad Reynandio Wira Prathama

## Keputusan tahap komponen

SIM RS ini adalah **platform multi-RS yang dijual sebagai SaaS dan dipasang secara hibrida**. Dokumen ini mendaftar 81 komponen dalam 7 lapisan. Ketujuh lapisan dirancang sekarang; lapisan 1–5 dibangun lebih dulu sebagai MVP, sedangkan lapisan 6–7 menyusul tanpa membongkar fondasi.

| Topik | Keputusan | Konsekuensi desain |
|---|---|---|
| Target pasar | Multi-RS / SaaS vendor | Multi-tenant sejak hari pertama; modul dan aturan dapat diaktifkan per RS |
| Deployment | Hibrida | Server edge di RS untuk operasional dan mode downtime; cloud untuk integrasi, portal, backup, dan analitik. Memenuhi syarat penyimpanan tiga lokasi MRMIK 5 |
| MVP (rilis 1) | Lapisan 1–5: platform inti, front office, klinis RME, penunjang, keuangan | Fokus kepatuhan RME, BPJS, SATUSEHAT, dan arus kas RS |
| Setelah MVP | Lapisan 6–7: back office dan tata kelola, portal, dasbor, data | Dirancang sekarang agar data model tidak berubah saat ditambahkan |
| Kanal | Web staf, anjungan dan display, aplikasi pasien, aplikasi dokter dan perawat | Satu backend API untuk empat kanal |
| Modul RS tersier | Pendidikan klinik, PPRA, onkologi, costing dan case-mix | Disiapkan sebagai modul yang dapat dinonaktifkan per RS |
| Integrasi alat medis | Alat lab (LIS), PACS radiologi, alat ICU | Dirancang sekarang, dibangun setelah MVP (interpretasi dari jawaban Anda; mohon konfirmasi) |

Kode komponen memakai awalan per lapisan: **P** platform, **F** front office, **K** klinis, **S** penunjang, **U** keuangan, **B** back office, **I** integrasi dan data. Kolom Fase berisi MVP atau Lanjut.

## Peta komponen

Empat kanal di atas memakai satu backend. Lapisan 2–6 adalah domain bisnis RS, lapisan 7 menghubungkan semuanya ke sistem nasional, alat, dan analitik, dan semuanya berdiri di atas platform inti.

## Lapisan 1: Platform inti (13 komponen)

Lapisan ini tidak terlihat oleh pengguna klinis, tetapi menentukan apakah 21 EP kunci MRMIK terpenuhi otomatis di semua modul. Semua komponen di sini masuk MVP.

| Kode | Komponen | Fungsi inti | Fase | Bergantung pada |
|---|---|---|---|---|
| P01 | Tenant dan struktur faskes | Data RS (tenant), cabang, instalasi, unit, poli, ruang, kamar, bed, kelas; pengaturan per RS | MVP | — |
| P02 | Identitas dan login (IAM) | Akun per orang, SSO, MFA, login cepat di unit sibuk (PIN, kartu, sidik jari), sesi berbatas waktu, kebijakan password | MVP | P01 |
| P03 | Otorisasi | RBAC dan ABAC: peran, unit, relasi dengan pasien (DPJP, perawat ruangan), hak tulis per formulir, break-the-glass dengan alasan | MVP | P02 |
| P04 | Audit trail dan provenance | Log append-only untuk baca, ubah, hapus, cetak, ekspor; versi setiap entri; laporan anomali akses | MVP | P02, P03 |
| P05 | Master Patient Index | Satu identitas pasien lintas kunjungan dan cabang; NIK, nomor RM, IHS number, no. peserta BPJS; deteksi duplikat dan merge berjejak | MVP | P01, I05 (Dukcapil), I02 (SATUSEHAT) |
| P06 | Master data dan terminologi | ICD-10, ICD-9-CM, LOINC, SNOMED CT, KFA, wilayah, agama, pekerjaan, daftar singkatan baku dan terlarang; versi per terminologi | MVP | — |
| P07 | Form engine berversi | Definisi formulir klinis sebagai data (field, validasi, skor otomatis, logika tampil), versi tersimpan per entri, pustaka formulir standar | MVP | P06 |
| P08 | Dokumen dan tanda tangan elektronik | Generator PDF, TTE tersertifikasi, QR verifikasi, penyimpanan dokumen dan lampiran (foto, hasil scan) | MVP | P02, I05 |
| P09 | Notifikasi dan worklist | Notifikasi in-app, push, WhatsApp, SMS, email; antrean tugas per pengguna (hasil kritis, co-sign, verifikasi) | MVP | P02 |
| P10 | Konfigurasi tenant | Modul aktif per RS, feature flag, aturan bisnis (penomoran, jam layanan, batas waktu resume), tanpa rilis ulang | MVP | P01 |
| P11 | Penjadwal pekerjaan | Job terjadwal: kirim laporan, sinkronisasi master, backup, pengingat | MVP | — |
| P12 | Cetak dan template | Template cetak per RS (kop, label pasien, gelang, label obat, kuitansi) dengan desainer template | MVP | P08 |
| P13 | Edge sync dan mode downtime | Server edge di RS menyimpan replika kerja; sinkronisasi dua arah ke cloud; mode baca saja dan entri susulan saat koneksi atau sistem terganggu | MVP | Semua di atas |

## Lapisan 2: Front office (8 komponen)

Pintu masuk pasien. Hampir semua RS menilai vendor dari kelancaran lapisan ini pada minggu pertama go-live, karena antrean panjang langsung terlihat.

| Kode | Komponen | Fungsi inti | Fase | Bergantung pada |
|---|---|---|---|---|
| F01 | Jadwal praktik | Jadwal dokter per poli, kuota, cuti dan pengganti; sinkron dengan HFIS BPJS | MVP | P01, I03 |
| F02 | Booking dan janji temu | Booking dari loket, telepon, aplikasi pasien, Mobile JKN, dan WhatsApp; kode booking; pengingat | MVP | F01, P05 |
| F03 | Registrasi dan admisi | Pendaftaran rawat jalan, IGD, rawat inap; pasien baru dan lama; penanggung jawab; pilihan penjamin; persetujuan umum | MVP | P05, F06 |
| F04 | Antrean | Antrean loket, poli, farmasi, penunjang, kasir; display dan suara panggilan; task ID Antrean BPJS 1–7; estimasi waktu tunggu | MVP | F03, I03 |
| F05 | Anjungan mandiri | Check-in booking, registrasi mandiri, cetak tiket dan SEP, verifikasi sidik jari atau wajah BPJS | MVP | F03, F06 |
| F06 | Penjaminan dan eligibilitas | BPJS: cek peserta, rujukan, SEP, SPRI, surat kontrol, rujukan balik, PRB. Asuransi swasta dan perusahaan: eligibilitas, plafon, surat jaminan | MVP | I03 |
| F07 | Rujukan | Rujukan masuk dan keluar, SISRUTE, rujukan internal antarpoli, surat rujukan elektronik | MVP | I04, K13 |
| F08 | Layanan informasi pelanggan | Informasi ketersediaan bed, jadwal, tarif; pengaduan awal; status antrean publik | MVP | K05, U01 |

## Lapisan 3: Klinis RME (15 komponen)

Inti rekam medis elektronik. Asesmen spesialis tidak dibangun sebagai layar terpisah seperti di Khanza (sekitar 250 form), melainkan sebagai paket formulir di atas form engine P07.

| Kode | Komponen | Fungsi inti | Fase | Bergantung pada |
|---|---|---|---|---|
| K01 | Worklist klinis | Daftar pasien per DPJP, unit, dan shift; status (menunggu, diperiksa, menunggu hasil); tugas tertunda | MVP | F03, P09 |
| K02 | Rawat jalan | Pemeriksaan poli: TTV, asesmen awal medis dan keperawatan, SOAP, tindak lanjut (pulang, kontrol, rujuk, rawat inap) | MVP | K06, K07, K09 |
| K03 | IGD dan triase | Triase (ATS atau ESI sesuai pilihan RS), asesmen IGD, observasi, disposisi; papan pasien IGD dengan waktu tunggu | MVP | K06, K12 |
| K04 | Rawat inap | Admisi, transfer antarruang, visite, rawat bersama, perencanaan pulang sejak hari pertama, pulang | MVP | K05, K07 |
| K05 | Bed management | Peta bed real-time, status (terisi, kosong, dibersihkan, dipesan), rencana pulang, permintaan bed dari IGD dan OK; sumber data Aplicare/SIRANAP | MVP | P01 |
| K06 | Asesmen dan skrining | Paket formulir: asesmen awal per spesialis, keperawatan, kebidanan, skrining gizi, risiko jatuh, nyeri, dekubitus, fungsional, risiko khusus | MVP | P07 |
| K07 | CPPT dan serah terima | Catatan perkembangan terintegrasi lintas PPA (SOAP/ADIME), verifikasi DPJP, serah terima SBAR antarshift | MVP | P04, P08 |
| K08 | Diagnosis dan problem list | Diagnosis kerja dan akhir berkode ICD-10, prosedur ICD-9-CM, daftar masalah aktif lintas kunjungan, alergi | MVP | P06 |
| K09 | CPOE dan order set | Order lab, radiologi, obat, tindakan, diet, konsultasi; order set institusi dan favorit pribadi; validasi kewenangan saat order | MVP | P03, S01–S08 |
| K10 | Konsultasi dan rawat bersama | Permintaan konsul antar-DPJP dengan jawaban terstruktur, penetapan DPJP utama | MVP | K07 |
| K11 | Persetujuan dan edukasi | Informed consent, penolakan tindakan, DNR, edukasi pasien dan keluarga; tanda tangan pasien di tablet | MVP | P08 |
| K12 | Asuhan keperawatan dan eMAR | Rencana asuhan keperawatan, observasi TTV, EWS/PEWS/MEOWS otomatis, balans cairan, pemberian obat dengan pindai gelang pasien dan obat | MVP | S04, S05 |
| K13 | Resume dan dokumen pulang | Resume medis yang menarik data otomatis, surat kontrol, rujukan balik, surat keterangan, surat kematian | MVP | K08, P08 |
| K14 | Ringkasan pasien | Satu layar: identitas, alergi, problem list, obat aktif, hasil terbaru, kunjungan terakhir, flag risiko | MVP | K08, S01, S03, S04 |
| K15 | Paket layanan khusus | Hemodialisa, rehab medik/KFR, MCU, kebidanan dan perinatologi, ICU flowsheet | MVP sebagian, sisanya Lanjut | P07, K12 |

## Lapisan 4: Penunjang (10 komponen)

Setiap unit penunjang mengikuti siklus yang sama: order dari CPOE → penerimaan dan pelaksanaan → hasil dan validasi → biaya otomatis. Integrasi alat dirancang sekarang tetapi dibangun setelah MVP, jadi di MVP hasil diinput manual atau diimpor.

| Kode | Komponen | Fungsi inti | Fase | Bergantung pada |
|---|---|---|---|---|
| S01 | Laboratorium patologi klinik | Penerimaan order, label barcode sampel, input dan validasi hasil, nilai rujukan per usia dan jenis kelamin, delta check, cetak hasil | MVP (alat: Lanjut) | K09, I06 |
| S02 | Mikrobiologi dan patologi anatomi | Kultur dan uji kepekaan, hasil PA dengan gambar; sumber data antibiogram untuk PPRA | MVP | S01 |
| S03 | Radiologi (RIS) | Penjadwalan modalitas, ekspertise dengan template, dosis radiasi; tautan ke viewer PACS | MVP (PACS: Lanjut) | K09, I06 |
| S04 | Farmasi klinis | Verifikasi dan telaah resep, CDS otomatis (interaksi, alergi, dosis per berat badan dan fungsi ginjal, duplikasi), rekonsiliasi obat, formularium dan Fornas, PIO, MESO | MVP | K09, P06 |
| S05 | Dispensing dan depo | Penyiapan resep jadi dan racikan, unit dose dispensing untuk rawat inap, label obat, penyerahan dengan konfirmasi, retur | MVP | S04, B01 |
| S06 | Kamar operasi dan anestesi | Jadwal OK dan daftar tunggu, checklist keselamatan bedah (Sign In, Time Out, Sign Out), asesmen pra-anestesi, laporan operasi, pemakaian BHP | MVP | K09, K11 |
| S07 | Gizi | Order diet, skrining dan asuhan gizi, daftar makan per ruang dan jam, label makanan, sisa makanan | MVP | K09 |
| S08 | Bank darah | Permintaan darah, crossmatch, stok komponen, pemberian dan reaksi transfusi | MVP | K09 |
| S09 | Hasil kritis | Aturan nilai kritis per pemeriksaan, notifikasi prioritas ke DPJP, konfirmasi baca ulang dengan batas waktu, eskalasi | MVP | S01, S03, P09 |
| S10 | Penunjang diagnostik lain | Hasil terstruktur EKG, USG, echo, endoskopi, treadmill, dengan lampiran gambar | MVP | P07, P08 |

## Lapisan 5: Keuangan (10 komponen)

Pola tarif berkomponen dan jurnal otomatis dari Khanza dipertahankan, tetapi digerakkan oleh event: setiap tindakan, obat, dan hari rawat yang tercatat langsung menjadi baris biaya (charge capture), bukan dihitung ulang saat kasir dibuka.

| Kode | Komponen | Fungsi inti | Fase | Bergantung pada |
|---|---|---|---|---|
| U01 | Tarif dan paket | Master tarif berkomponen (jasa sarana, jasa medis, jasa paramedis, BHP, KSO, manajemen) per penjamin, kelas, dan unit; paket tindakan dan paket operasi; riwayat perubahan tarif | MVP | P01, P10 |
| U02 | Charge capture | Mengubah event klinis (tindakan, obat, lab, kamar, visite) menjadi baris biaya otomatis; koreksi dan pembatalan berjejak | MVP | U01, lapisan 3–4 |
| U03 | Billing dan kasir | Tagihan rawat jalan, rawat inap, dan parsial; deposit dan pengembalian; diskon dan potongan dengan persetujuan; pembayaran tunai, kartu, QRIS, VA; kuitansi dan nota | MVP | U02 |
| U04 | Penjaminan dan piutang | Pemisahan porsi pasien dan penjamin, selisih kelas, piutang BPJS, asuransi, dan perusahaan; penagihan dan pelunasan | MVP | U03, F06 |
| U05 | Klaim BPJS dan INA-CBG | Kelengkapan berkas klaim, grouping, kirim E-Klaim, status pending dan dispute, rekonsiliasi pembayaran | MVP | U06, I03 |
| U06 | Koding klinis | Workbench koder: kode diagnosis dan prosedur dari RME, saran kode, validasi kesesuaian, audit koding | MVP | K08, P06 |
| U07 | Akuntansi | Bagan akun, jurnal otomatis dari setiap transaksi, jurnal manual, buku besar, neraca saldo, laba rugi, arus kas, tutup buku | MVP | U02–U04, U09, U10 |
| U08 | Jasa pelayanan | Perhitungan jasa medis dan paramedis dari komponen tarif, aturan pembagian per RS, rekap dan pembayaran | MVP | U01, U07 |
| U09 | Kas dan bank | Penerimaan kas per shift dan closing kasir, VA dan host-to-host bank, rekonsiliasi mutasi bank | MVP | U03, I05 |
| U10 | Hutang usaha | Tagihan vendor obat, BHP, dan barang dari penerimaan gudang; jadwal pembayaran | MVP | B01, U07 |

## Lapisan 6: Back office dan tata kelola (13 komponen)

Sebagian besar komponen ini menyusul setelah MVP. Ada tiga pengecualian yang harus ikut MVP karena lapisan 1–5 bergantung padanya: **B01 supply chain** (farmasi tidak bisa mengeluarkan obat tanpa stok), **B03 data SDM inti** (akun, jadwal, dan DPJP perlu data pegawai), dan **B09 rekam medis administratif** (bukti akreditasi MRMIK).

| Kode | Komponen | Fungsi inti | Fase | Bergantung pada |
|---|---|---|---|---|
| B01 | Supply chain generik | Satu modul untuk obat, BHP, alkes, non medis, dan dapur: perencanaan, pengadaan, penerimaan, gudang dan depo, mutasi, batch dan kedaluwarsa, stok opname, e-katalog | MVP | P01, P06 |
| B02 | Aset dan pemeliharaan | Register aset, pemeliharaan terjadwal, kalibrasi alat medis, perbaikan, data untuk ASPAK | Lanjut | B01 |
| B03 | SDM dan kepegawaian | Data pegawai, struktur jabatan, jadwal dinas, presensi, cuti; sumber akun P02 | MVP (data inti), Lanjut (selebihnya) | P01 |
| B04 | Kredensial dan kewenangan klinis | STR/SIP dengan masa berlaku, rincian kewenangan klinis per tenaga medis dan perawat, ditegakkan saat order di K09 | Lanjut | B03, P03 |
| B05 | Penggajian | Gaji, tunjangan, potongan, pajak; integrasi dengan jasa pelayanan U08 | Lanjut | B03, U08 |
| B06 | Mutu dan keselamatan pasien | Indikator Nasional Mutu, indikator mutu prioritas RS dan unit, pelaporan dan investigasi IKP, register risiko | Lanjut | Lapisan 3–5 |
| B07 | PPI | Surveilans HAIs, bundle, audit kebersihan tangan dan APD | Lanjut | K12, S02 |
| B08 | PPRA | Restriksi antibiotik bertingkat, persetujuan tim PPRA, DDD per 100 hari rawat, antibiogram | Lanjut (modul RS tersier) | S02, S04 |
| B09 | Rekam medis administratif | Asembling dan analisis kelengkapan, audit RM dengan sampling, pelepasan informasi, retensi dan pemusnahan, peminjaman berkas lama | MVP | P04, P08 |
| B10 | Pendidikan klinik | Data residen, koas, dan peserta didik; supervisi bertingkat; co-sign CPPT dan order; logbook kompetensi; jadwal stase | Lanjut (modul RS tersier) | B03, K07, K09 |
| B11 | Onkologi | Protokol regimen kemoterapi, siklus, dosis berbasis luas permukaan tubuh, verifikasi ganda, registri kanker | Lanjut (modul RS tersier) | K09, S04 |
| B12 | Dokumen regulasi dan akreditasi | DMS berversi untuk kebijakan, pedoman, dan SPO; paket bukti akreditasi | Lanjut | P08 |
| B13 | Pengalaman pasien | Pengaduan dengan SLA, survei kepuasan otomatis setelah pulang | Lanjut | P09, I07 |

## Lapisan 7: Integrasi, kanal, dan data (12 komponen)

Sama seperti lapisan 6, ada pengecualian MVP: konektor nasional (I01–I05) wajib ada sejak rilis pertama, karena registrasi BPJS, SATUSEHAT, dan pelaporan SIRS adalah syarat operasional RS, bukan fitur tambahan.

| Kode | Komponen | Fungsi inti | Fase | Bergantung pada |
|---|---|---|---|---|
| I01 | Integration hub | Antrean pesan, retry dengan backoff, idempotensi, dead-letter, dasbor status kirim per tujuan dan per RS, kredensial per tenant di secret manager | MVP | P10, P11 |
| I02 | Konektor SATUSEHAT | Patient, Practitioner, Organization, Location, Encounter, Condition, Observation, Procedure, Medication*, ServiceRequest, Specimen, DiagnosticReport, AllergyIntolerance, Composition; pemetaan KFA, LOINC, SNOMED | MVP | I01, P06 |
| I03 | Konektor BPJS | VClaim, Antrean/Mobile JKN (termasuk web service yang dipanggil BPJS), Aplicare, Apotek Online, iCare, E-Klaim INA-CBG, PCare (untuk tenant klinik) | MVP | I01 |
| I04 | Konektor Kemenkes lain | SIRS Online dan RL, RS Online, SISRUTE, SITB, laporan surveilans | MVP | I01 |
| I05 | Konektor layanan pendukung | Dukcapil, bank (VA, H2H, QRIS), penyedia TTE, WhatsApp/SMS gateway | MVP | I01 |
| I06 | Device gateway | Alat lab (HL7 v2/ASTM, atau DB vendor), DICOM worklist dan PACS, alat ICU (monitor, ventilator, infus pump); berjalan di server edge RS | Lanjut | I01, P13 |
| I07 | Aplikasi dan portal pasien | Booking, antrean real-time, hasil pemeriksaan, resume, tagihan dan pembayaran, telekonsultasi video, persetujuan elektronik, survei | Lanjut | F02, F04, K13, U03 |
| I08 | Aplikasi dokter dan perawat | Worklist, visite, CPPT, order, co-sign, hasil kritis, eMAR di perangkat genggam | Lanjut | Lapisan 3 |
| I09 | Dasbor eksekutif dan command center | BOR, ALOS, waktu tunggu IGD, utilisasi OK, bed real-time, pendapatan, klaim tertunda, kas; drill-down sampai pasien | Lanjut | I11 |
| I10 | Costing dan case-mix | Unit cost berbasis aktivitas, margin per INA-CBG, SMF, dan DPJP; clinical pathway dan analisis varians | Lanjut (modul RS tersier) | U02, U07, I11 |
| I11 | Data warehouse dan dataset riset | Replika analitik per tenant dan lintas tenant (teragregasi), laporan terjadwal, dataset ter-de-identifikasi untuk riset | Lanjut | Semua lapisan |
| I12 | API publik dan FHIR server | API terdokumentasi dan FHIR R4 untuk mitra pihak ketiga (asuransi, aplikasi kesehatan), dengan izin per tenant | Lanjut | P03, I01 |

## Kanal aplikasi dan integrasi alat

Empat kanal memakai satu backend API yang sama, sehingga aturan akses, audit, dan logika bisnis hanya ditulis sekali. Usulan fase di bawah perlu Anda konfirmasi.

| Kanal | Pengguna | Komponen utama | Usulan fase |
|---|---|---|---|
| Web app staf | Loket, perawat, dokter, farmasi, lab, radiologi, kasir, koder, RM, manajemen | Semua lapisan | MVP |
| Anjungan dan display | Pasien di lobi, ruang tunggu poli, farmasi, penunjang | F04, F05 | MVP |
| Aplikasi dokter dan perawat | DPJP, residen, perawat ruangan | I08 (K01, K07, K09, K12, S09) | Lanjut; selama MVP, web staf dibuat responsif agar bisa dipakai di tablet |
| Aplikasi pasien | Pasien dan keluarga | I07 (F02, F04, K13, U03) | Lanjut; selama MVP booking memakai Mobile JKN dan WhatsApp |

| Integrasi alat | Protokol umum | Lokasi | Usulan fase |
|---|---|---|---|
| Analyzer laboratorium | HL7 v2, ASTM, atau tabel DB milik LIS vendor | Device gateway di server edge RS | Lanjut |
| Modalitas radiologi dan PACS | DICOM Modality Worklist, DICOMweb, HL7 ORM/ORU | Server edge dan PACS RS atau PACS cloud | Lanjut |
| Alat ICU (monitor, ventilator, infus pump) | HL7 v2 dari gateway vendor, IHE PCD | Server edge RS | Lanjut, terakhir |

## Konfirmasi dan agenda berikutnya

**Perlu Anda konfirmasi** (centang bila setuju, atau beri komentar bila tidak):

Integrasi alat lab, PACS, dan ICU dibangun setelah MVP; selama MVP hasil diinput manual

B01 supply chain, B03 data SDM inti, dan B09 rekam medis administratif ikut MVP walaupun berada di lapisan 6

Konektor nasional I01–I05 ikut MVP walaupun berada di lapisan 7

Aplikasi dokter dan aplikasi pasien menyusul; selama MVP web staf dibuat responsif untuk tablet

Modul RS tersier (B08 PPRA, B10 pendidikan klinik, B11 onkologi, I10 costing) masuk fase Lanjut dan dapat dinonaktifkan per RS

Tenant klinik (PCare) juga dilayani platform ini, atau hanya rumah sakit

**Agenda wawancara berikutnya**, berurutan. Setiap topik menghasilkan satu dokumen atau bagian blueprint:

**Desain UI/UX dan design system**: gaya visual, warna dan identitas merek, kepadatan informasi, mode gelap, perangkat utama, aksesibilitas, bahasa antarmuka.

**Alur bisnis per modul**: alur rinci registrasi sampai pulang, rawat inap, farmasi, kasir, klaim, dengan aturan dan pengecualiannya.

**Arsitektur dan stack teknologi**: bahasa backend dan frontend, database, model multi-tenant, server edge, cloud provider, pola integrasi.

**Data model**: entitas inti, pemetaan FHIR, penomoran, retensi.

**Keamanan dan kepatuhan**: UU PDP, Permenkes 24/2022, MRMIK, TTE, audit, enkripsi, pengelolaan kunci.

**Kebutuhan non-fungsional**: jumlah RS dan pengguna serentak, target respons, SLA, RTO dan RPO.

**README dan dokumentasi**: struktur repositori, konvensi kode, panduan kontribusi, dokumentasi API, panduan pengguna.

**Tim, rilis, dan kualitas**: struktur tim, metodologi, strategi pengujian, CI/CD, rencana go-live per RS.

**Model bisnis**: skema harga SaaS, paket modul, implementasi dan dukungan.

Usulan urutan memulai dari desain UI karena itu yang Anda sebut pertama. Namun alur bisnis (agenda 2) akan sangat membantu desain layar; jika Anda setuju, keduanya bisa dibahas bergantian.
