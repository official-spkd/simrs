import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DocumentsController, SignatureVerificationController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { SignatureVerificationService } from './signature-verification.service';

/** P08 · Dokumen pasien + tanda tangan elektronik (TTE lewat outbox) + verifikasi publik. */
@Module({
  imports: [AuthzModule],
  controllers: [DocumentsController, SignatureVerificationController],
  providers: [DocumentsService, DocumentsRepository, SignatureVerificationService],
})
export class DocumentsModule {}
