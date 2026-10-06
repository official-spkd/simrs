import { cancelDocument, type PatientDocument, retryTte } from './rme-kelengkapan';
import type { RmeExtraState } from './rme-toko-bagan';

/**
 * K13 · Dokumen pasien dari toko demo (ADR-0085): dokumen awal + kirim ulang TTE, pembatalan beralasan, pindaian
 * terunggah, surat keterangan kematian (K-1), resume final dari domain `resume-medis`, dan persetujuan tindakan dari
 * domain `persetujuan`. Dokumen tidak pernah dihapus. Logika murni.
 */

export interface DocumentSources {
  /** Resume final (TTE DPJP) kunjungan ini. */
  resumeFinal: { at: string; by: string } | null;
  /** Keputusan persetujuan tindakan kunjungan ini. */
  consents: ReadonlyArray<{
    id: string;
    procedure: string;
    status: 'final' | 'ditolak';
    at: string;
    by: string;
    reason: string | null;
  }>;
}

export function documentsOf(
  base: readonly PatientDocument[],
  s: RmeExtraState,
  enc: string,
  src: DocumentSources,
): PatientDocument[] {
  const changed = base.map((d) => {
    let doc = d;
    if (doc.kind === 'Resume' && src.resumeFinal && doc.status !== 'final-tte') {
      doc = { ...doc, status: 'final-tte', by: src.resumeFinal.by, at: src.resumeFinal.at, note: null };
    }
    for (const c of s.docChanges.filter((x) => x.encounterId === enc && x.docId === d.id)) {
      try {
        doc =
          c.change === 'tte-ulang'
            ? retryTte(doc, c.by, c.at)
            : cancelDocument(doc, c.reason ?? '', c.by, c.at);
      } catch {
        // Perubahan yang tidak berlaku lagi (dokumen sudah final) dilewati.
      }
    }
    return doc;
  });
  const consents: PatientDocument[] = src.consents.map((c) => ({
    id: `${enc}-persetujuan-${c.id}`,
    title: `Persetujuan tindakan · ${c.procedure}`,
    kind: 'Persetujuan',
    status: c.status === 'final' ? 'final-tte' : 'final',
    by: c.by,
    at: c.at,
    note: c.status === 'ditolak' ? `Pasien menolak tindakan: ${c.reason ?? ''}` : null,
  }));
  const death = s.deaths[enc];
  const deathDoc: PatientDocument[] = death
    ? [
        {
          id: `${enc}-skk`,
          title: 'Surat keterangan kematian',
          kind: 'Surat',
          status: 'final-tte',
          by: death.by,
          at: death.at,
          note: `${death.certificateNo} · ${death.causeCode} ${death.causeLabel}`,
        },
      ]
    : [];
  const uploads = s.uploads
    .filter((u) => u.encounterId === enc)
    .map(({ encounterId: _e, ...u }) => {
      let doc: PatientDocument = u;
      for (const c of s.docChanges.filter(
        (x) => x.encounterId === enc && x.docId === u.id && x.change === 'batal',
      )) {
        doc = cancelDocument(doc, c.reason ?? '', c.by, c.at);
      }
      return doc;
    });
  return [...changed, ...consents, ...deathDoc, ...uploads];
}
