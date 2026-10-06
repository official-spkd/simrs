import {
  POLI_VISIT_STAGES,
  type PoliEncounter,
  type PoliQueueStatus,
  type PoliVital,
  type PoliWorklist,
} from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { bloodPressureFlag, icd10Display, parseBloodPressure } from './klinis';

/**
 * Toko demo bersama (ADR-0085) · domain `klinis-poli`: pemeriksaan poli rawat jalan (panggil antrean, tanda vital
 * perawat, CPPT · SOAP dokter: draf, tanda tangan, co-sign DPJP atas catatan residen). Kejadian keluar (kontrak):
 * - `antrean.dipanggil` → display antrean/kendali antrean (front office, CD-3);
 * - `cppt.ditandatangani` dengan `final: true` dan `cppt.cosign` → kunjungan rawat jalan selesai: tagihan siap di
 *   kasir (CX-2) dan kelengkapan RM.
 * Pasien skenario Simulasi (Tn. Suryo) tetap mengikuti tugas skenario.
 */

const encounterId = z.string().min(1).max(60);
const patientId = z.string().min(1).max(60);
const hm = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
const icd10 = z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/);

export const poliEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Pasien dipanggil ke ruang periksa; pasien lain yang sedang diperiksa dijeda (dihitung server). */
    type: z.literal('antrean.dipanggil'),
    patientId,
    at: hm,
    paused: z.array(patientId).max(20),
  }),
  z.strictObject({
    type: z.literal('vital.dicatat'),
    encounterId,
    td: z.string().regex(/^\d{2,3}\/\d{2,3}$/),
    nadi: z.int().min(20).max(250),
    suhu: z.string().regex(/^\d{2}([.,]\d)?$/),
    spo2: z.int().min(50).max(100),
    at: hm,
  }),
  z.strictObject({
    type: z.literal('cppt.draf'),
    encounterId,
    patientId,
    subjective: z.string().max(2000),
    objective: z.string().max(2000),
    diagnosisCodes: z.array(icd10).max(10),
    at: hm,
  }),
  z.strictObject({
    /** Tanda tangan CPPT: final (DPJP) atau menunggu co-sign (residen). */
    type: z.literal('cppt.ditandatangani'),
    encounterId,
    patientId,
    subjective: z.string().max(2000),
    objective: z.string().max(2000),
    diagnosisCodes: z.array(icd10).min(1).max(10),
    final: z.boolean(),
    at: hm,
  }),
  z.strictObject({
    /** Co-sign DPJP atas CPPT residen: kunjungan selesai. */
    type: z.literal('cppt.cosign'),
    encounterId,
    patientId,
    at: hm,
  }),
]);
export type PoliEvent = z.infer<typeof poliEventSchema>;

export interface PoliSoapStored {
  subjective: string;
  objective: string;
  diagnosisCodes: readonly string[];
  savedAt: string | null;
  /** Jam final (DPJP atau co-sign). */
  signedAt: string | null;
  /** Catatan residen menunggu co-sign DPJP sejak jam ini. */
  cosignAt: string | null;
  authorId: string;
  author: string;
  cosignedBy: string | null;
}

export interface PoliState {
  queue: Readonly<Record<string, { status: PoliQueueStatus; wait: string }>>;
  soap: Readonly<Record<string, PoliSoapStored>>;
  vitals: Readonly<
    Record<string, { td: string; nadi: number; suhu: string; spo2: number; at: string; by: string }>
  >;
}

export const POLI_SIGNED = 'CPPT kunjungan ini sudah final; perubahan lewat addendum berversi.';

export function poliConflict(s: PoliState, d: PoliEvent): string | null {
  switch (d.type) {
    case 'cppt.draf':
    case 'cppt.ditandatangani': {
      const cur = s.soap[d.encounterId];
      if (cur?.signedAt) return POLI_SIGNED;
      if (cur?.cosignAt) return 'CPPT residen menunggu co-sign DPJP.';
      return null;
    }
    case 'cppt.cosign': {
      const cur = s.soap[d.encounterId];
      if (!cur?.cosignAt) return 'Tidak ada CPPT residen yang menunggu co-sign.';
      return cur.signedAt ? POLI_SIGNED : null;
    }
    case 'antrean.dipanggil':
    case 'vital.dicatat':
      return null;
  }
}

