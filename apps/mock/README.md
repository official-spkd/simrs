# @simrs/mock

Mock semua integrasi eksternal (ADR-0006) di `http://localhost:4100`, dengan panel kendali di `/`.

| Prefix             | Sistem                    | Isi                                                                                   |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------- |
| `/bpjs`            | VClaim, Antrean, Aplicare | VClaim 2.0, Antrean RS + HFIS, Aplicare (lihat bagian BPJS)                           |
| `/eklaim/ws.php`   | E-Klaim                   | Kerangka metode; grouper berkode **simulasi** `SIM-*`                                 |
| `/satusehat`       | SATUSEHAT                 | Token OAuth2, lookup IHS by NIK, POST resource (wajib `subject`/`encounter`, 401/422) |
| `/dukcapil/verify` | Dukcapil                  | Demografi fiktif deterministik dari NIK                                               |
| `/tte`             | TTE                       | Tanda tangan tiruan atas hash + verifikasi                                            |
| `/tpdi/v1`         | TPDI                      | Invoice VA/QRIS idempotent, laporan transaksi, refund; webhook HMAC dari panel        |
| `/btn/v1`          | BTN                       | Mutasi rekening dari invoice lunas; kerangka pembiayaan                               |
| `/<sistem>/_echo`  | semua                     | Penerima pesan outbox contoh, dedup per `Idempotency-Key`                             |

`pnpm dev` (tsx watch, membaca `../../.env`), `pnpm test`.

Mock tanpa autentikasi dan memakai rahasia mock bawaan, jadi menolak start bila `APP_ENV`/`NODE_ENV` = `production` dan bila `HOST` bukan loopback (kecuali `MOCK_ALLOW_REMOTE=true`, mis. jaringan kontainer tertutup).

## BPJS (I03)

Kontrak kabel (path, body, amplop, kode penolakan) ada di `@simrs/shared` → `integrations/bpjs/{common,vclaim,antrean,hfis}.ts`; dekode + validasi respons di `@simrs/shared/node` (`decodeVclaimResponse`, `decodeAntreanResponse`). Prefiks layanan: `/bpjs/vclaim`, `/bpjs/antrean`, `/bpjs/aplicare` (`BPJS_SERVICE_PREFIX`).

**Autentikasi** setiap permintaan: `X-cons-id` (= `BPJS_CONS_ID`), `X-timestamp` (detik UTC, selisih ≤ 300 dtk dengan jam mock), `X-signature` = Base64(HMAC-SHA256(`consId&timestamp`, `BPJS_SECRET_KEY`)), `user_key` (= `BPJS_USER_KEY`, bawaan `mock-user-key`). Gagal → HTTP 401. Respons yang berisi data terenkripsi AES-256-CBC + LZ-string dengan kunci dari `consId + secretKey + X-timestamp` (bisa dimatikan di panel). Galat bisnis: HTTP 200 dengan kode `201` dan pesan berawalan teks baku `BPJS_REJECTIONS` (dipetakan balik oleh `classifyBpjsRejection`).

