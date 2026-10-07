/**
 * Event domain sinkron di dalam transaksi penerbit (infra/events): urutan, atomisitas, pendaftaran, dan penjaga.
 */
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type TenantTx, withTenant } from '@simrs/db';
import { AppError, isUuidV7, newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoRequestTransaction } from '../src/common/no-request-transaction.decorator';
import { requestContext, type TenantRequestContext } from '../src/common/request-context';
import { TenantScoped } from '../src/common/tenant-scoped.decorator';
import { DOMAIN_EVENT_NAMES, type DomainEventName } from '../src/infra/events/domain-event-map';
import { type DomainEvent, DomainEvents, MAX_DOMAIN_EVENT_DEPTH } from '../src/infra/events/domain-events';
import { TenantDb } from '../src/infra/tenant-db';
import { createTestApp, TENANT_A, TENANT_B, testDb } from './helpers';

/** Transaksi palsu: mencatat baris `domain_events` yang akan disimpan (cukup untuk logika penerbit, tanpa DB). */
function fakeTx(stored: unknown[] = []) {
  return { domainEvent: { create: async (args: { data: unknown }) => void stored.push(args.data) } };
}

/** Konteks permintaan tiruan dengan transaksi palsu. */
function fakeContext(tx: object | null = fakeTx()): TenantRequestContext {
  return {
    tenantId: TENANT_A,
    tx: tx as TenantTx | null,
    actor: { userId: null, role: 'dev', sessionId: null, unitId: null },
    requestId: null,
    ip: null,
    userAgent: null,
    permissionScope: null,
    audit: [],
    afterCommit: [],
  };
}

const payload = { appointmentId: newId(), patientId: newId() };
/** Payload tiket poli (kontrak `@simrs/shared`). */
const ticketPayload = () => ({
  ticketId: newId(),
  queueServiceId: newId(),
  serviceKind: 'poli' as const,
  appointmentId: null,
  encounterId: null,
});

