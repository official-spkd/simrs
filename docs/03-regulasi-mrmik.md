> Disalin dari dokumen "Bedah KMK 1596/2024". Ringkasan untuk developer; rujukan hukum tetap teks KMK resmi.

# Bedah KMK 1596/2024: 51 Elemen Penilaian MRMIK untuk SIM RS

2026-10-03 · Muhammad Reynandio Wira Prathama

## Ringkasan

Dokumen yang dibedah adalah **KMK HK.01.07/MENKES/1596/2024 tentang Standar Akreditasi Rumah Sakit** (356 halaman), pengganti KMK 1128/2022. Angka 51 adalah jumlah **elemen penilaian (EP)** pada bab **Manajemen Rekam Medik dan Informasi Kesehatan (MRMIK)**, halaman 148–171. Bab ini memuat 16 standar, dari MRMIK 1 sampai MRMIK 13.1, dalam 4 kelompok.

Temuan utama:

**Rekam medis wajib elektronik.** Gambaran umum MRMIK menyatakan penyelenggaraan rekam medis harus elektronik, mulai registrasi sampai transfer isi RME. Jadi SIM RS menjadi bukti utama akreditasi, bukan sekadar alat bantu.

**Hanya sebagian EP yang murni fitur software.** Dari 51 EP, 21 bergantung langsung pada kemampuan SIM RS, 16 terbantu oleh SIM RS, dan 14 adalah urusan tata kelola (regulasi, unit, pelatihan) yang tidak bisa diselesaikan oleh software (klasifikasi di bagian Peta 51 EP).

**Tiga tuntutan teknis paling keras:** jejak audit setiap perubahan dan akses (MRMIK 2.1, 8), integrasi dengan sistem informasi nasional (MRMIK 2 EP b, MRMIK 4), dan penyimpanan di tiga tempat (server RS, backup rutin, cloud atau backup luar RS) beserta prosedur downtime yang teruji (MRMIK 5, 13.1).

**Bagi developer**, 51 EP ini dapat diterjemahkan menjadi sekitar 12 kemampuan inti: identitas tunggal pasien, RBAC, audit trail tak dapat diubah, tanda tangan dan stempel waktu per entri, koreksi berversi, master kode ICD-10/ICD-9-CM dan singkatan, master formulir berversi, retensi dan pemusnahan, pelaporan nasional, dasbor pengkajian kelengkapan RM, backup tiga lokasi, dan mode downtime.

**Bagi RS**, separuh pekerjaan ada di luar software: regulasi direktur, unit rekam medis, komite atau tim RM, tim reviu keamanan, unit SIMRS, dan bukti pelatihan per peran.

## Posisi regulasi dan struktur dokumen

KMK 1596/2024 adalah acuan bagi lembaga penyelenggara akreditasi dan rumah sakit, berlaku sejak ditetapkan, dan mencabut KMK 1128/2022. Dasar hukumnya UU 17/2023 tentang Kesehatan dan PP 28/2024. Standar disusun dari benchmarking SNARS 1.1, JCI edisi 7, dan prinsip ISQua edisi 5.

| Kelompok standar | Bab |
|---|---|
| Manajemen rumah sakit | TKRS, KPS, MFK, PMKP, **MRMIK**, PPI, PPK |
| Pelayanan berfokus pada pasien | AKP, HPK, PP, PAP, PAB, PKPO, KE |
| Sasaran keselamatan pasien | SKP |
| Program nasional | PROGNAS |

Setiap standar terdiri atas tiga lapis: **Standar** (apa yang wajib), **Maksud dan Tujuan** (penjelasan dan contoh), dan **Elemen Penilaian** (yang diperiksa surveior). Developer sebaiknya membaca ketiganya, karena detail teknis seperti kredensial login unik, enkripsi, dan backup tiga lokasi hanya muncul di Maksud dan Tujuan, bukan di EP.

Bab MRMIK berfokus pada empat hal: manajemen informasi, pengelolaan dokumen, rekam medis pasien, dan teknologi informasi kesehatan. Bab ini menegaskan bahwa penyelenggaraan RME meliputi registrasi, distribusi data, pengisian informasi klinis, pengolahan, input data klaim, penyimpanan, penjaminan mutu, sampai transfer isi RME.

Konteks di luar dokumen ini yang perlu dibaca bersamaan (tidak disebut eksplisit dalam KMK): **Permenkes 24/2022 tentang Rekam Medis** yang mewajibkan RME dan integrasi ke platform SATUSEHAT, serta **UU 27/2022 tentang Pelindungan Data Pribadi**. EP MRMIK 2 huruf b ("terkoneksi dengan sistem informasi secara nasional") dalam praktik dipenuhi melalui SATUSEHAT, RS Online, dan SIRS Online.

Banyak bab lain bergantung pada RME sebagai bukti. Contoh dari teks KMK: CPPT dan peran DPJP (bab AKP, PP, dan PAP), persetujuan umum dan informed consent (HPK, halaman 239–242), rekonsiliasi obat dan peresepan (PKPO, halaman 298–308), baca ulang instruksi (PKPO, halaman 309) dan pelaporan nilai kritis (SKP, halaman 327), serta indikator mutu dan insiden keselamatan (PMKP).

## Peta 51 elemen penilaian

Setiap EP diklasifikasikan menurut peran SIM RS dalam pemenuhannya. **Kunci**: EP tidak dapat dipenuhi tanpa fitur SIM RS. **Pendukung**: EP dipenuhi oleh proses RS, tetapi SIM RS menyediakan data atau bukti. **Tata kelola**: regulasi, struktur, atau pelatihan yang sepenuhnya urusan manajemen RS.

