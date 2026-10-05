# ADR-0025 · Lookup baca-saja ke sistem luar secara sinkron, di luar transaksi permintaan

Status: diterima · 5 Okt 2026 · Komponen: F03, F05, F06, F07 (dipakai), P04 (audit) · Menggantikan sebagian: keputusan 4 Okt "handler tidak boleh memanggil sistem eksternal" dan ADR-0017 §4, **hanya untuk lookup baca-saja**

## Konteks

Keputusan 4 Okt 2026 (PROGRESS) menetapkan satu transaksi bertenant per permintaan, sehingga handler tidak boleh memanggil sistem eksternal: semua lewat outbox (CLAUDE.md §4.5, ADR-0003). ADR-0017 §4 mengikuti pola itu untuk Dukcapil.

Fase 2 (front office) butuh jawaban seketika saat petugas atau pasien di anjungan menunggu:

- BPJS VClaim: cek peserta (aktif, hak kelas) dan rujukan,
- Dukcapil: isian demografi pendaftaran.

Lewat outbox + polling, setiap lookup bertambah ±2 detik dan butuh layar menunggu. Rencana fase 2 §4 keputusan #1 menyetujui lookup sinkron dari API. Yang harus dijaga:

- koneksi pool tidak boleh dipegang selama menunggu sistem luar (pool 10 koneksi habis oleh beberapa lookup lambat),
- jejak audit "siapa melihat data peserta siapa" tetap pasti,
- gangguan BPJS tidak boleh menggantung loket.

## Keputusan

1. **Ruang lingkup sempit.** Hanya operasi **baca-saja** yang tidak mengubah apa pun di sistem luar: VClaim peserta/rujukan dan Dukcapil demografi. Semua penulisan (SEP, antrean/task ID, HFIS, klaim, SATUSEHAT) **tetap lewat outbox**. Aturan 4 Okt dan ADR-0017 tetap berlaku untuk selain lookup ini.
2. **Lepas dari transaksi permintaan secara eksplisit.** Handler memakai `@NoRequestTransaction()`. `TenantTransactionInterceptor` tetap menjalankan:
   - `AuthGuard`,
   - `@RequirePermission` (penolakan diaudit dan di-commit, lalu 403),
   - `@RequireModule`,
   - `@Audited` (ditulis setelah handler).

   Masing-masing di transaksi pendek sendiri. Handler berjalan dengan `tx: null`; `TenantDb.tx()` di luar `TenantDb.transaction(fn)` adalah galat program.
3. **`LookupGateway.lookup(konektor, masukan, opsi)`** menjalankan tiga langkah:
   1. Transaksi pendek: audit `requested` di-commit **sebelum** sistem luar dihubungi (gagal tertutup: tanpa jejak, tanpa lookup).
   2. Panggil konektor tanpa transaksi, batas waktu **5 detik** (`AbortSignal`, konektor boleh lebih pendek).
   3. Transaksi pendek: audit `completed` (+ ringkasan tanpa PHI) dan `persist` opsional, atomik.

   Gateway menolak dipanggil di dalam transaksi.
4. **Galat stabil.**
   - Batas waktu/jaringan/5xx → audit `failed` lalu **503 `BPJS_UNAVAILABLE`** (BPJS) atau **503 `INTEGRATION_UNAVAILABLE`** (Dukcapil), dengan `details: { lookup, reason }`.
   - Penolakan bisnis yang dipetakan konektor ke `AppError` berkode diteruskan apa adanya (audit `failed`, alasan `rejected`).
   - Klien memperlakukan 503 sebagai "lanjutkan tanpa data BPJS". Registrasi tetap jalan, SEP `pending` lewat outbox.
5. **Konektor = antarmuka `LookupConnector<I, O>`** (`name`, `target`, `call(input, signal)`, `summarize?`) yang disuntikkan modul domain. Klien BPJS bersama (`@simrs/shared/node`, potongan 1a) dibungkus menjadi konektor di potongan 5a. Tes memakai konektor palsu. Kredensial BPJS di fase 2 = env tunggal mock (keputusan §4 #11), sehingga API kini ikut memegang kredensial itu, setara worker.
6. **Tanpa PHI di log dan audit.** Masukan (NIK, no. kartu) dan keluaran tidak pernah dicatat. Audit berisi nama lookup, fase, alasan, durasi, dan ringkasan fakta (mis. `{ found, active }`). Log hanya nama lookup, alasan, durasi, nama galat, dan request id.

## Konsekuensi

+ Loket dan anjungan mendapat jawaban peserta/rujukan/demografi seketika.
+ Pool koneksi aman: lookup lambat tidak memegang koneksi (diuji 12 lookup serentak > pool 10).
+ Gangguan BPJS terbatas 5 detik per lookup dengan kode galat yang bisa ditangani UI.
+ Setiap lookup meninggalkan jejak audit, walau sistem luar tidak menjawab.
− Ada dua jalur integrasi (sinkron untuk lookup, outbox untuk penulisan). Peninjau wajib memastikan `@NoRequestTransaction()` hanya dipakai untuk lookup baca-saja dan SSE (ADR-0026).
− API memegang kredensial BPJS/Dukcapil, sehingga pengelolaan rahasia API setara worker. Kredensial per RS terenkripsi menyusul di fase 7.
− Lookup tidak dicoba ulang otomatis; pengguna yang mengulang. Batas laju lookup anjungan (`kiosk.lookup_rate_per_min`) ditegakkan modul anjungan (potongan 6).
