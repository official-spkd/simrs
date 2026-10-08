# ADR-0125 · Dispensing: FEFO di ledger, label dosis untuk eMAR, titik tagih saat serah, retur

Status: diterapkan pada potongan 4.6b (fase 4, S05) · 8 Oktober 2026

## Konteks

Rencana fase 4 §4.6b meminta penyiapan obat FEFO yang mengurangi stok lewat ledger, cek ganda apoteker kedua untuk
obat kewaspadaan tinggi, serah terima, retur, dan label dosis yang dipindai eMAR (F3-5). Skema 4.0b sudah menyediakan
`dispenses`, `dispense_items` (label unik per RS, satu baris ledger per item), `dispense_returns`, CHECK cek ganda oleh
apoteker lain, dan larangan serah high alert tanpa cek ganda. Keputusan fase 4 no. 11 menetapkan titik tagih obat saat
diserahkan. Empat hal belum diatur:

1. Bentuk label dosis dan cara eMAR menerimanya. Pengaman dosis eMAR fase 3 (`app_medication_dose_guard`) hanya
   menerima label lokal = UUID order.
2. eMAR fase 3 mencatat peristiwa biaya `obat` per pemberian. Bila farmasi juga menagih saat serah, obat tertagih dua
   kali.
3. Retur tidak layak: CHECK 4.0b melarang retur tidak layak punya baris ledger.
4. Urutan kunci saat penyiapan beririsan dengan mutasi stok serentak (perbaikan BUG `96385456`).

## Keputusan

1. **Penyiapan = satu transaksi.** `POST /dispensing/prescriptions/:id/prepare` (Idempotency-Key wajib) hanya untuk
   resep berstatus `penyiapan` (lolos telaah 4.5) dan item yang disetujui telaah terakhir. FEFO otomatis memakai
   `pickFefo` atas saldo depo resep (batch kedaluwarsa tidak pernah ditawarkan, dipecah lintas batch bila perlu).
   Batch pilihan manual wajib alasan dan dinilai `manualBatchBlock` (`BATCH_EXPIRED`/`STOCK_INSUFFICIENT` 409). Ledger
   `dispense` ditulis berurutan menurut `stock_batch_id` (urutan kunci yang sama dengan modul stok); trigger ledger tetap
   pengaman terakhir. Satu `dispense_items` per batch, resep berubah ke `serah`. Racikan belum dikeluarkan lewat ledger
   per komponen (ASUMSI 4.6b: 422, disiapkan manual).
2. **Label dosis `OBT-` + 12 heksadesimal** (dari id item, unik per RS). `GET /dispensing/labels/:barcode` (izin
   `medication.administer` + ABAC pasien) dan `DispensingService.resolveLabel` memberi data etiket. eMAR menerima label
   farmasi bila item itu untuk order yang sama dan obatnya sudah diserahkan. Pengaman DB `app_medication_dose_guard`
   diganti (migrasi `20261008620000`) dengan syarat yang sama. Label lokal UUID order tetap sah untuk stok ruangan.
   Etiket dicetak HTML di `/cetak/etiket-obat/<dispenseId>` (70 × 35 mm).
3. **Titik tagih obat = serah.** Serah terima mencatat satu peristiwa biaya `obat` per item (`dispense_items`, jumlah =
   qty, tanpa harga, ADR-0032) dan event `pharmacy.dispensed`. Resep berubah ke `selesai`. eMAR hanya menagih dosis
   berlabel lokal (stok ruangan). Event `medication.administered` membawa `wardStock` (opsional, untuk event lama).
   Pengaturan `emar.require_pharmacy_review` kini ditegakkan: dosis `given` ditolak bila order belum lolos telaah
   farmasi.
4. **Cek ganda dan serah.** Cek ganda oleh apoteker lain dari sesinya sendiri (`DOUBLE_CHECK_SAME_USER`), sekali per
   penyiapan. Serah high alert tanpa cek ganda → `HIGH_ALERT_DOUBLE_CHECK_REQUIRED`. Keduanya juga dijaga CHECK 4.0b.
5. **Retur setelah serah** (Idempotency-Key wajib, alasan 10–500 karakter, total retur ≤ qty diserahkan). Layak →
   ledger `return` ke depo asal (batch kedaluwarsa hanya boleh dicatat tidak layak). Tidak layak → dicatat tanpa
   baris ledger, karena obat sudah keluar dari saldo saat serah. Tiap baris menerbitkan `pharmacy.returned` (`restocked`)
   sebagai dasar kredit tagihan fase 5.
6. **Lingkup.** Penyiapan, cek ganda, dan serah: `pharmacy.dispense.*` lingkup depo unit penugasan. Retur perawat
   (lingkup `relationship`) lewat ABAC pasien.

## Konsekuensi

- Saldo = Σ ledger tetap berlaku untuk dispensing dan retur. Uji API mencakup FEFO, klik ganda, ED, saldo kurang, cek
  ganda, serah high alert, tagihan, retur, label eMAR tanpa tagihan ganda, lingkup, dan isolasi.
- Belum dikerjakan: UDD rawat inap per jadwal dosis (satu label per batch, bukan per dosis), panggilan antrean farmasi
  `F` dan task 7 BPJS saat serah (event tersedia, pengirim task belum), kredit tagihan dihitung fase 5, dan layar eMAR
  belum memindai label farmasi lewat kamera (input label manual tetap berjalan).
