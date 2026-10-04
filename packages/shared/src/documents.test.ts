import { describe, expect, it } from 'vitest';
import { detectDocumentType, parseVerifyCode, sanitizeFileName, VERIFY_CODE_PATTERN } from './documents';
import { newVerifyCode, sha256Hex } from './security/document-crypto';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('dokumen (P08)', () => {
  it('jenis berkas dari isi, bukan nama/Content-Type', () => {
    expect(detectDocumentType(new TextEncoder().encode('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(detectDocumentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(detectDocumentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    // SVG/HTML berkedok .pdf, berkas terpotong, dan berkas kosong ditolak.
    expect(detectDocumentType(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeNull();
    expect(detectDocumentType(new TextEncoder().encode('<html>%PDF-'))).toBeNull();
    expect(detectDocumentType(bytes(0x89, 0x50))).toBeNull();
    expect(detectDocumentType(bytes())).toBeNull();
  });

  it('nama berkas aman untuk tampilan/unduhan; ekstensi mengikuti isi', () => {
    expect(sanitizeFileName('C:\\fakepath\\hasil lab.PDF', 'application/pdf')).toBe('hasil lab.pdf');
    expect(sanitizeFileName('../../etc/passwd', 'image/png')).toBe('passwd.png');
    expect(sanitizeFileName('foto"; filename=x.html\r\n.jpg', 'image/jpeg')).toBe(
      'foto; filename=x.html.jpg',
    );
    expect(sanitizeFileName('skrip.exe', 'application/pdf')).toBe('skrip.pdf');
    expect(sanitizeFileName('', 'image/png')).toBe('dokumen.png');
    expect(sanitizeFileName('a'.repeat(300), 'image/png')).toHaveLength(114);
  });

  it('kode verifikasi: format tetap, tenant terbaca, acak', () => {
    const tenant = '0199a000-0000-7000-8000-000000000001';
    const a = newVerifyCode(tenant);
    expect(a).toMatch(VERIFY_CODE_PATTERN);
    expect(parseVerifyCode(a)).toEqual({ tenantId: tenant });
    expect(newVerifyCode(tenant)).not.toBe(a);
    expect(parseVerifyCode(`${a}x`)).toBeNull();
    expect(parseVerifyCode('sv1.bukan-uuid.xxx')).toBeNull();
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
