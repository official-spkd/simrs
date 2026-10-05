import { enqueueOutbox, type OutboxMessage, type TenantTx } from '@simrs/db';
import {
  APLICARE_ENDPOINTS,
  type AplicareBedRequest,
  aplicareRefKelasResponseSchema,
  BPJS_APLICARE_UPDATE_OPERATION,
  bpjsPath,
  CLINICAL_OPERATIONS,
  clinicalOutboxKey,
  parseClinicalOperationPayload,
} from '@simrs/shared';
import { z } from 'zod';
import { type BpjsRejection, defineBpjsOperation } from './bpjs-operation';
import { BPJS_DLQ_CODE } from './booking';
import { type OutboxOperation, PermanentOperationError } from './operation-types';

/**
 * K05 · `bpjs.aplicare.update`: laporkan kapasitas/ketersediaan satu ruang Aplicare (bangsal × kelas,
 * `aplicare_rooms`) dari papan bed. Payload `{ roomId, revision }`; angka dihitung SAAT dikirim dari `bed_status`,
 * jadi pesan lama yang revisinya sudah dilampaui dilewati (yang terbaru selalu membawa hitungan terkini).
 *
 * Bertahap, satu panggilan per pesan; tahap ditentukan keadaan baris ruang:
 * 1. `kelas` — kode kelas resmi belum diketahui: baca referensi kelas Aplicare, cocokkan nama kelas → simpan;
 * 2. `create` — ruang belum terdaftar: daftarkan (`bed/create`); BPJS menjawab "sudah terdaftar" → anggap terdaftar;
 * 3. `update` — perbarui (`bed/update`); BPJS menjawab "ruang tidak ditemukan" → daftar ulang.
 * Tahap lanjutan = pesan baru berkunci `<operasi>:<ruang>:<revisi>:<langkah>`, paling banyak `MAX_STEPS` langkah per
 * revisi agar penolakan bolak-balik tidak berputar tanpa akhir.
 */

const MAX_STEPS = 4;
const STEP = /:(\d+):(\d+)$/;

/** Nama kelas di referensi Aplicare untuk kelas rawat SIMRS (dicocokkan tanpa beda huruf besar/kecil). */
const NAMA_KELAS: Readonly<Record<string, readonly string[]>> = {
  vvip: ['VVIP'],
  vip: ['VIP'],
  kelas_1: ['KELAS I', 'KELAS 1'],
  kelas_2: ['KELAS II', 'KELAS 2'],
  kelas_3: ['KELAS III', 'KELAS 3'],
  icu: ['ICU'],
  hcu: ['HCU'],
  nicu: ['NICU'],
  picu: ['PICU'],
  isolasi: ['ISOLASI'],
};

const payloadOf = (msg: { payload: unknown }) => {
  try {
    return parseClinicalOperationPayload(BPJS_APLICARE_UPDATE_OPERATION, msg.payload);
  } catch {
    throw new PermanentOperationError('Payload Aplicare tidak dikenali');
  }
};
/** Langkah ke-n dalam satu revisi (pesan pertama dari API = 1). */
const stepOf = (msg: { idempotencyKey: string }) => Number(STEP.exec(msg.idempotencyKey)?.[2] ?? '1');

const ROOM_SELECT = {
  id: true,
  tenantId: true,
  unitId: true,
  careClass: true,
  roomCode: true,
  roomName: true,
  classCode: true,
  registeredAt: true,
  revision: true,
  sentRevision: true,
  tenant: { select: { bpjsPpkCode: true } },
} as const;
type Room = NonNullable<Awaited<ReturnType<typeof loadRoom>>>;
function loadRoom(tx: TenantTx, id: string) {
  return tx.aplicareRoom.findUnique({ where: { id }, select: ROOM_SELECT });
}

/** Kapasitas = bed aktif bangsal+kelas yang tidak rusak; tersedia = bed `siap` (tanpa rincian jenis kelamin). */
async function counts(tx: TenantTx, room: Room) {
  const beds = await tx.location.findMany({
    where: { unitId: room.unitId, careClass: room.careClass, kind: 'bed', active: true },
    select: { bedStatus: { select: { status: true } } },
  });
  const statuses = beds.map((b) => b.bedStatus?.status ?? 'siap');
  const kapasitas = statuses.filter((s) => s !== 'rusak').length;
  const tersedia = statuses.filter((s) => s === 'siap').length;
  return { kapasitas, tersedia };
}

async function nextStep(tx: TenantTx, room: Pick<Room, 'id' | 'tenantId'>, msg: OutboxMessage) {
  const { revision } = payloadOf(msg);
  const step = stepOf(msg) + 1;
  if (step > MAX_STEPS) {
    await tx.aplicareRoom.update({
      where: { id: room.id },
      data: { lastErrorCode: 'APLICARE_LANGKAH_HABIS' },
    });
    return;
  }
  const op = BPJS_APLICARE_UPDATE_OPERATION;
  await enqueueOutbox(tx, room.tenantId, {
    target: CLINICAL_OPERATIONS[op].target,
    operation: op,
    idempotencyKey: `${clinicalOutboxKey(op, room.id, revision)}:${step}`,
    payload: { roomId: room.id, revision },
  });
}