| No | EP | Inti elemen penilaian | Peran SIM RS | Kapabilitas sistem |
|---|---|---|---|---|
| 1 | MRMIK 1a | Regulasi pengelolaan informasi (7 kebutuhan a–g) | Tata kelola | — |
| 2 | MRMIK 1b | Proses informasi memenuhi kebutuhan PPA, pimpinan, unit, pihak luar | Pendukung | Dasbor per peran, laporan internal/eksternal |
| 3 | MRMIK 1c | Proses sesuai ukuran dan kompleksitas RS | Tata kelola | — |
| 4 | MRMIK 1d | Monev berkala pemenuhan informasi dan perbaikan | Pendukung | Log permintaan data, SLA laporan |
| 5 | MRMIK 1e | Data untuk riset dan pendidikan tersedia tepat waktu | Pendukung | Data warehouse, ekspor ter-de-identifikasi |
| 6 | MRMIK 2a | Bukti pelatihan sistem informasi dan RME sesuai peran | Tata kelola | (opsional) catatan pelatihan terkait akun |
| 7 | MRMIK 2b | Data klinis dan non klinis terintegrasi dan terkoneksi dengan sistem nasional | Kunci | SATUSEHAT, SIRS, RS Online, BPJS |
| 8 | MRMIK 2.1a | Proses kerahasiaan, keamanan, integritas data | Kunci | Enkripsi, validasi data, kontrol integritas |
| 9 | MRMIK 2.1b | Proses pemberian akses staf berwenang, termasuk entri RM | Kunci | RBAC, alur pengajuan dan persetujuan akses |
| 10 | MRMIK 2.1c | Pemantauan kepatuhan dan tindakan atas pelanggaran | Kunci | Audit log akses dan perubahan, laporan anomali |
| 11 | MRMIK 2.2a | Data terlindung dari kehilangan, pencurian, kerusakan | Kunci | Backup tiga lokasi, enkripsi, uji restore |
| 12 | MRMIK 2.2b | Monev keamanan data dan informasi | Pendukung | Laporan keamanan berkala, vulnerability scan |
| 13 | MRMIK 2.2c | Bukti tindakan perbaikan keamanan | Tata kelola | Catatan tindak lanjut (bisa di modul tiket) |
| 14 | MRMIK 3a | Pengelolaan dokumen: persetujuan, revisi, versi terkini, obsolete | Pendukung | Modul dokumen (DMS) berversi |
| 15 | MRMIK 3b | Format seragam dokumen sejenis | Tata kelola | Template dokumen |
| 16 | MRMIK 3c | Dokumen internal tingkat pemilik, RS, unit | Tata kelola | — |
| 17 | MRMIK 4a | Penyebaran data memenuhi kebutuhan internal dan eksternal | Kunci | Laporan RS Online, SIRS Online, ICD-10, 10 besar penyakit |
| 18 | MRMIK 4b | Data untuk perawatan pasien diterima tepat waktu dan format seragam | Kunci | Hasil penunjang real-time, notifikasi |
| 19 | MRMIK 5a | Regulasi penyelenggaraan RME | Tata kelola | — |
| 20 | MRMIK 5b | Unit penyelenggara RM, minimal 1 orang kompeten | Tata kelola | — |
| 21 | MRMIK 5c | RM dari pasien masuk sampai pulang, dirujuk, atau meninggal | Kunci | Siklus encounter lengkap |
| 22 | MRMIK 5d | Keamanan dan kerahasiaan dijamin lewat penjaminan mutu tim reviu | Pendukung | Laporan audit untuk tim reviu |
| 23 | MRMIK 6a | Satu pasien, satu nomor RM | Kunci | Master Patient Index, deteksi duplikat, merge |
| 24 | MRMIK 6b | RM ralan, ranap, IGD, penunjang disusun sesuai ketetapan | Kunci | Formulir per setting pelayanan |
| 25 | MRMIK 6c | Formulir RM dievaluasi dan diperbarui berkala | Pendukung | Master formulir berversi |
| 26 | MRMIK 7a | Isi RM sesuai ketetapan RS dan peraturan | Kunci | Field wajib, validasi kelengkapan |
| 27 | MRMIK 7b | Isi memadai: identifikasi, diagnosis, justifikasi, hasil, ringkasan pulang, kesinambungan | Kunci | Resume medis, CPPT, ringkasan pasien |
| 28 | MRMIK 8a | PPA mencantumkan identitas jelas | Kunci | Identitas penulis otomatis per entri, TTE |
| 29 | MRMIK 8b | Tanggal dan waktu setiap catatan teridentifikasi | Kunci | Stempel waktu server |
| 30 | MRMIK 8c | Prosedur koreksi penulisan di RME | Kunci | Koreksi berversi dengan alasan, tanpa hapus |
| 31 | MRMIK 8d | Monev penulisan identitas, waktu, koreksi | Pendukung | Laporan koreksi dan keterlambatan pengisian |
| 32 | MRMIK 9a | Kode diagnosis, prosedur, singkatan, simbol sesuai ketetapan | Kunci | Master ICD-10, ICD-9-CM, daftar singkatan |
| 33 | MRMIK 9b | Evaluasi berkala penggunaan kode dan singkatan | Pendukung | Laporan akurasi koding, deteksi singkatan terlarang |
| 34 | MRMIK 10a | Otoritas pengisian RM, isi, dan format | Kunci | Hak tulis per formulir per profesi |
| 35 | MRMIK 10b | Hak akses pelepasan informasi RM | Kunci | Alur permintaan dan rilis informasi (ROI) |
| 36 | MRMIK 10c | Otentifikasi, keamanan, kerahasiaan sebagai hak pasien | Kunci | TTE, kontrol privasi pasien, akses pasien |
| 37 | MRMIK 11a | Regulasi masa simpan dan prosedur pemusnahan | Tata kelola | — |
| 38 | MRMIK 11b | Pemusnahan setelah masa simpan secara aman | Pendukung | Jadwal retensi, pemusnahan terkontrol, berita acara |
| 39 | MRMIK 11c | Dokumen bernilai guna disimpan permanen | Pendukung | Penanda simpan permanen |
| 40 | MRMIK 12a | Penetapan komite/tim rekam medis | Tata kelola | — |
| 41 | MRMIK 12b | Pengkajian RM berkala tiap tahun dengan sampel | Pendukung | Modul audit RM dengan sampling |
| 42 | MRMIK 12c | Fokus: ketepatan waktu, keterbacaan, kelengkapan, isi | Pendukung | Skor kelengkapan otomatis |
| 43 | MRMIK 12d | Hasil dilaporkan ke pimpinan dan ditindaklanjuti | Tata kelola | — |
| 44 | MRMIK 13a | Regulasi penyelenggaraan TIK kesehatan | Tata kelola | — |
| 45 | MRMIK 13b | SIMRS diterapkan sesuai ketetapan dan peraturan | Kunci | SIM RS itu sendiri |
| 46 | MRMIK 13c | Unit penyelenggara SIMRS dipimpin staf kompeten | Tata kelola | — |
| 47 | MRMIK 13d | Data klinis dan non klinis terintegrasi untuk keputusan | Kunci | Satu basis data terintegrasi, dasbor |
| 48 | MRMIK 13e | Penilaian efektivitas RME dan perbaikan | Pendukung | Metrik penggunaan, survei pengguna |
| 49 | MRMIK 13.1a | Prosedur downtime terencana dan tidak terencana | Pendukung | Mode baca saja, formulir cadangan, entri susulan |
| 50 | MRMIK 13.1b | Staf dilatih perannya saat downtime | Tata kelola | — |
| 51 | MRMIK 13.1c | Evaluasi pasca downtime | Pendukung | Log insiden dan uptime |

Rekap: 21 EP kunci, 16 EP pendukung, 14 EP tata kelola. Klasifikasi ini adalah penilaian analis, bukan bagian dari KMK.

## Kelompok a: Manajemen informasi (13 EP)

