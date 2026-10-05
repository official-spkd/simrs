/**
 * Fase 2 · potongan 0b · Skema front office (F01–F07) di database: seed, isolasi tenant setiap tabel, kuota dijamin
 * CHECK + reservasi atomik (20 serentak untuk 1 sisa kuota), nomor antrean, append-only, kolom yang tidak bisa
 * diubah, SEP beku + penjaminan terkunci, NOTIFY panggilan antrean tanpa isi, persetujuan umum per admisi.
 */
import { newId } from '@simrs/shared';
import { encryptField, PatientCrypto } from '@simrs/shared/node';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  allocateQueueNumber,
  createPrismaClient,
  ensureSystemRoles,
  insertPatient,
  Prisma,
  type PrismaClient,
  releaseQuota,
  reserveQuota,
  SEED_PAYERS,
  SEED_PRACTITIONERS,
  SEED_QUEUE_SERVICES,
  SEED_SCHEDULE_TEMPLATES,
  seedFrontOffice,
  seedHospitalStructure,
  seedStaff,
  type TenantTx,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

// Kunci uji khusus tes ini (bukan .env): data terenkripsi hanya di tenant baru, tidak di RSFA/RSFB bersama.
const keys = {
  encKeyB64: Buffer.alloc(32, 31).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 33).toString('base64'),
};

/** Semua tabel baru potongan 0b (dipakai uji isolasi). */
const FRONT_OFFICE_TABLES = [
  'practitioners',
  'external_ids',
  'payers',
  'queue_services',
  'queue_displays',
  'queue_display_services',
  'practitioner_schedules',
  'schedule_sessions',
  'hfis_schedule_snapshots',
  'appointments',
  'queue_tickets',
  'queue_calls',
  'bpjs_queue_tasks',
  'encounters',
  'encounter_status_history',
  'coverages',
  'referrals',
  'seps',
  'patient_contacts',
] as const;

let app: PrismaClient;
let owner: PrismaClient;
let A: string;
let B: string;

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  A = await freshTenant();
  B = await freshTenant();
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

/** RS fiktif baru seperti `pnpm db:seed`: peran, struktur, staf seed, front office. */
async function freshTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner, id, async (tx) => {
    await tx.tenant.create({
      data: { id, code: `FO${id.slice(-6).toUpperCase()}`, name: 'RS Fiktif Uji FO' },
    });
    await ensureSystemRoles(tx, id);
    await seedHospitalStructure(tx, id);
  });
  await seedStaff(owner, id, { encKeyB64: keys.encKeyB64 });
  await seedFrontOffice(owner, id);
  return id;
}

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, A, fn);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const clock = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
let dayCounter = 0;
/** Tanggal sesi unik per pemanggilan (kunci unik praktisi × tanggal × jam). */
const nextDate = () => {
  dayCounter += 1;
  return new Date(Date.UTC(2027, 0, 1) + dayCounter * 86_400_000).toISOString().slice(0, 10);
};

async function refs(tx: TenantTx) {
  const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
  const practitioner = await tx.practitioner.findFirstOrThrow({
    where: { name: { startsWith: 'dr. Rahmat' } },
  });
  const substitute = await tx.practitioner.findFirstOrThrow({ where: { name: { startsWith: 'dr. Sinta' } } });
  const payer = await tx.payer.findFirstOrThrow({ where: { code: 'BPJS' } });
  return { service, practitioner, substitute, payer };
}

async function makeSession(
  tenantId: string,
  opts: { quotaJkn?: number; bookedJkn?: number; kind?: 'praktik' | 'cuti'; substitute?: boolean } = {},
): Promise<string> {
  return withTenant(app, tenantId, async (tx) => {
    const r = await refs(tx);
    const id = newId();
    await tx.scheduleSession.create({
      data: {
        id,
        tenantId,
        practitionerId: r.practitioner.id,
        serviceId: r.service.id,
        sessionDate: day(nextDate()),
        startTime: clock('08:00'),
        endTime: clock('12:00'),
        kind: opts.kind ?? 'praktik',
        substituteId: opts.substitute ? r.substitute.id : null,
        quotaJkn: opts.quotaJkn ?? 10,
        quotaNonJkn: 2,
        bookedJkn: opts.bookedJkn ?? 0,
      },
    });
    return id;
  });
}

