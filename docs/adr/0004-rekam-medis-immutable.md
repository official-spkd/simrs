# ADR-0004 · Entri rekam medis append-only dan berversi

Status: diterima · 3 Okt 2026

## Konteks

MRMIK 8 menuntut identitas penulis, waktu, dan koreksi yang tidak menghilangkan isi asli. Audit dan sengketa medis membutuhkan riwayat utuh.

## Keputusan

Tabel klinis tidak menerima UPDATE/DELETE dari role aplikasi (dicabut lewat GRANT + trigger penolak). Koreksi menyisipkan baris baru dengan `version+1`, `supersedes_id`, dan `correction_reason`. View `<tabel>_current` menampilkan versi terbaru. Entri bertanda tangan (TTE) hanya bisa ditambah addendum.

## Konsekuensi

Query baca memakai view `_current`. Laporan "riwayat perubahan" tersedia tanpa kerja tambahan.