Kelompok ini menuntut RS memperlakukan informasi sebagai sumber daya yang direncanakan, dilindungi, dan dipakai untuk keputusan. Bagi developer, ini adalah fondasi: keamanan, hak akses, audit, backup, dan integrasi nasional. Kesalahan di sini sulit diperbaiki setelah sistem berjalan.

### MRMIK 1: Proses manajemen informasi internal dan eksternal

Maksud dan Tujuan meminta perencanaan kebutuhan informasi dari tiga sumber: PPA, pimpinan dan kepala unit, serta pihak luar. Gambaran umum bab menyebut tujuh kebutuhan (a–g): identifikasi kebutuhan TI, pengembangan sistem informasi manajemen, penetapan jenis data, analisis, pelaporan ke publik, perlindungan data, dan integrasi informasi untuk peningkatan kinerja.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 1a Regulasi pengelolaan informasi | Peraturan direktur atau pedoman manajemen informasi yang memetakan 7 kebutuhan a–g; surveior akan mencocokkan regulasi dengan praktik | Tidak ada fitur wajib. Siapkan dokumen "katalog data dan laporan" bawaan produk agar RS mudah menyusun regulasinya |
| 1b Bukti proses memenuhi kebutuhan PPA, pimpinan, unit, pihak luar | Daftar kebutuhan informasi per pengguna, contoh laporan yang benar-benar dipakai (notulen rapat, laporan bulanan) | Dasbor per peran (klinisi, kepala unit, direksi), laporan eksternal terjadwal. Kriteria: setiap laporan punya pemilik, frekuensi, dan riwayat pengiriman |
| 1c Proses sesuai ukuran dan kompleksitas RS | Analisis kebutuhan yang menyebut kelas RS, jumlah TT, SDM TI | Konfigurasi modul bertingkat (RS tipe D tidak dipaksa memakai modul RS tersier) |
| 1d Monev berkala dan perbaikan | Laporan evaluasi tahunan pemenuhan informasi, bukti tindak lanjut | Log permintaan data ad-hoc, waktu penyelesaian, dan status. Kriteria: bisa diekspor sebagai bukti monev |
| 1e Data riset dan pendidikan tepat waktu (bila RS pendidikan) | SPO permintaan data riset, persetujuan etik, log penyerahan data | Data warehouse atau replika baca, ekspor dataset ter-de-identifikasi (hapus NIK, nama, alamat; geser tanggal), jejak siapa meminta dan untuk penelitian apa |

### MRMIK 2: Pelatihan dan integrasi informasi

Pelatihan mencakup enam topik: penggunaan sistem dan RME, kebijakan keamanan dan kerahasiaan, strategi downtime, penggunaan data untuk keputusan, komunikasi dengan pasien dan keluarga, serta monev proses kerja. Teks juga menegaskan bahwa staf hanya mengakses RME sesuai hak akses yang diberikan direktur dan setelah dilatih.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 2a Bukti pelatihan sesuai peran | Matriks pelatihan per peran (dokter, perawat, farmasi, RM, kasir, pimpinan), daftar hadir, sertifikat, evaluasi | Materi pelatihan per peran dan sandbox/training environment dengan data dummy. Opsi: akun baru baru aktif setelah pelatihan ditandai selesai |
| 2b Data klinis dan non klinis terintegrasi dan terkoneksi dengan sistem nasional | Bukti pengiriman rutin ke SATUSEHAT, SIRS Online, RS Online, BPJS; laporan yang dipakai rapat manajemen | Integration hub dengan antrean pesan, retry, dan log per pesan. Kriteria: dasbor status kirim (berhasil/gagal/pending) per jenis resource, bisa ditunjukkan ke surveior |

### MRMIK 2.1 dan 2.2: Keamanan, kerahasiaan, integritas, ketersediaan

Ini bagian paling teknis di seluruh bab. Maksud dan Tujuan menyebut enam unsur otorisasi (siapa, informasi apa, proses pemberian akses, kewajiban staf, integritas data, proses saat pelanggaran), audit untuk melacak siapa mengubah atau menghapus data, **login dengan kredensial unik yang tidak dipakai bersama**, serta tujuh contoh langkah keamanan: perangkat lunak terkini, enkripsi, backup di luar lokasi atau cloud, penyimpanan dokumen fisik bertanda tangan basah, akses terbatas ruang dokumen, keamanan ruang server, serta suhu dan kelembapan ruang server.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 2.1a Proses kerahasiaan, keamanan, integritas | Kebijakan keamanan informasi, klasifikasi data, perjanjian kerahasiaan staf dan vendor | Enkripsi in-transit (TLS) dan at-rest, hash password (Argon2/bcrypt), validasi data di server, constraint database, checksum dokumen |
| 2.1b Proses pemberian akses termasuk entri RM | SK direktur tentang hak akses per jabatan, formulir pengajuan akses, bukti pencabutan saat staf keluar | RBAC per peran, unit, dan relasi pasien (DPJP, perawat ruangan). Alur pengajuan dan persetujuan akses berjejak. Integrasi dengan data SDM agar akun nonaktif otomatis saat staf keluar |
| 2.1c Pemantauan kepatuhan dan tindakan atas pelanggaran | Laporan reviu akses berkala oleh tim reviu, contoh kasus pelanggaran dan sanksinya | Audit log append-only untuk baca, ubah, hapus, cetak, ekspor. Laporan anomali: akses ke pasien yang bukan tanggungannya, akses ke pasien VIP, akses di luar jam dinas, login gagal berulang. Fitur break-the-glass dengan alasan wajib |
| 2.2a Data terlindung dari kehilangan, pencurian, kerusakan | Bukti backup berjalan, lokasi backup, hasil uji restore | Backup otomatis terenkripsi ke minimal 2 lokasi berbeda, point-in-time recovery, uji restore terjadwal dengan laporan. Tidak ada kredensial atau kunci di kode atau di PC klien |
| 2.2b Monev keamanan data | Laporan keamanan berkala, hasil penilaian kerentanan atau penetration test | Laporan bawaan: patch level, akun tanpa MFA, akun dormant, hasil scan dependensi |
| 2.2c Bukti tindakan perbaikan keamanan | Catatan temuan, rencana perbaikan, dan bukti penyelesaian | Modul tiket atau integrasi ke sistem tiket untuk temuan keamanan |

## Kelompok b: Pengelolaan dokumen dan penyebaran data (5 EP)

MRMIK 3 berbicara tentang dokumen regulasi RS (kebijakan, pedoman, SPO, program kerja), bukan dokumen rekam medis. MRMIK 4 berbicara tentang penyebaran data ke dalam dan ke luar RS. Keduanya sering terlewat oleh vendor SIM RS, padahal mudah dimonetisasi sebagai modul tambahan.

### MRMIK 3: Tata naskah dan pengendalian dokumen

