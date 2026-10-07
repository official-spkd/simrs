import type { PatientDocumentView } from '@simrs/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { formatSize, signatureState, signBlocker, uploadProblem, voidBlocker } from './patient-documents';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/server/data/klinis/dokumen-actions', () => ({
  voidDocumentAction: vi.fn(),
  requestSignatureAction: vi.fn(),
}));

const doc = (over: Partial<PatientDocumentView> = {}): PatientDocumentView => ({
  id: '0199a000-0000-7000-8000-0000000000d1',
  patientId: '0199a000-0000-7000-8000-0000000000a1',
  kind: 'hasil',
  title: 'Hasil EKG fiktif',
  fileName: 'ekg.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 182_000,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-07T02:00:00.000Z',
  createdBy: 'Ns. Fiktif',
  voided: null,
  signatures: [],
  ...over,
});
const sig = (status: 'pending' | 'signed' | 'failed') => ({
  id: '0199a000-0000-7000-8000-0000000000e1',
  signer: 'dr. Fiktif',
  status,
  requestedAt: '2026-10-07T02:05:00.000Z',
  signedAt: status === 'signed' ? '2026-10-07T02:06:00.000Z' : null,
  certificate: null,
  verifyUrl: 'http://localhost/verifikasi/x',
});

describe('dokumen pasien klinis (P08)', () => {
  it('status TTE dan alasan tombol nonaktif', () => {
    expect(signatureState(doc())).toBe('belum');
    expect(signatureState(doc({ signatures: [sig('pending')] }))).toBe('menunggu');
    expect(signBlocker(doc(), true)).toBeNull();
    expect(signBlocker(doc(), false)).toMatch(/tidak berizin/);
    expect(signBlocker(doc({ mimeType: 'image/png' }), true)).toMatch(/PDF/);
    expect(signBlocker(doc({ signatures: [sig('signed')] }), true)).toMatch(/sudah ber-TTE/);
    expect(signBlocker(doc({ signatures: [sig('failed')] }), true)).toBeNull();
    expect(voidBlocker(doc(), true)).toBeNull();
    expect(voidBlocker(doc({ signatures: [sig('pending')] }), true)).toMatch(/terkunci/);
    expect(
      voidBlocker(doc({ voided: { at: '2026-10-07T03:00:00.000Z', by: 'x', reason: 'Salah pasien' } }), true),
    ).toMatch(/sudah dibatalkan/);
  });

  it('validasi unggahan dan ukuran ramah baca', () => {
    expect(uploadProblem(null, 'Judul')).toMatch(/Pilih berkas/);
    expect(uploadProblem({ size: 11 * 1048576, type: 'application/pdf' }, 'Judul')).toMatch(/maksimal/);
    expect(uploadProblem({ size: 10, type: 'text/html' }, 'Judul')).toMatch(/Hanya berkas/);
    expect(uploadProblem({ size: 10, type: 'image/png' }, 'ab')).toMatch(/Judul/);
    expect(uploadProblem({ size: 10, type: 'image/png' }, 'Foto luka')).toBeNull();
    expect(formatSize(182_000)).toBe('178 KB');
    expect(formatSize(2_621_440)).toBe('2,5 MB');
  });

  it('komponen: daftar, unduh lewat BFF, alasan tombol tertulis; peran baca saja tanpa formulir unggah', async () => {
    const { PatientDocuments } = await import('@/components/klinis/patient-documents');
    const html = (canWrite: boolean) =>
      renderToStaticMarkup(
        createElement(PatientDocuments, {
          patientId: '0199a000-0000-7000-8000-0000000000a1',
          documents: [
            doc(),
            doc({ id: '0199a000-0000-7000-8000-0000000000d2', signatures: [sig('signed')] }),
          ],
          canWrite,
          path: '/klinis/rawat-inap',
        }),
      );
    const out = html(true);
    expect(out).toContain('Hasil EKG fiktif');
    expect(out).toContain('href="/klinis/dokumen/0199a000-0000-7000-8000-0000000000d1/unduh"');
    expect(out).toContain('Ber-TTE');
    expect(out).toContain('Dokumen sudah ber-TTE.');
    expect(out).toContain('Unggah dokumen');
    const ro = html(false);
    expect(ro).not.toContain('Unggah dokumen');
    expect(ro).toContain('hanya bisa membaca');
  });
});