/** Satu rantai lengkap pendaftaran rawat jalan di satu tenant: setiap tabel 0b mendapat minimal satu baris. */
async function makeChain(tenantId: string) {
  const sessionId = await makeSession(tenantId);
  return withTenant(app, tenantId, async (tx) => {
    const r = await refs(tx);
    const crypto = new PatientCrypto(keys, tenantId);
    const patient = await insertPatient(tx, crypto, {
      name: 'Pasien Uji Front Office',
      sex: 'female',
      birthDate: '1980-02-03',
      identifiers: { bpjs: `0000${digits(9)}` },
    });
    const identifier = await tx.patientIdentifier.findFirstOrThrow({ where: { patientId: patient.id } });
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'POLI-DALAM' } });
    const appointmentId = newId();
    await tx.appointment.create({
      data: {
        id: appointmentId,
        tenantId,
        bookingCode: digits(10),
        patientId: patient.id,
        sessionId,
        practitionerId: r.practitioner.id,
        serviceId: r.service.id,
        appointmentDate: day('2027-06-01'),
        quotaBucket: 'jkn',
        jknVisitKind: 1,
        referenceNumber: `0301U${digits(14)}`,
        channel: 'mobile_jkn',
      },
    });
    const n = await allocateQueueNumber(tx, tenantId, r.service.id, '2027-06-01');
    const ticketId = newId();
    await tx.queueTicket.create({
      data: {
        id: ticketId,
        tenantId,
        serviceId: r.service.id,
        serviceDate: day('2027-06-01'),
        seq: n.seq,
        ticketNo: n.ticketNo,
        appointmentId,
        patientId: patient.id,
        source: 'booking',
        reserved: true,
      },
    });
    const callId = newId();
    await tx.queueCall.create({
      data: { id: callId, tenantId, ticketId, action: 'call', counter: 'Ruang 2' },
    });
    const taskId = newId();
    await tx.bpjsQueueTask.create({
      data: { id: taskId, tenantId, appointmentId, taskId: 1, occurredAt: new Date() },
    });
    const encounterId = newId();
    await tx.encounter.create({
      data: {
        id: encounterId,
        tenantId,
        number: `RJ-2706-${digits(6)}`,
        patientId: patient.id,
        encounterClass: 'AMB',
        status: 'arrived',
        unitId: unit.id,
        serviceId: r.service.id,
        practitionerId: r.practitioner.id,
        appointmentId,
        queueTicketId: ticketId,
        arrivedAt: new Date(),
      },
    });
    await tx.encounterStatusHistory.create({
      data: { id: newId(), tenantId, encounterId, fromStatus: null, toStatus: 'arrived' },
    });
    const coverageId = newId();
    await tx.coverage.create({
      data: {
        id: coverageId,
        tenantId,
        encounterId,
        payerId: r.payer.id,
        patientIdentifierId: identifier.id,
        classEntitlement: 'kelas_2',
        careClass: 'kelas_2',
      },
    });
    const referralId = newId();
    await tx.referral.create({
      data: {
        id: referralId,
        tenantId,
        patientId: patient.id,
        kind: 'rujukan-fktp',
        number: `0301U${digits(8)}`,
        ppkCode: '0301U001',
        facilityName: 'Puskesmas Fiktif Sejahtera',
        targetServiceId: r.service.id,
        diagnosisCode: 'E11.9',
        issuedOn: day('2027-05-20'),
        validUntil: day('2027-08-18'),
        visitNo: 1,
      },
    });
    const sepId = newId();
    await tx.sep.create({
      data: {
        id: sepId,
        tenantId,
        encounterId,
        coverageId,
        referralId,
        serviceType: 'rawat_jalan',
        careClass: 'kelas_2',
        poliCode: 'INT',
        diagnosisCode: 'E11.9',
      },
    });
    const enc = (v: string) => encryptField(v, { keyB64: keys.encKeyB64, tenantId, purpose: 'contact' });
    await tx.patientContact.create({
      data: {
        id: newId(),
        tenantId,
        patientId: patient.id,
        relation: 'anak',
        nameEnc: enc('Anak Pasien Fiktif'),
        phoneEnc: enc('6281200009999'),
        isGuarantor: true,
      },
    });
    await tx.hfisScheduleSnapshot.create({
      data: {
        id: newId(),
        tenantId,
        practitionerId: r.practitioner.id,
        direction: 'pull',
        periodStart: day('2027-06-01'),
        periodEnd: day('2027-06-07'),
        payload: { jadwal: [] },
      },
    });
    return {
      patientId: patient.id,
      sessionId,
      appointmentId,
      ticketId,
      callId,
      taskId,
      encounterId,
      coverageId,
      referralId,
      sepId,
      serviceId: r.service.id,
    };
  });
}

