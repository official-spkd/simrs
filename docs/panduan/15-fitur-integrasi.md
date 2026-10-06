# Fitur integrasi

Halaman ini menjelaskan layar Integrasi (integration hub) dan konsep di belakangnya: outbox, retry, dead-letter queue (DLQ), webhook masuk, dan mock sistem luar. Tujuannya agar pembaca fitur paham kenapa pelayanan tetap jalan saat BPJS atau SATUSEHAT gangguan, dan di mana kode tiap bagian. Detail teknis lengkap ada di halaman cara kerja; halaman ini meringkas dan menautkannya.

> Status 6 Okt 2026: layar `/sistem/integrasi` hanya berjalan di **mode presentasi** (data dummy fiktif, ADR-0023). Integration hub penuh (fase 7) belum dibangun. Yang sudah nyata: outbox + worker dengan retry dan DLQ, konektor BPJS (VClaim, Antrean, HFIS, Aplicare), Dukcapil, TTE, notifikasi, verifikasi HMAC TPDI, dan mock semua sistem luar. Konektor E-Klaim, SATUSEHAT, TPDI, dan BTN belum ada.

## Ringkasan layar

| Layar                       | Rute                | Peran (mode presentasi) | Komponen | Status        |
| --------------------------- | ------------------- | ----------------------- | -------- | ------------- |
| Integrasi (integration hub) | `/sistem/integrasi` | Admin SIM RS            | I01–I06  | demo · fase 7 |

Posisi lain melihat "Layar ini untuk posisi lain" dengan tautan **Ganti posisi**. Sumber kebenaran: registri `SCREENS` di `apps/web/src/lib/screens.ts`.

## Integration hub

![Layar Integrasi: baris status server edge, sembilan kartu antarmuka dengan status, volume, gagal, dan latensi p95, lalu dead-letter queue dan panel kepatuhan SATUSEHAT](./gambar/integrasi.png)

| Hal      | Isi                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rute     | `/sistem/integrasi`                                                                                                                                                                  |
| Pemakai  | admin_tenant                                                                                                                                                                         |
| Komponen | I01 integration hub, I02 SATUSEHAT, I03 BPJS, I04 Kemenkes lain, I05 layanan pendukung, I06 device gateway                                                                           |
| Status   | demo (mode presentasi); backend fase 7 belum dibangun                                                                                                                                |
| Mockup   | `design/mockups/Integrasi.dc.html`                                                                                                                                                   |
| Kode web | `apps/web/src/app/(staf)/sistem/integrasi/` · `apps/web/src/components/manajemen/interface-card.tsx` · `apps/web/src/lib/manajemen.ts` · `apps/web/src/lib/server/data/manajemen.ts` |
| Kode API | belum ada (rencana `modules/integration-hub`, `satusehat`, `bpjs-ws`, `device-gateway`; `docs/rencana/fase-7-integration-hub-satusehat.md`)                                          |

**Tujuan.** Admin SIM RS memantau semua antarmuka ke sistem luar dalam satu layar: status, volume, kegagalan, dan latensi. Admin juga mengirim ulang pesan gagal dan menguji perilaku server edge saat koneksi putus.

**Alur.**

1. Buka **Sistem › Integrasi**. Judul "Integrasi · pemantauan antarmuka" dengan tautan **Jejak audit**.
2. Baris "Server edge" menunjukkan status online dan keterlambatan replikasi ke cloud.
3. Wilayah "Status antarmuka" berisi sembilan kartu: SATUSEHAT, BPJS VClaim, BPJS Antrean, E-Klaim INA-CBG, LIS analyzer, PACS radiologi, TPDI · VA BTN, QRIS, API BTN (mutasi H2H), dan Notifikasi pasien. Tiap kartu memuat protokol, status teks (Normal, Lambat, Gangguan, Antre lokal), volume hari ini, jumlah gagal, latensi p95, dan grafik batang 24 jam dengan jam galat ditandai.
4. Volume kartu ikut bertambah oleh pesan keluar skenario Simulasi ("+N dari skenario Simulasi").
5. Klik kartu untuk menyaring dead-letter queue ke tujuan itu, mis. "Tujuan: PACS radiologi · 2 pesan". Klik lagi atau **Tampilkan semua tujuan** untuk melepas saringan.
6. Di "Dead-letter queue", centang pesan (atau "Pilih semua yang tampil"), lalu **Kirim ulang terpilih (N)**.
7. Konfirmasi "Kirim ulang N pesan ke …?" muncul. Tekan **Ya, kirim ulang** atau **Batal**. Pesan yang terkirim keluar dari antrean dan jumlah gagal di kartu berkurang.
8. Pilih baris pesan untuk membaca "Payload galat · pengenal saja, tanpa data pribadi".
9. Tekan **Uji mode downtime**. Kartu eksternal berubah "Antre lokal" dan penghitung "Transaksi tersimpan lokal selama uji" naik tiap 2 detik. Tekan **Pulihkan**; pesan "Koneksi pulih pukul … disinkronkan ulang berurutan tanpa duplikasi" muncul.
10. Panel kanan: "Kepatuhan SATUSEHAT hari ini" per resource (sasaran ≥ 95%), "Kredensial dan sertifikat" (mis. sertifikat TTE habis 23 hari ditandai), dan "Backup (aturan 3-2-1)".