describe('DomainEvents (unit)', () => {
  it('menjalankan penangan berurutan dengan transaksi yang sama dan amplop event lengkap', async () => {
    const events = new DomainEvents();
    const seen: string[] = [];
    const stored: unknown[] = [];
    const tx = fakeTx(stored);
    let received: DomainEvent<'booking.checked_in'> | undefined;
    events.on('booking.checked_in', async (e, ctx) => {
      await new Promise((r) => setTimeout(r, 5));
      // Event sudah disimpan sebelum penangan pertama berjalan.
      seen.push(`first:${ctx.tx === (tx as object)}:${ctx.tenantId}:${stored.length}`);
      received = e;
    });
    events.on('booking.checked_in', () => void seen.push('second'), { label: 'kedua' });
    events.on('queue.ticket_called', () => void seen.push('other'));

    const published = await requestContext.run(fakeContext(tx), () =>
      events.publish('booking.checked_in', payload),
    );
    expect(seen).toEqual([`first:true:${TENANT_A}:1`, 'second']);
    expect(stored).toEqual([
      {
        id: published.id,
        tenantId: TENANT_A,
        name: 'booking.checked_in',
        payload,
        occurredAt: published.occurredAt,
        requestId: null,
        actorUserId: null,
        actorDeviceId: null,
      },
    ]);
    expect(received).toBe(published);
    expect(isUuidV7(published.id)).toBe(true);
    expect(published).toMatchObject({ name: 'booking.checked_in', tenantId: TENANT_A, payload });
    expect(published.actor).toEqual({ userId: null, role: 'dev' });
    expect(Object.isFrozen(published.payload)).toBe(true);
    expect(events.handlerLabels('booking.checked_in')).toEqual(['anonim', 'kedua']);
  });

  it('payload hanya ID atau nilai enum: teks bebas, ID bukan UUID, dan objek bersarang ditolak sebelum disimpan', async () => {
    const events = new DomainEvents();
    const stored: unknown[] = [];
    const publish = (p: object) =>
      requestContext.run(fakeContext(fakeTx(stored)), () =>
        events.publish('booking.checked_in', p as { appointmentId: string; patientId: string }),
      );
    for (const bad of [
      { appointmentId: newId(), patientId: 'Siti Rahmawati' },
      { appointmentId: newId(), patientId: newId(), patientName: 'Siti Rahmawati' },
      { appointmentId: newId(), patientId: newId(), note: 'Pasien alergi penisilin' },
      { appointmentId: newId(), patientId: newId(), detail: { nik: '9999015403720001' } },
      { appointmentId: newId(), patientId: newId(), ticketIds: ['A-031'] },
    ]) {
      await expect(publish(bad)).rejects.toThrow(/tanpa PHI/);
    }
    expect(stored).toEqual([]);
    await publish({
      appointmentId: newId(),
      patientId: newId(),
      channel: 'mobile_jkn',
      taskId: null,
      count: 2,
      reserved: true,
      ticketIds: [newId()],
    });
    expect(stored).toHaveLength(1);
  });

  it('di luar transaksi → galat program', async () => {
    const events = new DomainEvents();
    await expect(events.publish('sep.issued', { sepId: newId(), encounterId: newId() })).rejects.toThrow(
      /di luar transaksi/,
    );
    await expect(
      requestContext.run(fakeContext(null), () =>
        events.publish('sep.issued', { sepId: newId(), encounterId: newId() }),
      ),
    ).rejects.toThrow(/di luar transaksi/);
  });

  it('penangan gagal → galat diteruskan apa adanya, penangan berikutnya tidak jalan', async () => {
    const events = new DomainEvents();
    const seen: string[] = [];
    events.on('encounter.cancelled', () => {
      throw new AppError('CONFLICT', 'ditolak', 409);
    });
    events.on('encounter.cancelled', () => void seen.push('after'));
    const run = requestContext.run(fakeContext(), () =>
      events.publish('encounter.cancelled', {
        encounterId: newId(),
        patientId: newId(),
        appointmentId: null,
      }),
    );
    await expect(run).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(seen).toEqual([]);
  });

  it('pelepas pendaftaran bekerja; nama tak dikenal ditolak; rantai siklik dihentikan', async () => {
    const events = new DomainEvents();
    let count = 0;
    const off = events.on('queue.ticket_started', () => void (count += 1));
    off();
    await requestContext.run(fakeContext(), () => events.publish('queue.ticket_started', ticketPayload()));
    expect(count).toBe(0);
    expect(() => events.on('tidak.ada' as DomainEventName, () => undefined)).toThrow(/tidak dikenal/);

    let depth = 0;
    events.on('queue.ticket_finished', async (e) => {
      depth += 1;
      await events.publish('queue.ticket_finished', e.payload);
    });
    const run = requestContext.run(fakeContext(), () =>
      events.publish('queue.ticket_finished', ticketPayload()),
    );
    await expect(run).rejects.toThrow(/melebihi/);
    expect(depth).toBe(MAX_DOMAIN_EVENT_DEPTH);
  });

  it('daftar nama dari kontrak bersama 0a (+ booking.cancelled untuk task 99) dan fase 3 §3.0a', () => {
    expect([...DOMAIN_EVENT_NAMES].sort()).toEqual(
      [
        'booking.cancelled',
        'booking.checked_in',
        'encounter.cancelled',
        'encounter.registered',
        'queue.ticket_called',
        'queue.ticket_finished',
        'queue.ticket_started',
        'sep.issued',
        'encounter.started',
        'encounter.finished',
        'cppt.finalized',
        'order.activated',
        'order.cancelled',
        'medication.administered',
        'adt.admitted',
        'adt.transferred',
        'adt.discharged',
        'bed.status_changed',
        'discharge.signed',
        'consent.signed',
        // Fase 4 · penunjang
        'lab.order_accepted',
        'lab.specimen_received',
        'lab.specimen_rejected',
        'lab.result_released',
        'lab.result_corrected',
        'lab.test_voided',
        'critical_result.raised',
        'critical_result.reported',
        'critical_result.escalated',
        'radiology.exam_completed',
        'radiology.report_signed',
        'pharmacy.service_started',
        'pharmacy.dispensed',
        'pharmacy.returned',
        'stock.received',
        'stock.adjusted',
        'stock.transferred',
        'surgery.case_scheduled',
        'surgery.incision_recorded',
        'surgery.case_completed',
        'surgery.case_cancelled',
        'blood.unit_issued',
        'diagnostic.report_signed',
        'micro.report_released',
        'pa.report_signed',
      ].sort(),
    );
  });
});

/** Patokan uji: penangan menolak pasien ini → seluruh permintaan batal. */
const REJECTED_PATIENT = newId();

@TenantScoped()
@Controller('test-infra/events')
class EventsTestController {
  constructor(
    private readonly events: DomainEvents,
    private readonly db: TenantDb,
  ) {}

  @Post('check-in')
  @HttpCode(200)
  async checkIn(@Body() body: { appointmentId: string; patientId: string }) {
    await this.db.tx().auditEvent.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        action: 'update',
        resourceType: 'test_booking',
        resourceId: body.appointmentId,
      },
    });
    const event = await this.events.publish('booking.checked_in', body);
    return { eventId: event.id };
  }

  @NoRequestTransaction()
  @Post('check-in-short')
  @HttpCode(200)
  async checkInShort(@Body() body: { appointmentId: string; patientId: string }) {
    const event = await this.db.transaction(() => this.events.publish('booking.checked_in', body));
    return { eventId: event.id };
  }

  @NoRequestTransaction()
  @Post('check-in-without-transaction')
  @HttpCode(200)
  async checkInWithoutTransaction(@Body() body: { appointmentId: string; patientId: string }) {
    await this.events.publish('booking.checked_in', body);
  }
}

