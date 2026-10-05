# Keputusan arsitektur (ADR)

Satu berkas per keputusan: `NNNN-judul-singkat.md` dengan baris `Status: … · tanggal` lalu bagian Konteks, Keputusan, Konsekuensi. Keputusan yang berubah tidak ditimpa: tambahkan bagian `## Pembaruan <tanggal> · <topik>` dan `· diperbarui <tanggal>` di baris status.

## Blok nomor

Nomor 0024–0075 sudah dipesan oleh rencana fase di `docs/rencana/` (5 Okt 2026) agar agen yang bekerja paralel tidak memakai nomor yang sama. Pakai nomor dari blok fase yang sedang dikerjakan; keputusan di luar rencana fase memakai nomor bebas berikutnya **setelah 0075**.

| Blok      | Pemakai                                                            | Sudah ada                               |
| --------- | ------------------------------------------------------------------ | --------------------------------------- |
| 0001–0023 | Fase 0–1 dan mode presentasi                                       | semua                                   |
| 0024      | Fase 1 · PIN masuk cepat                                           | 0024                                    |
| 0025–0027 | Fase 2 · lookup sinkron, SSE, prinsipal perangkat                  | 0025, 0026, 0027                        |
| 0028–0032 | Fase 3 · entri klinis berversi, PDF + TTE, CDS, ABAC unit, staging | 0028 (3.0b), 0029 (PDF klinis + TTE), 0031 (fase 2 potongan 7 + pembaruan 3.1), 0032 (3.1) |
| 0033      | Batas laju Redis (di luar rencana fase)                            | 0033                                    |
| 0034–0037 | Fase 4 · penunjang                                                 | –                                       |
| 0038–0041 | Fase 5 · keuangan                                                  | –                                       |
| 0042–0045 | Cadangan fase 4–5                                                  | –                                       |
| 0046–0050 | Fase 6 · pembayaran TPDI × BTN, pembiayaan                         | –                                       |
| 0051–0057 | Fase 7 · integration hub + SATUSEHAT                               | –                                       |
| 0058–0059 | Cadangan fase 3–7                                                  | –                                       |
| 0060–0064 | Fase 8 · back office                                               | –                                       |
| 0065–0069 | Fase 9 · dasbor + aplikasi mobile                                  | –                                       |
| 0070–0075 | Fase 10 · ketahanan dan pilot (0071 backup, 0072 jangkar audit)    | 0071 (backup 3 lokasi + uji restore), 0072 (jangkar audit), 0073 (CSP ber-nonce + peta refresh web) |

Rincian tiap nomor yang dipesan ada di rencana fasenya (`docs/rencana/fase-<n>-*.md`). Bila sebuah nomor ternyata tidak dibutuhkan, biarkan kosong; jangan dipakai ulang untuk topik lain.