![Dead-letter queue disaring ke PACS radiologi: satu pesan dicentang, tombol Kirim ulang terpilih aktif, payload galat hanya berisi pengenal teknis](./gambar/integrasi--dlq.png)

**Gerbang keselamatan dan aturan bisnis.**

- **Kirim ulang terpilih** nonaktif sampai minimal satu pesan dicentang ("Centang minimal satu pesan untuk dikirim ulang.").
- Kirim ulang selalu lewat konfirmasi. Selama uji downtime kirim ulang ditahan: konfirmasi yang terbuka ditutup dan alasannya tertulis.
- Pesan dikirim ulang dengan kunci idempotensi yang sama, jadi tujuan tidak menerima data ganda. Versi produksi mencatat tindakan ini di log audit.
- Payload DLQ hanya berisi pengenal teknis (mis. id pesan, kunci idempotensi, kode galat), tanpa nama, NIK, atau isi klinis. Tes menolak fixture yang melanggar.
- Server Action `resendDeadLettersAction` memeriksa gerbang demo, sesi lengkap, posisi pemakai layar, dan id pesan yang dikenal. Id tak dikenal ditolak dengan "Muat ulang halaman".
- Status tidak hanya lewat warna: chip bertulisan, dan persen kepatuhan diberi teks "memenuhi sasaran" atau "di bawah sasaran" untuk pembaca layar.
- Angka di layar adalah data dummy. Teks DLQ menyebut "gagal setelah 5× retry" (nilai fixture). Worker nyata memakai 8 percobaan bawaan, dan operasi BPJS SEP/task ID dicoba sampai akhir hari layanan.

**Rencana backend.** Izin terencana `integration.read`. Fase 7 membangun lajur kirim per tujuan (tanpa head-of-line blocking), circuit breaker, status/volume/latensi/DLQ per tujuan, kirim ulang dan abaikan yang diaudit, kredensial per RS terenkripsi dengan rotasi, dan kepatuhan SATUSEHAT per resource. Layar disambungkan ke API; jalur demo tetap hidup.

## Konsep integrasi

Semua sistem luar diperlakukan sama: bisa lambat, bisa mati, bisa mengirim dua kali. Tiga pola menjaga pelayanan tetap jalan.

![Arsitektur: web memanggil BFF, BFF memanggil API, API menulis ke database dengan RLS dan outbox, worker mengirim pesan outbox ke mock sistem luar](./gambar/diagram-arsitektur.svg)

### Outbox, retry, dan DLQ

![Outbox: transaksi domain menulis pesan pending, worker mengklaim dan mengirim, gagal sementara dicoba ulang dengan backoff eksponensial, gagal permanen atau habis percobaan masuk DLQ](./gambar/diagram-outbox.svg)

Modul domain tidak pernah memanggil API luar di dalam transaksi database. Ia menulis pesan ke tabel `outbox_messages` di transaksi yang sama dengan perubahan datanya, lewat `enqueueOutbox` di `packages/db/src/outbox.ts`. Penulisan idempoten per (tenant, tujuan, kunci idempotensi).

Worker (`apps/worker/src/outbox/outbox.dispatcher.ts`) mengklaim pesan tiap ±2 detik, mengirim di luar transaksi, lalu mencatat hasilnya.