describe('seed front office', () => {
  it('layanan, kode poli BPJS, praktisi tertaut staf seed, templat, penjamin, papan; diulang tanpa tambahan', async () => {
    const counts = await inA(async (tx) => ({
      services: (await tx.queueService.findMany({ orderBy: { code: 'asc' } })).map((s) => s.code),
      practitioners: await tx.practitioner.count(),
      linked: await tx.practitioner.count({ where: { userId: { not: null } } }),
      schedules: await tx.practitionerSchedule.count(),
      payers: (await tx.payer.findMany({ orderBy: { code: 'asc' } })).map((p) => p.code),
      bpjsPoli: (
        await tx.externalId.findMany({ where: { system: 'bpjs:poli' }, orderBy: { value: 'asc' } })
      ).map((e) => e.value),
      hfis: await tx.externalId.findMany({
        where: { system: 'bpjs:hfis-dokter' },
        orderBy: { value: 'asc' },
      }),
      board: await tx.queueDisplay.findFirstOrThrow({
        where: { code: 'RJ-LT2' },
        include: { services: { orderBy: { position: 'asc' }, include: { service: true } } },
      }),
    }));
    expect(counts.services).toEqual(SEED_QUEUE_SERVICES.map((s) => s.code).sort());
    expect(counts.practitioners).toBe(SEED_PRACTITIONERS.length);
    expect(counts.linked).toBe(SEED_PRACTITIONERS.filter((p) => p.nip).length);
    expect(counts.schedules).toBe(SEED_SCHEDULE_TEMPLATES.reduce((n, t) => n + t[2].length, 0));
    expect(counts.payers).toEqual(SEED_PAYERS.map((p) => p.code).sort());
    expect(counts.bpjsPoli).toEqual(['INT', 'JAN', 'PAR', 'SAR']);
    // Kode dokter HFIS fiktif sama dengan mock BPJS (99001–99006).
    const names = await inA(async (tx) =>
      Promise.all(
        counts.hfis.map(async (e) => [
          e.value,
          (await tx.practitioner.findUniqueOrThrow({ where: { id: e.entityId } })).name,
        ]),
      ),
    );
    expect(names).toEqual([
      ['99001', 'dr. Andini Prameswari, Sp.PD'],
      ['99002', 'dr. Rahmat Hidayat, Sp.PD'],
      ['99003', 'dr. Bagus Santoso, Sp.JP'],
      ['99004', 'dr. Melati Kusumawardani, Sp.JP'],
      ['99005', 'dr. Yudha Pratama, Sp.N'],
      ['99006', 'dr. Kartika Sari, Sp.P'],
    ]);
    expect(counts.board.name).toBe('Rawat Jalan Lantai 2');
    expect(counts.board.services.map((s) => s.service.code)).toEqual(['PD', 'JT', 'SR', 'PR']);

    // Praktisi bernama sama dengan akun staf seed yang ditautkan; jam templat tersimpan sebagai jam dinding.
    const rahmat = await inA((tx) =>
      tx.practitioner.findFirstOrThrow({
        where: { name: 'dr. Rahmat Hidayat, Sp.PD' },
        include: { user: true, schedules: { orderBy: { weekday: 'asc' } } },
      }),
    );
    expect(rahmat.user?.username).toBe('999905172008031001');
    expect(rahmat.schedules.map((s) => s.weekday)).toEqual([1, 3, 4, 5]);
    expect(rahmat.schedules[0]?.startTime.toISOString()).toBe('1970-01-01T13:00:00.000Z');

    expect(await seedFrontOffice(owner, A)).toEqual({
      services: 0,
      practitioners: 0,
      schedules: 0,
      payers: 0,
      displays: 0,
    });
  });
});

