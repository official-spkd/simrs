import { SEED_REF_SAMPLES } from '@simrs/db';
import { formatRupiah, type Invoice, kasirBoardSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { monthlyInstalment } from './btn-pembiayaan';
import { demoFinancingOverview } from './btn-skenario';
import { runScenario, taskOptions } from './demo/engine/run';
import { ICD10_NAME, ICD9_NAME, STATIC_CLAIMS, STATIC_INVOICES } from './demo/fixtures/keuangan';
import { SCENARIO_ORDER, SCENARIOS } from './demo/skenario';
import {
  cashChange,
  categorizeCharge,
  digitsToRupiah,
  formatRupiahRingkas,
  groupLines,
  INSTALMENT_MARGIN_PERCENT,
  instalmentOptions,
  invoiceSettlement,
  invoiceTotal,
  localActionProblem,
  manualLineProblems,
  parseQty,
  patientDue,
  recomputeSplit,
  settledCount,
  settledOn,
} from './keuangan';
import { demoKasirBoard, type ScenarioResults } from './keuangan-skenario';

const fresh = (): ScenarioResults =>
  Object.fromEntries(SCENARIO_ORDER.map((id) => [id, runScenario(SCENARIOS[id], [])])) as ScenarioResults;

const sumSplit = (inv: Invoice) =>
  BigInt(inv.split.payerPays) + BigInt(inv.split.patientShare) + BigInt(inv.split.hospitalAbsorbs);

describe('data dummy Kasir', () => {
  it('lolos kontrak ketat; tanpa pasien skenario sebelum ada charge capture', () => {
    const board = kasirBoardSchema.parse(demoKasirBoard(fresh()));
    expect(board.invoices.every((i) => i.scenario === null)).toBe(true);
    expect(board.invoices).toHaveLength(STATIC_INVOICES.length);
  });

  it('total tagihan = jumlah baris (bigint); baris = kuantitas × harga satuan', () => {
    for (const inv of STATIC_INVOICES) {
      expect(BigInt(inv.split.hospitalTotal)).toBe(invoiceTotal(inv.lines));
      for (const l of inv.lines) {
        if (l.unitPrice !== null) expect(BigInt(l.amount)).toBe(BigInt(l.unitPrice) * BigInt(l.qty));
      }
      const grouped = groupLines(inv.lines);
      expect(grouped.reduce((s, g) => s + g.amount, 0n)).toBe(invoiceTotal(inv.lines));
    }
  });

  it('pembagian penjamin: tarif RS = dibayar penjamin + pasien + selisih RS; sisa = tanggungan − bayar', () => {
    for (const inv of STATIC_INVOICES) {
      expect(sumSplit(inv)).toBe(BigInt(inv.split.hospitalTotal));
      const paid = inv.payments.map((p) => BigInt(p.amount));
      expect(BigInt(inv.patientDue)).toBe(patientDue(inv.split, paid));
    }
  });

  it('Ny. Endang (mockup Kasir): INA-CBG kelas 2, selisih naik kelas 1 dibayar pasien, deposit dikurangkan', () => {
    const inv = STATIC_INVOICES.find((i) => i.id === 'inv-endang');
    expect(inv?.split.inacbg).toMatchObject({ code: 'J-4-15-II', tariff: '6612800' });
    expect(inv?.split.payerPays).toBe('6612800');
    expect(inv?.split.patientShare).toBe('1250400');
    expect(formatRupiah(BigInt(inv?.patientDue ?? '0'))).toBe('Rp 250.400');
    expect(inv?.number).toBe('INV-2610-02217');
  });

  it('umum menanggung semua; asuransi menanggung ekses di atas plafon; BPJS tanpa naik kelas Rp 0', () => {
    const byId = (id: string) => STATIC_INVOICES.find((i) => i.id === id);
    expect(byId('inv-ayu')?.split.patientShare).toBe(byId('inv-ayu')?.split.hospitalTotal);
    expect(byId('inv-fransiska')?.split).toMatchObject({ payerPays: '500000', patientShare: '112000' });
    expect(byId('inv-lukman')?.split.patientShare).toBe('0');
    expect(BigInt(byId('inv-lukman')?.split.hospitalAbsorbs ?? '0')).toBeLessThan(0n);
  });

  it('item manual menambah total; BPJS: tanggungan pasien tetap, umum: ikut naik', () => {
    const endang = STATIC_INVOICES.find((i) => i.id === 'inv-endang');
    const ayu = STATIC_INVOICES.find((i) => i.id === 'inv-ayu');
    if (!endang || !ayu) throw new Error('fixture');
    const e2 = recomputeSplit(endang.split, BigInt(endang.split.hospitalTotal) + 100_000n);
    expect(e2.patientShare).toBe(endang.split.patientShare);
    expect(BigInt(e2.hospitalAbsorbs)).toBe(BigInt(endang.split.hospitalAbsorbs) + 100_000n);
    const a2 = recomputeSplit(ayu.split, BigInt(ayu.split.hospitalTotal) + 50_000n);
    expect(BigInt(a2.patientShare)).toBe(BigInt(ayu.split.hospitalTotal) + 50_000n);
  });
});

describe('fungsi tampilan Kasir', () => {
  it('kategori baris dari nama charge skenario', () => {
    expect(categorizeCharge('HbA1c')).toBe('laboratorium');
    expect(categorizeCharge('Obat 30 hari (PRB) · 3 item')).toBe('obat');
    expect(categorizeCharge('Administrasi IGD')).toBe('administrasi');
    expect(categorizeCharge('Pelayanan IGD (dokter, perawat, tindakan)')).toBe('igd');
    expect(categorizeCharge('Akomodasi ICU · 2 hari')).toBe('akomodasi');
    expect(categorizeCharge('Sewa kamar operasi')).toBe('operasi');
    expect(categorizeCharge('BHP dan alat laparoskopi')).toBe('operasi');
    expect(categorizeCharge('Ekokardiografi')).toBe('radiologi');
    expect(categorizeCharge('Asesmen keperawatan')).toBe('tindakan');
  });

  it('gerbang item manual: alasan tertulis wajib', () => {
    const ok = {
      name: 'Kateter urin tambahan',
      qty: 1,
      unitPrice: 72_500n,
      reason: 'Pemasangan ulang malam hari belum tercatat di eMAR',
    };
    expect(manualLineProblems(ok)).toEqual([]);
    expect(manualLineProblems({ ...ok, reason: 'koreksi' }).join()).toMatch(/alasan/);
    expect(manualLineProblems({ ...ok, unitPrice: 0n }).join()).toMatch(/harga/);
  });

  it('uang tunai, angsuran, nominal ringkas', () => {
    expect(cashChange(250_400n, 300_000n)).toEqual({ enough: true, change: 49_600n, short: 0n });
    expect(cashChange(250_400n, 200_000n)).toMatchObject({ enough: false, short: 50_400n });
    expect(digitsToRupiah('Rp 1.250.400')).toBe(1_250_400n);
    expect(formatRupiahRingkas(7_820_000_000n)).toBe('Rp 7,82 M');
    expect(formatRupiahRingkas(21_412_000_000n)).toBe('Rp 21,4 M');
    expect(formatRupiahRingkas(184_000_000n)).toBe('Rp 184 jt');
    expect(formatRupiahRingkas(6_900_000_000n)).toBe('Rp 6,9 M');
  });
});

describe('cicilan BTN di Kasir = rumus layar Pembiayaan', () => {
  it('estimasi angsuran 3, 6, 12 bulan untuk sisa Rp 6.400.000 (margin flat 11% p.a.)', () => {
    expect(instalmentOptions(6_400_000n)).toEqual([
      { id: '3', label: '3 bulan', sub: '±Rp 2.192.000/bln' },
      { id: '6', label: '6 bulan', sub: '±Rp 1.125.000/bln' },
      { id: '12', label: '12 bulan', sub: '±Rp 592.000/bln' },
    ]);
    expect(instalmentOptions(250_400n).map((o) => o.sub)).toEqual([
      '±Rp 86.000/bln',
      '±Rp 44.000/bln',
      '±Rp 23.000/bln',
    ]);
  });

  it('margin dan angka sama dengan layar Pembiayaan dan pilihan tenor skenario elektif', () => {
    const R = runScenario(SCENARIOS['elektif-btn'], []);
    expect(demoFinancingOverview(R).instalmentMarginPercent).toBe(INSTALMENT_MARGIN_PERCENT);
    const tenor = R.def.steps.find((s) => s.id === 'kasir')?.tasks.find((t) => t.id === 'tenor');
    if (tenor?.kind !== 'choice') throw new Error('tugas tenor');
    const opts = taskOptions(tenor, R.rec);
    expect(opts.map((o) => o.id)).toEqual(['3', '6', '12']);
    for (const o of opts) {
      const monthly = monthlyInstalment(6_400_000n, Number(o.id), INSTALMENT_MARGIN_PERCENT);
      expect(o.sub).toContain(formatRupiah(monthly));
    }
  });
});

describe('gerbang Server Action kasir (tagihan versi server)', () => {
  const byId = (id: string) => STATIC_INVOICES.find((i) => i.id === id);

  it('menolak tagihan tak dikenal, pasien skenario, dan yang sudah lunas', () => {
    expect(localActionProblem(undefined, 'bayar')).toMatch(/tidak ditemukan/);
    expect(localActionProblem(byId('inv-wahyuni'), 'tutup')).toMatch(/sudah lunas/);
    const endang = byId('inv-endang');
    if (!endang) throw new Error('fixture');
    expect(localActionProblem({ ...endang, scenario: 'rawat-jalan' }, 'bayar')).toMatch(/skenario/);
  });

  it('final dan item manual hanya untuk tagihan berjalan; final/bayar menunggu pasien pulang', () => {
    expect(localActionProblem(byId('inv-endang'), 'final')).toMatch(/sudah final/);
    expect(localActionProblem(byId('inv-endang'), 'manual')).toMatch(/sudah final/);
    expect(localActionProblem(byId('inv-endang'), 'bayar')).toBeNull();
    expect(localActionProblem(byId('inv-ayu'), 'final')).toBeNull();
    expect(localActionProblem(byId('inv-raka'), 'manual')).toBeNull();
    expect(localActionProblem(byId('inv-raka'), 'final')).toMatch(/masih dirawat/);
    expect(localActionProblem(byId('inv-raka'), 'tutup')).toMatch(/masih dirawat/);
  });

  it('sisa tagihan dihitung ulang dari baris + item manual (umum naik, BPJS tetap)', () => {
    const ayu = byId('inv-ayu');
    const endang = byId('inv-endang');
    if (!ayu || !endang) throw new Error('fixture');
    expect(invoiceSettlement(ayu).due).toBe(BigInt(ayu.patientDue));
    expect(invoiceSettlement(ayu, [{ amount: '35000' }])).toMatchObject({ total: 498_500n, due: 498_500n });
    expect(invoiceSettlement(endang, [{ amount: '100000' }]).due).toBe(250_400n);
  });
});

const PAY = {
  id: 'pay-x',
  kind: 'pelunasan' as const,
  method: 'qris' as const,
  amount: '1000',
  at: '2026-10-05T08:00:00+07:00',
  reference: 'QR-X',
};

describe('hari shift dan isian kuantitas', () => {
  it('tagihan lunas dihitung per hari pelunasan (lini masa skenario lain tidak masuk shift hari ini)', () => {
    expect(settledCount(STATIC_INVOICES, '2026-10-05')).toBe(3);
    const wahyuni = STATIC_INVOICES.find((i) => i.id === 'inv-wahyuni');
    if (!wahyuni) throw new Error('fixture');
    const later = {
      ...wahyuni,
      payments: [{ ...PAY, at: '2026-10-13T08:00:00+07:00' }],
    };
    expect(settledOn(later)).toBe('2026-10-13');
    expect(settledCount([...STATIC_INVOICES, later], '2026-10-05')).toBe(3);
  });

  it('kuantitas hanya bilangan bulat 1–99: "2.5" ditolak, bukan dipotong', () => {
    expect(parseQty('2')).toBe(2);
    expect(parseQty(' 12 ')).toBe(12);
    expect(parseQty('2.5')).toBeNull();
    expect(parseQty('2,5')).toBeNull();
    expect(parseQty('0')).toBeNull();
    expect(parseQty('100')).toBeNull();
    expect(parseQty('')).toBeNull();
    expect(parseQty('1e1')).toBeNull();
  });
});

describe('kode klaim dummy', () => {
  it('hanya kode contoh seed, dengan nama yang sama', () => {
    const icd10 = new Map(SEED_REF_SAMPLES.icd10.map((c) => [c.code, c.display]));
    const icd9 = new Map(SEED_REF_SAMPLES.icd9cm.map((c) => [c.code, c.display]));
    for (const [code, name] of Object.entries(ICD10_NAME)) expect(icd10.get(code), code).toBe(name);
    for (const [code, name] of Object.entries(ICD9_NAME)) expect(icd9.get(code), code).toBe(name);
    for (const c of STATIC_CLAIMS) {
      for (const d of c.diagnoses) expect(icd10.has(d.code), d.code).toBe(true);
      for (const p of c.procedures) expect(icd9.has(p.code), p.code).toBe(true);
    }
  });
});
