/**
 * F04 · Antrean (rencana fase 2 potongan 4a): layanan, tiket, panggilan, lingkup unit klinisi, isolasi tenant, papan +
 * SSE display, dan mesin task ID BPJS dari event domain (bukan tombol). Tenant fiktif baru dengan seed front office;
 * event booking/registrasi diterbitkan controller uji (menirukan potongan 3 dan 5a).
 */
import type { AddressInfo } from 'node:net';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPrismaClient,
  type PrismaClient,
  seedFrontOffice,
  seedHospitalStructure,
  toDbDate,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { isoDateJakarta, newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantScoped } from '../src/common/tenant-scoped.decorator';
import { DomainEvents } from '../src/infra/events/domain-events';
import { QueueService } from '../src/modules/queue/queue.service';
import { QueueModule } from '../src/modules/queue/queue.module';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  type Tokens,
  testDb,
} from './helpers';

/** Menirukan modul booking (3) dan registrasi (5a): menerbitkan event di transaksi permintaan. */
@TenantScoped()
@Controller('test-queue')
class QueueEventsTestController {
  constructor(
    private readonly events: DomainEvents,
    private readonly queue: QueueService,
  ) {}

  @Post('checked-in')
  @HttpCode(200)
  async checkedIn(@Body() b: { appointmentId: string; patientId: string }) {
    return this.events.publish('booking.checked_in', b);
  }

  @Post('cancelled')
  @HttpCode(200)
  async cancelled(@Body() b: { appointmentId: string; patientId: string }) {
    return this.events.publish('booking.cancelled', b);
  }

  /** Registrasi walk-in: tiket loket ditautkan ke booking, lalu kunjungan terdaftar. */
  @Post('registered')
  @HttpCode(200)
  async registered(
    @Body()
    b: {
      appointmentId: string;
      patientId: string;
      unitId: string;
      ticketId?: string;
    },
  ) {
    if (b.ticketId) await this.queue.attachAppointment(b.ticketId, b.appointmentId);
    return this.events.publish('encounter.registered', {
      encounterId: newId(),
      patientId: b.patientId,
      encounterClass: 'amb',
      unitId: b.unitId,
      appointmentId: b.appointmentId,
      payer: 'bpjs',
    });
  }
}

let app: NestExpressApplication;
let port: number;
let owner: PrismaClient;
let T: { id: string; code: string };
let OTHER: { id: string; code: string };
const svc: Record<string, string> = {};
const unit: Record<string, string> = {};
let displayId: string;
let practitionerId: string;
let sessionId: string;
let patientId: string;
let registrar: Tokens;
let nursePd: Tokens;
let nurseJt: Tokens;
let otherRegistrar: Tokens;
const today = isoDateJakarta();

const http = () => request(app.getHttpServer());
const run = <R>(fn: Parameters<typeof withTenant<R>>[2]) => withTenant(testDb(), T.id, fn);

async function seedTenant(tenantId: string) {
  await withTenant(owner, tenantId, (tx) => seedHospitalStructure(tx, tenantId));
  await seedFrontOffice(owner, tenantId);
}

async function appointment(bucket: 'jkn' | 'non_jkn' = 'jkn') {
  const id = newId();
  await run((tx) =>
    tx.appointment.create({
      data: {
        id,
        tenantId: T.id,
        bookingCode: String(Math.floor(Math.random() * 9e9) + 1e9),
        patientId,
        sessionId,
        practitionerId,
        serviceId: svc.PD!,
        appointmentDate: toDbDate(today),
        quotaBucket: bucket,
        channel: 'loket',
        ...(bucket === 'jkn' ? { jknVisitKind: 1, referenceNumber: '9999P0011025Y000001' } : {}),
      },
    }),
  );
  return id;
}

const tasks = (appointmentId: string) =>
  run((tx) =>
    tx.bpjsQueueTask.findMany({
      where: { appointmentId },
      orderBy: { taskId: 'asc' },
      include: { appointment: { select: { id: true } } },
    }),
  );

async function issue(code: string, body: Record<string, unknown> = {}, tokens = registrar) {
  const res = await http()
    .post(`/api/v1/queue/services/${svc[code]}/tickets`)
    .set(bearer(tokens))
    .send(body)
    .expect(201);
  return res.body as { id: string; queueNo: string; status: string; issuedAt: string };
}

const callNext = (code: string, counter: string, tokens = registrar) =>
  http().post(`/api/v1/queue/services/${svc[code]}/call-next`).set(bearer(tokens)).send({ counter });

