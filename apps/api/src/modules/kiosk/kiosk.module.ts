import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { RegistrationModule } from '../registration/registration.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { KioskController } from './kiosk.controller';
import { KioskRepository } from './kiosk.repository';
import { KioskService } from './kiosk.service';

/**
 * F05 · Anjungan mandiri (fase 2 potongan 6): `/api/v1/kiosk`.
 *
 * PRINSIPAL PERANGKAT (ADR-0027): endpoint anjungan TIDAK memakai sesi staf (`@DeviceScoped('kiosk.use')`); pelaku
 * perangkat ada di `TenantDb.actor().devicePrincipal`, unitnya di `actor().unitId`.
 *
 * - identify (nama tersamar + tanggal lahir tanpa tahun + batas laju per perangkat, keputusan §4 #3; token `kl1`
 *   sekali pakai di `kiosk_lookups`), check-in booking (`BookingService.checkIn`, event `booking.checked_in` → task 1),
 *   tiket loket/farmasi/kasir (`QueueService.issueKioskTicket`, sumber `anjungan`), bantuan (P09 tanpa PHI), cetak
 *   HTML 80 mm (hanya tiket perangkat ini, `kiosk_tickets`).
 * - registrasi mandiri (`kioskRegisterSchema`): memakai ulang `RegistrationService.registerOutpatient` (potongan 5a:
 *   Idempotency-Key, kunjungan, SEP `pending` lewat outbox); hal yang butuh petugas → 422 `KIOSK_NEEDS_COUNTER`.
 */
@Module({
  imports: [BookingModule, QueueModule, NotificationsModule, RegistrationModule, SchedulingModule],
  controllers: [KioskController],
  providers: [KioskService, KioskRepository],
})
export class KioskModule {}
