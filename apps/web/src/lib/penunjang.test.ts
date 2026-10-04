import { SEED_REF_SAMPLES } from '@simrs/db';
import { type LabSample, labWorklistSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { demoLabSamples, demoLabWorklist } from './demo/fixtures/penunjang';
import {
  applyLabLocal,
  criticalOpen,
  criticalStage,
  criticalTimer,
  deltaCheck,
  flagView,
  formatLabNumber,
  formatRange,
  formatTat,
  labFlag,
  minutesBetween,
  sampleStatusView,
  sortWorklist,
  validationBlock,
} from './penunjang';

const loinc = new Set(SEED_REF_SAMPLES.loinc.map((c) => c.code));
const byId = (id: string): LabSample => {
  const s = demoLabSamples().find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};
const result = (s: LabSample, code: string) => s.results.find((r) => r.loinc === code);

describe('data dummy laboratorium', () => {
  it('lolos kontrak ketat; ≈8 sampel dengan nomor lab unik', () => {
    const w = labWorklistSchema.parse(demoLabWorklist());
    expect(w.samples).toHaveLength(8);
    expect(new Set(w.samples.map((s) => s.labNo)).size).toBe(8);
    expect(new Set(w.samples.map((s) => s.id)).size).toBe(8);
  });

  it('kode LOINC hanya dari contoh seed', () => {
    for (const s of demoLabSamples())
      for (const r of s.results) expect(loinc.has(r.loinc), r.loinc).toBe(true);
  });

  it('flag dan delta dihitung dari rentang rujukan, bukan diketik', () => {
    for (const s of demoLabSamples()) {
      for (const r of s.results) {
        if (r.value === null) continue;
        expect(r.flag, `${s.id} ${r.name}`).toBe(labFlag(r.value, r.ref, r.critical));
        expect(r.delta, `${s.id} ${r.name}`).toBe(deltaCheck(r.value, r.previous, r.deltaLimit));
      }
    }
    expect(result(byId('lab-yusuf'), '2823-3')?.flag).toBe('KRITIS');
    expect(flagView(result(byId('lab-endang'), '2160-0')!)).toMatchObject({ label: 'H Δ', tone: 'warning' });
    expect(flagView(result(byId('lab-raka'), '777-3')!)).toMatchObject({ label: 'L Δ' });
    expect(flagView(result(byId('lab-endang'), '6690-2')!)).toMatchObject({ label: 'N', tone: 'neutral' });
  });

  it('nilai kritis hanya bila ada flag KRITIS; satu nilai kritis terbuka di data hari demo', () => {
    for (const s of demoLabSamples()) {
      expect(s.critical !== null, s.id).toBe(s.results.some((r) => r.flag === 'KRITIS'));
    }
    expect(
      demoLabSamples()
        .filter(criticalOpen)
        .map((s) => s.id),
    ).toEqual(['lab-yusuf']);
  });
});

describe('flag dari rentang rujukan', () => {
  const ref = { low: 3.5, high: 5.1 };
  const crit = { low: 2.5, high: 6 };
  it('KRITIS melewati batas kritis; H/L di luar rujukan; batas masih di dalam', () => {
    expect(labFlag(6.8, ref, crit)).toBe('KRITIS');
    expect(labFlag(2.3, ref, crit)).toBe('KRITIS');
    expect(labFlag(6, ref, crit)).toBe('H');
    expect(labFlag(5.2, ref, crit)).toBe('H');
    expect(labFlag(3.4, ref, crit)).toBe('L');
    expect(labFlag(5.1, ref, crit)).toBe('N');
    expect(labFlag(24, { low: null, high: 5 }, null)).toBe('H');
    expect(labFlag(38, { low: 40, high: null }, null)).toBe('L');
  });

  it('delta check terhadap hasil terakhir', () => {
    expect(deltaCheck(1.3, [0.9, 0.9], 0.3)).toBe(true);
    expect(deltaCheck(1.1, [1, 1], 0.3)).toBe(false);
    expect(deltaCheck(1.3, [], 0.3)).toBe(false);
    expect(deltaCheck(9, [1], null)).toBe(false);
  });

  it('format Indonesia untuk nilai dan rentang', () => {
    expect(formatLabNumber(8900, 0)).toBe('8.900');
    expect(formatLabNumber(11.2, 1)).toBe('11,2');
    expect(formatRange({ low: 12, high: 15.5 }, 1)).toBe('12,0–15,5');
    expect(formatRange({ low: null, high: 5 }, 0)).toBe('< 5');
    expect(formatRange({ low: 40, high: null }, 0)).toBe('> 40');
    expect(formatRange(null, 0)).toBe('—');
  });
});

describe('nilai kritis: timer, read-back, waktu lapor', () => {
  it('timer berjalan menit:detik dan menandai lewat batas 30 menit', () => {
    expect(criticalTimer(372, 30)).toEqual({ text: '06:12', over: false, remainingMinutes: 24 });
    expect(criticalTimer(1799, 30).over).toBe(false);
    expect(criticalTimer(1800, 30)).toMatchObject({ text: '30:00', over: true, remainingMinutes: 0 });
    expect(criticalTimer(1865, 30).text).toBe('31:05');
  });

  it('data hari demo: timer mulai dari selisih hasil keluar dan jam data', () => {
    const c = byId('lab-yusuf').critical;
    expect(c?.elapsedSeconds).toBe(360);
    expect(c && minutesBetween(c.resultAt, '2026-10-05T11:04:00+07:00')).toBe(25);
  });

  it('laporan tanpa read-back belum sah: nilai kritis tetap terbuka dan validasi tetap diblokir', () => {
    const s = byId('lab-yusuf');
    expect(criticalStage(s.critical!)).toBe('terbuka');
    expect(validationBlock(s)).toMatch(/Laporkan nilai kritis/);
    const reported: LabSample = {
      ...s,
      critical: { ...s.critical!, recipient: 'dr. Sinta Maharani', reportedAt: '2026-10-05T10:47:00+07:00' },
    };
    expect(criticalStage(reported.critical!)).toBe('menunggu-read-back');
    expect(criticalOpen(reported)).toBe(true);
    expect(sampleStatusView(reported).label).toBe('Menunggu read-back');
    expect(validationBlock(reported)).toMatch(/read-back/);
  });

  it('laporan lokal dengan read-back menutup nilai kritis dan membuka validasi berurutan', () => {
    const s = byId('lab-yusuf');
    const at = '2026-10-05T10:48:00+07:00';
    const done = applyLabLocal(s, {
      critical: { recipient: 'dr. Sinta Maharani', reportedAt: at, readBackAt: at, tookSeconds: 545 },
    });
    expect(criticalStage(done.critical!)).toBe('selesai');
    expect(done.critical?.minutesToReport).toBe(9);
    expect(sampleStatusView(done).label).toBe('Dilaporkan');
    expect(validationBlock(done)).toBeNull();
    // Validasi klinis tanpa validasi teknis tidak berlaku; berurutan teknis → klinis.
    const klinisDulu = applyLabLocal(s, { clinical: { by: 'dr. Maya', at } });
    expect(klinisDulu.status).toBe('hasil');
    const teknisTanpaLapor = applyLabLocal(s, { technical: { by: 'Fitri', at } });
    expect(teknisTanpaLapor.status).toBe('hasil');
    const rilis = applyLabLocal(byId('lab-endang'), {
      technical: { by: 'Fitri', at },
      clinical: { by: 'dr. Maya', at },
    });
    expect(rilis.status).toBe('selesai');
    expect(sampleStatusView(rilis)).toEqual({ label: 'Selesai', tone: 'success' });
  });

  it('sampel ulang menunda validasi; worklist: kritis terbuka → cito → rutin → selesai', () => {
    expect(validationBlock(byId('lab-endang'), true)).toMatch(/sampel ulang/);
    expect(validationBlock(byId('lab-lestiani'))).toBe('Belum ada hasil untuk divalidasi.');
    const order = sortWorklist(demoLabSamples()).map((s) => s.id);
    expect(order[0]).toBe('lab-yusuf');
    expect(order.slice(-2).sort()).toEqual(['lab-aminah', 'lab-hendro']);
    expect(formatTat(byId('lab-endang'))).toBe('00:52');
    expect(formatTat(byId('lab-aminah'))).toBe('H+1');
  });
});
