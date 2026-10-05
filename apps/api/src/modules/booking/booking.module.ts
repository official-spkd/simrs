import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { BookingController } from './booking.controller';
import { BookingRepository } from './booking.repository';
import { BookingService } from './booking.service';

/**
 * F02 · Booking dan janji temu (fase 2 potongan 3): `/api/v1/booking/appointments`.
 *
 * - API booking: buat (`reserveQuota`, `booking_code` dari layanan penomoran, nomor poli, outbox `bpjs.antrean.add`),
 *   daftar, cari per kode, batal (lepas kuota, task 99), jadwal ulang, check-in.
 * - Check-in menerbitkan event domain `booking.checked_in` (`DomainEvents`, `infra/events`) di transaksi yang sama;
 *   mesin task ID di modul `queue` yang bereaksi, bukan tombol di layar.
 * - Job no-show (+ pengingat WhatsApp H-1 lewat outbox, tanpa isi klinis; keputusan §4 #8).
 * - Tes wajib: booking serentak di sisa kuota terakhir → tepat satu berhasil.
 */
@Module({
  imports: [AuthzModule],
  controllers: [BookingController],
  providers: [BookingService, BookingRepository],
  exports: [BookingService],
})
export class BookingModule {}
