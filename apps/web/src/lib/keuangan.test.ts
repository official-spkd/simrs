import { SEED_REF_SAMPLES } from '@simrs/db';
import { formatRupiah, type Invoice, kasirBoardSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { runScenario } from './demo/engine/run';
import { ICD10_NAME, ICD9_NAME, STATIC_CLAIMS, STATIC_INVOICES } from './demo/fixtures/keuangan';
import { SCENARIO_ORDER, SCENARIOS } from './demo/skenario';
import {
  cashChange,
  categorizeCharge,
  digitsToRupiah,
  formatRupiahRingkas,
  groupLines,
  installmentEstimate,
  invoiceTotal,
  manualLineProblems,
  patientDue,
  recomputeSplit,
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
    expect(byId('inv-darmawan')?.split).toMatchObject({ payerPays: '500000', patientShare: '112000' });
    expect(byId('inv-dewi')?.split.patientShare).toBe('0');
    expect(BigInt(byId('inv-dewi')?.split.hospitalAbsorbs ?? '0')).toBeLessThan(0n);
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
    expect(installmentEstimate(6_400_000n, 6)).toBe(1_125_000n);
    expect(digitsToRupiah('Rp 1.250.400')).toBe(1_250_400n);
    expect(formatRupiahRingkas(7_820_000_000n)).toBe('Rp 7,82 M');
    expect(formatRupiahRingkas(21_412_000_000n)).toBe('Rp 21,4 M');
    expect(formatRupiahRingkas(184_000_000n)).toBe('Rp 184 jt');
    expect(formatRupiahRingkas(6_900_000_000n)).toBe('Rp 6,9 M');
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
