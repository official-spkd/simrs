import { describe, expect, it } from 'vitest';
import { ACCREDITATION_CHAPTERS, REG_DOCS } from './demo/fixtures/dokumen';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { addYears, docApproveBlock, nextStatus, pct, publish, reviewStatus } from './dokumen';

describe('B12 · dokumen regulasi', () => {
  it('alur status berurutan sampai terbit', () => {
    expect(nextStatus('draf')).toBe('telaah');
    expect(nextStatus('disetujui')).toBe('terbit');
    expect(nextStatus('terbit')).toBeNull();
    expect(nextStatus('usang')).toBeNull();
  });

  it('terbit: versi baru berlaku 3 tahun, versi lama kode sama menjadi tidak berlaku', () => {
    const next = publish(REG_DOCS, 'doc-kep-014-v3', DEMO_TODAY);
    expect(next.find((d) => d.id === 'doc-kep-014-v3')).toMatchObject({
      status: 'terbit',
      reviewDue: '2029-10-05',
    });
    expect(next.find((d) => d.id === 'doc-kep-014-v2')?.status).toBe('usang');
    expect(next.find((d) => d.id === 'doc-far-022-v4')?.status).toBe('terbit');
    expect(next.filter((d) => d.code === 'SPO-KEP-014' && d.status === 'terbit')).toHaveLength(1);
  });

  it('tinjau ulang: lewat dan segera ditandai; penyetuju ≠ penyusun', () => {
    expect(reviewStatus('2026-09-20', DEMO_TODAY)).toEqual({ status: 'lewat', days: -15 });
    expect(reviewStatus('2026-11-20', DEMO_TODAY)).toEqual({ status: 'segera', days: 46 });
    expect(reviewStatus('2028-01-15', DEMO_TODAY).status).toBe('aman');
    expect(addYears('2026-10-05', 3)).toBe('2029-10-05');
    expect(docApproveBlock('A', 'A')).toMatch(/berbeda/);
    expect(docApproveBlock('A', null)).toMatch(/Pilih/);
    expect(docApproveBlock('A', 'B')).toBeNull();
  });

  it('bab MRMIK memuat 51 elemen; persentase bulat', () => {
    expect(ACCREDITATION_CHAPTERS.find((c) => c.code === 'MRMIK')?.elements).toBe(51);
    expect(pct(44, 51)).toBe(86);
    expect(pct(1, 0)).toBeNull();
  });
});
