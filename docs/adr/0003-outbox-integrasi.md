# ADR-0003 · Integrasi eksternal lewat transactional outbox

Status: diterima · 3 Okt 2026

## Konteks
BPJS, SATUSEHAT, E-Klaim, TPDI, dan BTN bisa lambat atau gangguan. Pelayanan klinis tidak boleh berhenti karenanya.

## Keputusan
Perubahan domain dan pesan keluar ditulis dalam satu transaksi (`outbox_messages`). Worker BullMQ mengirim dengan idempotency key, retry eksponensial dengan jitter (maks 8 kali), lalu memindahkan ke DLQ dan menyalakan alarm di Integration Hub (I01). Webhook masuk disimpan dulu (`inbound_events`, unik per idempotency key), dijawab 2xx, lalu diproses async.

## Konsekuensi
Status integrasi bersifat eventual; UI menampilkan status kirim per item (terkirim, menunggu, gagal) dan tombol kirim ulang yang diaudit.

## Pembaruan 5 Okt 2026 · kebijakan retry per operasi (fase 2, potongan 1a)

Keputusan fase 2 #13 (`docs/rencana/fase-2-front-office.md` §4) mengubah batas "maks 8 kali" di atas. Delapan percobaan habis dalam ±4–5 menit, terlalu pendek untuk gangguan BPJS yang bisa berjam-jam.

- **Retry per operasi.** Operasi outbox boleh membawa kebijakan `retry: { maxAttempts, capMs, untilEndOfServiceDay }`. Operasi tanpa kebijakan tetap 8 percobaan dengan jeda backoff maks. 5 menit.
- **BPJS (SEP, task ID antrean): sampai akhir hari layanan.** Dicoba ulang sampai 00.00 WIB berikutnya dari saat pesan dibuat (jeda maks. 10 menit, tanpa batas hitungan), lalu DLQ + tombol kirim ulang di layar domain. Poli tidak diblokir SEP yang masih `pending`.
- **Galat bisnis BPJS bukan kegagalan kirim.** BPJS menjawab galat bisnis dengan HTTP 200 + `metaData.code` ≠ 200. Itu jawaban pasti: pesan dicatat terkirim dan hasilnya disimpan sebagai status domain "ditolak" dengan kode stabil (mis. `BPJS_SEP_GANDA`), bukan dicoba ulang atau dimasukkan ke DLQ. Yang dicoba ulang hanya gangguan (`BPJS_UNAVAILABLE`: timeout, jaringan, 5xx, pemeliharaan).
- **Tunda tanpa menghabiskan percobaan** (`defer`), untuk urutan task ID: task berikutnya menunggu task sebelumnya terkirim. Prasyarat yang masuk DLQ membuat pesan penunggu ikut DLQ.
- **`onDead`** dijalankan atomik dengan perpindahan ke DLQ, sehingga status domain (SEP, tanda tangan) bisa menampilkan "gagal" tanpa membaca outbox.

Rincian pola: `docs/panduan/02-cara-kerja-kode.md` bagian Worker.
