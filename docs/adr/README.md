# Keputusan arsitektur (ADR)

Satu berkas per keputusan: `NNNN-judul-singkat.md` dengan baris `Status: … · tanggal` lalu bagian Konteks, Keputusan, Konsekuensi. Keputusan yang berubah tidak ditimpa: tambahkan bagian `## Pembaruan <tanggal> · <topik>` dan `· diperbarui <tanggal>` di baris status.

## Blok nomor

Nomor 0024–0075 sudah dipesan oleh rencana fase di `docs/rencana/` (5 Okt 2026) agar agen yang bekerja paralel tidak memakai nomor yang sama. Pakai nomor dari blok fase yang sedang dikerjakan; keputusan di luar rencana fase memakai nomor bebas berikutnya **setelah 0075**.

| Blok      | Pemakai                                                            | Sudah ada                               |
| --------- | ------------------------------------------------------------------ | --------------------------------------- |
| 0001–0023 | Fase 0–1 dan mode presentasi                                       | semua                                   |
| 0024      | Fase 1 · PIN masuk cepat                                           | 0024                                    |
| 0025–0027 | Fase 2 · lookup sinkron, SSE, prinsipal perangkat                  | 0025, 0026, 0027                        |
| 0028–0032 | Fase 3 · entri klinis berversi, PDF + TTE, CDS, ABAC unit, staging | 0028 (3.0b), 0029 (PDF klinis + TTE), 0030 (CDS deklaratif, 3.4), 0031 (fase 2 potongan 7 + pembaruan 3.1), 0032 (3.1) |
| 0033      | Batas laju Redis (di luar rencana fase)                            | 0033                                    |
| 0034–0037 | Fase 4 · penunjang                                                 | 0034 (worklist + ABAC penunjang), 0035 (ingest analyzer lab), 0036 (ledger stok + FEFO), 0037 (gerbang keselamatan penunjang di DB) |
| 0038–0041 | Fase 5 · keuangan                                                  | –                                       |
| 0042–0045 | Cadangan fase 4–5                                                  | –                                       |
| 0046–0050 | Fase 6 · pembayaran TPDI × BTN, pembiayaan                         | –                                       |
| 0051–0057 | Fase 7 · integration hub + SATUSEHAT                               | –                                       |
| 0058–0059 | Cadangan fase 3–7                                                  | 0058 (persetujuan tindakan draf tablet, 3.7), 0059 (konsultasi + paket formulir + dokumen pasien, 3.8) |
| 0060–0064 | Fase 8 · back office                                               | –                                       |
| 0065–0069 | Fase 9 · dasbor + aplikasi mobile                                  | –                                       |
| 0070–0075 | Fase 10 · ketahanan dan pilot (0071 backup, 0072 jangkar audit)    | 0071 (backup 3 lokasi + uji restore), 0072 (jangkar audit), 0073 (CSP ber-nonce + peta refresh web) |
| 0076+     | Di luar rencana fase (nomor bebas berikutnya)                      | 0076 (gerbang keamanan statis rute API + integrasi gagal tertutup), 0077 (eMAR cek ganda terikat dosis), 0085 (toko keadaan demo bersama, CD-1), 0093 (resume, gerbang pulang, surat kematian K-1), 0096 (layar Rawat inap api: ganti gelang beralasan, cek ganda dua sesi, W4), 0104 (layar IGD + Tempat tidur api: sinyal papan, admisi dari IGD satu langkah, ambil pasien, W3), 0105 (Gizi + Bank darah: cek ganda dua petugas, gelang ↔ kantong, ABO per komponen, tampilan layanan, 4.9), 0107 (Farmasi klinis: depo tujuan per kelas kunjungan, CDS saat telaah per putaran, gerbang telaah, intervensi tanpa mengubah resep, 4.5), 0125 (Dispensing: FEFO di ledger, label dosis untuk eMAR, titik tagih saat serah, retur, 4.6b) |

Rincian tiap nomor yang dipesan ada di rencana fasenya (`docs/rencana/fase-<n>-*.md`). Bila sebuah nomor ternyata tidak dibutuhkan, biarkan kosong; jangan dipakai ulang untuk topik lain.