Maksud dan Tujuan merinci delapan unsur tata naskah (a–h): persetujuan sebelum terbit, frekuensi peninjauan, hanya versi terkini yang beredar, identifikasi perubahan, identitas dan keterbacaan, dokumen dari luar RS, penyimpanan dokumen obsolete, serta pelacakan dokumen beredar (judul, tanggal terbit, edisi, revisi, jumlah halaman, pengesah). Dokumen internal berjenjang: tingkat pemilik/korporasi, tingkat RS, dan tingkat unit (kebijakan unit, pedoman pengorganisasian, pedoman pelayanan, SPO, program kerja tahunan).

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 3a Pengelolaan dokumen sesuai a–h | Pedoman tata naskah, daftar induk dokumen, bukti dokumen kedaluwarsa ditarik | Modul DMS: alur draf → reviu → persetujuan → terbit, nomor dokumen otomatis, versi dan riwayat revisi, tanggal tinjau ulang dengan pengingat, status obsolete yang tetap tersimpan tetapi diberi watermark, distribusi ke unit dengan tanda terima baca |
| 3b Format seragam dokumen sejenis | Template SPO, kebijakan, pedoman | Template dokumen terkunci per jenis (header, nomor, tanggal terbit, halaman, pengesah) |
| 3c Dokumen internal tingkat a–c | Inventaris dokumen per tingkat dan per unit | Struktur folder per tingkat dan unit; laporan kelengkapan dokumen per unit untuk persiapan survei |

Catatan untuk developer: SPO yang berlaku perlu bisa ditautkan dari layar klinis (misalnya tautan SPO transfusi di form permintaan darah). Ini membantu bukti bahwa SPO tersosialisasi dan dipakai.

### MRMIK 4: Penyebaran data tepat waktu dan sesuai format

Contoh penyebaran informasi yang disebut KMK: pelaporan dan pembaruan data di aplikasi **RS Online**; data kunjungan, pelayanan laboratorium dan radiologi, indikator layanan, morbiditas, mortalitas, dan 10 besar penyakit rawat jalan dan rawat inap berkode **ICD-10** pada **SIRS Online**; permintaan data spesifik; laporan dengan frekuensi yang dibutuhkan; format yang mudah dipakai; menghubungkan sumber data; serta interpretasi data. Penerima eksternal yang disebut: Kementerian Kesehatan, dinas kesehatan, dokter layanan primer, laboratorium luar, RS rujukan, dan pasien yang meminta rekam medisnya.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 4a Penyebaran data memenuhi kebutuhan internal dan eksternal | Daftar laporan wajib beserta jadwal dan penanggung jawab; bukti kirim RS Online dan SIRS Online | Generator laporan RL dan SIRS dari data transaksi, jadwal pengiriman otomatis, log kirim. Resume dan rujukan dapat dikirim elektronik ke faskes tujuan (rujuk balik). Portal pasien untuk permintaan salinan RM |
| 4b Data untuk perawatan pasien diterima tepat waktu dan format seragam | Indikator waktu tunggu hasil lab dan radiologi, SPO pelaporan hasil | Hasil penunjang langsung muncul di RME dengan notifikasi ke DPJP; nilai kritis memicu notifikasi prioritas dengan konfirmasi baca. Kriteria: waktu dari validasi hasil sampai tampil di RME tercatat dan bisa dilaporkan |

## Kelompok c: Rekam medis elektronik pasien (25 EP)

Inilah inti RME. Delapan standar ini menentukan bentuk data klinis: satu identitas pasien, isi minimal, penanda siapa dan kapan per entri, koreksi, koding, kerahasiaan, retensi, dan audit kelengkapan.

### MRMIK 5: Penyelenggaraan RME dari masuk sampai keluar

KMK merinci kegiatan pengelolaan rekam medis: penerimaan pasien, asembling, analisis, koding, indeksing, penyimpanan, pelaporan, dan pemusnahan. Proses berlangsung sampai pasien pulang, dirujuk, atau meninggal. Informasi dalam RME **wajib disimpan aman di tiga tempat: server di dalam RS, salinan backup rutin, dan data virtual (cloud) atau backup di luar RS**.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 5a Regulasi penyelenggaraan RME | Peraturan direktur tentang RME: ruang lingkup, alur, hak akses, TTE, retensi, downtime | Tidak ada fitur wajib; sediakan contoh regulasi yang sesuai dengan fitur produk |
| 5b Unit penyelenggara RM, minimal 1 orang kompeten | SK unit rekam medis, struktur, uraian tugas, perekam medis bersertifikat | Peran khusus "perekam medis" dan "koder" di RBAC dengan menu asembling, analisis kuantitatif, koding |
| 5c RM dari masuk sampai pulang, dirujuk, atau meninggal | Telusur satu pasien dari registrasi sampai pulang (metode telusur surveior) | Siklus encounter lengkap dengan status yang jelas; status keluar wajib diisi (pulang, rujuk, APS, meninggal) bersama dokumen penutupnya (resume, surat rujukan, surat kematian). Encounter tidak dapat ditutup bila dokumen wajib belum lengkap |
| 5d Keamanan dan kerahasiaan lewat penjaminan mutu oleh tim reviu | SK tim reviu, laporan reviu berkala | Paket laporan untuk tim reviu: akses tidak wajar, perubahan data, status backup, hasil uji restore |

### MRMIK 6: Satu pasien, satu nomor, format seragam

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 6a Satu nomor RM sesuai sistem penomoran | Kebijakan penomoran (unit numbering), laporan nomor ganda | Master Patient Index dengan pencocokan NIK, nama, tanggal lahir, nama ibu; peringatan kemungkinan duplikat saat registrasi; alur merge berjejak dan dapat dibatalkan; integrasi cek NIK Dukcapil dan IHS number SATUSEHAT |
| 6b RM ralan, ranap, IGD, penunjang sesuai ketetapan | Daftar formulir per setting yang ditetapkan RS | Paket formulir per setting pelayanan; formulir wajib per setting dapat dikonfigurasi RS |
| 6c Formulir dievaluasi dan diperbarui berkala | Notulen evaluasi formulir oleh komite/tim RM | Master formulir berversi (form engine): setiap entri menyimpan versi formulir yang dipakai sehingga data lama tetap terbaca setelah formulir diubah |

### MRMIK 7: Isi rekam medis

Isi RM harus memadai untuk enam tujuan: mengidentifikasi pasien, mendukung diagnosis, justifikasi pengobatan, mendokumentasikan hasil pemeriksaan dan pengobatan, memuat ringkasan pasien pulang, dan menjaga kesinambungan pelayanan antar-PPA.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 7a Isi sesuai ketetapan RS dan peraturan | Regulasi isi minimal RM per setting (mengacu Permenkes 24/2022) | Field wajib per formulir, validasi sebelum simpan final, daftar periksa kelengkapan per encounter |
| 7b Isi memadai untuk 6 tujuan | Sampel RM yang lengkap saat telusur | Pemetaan ke fitur: identitas (MPI), diagnosis (ICD-10 terstruktur), justifikasi (asesmen dan CPPT/SOAP), hasil (lab, radiologi, tindakan terhubung ke order), ringkasan pulang (resume medis yang menarik data otomatis), kesinambungan (CPPT terintegrasi lintas PPA, serah terima, ringkasan pasien satu layar) |

