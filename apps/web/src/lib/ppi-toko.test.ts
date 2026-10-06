import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { HAI_SUSPECTS, ISOLATION_REQUESTS } from './demo/fixtures/ppi';
import { HAI_CRITERIA, hhCompliance } from './ppi';
import { initialPpi, type PpiEvent, ppiDomain } from './ppi-toko';

const ipcn = actor('u-ipcn', 'perawat', 'IPCN Uji');
const when = '2026-10-05T03:50:00.000Z';

describe('B07 · domain toko PPI', () => {
  it('konfirmasi suspek menambah pembilang; sekali per kasus; kriteria wajib', () => {
    const x = HAI_SUSPECTS[0];
    if (!x) throw new Error('fixture');
    const ok: PpiEvent = { type: 'suspek.dikonfirmasi', id: x.id, checks: HAI_CRITERIA[x.type].map(() => true), when };
    const none: PpiEvent = { ...ok, checks: HAI_CRITERIA[x.type].map(() => false) };
    expect(denied(ppiDomain, initialPpi(), none, ipcn)).toBeTruthy();
    const s = applyAll(ppiDomain, [[ok, ipcn]]);
    expect(s.month[x.type].cases).toBe(initialPpi().month[x.type].cases + 1);
    expect(denied(ppiDomain, s, ok, ipcn)).toMatch(/sudah diputus/);
  });

  it('sensus sekali sehari menambah penyebut; observasi tangan mengubah kepatuhan', () => {
    const census: PpiEvent = { type: 'sensus.dicatat', counts: { isk: 4, vap: 4, phlebitis: 4, ido: 4 }, jam: '10.00' };
    const s = applyAll(ppiDomain, [
      [census, ipcn],
      [{ type: 'hh.dicatat', profession: 'Dokter', moment: 0, action: 'tidak', jam: '10.01' }, ipcn],
    ]);
    expect(s.month.isk.denominator).toBe(initialPpi().month.isk.denominator + 4);
    expect(denied(ppiDomain, s, census, ipcn)).toMatch(/sudah tercatat/);
    expect(hhCompliance(s.handHygiene).total).toBe(initialPpi().handHygiene.length + 1);
  });

  it('isolasi airborne wajib tekanan negatif dan ruang kosong', () => {
    const air = ISOLATION_REQUESTS.find((r) => r.precaution === 'airborne');
    if (!air) throw new Error('fixture');
    const plain = initialPpi().rooms.find((r) => !r.negativePressure && !r.occupiedBy);
    const neg = initialPpi().rooms.find((r) => r.negativePressure && !r.occupiedBy);
    if (!plain || !neg) throw new Error('fixture');
    expect(
      denied(ppiDomain, initialPpi(), { type: 'isolasi.ditempatkan', requestId: air.id, roomId: plain.id, jam: '10.00' }, ipcn),
    ).toMatch(/negatif/);
    const s = applyAll(ppiDomain, [[{ type: 'isolasi.ditempatkan', requestId: air.id, roomId: neg.id, jam: '10.00' }, ipcn]]);
    expect(s.rooms.find((r) => r.id === neg.id)?.occupiedBy).toBe(air.rm);
  });
});
