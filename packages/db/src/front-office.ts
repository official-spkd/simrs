import {
  AppError,
  BPJS_ANTREAN_UPDATEWAKTU_OPERATION,
  FRONT_OFFICE_OPERATIONS,
  newId,
  outboxKey,
} from '@simrs/shared';
import { Prisma, type TenantTx } from './client';
import { enqueueOutbox } from './outbox';

/** Keranjang kuota sesi: JKN (Mobile JKN + loket BPJS) atau non-JKN (umum/asuransi). */
export type QuotaBucket = 'jkn' | 'non_jkn';

/** Nama kolom per keranjang (daftar tetap, tidak pernah dari masukan pengguna). */
const BUCKET_COLUMNS: Record<QuotaBucket, { booked: Prisma.Sql; quota: Prisma.Sql }> = {
  jkn: { booked: Prisma.raw('booked_jkn'), quota: Prisma.raw('quota_jkn') },
  non_jkn: { booked: Prisma.raw('booked_non_jkn'), quota: Prisma.raw('quota_non_jkn') },
};

export interface QuotaState {
  booked: number;
  quota: number;
}

/**
 * F01/F02 · Pesan satu tempat di kuota sesi dengan satu UPDATE bersyarat (`booked < quota`). Permintaan serentak
 * mengantre di kunci baris; masing-masing menilai ulang syaratnya pada versi baris terbaru, sehingga untuk sisa
 * satu tempat tepat satu yang berhasil. CHECK `schedule_sessions_quota` tetap menjadi pengaman terakhir.
 * Sesi `cuti` hanya bisa dipesan bila ada dokter pengganti. Hasil null = kuota habis atau sesi tidak bisa dipesan
 * (atau tidak terlihat di tenant ini).
 */
export async function reserveQuota(
  tx: TenantTx,
  sessionId: string,
  bucket: QuotaBucket,
): Promise<QuotaState | null> {
  const c = BUCKET_COLUMNS[bucket];
  const rows = await tx.$queryRaw<Array<{ booked: number; quota: number }>>`
    UPDATE schedule_sessions SET ${c.booked} = ${c.booked} + 1, updated_at = now()
    WHERE id = ${sessionId}::uuid AND ${c.booked} < ${c.quota}
      AND (kind = 'praktik' OR substitute_practitioner_id IS NOT NULL)
    RETURNING ${c.booked} AS booked, ${c.quota} AS quota`;
  return rows[0] ?? null;
}

/** Kembalikan satu tempat kuota (booking batal/dijadwal ulang). Null bila tidak ada yang bisa dikembalikan. */
export async function releaseQuota(
  tx: TenantTx,
  sessionId: string,
  bucket: QuotaBucket,
): Promise<QuotaState | null> {
  const c = BUCKET_COLUMNS[bucket];
  const rows = await tx.$queryRaw<Array<{ booked: number; quota: number }>>`
    UPDATE schedule_sessions SET ${c.booked} = ${c.booked} - 1, updated_at = now()
    WHERE id = ${sessionId}::uuid AND ${c.booked} > 0
    RETURNING ${c.booked} AS booked, ${c.quota} AS quota`;
  return rows[0] ?? null;
}

export interface AllocatedQueueNumber {
  seq: number;
  /** `<kode layanan>-<3 digit>`, mis. `PD-027` (docs/04 §5). */
  ticketNo: string;
}

/** Nomor antrean terbesar per layanan per hari (format 3 digit). */
export const QUEUE_NUMBER_MAX = 999;

/**
 * F04 · Nomor antrean berikutnya untuk satu layanan pada satu tanggal layanan (kalender WIB, `YYYY-MM-DD`).
 * Memakai urutan P08 (`number_sequences`, jenis `queue_<id layanan>`, periode `YYMMDD`): atomik, ikut batal bila
 * transaksi batal, tidak pernah memberi nomor yang sama dua kali. Lewat 999 → 409 `CONFLICT` (`reason: QUEUE_FULL`).
 */
export async function allocateQueueNumber(
  tx: TenantTx,
  tenantId: string,
  serviceId: string,
  serviceDate: string,
): Promise<AllocatedQueueNumber> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate))
    throw new Error(`Tanggal layanan tidak valid: ${serviceDate}`);
  const [service] = await tx.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM queue_services WHERE id = ${serviceId}::uuid AND active`;
  if (!service) throw new AppError('NOT_FOUND', 'Layanan antrean tidak ditemukan atau nonaktif', 404);
  const kind = `queue_${serviceId.replaceAll('-', '').toLowerCase()}`;
  const period = serviceDate.slice(2).replaceAll('-', '');
  const rows = await tx.$queryRaw<Array<{ last_value: bigint }>>`
    INSERT INTO number_sequences (tenant_id, kind, period, last_value, updated_at)
    VALUES (${tenantId}::uuid, ${kind}, ${period}, 1, now())
    ON CONFLICT (tenant_id, kind, period)
    DO UPDATE SET last_value = number_sequences.last_value + 1, updated_at = now()
    RETURNING last_value`;
  const value = Number(rows[0]?.last_value ?? 0);
  if (value < 1) throw new Error('Alokasi nomor antrean tidak mengembalikan nilai');
  if (value > QUEUE_NUMBER_MAX) {
    throw new AppError('CONFLICT', `Nomor antrean ${service.code} hari ini sudah habis`, 409, {
      reason: 'QUEUE_FULL',
    });
  }
  return { seq: value, ticketNo: `${service.code}-${String(value).padStart(3, '0')}` };
}

/**
 * F04 · Catat satu task ID Antrean BPJS bila belum ada (unik per booking + task; waktunya tidak pernah ditimpa) dan
 * antrekan pengirimannya (`bpjs.antrean.updatewaktu`, payload ID baris saja). Dipakai mesin task ID API (event domain)
 * dan job worker (no-show → 99). Penyaringan (booking JKN, urutan, tidak ada task setelah 99) milik pemanggil.
 * Kembalikan `true` bila baris baru dicatat.
 */
export async function insertBpjsQueueTask(
  tx: TenantTx,
  tenantId: string,
  appointmentId: string,
  taskId: number,
  occurredAt: Date,
): Promise<boolean> {
  const id = newId();
  const { count } = await tx.bpjsQueueTask.createMany({
    data: [{ id, tenantId, appointmentId, taskId, occurredAt }],
    skipDuplicates: true,
  });
  if (count === 0) return false;
  const op = BPJS_ANTREAN_UPDATEWAKTU_OPERATION;
  const msg = await enqueueOutbox(tx, tenantId, {
    target: FRONT_OFFICE_OPERATIONS[op].target,
    operation: op,
    idempotencyKey: outboxKey(op, id),
    payload: { queueTaskId: id },
  });
  await tx.bpjsQueueTask.update({ where: { id }, data: { outboxMessageId: msg.id } });
  return true;
}
