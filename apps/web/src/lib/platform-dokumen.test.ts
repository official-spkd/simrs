import { describe, expect, it } from 'vitest';
import { DEMO_DOCUMENTS, demoHash } from './demo/fixtures/dokumen';
import { PASIEN } from './demo/fixtures/pasien';
import {
  canRequestTte,
  canVoid,
  formatBytes,
  maskName,
  mimeOf,
  sha256Hex,
  validateUpload,
  verifyDocument,
  voidReasonValid,
} from './platform-dokumen';

const byId = (id: string) => {
  const d = DEMO_DOCUMENTS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};

describe('P08 · fixture dokumen', () => {
  it('id unik tanpa nama orang; pasien ada di fixture; status konsisten dengan TTE', () => {
    expect(new Set(DEMO_DOCUMENTS.map((d) => d.id)).size).toBe(DEMO_DOCUMENTS.length);
    for (const d of DEMO_DOCUMENTS) {
      expect(d.id).toMatch(/^dok-\d{4}-\d{4}$/);
      expect(PASIEN.some((p) => p.id === d.patientId)).toBe(true);
      expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
      if (d.status === 'signed') expect(d.signedAt && d.verifyCode && d.signer).toBeTruthy();
      if (!d.needsSignature) expect(d.status).toBe('draft');
    }
    expect(demoHash('a')).not.toBe(demoHash('b'));
  });
});

describe('P08 · aturan dokumen', () => {
  it('unggah: jenis, judul, tipe dan ukuran berkas mengikuti kontrak bersama', () => {
    const file = { name: 'ekg.pdf', size: 1000, type: 'application/pdf' };
    expect(validateUpload({ kind: '', title: 'Hasil EKG', file })).toMatchObject({
      ok: false,
      field: 'kind',
    });
    expect(validateUpload({ kind: 'hasil', title: 'ab', file })).toMatchObject({ ok: false, field: 'title' });
    expect(validateUpload({ kind: 'hasil', title: 'Hasil EKG', file: null })).toMatchObject({
      field: 'file',
    });
    expect(
      validateUpload({ kind: 'hasil', title: 'Hasil EKG', file: { name: 'a.docx', size: 10, type: '' } }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('Jenis berkas ditolak') });
    expect(
      validateUpload({ kind: 'hasil', title: 'Hasil EKG', file: { ...file, size: 11 * 1024 * 1024 } }),
    ).toMatchObject({ ok: false, message: 'Berkas 11,0 MB; maksimal 10 MB.' });
    expect(validateUpload({ kind: 'hasil', title: 'Hasil EKG', file })).toEqual({
      ok: true,
      mime: 'application/pdf',
    });
    expect(mimeOf('foto.JPEG', '')).toBe('image/jpeg');
    expect(formatBytes(182_400)).toBe('178 KB');
  });

  it('TTE: lampiran tanpa TTE, dokumen bertanda tangan terkunci, batal wajib alasan ≥ 10 huruf', () => {
    expect(canRequestTte(byId('dok-2610-0135')).ok).toBe(false);
    expect(canRequestTte(byId('dok-2610-0150')).ok).toBe(true);
    expect(canRequestTte(byId('dok-2610-0141')).ok).toBe(false);
    expect(canVoid(byId('dok-2610-0127'))).toEqual({
      ok: false,
      reason: 'Dokumen bertanda tangan terkunci; koreksi lewat addendum.',
    });
    expect(canVoid(byId('dok-2610-0133')).ok).toBe(true);
    expect(voidReasonValid('salah')).toBe(false);
    expect(voidReasonValid('Berkas milik pasien lain')).toBe(true);
  });

  it('verifikasi publik: asli, hash berbeda, kode tidak dikenal; nama tersamar', () => {
    const signed = byId('dok-2610-0127');
    expect(verifyDocument(DEMO_DOCUMENTS, 'sv1-demo-0127', signed.sha256).status).toBe('asli');
    expect(verifyDocument(DEMO_DOCUMENTS, 'sv1-demo-0127', demoHash('lain')).status).toBe('tidak-cocok');
    expect(verifyDocument(DEMO_DOCUMENTS, 'tidak-ada', null).status).toBe('tidak-dikenal');
    expect(maskName('Ny. Endang Wijaya')).toBe('Ny. E***** W*****');
  });

  it('SHA-256 Web Crypto', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
