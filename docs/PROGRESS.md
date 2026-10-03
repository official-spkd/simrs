# PROGRESS

Diperbarui oleh Claude Code di akhir setiap potongan kerja. Format: centang kriteria, catat keputusan, utang teknis, dan langkah berikutnya.

## Status fase

| Fase | Nama | Status |
|---|---|---|
| 0 | Fondasi repo dan infrastruktur | ⬜ belum mulai |
| 1 | Platform inti | ⬜ |
| 2 | Front office | ⬜ |
| 3 | Klinis RME | ⬜ |
| 4 | Penunjang | ⬜ |
| 5 | Keuangan | ⬜ |
| 6 | Pembayaran TPDI × BTN + pembiayaan | ⬜ |
| 7 | Integration hub + SATUSEHAT | ⬜ |
| 8 | Back office | ⬜ |
| 9 | Dasbor + aplikasi mobile | ⬜ |
| 10 | Simulasi E2E, ketahanan, pilot | ⬜ |

Legenda: ⬜ belum · 🟨 berjalan · ✅ selesai · ⛔ terhambat

## Langkah berikutnya

- Fase 0, langkah 1: workspace pnpm + Turborepo + config bersama.

## Asumsi yang dipakai (belum dikonfirmasi pemilik produk)

1. Integrasi alat lab, PACS, dan ICU dibangun setelah MVP; selama MVP hasil diinput manual (analyzer hanya disimulasikan di mock).
2. B01 supply chain, B03 data SDM inti, dan B09 RM administratif ikut MVP walau di lapisan 6.
3. Konektor nasional I01–I05 ikut MVP.
4. Aplikasi mobile menyusul (fase 9); web staf responsif tablet sejak awal.
5. Modul tersier (B08 PPRA, B10 pendidikan, B11 onkologi, I10 costing) fase lanjut, dapat dimatikan per tenant.
6. Tenant klinik (PCare) belum dilayani; struktur tenant tidak menutup kemungkinan itu.
7. NFR awal (usulan): 50 RS, 2.000 pengguna serentak, p95 API < 300 ms untuk operasi klinis, RPO 15 menit, RTO 4 jam.

## Keputusan selama pengembangan

_(tambahkan: tanggal · keputusan · alasan · ADR terkait)_

## Utang teknis

_(tambahkan: modul · utang · risiko · rencana)_
