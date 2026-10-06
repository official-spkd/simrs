import { SEED_REF_SAMPLES } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { DEPO_MASTER, DEPO_REQUESTS, demoDepoState } from './demo/fixtures/penunjang-depo';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  applyDepo,
  type DepoCtx,
  type DepoResult,
  type DepoState,
  depotAlerts,
  dispenseGate,
  expiryStatus,
  fefoPlan,
  ledgerBalance,
  qtyOf,
  stockValue,
} from './penunjang-depo';

let n = 0;
const ctx = (by = 'apt. Dewi Anggraini, S.Farm.'): DepoCtx => ({
  at: '2026-10-05T10:50:00+07:00',
  by,
  today: DEMO_TODAY,
  nextId: (p) => `${p}-${++n}`,
});
const okState = (r: DepoResult): DepoState => {
  if (!r.ok) throw new Error(r.message);
  return r.state;
};
const M = DEPO_MASTER;

describe('data dummy depo', () => {
  it('KFA hanya dari contoh seed; saldo = Σ kartu stok untuk setiap depo × batch', () => {
    const kfa = new Set(SEED_REF_SAMPLES.kfa.map((c) => c.code));
    for (const i of M.items) if (i.kfa) expect(kfa.has(i.kfa), i.name).toBe(true);
    const s = demoDepoState();
    for (const b of s.balances) expect(ledgerBalance(s, b.depotId, b.batchId), b.batchId).toBe(b.qty);
    for (const r of DEPO_REQUESTS) expect(M.items.map((i) => i.id)).toContain(r.itemId);
  });

  it('satu batch kedaluwarsa di depo rawat inap, beberapa segera ED', () => {
    const a = depotAlerts(demoDepoState(), M, 'dp-ri', DEMO_TODAY);
    expect(a.expired.map((r) => r.batch.batchNo)).toEqual(['OMZ2509']);
    expect(a.near.map((r) => r.batch.batchNo).sort()).toEqual(['CFX2510', 'ENX2512']);
    expect(expiryStatus('2026-10-02', DEMO_TODAY)).toEqual({ status: 'kedaluwarsa', days: -3 });
  });
});

describe('FEFO', () => {
  it('batch ED terdekat keluar dulu, lintas batch bila kurang', () => {
    const s = demoDepoState();
    expect(fefoPlan(s, M, 'dp-ri', 'it-cfx', 10, DEMO_TODAY).allocations).toEqual([
      { batchId: 'bt-cfx2510', qty: 10 },
    ]);
    expect(fefoPlan(s, M, 'dp-ri', 'it-cfx', 20, DEMO_TODAY).allocations).toEqual([
      { batchId: 'bt-cfx2510', qty: 14 },
      { batchId: 'bt-cfx2511', qty: 6 },
    ]);
  });

  it('batch kedaluwarsa tidak pernah ditawarkan dan ditolak bila dipilih manual', () => {
    const s = demoDepoState();
    expect(fefoPlan(s, M, 'dp-ri', 'it-omz', 4, DEMO_TODAY).allocations).toEqual([
      { batchId: 'bt-omz2602', qty: 4 },
    ]);
    const g = dispenseGate(
      s,
      M,
      {
        type: 'keluar',
        depotId: 'dp-ri',
        itemId: 'it-omz',
        qty: 2,
        ref: 'x',
        batchId: 'bt-omz2509',
        reason: 'stok lain habis di ruangan',
      },
      DEMO_TODAY,
    );
    expect(g).toEqual({ code: 'BATCH_EXPIRED' });
  });

  it('memilih batch selain FEFO wajib alasan ≥ 10 karakter; dengan alasan tercatat di kartu stok', () => {
    const s = demoDepoState();
    const base = {
      type: 'keluar',
      depotId: 'dp-ri',
      itemId: 'it-cfx',
      qty: 5,
      ref: 'UDD',
      batchId: 'bt-cfx2511',
    } as const;
    expect(applyDepo(s, M, { ...base, reason: 'pendek' }, ctx())).toMatchObject({
      ok: false,
      code: 'FEFO_OVERRIDE_REASON',
    });
    const next = okState(
      applyDepo(s, M, { ...base, reason: 'Batch CFX2510 sudah dibagi ke troli UDD' }, ctx()),
    );
    expect(qtyOf(next, 'dp-ri', 'bt-cfx2511')).toBe(35);
    expect(next.movements[0]?.reason).toMatch(/^Override FEFO/);
  });

  it('stok tidak cukup → ditolak, saldo tidak pernah negatif', () => {
    const r = applyDepo(
      demoDepoState(),
      M,
      { type: 'keluar', depotId: 'dp-igd', itemId: 'it-enox', qty: 5, ref: 'x' },
      ctx(),
    );
    expect(r).toMatchObject({ ok: false, code: 'STOCK_INSUFFICIENT' });
    expect(
      applyDepo(
        demoDepoState(),
        M,
        { type: 'keluar', depotId: 'dp-igd', itemId: 'it-enox', qty: 0, ref: 'x' },
        ctx(),
      ),
    ).toMatchObject({ code: 'QTY_INVALID' });
  });
});