| Layanan  | Metode + path                                                                                                        | Catatan                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| VClaim   | `GET /Peserta/nokartu/:noKartu/tglSEP/:tgl`, `GET /Peserta/nik/:nik/tglSEP/:tgl`                                     | Tanggal lahir + kelamin dari struktur NIK; kartu ↔ NIK konsisten                                                                    |
| VClaim   | `GET /Rujukan/:no`, `GET /Rujukan/RS/:no`, `GET /Rujukan/List/Peserta/:kartu`, `GET /Rujukan/RS/List/Peserta/:kartu` | FKTP: urut 01 aktif + 99 kedaluwarsa; RS: urut 01                                                                                   |
| VClaim   | `GET /Rujukan/JumlahSEP/:jenis/:no`                                                                                  | Jumlah SEP terbit yang memakai rujukan                                                                                              |
| VClaim   | `POST /SEP/2.0/insert`, `PUT /SEP/2.0/update`, `DELETE /SEP/2.0/delete` (body JSON), `GET /SEP/:noSep`               | Nomor `<PPK><MMYY>V<6 digit>`; SEP ganda ditolak                                                                                    |
| VClaim   | `GET /SEP/FingerPrint/Peserta/:kartu/TglPelayanan/:tgl`                                                              | `kode` 1 sudah / 0 belum                                                                                                            |
| VClaim   | `POST /RencanaKontrol/insert`, `POST /RencanaKontrol/InsertSPRI`, `GET /RencanaKontrol/noSuratKontrol/:no`           | Nomor `<PPK><MMYY>K<6 digit>`; tanggal 0–90 hari, dokter harus praktik di HFIS                                                      |
| VClaim   | `GET /referensi/poli/:param`, `GET /referensi/dokter/pelayanan/:jns/tglPelayanan/:tgl/Spesialis/:poli`               | Poli INT/JAN/SAR/PAR, dokter HFIS 99001–99006                                                                                       |
| VClaim   | `GET /monitoring/HistoriPelayanan/NoKartu/:kartu/tglMulai/:a/tglAkhir/:b`                                            | Cari SEP yang terbit saat jawaban hilang (≤ 90 hari)                                                                                |
| VClaim   | `GET /RencanaKontrol/ListRencanaKontrol/Bulan/:bb/Tahun/:yyyy/Nokartu/:kartu/filter/:f`                              | Surat aktif kartu per bulan (f 1 entri, 2 rencana): cari surat yang terbit saat jawaban hilang. Bentuk = asumsi katalog             |
| VClaim   | `PUT /SEP/2.0/updtglplg`                                                                                             | Tanggal + status pulang SEP rawat inap (meninggal wajib surat + tanggal); SEP rawat inap baru ditolak selama yang lama belum pulang |
| VClaim   | `PUT /RencanaKontrol/Update`, `PUT /RencanaKontrol/UpdateSPRI`, `DELETE /RencanaKontrol/Delete` (body JSON)          | Hanya surat yang belum dipakai SEP (`BPJS_SURAT_SUDAH_DIPAKAI`)                                                                     |
| VClaim   | `POST /Rujukan/2.0/insert`, `PUT /Rujukan/2.0/Update`, `DELETE /Rujukan/delete`, `GET /Rujukan/Keluar/:no`           | F07 rujukan keluar dari SEP: nomor `<PPK><MMYY>B<6 digit>`; penuh/partial ke RS, rujuk balik ke FKTP; rencana kunjungan ≤ 90 hari   |
| VClaim   | `GET /referensi/diagnosa/:param`, `GET /referensi/faskes/:param/:jenis`                                              | Diagnosa = contoh ICD-10 seed `ref` saja; faskes = FKTP fiktif (1) + RS tenant seed (2)                                             |
| Antrean  | `POST /antrean/add`                                                                                                  | Validasi isian, kode booking unik, jadwal HFIS + `jampraktek`, kuota                                                                |
| Antrean  | `POST /antrean/updatewaktu`                                                                                          | Urutan `checkAntreanTask`: mulai 1 atau 3, lalu +1 s.d. 7; 99 sebelum task 4                                                        |
| Antrean  | `POST /antrean/batal`, `POST /antrean/getlisttask`, `GET /ref/poli`, `GET /ref/dokter`                               | Batal melepas kuota; daftar task terenkripsi, waktu `DD-MM-YYYY HH:mm:ss WIB`                                                       |
| HFIS     | `GET /jadwaldokter/kodepoli/:poli/tanggal/:tgl`, `POST /jadwaldokter/updatejadwaldokter`                             | Templat mingguan; libur/kapasitas per tanggal hanya lewat panel                                                                     |
| Aplicare | `GET /rest/ref/kelas`, `GET /rest/bed/read/:ppk/:start/:limit`, `POST /rest/bed/create\|update\|delete/:ppk`         | Ketersediaan bed per kelas + ruang per PPK; respons polos, sukses `metadata.code` 1, galat 0; ruang wajib `create` sebelum `update` |

**Aturan data fiktif** (semua kartu `0000…`, NIK `9999…`; di luar itu tidak ditemukan):

