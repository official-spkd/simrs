import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { EMPLOYEES, ROSTER_STAFF } from './demo/fixtures/pegawai';
import { PERSONA } from './demo/fixtures/staf';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { type HrEvent, hrDomain, initialHr, rosterPublishBlock } from './sdm-toko';
import { assign, overHours, restViolations, worstLicense } from './sdm';

const direktur = actor('u-dir', 'manajemen', 'Direktur Uji');
const when = '2026-10-05T03:50:00.000Z';
const maya = EMPLOYEES.find((e) => e.name === PERSONA.perawat)?.id ?? '';

describe('B03 · domain toko SDM', () => {
  it('SIP kedaluwarsa diperbarui; pegawai keluar tidak bisa diproses lagi', () => {
    const expired = EMPLOYEES.find((e) => worstLicense(e.licenses, DEMO_TODAY).status === 'kedaluwarsa');
    if (!expired) throw new Error('fixture');
    const sip: HrEvent = {
      type: 'sip.diperbarui',
      employeeId: expired.id,
      number: '9999/UM/0533',
      until: '2031-10-05',
      jam: '10.00',
    };
    const s = applyAll(hrDomain, [[sip, direktur]]);
    expect(worstLicense(s.employees[expired.id]?.licenses ?? [], DEMO_TODAY).status).not.toBe('kedaluwarsa');
    expect(denied(hrDomain, s, sip, direktur)).toMatch(/masih berlaku/);
    const out = applyAll(hrDomain, [
      [sip, direktur],
      [
        {
          type: 'pegawai.keluar',
          employeeId: expired.id,
          reason: 'Mengundurkan diri per 5 Okt',
          jam: '10.01',
        },
        direktur,
      ],
    ]);
    expect(out.employees[expired.id]?.left?.by).toBe('Direktur Uji');
    expect(
      denied(
        hrDomain,
        out,
        { type: 'pegawai.keluar', employeeId: expired.id, reason: 'Ulang lagi keluar', jam: '10.02' },
        direktur,
      ),
    ).toMatch(/sudah keluar/);
  });

  it('jadwal: jeda malam → siang juga dilanggar; > 40 jam memblokir terbit (bukan hanya warna)', () => {
    const ids = ROSTER_STAFF.map((e) => e.id);
    const base = initialHr().roster;
    // Malam Sen → siang Sel untuk perawat yang sama.
    const night = base[0]?.M[0] ?? '';
    expect(
      restViolations(assign(base, 1, 'S', night), 7).some((v) => v.shift === 'S' && v.staffId === night),
    ).toBe(true);
    // Tambah dinas sampai > 40 jam.
    let r = base;
    for (const d of [0, 1, 2, 3, 4, 5, 6]) r = assign(r, d, 'M', 'peg-0014');
    expect(overHours(r, ids)).toContain('peg-0014');
    expect(rosterPublishBlock({ ...r })).toBeTruthy();
  });

  it('alur layar (E2E): isi kekosongan, perbaiki jeda, terbit; revisi membuka draf', () => {
    const steps: Array<readonly [HrEvent, ReturnType<typeof actor>]> = [
      [{ type: 'dinas.ditambah', day: 2, shift: 'S', staffId: 'peg-0014' }, direktur],
      [{ type: 'dinas.ditambah', day: 5, shift: 'M', staffId: 'peg-0014' }, direktur],
      [{ type: 'dinas.dilepas', day: 4, shift: 'P', staffId: maya }, direktur],
      [{ type: 'dinas.ditambah', day: 4, shift: 'P', staffId: 'peg-0011' }, direktur],
      // Ns. Fikri 41 jam di draf: dilepas dari satu dinas pagi, diganti perawat yang jamnya masih longgar.
      [{ type: 'dinas.dilepas', day: 2, shift: 'P', staffId: 'peg-0010' }, direktur],
      [{ type: 'dinas.ditambah', day: 2, shift: 'P', staffId: 'peg-0008' }, direktur],
    ];
    expect(rosterPublishBlock(applyAll(hrDomain, steps.slice(0, 4)).roster)).toMatch(/melebihi 40 jam/);
    const s = applyAll(hrDomain, steps);
    expect(rosterPublishBlock(s.roster)).toBeNull();
    const pub = applyAll(hrDomain, [...steps, [{ type: 'jadwal.diterbitkan', when }, direktur]]);
    expect(pub.published?.version).toBe(1);
    expect(denied(hrDomain, pub, steps[0]?.[0] as HrEvent, direktur)).toMatch(/revisi/);
    const rev = applyAll(hrDomain, [
      ...steps,
      [{ type: 'jadwal.diterbitkan', when }, direktur],
      [{ type: 'jadwal.direvisi', when }, direktur],
    ]);
    expect(rev).toMatchObject({ published: null, version: 2 });
  });
});
