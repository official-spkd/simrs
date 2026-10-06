import { describe, expect, it } from 'vitest';
import { demoLabSamples } from './demo/fixtures/penunjang';
import {
  criticalReportSeconds,
  emptyResultText,
  formatMmSs,
  resampleBlock,
  sampleStatusView,
} from './penunjang';

describe('tampilan Lab (mockup)', () => {
  const samples = demoLabSamples();
  const byStatus = (st: string) => {
    const s = samples.find((x) => x.status === st);
    if (!s) throw new Error(`tidak ada sampel ${st}`);
    return s;
  };

  it('waktu lapor nilai kritis dalam mm:ss: detik timer bila ada, selain itu menit data', () => {
    expect(formatMmSs(criticalReportSeconds({ elapsedSeconds: 372, minutesToReport: 6 }))).toBe('06:12');
    expect(formatMmSs(criticalReportSeconds({ elapsedSeconds: 1200, minutesToReport: 5 }))).toBe('05:00');
    expect(formatMmSs(criticalReportSeconds({ elapsedSeconds: 0, minutesToReport: null }))).toBe('00:00');
  });

  it('teks hasil kosong: selesai, inkubasi, dan status saat ini', () => {
    expect(emptyResultText(byStatus('selesai'))).toMatch(/^Hasil sudah divalidasi klinis dan dirilis\./);
    expect(emptyResultText(byStatus('inkubasi'))).toMatch(/^Kultur dalam inkubasi/);
    expect(emptyResultText(byStatus('order'))).toBe(
      'Hasil belum lengkap (status: Sampling). Rincian tampil setelah analyzer mengirim hasil.',
    );
    expect(sampleStatusView(byStatus('order')).label).toBe('Sampling');
  });

  it('minta ulang sampel selalu tampil; nonaktif dengan alasan bila tidak berlaku', () => {
    expect(resampleBlock(byStatus('selesai'), false)).toMatch(/revisi berversi/);
    expect(resampleBlock({ status: 'order', results: [] }, false)).toMatch(/Belum ada hasil/);
    expect(resampleBlock(byStatus('hasil'), true)).toMatch(/simulasi/);
    expect(resampleBlock(byStatus('hasil'), false)).toBeNull();
  });
});
