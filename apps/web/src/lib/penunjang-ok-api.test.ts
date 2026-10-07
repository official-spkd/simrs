import type { SurgeryCaseView } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  activePhase,
  eventBlock,
  ganttStatus,
  manualRemaining,
  nextEvent,
  statusNote,
  wibInstant,
} from './penunjang-ok-api';

const U = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
type Phase = SurgeryCaseView['checklist'][number];

const phase = (id: Phase['phase'], checked: boolean[], confirmedAt: string | null = null): Phase => ({
  phase: id,
  items: checked.map((c, i) => ({
    code: `${id}-${i}`,
    label: `Butir ${i}`,
    system: i === checked.length - 1,
    checked: c,
    checkedBy: c ? 'Ns. Fiktif' : null,
  })),
  confirmedAt,
  confirmedBy: confirmedAt ? 'Ns. Fiktif' : null,
});

const base = (over: Partial<SurgeryCaseView> = {}): SurgeryCaseView => ({
  id: U(1),
  caseNo: 'OK-2610-0001',
  encounterId: U(2),
  roomId: U(3),
  startsAt: '2026-10-07T02:00:00.000Z',
  endsAt: '2026-10-07T04:00:00.000Z',
  startMin: 540,
  durationMin: 120,
  status: 'terjadwal',
  priority: 'elektif',
  procedureName: 'Kolesistektomi laparoskopik',
  procedureCode: '51.23',
  patient: {
    id: U(4),
    name: 'Ratna Fiktif',
    rm: '00-00-00-01',
    sex: 'female',
    ageYears: 40,
    birthDate: '1986-01-01',
    allergies: [],
    guarantor: null,
  },
  team: [],
  consent: null,
  checklist: [
    phase('sign-in', [false, false, false]),
    phase('time-out', [false, false]),
    phase('sign-out', [false, false]),
  ],
  events: [],
  counts: [],
  unreconciled: [],
  supplies: [],
  report: null,
  cancelReason: null,
  ...over,
});

const T = '2026-10-07T02:10:00.000Z';

describe('penunjang-ok-api', () => {
  it('status Gantt: cito belum mulai ditandai cito; berjalan/selesai apa adanya', () => {
    expect(ganttStatus({ status: 'terjadwal', priority: 'cito' })).toBe('cito');
    expect(ganttStatus({ status: 'persiapan', priority: 'elektif' })).toBe('terjadwal');
    expect(ganttStatus({ status: 'berjalan', priority: 'cito' })).toBe('berjalan');
    expect(ganttStatus({ status: 'selesai', priority: 'elektif' })).toBe('selesai');
  });

  it('fase aktif dan butir manual tersisa (butir sistem tidak dihitung)', () => {
    const c = base();
    expect(activePhase(c)).toBe('sign-in');
    expect(manualRemaining(c, 'sign-in')).toBe(2);
    const done = base({
      checklist: [
        phase('sign-in', [true, true, true], T),
        phase('time-out', [true, false]),
        phase('sign-out', [false, false]),
      ],
    });
    expect(activePhase(done)).toBe('time-out');
    expect(manualRemaining(done, 'time-out')).toBe(0);
    expect(statusNote(done)).toBe('1/3 fase daftar tilik');
  });

  it('insisi terkunci sampai time out dikonfirmasi, dengan jumlah butir tersisa', () => {
    const signedIn = [phase('sign-in', [true, true, true], T), phase('sign-out', [false, false])];
    const c = base({
      status: 'berjalan',
      events: [{ kind: 'induksi', at: T, by: 'Ns. Fiktif', overrideReason: null }],
      checklist: [signedIn[0] as Phase, phase('time-out', [false, false, false]), signedIn[1] as Phase],
    });
    expect(nextEvent(c)).toBe('insisi');
    expect(eventBlock(c)).toBe(
      'Time out belum lengkap (2 butir tersisa). Insisi terkunci sampai time out dikonfirmasi.',
    );
    expect(eventBlock(base())).toBe('Induksi terkunci sampai sign in dikonfirmasi.');
    expect(nextEvent(base({ status: 'batal' }))).toBeNull();
  });

  it('jam WIB → ISO; isian salah → null', () => {
    expect(wibInstant('2026-10-07', '09.00')).toBe('2026-10-07T02:00:00.000Z');
    expect(wibInstant('2026-10-07', '24:00')).toBeNull();
    expect(wibInstant('07-10-2026', '09:00')).toBeNull();
  });
});