const responseSchema = z.union([aplicareRefKelasResponseSchema, z.undefined()]);
type Response = z.infer<typeof responseSchema>;

export const bpjsAplicareUpdate: OutboxOperation = defineBpjsOperation<Response>({
  response: responseSchema,
  // Isi permintaan/respons hanya angka bed per ruang, tanpa data pasien.
  sensitive: false,
  async prepare(msg, ctx) {
    const { roomId, revision } = payloadOf(msg);
    const room = await ctx.read((tx) => loadRoom(tx, roomId));
    if (!room) return { skip: 'ruang Aplicare tidak ditemukan' };
    if (revision < room.revision) return { skip: 'revisi ruang sudah dilampaui pesan yang lebih baru' };
    const ppk = room.tenant.bpjsPpkCode;
    if (!ppk) throw new PermanentOperationError('Kode PPK BPJS rumah sakit belum diisi');
    if (!room.classCode)
      return { service: 'aplicare', method: 'GET', path: APLICARE_ENDPOINTS.refKelas.path };
    const { kapasitas, tersedia } = await ctx.read((tx) => counts(tx, room));
    const body: AplicareBedRequest = {
      kodekelas: room.classCode,
      koderuang: room.roomCode,
      namaruang: room.roomName,
      kapasitas,
      tersedia,
      tersediapria: 0,
      tersediawanita: 0,
      tersediapriawanita: tersedia,
    };
    const endpoint = room.registeredAt ? APLICARE_ENDPOINTS.bedUpdate : APLICARE_ENDPOINTS.bedCreate;
    return {
      service: 'aplicare',
      method: endpoint.method,
      path: bpjsPath(endpoint.path, { kodeppk: ppk }),
      body,
    };
  },
  async onAccepted(tx, msg, response) {
    const { roomId, revision } = payloadOf(msg);
    const room = await loadRoom(tx, roomId);
    if (!room) return;
    if (response) {
      const names = NAMA_KELAS[room.careClass] ?? [];
      const kelas = response.list.find((k) => names.includes(k.namakelas.trim().toUpperCase()));
      if (!kelas) {
        await tx.aplicareRoom.update({
          where: { id: room.id },
          data: { lastErrorCode: 'BPJS_KELAS_TIDAK_DITEMUKAN' },
        });
        return;
      }
      await tx.aplicareRoom.update({ where: { id: room.id }, data: { classCode: kelas.kodekelas } });
      if (revision >= room.revision) await nextStep(tx, room, msg);
      return;
    }
    // Ruang terdaftar dengan hitungan revisi ini (create atau update).
    await tx.aplicareRoom.update({
      where: { id: room.id },
      data: {
        registeredAt: room.registeredAt ?? new Date(),
        sentRevision: Math.max(room.sentRevision, revision),
        lastErrorCode: null,
      },
    });
  },
  async onRejected(tx, msg, rejection) {
    const { roomId, revision } = payloadOf(msg);
    const room = await loadRoom(tx, roomId);
    if (!room) return;
    const latest = revision >= room.revision;
    switch (rejection.code) {
      case 'BPJS_RUANG_GANDA':
        // Sudah terdaftar (mis. kiriman sebelumnya timeout): lanjut sebagai update.
        await tx.aplicareRoom.update({
          where: { id: room.id },
          data: { registeredAt: room.registeredAt ?? new Date(), lastErrorCode: rejection.code },
        });
        if (latest) await nextStep(tx, room, msg);
        return;
      case 'BPJS_RUANG_TIDAK_DITEMUKAN':
        // Dihapus di sisi BPJS: daftar ulang.
        await tx.aplicareRoom.update({
          where: { id: room.id },
          data: { registeredAt: null, lastErrorCode: rejection.code },
        });
        if (latest) await nextStep(tx, room, msg);
        return;
      case 'BPJS_KELAS_TIDAK_DITEMUKAN':
        // Kode kelas tersimpan tidak berlaku lagi: baca ulang referensi kelas.
        await tx.aplicareRoom.update({
          where: { id: room.id },
          data: { classCode: null, lastErrorCode: rejection.code },
        });
        if (latest) await nextStep(tx, room, msg);
        return;
      default:
        await recordError(tx, room.id, rejection);
    }
  },
  async onDead(tx, msg) {
    const room = await loadRoom(tx, payloadOf(msg).roomId);
    if (room)
      await tx.aplicareRoom.update({ where: { id: room.id }, data: { lastErrorCode: BPJS_DLQ_CODE } });
  },
});

async function recordError(tx: TenantTx, id: string, rejection: BpjsRejection) {
  await tx.aplicareRoom.update({ where: { id }, data: { lastErrorCode: rejection.code } });
}
