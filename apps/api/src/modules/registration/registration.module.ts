import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency';
import { AuthzModule } from '../authz/authz.module';
import { BookingModule } from '../booking/booking.module';
import { QueueModule } from '../queue/queue.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SepModule } from '../sep/sep.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { dukcapilLookupProvider } from './dukcapil-lookup';
import { RegistrationController } from './registration.controller';
import { RegistrationRepository } from './registration.repository';
import { RegistrationService } from './registration.service';

/**
 * F03 · Registrasi dan admisi (rencana fase 2 potongan 5a; IGD/admisi menyusul di potongan 7):
 * - `POST /registration/outpatient` (Idempotency-Key wajib): kunjungan, penjaminan, persetujuan umum, DPJP + relasi
 *   akses, booking walk-in/check-in, SEP `pending` lewat modul `sep` (outbox); event `encounter.registered` →
 *   task 3 (mesin task ID antrean);
 * - `GET /registration/encounters/:id` (ABAC kelompok rekam medis), `GET /registration/desk`;
 * - lookup Dukcapil sinkron (`@NoRequestTransaction()` + `LookupGateway`, ADR-0025);
 * - kontak penanggung jawab `/patients/:id/contacts` (terenkripsi, append-only).
 * Tes wajib: BPJS gagal → registrasi tetap 201 dan SEP `pending` (`apps/api/test/registration.test.ts`).
 */
@Module({
  imports: [AuthzModule, BookingModule, QueueModule, SchedulingModule, SepModule],
  controllers: [RegistrationController, ContactsController],
  providers: [
    RegistrationService,
    RegistrationRepository,
    ContactsService,
    IdempotencyService,
    dukcapilLookupProvider,
  ],
})
export class RegistrationModule {}
