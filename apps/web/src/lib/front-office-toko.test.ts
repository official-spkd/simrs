import { describe, expect, it } from 'vitest';
import { type DemoActor, project, type StoredEvent } from './demo/store/define';
import {
  counterTickets,
  demoQueueBoard,
  demoRegistrationDesk,
  demoWeeklySchedule,
  HFIS_PENDING_SLOT,
  NO_PROGRESS,
  todayQuotas,
} from './demo/fixtures/front-office';
import { DOCTOR_ID, PATIENT_ID } from './demo/fixtures/ids';
import { scheduleCellId } from '@simrs/shared';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  applyQueueBoard,
  lastCall,
  loketView,
  nextPoliCall,
  queueDomain,
  takenLoketNos,
} from './front-office-antrean';
import { applyScheduleStore, dirtyQuotaSlots, scheduleDomain, unsyncedLeaves } from './front-office-jadwal';
import {
  bookedBySession,
  nextVisitId,
  registrationDomain,
  type RegistrationEvent,
  visitOf,
} from './front-office-pendaftaran';

const petugas: DemoActor = {
  userId: 'u-1',
  name: 'Petugas Loket Uji',
  role: 'petugas_pendaftaran',
  baseRole: null,
};

let seq = 0;
const ev = (domain: string, data: unknown, actor = petugas): StoredEvent => ({
  seq: ++seq,
  domain,
  at: '2026-10-05T03:50:00.000Z',
  actor,
  data,
});
const log = (events: StoredEvent[]) => ({ seq, resetSeq: 0, events });

const andini = todayQuotas(demoWeeklySchedule()).find((q) => q.doctorId === DOCTOR_ID.andini);
if (!andini) throw new Error('fixture: dr. Andini praktik hari ini');

const visit = (over: Partial<Extract<RegistrationEvent, { type: 'kunjungan.terdaftar' }>> = {}) => ({
  type: 'kunjungan.terdaftar' as const,
  visitId: 'kj-1',
  patientId: PATIENT_ID.siti,
  rm: '00-12-45-78',
  patientName: 'Siti Rahmawati',
  payer: 'BPJS' as const,
  poliCode: 'PD',
  poliName: andini.poliName,
  room: andini.room,
  doctorId: andini.doctorId,
  doctorName: andini.doctorName,
  sessionId: andini.sessionId,
  queueNo: 'PD-028',
  sepNo: '0301R0011026V000812',
  diagnosis: 'I10 · Hipertensi esensial (primer)',
  ticketNo: 'A-032',
  jam: '10.52',
  charge: { itemCode: 'ADM-RJ' as const, label: 'Administrasi rawat jalan', amount: '30000' },
  ...over,
});

describe('domain pendaftaran', () => {
  it('SEP + kunjungan tersimpan atas nama pengguna sesi; satu kunjungan per pasien per hari', () => {
    const p = project(
      registrationDomain,
      log([
        ev('pendaftaran', {
          type: 'sep.diterbitkan',
          patientId: PATIENT_ID.siti,
          referralId: 'ref-1',
          diagnosis: 'I10 · Hipertensi esensial (primer)',
          sepNo: '0301R0011026V000812',
          jam: '10.50',
        }),
        ev('pendaftaran', visit()),
        // Kedua kali untuk pasien yang sama: ditolak reducer, dilewati saat diputar ulang.
        ev('pendaftaran', visit({ visitId: 'kj-2', queueNo: 'PD-029' })),
        ev('pendaftaran', { type: 'kunjungan.dicetak', visitId: 'kj-1', jam: '10.53' }),
      ]),
    );
    expect(p.state.seps[PATIENT_ID.siti]?.by).toBe('Petugas Loket Uji');
    expect(p.state.visits).toHaveLength(1);
    const v = visitOf(p.state, PATIENT_ID.siti);
    expect(v?.registeredBy).toBe('Petugas Loket Uji');
    expect(v?.printedAt).toBe('10.53');
    expect(nextVisitId(p.state)).toBe('kj-2');
    expect(bookedBySession(p.state).get(andini.sessionId)).toEqual({ jkn: 1, nonJkn: 0 });
    expect(registrationDomain.validate?.(p.state, visit({ visitId: 'kj-9' }), petugas)).toMatch(
      /sudah terdaftar hari ini · antrean PD-028/,
    );
  });

  it('BPJS tanpa SEP ditolak; kontrak charge ADM-RJ rupiah utuh', () => {
    const s = registrationDomain.initial();
    expect(registrationDomain.validate?.(s, visit({ sepNo: null }), petugas)).toBe(
      'Pasien BPJS wajib punya SEP.',
    );
    expect(registrationDomain.validate?.(s, visit({ payer: 'Umum', sepNo: null }), petugas)).toBeNull();
    expect(
      registrationDomain.eventSchema.safeParse(
        visit({ charge: { itemCode: 'ADM-RJ', label: 'x', amount: '30.000' } }),
      ).success,
    ).toBe(false);
    expect(BigInt(visit().charge.amount)).toBe(30_000n);
  });
});

