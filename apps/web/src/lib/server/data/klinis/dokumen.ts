import 'server-only';
import { type PatientDocumentView, patientDocumentSchema } from '@simrs/shared';
import { z } from 'zod';
import { api } from '../../api';

/**
 * P08 · Dokumen pasien untuk layar klinis mode api (fase 3 · 3.8, ADR-0059): daftar kelompok rekam medis pasien dari
 * `GET /api/v1/patients/:id/documents` (izin `documents.read`, ABAC + audit di API).
 */
export async function patientDocuments(patientId: string): Promise<PatientDocumentView[]> {
  const id = z.uuid().parse(patientId);
  return api(`/api/v1/patients/${id}/documents`, { schema: patientDocumentSchema.array() });
}