const act = (ticketId: string, action: string, tokens = registrar, body: Record<string, unknown> = {}) =>
  http().post(`/api/v1/queue/tickets/${ticketId}/${action}`).set(bearer(tokens)).send(body);

beforeAll(async () => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  app = await createTestApp(
    {},
    {
      imports: [
        {
          module: class QueueTestModule {},
          imports: [QueueModule],
          controllers: [QueueEventsTestController],
        },
      ],
    },
  );
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;

  T = await createTestTenant();
  OTHER = await createTestTenant();
  await seedTenant(T.id);
  await seedTenant(OTHER.id);
  await run(async (tx) => {
    for (const s of await tx.queueService.findMany({ select: { id: true, code: true, unitId: true } })) {
      svc[s.code] = s.id;
      if (s.unitId) unit[s.code] = s.unitId;
    }
    displayId = (await tx.queueDisplay.findFirstOrThrow({ where: { code: 'RJ-LT2' } })).id;
    practitionerId = newId();
    await tx.practitioner.create({
      data: { id: practitionerId, tenantId: T.id, name: 'dr. Uji Antrean, Sp.PD' },
    });
    sessionId = newId();
    await tx.scheduleSession.create({
      data: {
        id: sessionId,
        tenantId: T.id,
        practitionerId,
        serviceId: svc.PD!,
        sessionDate: toDbDate(today),
        startTime: new Date('1970-01-01T00:00:00Z'),
        endTime: new Date('1970-01-01T23:59:00Z'),
        quotaJkn: 50,
        quotaNonJkn: 10,
      },
    });
  });
  patientId = (await createTestPatient(T.id)).id;

  const [r, np, nj, o] = await Promise.all([
    createTestUser(T.id, { roles: [{ code: 'petugas_pendaftaran' }], tenantCode: T.code }),
    createTestUser(T.id, { roles: [{ code: 'perawat', unitId: unit.PD }], tenantCode: T.code }),
    createTestUser(T.id, { roles: [{ code: 'perawat', unitId: unit.JT }], tenantCode: T.code }),
    createTestUser(OTHER.id, { roles: [{ code: 'petugas_pendaftaran' }], tenantCode: OTHER.code }),
  ]);
  registrar = await login(app, r);
  nursePd = await login(app, np);
  nurseJt = await login(app, nj);
  otherRegistrar = await login(app, o);
});

afterAll(async () => {
  await app?.close();
  await owner?.$disconnect();
});

