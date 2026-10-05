import { Injectable } from '@nestjs/common';
import {
  ClinicalPdfService,
  type IssueClinicalPdfInput,
  type IssuedClinicalPdf,
} from '../../modules/documents/clinical-pdf.service';
import { ClinicalRecordService, type ClinicalTable } from './clinical-record.service';

/**
 * ADR-0028/0029 · Titik sambung TTE dokumen klinis legal (resume, persetujuan/penolakan, resep). PDF deterministik +
 * `documents` + `document_signatures` pending + outbox `tte.sign` milik `ClinicalPdfService` (ADR-0029); layanan ini
 * hanya menjalankannya di bawah kunci advisory VERSI yang sama dengan koreksi (`lockForSigning`): versi yang sudah
 * tergantikan tidak bisa ditandatangani, dan setelah dokumen bertanda tangan tersimpan versi itu terkunci
 * (`RECORD_LOCKED`, perubahan lewat addendum). `source` selalu versi entri yang ditandatangani.
 */
@Injectable()
export class ClinicalSigningService {
  constructor(
    private readonly records: ClinicalRecordService,
    private readonly pdf: ClinicalPdfService,
  ) {}

  issueSigned(
    table: ClinicalTable,
    versionId: string,
    input: Omit<IssueClinicalPdfInput, 'source' | 'tte'> & { tte: NonNullable<IssueClinicalPdfInput['tte']> },
  ): Promise<IssuedClinicalPdf> {
    return this.records.lockForSigning(table, versionId, () =>
      this.pdf.issue({ ...input, source: { table, id: versionId } }),
    );
  }
}
