# ADR-0017 · Operasi outbox: payload tanpa PHI, persiapan membaca DB, hasil diproses atomik

Status: diterima · 4 Okt 2026

## Konteks
ADR-0003 menetapkan pola outbox: transaksi domain menulis pesan, worker mengirim dengan retry, idempotency key, dan DLQ. Operasi fase 0 (`ping`) hanya meneruskan payload dan tidak memakai respons. Verifikasi NIK ke Dukcapil (P05) membutuhkan dua hal baru. Pertama, NIK harus dikirim, tetapi payload outbox tersimpan apa adanya di database dan tidak boleh memuat PHI. Kedua, hasil verifikasi harus disimpan kembali ke data pasien tanpa keadaan setengah jadi (pesan "terkirim" tetapi hasil hilang, atau sebaliknya). docs/06 §5 hanya menyebut "verifikasi NIK → data demografi fiktif di mock".

## Keputusan
1. **Payload hanya ID.** Operasi mendapat `prepare(msg, ctx)` yang membaca data tenant lewat transaksi pendek tersendiri (`ctx.read`) dan mendekripsi identitas dengan kunci kolom yang sama dengan API (worker kini butuh `FIELD_ENCRYPTION_KEY`/`FIELD_HASH_KEY`). NIK tidak pernah tersimpan di `outbox_messages`.
2. **Lewati yang sudah tidak relevan.** `prepare` boleh mengembalikan `{ skip }` (mis. NIK sudah diganti sebelum terkirim): pesan dicatat terkirim dengan keterangan `dilewati: …` tanpa memanggil target.
3. **Hasil diproses atomik.** `onSuccess(tx, msg, body)` berjalan di transaksi yang sama dengan pencatatan percobaan "terkirim". Bila pemrosesan gagal (mis. respons tidak dikenali), semua perubahannya batal dan percobaan dicatat gagal permanen (DLQ). Respons yang memuat data pribadi ditandai `sensitive` sehingga potongannya tidak disimpan di `delivery_attempts`.
4. **Dukcapil memakai pola verifikasi data.** Mock menambah `POST /dukcapil/verify-data`: RS mengirim NIK + nama + tanggal lahir + jenis kelamin, Dukcapil menjawab cocok/tidak per elemen tanpa mengembalikan data pribadi (pola layanan verifikasi untuk instansi). Endpoint demografi lama (`/dukcapil/verify`) tetap ada untuk isian otomatis pendaftaran (F03). Aturan mock: NIK berakhiran 9999 tidak ditemukan, 8888 nama tidak sesuai, tanggal lahir dan jenis kelamin dicocokkan dengan struktur NIK.
5. **Idempotency key deterministik per permintaan:** `nik-verify:<identifier>:<nomor permintaan>`, dengan nomor permintaan disimpan di detail verifikasi. Verifikasi ulang manual ditolak bila permintaan sebelumnya masih menunggu kurang dari 5 menit.

## Konsekuensi
+ PHI tidak tersimpan di outbox maupun jejak pengiriman; status verifikasi dan audit `system` selalu konsisten dengan status pesan.
+ Pola yang sama dipakai konektor berikutnya (SATUSEHAT, BPJS) yang perlu menyimpan ID dari respons (mis. ID resource).
− Worker memegang kunci enkripsi kolom; perlakukan worker setara API dalam pengelolaan rahasia.
− Konektor Dukcapil sungguhan (kredensial, tanda tangan, kontrak resmi) menyusul saat sandbox tersedia.

## Pembaruan 5 Okt 2026

[ADR-0025](./0025-lookup-sinkron-di-luar-transaksi.md) mengubah aturan "handler tidak boleh memanggil sistem eksternal" (keputusan 4 Okt), **khusus untuk lookup baca-saja** yang ditunggu pengguna: VClaim peserta/rujukan dan Dukcapil demografi untuk isian pendaftaran (§4 di atas). Lookup ini berjalan sinkron dari handler `@NoRequestTransaction()` lewat `LookupGateway`, di luar transaksi, dengan batas 5 detik dan audit sebelum serta sesudah panggilan. Verifikasi NIK (`dukcapil.nik.verify`) dan semua penulisan ke sistem luar tetap lewat outbox sesuai ADR ini.