describe('layanan dan tiket', () => {
  it('petugas pendaftaran melihat semua layanan; perawat poli hanya layanan unitnya', async () => {
    const all = await http().get('/api/v1/queue/services').set(bearer(registrar)).expect(200);
    expect((all.body as Array<{ code: string }>).map((s) => s.code).sort()).toEqual(
      ['A', 'F', 'JT', 'PD', 'PR', 'SR'].sort(),
    );
    const pd = await http().get('/api/v1/queue/services').set(bearer(nursePd)).expect(200);
    expect((pd.body as Array<{ code: string }>).map((s) => s.code)).toEqual(['PD']);
  });

  it('tiket bernomor <kode>-<3 digit>; panggil berikutnya FIFO; kosong → 409 QUEUE_EMPTY', async () => {
    const a1 = await issue('SR');
    const a2 = await issue('SR');
    expect(a1.queueNo).toMatch(/^SR-\d{3}$/);
    expect(Number(a2.queueNo.slice(3))).toBe(Number(a1.queueNo.slice(3)) + 1);

    const c1 = await callNext('SR', 'Ruang 5').expect(200);
    expect(c1.body.ticket).toMatchObject({ id: a1.id, status: 'called', counter: 'Ruang 5', callCount: 1 });
    expect(c1.body.call).toMatchObject({ action: 'call', counter: 'Ruang 5', queueNo: a1.queueNo });
    const c2 = await callNext('SR', 'Ruang 5').expect(200);
    expect(c2.body.ticket.id).toBe(a2.id);
    const empty = await callNext('SR', 'Ruang 5').expect(409);
    expect(empty.body.code).toBe('QUEUE_EMPTY');

    const list = await http()
      .get(`/api/v1/queue/services/${svc.SR}/tickets`)
      .set(bearer(registrar))
      .expect(200);
    expect((list.body as Array<{ id: string }>).map((t) => t.id)).toEqual(
      expect.arrayContaining([a1.id, a2.id]),
    );
  });

  it('transisi: ulang, lewati, panggil lagi = ulang, mulai, selesai; transisi salah → 409', async () => {
    const t = await issue('SR');
    await act(t.id, 'call', registrar, { counter: 'Ruang 5' }).expect(200);
    const again = await act(t.id, 'recall', registrar, { counter: 'Ruang 5' }).expect(200);
    expect(again.body.call.action).toBe('recall');
    expect(again.body.ticket.callCount).toBe(2);
    await act(t.id, 'skip', registrar, { reason: 'tidak hadir' }).expect(200);
    const back = await act(t.id, 'call', registrar, { counter: 'Ruang 5' }).expect(200);
    expect(back.body.call.action).toBe('recall');
    const bad = await act(t.id, 'finish').expect(409);
    expect(bad.body.code).toBe('TICKET_STATE_INVALID');
    const started = await act(t.id, 'start').expect(200);
    expect(started.body.ticket).toMatchObject({ status: 'serving', counter: 'Ruang 5' });
    expect(started.body.call).toMatchObject({ action: 'start', counter: 'Ruang 5' });
    const done = await act(t.id, 'finish').expect(200);
    expect(done.body.ticket.status).toBe('done');
    expect(done.body.ticket.startedAt).not.toBeNull();
    expect(done.body.ticket.finishedAt).not.toBeNull();
    const calls = await run((tx) =>
      tx.queueCall.findMany({ where: { ticketId: t.id }, orderBy: { id: 'asc' } }),
    );
    expect(calls.map((c) => c.action)).toEqual(['call', 'recall', 'skip', 'recall', 'start', 'finish']);
  });

  it('nomor cadangan booking dilewati "panggil berikutnya" tetapi bisa dipanggil petugas poli', async () => {
    const reserved = await issue('PR');
    await run((tx) => tx.queueTicket.update({ where: { id: reserved.id }, data: { reserved: true } }));
    const normal = await issue('PR');
    const next = await callNext('PR', 'Ruang 6').expect(200);
    expect(next.body.ticket.id).toBe(normal.id);
    await callNext('PR', 'Ruang 6').expect(409);
    const direct = await act(reserved.id, 'call', registrar, { counter: 'Ruang 6' }).expect(200);
    expect(direct.body.ticket).toMatchObject({ reserved: true, status: 'called' });
  });

  it('aksi pada tiket berpasien diaudit (tanpa PHI di detail)', async () => {
    const t = await issue('SR', { appointmentId: await appointment('non_jkn') });
    await act(t.id, 'call', registrar, { counter: 'Ruang 5' }).expect(200);
    const audits = await run((tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'queue_ticket', resourceId: t.id },
        orderBy: { occurredAt: 'asc' },
      }),
    );
    expect(audits.map((a) => a.action)).toEqual(['create', 'update']);
    expect(audits.every((a) => a.patientId === patientId)).toBe(true);
    expect(audits[1]?.details).toEqual({ queueAction: 'call', serviceCode: 'SR' });
  });
});

describe('izin dan isolasi', () => {
  it('perawat poli lain: 403 (tercatat access_denied) untuk melihat dan memanggil antrean PD', async () => {
    const t = await issue('PD');
    const list = await http()
      .get(`/api/v1/queue/services/${svc.PD}/tickets`)
      .set(bearer(nurseJt))
      .expect(403);
    expect(list.body.code).toBe('FORBIDDEN');
    await act(t.id, 'call', nurseJt, { counter: 'Ruang 4' }).expect(403);
    await callNext('PD', 'Ruang 4', nurseJt).expect(403);
    const denied = await run((tx) =>
      tx.auditEvent.count({
        where: { action: 'access_denied', resourceType: 'queue_service', resourceId: svc.PD },
      }),
    );
    expect(denied).toBeGreaterThanOrEqual(3);
    // Perawat PD boleh memanggil antrean unitnya; petugas pendaftaran (lingkup semua) juga.
    const ok = await act(t.id, 'call', nursePd, { counter: 'Ruang 2' }).expect(200);
    expect(ok.body.ticket.status).toBe('called');
  });

  it('status task BPJS butuh queue.read; pembacaannya diaudit dengan pasien booking', async () => {
    const appt = await appointment();
    await http().get(`/api/v1/queue/bpjs-tasks?appointmentId=${appt}`).set(bearer(nursePd)).expect(200);
    const audit = await run((tx) =>
      tx.auditEvent.findFirstOrThrow({ where: { resourceType: 'bpjs_queue_task', resourceId: appt } }),
    );
    expect(audit).toMatchObject({ action: 'read', patientId });
  });

  it('tenant lain tidak melihat layanan, tiket, maupun display tenant ini', async () => {
    const t = await issue('SR');
    await http().get(`/api/v1/queue/services/${svc.SR}/tickets`).set(bearer(otherRegistrar)).expect(404);
    await act(t.id, 'call', otherRegistrar, { counter: 'Ruang 5' }).expect(404);
    await http().get(`/api/v1/queue/displays/${displayId}/board`).set(bearer(otherRegistrar)).expect(404);
    const theirs = await http().get('/api/v1/queue/services').set(bearer(otherRegistrar)).expect(200);
    expect((theirs.body as Array<{ id: string }>).map((s) => s.id)).not.toContain(svc.SR);
  });
});