| Status       | Arti                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pending`    | Menunggu dikirim                                                                                                      |
| `processing` | Sedang diklaim worker (lease 60 detik)                                                                                |
| `sent`       | Tujuan menjawab 2xx                                                                                                   |
| `failed`     | Gagal sementara (5xx, 408, 425, 429, jaringan); dijadwalkan ulang dengan backoff eksponensial + jitter, maks. 5 menit |
| `dead`       | DLQ: percobaan habis (bawaan 8) atau galat permanen (4xx lain)                                                        |
| `held`       | Ditahan (staging SATUSEHAT sejak fase 3, dilepas berurutan di fase 7)                                                 |

Operasi boleh membawa kebijakan retry sendiri. SEP dan task ID BPJS dicoba sampai 00.00 WIB berikutnya, lalu DLQ dan tombol kirim ulang di layar domain. Payload outbox tidak boleh memuat data pribadi. Penjelasan lengkap: [Integrasi lewat outbox](./01-cara-kerja-sistem.md#integrasi-lewat-outbox) dan [Worker](./02-cara-kerja-kode.md#worker).

### Webhook masuk bertanda tangan HMAC

Arah sebaliknya (TPDI dan BTN mengabari SIM RS) memakai pola ini:

1. Verifikasi tanda tangan. Untuk TPDI: header `X-TPDI-Signature` = hex(HMAC-SHA256(timestamp + "." + body, secret)). Timestamp yang selisihnya lebih dari 5 menit ditolak (anti-replay).
2. Simpan event mentah di `inbound_events`, unik per (tenant, sumber, kunci idempotensi).
3. Jawab 2xx secepatnya.
4. Proses di worker secara async. Event yang sama hanya dihitung sekali.

Yang sudah ada: fungsi `verifyTpdiWebhook` (perbandingan waktu-konstan) di `packages/shared/src/integrations/tpdi-signature.ts` beserta tesnya, dan tabel `inbound_events` di `packages/db/prisma/schema/platform.prisma`. Penerima webhook belum dibangun; rencana fase 6 menaruhnya di `apps/api/src/modules/webhooks/` (`POST /api/v1/webhooks/tpdi/:tenantCode` dan `/btn/:tenantCode`). Event TPDI di kontrak: `payment.paid`, `payment.expired`, `payment.failed`, `refund.completed`. Perilakunya bisa dilihat di layar [Pembayaran digital](./14-fitur-keuangan.md#pembayaran-digital-tpdi-btn): callback ganda tampil "duplikat · diabaikan".

### Mock dan panel kendali

Semua sistem luar ditiru `apps/mock` di `http://localhost:4100` (ADR-0006). Mock meniru kontrak aslinya, termasuk tanda tangan BPJS, enkripsi respons, dan webhook HMAC TPDI. Lokal, semua base URL integrasi mengarah ke `http://localhost:4100/<sistem>`; untuk BPJS, env kredensial yang kosong di luar produksi otomatis bernilai mock. Tidak ada panggilan ke layanan nyata dari lokal.

Panel kendali di `http://localhost:4100/`:

- Skenario per sistem: normal, lambat, gagal, acak, timeout. Mode timeout memproses permintaan lalu menahan jawabannya (meniru SEP yang terbit tetapi RS tidak tahu).
- Pemicu TPDI: bayar, kirim ulang webhook (callback ganda), atau kedaluwarsakan tagihan (`POST /_panel/api/tpdi/invoices/:id/(pay|resend|expire)`).
- Saklar enkripsi BPJS dan reset data. State disimpan di memori dan hilang saat restart.

