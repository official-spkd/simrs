# ADR-0003 · Integrasi eksternal lewat transactional outbox

Status: diterima · 3 Okt 2026

## Konteks
BPJS, SATUSEHAT, E-Klaim, TPDI, dan BTN bisa lambat atau gangguan. Pelayanan klinis tidak boleh berhenti karenanya.

## Keputusan
Perubahan domain dan pesan keluar ditulis dalam satu transaksi (`outbox_messages`). Worker BullMQ mengirim dengan idempotency key, retry eksponensial dengan jitter (maks 8 kali), lalu memindahkan ke DLQ dan menyalakan alarm di Integration Hub (I01). Webhook masuk disimpan dulu (`inbound_events`, unik per idempotency key), dijawab 2xx, lalu diproses async.

## Konsekuensi
Status integrasi bersifat eventual; UI menampilkan status kirim per item (terkirim, menunggu, gagal) dan tombol kirim ulang yang diaudit.