describe('papan dan SSE display', () => {
  it('papan: poli display, panggilan terakhir + riwayat, menunggu dan cadangan', async () => {
    const w1 = await issue('JT');
    const w2 = await issue('JT');
    const called = await act(w1.id, 'call', registrar, { counter: 'Ruang 4' }).expect(200);
    const res = await http()
      .get(`/api/v1/queue/displays/${displayId}/board`)
      .set(bearer(registrar))
      .expect(200);
    expect(res.body.area).toBe('Rawat Jalan Lantai 2');
    expect(res.body.clinics.map((c: { poliCode: string }) => c.poliCode)).toEqual(['PD', 'JT', 'SR', 'PR']);
    expect(res.body.calling).toEqual({ queueNo: called.body.ticket.queueNo, poliCode: 'JT' });
    const jt = res.body.clinics.find((c: { poliCode: string }) => c.poliCode === 'JT');
    expect(jt.current).toBe(w1.queueNo);
    expect(jt.waiting).toContain(w2.queueNo);
    const pd = res.body.clinics.find((c: { poliCode: string }) => c.poliCode === 'PD');
    expect(pd.doctorName).toBe('dr. Uji Antrean, Sp.PD');
  });

  it('SSE menerima panggilan layanan display secara real-time; layanan lain (loket A) tidak', async () => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/queue/displays/${displayId}/events`, {
      headers: bearer(registrar),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const frames: Array<{ id?: string; event?: string; data?: { queueNo?: string; counter?: string } }> = [];
    void (async () => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const f: (typeof frames)[number] = {};
            for (const line of raw.split('\n')) {
              if (line.startsWith('id: ')) f.id = line.slice(4);
              else if (line.startsWith('event: ')) f.event = line.slice(7);
              else if (line.startsWith('data: ')) f.data = JSON.parse(line.slice(6));
            }
            frames.push(f);
          }
        }
      } catch {
        // dibatalkan
      }
    })();
    try {
      // Tunggu LISTEN aktif sebelum memanggil.
      await new Promise((r) => setTimeout(r, 500));
      const loket = await issue('A');
      await act(loket.id, 'call', registrar, { counter: 'Loket 1' }).expect(200);
      const poli = await issue('PD');
      const call = await act(poli.id, 'call', registrar, { counter: 'Ruang 2' }).expect(200);
      const until = Date.now() + 5000;
      while (!frames.some((f) => f.event === 'queue.call') && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const calls = frames.filter((f) => f.event === 'queue.call');
      expect(calls).toEqual([
        {
          id: call.body.call.id,
          event: 'queue.call',
          data: expect.objectContaining({ queueNo: poli.queueNo, counter: 'Ruang 2', recall: false }),
        },
      ]);
    } finally {
      controller.abort();
    }
  });
});

describe('mesin task ID BPJS (dari event domain)', () => {
  async function events(appointmentId: string) {
    return run((tx) =>
      tx.domainEvent.findMany({
        orderBy: { occurredAt: 'asc' },
        where: { payload: { path: ['appointmentId'], equals: appointmentId } },
      }),
    );
  }

  it('booking: check-in → 1, panggilan pertama loket → 2 (ulang tidak), terdaftar → 3, poli mulai/selesai → 4/5', async () => {
    const appt = await appointment();
    await http()
      .post('/api/v1/test-queue/checked-in')
      .set(bearer(registrar))
      .send({ appointmentId: appt, patientId })
      .expect(200);
    const loket = await issue('A', { appointmentId: appt });
    await act(loket.id, 'call', registrar, { counter: 'Loket 2' }).expect(200);
    await act(loket.id, 'recall', registrar, { counter: 'Loket 2' }).expect(200);
    await http()
      .post('/api/v1/test-queue/registered')
      .set(bearer(registrar))
      .send({ appointmentId: appt, patientId, unitId: unit.PD })
      .expect(200);
    const poli = await issue('PD', { appointmentId: appt });
    await act(poli.id, 'call', nursePd, { counter: 'Ruang 2' }).expect(200);
    await act(poli.id, 'start', nursePd).expect(200);
    await act(poli.id, 'finish', nursePd).expect(200);

    const rows = await tasks(appt);
    expect(rows.map((r) => r.taskId)).toEqual([1, 2, 3, 4, 5]);
    // Waktu task = waktu event domain (ms), bukan waktu kirim.
    const evs = await events(appt);
    const at = (name: string, filter: (p: Record<string, unknown>) => boolean = () => true) =>
      evs.find((e) => e.name === name && filter(e.payload as Record<string, unknown>))?.occurredAt.getTime();
    expect(rows.map((r) => r.occurredAt.getTime())).toEqual([
      at('booking.checked_in'),
      at('queue.ticket_called', (p) => p.recall === false && p.serviceKind === 'loket'),
      at('encounter.registered'),
      at('queue.ticket_started'),
      at('queue.ticket_finished'),
    ]);
    // Tiap task → satu pesan outbox updatewaktu (payload ID saja), terurut.
    const messages = await run((tx) =>
      tx.outboxMessage.findMany({
        where: { id: { in: rows.map((r) => r.outboxMessageId!) } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(messages.map((m) => m.payload)).toEqual(rows.map((r) => ({ queueTaskId: r.id })));
    expect(messages.every((m) => m.operation === 'bpjs.antrean.updatewaktu' && m.target === 'bpjs')).toBe(
      true,
    );

    const view = await http()
      .get(`/api/v1/queue/bpjs-tasks?appointmentId=${appt}`)
      .set(bearer(registrar))
      .expect(200);
    expect(view.body.map((t: { taskId: number }) => t.taskId)).toEqual([1, 2, 3, 4, 5]);
    expect(view.body[0]).toMatchObject({
      appointmentId: appt,
      sync: { status: 'pending', sentAt: null, error: null },
    });
  });

  it('walk-in: tiket loket tanpa booking → tidak ada task; setelah tertaut + terdaftar → 1 (ambil tiket), 2 (panggil), 3', async () => {
    const loket = await issue('A');
    await act(loket.id, 'call', registrar, { counter: 'Loket 1' }).expect(200);
    const appt = await appointment();
    expect(await tasks(appt)).toEqual([]);
    await http()
      .post('/api/v1/test-queue/registered')
      .set(bearer(registrar))
      .send({ appointmentId: appt, patientId, unitId: unit.PD, ticketId: loket.id })
      .expect(200);
    const rows = await tasks(appt);
    expect(rows.map((r) => r.taskId)).toEqual([1, 2, 3]);
    const firstCall = await run((tx) =>
      tx.queueCall.findFirstOrThrow({ where: { ticketId: loket.id, action: 'call' } }),
    );
    expect(rows[0]?.occurredAt.toISOString()).toBe(loket.issuedAt);
    expect(rows[1]?.occurredAt.getTime()).toBe(firstCall.calledAt.getTime());
    expect(rows[2]!.occurredAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.occurredAt.getTime());
  });

  it('non-JKN tidak membentuk task; batal → 99 dan tidak ada task sesudahnya; waktu tidak ditimpa', async () => {
    const nonJkn = await appointment('non_jkn');
    await http()
      .post('/api/v1/test-queue/checked-in')
      .set(bearer(registrar))
      .send({ appointmentId: nonJkn, patientId })
      .expect(200);
    expect(await tasks(nonJkn)).toEqual([]);

    const appt = await appointment();
    await http()
      .post('/api/v1/test-queue/checked-in')
      .set(bearer(registrar))
      .send({ appointmentId: appt, patientId })
      .expect(200);
    const first = (await tasks(appt))[0]!;
    await http()
      .post('/api/v1/test-queue/checked-in')
      .set(bearer(registrar))
      .send({ appointmentId: appt, patientId })
      .expect(200);
    expect((await tasks(appt)).map((r) => [r.taskId, r.occurredAt.getTime()])).toEqual([
      [1, first.occurredAt.getTime()],
    ]);
    await http()
      .post('/api/v1/test-queue/cancelled')
      .set(bearer(registrar))
      .send({ appointmentId: appt, patientId })
      .expect(200);
    await http()
      .post('/api/v1/test-queue/registered')
      .set(bearer(registrar))
      .send({ appointmentId: appt, patientId, unitId: unit.PD })
      .expect(200);
    expect((await tasks(appt)).map((r) => r.taskId)).toEqual([1, 99]);
  });
});
