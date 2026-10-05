import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';

/**
 * K06 · Asesmen dan skrining. Pengisian lewat formulir P07 dengan `encounterId` (potongan 3.2b); modul ini membaca
 * asesmen per kunjungan. Kelengkapan paket formulir (EP 6b/7a) menyusul potongan 3.8. Didaftarkan sekali di
 * `AppModule` (potongan 3.1).
 */
@Module({
  imports: [AuthzModule],
  controllers: [AssessmentController],
  providers: [AssessmentService],
  exports: [AssessmentService],
})
export class AssessmentModule {}
