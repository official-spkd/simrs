# ADR-0036 · Ledger stok, saldo dijaga database, dan FEFO

Tanggal: 7 Oktober 2026 · Status: diterima (rencana fase 4 keputusan no. 9, 10, 11, 12); ledger + saldo diterapkan
pada 4.0b (migrasi `20261008100000_support_services`), FEFO otomatis + layar menyusul 4.6a/4.6b.

## Konteks

Depo farmasi butuh saldo per lokasi × batch yang tidak pernah negatif walau banyak penyerahan serentak, tidak
mengeluarkan batch kedaluwarsa, dan bisa diaudit (setiap perubahan saldo punya sebab).

## Keputusan

1. **Ledger append-only** `stock_movements` (`receipt`, `transfer_out`/`transfer_in`, `dispense`, `return`,
   `adjustment`, `usage`, `write_off`), tanda kuantitas dijaga CHECK per jenis; penyesuaian dan pemusnahan wajib
   alasan 10–500 karakter; `dispense`/`usage` wajib pasien. Item penerimaan/penyesuaian = baris ledger
   (`ref_type`/`ref_id`), bukan tabel item terpisah.
2. **Saldo hanya diubah trigger.** `stock_balances` hanya SELECT bagi `simrs_app`; trigger `app_stock_apply_movement`
   (SECURITY DEFINER, `SET search_path = public, pg_temp`, setiap kueri dibatasi `tenant_id = NEW.tenant_id`, RLS FORCE
   tetap berlaku pada pemilik tabel) membuat/mengunci baris saldo per lokasi × batch, menolak saldo negatif
   (`STOCK_INSUFFICIENT`), dan menolak batch kedaluwarsa ke pasien (`BATCH_EXPIRED`, tanggal WIB).
3. **FEFO otomatis** di API (4.6a); override wajib alasan. Harga pokok per batch `bigint`; biaya FIFO = urutan FEFO.
4. **B01 minimal fase 4:** penerimaan tanpa PO, mutasi dua langkah (kirim lalu terima), penyesuaian beralasan. PO, ROP,
   dan opname penuh di fase 8.
5. **Titik tagih obat** saat diserahkan (dispense); retur mengkredit. eMAR hanya untuk stok ruangan.
6. **Cek ganda high-alert** oleh apoteker kedua dari sesinya sendiri: CHECK `double_checked_by <> prepared_by`, dan
   penyerahan obat high-alert tidak bisa tercatat tanpa cek ganda.

## Konsekuensi

- Penyerahan serentak atas batch yang sama berurutan pada kunci baris saldo; satu gagal bila saldo habis.
- Koreksi stok selalu lewat ledger (penyesuaian beralasan), tidak pernah lewat UPDATE saldo.
- Fungsi SECURITY DEFINER ini termasuk daftar yang wajib ditinjau setiap perubahan migrasi (docs/05).

## Pembaruan 7 Okt 2026 · API stok 4.6a

- **Lingkup.** `stock.*` berlingkup `unit` = lokasi stok yang unitnya sama dengan unit penugasan sesi (apoteker FARMASI:
  gudang + depo RJ/RI; apoteker IGD: depo IGD); `all` (manajemen `stock.read`) = semua lokasi. Penugasan tanpa unit
  tidak melihat lokasi mana pun. Tujuan mutasi boleh di luar unit (`GET /stock/locations?purpose=destination`, nama
  saja); penerimaan mutasi wajib berlingkup atas depo tujuan.
- **Kedaluwarsa (ED ≤ hari ini WIB).** Ditolak saat penerimaan dan mutasi (`BATCH_EXPIRED`), tidak boleh ditambah lewat
  penyesuaian; pengurangannya tercatat `write_off` (hapus buku). Trigger tetap menjadi penjaga terakhir untuk
  `dispense`/`usage`.
- **Batch.** Nomor batch per obat unik; penerimaan ulang nomor batch yang sama wajib ED yang sama (409 bila beda). Harga
  pokok batch: lihat pembaruan 4.6a-2 (tidak lagi beku).
- **Mutasi dua langkah.** Kirim = `transfer_out` di asal (stok dalam perjalanan tidak ada di kedua depo); terima =
  `transfer_in` di tujuan, sekali (baris mutasi dikunci `FOR UPDATE`, terima ganda 409). FEFO mutasi diusulkan layar
  dengan `pickFefo`; API memeriksa ulang ED dan saldo. Pengirim dan penerima boleh orang yang sama bila berlingkup atas
  kedua depo (B01 minimal); pemisahan tugas menunggu fase 8.
- **Kontrak baca** (lokasi, pemasok, obat, kartu stok, dokumen stok) di `packages/shared/src/schemas/stock.ts`; masukan
  dan saldo tetap di `penunjang-api.ts` (4.0a).

## Pembaruan 8 Okt 2026 · 4.6a-2 (keputusan orkestrator)

- **Idempotensi.** `POST /stock/receipts`, `/stock/transfers`, `/stock/transfers/:id/receive`, dan `/stock/adjustments`
  wajib header `Idempotency-Key` (UUID) lewat `IdempotencyService` (pola registrasi): tanpa kunci 400
  `IDEMPOTENCY_KEY_REQUIRED`; kunci + isi sama = dokumen yang sama (200, tanpa efek kedua); kunci sama isi lain 409
  `IDEMPOTENCY_KEY_REUSED`. Layar Depo membuat kunci per submit.
- **Faktur.** Indeks unik `stock_receipts (tenant_id, supplier_id, invoice_no)`; faktur yang sama dengan kunci lain → 409.
  Migrasi `20261008600000` memberi akhiran nomor TRM pada faktur ganda lama (hanya data uji fiktif).
- **Harga pokok (merevisi "harga batch beku").** Setiap baris ledger `receipt` menyimpan `unit_cost` (harga faktur
  baris itu; CHECK wajib untuk `receipt`, kosong untuk jenis lain). Trigger `app_stock_apply_movement` memperbarui
  `stock_batches.unit_cost` menjadi rata-rata tertimbang `(harga lama × saldo semua lokasi + harga baris × qty) / (saldo
  + qty)` (dibulatkan ke rupiah) di bawah kunci baris batch; bila saldo nol, harga baris dipakai. Selain `unit_cost`,
  batch tetap beku dan tidak bisa dihapus (`stock_batches_guard`). Fase 5 (HPP/jurnal) membaca harga dari ledger.
- **Mutasi tersangkut.** `POST /stock/transfers/:id/cancel` (beralasan 10–500, diaudit, event `stock.transferred` tahap
  `dibatalkan`) oleh petugas `stock.transfer` berlingkup atas depo **asal** (pengirim atau rekan sedepo), hanya saat
  `dikirim`: baris `transfer_in` pembalik di depo asal. Status hanya maju dari `dikirim` (`stock_transfers_guard`).
- **Lokasi.** `POST /stock/locations/:id/active` (izin `facility.write`); lokasi yang masih punya mutasi `dikirim`
  masuk/keluar tidak bisa dinonaktifkan (`stock_locations_transit_guard` → 409 `STOCK_LOCATION_IN_TRANSIT`).
