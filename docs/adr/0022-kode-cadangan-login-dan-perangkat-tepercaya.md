# ADR-0022 · Login: kode cadangan lewat WhatsApp/email dan "percayai perangkat ini 12 jam"

Status: diterima · 4 Okt 2026 · Komponen: P02 · diperbarui 5 Okt 2026

## Konteks
Mockup Login menawarkan "Tidak punya akses aplikasi? Kirim kode lewat WhatsApp" dan "Percayai perangkat ini selama 12 jam (hanya komputer milik RS)". docs/05 mewajibkan MFA untuk semua staf (ADR-0011). Kode yang dikirim lewat pihak ketiga lebih lemah daripada TOTP, dan perangkat tepercaya melemahkan MFA bila tokennya bocor, jadi keduanya perlu dibatasi ketat.

## Keputusan
1. **Kode cadangan terikat tantangan login.** Hanya bisa diminta setelah kata sandi benar (memegang token tantangan `sc1`). Kode 6 digit acak (`crypto.randomInt`) disimpan terenkripsi AES-256-GCM (`login_otp`) di baris tantangan, berlaku selama tantangan (5 menit), dan berbagi batas 5 percobaan dengan TOTP. Kiriman maksimal 3 per tantangan dengan jeda 30 detik (UPDATE atomik). Kode baru menggantikan yang lama. Akun tanpa no. HP/email mendapat pesan "hubungi admin", bukan kode.
2. **Dikirim lewat outbox** (`auth.backup_code`, payload ID tantangan); worker membaca dan mendekripsi kode saat mengirim, melewati tantangan yang sudah dipakai/kedaluwarsa atau kodenya sudah diganti kanal lain, dan tidak menyimpan respons. Login dengan kode cadangan tercatat `mfa: backup_<kanal>`; permintaan kode tercatat di audit.
3. **Perangkat tepercaya** = token buram `st1` (256 bit, hash di `trusted_devices`) di cookie httpOnly perangkat. Cookie ini milik perangkat, bukan sesi: tidak dihapus saat keluar. Token hanya berlaku untuk akun yang mencentangnya, maksimal 12 jam (CHECK database), dan dicabut saat sandi diganti/direset, MFA direset, atau akun dinonaktifkan. Kata sandi tetap wajib; yang dilewati hanya langkah kode (`mfa: trusted_device`).
4. **Worker tanpa Redis di lokal** memakai timer (`OUTBOX_SCHEDULER=auto`), sehingga kode cadangan benar-benar terkirim ke kotak masuk mock saat pengembangan tanpa Docker.

## Konsekuensi
+ Staf yang ponselnya tertinggal tetap bisa masuk tanpa menurunkan tingkat ke "sandi saja"; komputer bersama di unit tidak perlu memasukkan kode setiap kali dalam satu shift.
− Kode cadangan bergantung pada keamanan WhatsApp/email staf; peran sensitif bisa dibatasi agar hanya TOTP (pengaturan per RS, belum ada).
− Label "hanya komputer milik RS" belum ditegakkan teknis (butuh registrasi perangkat, lihat PIN perangkat terdaftar).

## Pembaruan 5 Okt 2026 · PIN perangkat terdaftar

Registrasi perangkat kini ada sebagai `registered_devices` (ADR-0024), baru untuk PIN masuk cepat jenis `staff_pin` yang didaftarkan pemilik akun. Penegakan "hanya komputer milik RS" untuk perangkat tepercaya tetap menunggu pendaftaran perangkat oleh admin bersama prinsipal perangkat (ADR-0027).