describe('kuota sesi', () => {
  it('CHECK: booked tidak pernah melebihi kuota, bahkan oleh pemilik tabel', async () => {
    const s = await makeSession(A, { quotaJkn: 2, bookedJkn: 2 });
    await expect(
      withTenant(owner, A, (tx) => tx.scheduleSession.update({ where: { id: s }, data: { bookedJkn: 3 } })),
    ).rejects.toThrow(/schedule_sessions_quota/);
    await expect(
      withTenant(owner, A, (tx) => tx.scheduleSession.update({ where: { id: s }, data: { quotaJkn: 1 } })),
    ).rejects.toThrow(/schedule_sessions_quota/);
  });

  it('reserveQuota/releaseQuota: sampai penuh lalu null; batal mengembalikan; cuti hanya bila ada pengganti', async () => {
    const s = await makeSession(A, { quotaJkn: 2 });
    expect(await inA((tx) => reserveQuota(tx, s, 'jkn'))).toEqual({ booked: 1, quota: 2 });
    expect(await inA((tx) => reserveQuota(tx, s, 'jkn'))).toEqual({ booked: 2, quota: 2 });
    expect(await inA((tx) => reserveQuota(tx, s, 'jkn'))).toBeNull();
    expect(await inA((tx) => reserveQuota(tx, s, 'non_jkn'))).toEqual({ booked: 1, quota: 2 });
    expect(await inA((tx) => releaseQuota(tx, s, 'jkn'))).toEqual({ booked: 1, quota: 2 });
    expect(await inA((tx) => reserveQuota(tx, s, 'jkn'))).toEqual({ booked: 2, quota: 2 });
    const empty = await makeSession(A);
    expect(await inA((tx) => releaseQuota(tx, empty, 'jkn'))).toBeNull();

    const leave = await makeSession(A, { kind: 'cuti' });
    expect(await inA((tx) => reserveQuota(tx, leave, 'jkn'))).toBeNull();
    const covered = await makeSession(A, { kind: 'cuti', substitute: true });
    expect(await inA((tx) => reserveQuota(tx, covered, 'jkn'))).toEqual({ booked: 1, quota: 10 });
    // Sesi RS lain tidak terlihat (RLS): tidak bisa dipesan dari tenant B.
    expect(await withTenant(app, B, (tx) => reserveQuota(tx, s, 'non_jkn'))).toBeNull();
  });

  it('20 reservasi serentak untuk 1 sisa kuota → tepat 1 berhasil', async () => {
    const s = await makeSession(A, { quotaJkn: 5, bookedJkn: 4 });
    const burst = createPrismaClient({ connectionString: testDbUrls().app, max: 22 });
    try {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let locked: () => void = () => undefined;
      const lockedSignal = new Promise<void>((r) => {
        locked = r;
      });
      // Tahan kunci baris sesi sampai ke-20 permintaan sedang menunggu, agar semuanya benar-benar berebut.
      const holder = withTenant(
        burst,
        A,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM schedule_sessions WHERE id = ${s}::uuid FOR NO KEY UPDATE`;
          locked();
          await gate;
        },
        { timeoutMs: 60_000, maxWaitMs: 20_000 },
      );
      await lockedSignal;
      const attempts = Array.from({ length: 20 }, () =>
        withTenant(burst, A, (tx) => reserveQuota(tx, s, 'jkn'), { timeoutMs: 60_000, maxWaitMs: 20_000 }),
      );
      await waitForLockWaiters(20);
      release();
      await holder;
      const results = await Promise.all(attempts);
      expect(results.filter((r) => r !== null)).toEqual([{ booked: 5, quota: 5 }]);
      const row = await inA((tx) => tx.scheduleSession.findUniqueOrThrow({ where: { id: s } }));
      expect(row.bookedJkn).toBe(5);
    } finally {
      await burst.$disconnect();
    }
  });
});

/** Tunggu sampai minimal `n` transaksi di database tes ini menunggu kunci (batas ~10 detik). */
async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const [row] = await owner.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND a.datname = current_database()`;
    if ((row?.n ?? 0) >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Kurang dari ${n} transaksi menunggu kunci`);
}

describe('nomor antrean', () => {
  it('berurutan per layanan per hari; serentak tidak ganda; layanan/hari lain mulai dari 1; lewat 999 ditolak', async () => {
    const [pd, jt] = await inA(async (tx) => [
      (await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } })).id,
      (await tx.queueService.findFirstOrThrow({ where: { code: 'JT' } })).id,
    ]);
    const date = nextDate();
    const got = await Promise.all(
      Array.from({ length: 10 }, () => inA((tx) => allocateQueueNumber(tx, A, pd as string, date))),
    );
    expect(got.map((g) => g.seq).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(got.map((g) => g.ticketNo).sort()).toContain('PD-010');
    expect(await inA((tx) => allocateQueueNumber(tx, A, jt as string, date))).toEqual({
      seq: 1,
      ticketNo: 'JT-001',
    });
    expect(await inA((tx) => allocateQueueNumber(tx, A, pd as string, nextDate()))).toEqual({
      seq: 1,
      ticketNo: 'PD-001',
    });
    // Transaksi batal: nomornya ikut batal (urutan tidak berlubang).
    await expect(
      inA(async (tx) => {
        await allocateQueueNumber(tx, A, jt as string, date);
        throw new Error('batal');
      }),
    ).rejects.toThrow('batal');
    expect((await inA((tx) => allocateQueueNumber(tx, A, jt as string, date))).seq).toBe(2);

    const full = nextDate();
    await inA((tx) => allocateQueueNumber(tx, A, pd as string, full));
    await withTenant(
      owner,
      A,
      (tx) =>
        tx.$executeRaw`UPDATE number_sequences SET last_value = 999
        WHERE kind = ${`queue_${(pd as string).replaceAll('-', '')}`} AND period = ${full.slice(2).replaceAll('-', '')}`,
    );
    await expect(inA((tx) => allocateQueueNumber(tx, A, pd as string, full))).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'QUEUE_FULL' },
    });
    // Nomor berformat dijaga CHECK: nomor tidak sesuai urutannya ditolak.
    await expect(
      inA((tx) =>
        tx.queueTicket.create({
          data: {
            id: newId(),
            tenantId: A,
            serviceId: pd as string,
            serviceDate: day(full),
            seq: 7,
            ticketNo: 'PD-008',
            source: 'loket',
          },
        }),
      ),
    ).rejects.toThrow(/queue_tickets_number_valid/);
  });
});

describe('jejak yang tidak bisa diubah', () => {
  it('append-only: panggilan antrean, riwayat status kunjungan, salinan HFIS, kontak pasien', async () => {
    await makeChain(A);
    for (const table of [
      'queue_calls',
      'encounter_status_history',
      'hfis_schedule_snapshots',
      'patient_contacts',
    ]) {
      const t = Prisma.raw(table);
      await expect(
        withTenant(owner, A, (tx) => tx.$executeRaw`UPDATE ${t} SET tenant_id = tenant_id`),
      ).rejects.toThrow(/APPEND_ONLY/);
      await expect(withTenant(owner, A, (tx) => tx.$executeRaw`DELETE FROM ${t}`)).rejects.toThrow(
        /APPEND_ONLY/,
      );
      await expect(withTenant(app, A, (tx) => tx.$executeRaw`DELETE FROM ${t}`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('kode booking, nomor tiket, nomor kunjungan, task BPJS: hak kolom + trigger (juga pemilik tabel)', async () => {
    const c = await makeChain(A);
    const asApp = (sql: Prisma.Sql) => withTenant(app, A, (tx) => tx.$executeRaw(sql));
    const asOwner = (sql: Prisma.Sql) => withTenant(owner, A, (tx) => tx.$executeRaw(sql));
    const cases: Array<[Prisma.Sql, Prisma.Sql]> = [
      [
        Prisma.sql`UPDATE appointments SET booking_code = '0000000000' WHERE id = ${c.appointmentId}::uuid`,
        Prisma.sql`UPDATE appointments SET booking_code = '0000000000' WHERE id = ${c.appointmentId}::uuid`,
      ],
      [
        Prisma.sql`UPDATE queue_tickets SET ticket_no = 'PD-999' WHERE id = ${c.ticketId}::uuid`,
        Prisma.sql`UPDATE queue_tickets SET seq = 999, ticket_no = 'PD-999' WHERE id = ${c.ticketId}::uuid`,
      ],
      [
        Prisma.sql`UPDATE encounters SET number = 'RJ-0000-000000' WHERE id = ${c.encounterId}::uuid`,
        Prisma.sql`UPDATE encounters SET number = 'RJ-0000-000000' WHERE id = ${c.encounterId}::uuid`,
      ],
      [
        Prisma.sql`UPDATE bpjs_queue_tasks SET occurred_at = now() - interval '1 hour' WHERE id = ${c.taskId}::uuid`,
        Prisma.sql`UPDATE bpjs_queue_tasks SET task_id = 2 WHERE id = ${c.taskId}::uuid`,
      ],
    ];
    for (const [appSql, ownerSql] of cases) {
      await expect(asApp(appSql)).rejects.toThrow(/permission denied/);
      await expect(asOwner(ownerSql)).rejects.toThrow(/IMMUTABLE_COLUMN/);
    }
    // Status kirim task boleh diperbarui; satu baris per (booking, task).
    await asApp(
      Prisma.sql`UPDATE bpjs_queue_tasks SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = ${c.taskId}::uuid`,
    );
    await expect(
      inA((tx) =>
        tx.bpjsQueueTask.create({
          data: {
            id: newId(),
            tenantId: A,
            appointmentId: c.appointmentId,
            taskId: 1,
            occurredAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/Unique constraint/);
  });
});

describe('SEP dan penjaminan', () => {
  it('terbit → beku kecuali batal; batal → beku; koreksi = versi baru sekali; satu rantai per kunjungan; penjaminan terkunci', async () => {
    const c = await makeChain(A);
    const issuedAt = new Date();
    await inA((tx) =>
      tx.sep.update({
        where: { id: c.sepId },
        data: { status: 'issued', sepNo: '0301R0031027V000123', issuedAt },
      }),
    );
    const coverage = await inA((tx) => tx.coverage.findUniqueOrThrow({ where: { id: c.coverageId } }));
    expect(coverage.lockedAt).not.toBeNull();
    await expect(
      inA((tx) => tx.coverage.update({ where: { id: c.coverageId }, data: { careClass: 'kelas_1' } })),
    ).rejects.toThrow(/COVERAGE_LOCKED/);

    // Isi SEP terbit tidak bisa diubah: oleh aplikasi (kolom yang diizinkan) maupun pemilik tabel (kolom lain).
    await expect(
      inA((tx) => tx.sep.update({ where: { id: c.sepId }, data: { lastErrorCode: '201' } })),
    ).rejects.toThrow(/SEP_FROZEN/);
    await expect(
      withTenant(owner, A, (tx) => tx.sep.update({ where: { id: c.sepId }, data: { diagnosisCode: 'I10' } })),
    ).rejects.toThrow(/SEP_FROZEN/);
    await expect(withTenant(owner, A, (tx) => tx.sep.delete({ where: { id: c.sepId } }))).rejects.toThrow(
      /SEP_FROZEN/,
    );

    // Koreksi = versi 2 dengan alasan; versi 1 hanya bisa digantikan sekali; tidak ada versi 1 kedua.
    const v2 = {
      tenantId: A,
      encounterId: c.encounterId,
      coverageId: c.coverageId,
      version: 2,
      supersedesId: c.sepId,
      correctionReason: 'Koreksi diagnosa awal sesuai pemeriksaan dokter',
      serviceType: 'rawat_jalan',
      diagnosisCode: 'I10',
    };
    await inA((tx) => tx.sep.create({ data: { id: newId(), ...v2 } }));
    await expect(inA((tx) => tx.sep.create({ data: { id: newId(), ...v2 } }))).rejects.toThrow(
      /Unique constraint/,
    );
    await expect(
      inA((tx) =>
        tx.sep.create({
          data: {
            id: newId(),
            tenantId: A,
            encounterId: c.encounterId,
            coverageId: c.coverageId,
            serviceType: 'rawat_jalan',
          },
        }),
      ),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      inA((tx) => tx.sep.create({ data: { id: newId(), ...v2, version: 3, correctionReason: null } })),
    ).rejects.toThrow(/seps_version_chain/);

    // Pembatalan dari terbit diizinkan (dengan alasan); sesudahnya beku seluruhnya.
    await inA((tx) =>
      tx.sep.update({
        where: { id: c.sepId },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Pasien batal berobat' },
      }),
    );
    await expect(
      inA((tx) => tx.sep.update({ where: { id: c.sepId }, data: { cancelReason: 'Alasan lain diganti' } })),
    ).rejects.toThrow(/SEP_FROZEN/);
  });

  it('SEP pending/gagal masih bisa diperbarui pengirim; terbit wajib nomor dan waktu', async () => {
    const c = await makeChain(A);
    await inA((tx) =>
      tx.sep.update({ where: { id: c.sepId }, data: { status: 'failed', lastErrorCode: '201' } }),
    );
    await inA((tx) =>
      tx.sep.update({ where: { id: c.sepId }, data: { status: 'pending', lastErrorCode: null } }),
    );
    await expect(
      inA((tx) => tx.sep.update({ where: { id: c.sepId }, data: { status: 'issued' } })),
    ).rejects.toThrow(/seps_lifecycle_valid/);
    // Penjaminan belum terkunci selama SEP belum terbit.
    await inA((tx) => tx.coverage.update({ where: { id: c.coverageId }, data: { careClass: 'kelas_1' } }));
  });
});

describe('celah kontrak 0a: Antrean JKN, SPRI/rujukan draf, penolakan SEP', () => {
  it('booking JKN wajib jenis kunjungan 1–4 + nomor referensi; non-JKN tanpa jenis kunjungan', async () => {
    const c = await makeChain(A);
    const base = await inA((tx) => tx.appointment.findUniqueOrThrow({ where: { id: c.appointmentId } }));
    const create = (data: Record<string, unknown>) =>
      inA((tx) =>
        tx.appointment.create({
          data: {
            id: newId(),
            tenantId: A,
            bookingCode: digits(10),
            patientId: base.patientId,
            sessionId: base.sessionId,
            practitionerId: base.practitionerId,
            serviceId: base.serviceId,
            // Tanggal berbeda tiap booking: satu booking aktif per pasien × layanan × tanggal.
            appointmentDate: day(nextDate()),
            channel: 'loket',
            quotaBucket: 'jkn',
            ...data,
          },
        }),
      );
    await expect(create({ jknVisitKind: null, referenceNumber: '0301U001' })).rejects.toThrow(
      /appointments_jkn_reference/,
    );
    await expect(create({ jknVisitKind: 1, referenceNumber: null })).rejects.toThrow(
      /appointments_jkn_reference/,
    );
    await expect(create({ jknVisitKind: 5, referenceNumber: '0301U001' })).rejects.toThrow(
      /appointments_jkn_reference/,
    );
    await expect(create({ quotaBucket: 'non_jkn', jknVisitKind: 1 })).rejects.toThrow(
      /appointments_jkn_reference/,
    );
    await create({ jknVisitKind: 4, referenceNumber: '0301R00310270001' });
    await create({ quotaBucket: 'non_jkn' });
  });

  it('satu booking aktif per pasien × layanan × tanggal (indeks unik parsial); batal membebaskan slotnya', async () => {
    const c = await makeChain(A);
    const base = await inA((tx) => tx.appointment.findUniqueOrThrow({ where: { id: c.appointmentId } }));
    const again = () =>
      inA((tx) =>
        tx.appointment.create({
          data: {
            id: newId(),
            tenantId: A,
            bookingCode: digits(10),
            patientId: base.patientId,
            sessionId: base.sessionId,
            practitionerId: base.practitionerId,
            serviceId: base.serviceId,
            appointmentDate: base.appointmentDate,
            channel: 'loket',
            quotaBucket: 'non_jkn',
          },
        }),
      );
    await expect(again()).rejects.toThrow(/Unique constraint/);
    await inA((tx) =>
      tx.appointment.update({
        where: { id: c.appointmentId },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Pasien batal' },
      }),
    );
    await again();
  });

  it('rujukan: SPRI dan draf pending tanpa nomor; nomor wajib selain pending dan tidak berubah setelah terisi', async () => {
    const c = await makeChain(A);
    const draft = (status: string) =>
      inA((tx) =>
        tx.referral.create({
          data: {
            id: newId(),
            tenantId: A,
            patientId: c.patientId,
            kind: 'spri',
            number: null,
            status,
            facilityName: 'RS ini',
            encounterId: c.encounterId,
            issuedOn: day('2027-06-01'),
          },
        }),
      );
    await expect(draft('active')).rejects.toThrow(/referrals_valid/);
    const r = await draft('pending');
    await inA((tx) =>
      tx.referral.update({ where: { id: r.id }, data: { number: '0301R0031027K000001', status: 'active' } }),
    );
    await expect(
      inA((tx) => tx.referral.update({ where: { id: r.id }, data: { number: '0301R0031027K000002' } })),
    ).rejects.toThrow(/REFERRAL_IMMUTABLE/);
    await expect(
      withTenant(owner, A, (tx) =>
        tx.referral.update({ where: { id: r.id }, data: { kind: 'surat-kontrol' } }),
      ),
    ).rejects.toThrow(/REFERRAL_IMMUTABLE/);
  });

  it('SEP: alasan penolakan hanya untuk status gagal', async () => {
    const c = await makeChain(A);
    await expect(
      inA((tx) =>
        tx.sep.update({ where: { id: c.sepId }, data: { rejectionReason: 'Peserta tidak aktif' } }),
      ),
    ).rejects.toThrow(/seps_rejection_valid/);
    await inA((tx) =>
      tx.sep.update({
        where: { id: c.sepId },
        data: { status: 'failed', lastErrorCode: '201', rejectionReason: 'Peserta tidak aktif' },
      }),
    );
    await inA((tx) =>
      tx.sep.update({ where: { id: c.sepId }, data: { status: 'pending', rejectionReason: null } }),
    );
  });
});

describe('panggilan antrean → NOTIFY', () => {
  it('payload hanya tenant_id + id, dikirim setelah commit', async () => {
    const c = await makeChain(A);
    const listener = new pg.Client({ connectionString: testDbUrls().migrator });
    await listener.connect();
    try {
      await listener.query('LISTEN queue_calls');
      const callId = newId();
      const received = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('NOTIFY tidak diterima')), 5000);
        listener.on('notification', (m) => {
          if (m.payload?.includes(callId)) {
            clearTimeout(timer);
            resolve(m.payload);
          }
        });
      });
      await inA((tx) =>
        tx.queueCall.create({ data: { id: callId, tenantId: A, ticketId: c.ticketId, action: 'recall' } }),
      );
      const payload = JSON.parse(await received) as Record<string, unknown>;
      expect(payload).toEqual({ tenant_id: A, id: callId });
    } finally {
      await listener.end();
    }
  });
});

describe('persetujuan umum per admisi', () => {
  it('rawat jalan (tanpa kunjungan) dan per kunjungan boleh aktif bersamaan; dua untuk kunjungan yang sama ditolak', async () => {
    const c = await makeChain(A);
    const consent = (encounterId: string | null) =>
      inA((tx) =>
        tx.privacyConsent.create({
          data: { id: newId(), tenantId: A, patientId: c.patientId, kind: 'umum', encounterId },
        }),
      );
    await consent(null);
    await consent(c.encounterId);
    await expect(consent(c.encounterId)).rejects.toThrow(/Unique constraint/);
  });
});

describe('isolasi tenant', () => {
  it('setiap tabel front office: RS lain tidak melihat barisnya, tidak bisa menulis atas namanya, tidak bisa merujuknya', async () => {
    const a = await makeChain(A);
    await makeChain(B);
    for (const table of FRONT_OFFICE_TABLES) {
      const t = Prisma.raw(table);
      const [own] = await withTenant(
        app,
        A,
        (tx) =>
          tx.$queryRaw<
            Array<{ n: number }>
          >`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = ${A}::uuid`,
      );
      expect(own?.n, `${table} berisi data uji`).toBeGreaterThan(0);
      const [leak] = await withTenant(
        app,
        B,
        (tx) =>
          tx.$queryRaw<
            Array<{ n: number }>
          >`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = ${A}::uuid`,
      );
      expect(leak?.n, `${table} bocor ke RS lain`).toBe(0);
    }
    // Menulis baris berlabel RS lain ditolak kebijakan RLS.
    await expect(
      withTenant(app, B, (tx) =>
        tx.queueCall.create({ data: { id: newId(), tenantId: A, ticketId: a.ticketId, action: 'call' } }),
      ),
    ).rejects.toThrow(/row-level security/);
    // FK komposit: booking di RS B tidak bisa merujuk sesi RS A.
    await expect(
      withTenant(app, B, async (tx) => {
        const r = await refs(tx);
        const p = await tx.patient.findFirstOrThrow({ where: { name: 'Pasien Uji Front Office' } });
        return tx.appointment.create({
          data: {
            id: newId(),
            tenantId: B,
            bookingCode: digits(10),
            patientId: p.id,
            sessionId: a.sessionId,
            practitionerId: r.practitioner.id,
            serviceId: r.service.id,
            appointmentDate: day(nextDate()),
            quotaBucket: 'jkn',
            jknVisitKind: 3,
            referenceNumber: `0301R${digits(14)}`,
            channel: 'loket',
          },
        });
      }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});
