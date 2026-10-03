# ADR-0005 · TPDI sebagai agregator teknologi; dana dipegang BTN

Status: diterima (perlu konfirmasi hukum) · 3 Okt 2026

## Konteks
Pembayaran pasien memakai PT Transaksi Pembayaran Digital Indonesia (TPDI) dengan BTN sebagai bank. TPDI diharapkan beroperasi sebagai perantara tanpa izin BI/OJK sendiri. Layanan yang menampung atau meneruskan dana pembayaran pada umumnya diatur Bank Indonesia sebagai penyedia jasa pembayaran.

## Keputusan
- TPDI hanya: membuat tagihan (VA/QRIS) lewat API BTN, halaman bayar, webhook ke SIM RS, dan laporan transaksi.
- Dana pasien masuk **langsung** ke rekening operasional RS di BTN. Fee TPDI ditagih terpisah (invoice), tidak dipotong dari dana.
- Biaya MDR/VA dikenakan BTN sesuai perjanjian.
- SIM RS merekonsiliasi 3 arah: kasir ↔ laporan TPDI ↔ mutasi BTN.
- Pembiayaan (cicilan pasien, piutang BPJS) adalah produk BTN; SIM RS dan TPDI hanya meneruskan data dan status.

## Konsekuensi
Struktur ini perlu dikonfirmasi oleh konsultan hukum/regulator sebelum produksi. Bila TPDI kelak berizin dan memegang dana, modul `payments` cukup menambah alur settlement neto; skema data sudah memisahkan `payment_intents`, `payment_events`, dan `bank_statement_lines`.
