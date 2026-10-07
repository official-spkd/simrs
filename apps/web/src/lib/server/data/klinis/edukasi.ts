import 'server-only';
import { type EncounterEducation, encounterEducationSchema } from '@simrs/shared';
import { z } from 'zod';
import { api } from '../../api';

/**
 * K11 · Edukasi terintegrasi satu kunjungan untuk layar Edukasi mode api (fase 3 · 3.7, ADR-0058): formulir P07
 * terbit, status syarat final persetujuan tindakan, dan riwayat isian (`GET /encounters/:id/education`).
 */
export function encounterEducation(encounterId: string): Promise<EncounterEducation> {
  return api(`/api/v1/encounters/${z.uuid().parse(encounterId)}/education`, {
    schema: encounterEducationSchema,
  });
}
