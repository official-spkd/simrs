import { dbDateFromIso, hhmmFromDbTime, type OutboxMessage, type TenantTx } from '@simrs/db';
import {
  BPJS_HFIS_UPDATE_OPERATION,
  bpjsPath,
  HFIS_ENDPOINTS,
  hfisJadwalDokterResponseSchema,
  type HfisPullSnapshot,
  type HfisPushSnapshot,
  type HfisUpdateJadwalRequest,
  isoDateJakarta,
  newId,
  outboxKey,
  parseFrontOfficePayload,
} from '@simrs/shared';
import { type BpjsRejection, defineBpjsOperation } from './bpjs-operation';
import { PermanentOperationError } from './operation-types';

/**
 * F01 · Operasi outbox HFIS (jadwal dokter lewat layanan Antrean BPJS):
 * - `bpjs.hfis.update`: kirim templat mingguan aktif dokter × poli (`updatejadwaldokter`). Revisi lama dilewati bila
 *   revisi lebih baru sudah diantrekan. Templat dibaca saat dikirim (payload hanya ID + revisi).
 * - `bpjs.hfis.pull`: tarik jadwal satu poli satu tanggal → `hfis_schedule_snapshots` arah `pull` (bahan perbandingan
 *   RS vs HFIS di API). "Jadwal tidak ditemukan" = tidak ada dokter praktik hari itu (snapshot kosong).
 * Cuti/libur per tanggal dan kapasitas tidak bisa dikirim lewat web service: dicatat petugas di aplikasi HFIS.
 * Tanpa PHI: respons tidak memuat data pasien (`sensitive: false`).
 */

function parsePayload<O extends 'bpjs.hfis.update' | 'bpjs.hfis.pull'>(op: O, payload: unknown) {
  try {
    return parseFrontOfficePayload(op, payload);
  } catch {
    throw new PermanentOperationError(`Payload ${op} tidak dikenali`);
  }
}

async function externalCode(tx: TenantTx, entity: string, entityId: string, system: string) {
  const row = await tx.externalId.findFirst({
    where: { entity, entityId, system, active: true },
    select: { value: true },
  });
  return row?.value ?? null;
}

/** Penolakan BPJS dicatat di jejak audit (pelaku `system`, tanpa PHI) agar terlihat petugas, bukan DLQ. */
async function auditRejection(tx: TenantTx, msg: OutboxMessage, rejection: BpjsRejection) {
  await tx.auditEvent.create({
    data: {
      id: newId(),
      tenantId: msg.tenantId,
      actorRole: 'system',
      resourceType: 'hfis_schedule',
      resourceId: msg.id,
      action: 'export',
      outcome: 'denied',
      details: { operation: msg.operation, rejection: rejection.code, bpjsCode: rejection.bpjsCode },
    },
  });
}

