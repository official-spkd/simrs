# Audit 80 layar · CX-0

- Pemilik: Codex; 6 Okt 2026. Basis `master` 34f38d1 + CX-1, dengan pembagian terbaru e997e9c.
- Inventaris: **80 entri registri** `apps/web/src/lib/screens.ts`. Kontrol antrean `kendali` hanya API; ketersediaan demo mengikuti status registri.
- Metode: graph Tier 2 untuk struktur, baca langsung fixture/tes yang dikecualikan, pencarian label/handler, dan E2E `semua-layar` desktop + tablet.
- Batas bukti: E2E semua layar membuktikan route, akses posisi, tidak ada galat JS, dan overflow. **Tidak membuktikan setiap tombol sudah diklik**. Pemeriksaan aksi lengkap ada pada E2E domain Penunjang/Integrasi; domain Claude tetap perlu bukti masing-masing.
- Koordinasi terbaru: Keuangan/BTN dan Back Office/Manajemen dikerjakan Claude (`cd/cx-2`, `cd/cx-3`), bukan sesi Codex ini.

## Inventaris dan aliran yang harus diuji

| Layar | Rute | Pemilik | Penyimpanan pada checkpoint | Aliran / verifikasi | Halaman sumber |
| --- | --- | --- | --- | --- | --- |
| `simulasi` · Simulasi pasien | `/simulasi` | CD-0 | mesin skenario | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/simulasi/page.tsx` |
| `daftar` · Pendaftaran | `/pendaftaran` | CD-3 | toko CD-3 (master) | registrasi → tiket, worklist | `apps/web/src/app/(staf)/pendaftaran/page.tsx` |
| `jadwal` · Jadwal dokter | `/jadwal` | CD-3 | toko CD-3 (master) | booking → antrean/display | `apps/web/src/app/(staf)/jadwal/page.tsx` |
| `kiosk` · Anjungan mandiri | `/kiosk` | CD-3 | toko CD-3 (master) | check-in → tiket | `apps/web/src/app/(perangkat)/kiosk/page.tsx` |
| `antrean` · Display antrean | `/display/antrean` | CD-3 | toko CD-3 (master) | display membaca antrean | `apps/web/src/app/(perangkat)/display/antrean/page.tsx` |
| `kendali` · Kendali antrean | `/antrean` | CD-3 | toko CD-3 (master) | API-only; jangan menyimpulkan demo | `apps/web/src/app/(staf)/antrean/page.tsx` |
| `poli` · Pemeriksaan poli | `/klinis/poli` | CD-2 | branch CD-2 sedang diuji; master masih lama | CPPT/order → worklist/kasir | `apps/web/src/app/(staf)/klinis/poli/page.tsx` |
| `order` · Order & resep (CPOE) | `/klinis/order` | CD-2 | branch CD-2 sedang diuji; master masih lama | order ber-TTE → penunjang + charge | `apps/web/src/app/(staf)/klinis/order/page.tsx` |
| `igd` · IGD | `/klinis/igd` | CD-2 | branch CD-2 sedang diuji; master masih lama | triase/admisi → bed + command center | `apps/web/src/app/(staf)/klinis/igd/page.tsx` |
| `bed` · Tempat tidur | `/klinis/tempat-tidur` | CD-2 | branch CD-2 sedang diuji; master masih lama | alokasi/status → ranap + tagihan kamar | `apps/web/src/app/(staf)/klinis/tempat-tidur/page.tsx` |
| `ranap` · Rawat inap | `/klinis/rawat-inap` | CD-2 | branch CD-2 sedang diuji; master masih lama | CPPT/eMAR → worklist + charge | `apps/web/src/app/(staf)/klinis/rawat-inap/page.tsx` |
| `resume` · Resume medis | `/klinis/resume` | CD-2 | branch CD-2 sedang diuji; master masih lama | resume final → bed/klaim | `apps/web/src/app/(staf)/klinis/resume/page.tsx` |
| `consent` · Persetujuan tindakan | `/tablet/persetujuan` | CD-2 | branch CD-2 sedang diuji; master masih lama | consent final/ditolak → OK/kelengkapan | `apps/web/src/app/(perangkat)/tablet/persetujuan/page.tsx` |
| `lab` · Laboratorium | `/penunjang/lab` | CX-1 | toko server + skenario | Gateway → hasil; validasi/read-back → kritis + Integrasi | `apps/web/src/app/(staf)/penunjang/lab/page.tsx` |
| `rad` · Radiologi | `/penunjang/radiologi` | CX-1 | toko server + skenario | hasil ber-TTE → Integrasi/klinis | `apps/web/src/app/(staf)/penunjang/radiologi/page.tsx` |
| `farmasi` · Farmasi | `/penunjang/farmasi` | CX-1 | toko server + skenario | dispensing → saldo Depo; kontrak obat → eMAR/charge | `apps/web/src/app/(staf)/penunjang/farmasi/page.tsx` |
| `ok` · Kamar operasi | `/penunjang/kamar-operasi` | CX-1 | toko server + skenario | WHO/insisi/selesai → Procedure/charge/resume | `apps/web/src/app/(staf)/penunjang/kamar-operasi/page.tsx` |
| `kritis` · Pusat hasil kritis | `/penunjang/hasil-kritis` | CX-1 | toko server + skenario | read-back → Lab/klinis/app dokter | `apps/web/src/app/(staf)/penunjang/hasil-kritis/page.tsx` |
| `depo` · Depo & stok farmasi | `/penunjang/depo` | CX-1 | toko server + skenario | FEFO/transfer/opname → saldo Farmasi | `apps/web/src/app/(staf)/penunjang/depo/page.tsx` |
| `bank-darah` · Bank darah | `/penunjang/bank-darah` | CX-1 | toko server + skenario | dua akun → issue → bedside → TTV/reaksi | `apps/web/src/app/(staf)/penunjang/bank-darah/page.tsx` |
| `gizi` · Gizi | `/penunjang/gizi` | CX-1 | toko server + skenario | MST/verifikasi/baki → distribusi; diet CD-2 belum terbit | `apps/web/src/app/(staf)/penunjang/gizi/page.tsx` |
| `mikro` · Mikrobiologi & PA | `/penunjang/mikrobiologi` | CX-1 | toko server + skenario | Gram kritis → pusat kritis; final → Integrasi | `apps/web/src/app/(staf)/penunjang/mikrobiologi/page.tsx` |
| `diagnostik` · Diagnostik lain | `/penunjang/diagnostik` | CX-1 | toko server + skenario | hasil final/kritis → Integrasi/pusat kritis | `apps/web/src/app/(staf)/penunjang/diagnostik/page.tsx` |
| `kasir` · Kasir | `/keuangan/kasir` | Claude CX-2 | migrasi oleh Claude sedang berjalan | pelunasan → jurnal/piutang/klaim | `apps/web/src/app/(staf)/keuangan/kasir/page.tsx` |
| `klaim` · Klaim & koding | `/keuangan/klaim` | Claude CX-2 | migrasi oleh Claude sedang berjalan | final → piutang BPJS/pembiayaan | `apps/web/src/app/(staf)/keuangan/klaim/page.tsx` |
| `akuntansi` · Akuntansi | `/keuangan/akuntansi` | Claude CX-2 | migrasi oleh Claude sedang berjalan | jurnal berimbang + penyetuju kedua → tutup periode | `apps/web/src/app/(staf)/keuangan/akuntansi/page.tsx` |
| `pembayaran` · Pembayaran digital | `/keuangan/pembayaran` | Claude CX-2 | migrasi oleh Claude sedang berjalan | VA/QRIS → rekonsiliasi kasir/BTN | `apps/web/src/app/(staf)/keuangan/pembayaran/page.tsx` |
| `pembiayaan` · Pembiayaan BTN | `/keuangan/pembiayaan` | Claude CX-2 | migrasi oleh Claude sedang berjalan | piutang BPJS final → pengajuan/pencairan | `apps/web/src/app/(staf)/keuangan/pembiayaan/page.tsx` |
| `tarif` · Tarif & paket | `/keuangan/tarif` | Claude CX-2 | migrasi oleh Claude sedang berjalan | versi tarif → tagihan/charge | `apps/web/src/app/(staf)/keuangan/tarif/page.tsx` |
| `charge` · Charge capture | `/keuangan/charge-capture` | Claude CX-2 | migrasi oleh Claude sedang berjalan | klinis/penunjang/FO → item tagihan | `apps/web/src/app/(staf)/keuangan/charge-capture/page.tsx` |
| `piutang` · Penjaminan & piutang | `/keuangan/piutang` | Claude CX-2 | migrasi oleh Claude sedang berjalan | pelunasan/klaim → saldo piutang | `apps/web/src/app/(staf)/keuangan/piutang/page.tsx` |
| `koding` · Workbench koder | `/keuangan/koding` | Claude CX-2 | migrasi oleh Claude sedang berjalan | diagnosis/resume → koding/klaim | `apps/web/src/app/(staf)/keuangan/koding/page.tsx` |
| `jaspel` · Jasa pelayanan | `/keuangan/jasa-pelayanan` | Claude CX-2 | migrasi oleh Claude sedang berjalan | layanan dibayar → distribusi/jurnal | `apps/web/src/app/(staf)/keuangan/jasa-pelayanan/page.tsx` |
| `kas-bank` · Kas & bank | `/keuangan/kas-bank` | Claude CX-2 | migrasi oleh Claude sedang berjalan | setoran/transfer/rekon → jurnal | `apps/web/src/app/(staf)/keuangan/kas-bank/page.tsx` |
| `hutang` · Hutang usaha | `/keuangan/hutang` | Claude CX-2 | migrasi oleh Claude sedang berjalan | GRN/faktur → hutang → jurnal | `apps/web/src/app/(staf)/keuangan/hutang/page.tsx` |
| `costing` · Costing & case-mix | `/keuangan/costing` | Claude CX-2 | migrasi oleh Claude sedang berjalan | biaya/layanan → margin | `apps/web/src/app/(staf)/keuangan/costing/page.tsx` |
| `integrasi` · Integrasi | `/sistem/integrasi` | CX-1 | toko server + skenario | log kejadian → hub/downtime/DLQ | `apps/web/src/app/(staf)/sistem/integrasi/page.tsx` |
| `satusehat` · SATUSEHAT | `/sistem/integrasi/satusehat` | CX-1 | toko server + skenario | hasil → IHS/Encounter → resource anak | `apps/web/src/app/(staf)/sistem/integrasi/satusehat/page.tsx` |
| `bpjs` · Konektor BPJS | `/sistem/integrasi/bpjs` | CX-1 | toko server + skenario | task berurutan + backlog downtime → sinkron | `apps/web/src/app/(staf)/sistem/integrasi/bpjs/page.tsx` |
| `kemenkes` · Kemenkes (SIRS) | `/sistem/integrasi/kemenkes` | CX-1 | toko server + skenario | perbaikan sumber → validasi → laporan | `apps/web/src/app/(staf)/sistem/integrasi/kemenkes/page.tsx` |
| `perangkat` · Perangkat medis | `/sistem/integrasi/perangkat` | CX-1 | toko server + skenario | ORU → hasil Lab; PID disamarkan; dedup | `apps/web/src/app/(staf)/sistem/integrasi/perangkat/page.tsx` |
| `api-publik` · API publik & FHIR | `/sistem/integrasi/api-publik` | CX-1 | toko server + skenario | registrasi/scopes/rotasi/suspend → log | `apps/web/src/app/(staf)/sistem/integrasi/api-publik/page.tsx` |
| `logistik` · Logistik | `/manajemen/logistik` | Claude CX-3 | migrasi oleh Claude sedang berjalan | ROP/PO/penerimaan → stok + hutang | `apps/web/src/app/(staf)/manajemen/logistik/page.tsx` |
| `mutu` · Mutu & keselamatan | `/manajemen/mutu` | Claude CX-3 | migrasi oleh Claude sedang berjalan | kejadian indikator → Dasbor | `apps/web/src/app/(staf)/manajemen/mutu/page.tsx` |
| `dasbor` · Dasbor eksekutif | `/manajemen/dasbor` | Claude CX-3 | migrasi oleh Claude sedang berjalan | kejadian mutu/layanan → KPI | `apps/web/src/app/(staf)/manajemen/dasbor/page.tsx` |
| `app-pasien` · Aplikasi pasien (pratinjau) | `/pratinjau/aplikasi-pasien` | Claude CX-3 | migrasi oleh Claude sedang berjalan | booking → antrean; tagihan → pembayaran | `apps/web/src/app/(perangkat)/pratinjau/aplikasi-pasien/page.tsx` |
| `app-dokter` · Aplikasi dokter (pratinjau) | `/pratinjau/aplikasi-dokter` | Claude CX-3 | migrasi oleh Claude sedang berjalan | hasil kritis/read-back → pusat kritis | `apps/web/src/app/(perangkat)/pratinjau/aplikasi-dokter/page.tsx` |
| `worklist` · Worklist klinis | `/klinis/worklist` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/worklist/page.tsx` |
| `cppt` · CPPT & serah terima | `/klinis/cppt` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/cppt/page.tsx` |
| `asesmen` · Asesmen & skrining | `/klinis/asesmen` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/asesmen/page.tsx` |
| `diagnosis` · Diagnosis & problem list | `/klinis/diagnosis` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/diagnosis/page.tsx` |
| `konsul` · Konsultasi & rawat bersama | `/klinis/konsultasi` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/konsultasi/page.tsx` |
| `edukasi` · Edukasi pasien | `/klinis/edukasi` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/edukasi/page.tsx` |
| `askep` · Asuhan keperawatan | `/klinis/asuhan-keperawatan` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/asuhan-keperawatan/page.tsx` |
| `ringkasan` · Ringkasan pasien | `/klinis/ringkasan` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/ringkasan/page.tsx` |
| `paket` · Paket layanan khusus | `/klinis/paket-layanan` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/paket-layanan/page.tsx` |
| `kelengkapan` · Kelengkapan rekam medis | `/klinis/kelengkapan` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/kelengkapan/page.tsx` |
| `struktur` · Struktur RS | `/sistem/struktur` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/sistem/struktur/page.tsx` |
| `pengaturan` · Pengaturan RS | `/sistem/pengaturan` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/sistem/pengaturan/page.tsx` |
| `terminologi` · Data rujukan | `/sistem/terminologi` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/sistem/terminologi/page.tsx` |
| `dokumen` · Dokumen & TTE | `/rekam-medis/dokumen` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/rekam-medis/dokumen/page.tsx` |
| `penjadwal` · Penjadwal pekerjaan | `/sistem/penjadwal` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/sistem/penjadwal/page.tsx` |
| `rujukan` · Rujukan | `/rujukan` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/rujukan/page.tsx` |
| `info-publik` · Info publik (pratinjau) | `/pratinjau/info-publik` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(perangkat)/pratinjau/info-publik/page.tsx` |
| `downtime` · Mode downtime | `/sistem/downtime` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/sistem/downtime/page.tsx` |
| `cadangan` · Cadangan & pemulihan | `/sistem/cadangan` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/sistem/cadangan/page.tsx` |
| `golive` · Kesiapan go-live | `/sistem/go-live` | CD-3 | toko CD-3 (master) | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/sistem/go-live/page.tsx` |
| `rm-adm` · RM administratif | `/rekam-medis/administrasi` | Claude CX-3 | migrasi oleh Claude sedang berjalan | ROI/pinjaman/retensi → jejak sesi | `apps/web/src/app/(staf)/rekam-medis/administrasi/page.tsx` |
| `sdm` · SDM & kepegawaian | `/manajemen/sdm` | Claude CX-3 | migrasi oleh Claude sedang berjalan | roster/kredensial → penugasan | `apps/web/src/app/(staf)/manajemen/sdm/page.tsx` |
| `kredensial` · Kredensial & kewenangan | `/manajemen/kredensial` | Claude CX-3 | migrasi oleh Claude sedang berjalan | komite/RKK → hak klinis | `apps/web/src/app/(staf)/manajemen/kredensial/page.tsx` |
| `ppi` · PPI | `/manajemen/ppi` | Claude CX-3 | migrasi oleh Claude sedang berjalan | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/manajemen/ppi/page.tsx` |
| `aset` · Aset & pemeliharaan | `/manajemen/aset` | Claude CX-3 | migrasi oleh Claude sedang berjalan | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/manajemen/aset/page.tsx` |
| `penggajian` · Penggajian | `/manajemen/penggajian` | Claude CX-3 | migrasi oleh Claude sedang berjalan | persetujuan dua akun → jurnal | `apps/web/src/app/(staf)/manajemen/penggajian/page.tsx` |
| `ppra` · PPRA | `/manajemen/ppra` | Claude CX-3 | migrasi oleh Claude sedang berjalan | komite antibiotik → tindak lanjut | `apps/web/src/app/(staf)/manajemen/ppra/page.tsx` |
| `regdok` · Dokumen & akreditasi | `/manajemen/dokumen` | Claude CX-3 | migrasi oleh Claude sedang berjalan | review/TTE dua akun → versi dokumen | `apps/web/src/app/(staf)/manajemen/dokumen/page.tsx` |
| `pengaduan` · Pengalaman pasien | `/manajemen/pengaduan` | Claude CX-3 | migrasi oleh Claude sedang berjalan | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/manajemen/pengaduan/page.tsx` |
| `pendidikan` · Pendidikan klinik | `/manajemen/pendidikan` | Claude CX-3 | migrasi oleh Claude sedang berjalan | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/manajemen/pendidikan/page.tsx` |
| `onkologi` · Onkologi | `/klinis/onkologi` | CD-2 | branch CD-2 sedang diuji; master masih lama | aksi domain → data terkait; audit pemilik | `apps/web/src/app/(staf)/klinis/onkologi/page.tsx` |
| `command-center` · Command center | `/manajemen/command-center` | Claude CX-3 | migrasi oleh Claude sedang berjalan | bed/IGD/antrean → papan situasi | `apps/web/src/app/(staf)/manajemen/command-center/page.tsx` |
| `dataset-riset` · Dataset riset | `/manajemen/dataset-riset` | Claude CX-3 | migrasi oleh Claude sedang berjalan | otorisasi dua akun → dataset/jejak | `apps/web/src/app/(staf)/manajemen/dataset-riset/page.tsx` |

## Temuan yang perlu ditutup sebelum semua frontend dinyatakan selesai

| Prioritas | Bukti / pemicu | Dampak dan tindakan | Pemilik |
| --- | --- | --- | --- |
| P1 | CPOE `order.ditandatangani.lines[]` tidak punya jumlah/rute/frekuensi/dosis sebagai field terstruktur | Resep masuk daftar kelengkapan Farmasi; jangan menetapkan jumlah/dosis dari nama obat atau resep pasien lain. Tambahkan instruksi resep terstruktur pada kontrak dan uji CPOE → Farmasi → dispensing. | CD-2 + CX-1 |
| P1 | CD-2 meminta `hasil.divalidasi` dan `obat.diserahkan`; CX-1 sementara menerbitkan aksi atomik dengan `released[]` / `dispensations[]` | Pelanggan dapat memproyeksikan reducer Penunjang atau kontrak disepakati sebelum klinis/eMAR/charge dianggap mengalir. Ini belum sama dengan eMAR sudah diberikan. | CD-2 + Claude CX-2 + CX-1 |
| P1 | Belum ada kejadian diet DPJP pada kontrak CD-2 | Gizi interaktif lokal, tetapi order diet baru DPJP belum mengalir. Perlu publisher diet dan tes NPO/alergi setelah perubahan. | CD-2 + CX-1 |
| P1 | `fixtures/kas-bank.ts` mencatat INV-02203 463.500 dan INV-02209 248.500; sumber Kasir/BTN harus dibandingkan | Mutasi dan tagihan wajib memakai identitas invoice dan saldo yang sama. Angka harus dibaca dari toko Keuangan, tidak salinan teks fixture. | Claude CX-2 |
| P1 | `fixtures/manajemen.ts` lot PCT2512 = 60; fixture Depo batch sama mempunyai saldo gudang berbeda | Logistik → penerimaan → Depo harus satu saldo per batch/depo. Bandingkan sebelum/sesudah GRN dan dispensing. | Claude CX-3 + CX-1 |
| P1 | CD-2 handoff masih menyebut verifikator kemo/perawat kedua dari dropdown nama | Pemisahan tugas harus berdasar dua id pengguna sesi. Uji dua akun dan tolak id yang sama meski nama berbeda. | CD-2 |
| P1 | Banyak label `simulasi, tidak disimpan` pada master lama (bagan RME, Kasir/BTN, keuangan, ROI, roster) | Tunggu dan integrasikan migrasi domain pemilik; reload/ganti posisi wajib mengembalikan aksi. Jangan sekadar mengganti label. | CD-2 + Claude CX-2/CX-3 |
| P2 | `retention-tab.tsx` memakai handler kosong pada tombol pemusnahan elektronik | Tombol memang ditahan ReasonButton dengan alasan; ini bukan temuan tombol mati tanpa konteks. Tetap pastikan alasan terbaca dan akses keyboard. | Claude CX-3 |
| P2 | Indikator Lab/OK/hub masih mencampur agregat fixture dan kejadian demo | Cantumkan cakupan agregat contoh atau turunkan indikator dari sumber yang sama; jangan menyamakan fixture 412 sampel dengan 8 sampel worklist. | CX-1 + CX-4 |
| P2 | Graph melaporkan beberapa halaman keuangan partial parse | Klaim audit harus memakai source fallback pada baris yang terlewat, bukan hanya hasil graph. | CX-4 |

## Bukti CX-1

Bank darah dua akun dan reload; high-alert Farmasi dua akun; Gateway → Lab lintas posisi; reset ruang RS; validasi klinis hanya dokter; serta seluruh route demo sudah diuji desktop/tablet. Tes kontrak CPOE/consent adalah replay reducer sampai modul klinis CD-2 digabung; bukan pengganti E2E lintas domain.
