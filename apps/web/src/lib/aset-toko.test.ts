import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { REPAIR_TICKETS, TECHNICIANS } from './demo/fixtures/aset';
import { type AssetEvent, assetDomain, initialAssets } from './aset-toko';

const when = '2026-10-05T03:50:00.000Z';
const ipsrs = actor('u-ip', 'manajemen', 'IPSRS Uji');
const unit = actor('u-unit', 'perawat', 'Perawat Unit Uji');

describe('B02 · domain toko aset', () => {
  it('kalibrasi tidak laik menarik alat dan membuat tiket bernomor berikutnya', () => {
    const s = applyAll(assetDomain, [
      [
        {
          type: 'kalibrasi.dicatat',
          assetId: 'ast-07',
          result: 'tidak',
          cert: 'KAL-2610-119',
          lab: 'Balai pengamanan fasilitas kesehatan',
          when,
        },
        ipsrs,
      ],
    ]);
    expect(s.tickets[0]?.number).toBe('WO-2610-042');
    expect(s.calibration['ast-07']?.withdrawn).toBe(true);
    expect(s.seq).toBe(43);
  });

  it('tiket berurutan; penutupan oleh pengguna lain dari yang menyelesaikan', () => {
    const t = REPAIR_TICKETS.find((x) => x.stage === 0);
    if (!t) throw new Error('fixture');
    const steps: Array<readonly [AssetEvent, ReturnType<typeof actor>]> = [
      [{ type: 'tiket.diterima', id: t.id, technician: TECHNICIANS[0], when }, ipsrs],
      [{ type: 'tiket.dikerjakan', id: t.id, when }, ipsrs],
      [
        { type: 'tiket.selesai', id: t.id, functionTest: true, electricalSafety: true, note: 'Ganti kabel sensor', when },
        ipsrs,
      ],
    ];
    const s = applyAll(assetDomain, steps);
    const close: AssetEvent = { type: 'tiket.ditutup', id: t.id, when };
    expect(denied(assetDomain, s, close, ipsrs)).toMatch(/pemisahan tugas/);
    expect(denied(assetDomain, s, close, unit)).toBeNull();
    expect(denied(assetDomain, initialAssets(), { type: 'tiket.dikerjakan', id: t.id, when }, ipsrs)).toMatch(/tahap/);
  });
});