### MRMIK 8: Identitas penulis, waktu, dan koreksi

Setiap pengisian RM harus mencantumkan tanggal, jam, serta identitas PPA berupa nama jelas dan tanda tangan atau paraf. RS menetapkan proses koreksi dan memantaunya.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 8a PPA mencantumkan identitas jelas | Sampel entri dengan nama dan tanda tangan | Identitas penulis diambil dari sesi login, bukan diketik. Tanda tangan elektronik (TTE tersertifikasi untuk dokumen legal, misalnya resume dan informed consent). Larangan akun bersama ditegakkan dengan login per orang dan sesi berbatas waktu |
| 8b Tanggal dan waktu setiap catatan teridentifikasi | Sampel entri dengan waktu | Dua stempel waktu: waktu kejadian klinis (diisi PPA) dan waktu pencatatan (dari server, tidak dapat diubah). Selisih besar ditandai sebagai entri terlambat |
| 8c Prosedur koreksi di RME | SPO koreksi RME | Entri final tidak dapat dihapus atau ditimpa. Koreksi membuat versi baru dengan alasan wajib, menyimpan versi lama, dan menampilkan tanda "dikoreksi" yang bisa diklik untuk melihat riwayat. Addendum terpisah untuk tambahan informasi |
| 8d Monev penulisan identitas, waktu, koreksi | Laporan berkala dan tindak lanjut | Laporan: jumlah koreksi per PPA dan unit, entri terlambat, entri tanpa TTE, alasan koreksi terbanyak |

### MRMIK 9: Kode, simbol, dan singkatan baku

KMK menegaskan prinsip koding: **ICD-10 untuk penyakit dan ICD-9-CM untuk tindakan**, serta daftar singkatan dan simbol yang boleh dan tidak boleh digunakan.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 9a Kode, singkatan, simbol sesuai ketetapan | SK daftar singkatan dan simbol baku serta yang dilarang; kebijakan koding | Master ICD-10 dan ICD-9-CM berversi (termasuk versi yang dipakai INA-CBG), pencarian kode di layar dokter, master singkatan dengan status "boleh/dilarang"; peringatan saat singkatan terlarang diketik di teks bebas (misalnya pada instruksi obat) |
| 9b Evaluasi berkala penggunaan kode | Laporan audit koding dan tindak lanjut | Laporan ketepatan koding (sampel ulang oleh koder), diagnosis tidak spesifik (kode .9), diagnosis kosong, temuan singkatan terlarang |

### MRMIK 10: Keamanan, kerahasiaan, kepemilikan, privasi

Rekam medis dipakai untuk tujuan klinis, penelitian, bukti hukum, administrasi, dan keuangan sehingga aksesnya dibatasi. Pimpinan RS bertanggung jawab atas kehilangan, kerusakan, pemalsuan, atau penggunaan tidak sah. Setiap pengisian harus terjamin otentikasinya.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 10a Otoritas pengisian, isi, format | SK kewenangan pengisian RM per profesi | Hak tulis per formulir per profesi (misalnya asesmen medis hanya dokter, asesmen keperawatan hanya perawat), hak co-sign oleh DPJP |
| 10b Hak akses pelepasan informasi | SPO pelepasan informasi, formulir permintaan, persetujuan pasien | Modul pelepasan informasi (release of information): permintaan, verifikasi identitas pemohon, persetujuan pasien atau dasar hukum, rilis dokumen terwatermark, log penyerahan |
| 10c Otentikasi, keamanan, kerahasiaan sebagai hak pasien | Kebijakan privasi pasien, mekanisme permintaan privasi | TTE dan verifikasi dokumen (QR), penandaan pasien rahasia (VIP, kasus sensitif) dengan akses terbatas, portal pasien untuk melihat dan mengunduh RM sesuai ketentuan, log siapa saja yang mengakses RM pasien tersebut |

### MRMIK 11: Masa simpan dan pemusnahan

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 11a Regulasi masa simpan dan prosedur pemusnahan | Jadwal retensi arsip dan SPO pemusnahan | Konfigurasi masa simpan per jenis dokumen dan per kelompok kasus |
| 11b Pemusnahan aman setelah masa simpan | Berita acara pemusnahan | Daftar kandidat pemusnahan otomatis, persetujuan berjenjang, penghapusan aman termasuk di backup (atau kripto-shredding), berita acara terbuat otomatis, meta-data pemusnahan disimpan |
| 11c Dokumen bernilai guna disimpan permanen | Daftar dokumen permanen yang ditetapkan RS | Penanda "simpan permanen" yang mengecualikan dokumen dari pemusnahan, misalnya ringkasan pulang, informed consent, identitas, laporan operasi |

### MRMIK 12: Pengkajian rekam medis

Pengkajian dilakukan oleh komite atau tim RM yang melibatkan tenaga medis, keperawatan, dan PPA lain, berbasis sampel yang mewakili PPA dan jenis pelayanan, untuk pasien yang masih dirawat dan yang sudah pulang.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 12a Penetapan komite/tim RM | SK komite/tim RM | Peran "auditor RM" dengan akses baca lintas unit dan berjejak |
| 12b Pengkajian berkala tiap tahun dengan sampel | Rencana sampling, instrumen pengkajian, hasil | Modul audit RM: penarikan sampel acak terstratifikasi per unit, PPA, dan status rawat; instrumen audit dapat dikonfigurasi |
| 12c Fokus ketepatan waktu, keterbacaan, kelengkapan, isi | Rekap hasil per aspek | Skor kelengkapan otomatis per encounter dan per PPA (field wajib, TTE, resume dalam batas waktu); keterbacaan praktis terpenuhi oleh entri digital, sehingga fokus bergeser ke kualitas teks bebas dan copy-paste |
| 12d Hasil dilaporkan ke pimpinan dan ditindaklanjuti | Laporan ke direksi, rencana perbaikan | Ekspor laporan audit, tren antar periode, umpan balik otomatis ke PPA yang bersangkutan |

## Kelompok d: Teknologi informasi kesehatan dan downtime (8 EP)

### MRMIK 13: SIMRS sebagai sistem terintegrasi

