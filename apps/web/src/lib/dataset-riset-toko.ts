import { formatTanggal } from '@simrs/shared';
import { z } from 'zod';
import { type ActorRef, actorRef, must, roleBlock, whenSchema } from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import { ACCESS_LOG_SEED, cohort, DATASET_FIELDS, DATASET_REQUEST } from './demo/fixtures/dataset-riset';
import { DEMO_TODAY, shiftDate } from './demo/fixtures/waktu';
import { ACCESS_DAYS, deidBlock, ethicsBlock, type FieldRule, kAnonymity } from './dataset-riset';

/**
 * I11 · Domain toko demo `dataset-riset` (ADR-0085, CX-3): etik → de-identifikasi (uji k-anonimitas dihitung ulang
 * dari kohort) → persetujuan rilis petugas privasi → ekstrak → unduhan, semua di jejak akses. Pemisahan tugas memakai
 * pengguna sesi (utang bug 6 Okt): penyetuju rilis ≠ pemohon dan ≠ pengguna yang menyusun de-identifikasi.
 */

export const DATASET_DOMAIN = 'dataset-riset';
export const DATASET_APPROVER_ROLES = ['petugas_privasi'] as const;
const RULES = ['pertahankan', 'hapus', 'pseudonim', 'generalisasi'] as const;

export const datasetEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('etik.dicatat'),
    number: z.string().trim().min(6).max(60),
    until: z.iso.date(),
    when: whenSchema,
  }),
  z.strictObject({
    type: z.literal('deid.diterapkan'),
    rules: z.record(z.string().min(1).max(40), z.enum(RULES)),
    when: whenSchema,
  }),
  z.strictObject({ type: z.literal('rilis.disetujui'), when: whenSchema }),
  z.strictObject({ type: z.literal('dataset.diekstrak'), when: whenSchema }),
  z.strictObject({ type: z.literal('dataset.diunduh'), when: whenSchema }),
]);
export type DatasetEvent = z.infer<typeof datasetEventSchema>;

export interface DatasetStoreState {
  /** 1 etik · 2 de-identifikasi · 3 persetujuan · 4 ekstrak · 5 siap. */
  stage: 1 | 2 | 3 | 4 | 5;
  ethics: { number: string; until: string } | null;
  rules: Record<string, FieldRule>;
  k: number | null;
  deidBy: ActorRef | null;
  approvedBy: ActorRef | null;
  log: Array<{ at: string; who: string; action: string }>;
}

export function initialDataset(): DatasetStoreState {
  return {
    stage: 1,
    ethics: null,
    rules: {},
    k: null,
    deidBy: null,
    approvedBy: null,
    log: [...ACCESS_LOG_SEED],
  };
}

export const datasetExpiry = () => shiftDate(DEMO_TODAY, ACCESS_DAYS);

const ROWS = cohort();

function gate(s: DatasetStoreState, ev: DatasetEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'etik.dicatat':
      return s.stage === 1 ? ethicsBlock(ev.number, ev.until, DEMO_TODAY) : 'Persetujuan etik sudah dicatat.';
    case 'deid.diterapkan': {
      if (s.stage !== 2) return 'De-identifikasi diterapkan setelah etik dan sebelum persetujuan rilis.';
      if (Object.keys(ev.rules).some((k) => !DATASET_FIELDS.some((f) => f.key === k)))
        return 'Kolom tidak dikenal.';
      return deidBlock(DATASET_FIELDS, ev.rules, kAnonymity(ROWS, ev.rules));
    }
    case 'rilis.disetujui': {
      if (s.stage !== 3) return 'Rilis disetujui setelah de-identifikasi diterapkan.';
      const role = roleBlock(
        actor,
        DATASET_APPROVER_ROLES,
        'Rilis dataset disetujui posisi Petugas privasi.',
      );
      if (role) return role;
      if (actor.name === DATASET_REQUEST.requester) return 'Penyetuju harus berbeda dari pemohon dataset.';
      if (s.deidBy?.userId === actor.userId)
        return 'Penyetuju harus pengguna lain dari penyusun de-identifikasi (pemisahan tugas).';
      return null;
    }
    case 'dataset.diekstrak':
      return s.stage === 4 ? null : 'Dataset diekstrak setelah rilis disetujui.';
    case 'dataset.diunduh':
      return s.stage === 5 ? null : 'Dataset belum diekstrak.';
  }
}

export const datasetDomain = defineDomain<DatasetStoreState, DatasetEvent>(DATASET_DOMAIN, {
  initial: initialDataset,
  eventSchema: datasetEventSchema,
  screens: ['dataset-riset'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    const log = (action: string, who = by.name) => [...s.log, { at: d.when, who, action }];
    switch (d.type) {
      case 'etik.dicatat':
        return {
          ...s,
          stage: 2,
          ethics: { number: d.number.trim(), until: d.until },
          log: log(`persetujuan etik ${d.number.trim()} dicatat, berlaku s.d. ${formatTanggal(d.until)}`),
        };
      case 'deid.diterapkan': {
        const k = kAnonymity(ROWS, d.rules);
        const kept = DATASET_FIELDS.filter((f) => d.rules[f.key] && d.rules[f.key] !== 'hapus').length;
        return {
          ...s,
          stage: 3,
          rules: { ...d.rules },
          k,
          deidBy: by,
          log: log(`de-identifikasi diterapkan (k = ${k}, ${kept} kolom dipertahankan)`),
        };
      }
      case 'rilis.disetujui':
        return { ...s, stage: 4, approvedBy: by, log: log('rilis dataset disetujui') };
      case 'dataset.diekstrak':
        return {
          ...s,
          stage: 5,
          log: log(
            `dataset diekstrak; tautan untuk ${DATASET_REQUEST.requester} berlaku s.d. ${formatTanggal(datasetExpiry())}`,
            `Sistem (atas perintah ${by.name})`,
          ),
        };
      case 'dataset.diunduh':
        return {
          ...s,
          log: log(
            'mengunduh dataset (CSV bertanda air)',
            `${DATASET_REQUEST.requester} (diperagakan ${by.name})`,
          ),
        };
    }
  },
});
