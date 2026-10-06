import {
  DOCUMENT_KIND_IDS,
  DOCUMENT_TYPES,
  type DocumentMime,
  MAX_DOCUMENT_BYTES,
  uploadDocumentSchema,
  voidDocumentSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { type DemoActor, defineDomain } from './demo/store/define';
import { DEMO_DOCUMENTS, DOCUMENT_PATIENT_IDS } from './demo/fixtures/dokumen';
import { STAF } from './demo/fixtures/staf';
import { canRequestTte, canVoid, type DemoDocument } from './platform-dokumen';

/**
 * P08 · Domain toko demo `dokumen` (ADR-0085): unggah, minta TTE, tanda tangan, gangguan TTE (presenter), dan batal
 * beralasan di layar Dokumen & TTE. Gerbang memakai pengguna sesi: hanya posisi Dokter (DPJP) yang menandatangani dan
 * TTE tercatat atas nama pengguna itu (bukan nama dari daftar). Aturan murni terhadap keadaan + pelaku → `generic`.
 */

export const DOCUMENT_DOMAIN = 'dokumen';

const docId = z.string().min(1).max(60);
const at = z.iso.datetime({ offset: true });
const jam = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
const MIMES = Object.keys(DOCUMENT_TYPES) as [DocumentMime, ...DocumentMime[]];

export const documentEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('dokumen.diunggah'),
    patientId: z.enum(DOCUMENT_PATIENT_IDS),
    kind: z.enum(DOCUMENT_KIND_IDS),
    title: z.string().max(200),
    mime: z.enum(MIMES),
    sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    at,
    jam,
  }),
  z.strictObject({ type: z.literal('tte.diminta'), id: docId, at, jam }),
  z.strictObject({ type: z.literal('tte.ditandatangani'), id: docId, at, jam }),
  z.strictObject({ type: z.literal('tte.gagal'), id: docId, jam }),
  z.strictObject({ type: z.literal('dokumen.dibatalkan'), id: docId, reason: z.string().max(500), jam }),
]);
export type DocumentEvent = z.infer<typeof documentEventSchema>;

export interface DocumentStoreState {
  docs: readonly DemoDocument[];
  log: ReadonlyArray<{ t: string; text: string }>;
}

/** Penanda tangan bawaan (DPJP pasien dokumen demo). */
export const DOCUMENT_SIGNER = STAF.dpjpPenyakitDalam;
export const SIGNER_ROLE = 'dokter';
export const SIGN_ONLY_DOCTOR =
  'Hanya Dokter (DPJP) yang bisa menandatangani. Ganti posisi ke Dokter (DPJP) untuk menandatangani.';

function gate(s: DocumentStoreState, ev: DocumentEvent, actor: DemoActor): string | null {
  if (ev.type === 'dokumen.diunggah') {
    const meta = uploadDocumentSchema.safeParse({ kind: ev.kind, title: ev.title });
    return meta.success ? null : (meta.error.issues[0]?.message ?? 'Judul tidak valid');
  }
  const d = s.docs.find((x) => x.id === ev.id);
  if (!d) return 'Dokumen tidak ditemukan.';
  switch (ev.type) {
    case 'tte.diminta': {
      if (d.status === 'failed') return null;
      const c = canRequestTte(d);
      return c.ok ? null : c.reason;
    }
    case 'tte.ditandatangani':
      if (d.status !== 'pending') return 'Dokumen tidak sedang menunggu tanda tangan.';
      return actor.role === SIGNER_ROLE ? null : SIGN_ONLY_DOCTOR;
    case 'tte.gagal':
      return d.status === 'pending' ? null : 'Dokumen tidak sedang menunggu tanda tangan.';
    case 'dokumen.dibatalkan': {
      if (!voidDocumentSchema.safeParse({ reason: ev.reason }).success) {
        return 'Alasan pembatalan minimal 10 huruf.';
      }
      const c = canVoid(d);
      return c.ok ? null : c.reason;
    }
  }
}

export const documentDomain = defineDomain<DocumentStoreState, DocumentEvent>(DOCUMENT_DOMAIN, {
  initial: () => ({ docs: [...DEMO_DOCUMENTS], log: [] }),
  eventSchema: documentEventSchema,
  screens: ['dokumen'],
  generic: true,
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    const log = (text: string) => [{ t: d.jam, text: `${text} (${by})` }, ...s.log];
    if (d.type === 'dokumen.diunggah') {
      const doc: DemoDocument = {
        id: `dok-unggah-${s.docs.length + 1}`,
        patientId: d.patientId,
        kind: d.kind,
        title: d.title.trim(),
        mime: d.mime,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        uploadedAt: d.at,
        uploadedBy: by,
        status: 'draft',
        needsSignature: d.kind !== 'lampiran',
      };
      return { docs: [doc, ...s.docs], log: log(`Diunggah: ${doc.title}`) };
    }
    const update = (patch: Partial<DemoDocument>, text: string): DocumentStoreState => ({
      docs: s.docs.map((x) => (x.id === d.id ? { ...x, ...patch } : x)),
      log: log(text),
    });
    const doc = s.docs.find((x) => x.id === d.id);
    switch (d.type) {
      case 'tte.diminta':
        return update(
          {
            status: 'pending',
            signer: doc?.signer ?? DOCUMENT_SIGNER,
            requestedAt: d.at,
            failReason: undefined,
          },
          doc?.status === 'failed'
            ? 'Permintaan TTE dikirim ulang'
            : `Permintaan TTE dikirim ke ${DOCUMENT_SIGNER}`,
        );
      case 'tte.ditandatangani':
        return update(
          { status: 'signed', signer: by, signedAt: d.at, verifyCode: `sv1-demo-${d.id.slice(-4)}` },
          `Ditandatangani ${by}`,
        );
      case 'tte.gagal':
        return update(
          {
            status: 'failed',
            failReason: 'Penyelenggara TTE tidak menjawab dalam 10 detik (3× dicoba ulang otomatis).',
          },
          'TTE gagal: penyelenggara tidak menjawab',
        );
      case 'dokumen.dibatalkan':
        return update({ status: 'void', voidReason: d.reason.trim() }, `Dibatalkan: ${doc?.title ?? d.id}`);
    }
  },
});
