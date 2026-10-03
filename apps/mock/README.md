# @simrs/mock

Mock semua integrasi eksternal (ADR-0006) di `http://localhost:4100`, dengan panel kendali di `/`.

| Prefix             | Sistem                    | Isi fase 0                                                                                              |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/bpjs`            | VClaim, Antrean, Aplicare | Verifikasi `X-signature`, respons terenkripsi (bisa dimatikan di panel), peserta by NIK, update task id |
| `/eklaim/ws.php`   | E-Klaim                   | Kerangka metode; grouper berkode **simulasi** `SIM-*`                                                   |
| `/satusehat`       | SATUSEHAT                 | Token OAuth2, lookup IHS by NIK, POST resource (wajib `subject`/`encounter`, 401/422)                   |
| `/dukcapil/verify` | Dukcapil                  | Demografi fiktif deterministik dari NIK                                                                 |
| `/tte`             | TTE                       | Tanda tangan tiruan atas hash + verifikasi                                                              |
| `/tpdi/v1`         | TPDI                      | Invoice VA/QRIS idempotent, laporan transaksi, refund; webhook HMAC dari panel                          |
| `/btn/v1`          | BTN                       | Mutasi rekening dari invoice lunas; kerangka pembiayaan                                                 |
| `/<sistem>/_echo`  | semua                     | Penerima pesan outbox contoh, dedup per `Idempotency-Key`                                               |

Panel: skenario per sistem (normal, lambat, gagal, acak), enkripsi BPJS on/off, tagihan TPDI (Bayar, Kedaluwarsakan, Kirim webhook ulang dengan event id sama), pesan outbox diterima, 50 request terakhir, reset.

Data fiktif: NIK uji berawalan `9999`; NIK berakhiran `0000` = peserta BPJS tidak aktif, `9999` = tidak ditemukan di Dukcapil.

`pnpm dev` (tsx watch, membaca `../../.env`), `pnpm test`.
