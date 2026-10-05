import { Injectable } from '@nestjs/common';
import { AppError } from '@simrs/shared';
import type { ClinicalTable } from './clinical-record.service';

/**
 * ADR-0028/0029 · Titik sambung TTE dokumen klinis legal (resume, persetujuan/penolakan, resep). Implementasi (PDF
 * deterministik → `documents` dengan `source_type`/`source_id` → `document_signatures` pending → outbox `tte.sign`)
 * milik potongan ADR-0029; modul klinis hanya memanggil port ini, di dalam `ClinicalRecordService.lockForSigning`
 * (kunci advisory versi yang sama dengan koreksi), sehingga versi yang ditandatangani tidak bisa digantikan.
 */
export interface ClinicalSigningRequest {
  /** Tabel + versi entri sumber (menjadi `documents.source_type`/`source_id`, dasar kunci `RECORD_LOCKED`). */
  sourceType: ClinicalTable;
  sourceId: string;
  patientId: string;
  /** Jenis dokumen P08 (`resume`, `consent`, `surat`, …). */
  documentKind: 'resume' | 'consent' | 'surat' | 'lainnya';
  /** Judul dokumen (tanpa PHI selain yang memang tercetak di dokumen; tidak masuk log). */
  title: string;
  /** Penanda tangan (dari sesi; DPJP/dokter penanggung jawab). */
  signerUserId: string;
  /** Templat PDF + data yang dirender ADR-0029. */
  template: string;
  data: Record<string, unknown>;
}

export interface ClinicalSigningResult {
  documentId: string;
  signatureId: string;
}

export interface ClinicalSigningPort {
  requestSignature(req: ClinicalSigningRequest): Promise<ClinicalSigningResult>;
}

/** Token DI port TTE klinis. */
export const CLINICAL_SIGNING_PORT = Symbol('CLINICAL_SIGNING_PORT');

/**
 * Bawaan sampai implementasi ADR-0029 terpasang: menolak dengan 503 berkode stabil, sehingga tombol TTE gagal jelas
 * (bukan diam-diam menganggap dokumen tertandatangani).
 */
@Injectable()
export class UnavailableClinicalSigning implements ClinicalSigningPort {
  requestSignature(): Promise<ClinicalSigningResult> {
    return Promise.reject(
      new AppError(
        'INTEGRATION_UNAVAILABLE',
        'Penandatanganan elektronik dokumen klinis belum tersedia',
        503,
      ),
    );
  }
}
