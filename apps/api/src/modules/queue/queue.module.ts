import { Module } from '@nestjs/common';

/**
 * F04 · Antrean, display real-time, dan task ID BPJS. KERANGKA (fase 2 potongan 1b): sudah terdaftar di `AppModule`,
 * potongan 4a cukup menambah controller/service/repository di folder ini.
 *
 * Isi nanti (potongan 4a):
 * - API antrean: layanan, tiket (`allocateQueueNumber`, `<prefix>-<3 digit>`), panggil berikutnya, ulang/lewati/mulai/
 *   selesai, papan display.
 * - Aliran SSE papan display: handler `@TenantScoped()` + `@NoRequestTransaction()` yang memanggil
 *   `SseService.stream(req, res, kanal)` dengan kanal `queue_calls` (trigger `app_notify_row`, ADR-0026). Display TV
 *   memakai prinsipal perangkat (ADR-0027) setelah tabel perangkat terdaftar tersedia.
 * - Mesin task ID mendaftar ke `DomainEvents` (`booking.checked_in` → 1, panggilan loket → 2, `encounter.registered`
 *   → 3, poli mulai/selesai → 4/5, batal → 99) dan menulis outbox `updatewaktu` dengan `defer` agar urutan terjaga.
 * - Izin `queue.read|call|manage`, perangkat `queue.display.read`.
 */
@Module({})
export class QueueModule {}
