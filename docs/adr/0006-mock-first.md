# ADR-0006 · Mock-first untuk semua integrasi

Status: diterima · 3 Okt 2026

## Keputusan

`apps/mock` meniru BPJS (VClaim, Antrean, Aplicare), E-Klaim, SATUSEHAT, Dukcapil, TTE, TPDI, dan BTN dengan kontrak yang sama dengan konektor nyata (header tanda tangan, format respons, kode galat). Panel kendali mock bisa memicu skenario: lambat, gagal, callback ganda, BPJS membayar klaim, BTN menyetujui pembiayaan. Konektor nyata ditukar lewat konfigurasi `INTEGRATION_MODE=mock|sandbox|production` per tenant.

## Konsekuensi

Fase pengembangan tidak menunggu kredensial resmi. Sebelum go-live, setiap konektor diuji ulang di sandbox resmi.
