/** F01 · Logika murni layar Jadwal: perbandingan RS vs HFIS dan grid minggu (tanpa DB). Data fiktif. */
import { scheduleCellId, weeklyScheduleSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  buildWeek,
  compareWithHfis,
  type HfisMapping,
  type HfisPull,
  latestPulls,
  type RsSession,
} from '../src/modules/scheduling/scheduling.view';

const P = {
  bagus: '01990000-0000-7000-8000-000000000001',
  melati: '01990000-0000-7000-8000-000000000002',
  tanpaKode: '01990000-0000-7000-8000-000000000003',
};
const JT = '01990000-0000-7000-8000-0000000000a1';
const DATE = '2026-10-07';

const session = (o: Partial<RsSession>): RsSession => ({
  id: '01990000-0000-7000-8000-0000000000f1',
  practitionerId: P.bagus,
  practitionerName: 'dr. Bagus Santoso, Sp.JP',
  serviceId: JT,
  serviceCode: 'JT',
  serviceName: 'Jantung',
  room: 'Ruang 4',
  date: DATE,
  start: '09:00',
  end: '12:00',
  kind: 'praktik',
  substituteId: null,
  substituteName: null,
  note: null,
  quotaJkn: 16,
  quotaNonJkn: 4,
  bookedJkn: 0,
  bookedNonJkn: 0,
  updatedAt: new Date('2026-10-05T00:00:00Z'),
  ...o,
});

const mapping: HfisMapping = {
  doctorCode: new Map([
    [P.bagus, 99003],
    [P.melati, 99004],
  ]),
  practitionerByCode: new Map([
    [99003, { id: P.bagus, name: 'dr. Bagus Santoso, Sp.JP' }],
    [99004, { id: P.melati, name: 'dr. Melati Kusumawardani, Sp.JP' }],
  ]),
  poliCode: new Map([[JT, 'JAN']]),
};

const pull = (jadwal: HfisPull['snapshot']['jadwal'], fetchedAt = '2026-10-05T00:00:00Z'): HfisPull => ({
  fetchedAt: new Date(fetchedAt),
  snapshot: { serviceId: JT, kodepoli: 'JAN', tanggal: DATE, jadwal },
});
const entry = (o: Partial<HfisPull['snapshot']['jadwal'][number]> = {}) => ({
  kodedokter: 99003,
  namadokter: 'dr. Bagus Santoso, Sp.JP',
  jadwal: '09:00 - 12:00',
  kapasitaspasien: 20,
  libur: false,
  ...o,
});

const compare = (sessions: RsSession[], pulls: HfisPull[]) =>
  compareWithHfis({
    sessions,
    pulls: latestPulls(pulls),
    mapping,
    dates: [DATE],
    serviceNames: new Map([[JT, 'Jantung']]),
  });

describe('perbandingan RS vs HFIS', () => {
  it('sama persis (jam + kapasitas) → tersinkron', () => {
    const c = compare([session({})], [pull([entry()])]);
    expect(c.items).toEqual([]);
    expect(c.synced.has(session({}).id)).toBe(true);
    expect(c.lastPulledAt?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('cuti RS + praktik HFIS → aplikasi HFIS (seperti mockup Jadwal)', () => {
    const c = compare([session({ kind: 'cuti' })], [pull([entry()])]);
    expect(c.items).toEqual([
      expect.objectContaining({ kind: 'hfis-praktik-rs-cuti', resolution: 'aplikasi-hfis' }),
    ]);
    expect(c.items[0]?.text).toContain('masih tercatat praktik Rab, 7 Okt 2026 09.00–12.00 di HFIS');
    expect(compare([session({ kind: 'cuti' })], [pull([entry({ libur: true })])]).items).toEqual([]);
  });

  it('jam beda / tidak ada → kirim; libur atau kapasitas beda → aplikasi HFIS', () => {
    const kinds = (jadwal: HfisPull['snapshot']['jadwal']) =>
      compare([session({})], [pull(jadwal)]).items.map((i) => [i.kind, i.resolution]);
    expect(kinds([entry({ jadwal: '13:00 - 15:00' })])).toEqual([['jam-beda', 'kirim']]);
    expect(kinds([])).toEqual([['rs-praktik-hfis-tidak', 'kirim']]);
    expect(kinds([entry({ libur: true })])).toEqual([['rs-praktik-hfis-libur', 'aplikasi-hfis']]);
    expect(kinds([entry({ kapasitaspasien: 25 })])).toEqual([['kapasitas-beda', 'aplikasi-hfis']]);
  });

  it('praktik di HFIS tanpa sesi RS → kirim; tarikan terbaru yang dipakai', () => {
    const c = compare(
      [session({})],
      [
        pull([entry(), entry({ kodedokter: 99004, jadwal: '13:00 - 15:00' })], '2026-10-05T00:00:00Z'),
        pull([entry()], '2026-10-05T03:00:00Z'),
      ],
    );
    expect(c.items).toEqual([]);
    const old = compare(
      [session({})],
      [pull([entry(), entry({ kodedokter: 99004, jadwal: '13:00 - 15:00' })])],
    );
    expect(old.items).toEqual([
      expect.objectContaining({
        kind: 'hfis-praktik-rs-tidak',
        sessionId: null,
        slotId: scheduleCellId(P.melati, DATE),
      }),
    ]);
  });

  it('tanpa tarikan → tidak dibandingkan (belum sinkron); dokter tanpa kode HFIS dianggap sesuai', () => {
    const c = compare([session({}), session({ id: 'x', practitionerId: P.tanpaKode })], []);
    expect(c.items).toEqual([]);
    expect(c.unpulledDates).toEqual([DATE]);
    expect(c.synced.has(session({}).id)).toBe(false);
    expect(c.synced.has('x')).toBe(true);
  });
});

describe('grid minggu', () => {
  it('cuti berpengganti: dokter pengganti dapat sel "pengganti" memakai sesi yang digantikan', () => {
    const cuti = session({
      kind: 'cuti',
      substituteId: P.melati,
      substituteName: 'dr. Melati Kusumawardani, Sp.JP',
      bookedJkn: 3,
    });
    const days = ['2026-10-05', '2026-10-06', DATE];
    const week = weeklyScheduleSchema.parse(
      buildWeek({ weekStart: '2026-10-05', days, sessions: [cuti], comparison: compare([cuti], []) }),
    );
    const [bagus, melati] = week.doctors;
    expect(bagus?.slots[2]).toMatchObject({ kind: 'cuti', relatedDoctorId: P.melati, affectedPatients: 3 });
    expect(bagus?.slots[0]).toMatchObject({ kind: 'libur', sessionId: null });
    expect(melati?.slots[2]).toMatchObject({
      kind: 'pengganti',
      sessionId: cuti.id,
      start: '09.00',
      relatedDoctorId: P.bagus,
    });
    expect(week.hfis.lastSyncAt).toBeNull();
  });
});
