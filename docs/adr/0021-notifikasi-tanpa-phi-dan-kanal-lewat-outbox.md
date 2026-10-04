# ADR-0021 · Notifikasi staf: in-app selalu, email/WhatsApp lewat outbox, tanpa PHI, no. HP staf terenkripsi

Status: diterima · 4 Okt 2026 · Komponen: P09 (katalog: notifikasi dan worklist)

## Konteks
Katalog P09 meminta notifikasi in-app, email, WhatsApp, SMS, dan push. Akses darurat (P03) wajib memberi tahu petugas privasi; sebelumnya hanya in-app. Email dan WhatsApp adalah layanan pihak ketiga: tidak boleh dipanggil di dalam transaksi database (CLAUDE.md §4.5) dan isinya bisa terbaca di luar sistem RS. Akun staf belum punya no. HP, padahal WhatsApp juga dibutuhkan kode cadangan masuk (P02, potongan 10c).

## Keputusan
1. **`NotificationsService.notify`** menulis notifikasi in-app di transaksi pemanggil dan mengantrekan salinan per kanal ke outbox (`notify.email`, `notify.whatsapp`). Payload hanya ID notifikasi; alamat dibaca (dan no. HP didekripsi) worker saat mengirim, sehingga akun yang dinonaktifkan atau alamat yang dihapus sebelum terkirim ikut dihormati. Respons penyedia tidak disimpan (`sensitive`).
2. **Isi notifikasi tanpa PHI.** Judul dan isi hanya menyebut jenis kejadian; identitas pasien dan alasan klinis dibuka lewat tautan ke layar berizin. Tautan wajib path internal web (skema `notificationLinkSchema`, dan `safeNextPath` saat dibuka) agar notifikasi tidak bisa dipakai untuk tautan phishing.
3. **Kanal per pemakaian.** Bawaan in-app + email; kejadian mendesak (akses darurat) ditambah WhatsApp. Preferensi kanal per pengguna menyusul.
4. **No. HP staf** disimpan baku `62…`, terenkripsi AES-256-GCM per tenant dengan tujuan `staff_phone` (`users.phone_enc`), dan hanya tampil tersamar di layar Akses. Kolom kosong di form berarti tidak diubah; penghapusan lewat centang eksplisit.
5. **Lokal**: email dan WhatsApp diterima `apps/mock` (`/email/send`, `/whatsapp/send`) dan disimpan di kotak masuk mock (`GET /messages`, juga tampil di panel mock). Produksi memakai SMTP/penyedia email dan WhatsApp Business API lewat operasi yang sama.
6. **Hak baca**: setiap staf hanya membaca dan menandai notifikasinya sendiri (API menyaring `recipient_user_id`; aplikasi hanya boleh mengubah kolom `read_at`).

## Konsekuensi
+ Gangguan email/WhatsApp tidak menghambat akses darurat atau alur lain; pengiriman dicoba ulang dan masuk DLQ bila gagal permanen.
+ Bocornya kotak masuk email/WhatsApp tidak membuka data pasien.
− Pengiriman email/WhatsApp butuh worker yang berjalan (Redis/Docker); tanpa itu notifikasi tetap tersedia in-app.
− SMS, push (aplikasi mobile, fase 9), preferensi kanal per pengguna, dan worklist tugas belum ada.
