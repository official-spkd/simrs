import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingRepository } from './scheduling.repository';
import { SchedulingService } from './scheduling.service';

/**
 * F01 · Jadwal praktik dan kuota (rencana fase 2 potongan 2): `/api/v1/scheduling` — minggu, kuota hari ini, sesi,
 * templat mingguan, ubah kuota berversi (409 `QUOTA_BELOW_BOOKED`), cuti + pengganti, pengalihan booking, kirim/tarik
 * HFIS (outbox `bpjs.hfis.update` / `bpjs.hfis.pull`), perbedaan RS vs HFIS. Sesi dibangkitkan dari templat oleh job
 * worker `scheduling.generate-sessions` (atau `POST sessions/generate`). Kuota dijamin DB (CHECK + UPDATE bersyarat).
 * Cuti/libur per tanggal dan kapasitas dicatat petugas di aplikasi HFIS (web service HFIS hanya menerima templat).
 */
@Module({
  imports: [BookingModule],
  controllers: [SchedulingController],
  providers: [SchedulingService, SchedulingRepository],
  exports: [SchedulingService],
})
export class SchedulingModule {}