describe('domain antrean', () => {
  const fixture = counterTickets(NO_PROGRESS);
  const base = demoRegistrationDesk(NO_PROGRESS).counter;

  it('tiket anjungan beridentitas didahulukan; panggilan loket tersimpan; nomor tidak dipakai ulang', () => {
    const taken = [
      ev('antrean', {
        type: 'tiket.diambil',
        ticketNo: 'A-032',
        service: 'loket',
        purpose: 'booking',
        patientId: PATIENT_ID.siti,
        jam: '10.47',
      }),
      // Pasien yang sama mengambil tiket loket lagi: ditolak.
      ev('antrean', {
        type: 'tiket.diambil',
        ticketNo: 'A-033',
        service: 'loket',
        purpose: 'umum',
        patientId: PATIENT_ID.siti,
        jam: '10.48',
      }),
    ];
    const p = project(queueDomain, log(taken));
    const view = loketView(fixture, base.waiting, ['A-031'], p.state);
    expect(view.queue.map((t) => t.ticket)).toEqual(['A-032', 'A-028', 'A-029', 'A-030']);
    expect(view.next).toBe('A-032');
    expect(view.waiting).toBe(base.waiting + 1);

    const called = project(
      queueDomain,
      log([
        ...taken,
        ev('antrean', { type: 'tiket.dipanggil', ticketNo: 'A-032', counter: 'Loket 3', jam: '10.50' }),
      ]),
    );
    const v2 = loketView(fixture, base.waiting, ['A-031'], called.state);
    expect(v2.current).toMatchObject({ ticketNo: 'A-032', patientId: PATIENT_ID.siti, place: 'Loket 3' });
    expect(v2.next).toBe('A-028');
    expect(takenLoketNos(fixture, ['A-031'], called.state)).toContain('A-032');
    expect(lastCall(called.state)?.by).toBe('Petugas Loket Uji');
  });

  it('kunjungan terdaftar (langganan pendaftaran) masuk papan poli; panggilan papan bergiliran tanpa nomor cadangan', () => {
    const registered = [ev('pendaftaran', visit())];
    const p = project(queueDomain, log(registered));
    expect(p.state.registered[0]).toMatchObject({ queueNo: 'PD-028', ticketNo: 'A-032' });
    const board = applyQueueBoard(demoQueueBoard(NO_PROGRESS), p.state);
    const pd = board.clinics.find((c) => c.poliCode === 'PD');
    expect(pd?.waiting).toContain('PD-028');

    const next = nextPoliCall(board);
    expect(next).not.toBeNull();
    const called = project(
      queueDomain,
      log([
        ...registered,
        ev('antrean', {
          type: 'antrean.dipanggil',
          queueNo: next?.queueNo,
          poliCode: next?.poliCode,
          via: 'display',
          jam: '10.55',
        }),
      ]),
    );
    const after = applyQueueBoard(demoQueueBoard(NO_PROGRESS), called.state);
    expect(after.calling).toEqual(next);
    expect(after.history[0]).toEqual(board.calling);
    // Nomor yang sudah dipanggil tidak dipanggil lagi.
    expect(
      queueDomain.validate?.(
        called.state,
        {
          type: 'antrean.dipanggil',
          queueNo: next?.queueNo ?? '',
          poliCode: 'PD',
          via: 'display',
          jam: '10.56',
        },
        petugas,
      ),
    ).toMatch(/sudah dipanggil/);
  });

  it('nomor dicadangkan petugas poli (PD-027) tidak dipanggil dari papan', () => {
    const board = demoQueueBoard({ ticket: true, called: true, sep: true, doctorCalled: false });
    const onlyPd = {
      ...board,
      clinics: board.clinics.filter((c) => c.poliCode === 'PD').map((c) => ({ ...c, waiting: ['PD-027'] })),
    };
    expect(nextPoliCall(onlyPd)).toBeNull();
  });

  it('bantuan anjungan: satu permintaan terbuka sampai ditangani', () => {
    const asked = [ev('antrean', { type: 'bantuan.diminta', device: 'Anjungan 1 · lobi', jam: '10.49' })];
    const p = project(queueDomain, log(asked));
    expect(p.state.assist?.jam).toBe('10.49');
    expect(
      queueDomain.validate?.(p.state, { type: 'bantuan.diminta', device: 'x', jam: '10.50' }, petugas),
    ).toMatch(/sudah dipanggil/);
    const done = project(
      queueDomain,
      log([...asked, ev('antrean', { type: 'bantuan.ditangani', jam: '10.51' })]),
    );
    expect(done.state.assist).toBeNull();
  });
});

