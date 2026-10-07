import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { ClinicalPdfService } from './clinical-pdf.service';
import { DocumentsController, SignatureVerificationController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { SignatureVerificationService } from './signature-verification.service';

/**
 * P08 · Dokumen pasien + tanda tangan elektronik (TTE lewat outbox) + verifikasi publik. P12 minimal: PDF klinis
 * deterministik (`ClinicalPdfService`, ADR-0029) dan `DocumentsService` (gambar tanda tangan persetujuan, dokumen
 * pasien klinis) diekspor untuk modul klinis yang mengimpor modul ini.
 */
@Module({
  imports: [AuthzModule],
  controllers: [DocumentsController, SignatureVerificationController],
  providers: [DocumentsService, DocumentsRepository, SignatureVerificationService, ClinicalPdfService],
  exports: [ClinicalPdfService, DocumentsService],
})
export class DocumentsModule {}