KMK mendefinisikan SIMRS sebagai sistem yang memproses dan mengintegrasikan seluruh alur proses pelayanan RS. Pengembangan sistem harus mendukung tiga tingkat: operasional (kecepatan, akurasi, integrasi, efisiensi, kemudahan pelaporan), manajerial (kecepatan keputusan dan identifikasi masalah), dan organisasi (budaya kerja, transparansi, koordinasi antarunit, penurunan biaya administrasi). Bila sistem lama tidak lagi sesuai, RS diharapkan mengembangkan sistem yang lebih optimal. Penanggung jawab TI kesehatan wajib setidaknya: merekomendasikan sumber daya, mengkoordinasikan pengkajian risiko keamanan informasi, memastikan staf terlatih keamanan informasi, dan menetapkan ukuran efektivitas RME bagi staf dan pasien.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 13a Regulasi penyelenggaraan TI kesehatan | Kebijakan TI: tata kelola, keamanan, pengembangan, pengadaan, kontinuitas | Dokumentasi produk yang dapat dirujuk regulasi RS: arsitektur, kebijakan keamanan vendor, SLA |
| 13b SIMRS diterapkan sesuai ketetapan dan peraturan | Bukti modul berjalan di semua unit, kepatuhan integrasi nasional | Kesesuaian dengan regulasi: RME (Permenkes 24/2022), SATUSEHAT, PDP. Matriks kepatuhan regulasi sebagai bagian dari dokumentasi rilis |
| 13c Unit penyelenggara SIMRS dipimpin staf kompeten | SK unit SIMRS, kualifikasi kepala unit | Peran admin RS terpisah dari admin vendor; konsol admin untuk tim TI RS (pengguna, master data, konfigurasi) tanpa akses database langsung |
| 13d Data klinis dan non klinis terintegrasi untuk keputusan | Contoh keputusan manajemen berbasis data SIMRS | Satu basis data atau model data bersama untuk klinis, keuangan, logistik, SDM; dasbor eksekutif yang memadukan BOR, ALOS, pendapatan, klaim, stok |
| 13e Penilaian efektivitas RME dan perbaikan | Hasil penilaian (survei kepuasan pengguna, indikator) dan rencana perbaikan | Metrik bawaan: waktu dokumentasi per pasien, waktu respons sistem, tingkat adopsi per unit, jumlah keluhan; survei kepuasan pengguna di aplikasi |

### MRMIK 13.1: Program waktu henti (downtime)

KMK mengakui interupsi sistem tidak dapat dihindari dan meminta RS memiliki rencana downtime terencana maupun tidak terencana: melatih staf prosedur alternatif, menguji program kegawatdaruratan, backup terjadwal, dan menguji prosedur pemulihan data.

| EP | Kacamata penyelenggara RS | Kacamata developer |
|---|---|---|
| 13.1a Prosedur downtime | SPO downtime: pengumuman, formulir kertas cadangan, alur komunikasi, entri susulan | Mode degradasi: salinan baca saja yang tetap tersedia (replika lokal atau cache berisi daftar pasien dirawat, alergi, obat aktif, CPPT terakhir); cetak paket darurat per ruangan secara berkala; fitur entri susulan (back-entry) yang menandai data sebagai input pasca downtime; pemberitahuan downtime terencana di aplikasi |
| 13.1b Staf dilatih perannya saat downtime | Bukti simulasi downtime per unit | Lingkungan latihan untuk simulasi; mode "latihan downtime" yang tidak memengaruhi data produksi |
| 13.1c Evaluasi pasca downtime | Laporan insiden downtime dan perbaikan | Pemantauan uptime, log insiden otomatis (mulai, selesai, dampak), laporan RTO dan RPO aktual dibandingkan target |

## Kapabilitas inti untuk developer

Ke-51 EP bermuara pada 12 kapabilitas yang sebaiknya dibangun sebagai layanan bersama, bukan fitur per modul. Bila kapabilitas ini benar sejak awal, sebagian besar EP kunci terpenuhi otomatis di semua modul.

| Kapabilitas | EP yang dipenuhi | Spesifikasi minimum | Pemetaan FHIR / standar |
|---|---|---|---|
| Master Patient Index | 6a, 7b | Satu ID internal, nomor RM tampilan, NIK, IHS number; deteksi duplikat dan merge berjejak | Patient, Patient.link |
| Identitas dan akses (IAM) | 2.1b, 10a, 13c | Akun per orang, MFA untuk akses jarak jauh, SSO, RBAC per peran, unit, dan relasi pasien; nonaktif otomatis dari data SDM | Practitioner, PractitionerRole |
| Audit trail | 2.1c, 5d, 8d, 10c | Log append-only untuk baca, ubah, hapus, cetak, ekspor; siapa, kapan, dari mana, data apa; retensi log terpisah dari data | AuditEvent, Provenance |
| Entri klinis bertanda tangan | 8a, 8b, 10c | Penulis dari sesi, waktu kejadian dan waktu catat, status draf/final, TTE untuk dokumen legal | Provenance, Composition.attester |
| Koreksi berversi | 8c | Tidak ada hapus/timpa; versi baru dengan alasan; addendum | Resource versioning (meta.versionId) |
| Form engine berversi | 6b, 6c, 7a | Definisi formulir sebagai data, field wajib, versi tersimpan per entri | Questionnaire, QuestionnaireResponse |
| Terminologi | 9a, 9b | ICD-10, ICD-9-CM, LOINC, SNOMED CT, KFA; daftar singkatan dan status larangan | CodeSystem, ValueSet, ConceptMap |
| Integration hub | 2b, 4a, 13d | Antrean pesan, retry, idempotensi, dasbor status kirim per tujuan | Bundle, SATUSEHAT, BPJS, SIRS |
| Pelaporan dan dasbor | 1b, 1d, 4a, 13d, 13e | Replika baca atau data warehouse; laporan terjadwal; dasbor per peran | MeasureReport (opsional) |
| Pelepasan informasi dan portal pasien | 4a, 10b, 10c | Permintaan, verifikasi, persetujuan, rilis berwatermark, log | Consent, DocumentReference |
| Retensi dan pemusnahan | 11a–11c | Kebijakan per jenis dokumen, legal hold, simpan permanen, berita acara | DocumentReference.status |
| Backup dan downtime | 2.2a, 5d, 13.1a–c | Backup terenkripsi di server RS, salinan rutin, dan lokasi luar RS/cloud; uji restore; mode baca saja dan entri susulan | — |

Prinsip desain yang harus dipegang:

**Audit dan versi sejak hari pertama.** Menambahkan audit trail setelah sistem berjalan hampir selalu bocor. Pasang di lapisan akses data (misalnya event sourcing atau tabel riwayat via trigger dan middleware), bukan di tiap layar.

**Server adalah satu-satunya sumber waktu dan identitas.** Waktu catat dan identitas penulis tidak pernah diambil dari input pengguna atau jam PC klien.

**Tidak ada akses database dari klien.** Semua akses melalui API yang menerapkan RBAC dan audit. Ini syarat agar EP 2.1 dan 10 dapat dibuktikan.

