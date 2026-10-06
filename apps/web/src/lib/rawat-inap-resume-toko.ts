import {
  codedDiagnosisSchema,
  type DischargeSummary,
  RESUME_CHECK_IDS,
  type ResumeCheckId,
} from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';

/**
 * Toko demo bersama (ADR-0085) · domain `resume-medis`: butir kelengkapan, konfirmasi rekonsiliasi obat pulang, dan
 * TTE resume medis pulang oleh DPJP. Kejadian `resume.final` adalah **kontrak aliran keluar**: antrean koder/klaim
 * INA-CBG (CX-2) dan kelengkapan rekam medis (layar Kelengkapan, CD-2). Setelah final, resume terkunci (perubahan
 * lewat addendum, CLAUDE.md §4.2).
 */

const encounterId = z.string().min(1).max(60);
const isoInstant = z.iso.datetime({ offset: true });

export const resumeEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('resume.butir'),
    encounterId,
    itemId: z.enum(RESUME_CHECK_IDS),
    done: z.boolean(),
    at: isoInstant,
  }),
  z.strictObject({
    /** Konfirmasi (atau batal konfirmasi) rekonsiliasi obat pulang oleh DPJP. */
    type: z.literal('resume.rekonsiliasi'),
    encounterId,
    confirmed: z.boolean(),
    at: isoInstant,
  }),
  z.strictObject({
    /** Resume final ber-TTE DPJP (12 butir lengkap, diperiksa server). */
    type: z.literal('resume.final'),
    encounterId,
    patientId: z.string().min(1).max(60),
    rm: z.string().min(1).max(20),
    patientName: z.string().min(1).max(80),
    /** Penjamin (BPJS kelas … / Umum / Asuransi) untuk klaim. */
    guarantor: z.string().min(1).max(40),
    admittedAt: isoInstant,
    dischargeAt: isoInstant,
    /** Lama rawat (hari) untuk INA-CBG. */
    los: z.int().min(0).max(365),
    dischargeMethod: z.string().min(1).max(60),
    condition: z.string().min(1).max(40),
    dpjp: z.string().min(1).max(80),
    /** Diagnosis (ICD-10) dan prosedur (ICD-9-CM) berkode dari resume. */
    codes: z.array(codedDiagnosisSchema).min(1).max(20),
    signedAt: isoInstant,
  }),
]);
export type ResumeEvent = z.infer<typeof resumeEventSchema>;

export interface ResumeFinal {
  at: string;
  by: string;
  byId: string;
  codes: DischargeSummary['codes'];
}

export interface ResumeState {
  items: Readonly<Record<string, Readonly<Partial<Record<ResumeCheckId, boolean>>>>>;
  /** Jam konfirmasi rekonsiliasi per kunjungan (null = dibatalkan). */
  recon: Readonly<Record<string, string | null>>;
  final: Readonly<Record<string, ResumeFinal>>;
}

export const RESUME_LOCKED = 'Resume sudah final; perubahan hanya lewat addendum berversi.';

export const resumeDomain = defineDomain<ResumeState, ResumeEvent>('resume-medis', {
  initial: () => ({ items: {}, recon: {}, final: {} }),
  eventSchema: resumeEventSchema,
  screens: ['resume', 'ranap', 'kelengkapan', 'worklist', 'bed'],
  validate: (s, ev) => (s.final[ev.encounterId] ? RESUME_LOCKED : null),
  reduce: (s, ev) => {
    const d = ev.data;
    if (s.final[d.encounterId]) throw new Error(RESUME_LOCKED);
    switch (d.type) {
      case 'resume.butir':
        return {
          ...s,
          items: { ...s.items, [d.encounterId]: { ...s.items[d.encounterId], [d.itemId]: d.done } },
        };
      case 'resume.rekonsiliasi':
        return { ...s, recon: { ...s.recon, [d.encounterId]: d.confirmed ? d.at : null } };
      case 'resume.final':
        return {
          ...s,
          final: {
            ...s.final,
            [d.encounterId]: { at: d.signedAt, by: ev.actor.name, byId: ev.actor.userId, codes: d.codes },
          },
        };
    }
  },
});

/** Resume fixture + toko: butir, rekonsiliasi, dan TTE tersimpan. */
export function applyResume(sum: DischargeSummary, s: ResumeState): DischargeSummary {
  const enc = sum.encounterId;
  const items = s.items[enc] ?? {};
  const recon = Object.hasOwn(s.recon, enc) ? (s.recon[enc] ?? null) : sum.reconciliationConfirmedAt;
  const fin = s.final[enc];
  return {
    ...sum,
    reconciliationConfirmedAt: recon,
    checklist: sum.checklist.map((c) => ({
      ...c,
      done: c.id === 'rekonsiliasi' ? !!recon : (items[c.id] ?? c.done),
    })),
    signedAt: fin?.at ?? sum.signedAt,
    signedBy: fin?.by ?? sum.signedBy,
  };
}

/** Resume final per kunjungan (untuk Worklist, Kelengkapan, papan bed). */
export function resumeFinals(s: ResumeState): Record<string, { by: string; at: string }> {
  return Object.fromEntries(Object.entries(s.final).map(([k, v]) => [k, { by: v.by, at: v.at }]));
}
