import { Module } from '@nestjs/common';

/**
 * F01 · Jadwal praktik dan kuota. KERANGKA (fase 2 potongan 1b): sudah terdaftar di `AppModule`, potongan 2 cukup
 * menambah controller/service/repository di folder ini.
 *
 * Isi nanti (potongan 2, `docs/rencana/fase-2-front-office.md`):
 * - API `/api/v1/scheduling`: jadwal per minggu, kuota hari ini, templat mingguan, ubah kuota
 *   (409 `QUOTA_BELOW_BOOKED`), cuti/pengganti, alih jadwal, kirim/beda HFIS.
 * - Kuota dijamin DB (`schedule_sessions`, CHECK `booked <= quota`); reservasi lewat helper `reserveQuota`/`releaseQuota`
 *   dari `@simrs/db` (potongan 0b), bukan dihitung di kode.
 * - Outbox `bpjs.hfis.update`; job pembangkit sesi 30 hari + tarik HFIS ada di worker.
 * - Izin `schedule.read|write|sync` (potongan 0a); yang boleh mengubah: petugas pendaftaran + admin RS (keputusan §4 #12).
 */
@Module({})
export class SchedulingModule {}
