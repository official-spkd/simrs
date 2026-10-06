import { describe, expect, it } from 'vitest';
import { INVOICE_ID } from './demo/fixtures/ids';
import { STATIC_INVOICES } from './demo/fixtures/keuangan';
import { TARIF_APPROVER, TARIF_ITEMS, TARIF_MAKER, TARIF_PAKET, TARIF_USULAN } from './demo/fixtures/tarif';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  activeVersion,
  applyApproved,
  approvalProblem,
  bigIncreases,
  changeLabel,
  componentSplit,
  KELAS_TARIF,
  KOMPONEN_TARIF,
  packageView,
  parseHarga,
  payerPrice,
  usulanProblems,
} from './keuangan-tarif';

const item = (code: string) => {
  const i = TARIF_ITEMS.find((x) => x.code === code);
  if (!i) throw new Error(code);
  return i;
};

describe('data dummy tarif', () => {
  it('kode unik; komposisi komponen 100%; tepat satu versi berlaku hari ini; versi tidak tumpang tindih', () => {
    expect(new Set(TARIF_ITEMS.map((i) => i.code)).size).toBe(TARIF_ITEMS.length);
    for (const i of TARIF_ITEMS) {
      expect(
        KOMPONEN_TARIF.reduce((s, k) => s + i.composition[k.id], 0),
        i.code,
      ).toBe(10_000);
      expect(
        i.versions.filter((v) => activeVersion({ versions: [v] }, DEMO_TODAY)),
        i.code,
      ).toHaveLength(1);
      const sorted = [...i.versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      for (let n = 1; n < sorted.length; n++) {
        expect(sorted[n - 1]?.validTo, i.code).not.toBeNull();
        expect((sorted[n - 1]?.validTo ?? '') < (sorted[n]?.validFrom ?? ''), i.code).toBe(true);
      }
      const p = activeVersion(i, DEMO_TODAY)?.prices;
      if (p) expect(p.k3 <= p.k2 && p.k2 <= p.k1 && p.k1 <= p.vip, i.code).toBe(true);
    }
  });

  it('tarif Kelas 2 sama dengan baris tagihan Kasir (kamar, nebulisasi, kultur sputum, foto toraks)', () => {
    const endang = STATIC_INVOICES.find((i) => i.id === INVOICE_ID.endang)?.lines ?? [];
    const unit = (name: string) => endang.find((l) => l.name.startsWith(name))?.unitPrice;
    expect(activeVersion(item('AKM-KMR'), DEMO_TODAY)?.prices.k2.toString()).toBe(unit('Kamar kelas 2'));
    expect(activeVersion(item('AKM-KMR'), DEMO_TODAY)?.prices.k1.toString()).toBe(unit('Kamar kelas 1'));
    expect(activeVersion(item('TND-NEB'), DEMO_TODAY)?.prices.k2.toString()).toBe(unit('Nebulisasi'));
    expect(activeVersion(item('LAB-KS'), DEMO_TODAY)?.prices.k2.toString()).toBe(unit('Kultur sputum'));
    expect(activeVersion(item('RAD-TPA'), DEMO_TODAY)?.prices.k2.toString()).toBe(unit('Foto toraks PA'));
  });

  it('setiap paket lebih murah dari jumlah item satuannya di semua kelas', () => {
    for (const pkg of TARIF_PAKET) {
      for (const k of KELAS_TARIF) {
        const v = packageView(pkg, TARIF_ITEMS, k.id, DEMO_TODAY);
        expect(
          v.lines.every((l) => l.unit > 0n),
          `${pkg.code} ${k.id}`,
        ).toBe(true);
        expect(v.saving > 0n, `${pkg.code} ${k.id}`).toBe(true);
        expect(v.itemized).toBe(v.lines.reduce((s, l) => s + l.amount, 0n));
      }
    }
    expect(packageView(TARIF_PAKET[0] ?? never(), TARIF_ITEMS, 'k2', DEMO_TODAY)).toMatchObject({
      itemized: 12_860_000n,
      price: 12_100_000n,
      saving: 760_000n,
    });
  });
});

function never(): never {
  throw new Error('fixture kosong');
}

describe('komponen dan penjamin', () => {
  it('Σ komponen = harga tepat', () => {
    for (const i of TARIF_ITEMS) {
      for (const k of KELAS_TARIF) {
        const price = activeVersion(i, DEMO_TODAY)?.prices[k.id] ?? 0n;
        expect(componentSplit(price, i.composition).reduce((s, c) => s + c.amount, 0n)).toBe(price);
      }
    }
    expect(componentSplit(72_500n, { sarana: 3_500, medis: 1_500, paramedis: 3_500, bhp: 1_500 })).toEqual([
      { id: 'sarana', label: 'Jasa sarana', amount: 25_375n },
      { id: 'medis', label: 'Jasa medis', amount: 10_875n },
      { id: 'paramedis', label: 'Jasa paramedis', amount: 25_375n },
      { id: 'bhp', label: 'BHP', amount: 10_875n },
    ]);
  });

  it('tarif penjamin dibulatkan ke ratusan terdekat', () => {
    expect(payerPrice(450_000n, 1_000)).toBe(495_000n);
    expect(payerPrice(72_500n, -500)).toBe(68_900n);
    expect(payerPrice(35_000n, 0)).toBe(35_000n);
  });

  it('label perubahan', () => {
    expect(changeLabel(350_000n, 375_000n)).toBe('▲ 7,1%');
    expect(changeLabel(50_000n, 45_000n)).toBe('▼ 10,0%');
    expect(changeLabel(1n, 1n)).toBe('tetap');
    expect(parseHarga('Rp 1.250.000')).toBe(1_250_000n);
    expect(parseHarga('')).toBe(0n);
  });
});

describe('usulan perubahan tarif', () => {
  const usg = item('RAD-USG');
  const ok = {
    validFrom: '2026-11-01',
    prices: { k3: 350_000n, k2: 375_000n, k1: 400_000n, vip: 450_000n },
    reason: 'Kontrak servis alat naik sembilan persen',
  };

  it('usulan sah tanpa masalah', () => {
    expect(usulanProblems(usg, ok, DEMO_TODAY)).toEqual([]);
  });

  it('retroaktif, tidak berjenjang, sama, dan tanpa alasan ditolak', () => {
    expect(usulanProblems(usg, { ...ok, validFrom: DEMO_TODAY }, DEMO_TODAY)).toContain(
      'berlaku mulai harus setelah hari ini (tidak retroaktif)',
    );
    expect(usulanProblems(usg, { ...ok, validFrom: '2026-09-01' }, DEMO_TODAY)[0]).toMatch(/retroaktif/);
    expect(usulanProblems(usg, { ...ok, prices: { ...ok.prices, vip: 100n } }, DEMO_TODAY)[0]).toMatch(
      /berjenjang/,
    );
    expect(usulanProblems(usg, { ...ok, prices: { ...ok.prices, k2: 0n } }, DEMO_TODAY)[0]).toBe(
      'isi harga semua kelas',
    );
    const same = activeVersion(usg, DEMO_TODAY)?.prices ?? ok.prices;
    expect(usulanProblems(usg, { ...ok, prices: same }, DEMO_TODAY)).toContain(
      'harga sama dengan versi berlaku',
    );
    expect(usulanProblems(usg, { ...ok, reason: 'naik' }, DEMO_TODAY).at(-1)).toMatch(/11 lagi/);
  });

  it('versi terjadwal menghalangi usulan baru', () => {
    const approved = applyApproved(
      usg,
      TARIF_USULAN[0] ?? never(),
      TARIF_APPROVER,
      '2026-10-05T10:50:00+07:00',
    );
    expect(usulanProblems(approved, { ...ok, validFrom: '2026-12-01' }, DEMO_TODAY)[0]).toMatch(/terjadwal/);
  });

  it('persetujuan: manajemen, pembuat ≠ penyetuju, masih diajukan, tanggal belum lewat', () => {
    const u = TARIF_USULAN[0] ?? never();
    expect(approvalProblem(u, { name: TARIF_APPROVER, role: 'manajemen' }, DEMO_TODAY)).toBeNull();
    expect(approvalProblem(u, { name: TARIF_MAKER, role: 'akuntan' }, DEMO_TODAY)).toMatch(/manajemen/);
    expect(approvalProblem(u, { name: TARIF_MAKER, role: 'manajemen' }, DEMO_TODAY)).toMatch(/sendiri/);
    expect(
      approvalProblem({ ...u, status: 'ditolak' }, { name: TARIF_APPROVER, role: 'manajemen' }, DEMO_TODAY),
    ).toBe('Usulan sudah diputuskan.');
    expect(approvalProblem(u, { name: TARIF_APPROVER, role: 'manajemen' }, '2026-11-01')).toMatch(/lewat/);
  });

  it('disetujui: versi lama ditutup sehari sebelum, versi baru terjadwal', () => {
    const u = TARIF_USULAN[0] ?? never();
    const next = applyApproved(usg, u, TARIF_APPROVER, '2026-10-05T10:50:00+07:00');
    expect(next.versions.map((v) => [v.version, v.validFrom, v.validTo])).toEqual([
      [1, '2025-01-01', '2026-10-31'],
      [2, '2026-11-01', null],
    ]);
    expect(activeVersion(next, DEMO_TODAY)?.version).toBe(1);
    expect(activeVersion(next, '2026-11-01')?.prices.k2).toBe(375_000n);
  });

  it('kenaikan > 20% ditandai perlu analisis biaya', () => {
    const neb = activeVersion(item('TND-NEB'), DEMO_TODAY)?.prices ?? ok.prices;
    expect(bigIncreases(neb, { k3: 30_000n, k2: 40_000n, k1: 50_000n, vip: 65_000n })).toEqual(['k1', 'vip']);
  });
});
