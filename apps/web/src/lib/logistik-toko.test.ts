import { describe, expect, it } from 'vitest';
import { type DemoActor, project, type StoredEvent } from './demo/store/define';
import { INVENTORY } from './demo/fixtures/manajemen';
import {
  buildPoEvent,
  buildReceipt,
  initialLogistics,
  inventoryNow,
  inventoryValue,
  type LogisticsStoreState,
  logisticsDomain,
  openPoItems,
  procurementRows,
} from './logistik-toko';

const apoteker: DemoActor = { userId: 'u-apt', name: 'Apoteker Uji', role: 'apoteker', baseRole: null };
const direktur: DemoActor = { userId: 'u-dir', name: 'Direktur Uji', role: 'manajemen', baseRole: null };

let seq = 0;
const ev = (data: unknown, actor: DemoActor): StoredEvent => ({
  seq: ++seq,
  domain: 'logistik',
  at: '2026-10-05T03:50:00.000Z',
  actor,
  data,
});
const run = (events: StoredEvent[]) => project(logisticsDomain, { seq, resetSeq: 0, events });

function apply(events: Array<[unknown, DemoActor]>) {
  const out: StoredEvent[] = [];
  for (const [data, actor] of events) {
    const state = run(out).state;
    const denied = logisticsDomain.validate?.(state, data as never, actor);
    if (denied) throw new Error(denied);
    out.push(ev(data, actor));
  }
  return run(out);
}

const inputsFor = (s: LogisticsStoreState, po: string) => {
  const r = procurementRows(s).find((x) => x.id === po);
  expect(r?.stage).toBe(4);
  return { received: '', batch: 'B2610X', expiry: '2028-03-31' };
};

describe('B01 · domain toko logistik', () => {
  it('ROP → usulan PO → setujui (pengguna lain) → terbit → dikirim → penerimaan menambah stok', () => {
    const s0 = initialLogistics();
    const low = inventoryNow(s0).find((i) => i.id === 'seftriakson-1g');
    expect(low && low.stock <= low.reorderPoint).toBe(true);
    const po = buildPoEvent(s0, [{ itemId: 'seftriakson-1g', qty: 400 }], '10.50');
    if ('error' in po) throw new Error(po.error);
    expect(po.event.number).toBe('PO-2610-032');
    expect(po.event.total).toBe((BigInt(low?.unitPrice ?? '0') * 400n).toString());

    let p = apply([[po.event, apoteker]]);
    expect(openPoItems(p.state)['seftriakson-1g']).toBe('PO-2610-032');
    // Item terkunci: tidak bisa diusulkan dua kali.
    expect(buildPoEvent(p.state, [{ itemId: 'seftriakson-1g', qty: 1 }], '10.51')).toMatchObject({
      error: expect.stringMatching(/PO-2610-032/),
    });
    // Apoteker tidak bisa menyetujui; direktur bisa.
    const approve = { type: 'po.disetujui', po: 'PO-2610-032', jam: '10.52' };
    expect(logisticsDomain.validate?.(p.state, approve as never, apoteker)).toMatch(/Manajemen/);
    p = apply([
      [po.event, apoteker],
      [approve, direktur],
      [{ type: 'po.diterbitkan', po: 'PO-2610-032', jam: '10.53' }, apoteker],
      [{ type: 'po.dikirim', po: 'PO-2610-032', jam: '10.54' }, apoteker],
    ]);
    const base = inputsFor(p.state, 'PO-2610-032');
    const rec = buildReceipt(p.state, 'PO-2610-032', { 'seftriakson-1g': { ...base, received: '400' } }, false, '11.00');
    if ('error' in rec) throw new Error(rec.error);
    expect(rec.event).toMatchObject({
      grn: 'GRN-2610-0145',
      po: 'PO-2610-032',
      total: po.event.total,
      poTotal: po.event.total,
      jatuhTempo: '2026-11-04',
    });
    const before = inventoryValue(p.state);
    p = apply([
      [po.event, apoteker],
      [approve, direktur],
      [{ type: 'po.diterbitkan', po: 'PO-2610-032', jam: '10.53' }, apoteker],
      [{ type: 'po.dikirim', po: 'PO-2610-032', jam: '10.54' }, apoteker],
      [rec.event, apoteker],
    ]);
    expect(inventoryNow(p.state).find((i) => i.id === 'seftriakson-1g')?.stock).toBe((low?.stock ?? 0) + 400);
    expect(inventoryValue(p.state) - before).toBe(BigInt(po.event.total));
    expect(openPoItems(p.state)['seftriakson-1g']).toBeUndefined();
    expect(procurementRows(p.state).find((x) => x.id === 'PO-2610-032')?.stage).toBe(5);
    expect(p.state.grSeq).toBe(146);
  });

  it('pengusul tidak bisa menyetujui PO-nya sendiri (ID sesi, termasuk ganti posisi)', () => {
    const po = buildPoEvent(initialLogistics(), [{ itemId: 'seftriakson-1g', qty: 10 }], '10.50');
    if ('error' in po) throw new Error(po.error);
    const self: DemoActor = { ...direktur, userId: apoteker.userId };
    const p = apply([[po.event, apoteker]]);
    expect(
      logisticsDomain.validate?.(p.state, { type: 'po.disetujui', po: 'PO-2610-032', jam: '10.51' }, self),
    ).toMatch(/pemisahan tugas/);
  });

  it('penerimaan ditolak bila belum dikirim, melebihi pesanan, atau isi dipalsukan', () => {
    const s0 = initialLogistics();
    expect(buildReceipt(s0, 'PO-2610-031', {}, false, '10.00')).toMatchObject({
      error: expect.stringMatching(/belum dikirim/),
    });
    const lines = { 'kasa-steril': '7000', 'benang-pga': '200', 'sarung-tangan-steril': '1000', 'spuit-3ml': '1000' };
    const inputs = (over: Partial<Record<keyof typeof lines, string>> = {}) =>
      Object.fromEntries(
        Object.entries({ ...lines, ...over }).map(([k, v]) => [
          k,
          { received: v, batch: 'B2610X', expiry: '2028-03-31' },
        ]),
      );
    expect(buildReceipt(s0, 'PO-2610-024', inputs({ 'kasa-steril': '7001' }), false, '10.00')).toMatchObject({
      error: expect.stringMatching(/melebihi/),
    });
    const ok = buildReceipt(s0, 'PO-2610-024', inputs(), false, '10.00');
    if ('error' in ok) throw new Error(ok.error);
    expect(ok.event.total).toBe('22700000');
    const forged = { ...ok.event, total: '1' };
    expect(logisticsDomain.validate?.(s0, forged, apoteker)).toMatch(/tidak sesuai/);
    expect(logisticsDomain.validate?.(s0, ok.event, apoteker)).toBeNull();
  });

  it('tindakan kedaluwarsa sekali per batch', () => {
    const e = { type: 'kedaluwarsa.ditindak', id: 'ed-albumin', action: 'pindah', jam: '10.00' };
    const p = apply([[e, apoteker]]);
    expect(p.state.expiry['ed-albumin']?.by.name).toBe('Apoteker Uji');
    expect(logisticsDomain.validate?.(p.state, e as never, apoteker)).toMatch(/sudah/);
  });

  it('katalog fixture: semua item punya harga rupiah utuh', () => {
    for (const i of INVENTORY) expect(i.unitPrice).toMatch(/^\d+$/);
  });
});
