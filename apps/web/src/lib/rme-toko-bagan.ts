import { formAnswersSchema } from '@simrs/shared';
import { z } from 'zod';
import type { DomainEvent } from './demo/store/define';
import type { AssessmentResponse } from './rme-asesmen';

/**
 * Toko demo `rekam-medis` (ADR-0085), bagian bagan RME FE2: asesmen, diagnosis + problem list + alergi, konsultasi,
 * edukasi, paket layanan, kelengkapan + tutup kunjungan. Kejadian membawa rekaman versi baru yang sudah dihitung
 * Server Action dari keadaan server (aturan murni di `lib/rme-*.ts`), sehingga reducer hanya menambahkan (append-only;
 * koreksi = versi baru, CLAUDE.md §4.2). Pelaku dan jam selalu dari sesi/server.
 */

const encounterId = z.string().min(1).max(60);
const isoInstant = z.iso.datetime({ offset: true });
const recId = z.string().min(1).max(120);

export const assessmentRecordSchema = z.strictObject({
  id: recId,
  formCode: z.string().min(1).max(60),
  encounterId,
  version: z.int().min(1).max(99),
  answers: formAnswersSchema,
  at: isoInstant,
  supersedesId: recId.nullable(),
  reason: z.string().trim().min(10).max(500).nullable(),
});

export const rmeExtraEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Isian asesmen final (versi 1) atau koreksi berversi. */
    type: z.literal('asesmen.disimpan'),
    encounterId,
    response: assessmentRecordSchema,
  }),
]);
export type RmeExtraEvent = z.infer<typeof rmeExtraEventSchema>;

export interface RmeExtraState {
  assessments: readonly AssessmentResponse[];
}

export const RME_EXTRA_INITIAL: RmeExtraState = {
  assessments: [],
};

export function rmeExtraConflict(s: RmeExtraState, d: RmeExtraEvent): string | null {
  switch (d.type) {
    case 'asesmen.disimpan':
      if (s.assessments.some((r) => r.id === d.response.id)) return 'Isian asesmen ganda.';
      if (d.response.supersedesId && s.assessments.some((r) => r.supersedesId === d.response.supersedesId))
        return 'Isian ini sudah dikoreksi; koreksi versi terbaru.';
      return null;
  }
}

export function reduceRmeExtra<S extends RmeExtraState>(s: S, ev: DomainEvent<RmeExtraEvent>): S {
  const d = ev.data;
  const conflict = rmeExtraConflict(s, d);
  if (conflict) throw new Error(conflict);
  switch (d.type) {
    case 'asesmen.disimpan':
      return { ...s, assessments: [...s.assessments, { ...d.response, by: ev.actor.name }] };
  }
}
