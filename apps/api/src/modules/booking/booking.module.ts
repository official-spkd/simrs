import { Module } from '@nestjs/common';

/**
 * F02 · Booking dan janji temu. KERANGKA (fase 2 potongan 1b): sudah terdaftar di `AppModule`, potongan 3 cukup
 * menambah controller/service/repository di folder ini.
 *
 * Isi nanti (potongan 3):
 * - API booking: buat (`reserveQuota`, `booking_code` dari layanan penomoran, nomor poli, outbox `bpjs.antrean.add`),
 *   daftar, cari per kode, batal (lepas kuota, task 99), jadwal ulang, check-in.
 * - Check-in menerbitkan event domain `booking.checked_in` (`DomainEvents`, `infra/events`) di transaksi yang sama;
 *   mesin task ID di modul `queue` yang bereaksi, bukan tombol di layar.
 * - Job no-show (+ pengingat WhatsApp H-1 lewat outbox, tanpa isi klinis; keputusan §4 #8).
 * - Tes wajib: booking serentak di sisa kuota terakhir → tepat satu berhasil.
 */
@Module({})
export class BookingModule {}