Detail berkas mock: [Mock](./02-cara-kerja-kode.md#mock).

### Sistem luar yang terhubung

| Sistem              | Dipakai untuk                                                  | Mock                                | Kode saat ini                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BPJS VClaim         | Kepesertaan, rujukan, SEP, SPRI, surat kontrol, rujukan keluar | `/bpjs/vclaim`                      | Operasi outbox `bpjs.vclaim.sep.insert`, `.sep.update`, `.sep.delete`, `bpjs.vclaim.spri.insert`, `bpjs.vclaim.rujukan.insert`, `.rujukan.delete`; lookup sinkron lewat `BpjsClient` |
| BPJS Antrean + HFIS | Antrean online, task ID 1–7, jadwal dokter                     | `/bpjs/antrean`                     | `bpjs.antrean.add`, `bpjs.antrean.updatewaktu`, `bpjs.antrean.batal`, `bpjs.hfis.pull`, `bpjs.hfis.update`                                                                           |
| BPJS Aplicare       | Ketersediaan tempat tidur                                      | `/bpjs/aplicare`                    | `bpjs.aplicare.update`                                                                                                                                                               |
| E-Klaim INA-CBG     | Grouper dan kirim klaim                                        | `/eklaim/ws.php` (kode CBG `SIM-*`) | Belum ada konektor (fase 5)                                                                                                                                                          |
| SATUSEHAT           | Kirim resource FHIR R4                                         | `/satusehat`                        | Pesan disimpan `held` (`apps/api/src/infra/clinical/staging.ts`); konektor fase 7                                                                                                    |
| Dukcapil            | Verifikasi NIK                                                 | `/dukcapil`                         | `dukcapil.nik.verify`                                                                                                                                                                |
| TTE                 | Tanda tangan elektronik dokumen                                | `/tte`                              | `tte.sign`                                                                                                                                                                           |
| TPDI                | Tagihan VA/QRIS, webhook, laporan, refund                      | `/tpdi/v1`                          | Verifikasi HMAC ada; konektor dan penerima webhook fase 6                                                                                                                            |
| BTN                 | Mutasi rekening H2H, pembiayaan                                | `/btn/v1`                           | Fase 6                                                                                                                                                                               |
| WhatsApp / email    | Notifikasi pasien dan staf                                     | `/whatsapp/send`, `/email/send`     | `notify.whatsapp`, `notify.email`                                                                                                                                                    |

Nama operasi di atas diambil dari `apps/worker/src/outbox/`. Kontrak kawat ada di `packages/shared/src/integrations/`; ringkasan kontrak di `docs/06-integrasi.md` dan `docs/07-pembayaran-btn-tpdi.md`.

## Tes yang menjaga layar ini

| Tes                                                                  | Yang dijaga                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/demo/manajemen.spec.ts` (integration hub)              | Sembilan kartu, saring DLQ per tujuan, kirim ulang terkonfirmasi, uji downtime dan pulih, tanpa scroll horizontal |
| `apps/web/src/lib/manajemen.test.ts`                                 | Fixture lolos kontrak, payload DLQ tanpa nama/NIK, jejak skenario menambah volume kartu                           |
| `apps/web/src/lib/manajemen-aksi.test.ts`                            | Kirim ulang DLQ hanya untuk posisi layar Integrasi; tanpa sesi lengkap diarahkan ke halaman masuk                 |
| `apps/worker/test/outbox.test.ts`, `dispatcher-policy.test.ts`       | Dispatcher, `defer`, `onDead` atomik dengan DLQ, kebijakan retry per operasi                                      |
| `apps/worker/test/retry-policy.test.ts`, `classify.test.ts`          | Batas hari layanan WIB, klasifikasi kode HTTP (coba ulang vs permanen)                                            |
| `apps/mock/src/mock.test.ts`, `apps/mock/src/panel/scenario.test.ts` | Kontrak mock dan skenario panel per sistem                                                                        |
| `packages/shared/src/integrations/integrations.test.ts`              | Tanda tangan HMAC TPDI dan batas umur timestamp                                                                   |

## Lihat juga

- [Cara sistem bekerja: integrasi lewat outbox](./01-cara-kerja-sistem.md#integrasi-lewat-outbox)
- [Cara kode bekerja: worker](./02-cara-kerja-kode.md#worker) dan [mock](./02-cara-kerja-kode.md#mock)
- [Tutorial: mengirim pesan outbox contoh](./03-tutorial.md#3-mengirim-pesan-outbox-contoh)
- [Fitur keuangan](./14-fitur-keuangan.md), untuk webhook TPDI dan rekonsiliasi
- [Fitur front office](./11-fitur-front-office.md), untuk SEP dan task ID BPJS
- [Simulasi dan operasional](./18-simulasi-dan-operasional.md)
- [Peta kode](./19-peta-kode.md)
- Dokumen desain: `docs/06-integrasi.md`, `docs/adr/0003-outbox-integrasi.md`, `docs/adr/0006-mock-first.md`
