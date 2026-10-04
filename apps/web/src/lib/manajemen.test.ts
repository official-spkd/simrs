import { SEED_REF_SAMPLES } from '@simrs/db';
import {
  integrationOverviewSchema,
  logisticsOverviewSchema,
  purchaseOrderDraftSchema,
  qualityOverviewSchema,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { runScenario } from './demo/engine/run';
import { demoExecutiveDashboard } from './demo/fixtures/dasbor';
import {
  DEAD_LETTERS,
  demoIntegrationOverview,
  GLUCOSE_TARGET,
  demoLogisticsOverview,
  demoQualityOverview,
  INVENTORY,
} from './demo/fixtures/manajemen';
import { PASIEN } from './demo/fixtures/pasien';
import { DOKTER, PERSONA, STAF_LAIN } from './demo/fixtures/staf';
import { SCENARIOS } from './demo/skenario';
import {
  buildPoDraft,
  countInterfaceLogs,
  CRITICAL_COVER_DAYS,
  daysOfCover,
  daysUntil,
  dlqPayloadText,
  formatLatency,
  formatRupiahShort,
  GLUCOSE_BAND_LABEL,
  glucoseBand,
  hourLabel,
  indicatorOnTarget,
  interfaceOfLog,
  needsReorder,
  reorderPoint,
  riskLevel,
  riskMatrix,
  riskScore,
  trendDirection,
} from './manajemen';

const kfa = new Set(SEED_REF_SAMPLES.kfa.map((c) => c.code));
const icd9 = new Set(SEED_REF_SAMPLES.icd9cm.map((c) => c.code));
const loinc = new Set(SEED_REF_SAMPLES.loinc.map((c) => c.code));

describe('fixture manajemen lolos kontrak ketat', () => {
  it('integrasi, logistik, mutu', () => {
    expect(() => integrationOverviewSchema.parse(demoIntegrationOverview([]))).not.toThrow();
    expect(() => logisticsOverviewSchema.parse(demoLogisticsOverview())).not.toThrow();
    expect(() => qualityOverviewSchema.parse(demoQualityOverview())).not.toThrow();
  });

  it('kode KFA, ICD-9-CM, dan LOINC hanya dari daftar seed', () => {
    for (const i of INVENTORY) if (i.kfa) expect(kfa, i.name).toContain(i.kfa);
    expect(INVENTORY.find((i) => i.id === 'enoksaparin-60')?.kfa).toBe('93002210');
    for (const d of DEAD_LETTERS) {
      const code = d.payload.procedureCode?.replace('ICD-9-CM ', '');
      if (code) expect(icd9, d.id).toContain(code);
    }
    const obs = DEAD_LETTERS.find((d) => d.id === 'dlq-0099');
    expect(loinc).toContain(/\((\d+-\d)\)/.exec(obs?.payload.expectedSystem ?? '')?.[1]);
  });
});

describe('integration hub', () => {
  it('payload dead-letter hanya pengenal: tanpa nama pasien/staf atau NIK', () => {
    const names = [
      ...PASIEN.flatMap((p) => p.nama.replace(/^(Tn|Ny|An)\.\s*/, '').split(' ')),
      ...DOKTER.map((d) => d.nama),
      ...Object.values(PERSONA),
      ...Object.values(STAF_LAIN).flat(),
    ].filter((n) => n.length > 3);
    for (const d of DEAD_LETTERS) {
      const text = dlqPayloadText(d);
      for (const n of names) expect(text.toLowerCase(), `${d.id} memuat ${n}`).not.toContain(n.toLowerCase());
      expect(text, d.id).not.toMatch(/\d{16}/);
      expect(text, d.id).not.toMatch(/9999[•\d]/);
    }
  });

  it('jejak skenario dipetakan ke antarmuka dan menambah volume hari ini', () => {
    expect(interfaceOfLog({ sys: 'SATUSEHAT · Encounter', text: '' })).toBe('satusehat');
    expect(interfaceOfLog({ sys: 'BPJS Antrean · task 3', text: '' })).toBe('bpjs-antrean');
    expect(interfaceOfLog({ sys: 'BPJS VClaim · insert SEP', text: '' })).toBe('bpjs-vclaim');
    expect(interfaceOfLog({ sys: 'E-Klaim', text: '' })).toBe('eklaim');
    expect(interfaceOfLog({ sys: 'TPDI · webhook', text: '' })).toBe('tpdi');
    expect(interfaceOfLog({ sys: 'BTN · mutasi H2H', text: '' })).toBe('btn-h2h');
    expect(interfaceOfLog({ sys: 'LIS · HL7 ORU', text: '' })).toBe('lis');
    expect(interfaceOfLog({ sys: '', text: 'Notifikasi terkirim ke aplikasi pasien' })).toBe('notifikasi');
    expect(interfaceOfLog({ sys: 'Keselamatan · CDS', text: '' })).toBeNull();
    expect(interfaceOfLog({ sys: '', text: 'Resep disusun' })).toBeNull();

    const R = runScenario(SCENARIOS['rawat-jalan'], [{ s: 0, t: 'scan', v: true }]);
    const counted = countInterfaceLogs(R.logs);
    expect(counted['bpjs-antrean']).toBeGreaterThan(0);
    const base = demoIntegrationOverview([]);
    const moved = demoIntegrationOverview(R.logs);
    const before = base.interfaces.find((i) => i.id === 'bpjs-antrean');
    const after = moved.interfaces.find((i) => i.id === 'bpjs-antrean');
    expect(after?.volumeToday).toBe((before?.volumeToday ?? 0) + counted['bpjs-antrean']);
    expect(after?.scenarioVolume).toBe(counted['bpjs-antrean']);
  });

  it('format jam, latensi', () => {
    expect(hourLabel(23)).toBe('10.00');
    expect(hourLabel(0)).toBe('11.00');
    expect(hourLabel(12)).toBe('23.00');
    expect(formatLatency(820)).toBe('820 ms');
    expect(formatLatency(1200)).toBe('1,2 dtk');
    expect(formatLatency(null)).toBe('—');
  });
});

describe('logistik', () => {
  it('ROP = pemakaian × lead time + stok pengaman; hari cukup dibulatkan ke bawah', () => {
    expect(reorderPoint({ avgDailyUse: 11.5, leadTimeDays: 7, safetyStock: 40 })).toBe(121);
    expect(reorderPoint({ avgDailyUse: 5.8, leadTimeDays: 10, safetyStock: 12 })).toBe(70);
    expect(daysOfCover(46, 11.5)).toBe(4);
    expect(daysOfCover(310, 52)).toBe(5.9);
    expect(needsReorder({ stock: 2, reorderPoint: 2 })).toBe(true);
    expect(needsReorder({ stock: 3, reorderPoint: 2 })).toBe(false);
  });

  it('semua item di tabel di bawah ROP; enoksaparin < 7 hari paling atas', () => {
    const d = demoLogisticsOverview();
    expect(d.reorder).toHaveLength(12);
    for (const i of d.reorder) expect(needsReorder(i), i.name).toBe(true);
    expect(d.reorder[0]?.id).toBe('enoksaparin-60');
    expect(d.reorder[0]?.daysOfCover).toBeLessThan(CRITICAL_COVER_DAYS);
    const critical = d.reorder.filter((i) => i.daysOfCover < CRITICAL_COVER_DAYS).map((i) => i.id);
    expect(critical).toEqual(['enoksaparin-60', 'seftriakson-1g']);
    const days = d.reorder.map((i) => i.daysOfCover);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('draf PO: total = jumlah baris (bigint), kosong bila tidak ada pilihan', () => {
    const d = demoLogisticsOverview();
    expect(buildPoDraft(d.reorder, new Set(), d.nextPoNumber)).toBeNull();
    const draft = buildPoDraft(d.reorder, new Set(['enoksaparin-60', 'omeprazol-40-inj']), d.nextPoNumber);
    expect(() => purchaseOrderDraftSchema.parse(draft)).not.toThrow();
    expect(draft?.lines.map((l) => l.subtotal)).toEqual(['41400000', '7250000']);
    expect(draft?.total).toBe('48650000');
    expect(draft?.urgent).toBe(true);
    const calm = buildPoDraft(d.reorder, new Set(['spuit-3ml']), d.nextPoNumber);
    expect(calm?.urgent).toBe(false);
  });

  it('kedaluwarsa ≤ 90 hari bernilai Rp 38,2 jt; format ringkas', () => {
    const d = demoLogisticsOverview();
    const total = d.expiring.reduce((a, e) => a + BigInt(e.value), 0n);
    expect(formatRupiahShort(total)).toBe('Rp 38,2 jt');
    for (const e of d.expiring) expect(daysUntil(e.expiry, '2026-10-05')).toBeLessThanOrEqual(90);
    expect(formatRupiahShort(BigInt(d.kpi.inventoryValue))).toBe('Rp 4,82 M');
  });
});

describe('mutu', () => {
  it('enam indikator pertama sama persis dengan indikator mutu di Dasbor direksi', () => {
    const dash = demoExecutiveDashboard('bulan').quality;
    const mutu = demoQualityOverview().indicators;
    for (const q of dash) {
      const m = mutu.find((x) => x.id === q.id);
      expect(m, q.id).toMatchObject({ label: q.label, value: q.value, target: { min: q.target.min } });
      expect(m?.trend.at(-1)).toBe(q.value);
    }
    expect(mutu.length).toBeGreaterThan(dash.length);
    for (const m of mutu) expect(m.trend.at(-1), m.id).toBe(m.value);
  });

  it('sasaran ≥/≤ dan arah tren', () => {
    expect(indicatorOnTarget({ value: 97, target: { min: 100, label: '' } })).toBe(false);
    expect(indicatorOnTarget({ value: 3.8, target: { max: 5, label: '' } })).toBe(true);
    expect(trendDirection([1, 2, 3])).toBe('naik');
    expect(trendDirection([3, 2])).toBe('turun');
    expect(trendDirection([2, 2])).toBe('tetap');
  });

  it('risiko: skor = kemungkinan × dampak, pita tingkat, matriks 25 sel', () => {
    expect(riskScore({ likelihood: 4, impact: 4 })).toBe(16);
    expect([3, 4, 6, 8, 12, 15, 25].map(riskLevel)).toEqual([
      'rendah',
      'sedang',
      'sedang',
      'tinggi',
      'tinggi',
      'ekstrem',
      'ekstrem',
    ]);
    const risks = demoQualityOverview().risks;
    const cells = riskMatrix(risks);
    expect(cells).toHaveLength(25);
    expect(cells.reduce((a, c) => a + c.ids.length, 0)).toBe(risks.length);
  });

  it('laporan IKP hanya memuat nomor RM, tanpa nama pasien', () => {
    const text = JSON.stringify(demoQualityOverview().incidents);
    for (const p of PASIEN) expect(text).not.toContain(p.nama);
  });
});

describe('aplikasi pasien: pita gula darah', () => {
  it('di bawah / dalam / di atas sasaran, batas inklusif', () => {
    const t = { min: 80, max: 130 };
    expect([62, 79, 80, 105, 130, 131, 182].map((v) => glucoseBand(v, t))).toEqual([
      'bawah',
      'bawah',
      'dalam',
      'dalam',
      'dalam',
      'atas',
      'atas',
    ]);
  });

  it('nilai rendah tidak pernah berlabel "di atas sasaran" (riwayat hipoglikemia berat)', () => {
    expect(GLUCOSE_BAND_LABEL[glucoseBand(65, GLUCOSE_TARGET)]).toBe('di bawah sasaran');
    expect(GLUCOSE_BAND_LABEL[glucoseBand(146, GLUCOSE_TARGET)]).toBe('di atas sasaran');
    expect(GLUCOSE_BAND_LABEL[glucoseBand(GLUCOSE_TARGET.min, GLUCOSE_TARGET)]).toBe('dalam sasaran');
  });
});