**Data terstruktur lebih dulu, teks bebas sebagai pelengkap.** Diagnosis, tindakan, obat, dan hasil disimpan berkode agar laporan (EP 4a) dan audit koding (EP 9b) tidak bergantung pada pembacaan manual.

**Formulir adalah konfigurasi, bukan kode.** RS wajib mengevaluasi dan memperbarui formulir secara berkala (EP 6c); jika setiap perubahan butuh rilis software, RS akan selalu tertinggal.

**Bukti akreditasi sebagai fitur.** Sediakan "paket bukti" yang dapat diekspor: laporan audit akses, log backup dan uji restore, rekap kelengkapan RM, log kirim ke sistem nasional. Surveior menilai bukti, bukan klaim vendor.

## Implikasi bagi penyelenggara RS

Membeli SIM RS yang baik hanya memenuhi sekitar 40% EP MRMIK (21 EP kunci). Sisanya ditentukan oleh struktur organisasi, regulasi, dan kebiasaan kerja yang dapat dibuktikan.

**Struktur yang wajib ada menurut EP:**

| Struktur | Dasar EP | Tugas utama terkait SIM RS |
|---|---|---|
| Unit rekam medis dengan minimal 1 orang kompeten | 5b | Asembling, analisis, koding, pelepasan informasi, retensi |
| Komite/tim rekam medis (lintas profesi) | 12a–12d | Pengkajian RM tahunan, evaluasi formulir (6c), evaluasi koding (9b) |
| Tim reviu keamanan data | 2.1, 5d | Reviu akses berkala, investigasi pelanggaran |
| Unit penyelenggara SIMRS dipimpin staf kompeten | 13c | Pengelolaan sistem, pengkajian risiko keamanan, pelatihan keamanan, ukuran efektivitas RME |

**Daftar regulasi dan dokumen yang perlu disiapkan** (centang saat selesai):

Pedoman manajemen informasi yang memetakan 7 kebutuhan a–g (1a)

Analisis kebutuhan informasi per pengguna (1b, 1c)

Matriks pelatihan sistem informasi dan RME per peran (2a)

Kebijakan keamanan informasi dan SK hak akses per jabatan (2.1a, 2.1b)

SPO pengajuan, perubahan, dan pencabutan akses (2.1b)

SPO backup, lokasi penyimpanan, dan uji restore (2.2a)

Pedoman tata naskah dan daftar induk dokumen (3a–3c)

Daftar laporan internal dan eksternal beserta jadwal (4a)

Peraturan direktur tentang penyelenggaraan RME (5a)

SK unit rekam medis dan uraian tugas (5b)

Kebijakan penomoran RM (6a) dan daftar formulir RM per setting (6b)

Regulasi isi minimal rekam medis (7a)

SPO koreksi pengisian RME (8c)

SK daftar kode, simbol, dan singkatan baku serta yang dilarang (9a)

SK kewenangan pengisian RM per profesi dan SPO pelepasan informasi (10a, 10b)

Jadwal retensi, SPO pemusnahan, dan daftar dokumen simpan permanen (11a–11c)

SK komite/tim RM dan instrumen pengkajian RM (12a–12c)

Kebijakan teknologi informasi kesehatan dan SK unit SIMRS (13a, 13c)

SPO downtime terencana dan tidak terencana, jadwal simulasi (13.1a, 13.1b)

**Kebiasaan yang dinilai surveior lewat telusur:**

Setiap staf login dengan akunnya sendiri. Satu kasus berbagi akun di nurse station dapat menggugurkan bukti EP 2.1 dan 8a.

Formulir RM benar-benar dievaluasi, bukan hanya ditetapkan sekali.

Hasil audit akses, koding, dan kelengkapan RM dilaporkan ke direksi dan ada tindak lanjut tercatat.

Simulasi downtime pernah dilakukan dan dievaluasi, bukan hanya SPO di atas kertas.

Dokumen bertanda tangan basah yang masih ada (persetujuan umum, informed consent, MoU) disimpan di lokasi aman dari panas, air, dan api, sebagaimana contoh dalam Maksud dan Tujuan MRMIK 2.1 dan 2.2.

**Kontrak dengan vendor SIM RS** sebaiknya memuat: kewajiban integrasi nasional dan pembaruannya, lokasi dan enkripsi data, hasil uji restore berkala, SLA ketersediaan dan RTO/RPO, akses audit log oleh RS, hak RS atas data dan format ekspor saat kontrak berakhir, serta laporan penetration test tahunan.

## Gap terhadap SIMRS Khanza

