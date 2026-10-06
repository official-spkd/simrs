import { type ConsentDocument, SAFETY_REASON_MIN, signatureSchema } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';

/**
 * Toko demo bersama (ADR-0085) · domain `persetujuan`: persetujuan tindakan di tablet (final ber-TTE dokter pelaksana
 * atau ditolak beralasan). Kejadian `consent.final` adalah **kontrak aliran keluar**: kamar operasi/penunjang
 * (checklist sign-in membaca persetujuan final; CX-1) dan kelengkapan rekam medis (CD-2). Dokumen final/ditolak
 * terkunci; tidak ada jalan mengubahnya kembali.
 */

const isoInstant = z.iso.datetime({ offset: true });

export const consentEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('consent.final'),
    consentId: z.string().min(1).max(60),
    encounterId: z.string().min(1).max(60),
    patientId: z.string().min(1).max(60),
    procedure: z.string().min(1).max(80),
    /** Dokter pelaksana pada dokumen (penanda TTE = pengguna sesi berposisi dokter). */
    doctor: z.string().min(1).max(80),
    patient: signatureSchema,
    witness: signatureSchema,
    staffWitness: z.string().min(1).max(80),
    finalAt: isoInstant,
  }),
  z.strictObject({
    type: z.literal('consent.ditolak'),
    consentId: z.string().min(1).max(60),
    encounterId: z.string().min(1).max(60),
    patientId: z.string().min(1).max(60),
    procedure: z.string().min(1).max(80),
    reason: z.string().trim().min(SAFETY_REASON_MIN).max(500),
    at: isoInstant,
  }),
]);
export type ConsentEvent = z.infer<typeof consentEventSchema>;

export interface ConsentRecord {
  status: 'final' | 'ditolak';
  at: string;
  by: string;
  reason: string | null;
}

export interface ConsentState {
  docs: Readonly<Record<string, ConsentRecord>>;
}

export const CONSENT_CLOSED = 'Dokumen persetujuan sudah final atau ditolak; tidak bisa diubah.';

export const consentDomain = defineDomain<ConsentState, ConsentEvent>('persetujuan', {
  initial: () => ({ docs: {} }),
  eventSchema: consentEventSchema,
  screens: ['consent', 'ranap', 'kelengkapan', 'edukasi'],
  validate: (s, ev) => (s.docs[ev.consentId] ? CONSENT_CLOSED : null),
  reduce: (s, ev) => {
    const d = ev.data;
    if (s.docs[d.consentId]) throw new Error(CONSENT_CLOSED);
    const rec: ConsentRecord =
      d.type === 'consent.final'
        ? { status: 'final', at: d.finalAt, by: ev.actor.name, reason: null }
        : { status: 'ditolak', at: d.at, by: ev.actor.name, reason: d.reason };
    return { docs: { ...s.docs, [d.consentId]: rec } };
  },
});

/** Dokumen fixture + keputusan tersimpan. */
export function applyConsent(doc: ConsentDocument, s: ConsentState): ConsentDocument {
  const r = s.docs[doc.id];
  if (!r || doc.status !== 'draf') return doc;
  return { ...doc, status: r.status, finalAt: r.status === 'final' ? r.at : null };
}