describe('domain jadwal', () => {
  const week = demoWeeklySchedule();
  const andiniMon = scheduleCellId(DOCTOR_ID.andini, DEMO_TODAY);

  it('kuota diubah → berbeda dari HFIS sampai dikirim; booking kunjungan menambah terisi', () => {
    const p = project(
      scheduleDomain,
      log([ev('jadwal', { type: 'kuota.diubah', slotId: andiniMon, jkn: 25, nonJkn: 6, jam: '10.50' })]),
    );
    expect(dirtyQuotaSlots(week, p.state)).toEqual([andiniMon]);
    const applied = applyScheduleStore(week, p.state, new Map([[andini.sessionId, { jkn: 1, nonJkn: 0 }]]));
    const slot = applied.doctors.flatMap((d) => d.slots).find((s) => s.id === andiniMon);
    expect(slot?.quota).toMatchObject({ jkn: 25, nonJkn: 6, bookedJkn: 18 });
    expect(slot?.hfisSynced).toBe(false);

    const sent = project(
      scheduleDomain,
      log([
        ev('jadwal', { type: 'kuota.diubah', slotId: andiniMon, jkn: 25, nonJkn: 6, jam: '10.50' }),
        ev('jadwal', { type: 'hfis.dikirim', quotaChanges: 1, jam: '10.51' }),
      ]),
    );
    expect(dirtyQuotaSlots(week, sent.state)).toEqual([]);
    const after = applyScheduleStore(week, sent.state);
    expect(after.hfis.differences).toEqual([]);
    expect(after.doctors.flatMap((d) => d.slots).find((s) => s.id === HFIS_PENDING_SLOT)?.hfisSynced).toBe(
      true,
    );
    expect(sent.state.syncJam).toBe('10.51');
  });

  it('cuti hari ini: dokter hilang dari kuota hari ini; pasien booking menjadi terdampak; alasan wajib', () => {
    expect(
      scheduleDomain.eventSchema.safeParse({
        type: 'cuti.dicatat',
        slotId: andiniMon,
        substituteId: null,
        reason: 'x',
        jam: '10.50',
      }).success,
    ).toBe(false);
    const p = project(
      scheduleDomain,
      log([
        ev('jadwal', {
          type: 'cuti.dicatat',
          slotId: andiniMon,
          substituteId: null,
          reason: 'Seminar nasional',
          jam: '10.50',
        }),
      ]),
    );
    expect(unsyncedLeaves(p.state)).toEqual([andiniMon]);
    const applied = applyScheduleStore(week, p.state);
    const slot = applied.doctors.flatMap((d) => d.slots).find((s) => s.id === andiniMon);
    expect(slot).toMatchObject({ kind: 'cuti', affectedPatients: 22, hfisSynced: false });
    expect(todayQuotas(applied).some((q) => q.doctorId === DOCTOR_ID.andini)).toBe(false);
    expect(
      scheduleDomain.validate?.(
        p.state,
        { type: 'kuota.diubah', slotId: andiniMon, jkn: 1, nonJkn: 1, jam: '10.52' },
        petugas,
      ),
    ).toMatch(/cuti/);
  });
});
