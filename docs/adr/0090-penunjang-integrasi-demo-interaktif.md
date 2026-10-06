# ADR-0090 · Penunjang dan Integrasi memakai keadaan demo bersama

Status: diterima · 6 Okt 2026 · Komponen S01–S10, I01/I02/I03/I04/I06/I12, P09 · Tugas CX-1

## Konteks

Pemilik produk menunda backend dan meminta seluruh frontend berfungsi, dengan Codex dan Claude Code bekerja pada domain terpisah. Banyak aksi Penunjang dan Integrasi sebelumnya hanya mengubah state komponen; reload menghilangkan hasilnya dan boolean klien dapat meluluskan gerbang yang belum dipenuhi. Toko CD-1 (ADR-0085) menyediakan log per ruang RS, revisi, pelaku sesi, reset, dan langganan reducer.

## Keputusan

1. Domain `penunjang` dan `integrasi` memakai reducer murni dan skema zod ketat. Keduanya `generic: false`; Server Action memeriksa mode demo dan layar sesi lalu melakukan `commitEvent` dengan revisi. Reducer memeriksa ulang tahap dan pelaku di dalam kunci toko. Mode API tetap tertutup sampai backend tersedia.
2. State server menentukan urutan validasi, read-back, WHO checklist, induksi, kepekaan kultur, TTE, CDS, dan perbaikan konektor. Nama pemeriksa/pembuat/TTE berasal dari sesi. Cek ganda darah dan high-alert menggunakan dua id pengguna; nama rekaan atau boolean klien tidak membukakan gerbang.
3. Gateway mencocokkan accession dengan sampel yang sudah diterima, LOINC dengan order, dan satuan dengan katalog. Flag dihitung di server. Control ID ganda idempoten; hasil tervalidasi atau kritis yang sudah dilaporkan terkunci, sehingga laporan read-back lama tidak berlaku untuk nilai baru. PID disamarkan sebelum pesan dicatat ke log. Satu kejadian Gateway diproyeksikan ke Integrasi dan Lab agar ACK dan hasil tidak berbeda.
4. Dispensing mengurangi saldo FEFO Depo yang sama dengan tampilan Farmasi. Pemetaan produk memakai KFA atau nama lengkap termasuk kekuatan/sediaan, tidak kata pertama. Produk tanpa pemetaan memakai saldo terbatas per nama dan depo dari fixture resep. Tidak mengarang KFA, harga, atau kode klinis.
5. Hasil final dan dispensing menghasilkan metadata `released[]` / `dispensations[]`, dibaca pelanggan Integrasi untuk resource antrean. IHS dan Encounter wajib mendahului anak. Status terkirim di demo tetap simulasi konektor lokal, bukan klaim pengiriman ke layanan nyata.
6. Checklist normal memakai `useOptimistic` untuk respons langsung, lalu kembali ke state server atau rollback bila ditolak. Input diserialkan selama penyimpanan; tombol final tetap menunggu aksi selesai. Ini tidak menjadi sumber otoritas gerbang. Pasien yang sedang mengikuti mesin skenario tetap melalui tugas Simulasi.
7. Adaptor `penunjang-klinis.ts` mengikuti kontrak keluar CD-2 `order.ditandatangani` dan `consent.final|consent.ditolak`. Lab/Radiologi/EKG/Echo dapat dibuat dari katalog yang tersedia. Order tanpa pemetaan dan resep tanpa dosis/rute/frekuensi/jumlah/satuan tampil sebagai order tertahan dengan alasan; jangan menyimpulkan rincian dari resep pasien lain. Consent dicocokkan pada pasien dan prosedur yang sama; penolakan menahan langkah terkait.
8. Setelah CD-2 masuk master `1ce8485`, pelanggan `supportClinicalSubscriptions` dan `integrationClinicalSubscriptions` aktif dengan impor langsung `orderDomain` / `consentDomain`. Skema publisher menjadi sumber tunggal; tidak ada domain klinis palsu atau salinan skema. E2E membuktikan CPOE → penerimaan spesimen → Gateway → validasi teknis/klinis → antrean Integrasi, termasuk reload dan pergantian posisi.
9. Handoff menyebutkan batas aliran: metadata dispensing bukan bukti eMAR sudah diberikan atau tagihan berubah. Pelanggan eMAR/charge/hasil klinis dan publisher diet DPJP harus dipasang oleh pemilik bersama sebelum seluruh perjalanan pasien dianggap selesai.

## Validasi

Reducer dan Server Action diuji untuk persistensi, revisi basi, reset, akses peran/API, pemalsuan input, dua akun, multi-kantong, FEFO, ORU, hasil final → Integrasi, CPOE/consent replay dan penerimaan spesimen. E2E domain mencakup desktop/tablet, reload/pergantian posisi, dua akun, Gateway → Lab, serta jaring pengaman seluruh layar. Bukti akhir dan batas integrasi terdapat di `docs/handoff/CX-1.md`; audit seluruh layar di `docs/handoff/CX-0.md`.

## Konsekuensi

- Penyimpanan dan aliran memakai satu pola CD-1; tidak menambah backend, migrasi, atau dependensi.
- Toko lokal tetap mempunyai batas satu proses dan ukuran log seperti ADR-0085.
- Perubahan kontrak klinis berikutnya mengikuti skema publisher CD-2; rincian resep terstruktur dan publisher diet masih perlu ditambahkan pemilik klinis.
- Agregat fixture yang tidak mencakup seluruh transaksi demo perlu keterangan atau perhitungan ulang saat QA CX-4.
