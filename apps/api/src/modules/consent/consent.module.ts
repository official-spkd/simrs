import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DocumentsModule } from '../documents/documents.module';
import { ConsentController, EncounterConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/**
 * K11 · Persetujuan/penolakan tindakan tablet + TTE (potongan 3.7). Didaftarkan sekali di `AppModule` (potongan 3.1).
 * TTE lewat `ClinicalSigningService` (infra klinis global); gambar tanda tangan lewat `DocumentsService` (P08);
 * edukasi pasien lewat formulir P07 dengan `encounterId`.
 */
@Module({
  imports: [AuthzModule, DocumentsModule],
  controllers: [ConsentController, EncounterConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
