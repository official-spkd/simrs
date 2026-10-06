import type { DemoDocument } from '../../platform-dokumen';
import { PATIENT_ID } from './ids';
import { STAF } from './staf';

/**
 * FE1 · P08 dokumen pasien fiktif (ADR-0023): Ny. Endang (rawat inap Melati, pulang hari ini) dan Tn. Darmawan
 * (Poli PD). Hash adalah nilai contoh deterministik, bukan hash berkas sungguhan. Id dokumen tanpa nama orang.
 */

/** Hex 64 karakter deterministik dari `seed` (contoh tampilan hash). */
export function demoHash(seed: string): string {
  let h = 2166136261;
  let out = '';
  while (out.length < 64) {
    for (const ch of `${seed}${out.length}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

const PETUGAS_RM = 'Dian Lestari, A.Md.RMIK';

export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    id: 'dok-2610-0141',
    patientId: PATIENT_ID.endang,
    kind: 'resume',
    title: 'Resume medis rawat inap · Bangsal Melati',
    mime: 'application/pdf',
    sizeBytes: 182_400,
    sha256: demoHash('dok-2610-0141'),
    uploadedAt: '2026-10-05T10:12:00+07:00',
    uploadedBy: STAF.dpjpPenyakitDalam,
    status: 'pending',
    needsSignature: true,
    signer: STAF.dpjpPenyakitDalam,
    requestedAt: '2026-10-05T10:20:00+07:00',
  },
  {
    id: 'dok-2610-0127',
    patientId: PATIENT_ID.endang,
    kind: 'hasil',
    title: 'Hasil laboratorium · darah lengkap dan kimia klinik',
    mime: 'application/pdf',
    sizeBytes: 96_300,
    sha256: demoHash('dok-2610-0127'),
    uploadedAt: '2026-10-05T06:31:00+07:00',
    uploadedBy: 'Fitri Handayani, A.Md.AK',
    status: 'signed',
    needsSignature: true,
    signer: STAF.dokterPatologiKlinik,
    requestedAt: '2026-10-05T06:32:00+07:00',
    signedAt: '2026-10-05T06:40:00+07:00',
    verifyCode: 'sv1-demo-0127',
  },
  {
    id: 'dok-2610-0098',
    patientId: PATIENT_ID.endang,
    kind: 'consent',
    title: 'Persetujuan pemasangan infus dan pemberian antibiotik',
    mime: 'application/pdf',
    sizeBytes: 64_900,
    sha256: demoHash('dok-2610-0098'),
    uploadedAt: '2026-10-02T14:05:00+07:00',
    uploadedBy: 'Ns. Maya Sari, S.Kep',
    status: 'signed',
    needsSignature: true,
    signer: STAF.dpjpPenyakitDalam,
    requestedAt: '2026-10-02T14:06:00+07:00',
    signedAt: '2026-10-02T14:11:00+07:00',
    verifyCode: 'sv1-demo-0098',
  },
  {
    id: 'dok-2610-0133',
    patientId: PATIENT_ID.endang,
    kind: 'surat',
    title: 'Surat kontrol pasca rawat inap · Poli Penyakit Dalam',
    mime: 'application/pdf',
    sizeBytes: 41_200,
    sha256: demoHash('dok-2610-0133'),
    uploadedAt: '2026-10-05T09:48:00+07:00',
    uploadedBy: PETUGAS_RM,
    status: 'failed',
    needsSignature: true,
    signer: STAF.dpjpPenyakitDalam,
    requestedAt: '2026-10-05T09:50:00+07:00',
    failReason: 'Penyelenggara TTE tidak menjawab dalam 10 detik (3× dicoba ulang otomatis).',
  },
  {
    id: 'dok-2610-0135',
    patientId: PATIENT_ID.endang,
    kind: 'lampiran',
    title: 'Foto kondisi kulit sakrum saat masuk (pengkajian risiko dekubitus)',
    mime: 'image/jpeg',
    sizeBytes: 1_284_000,
    sha256: demoHash('dok-2610-0135'),
    uploadedAt: '2026-10-01T21:15:00+07:00',
    uploadedBy: 'Ns. Maya Sari, S.Kep',
    status: 'draft',
    needsSignature: false,
  },
  {
    id: 'dok-2610-0136',
    patientId: PATIENT_ID.endang,
    kind: 'hasil',
    title: 'Hasil radiologi toraks (salah unggah)',
    mime: 'application/pdf',
    sizeBytes: 210_000,
    sha256: demoHash('dok-2610-0136'),
    uploadedAt: '2026-10-01T22:02:00+07:00',
    uploadedBy: PETUGAS_RM,
    status: 'void',
    needsSignature: true,
    voidReason: 'Berkas milik pasien lain, terunggah ke RM yang salah; diunggah ulang ke RM yang benar.',
  },
  {
    id: 'dok-2610-0150',
    patientId: PATIENT_ID.darmawan,
    kind: 'surat',
    title: 'Surat keterangan sakit 3 hari',
    mime: 'application/pdf',
    sizeBytes: 38_700,
    sha256: demoHash('dok-2610-0150'),
    uploadedAt: '2026-10-05T09:05:00+07:00',
    uploadedBy: STAF.dpjpPenyakitDalam,
    status: 'draft',
    needsSignature: true,
  },
  {
    id: 'dok-2610-0151',
    patientId: PATIENT_ID.darmawan,
    kind: 'lampiran',
    title: 'Scan rujukan FKTP',
    mime: 'image/png',
    sizeBytes: 512_000,
    sha256: demoHash('dok-2610-0151'),
    uploadedAt: '2026-10-05T07:58:00+07:00',
    uploadedBy: 'Bambang Kurniawan',
    status: 'draft',
    needsSignature: false,
  },
];

/** Pasien yang tampil di pemilih layar Dokumen. */
export const DOCUMENT_PATIENT_IDS = [PATIENT_ID.endang, PATIENT_ID.darmawan] as const;