- kartu/NIK berakhiran `0000` → peserta TIDAK AKTIF (SEP, SPRI, dan antrean JKN ditolak);
- kartu/NIK berakhiran `9999` → peserta tidak ditemukan;
- kartu berakhiran `1111` → wajib rekam sidik jari sebelum SEP rawat jalan;
- rujukan berakhiran `99` → kedaluwarsa (kunjungan 120 hari lalu, batas 90 hari);
- SEP ganda: kartu + tanggal + poli sama (rawat jalan) atau kartu + tanggal (rawat inap); rawat inap wajib SPRI atau SEP IGD terbit kartu yang sama sebagai `rujukan.noRujukan`;
- SEP IGD (ASUMSI `VCLAIM_POLI_IGD` = `IGD`): rawat jalan tanpa rujukan, `dpjpLayan` boleh kosong (bila diisi harus dokter dikenal), satu per kartu per tanggal;
- HFIS awal = jadwal minggu demo; perbedaan yang disemai: dr. Bagus (99003) tetap praktik Rabu 09:00–12:00 di HFIS, padahal cuti di jadwal RS Rabu 7 Okt 2026.

## Panel dan API skenario

Panel HTML: skenario per sistem, enkripsi BPJS, antrean BPJS + task ID per kode booking, SEP (+ tanggal pulang), rujukan keluar, Aplicare, tagihan TPDI, pesan outbox, kotak masuk, 50 request terakhir, reset. API-nya (juga untuk helper E2E):

| Metode + path                            | Body → respons                                                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /_panel/api/state`                  | → `{ systems[{ id, label, scenario }], bpjsEncryption, invoices, echoes, log, messages, bpjs }`                                                                                                                             |
| `POST /_panel/api/scenario`              | `{ system, mode: normal\|lambat\|gagal\|acak\|timeout, latencyMs?, failStatus?, timeoutMs? }` → `{ mode, latencyMs, failStatus, timeoutMs }`; 400 bila tidak sah                                                            |
| `POST /_panel/api/reset`                 | tanpa body → reset semua; `{ system }` → reset satu sistem (skenario + data) → `{ ok: true, system }`                                                                                                                       |
| `POST /_panel/api/bpjs-encryption`       | `{ enabled }` → `{ bpjsEncryption }`                                                                                                                                                                                        |
| `GET /_panel/api/bpjs`                   | → `{ antrean[], seps[], surat[], rujukanKeluar[], aplicare[{ kodeppk, ruang[] }], fingerprints[], hfis: { overrides[], updates[] } }` (terbaru dulu)                                                                        |
| `GET /_panel/api/bpjs/antrean/:kode`     | → `{ kodebooking, status, …, tasks[{ taskid, taskname, waktu, waktuIso, diterima }], batal }`; 404 bila tidak ada                                                                                                           |
| `GET /_panel/api/bpjs/sep/:noSep`        | → `{ noSep, status: terbit\|dihapus, tglSep, noKartu, poli, dpjpLayan, noRujukan, noSurat, versi, … }`; 404                                                                                                                 |
| `GET /_panel/api/bpjs/aplicare/:kodeppk` | → `{ kodeppk, ruang[{ kodekelas, namakelas, koderuang, namaruang, kapasitas, tersedia, tersediapria, tersediawanita, tersediapriawanita, lastupdate, rownumber }] }`                                                        |
| `POST /_panel/api/bpjs/fingerprint`      | `{ noKartu, tanggal? }` → `{ noKartu, tanggal, kode: '1' }`                                                                                                                                                                 |
| `POST /_panel/api/bpjs/outage`           | `{ noKartu, aktif }` → gangguan BPJS hanya untuk peserta ini: permintaan VClaim/Antrean yang menyebut kartunya (path/body) dijawab 503 `MOCK_FAILURE`; dibersihkan reset. Untuk E2E downtime yang berjalan bersama tes lain |
| `POST /_panel/api/bpjs/hfis`             | `{ kodedokter, tanggal, libur?, kapasitaspasien? }` (seperti petugas di aplikasi HFIS) → perubahan tersimpan                                                                                                                |
| `POST /_panel/api/bpjs/peserta`          | `{ noKartu, nik, nama?, sex?, tglLahir?, aktif?, hakKelas? }` → peserta VClaim (mis. agar cocok dengan pasien seed)                                                                                                         |

Mode skenario: `lambat` menunda `latencyMs` sebelum diproses; `gagal` menjawab `failStatus` (`MOCK_FAILURE`) **tanpa** memproses; `acak` 30% gagal; `timeout` **memproses** permintaan (SEP terbit, antrean tercatat) lalu menahan jawaban `timeoutMs` (bawaan 30 dtk) atau sampai klien memutus, kemudian 504 `MOCK_TIMEOUT`. Keadaan di memori: E2E wajib memanggil reset di awal.