/** Templat aktif yang berlaku hari ini → jadwal HFIS (`hari` 1–7, jam `HH:MM`), urut hari lalu jam. */
async function weeklyTemplate(tx: TenantTx, practitionerId: string, serviceId: string, today: string) {
  const rows = await tx.practitionerSchedule.findMany({
    where: {
      practitionerId,
      serviceId,
      active: true,
      validFrom: { lte: dbDateFromIso(today) },
      OR: [{ validUntil: null }, { validUntil: { gte: dbDateFromIso(today) } }],
    },
    select: { weekday: true, startTime: true, endTime: true },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  return rows.map((r) => ({
    hari: String(r.weekday),
    buka: hhmmFromDbTime(r.startTime),
    tutup: hhmmFromDbTime(r.endTime),
  }));
}

export const bpjsHfisUpdate = defineBpjsOperation({
  sensitive: false,
  async prepare(msg, ctx) {
    const p = parsePayload('bpjs.hfis.update', msg.payload);
    const newer = await ctx.findMessage({
      target: 'bpjs',
      idempotencyKey: outboxKey(
        BPJS_HFIS_UPDATE_OPERATION,
        `${p.practitionerId}:${p.serviceId}`,
        p.revision + 1,
      ),
    });
    if (newer) return { skip: `revisi ${p.revision + 1} sudah diantrekan` };
    const today = isoDateJakarta(new Date());
    const data = await ctx.read(async (tx) => ({
      dokter: await externalCode(tx, 'practitioner', p.practitionerId, 'bpjs:hfis-dokter'),
      poli: await externalCode(tx, 'queue_service', p.serviceId, 'bpjs:poli'),
      jadwal: await weeklyTemplate(tx, p.practitionerId, p.serviceId, today),
    }));
    if (!data.dokter || !/^\d+$/.test(data.dokter)) return { skip: 'dokter tanpa kode HFIS' };
    if (!data.poli) return { skip: 'poli tanpa kode BPJS' };
    if (data.jadwal.length === 0) return { skip: 'tidak ada templat aktif' };
    const body: HfisUpdateJadwalRequest = {
      kodepoli: data.poli,
      kodesubspesialis: data.poli,
      kodedokter: Number(data.dokter),
      jadwal: data.jadwal.map((j) => ({
        ...j,
        hari: j.hari as HfisUpdateJadwalRequest['jadwal'][number]['hari'],
      })),
    };
    return { service: 'antrean', ...HFIS_ENDPOINTS.updateJadwalDokter, body };
  },
  async onAccepted(tx, msg) {
    const p = parsePayload('bpjs.hfis.update', msg.payload);
    const today = isoDateJakarta(new Date());
    const dokter = await externalCode(tx, 'practitioner', p.practitionerId, 'bpjs:hfis-dokter');
    const poli = await externalCode(tx, 'queue_service', p.serviceId, 'bpjs:poli');
    const payload: HfisPushSnapshot = {
      serviceId: p.serviceId,
      kodepoli: poli ?? '',
      kodedokter: Number(dokter ?? 0),
      revision: p.revision,
      jadwal: await weeklyTemplate(tx, p.practitionerId, p.serviceId, today),
    };
    await tx.hfisScheduleSnapshot.create({
      data: {
        id: newId(),
        tenantId: msg.tenantId,
        practitionerId: p.practitionerId,
        direction: 'push',
        periodStart: dbDateFromIso(today),
        periodEnd: dbDateFromIso(today),
        payload,
      },
    });
  },
  onRejected: auditRejection,
});

export const bpjsHfisPull = defineBpjsOperation({
  sensitive: false,
  async prepare(msg, ctx) {
    const p = parsePayload('bpjs.hfis.pull', msg.payload);
    const poli = await ctx.read((tx) => externalCode(tx, 'queue_service', p.serviceId, 'bpjs:poli'));
    if (!poli) return { skip: 'poli tanpa kode BPJS' };
    return {
      service: 'antrean',
      method: HFIS_ENDPOINTS.jadwalDokter.method,
      path: bpjsPath(HFIS_ENDPOINTS.jadwalDokter.path, { kodepoli: poli, tanggal: p.date }),
    };
  },
  response: hfisJadwalDokterResponseSchema,
  async onAccepted(tx, msg, jadwal) {
    await saveSnapshot(
      tx,
      msg,
      jadwal.map((j) => ({ ...j, libur: j.libur === 1 })),
    );
  },
  async onRejected(tx, msg, rejection) {
    if (rejection.code === 'BPJS_JADWAL_TIDAK_DITEMUKAN') return saveSnapshot(tx, msg, []);
    await auditRejection(tx, msg, rejection);
  },
});

async function saveSnapshot(
  tx: TenantTx,
  msg: OutboxMessage,
  entries: Array<{
    kodedokter: number;
    namadokter: string;
    jadwal: string;
    kapasitaspasien: number;
    libur: boolean;
  }>,
) {
  const p = parsePayload('bpjs.hfis.pull', msg.payload);
  const poli = (await externalCode(tx, 'queue_service', p.serviceId, 'bpjs:poli')) ?? '';
  const payload: HfisPullSnapshot = {
    serviceId: p.serviceId,
    kodepoli: poli,
    tanggal: p.date,
    jadwal: entries.map((e) => ({
      kodedokter: e.kodedokter,
      namadokter: e.namadokter,
      jadwal: e.jadwal,
      kapasitaspasien: e.kapasitaspasien,
      libur: e.libur,
    })),
  };
  await tx.hfisScheduleSnapshot.create({
    data: {
      id: newId(),
      tenantId: msg.tenantId,
      direction: 'pull',
      periodStart: dbDateFromIso(p.date),
      periodEnd: dbDateFromIso(p.date),
      payload,
    },
  });
}