describe('DomainEvents (HTTP + DB)', () => {
  let app: NestExpressApplication;
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/test-infra/events/${path}`)
      .set('X-Tenant-Id', TENANT_A)
      .send(body);
  const storedEvents = (tenantId: string, appointmentId: string) =>
    withTenant(testDb(), tenantId, (tx) =>
      tx.domainEvent.findMany({
        where: { payload: { path: ['appointmentId'], equals: appointmentId } },
        select: {
          id: true,
          name: true,
          payload: true,
          requestId: true,
          actorUserId: true,
          actorDeviceId: true,
        },
      }),
    );
  const rows = (resourceId: string) =>
    withTenant(testDb(), TENANT_A, (tx) =>
      tx.auditEvent.findMany({
        where: { resourceId },
        orderBy: { seq: 'asc' },
        select: { resourceType: true, details: true },
      }),
    );

  beforeAll(async () => {
    app = await createTestApp(
      {},
      { imports: [{ module: class EventsTestModule {}, controllers: [EventsTestController] }] },
    );
    // Seperti mesin task ID (potongan 4a): bereaksi di transaksi yang sama dengan check-in.
    app.get(DomainEvents).on(
      'booking.checked_in',
      async (e, { tx, tenantId }) => {
        if (e.payload.patientId === REJECTED_PATIENT) throw new AppError('CONFLICT', 'Ditolak penangan', 409);
        await tx.auditEvent.create({
          data: {
            id: newId(),
            tenantId,
            action: 'create',
            resourceType: 'test_task',
            resourceId: e.payload.appointmentId,
            details: { eventId: e.id },
          },
        });
      },
      { label: 'test.task-id' },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tulisan penerbit dan penangan commit bersama', async () => {
    const appointmentId = newId();
    const res = await post('check-in', { appointmentId, patientId: newId() }).expect(200);
    expect(await rows(appointmentId)).toEqual([
      { resourceType: 'test_booking', details: null },
      { resourceType: 'test_task', details: { eventId: res.body.eventId } },
    ]);
  });

  it('event tersimpan di domain_events bersama permintaan (id = id event, request ID tercatat)', async () => {
    const appointmentId = newId();
    const patientId = newId();
    const res = await post('check-in', { appointmentId, patientId })
      .set('X-Request-Id', 'uji-event-1')
      .expect(200);
    const stored = await storedEvents(TENANT_A, appointmentId);
    expect(stored).toEqual([
      {
        id: res.body.eventId,
        name: 'booking.checked_in',
        payload: { appointmentId, patientId },
        requestId: expect.any(String),
        actorUserId: null,
        actorDeviceId: null,
      },
    ]);
  });

  it('permintaan batal → baris event ikut batal; RS lain tidak melihat event; event tidak bisa diubah/dihapus', async () => {
    const rejected = newId();
    await post('check-in', { appointmentId: rejected, patientId: REJECTED_PATIENT }).expect(409);
    expect(await storedEvents(TENANT_A, rejected)).toEqual([]);

    const appointmentId = newId();
    await post('check-in', { appointmentId, patientId: newId() }).expect(200);
    expect(await storedEvents(TENANT_A, appointmentId)).toHaveLength(1);
    expect(await storedEvents(TENANT_B, appointmentId)).toEqual([]);
    await expect(
      withTenant(
        testDb(),
        TENANT_A,
        (tx) => tx.$executeRaw`DELETE FROM domain_events WHERE payload->>'appointmentId' = ${appointmentId}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(
        testDb(),
        TENANT_A,
        (tx) =>
          tx.$executeRaw`UPDATE domain_events SET name = 'sep.issued' WHERE payload->>'appointmentId' = ${appointmentId}`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('penangan gagal → seluruh permintaan batal (tulisan penerbit ikut batal)', async () => {
    const appointmentId = newId();
    const res = await post('check-in', { appointmentId, patientId: REJECTED_PATIENT });
    expect(res.status).toBe(409);
    expect(await rows(appointmentId)).toEqual([]);
  });

  it('handler @NoRequestTransaction menerbitkan di dalam TenantDb.transaction(); tanpa transaksi → 500', async () => {
    const appointmentId = newId();
    const res = await post('check-in-short', { appointmentId, patientId: newId() }).expect(200);
    expect(await rows(appointmentId)).toEqual([
      { resourceType: 'test_task', details: { eventId: res.body.eventId } },
    ]);

    const orphan = newId();
    await post('check-in-without-transaction', { appointmentId: orphan, patientId: newId() }).expect(500);
    expect(await rows(orphan)).toEqual([]);
  });
});