Perbandingan ini memakai hasil bedah kode SIMRS Khanza dari [dokumen sebelumnya](https://claude.ai/code/artifact/669e3b95-ed5d-47d6-ba2e-e62a0ec2ead4). Khanza kuat pada isi dan pelaporan (MRMIK 4, 6, 7, 9), tetapi lemah pada integritas dan keamanan (MRMIK 2.1, 2.2, 8c, 10, 13.1). Artinya RS pengguna Khanza cenderung lolos telusur isi RM, tetapi rentan pada telusur keamanan dan koreksi.

| Standar | Status di Khanza | Bukti di kode | Yang perlu ditambah di SIM RS baru |
|---|---|---|---|
| MRMIK 1 | Sebagian | Ratusan laporan dan grafik, portal eksekutif | Katalog laporan per pengguna, log permintaan data, ekspor riset ter-de-identifikasi |
| MRMIK 2 | Sebagian | Bridging SATUSEHAT, SIRS, BPJS lengkap | Dasbor status kirim terpusat; data pelatihan |
| MRMIK 2.1 | Lemah | Hak akses 1.218 kolom per user; log login (`tracker`) dan log SQL mentah (`trackersql`, bisa dimatikan lewat konfigurasi); tidak ada log baca | RBAC per peran dan relasi pasien, audit log baca dan ubah yang tidak dapat dimatikan, laporan anomali akses |
| MRMIK 2.2 | Lemah | Password terenkripsi dua arah dengan kunci tertanam; kredensial DB di setiap PC klien; tidak ada fitur backup bawaan | Hash password, enkripsi at-rest, backup tiga lokasi terkelola, uji restore terdokumentasi |
| MRMIK 3 | Belum | Modul surat untuk surat masuk/keluar, bukan pengendalian dokumen regulasi | Modul DMS berversi |
| MRMIK 4 | Kuat | Laporan RL 1.3–4B, SIRS, Dinkes, bridging SIRS Yankes | Penjadwalan kirim dan log kirim terpadu |
| MRMIK 5 | Sebagian | Alur registrasi sampai pulang, meninggal, rujuk lengkap | Penguncian encounter bila dokumen wajib belum lengkap; laporan untuk tim reviu |
| MRMIK 6 | Sebagian | Nomor RM tunggal, menu gabung RM, cek NIK Dukcapil dan SATUSEHAT; sekitar 250 formulir tetapi berupa kode, bukan konfigurasi | Deteksi duplikat otomatis; form engine berversi |
| MRMIK 7 | Kuat | Asesmen per spesialis, CPPT/SOAP, resume medis | Ringkasan pasien satu layar dan validasi kelengkapan sebelum final |
| MRMIK 8 | Lemah | Identitas penulis (NIP) tersimpan; TTE tersedia untuk sebagian dokumen; waktu entri dapat diisi pengguna dan opsi `TANGGALMUNDUR` mengizinkan tanggal mundur; edit menimpa data tanpa versi | Waktu catat dari server, koreksi berversi dengan alasan, addendum |
| MRMIK 9 | Sebagian | Master ICD-10 (`penyakit`) dan ICD-9 (`icd9`) | Master singkatan baku dan terlarang, laporan audit koding |
| MRMIK 10 | Lemah | Tidak ada alur pelepasan informasi; tidak ada penanda pasien rahasia | Modul ROI, penandaan pasien VIP, log akses per pasien |
| MRMIK 11 | Sebagian | Menu retensi RM dengan tabel `retensi_pasien` (tanggal retensi, lokasi PDF) | Jadwal retensi per jenis dokumen, simpan permanen, pemusnahan dengan berita acara |
| MRMIK 12 | Sebagian | Laporan status data RM, penyiapan dan sirkulasi berkas | Modul audit RM dengan sampling dan skor kelengkapan |
| MRMIK 13 | Sebagian | SIMRS terintegrasi luas, tetapi akses database langsung dari klien | Konsol admin tanpa akses DB, metrik efektivitas RME |
| MRMIK 13.1 | Belum | Tidak ada mode downtime atau entri susulan | Mode baca saja, cetak paket darurat, entri susulan bertanda, log insiden |

## Roadmap implementasi

Urutan ini mendahulukan fondasi yang mahal diubah belakangan (identitas, akses, audit, versi), lalu isi klinis, lalu tata kelola mutu RM. Pekerjaan regulasi RS berjalan paralel sejak fase 1.

**Fase 1: Fondasi kepatuhan.** MPI, IAM dan RBAC, audit trail, stempel waktu server, koreksi berversi, backup tiga lokasi, enkripsi. Memenuhi EP 2.1a–c, 2.2a, 6a, 8a–8c. Gerbang: uji penetrasi lulus dan uji restore berhasil dalam target RTO.

**Fase 2: Isi rekam medis.** Form engine berversi, paket formulir ralan, IGD, ranap, penunjang; CPPT; resume medis; master ICD-10, ICD-9-CM, dan singkatan; TTE. Memenuhi EP 5c, 6b, 6c, 7a, 7b, 9a, 10a, 10c. Gerbang: telusur satu pasien dari registrasi sampai pulang lengkap tanpa kertas.

**Fase 3: Integrasi dan pelaporan.** Integration hub SATUSEHAT, BPJS, SIRS Online, RS Online; laporan RL; hasil penunjang real-time dan nilai kritis; dasbor per peran. Memenuhi EP 2b, 4a, 4b, 13d, 1b. Gerbang: tingkat keberhasilan kirim di atas target yang disepakati selama satu bulan.

**Fase 4: Tata kelola RM.** Modul audit RM dan skor kelengkapan, pelepasan informasi, retensi dan pemusnahan, laporan koding dan koreksi, DMS regulasi. Memenuhi EP 3a, 8d, 9b, 10b, 11b, 11c, 12b, 12c. Gerbang: komite RM menjalankan satu siklus pengkajian penuh di sistem.

**Fase 5: Ketahanan dan perbaikan berkelanjutan.** Mode downtime, simulasi, pemantauan uptime, metrik efektivitas RME, data riset ter-de-identifikasi. Memenuhi EP 13e, 13.1a, 13.1c, 1d, 1e. Gerbang: simulasi downtime tak terencana dievaluasi dan perbaikannya ditutup.

Untuk RS yang mengejar jadwal survei, fase 1 dan 2 adalah syarat minimum; tanpa audit trail dan koreksi berversi, telusur MRMIK 2.1 dan 8 hampir pasti menghasilkan temuan.

## Risiko dan pertanyaan terbuka

**Risiko**

| Risiko | Dampak | Mitigasi |
|---|---|---|
| EP dinilai lewat telusur dan wawancara, bukan demo fitur | Fitur ada tetapi tidak dipakai, sehingga tetap jadi temuan | Paket bukti siap ekspor, pelatihan per peran, audit internal sebelum survei |
| Akun bersama di unit sibuk (IGD, nurse station) | Gugur bukti identitas penulis dan kontrol akses | Login cepat (kartu, sidik jari, PIN) dengan sesi pendek |
| Teks bebas dan copy-paste berlebihan | Isi RM tidak bermakna saat pengkajian MRMIK 12 | Template terstruktur, penanda teks yang disalin, audit kualitas isi |
| Pemusnahan data elektronik juga menghapus jejak hukum | Sengketa medikolegal tanpa bukti | Daftar simpan permanen, legal hold, meta-data pemusnahan disimpan |
| Backup tiga lokasi tanpa uji restore | Data hilang saat insiden nyata | Uji restore terjadwal dengan laporan sebagai bukti EP 2.2a |
| Ketergantungan pada vendor tanpa hak atas data | RS terkunci, sulit migrasi | Klausul ekspor data standar (FHIR atau SQL terdokumentasi) dalam kontrak |

**Pertanyaan terbuka yang perlu dijawab sebelum desain final**

Masa simpan RME per jenis dokumen: KMK hanya menyerahkan ke "peraturan perundang-undangan"; perlu dikonfirmasi dengan Permenkes 24/2022 dan aturan turunannya.

Dokumen mana yang masih wajib bertanda tangan basah? Maksud dan Tujuan MRMIK 2.1 dan 2.2 masih mencontohkan persetujuan umum dan informed consent dengan cap basah, sementara RME mendorong TTE. Kebijakan RS target perlu ditetapkan.

Penyedia TTE yang dipakai (tersertifikasi BSrE atau PSrE swasta) dan dokumen apa saja yang wajib TTE tersertifikasi.

Target RTO dan RPO yang realistis untuk kelas RS target.

Apakah data disimpan di pusat data RS, cloud nasional, atau hibrida, mengingat syarat tiga lokasi dan ketentuan pelindungan data pribadi.

Lembaga penyelenggara akreditasi yang akan menilai, karena instrumen telusur dan penekanan antar lembaga dapat berbeda.

Sumber: KMK HK.01.07/MENKES/1596/2024 tentang Standar Akreditasi Rumah Sakit, Lampiran Bab III bagian A.5 (MRMIK), halaman 148–171, dan bagian lain yang dirujuk dengan nomor halaman. Klasifikasi peran SIM RS, spesifikasi developer, dan perbandingan dengan Khanza adalah analisis, bukan isi KMK.