describe('obat high alert (cek ganda)', () => {
  const out = (secondChecker?: string) =>
    applyDepo(
      demoDepoState(),
      M,
      { type: 'keluar', depotId: 'dp-ri', itemId: 'it-enox', qty: 1, ref: 'UDD A-12', secondChecker },
      ctx(),
    );

  it('enoksaparin keluar hanya dengan petugas pemeriksa kedua yang berbeda', () => {
    expect(out()).toMatchObject({ ok: false, code: 'HIGH_ALERT_CHECK' });
    expect(out(' APT. DEWI ANGGRAINI, S.FARM. ')).toMatchObject({ ok: false, code: 'HIGH_ALERT_SAME' });
    const r = out('Ns. Rina Kartika');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.movements[0]?.by).toBe('apt. Dewi Anggraini, S.Farm. + Ns. Rina Kartika');
  });

  it('obat biasa tidak butuh cek ganda', () => {
    const r = applyDepo(
      demoDepoState(),
      M,
      { type: 'keluar', depotId: 'dp-ri', itemId: 'it-omz', qty: 1, ref: 'x' },
      ctx(),
    );
    expect(r.ok).toBe(true);
  });
});

describe('mutasi dua langkah, opname, karantina', () => {
  it('kirim mengurangi asal; stok tujuan baru bertambah setelah diterima petugas lain', () => {
    const s0 = demoDepoState();
    const s1 = okState(
      applyDepo(s0, M, { type: 'kirim', from: 'dp-gudang', to: 'dp-ok', itemId: 'it-pct', qty: 25 }, ctx()),
    );
    expect(qtyOf(s1, 'dp-gudang', 'bt-pct2512')).toBe(0);
    expect(qtyOf(s1, 'dp-gudang', 'bt-pct2605')).toBe(115);
    expect(qtyOf(s1, 'dp-ok', 'bt-pct2512')).toBe(18);
    const t = s1.transfers[0];
    if (!t) throw new Error('mutasi');
    expect(
      applyDepo(s1, M, { type: 'terima', transferId: t.id, receiver: 'apt. Dewi Anggraini, S.Farm.' }, ctx()),
    ).toMatchObject({ code: 'RECEIVER_SAME_AS_SENDER' });
    expect(applyDepo(s1, M, { type: 'terima', transferId: t.id, receiver: 'Ns' }, ctx())).toMatchObject({
      code: 'RECEIVER_REQUIRED',
    });
    const s2 = okState(
      applyDepo(s1, M, { type: 'terima', transferId: t.id, receiver: 'Ns. Rosa Elvira, S.Kep' }, ctx()),
    );
    expect(qtyOf(s2, 'dp-ok', 'bt-pct2512')).toBe(38);
    expect(qtyOf(s2, 'dp-ok', 'bt-pct2605')).toBe(5);
    expect(
      applyDepo(s2, M, { type: 'terima', transferId: t.id, receiver: 'Ns. Rosa Elvira, S.Kep' }, ctx()),
    ).toMatchObject({ code: 'TRANSFER_UNKNOWN' });
    expect(
      applyDepo(s0, M, { type: 'kirim', from: 'dp-ri', to: 'dp-ri', itemId: 'it-pct', qty: 1 }, ctx()),
    ).toMatchObject({ code: 'SAME_DEPOT' });
  });

  it('opname: selisih wajib alasan; saldo mengikuti hitung fisik dan tetap = Σ ledger', () => {
    const s = demoDepoState();
    expect(
      applyDepo(s, M, { type: 'opname', depotId: 'dp-igd', counts: { 'bt-omz2602': 9 }, reason: '' }, ctx()),
    ).toMatchObject({ code: 'OPNAME_REASON' });
    expect(
      applyDepo(s, M, { type: 'opname', depotId: 'dp-igd', counts: {}, reason: '' }, ctx()),
    ).toMatchObject({ ok: true });
    const next = okState(
      applyDepo(
        s,
        M,
        {
          type: 'opname',
          depotId: 'dp-igd',
          counts: { 'bt-omz2602': 9 },
          reason: 'Satu vial pecah saat resusitasi B2',
        },
        ctx(),
      ),
    );
    expect(qtyOf(next, 'dp-igd', 'bt-omz2602')).toBe(9);
    for (const b of next.balances) expect(ledgerBalance(next, b.depotId, b.batchId)).toBe(b.qty);
  });

  it('karantina hanya untuk batch kedaluwarsa', () => {
    const s = demoDepoState();
    expect(
      applyDepo(s, M, { type: 'karantina', depotId: 'dp-ri', batchId: 'bt-omz2602' }, ctx()),
    ).toMatchObject({ code: 'NOT_EXPIRED' });
    const next = okState(
      applyDepo(s, M, { type: 'karantina', depotId: 'dp-ri', batchId: 'bt-omz2509' }, ctx()),
    );
    expect(qtyOf(next, 'dp-ri', 'bt-omz2509')).toBe(0);
    expect(depotAlerts(next, M, 'dp-ri', DEMO_TODAY).expired).toEqual([]);
  });

  it('nilai persediaan dalam rupiah bigint', () => {
    expect(stockValue(demoDepoState(), M, 'dp-ok')).toBe(18n * 21_000n);
  });
});