export const poliDomain = defineDomain<PoliState, PoliEvent>('klinis-poli', {
  initial: () => ({ queue: {}, soap: {}, vitals: {} }),
  eventSchema: poliEventSchema,
  screens: ['poli', 'order'],
  validate: (s, ev) => poliConflict(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const conflict = poliConflict(s, d);
    if (conflict) throw new Error(conflict);
    switch (d.type) {
      case 'antrean.dipanggil': {
        const queue = { ...s.queue };
        for (const id of d.paused) queue[id] = { status: 'dijeda', wait: `dijeda ${d.at}` };
        queue[d.patientId] = { status: 'diperiksa', wait: `mulai ${d.at}` };
        return { ...s, queue };
      }
      case 'vital.dicatat':
        return {
          ...s,
          vitals: {
            ...s.vitals,
            [d.encounterId]: {
              td: d.td,
              nadi: d.nadi,
              suhu: d.suhu,
              spo2: d.spo2,
              at: d.at,
              by: ev.actor.name,
            },
          },
        };
      case 'cppt.draf':
        return {
          ...s,
          soap: {
            ...s.soap,
            [d.encounterId]: {
              subjective: d.subjective,
              objective: d.objective,
              diagnosisCodes: d.diagnosisCodes,
              savedAt: d.at,
              signedAt: null,
              cosignAt: null,
              authorId: ev.actor.userId,
              author: ev.actor.name,
              cosignedBy: null,
            },
          },
        };
      case 'cppt.ditandatangani':
        return {
          ...s,
          soap: {
            ...s.soap,
            [d.encounterId]: {
              subjective: d.subjective,
              objective: d.objective,
              diagnosisCodes: d.diagnosisCodes,
              savedAt: d.at,
              signedAt: d.final ? d.at : null,
              cosignAt: d.final ? null : d.at,
              authorId: ev.actor.userId,
              author: ev.actor.name,
              cosignedBy: null,
            },
          },
          queue: d.final
            ? { ...s.queue, [d.patientId]: { status: 'selesai', wait: `selesai ${d.at}` } }
            : s.queue,
        };
      case 'cppt.cosign': {
        const cur = s.soap[d.encounterId];
        if (!cur) throw new Error('Tidak ada CPPT residen yang menunggu co-sign.');
        return {
          ...s,
          soap: { ...s.soap, [d.encounterId]: { ...cur, signedAt: d.at, cosignedBy: ev.actor.name } },
          queue: { ...s.queue, [d.patientId]: { status: 'selesai', wait: `selesai ${d.at}` } },
        };
      }
    }
  },
});

/** Antrean poli + status tersimpan (pasien skenario mengikuti Simulasi). */
export function applyPoliQueue(w: PoliWorklist, s: PoliState): PoliWorklist {
  return {
    ...w,
    items: w.items.map((i) => {
      const q = i.scenario ? undefined : s.queue[i.patientId];
      return q ? { ...i, status: q.status, waitNote: q.wait } : i;
    }),
  };
}

/** Tanda vital baru dari isian (flag ditentukan aturan yang sama dengan tampilan). */
export function updatedVitals(
  vitals: readonly PoliVital[],
  f: { td: string; nadi: string; suhu: string; spo2: string },
  at: string,
): PoliVital[] {
  const bp = parseBloodPressure(f.td);
  const nadi = Number(f.nadi);
  const suhu = Number(f.suhu.replace(',', '.'));
  const spo2 = Number(f.spo2);
  const flag: Record<'td' | 'nadi' | 'suhu' | 'spo2', PoliVital['flag']> = {
    td: bp ? bloodPressureFlag(bp.sys, bp.dia) : 'normal',
    nadi: nadi > 100 ? 'tinggi' : nadi < 60 ? 'rendah' : 'normal',
    suhu: suhu >= 37.5 ? 'tinggi' : suhu < 35.5 ? 'rendah' : 'normal',
    spo2: spo2 < 95 ? 'rendah' : 'normal',
  };
  return vitals.map((v) =>
    v.id in flag
      ? {
          ...v,
          value: f[v.id as keyof typeof flag],
          flag: flag[v.id as keyof typeof flag],
          note: `diukur ulang ${at}`,
        }
      : v,
  );
}

/** Kunjungan poli + CPPT, diagnosis, tanda vital, dan tahapan tersimpan. */
export function applyPoliEncounter(e: PoliEncounter, s: PoliState): PoliEncounter {
  const soap = s.soap[e.encounterId];
  const v = s.vitals[e.encounterId];
  let out = e;
  if (v) {
    out = {
      ...out,
      vitalsAt: v.at,
      vitals: updatedVitals(
        out.vitals,
        { td: v.td, nadi: String(v.nadi), suhu: v.suhu, spo2: String(v.spo2) },
        v.at,
      ),
    };
  }
  if (soap) {
    out = {
      ...out,
      soap: {
        ...out.soap,
        subjective: soap.subjective,
        objective: soap.objective,
        savedAt: soap.savedAt,
        signedAt: soap.signedAt,
        createdAt: out.soap.createdAt ?? soap.savedAt,
        version: soap.signedAt ? 2 : 1,
      },
      diagnoses: soap.diagnosisCodes.map((code, i) => ({
        system: 'ICD-10' as const,
        code,
        display: icd10Display(code) ?? code,
        primary: i === 0,
      })),
      stage: soap.signedAt ? POLI_VISIT_STAGES.length - 1 : out.stage,
      documents: soap.signedAt
        ? out.documents.map((doc) => ({ ...doc, done: true, value: doc.done ? doc.value : 'Dibuat' }))
        : out.documents,
    };
  }
  return out;
}

/** CPPT residen menunggu co-sign (jam simpan), untuk tampilan dan gerbang co-sign. */
export function pendingCosign(
  s: PoliState,
  enc: string,
): { at: string; author: string; authorId: string } | null {
  const soap = s.soap[enc];
  return soap?.cosignAt && !soap.signedAt
    ? { at: soap.cosignAt, author: soap.author, authorId: soap.authorId }
    : null;
}
