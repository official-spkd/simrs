# ADR-0026 · Real-time: SSE di atas satu koneksi LISTEN Postgres per instans API

Status: diterima · 5 Okt 2026 · Komponen: F04 (display antrean), kelak K03/K05 (papan IGD/bed) dan S09 (hasil kritis)

## Konteks

docs/01 §4 menetapkan Server-Sent Events untuk display antrean, papan IGD, papan bed, dan notifikasi nilai kritis. Fase 2 butuh display TV yang menerima panggilan antrean seketika (DoD: "Display menerima panggilan real-time").

Rencana fase 2 §5 mencatat risiko SSE:

- proxy yang menahan (buffer) aliran,
- sesi TV yang terbuka berjam-jam,
- event yang hilang saat koneksi putus (replay),
- fan-out bila API berjalan di beberapa instans.

Aturan satu transaksi per permintaan (4 Okt) tidak cocok untuk aliran berjam-jam: transaksi yang dibuka interceptor akan memegang koneksi pool selama aliran hidup. `@Sse()` bawaan Nest juga tidak cocok. Interceptor menunggu observable selesai (artinya transaksi dipegang terus), tidak ada komentar heartbeat, dan tidak ada dukungan `Last-Event-ID`.

## Keputusan

1. **Sumber event = `NOTIFY` Postgres saat commit.**
   - Tabel append-only yang perlu disiarkan (mis. `queue_calls`) diberi trigger `AFTER INSERT` yang memanggil fungsi generik `app_notify_row()` (SQL di bawah, dipasang potongan 0b di migrasinya).
   - Payload hanya `{"tenant_id":…,"id":…}`, tanpa PHI.
   - `NOTIFY` bersifat transaksional, jadi transaksi yang batal tidak pernah menghasilkan event.
2. **Satu koneksi LISTEN per instans API** (`PgNotificationHub`).
   - Klien `pg` tersendiri (role `simrs_app`, `application_name = simrs-api-listen`), bukan dari pool Prisma, dan baru dibuka saat pelanggan pertama datang.
   - Bila putus: sambung ulang dengan backoff eksponensial + jitter (0,5–30 detik), LISTEN ulang semua kanal, lalu kirim `resync` ke semua pelanggan.
   - Banyak instans tidak butuh pub/sub tambahan: Postgres mengirim notifikasi ke setiap instans yang LISTEN.
   - Koneksi ini wajib langsung ke Postgres atau lewat pooler mode sesi. LISTEN tidak jalan di mode transaksi.
3. **Fan-out per kanal + tenant, isi dibaca lewat RLS.**
   - Notifikasi hanya diteruskan ke pelanggan dengan kanal dan tenant yang sama.
   - Baris dibaca `withTenant(tenant pelanggan)` di transaksi pendek. Payload palsu atau tenant yang salah tidak membuka data tenant lain (RLS mengembalikan kosong).
   - Satu pembacaan per (kanal, tenant, id) dibagi ke semua koneksi selama 2 detik, sehingga 50 TV tidak berarti 50 transaksi per panggilan.
4. **Endpoint SSE.** Pola handler: `@TenantScoped()` + `@NoRequestTransaction()` (ADR-0025) + `@RequirePermission(…)`, lalu memanggil `SseService.stream(req, res, kanal, opsi)` dengan `@Req()`/`@Res()`.
   - Otorisasi dan `@Audited` berjalan di transaksi pendek sebelum aliran. Selama streaming tidak ada transaksi maupun koneksi pool yang dipegang.
   - Header: `Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`, lalu `retry: 3000`.
5. **Replay.**
   - `id:` setiap event adalah id baris (UUID v7, terurut waktu).
   - `Last-Event-ID` (header EventSource, atau query `lastEventId` dari BFF) → `kanal.replay(tx, afterId, limit)`. Replay yang sama dijalankan lagi setelah koneksi LISTEN tersambung ulang.
   - Lebih dari 200 event, atau kanal tanpa `replay` → `event: reset`. Klien wajib memuat ulang snapshot (mis. papan antrean).
   - Duplikat antara replay dan notifikasi live dibuang per koneksi.
6. **Umur dan kebersihan koneksi.**
   - Heartbeat `: ping` tiap 15 detik.
   - Umur koneksi maksimal 5 menit, dipendekkan acak hingga 20% agar tidak serempak. Setelahnya EventSource menyambung ulang dengan `Last-Event-ID`, sehingga sesi dan izin diperiksa ulang berkala. Sesi TV berjam-jam tetap tunduk pada pencabutan.
   - Klien terlalu lambat (lebih dari 500 tugas antre atau buffer > 1 MB) diputus.
   - Klien putus atau aplikasi berhenti → langganan dilepas.
7. **Tidak bergantung pada jenis prinsipal.** Helper hanya membaca tenant + pelaku dari konteks permintaan. Prinsipal perangkat TV/anjungan (ADR-0027, menunggu tabel `registered_devices`) cukup ditambahkan di guard.
8. **Data minimal.** Aliran display tanpa PHI (nomor antrean, poli, loket). Aliran yang memuat PHI hanya untuk staf berizin dan diberi `@Audited` saat berlangganan.

### SQL untuk potongan 0b

```sql
-- ADR-0026: beri tahu pendengar SSE saat baris baru commit. Kanal = argumen trigger; payload tanpa PHI.
CREATE OR REPLACE FUNCTION app_notify_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(TG_ARGV[0], json_build_object('tenant_id', NEW.tenant_id, 'id', NEW.id)::text);
  RETURN NULL;
END $$;

-- Per tabel yang disiarkan (nama kanal = nama tabel, huruf kecil/angka/garis bawah, maks 63):
CREATE TRIGGER queue_calls_notify AFTER INSERT ON queue_calls
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('queue_calls');
```

Fungsi ini bukan `SECURITY DEFINER` dan tidak membaca data, jadi tidak butuh peninjauan ADR-0008. Tes infrastruktur memanggil `pg_notify` langsung di transaksi yang sama dengan sisipan baris, setara dengan trigger ini.

## Konsekuensi

+ Display real-time tanpa Redis pub/sub atau broker tambahan; banyak instans API otomatis menerima event yang sama.
+ Isolasi tenant berlapis: penyaringan fan-out + RLS saat membaca. Diuji dengan payload palsu.
+ Pool koneksi aman: diuji 12 aliran terbuka (pool 10) sambil permintaan biasa tetap dilayani.
− Satu koneksi database tambahan per instans API, di luar pool.
− Urutan replay bergantung pada id UUID v7 buatan aplikasi. Transaksi yang commit tidak berurutan bisa membuat event ber-id lebih kecil terlewat saat replay (pengiriman live tetap utuh). Kanal yang butuh urutan ketat memakai kolom urut dari DB sebagai `id` event. Klien wajib menangani `reset`.
− Notifikasi selama koneksi LISTEN putus hilang dan hanya pulih lewat replay. Kanal tanpa replay memaksa klien memuat ulang snapshot.
− BFF web (potongan 4b) wajib meneruskan aliran tanpa buffering dan meneruskan `Last-Event-ID`.
