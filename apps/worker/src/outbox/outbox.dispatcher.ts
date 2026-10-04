import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  claimDueOutbox,
  createPrismaClient,
  deferOutboxMessage,
  listActiveTenantIds,
  type OutboxMessage,
  type PrismaClient,
  type RecordAttemptOptions,
  recordOutboxAttempt,
  withTenant,
} from '@simrs/db';
import { decryptField, PatientCrypto } from '@simrs/shared/node';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { BpjsConnector } from './bpjs-connector';
import { HttpConnector, type SendResult } from './http-connector';
import {
  type OperationContext,
  OUTBOX_OPERATION_REGISTRY,
  type OutboxDefer,
  type OutboxOperation,
  PermanentOperationError,
} from './operations';
import { retryLimits } from './retry-policy';

export interface DispatchSummary {
  tenants: number;
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  /** Ditunda tanpa menghabiskan percobaan (`defer`). */
  deferred: number;
}

export interface DispatchOptions {
  now?: Date;
  /** Percobaan maksimum untuk operasi tanpa kebijakan `retry` sendiri (bawaan 8, ADR-0003). */
  maxAttempts?: number;
  /** Batasi ke tenant tertentu (tes paralel tidak saling mengambil pesan); bawaan semua tenant aktif. */
  tenantIds?: string[];
}

/** Jeda minimum penundaan: operasi yang terus meminta tunda tidak memutar dispatcher tanpa jeda. */
export const MIN_DEFER_MS = 1000;
/** Prasyarat yang sedang dikirim worker lain: periksa lagi sebentar lagi (bukan menunggu lease 60 detik). */
const DEFER_WHILE_PROCESSING_MS = 5000;

const errorName = (err: unknown) => (err instanceof Error ? err.name : 'Error');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hasil percobaan yang dicatat (tanpa badan respons). */
type AttemptOutcome = Omit<SendResult, 'responseBody'>;

/** Hasil satu langkah: dikirim (atau gagal disiapkan), atau ditunda. */
type Step = { send: SendResult } | { defer: { until: Date; reason: string } };

/**
 * Prosesor outbox generik (ADR-0003, ADR-0008, ADR-0017):
 * 1. ambil daftar tenant aktif (fungsi SECURITY DEFINER sempit),
 * 2. per tenant: klaim pesan jatuh tempo dalam transaksi singkat (RLS aktif),
 * 3. siapkan permintaan (operasi boleh membaca DB tenant, mis. mendekripsi NIK), lalu kirim HTTP di LUAR
 *    transaksi; atau tunda tanpa menghabiskan percobaan (`defer`),
 * 4. catat hasil dalam transaksi baru: terkirim (+ `onSuccess` atomik), dijadwalkan ulang menurut kebijakan retry
 *    operasi, atau DLQ (`dead`, + `onDead` atomik).
 */
@Injectable()
export class OutboxDispatcher implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  readonly prisma: PrismaClient;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly connector: HttpConnector,
    private readonly bpjs: BpjsConnector,
    @Inject(OUTBOX_OPERATION_REGISTRY) private readonly operations: ReadonlyMap<string, OutboxOperation>,
  ) {
    this.prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 5 });
  }

  private context(tenantId: string): OperationContext {
    return {
      tenantId,
      read: (fn) => withTenant(this.prisma, tenantId, fn),
      crypto: new PatientCrypto(
        { encKeyB64: this.env.FIELD_ENCRYPTION_KEY, hashKeyB64: this.env.FIELD_HASH_KEY },
        tenantId,
      ),
      decryptStaffPhone: (stored) =>
        decryptField(stored, { keyB64: this.env.FIELD_ENCRYPTION_KEY, tenantId, purpose: 'staff_phone' }),
      decryptLoginOtp: (stored) =>
        decryptField(stored, { keyB64: this.env.FIELD_ENCRYPTION_KEY, tenantId, purpose: 'login_otp' }),
      webBaseUrl: this.env.WEB_BASE_URL,
      findMessage: ({ target, idempotencyKey }) =>
        withTenant(this.prisma, tenantId, (tx) =>
          tx.outboxMessage.findUnique({
            where: { tenantId_target_idempotencyKey: { tenantId, target, idempotencyKey } },
            select: { id: true, status: true },
          }),
        ),
    };
  }

  /** Siapkan dan kirim satu pesan; galat persiapan dipetakan ke hasil percobaan (bukan dilempar). */
  private async attempt(
    msg: OutboxMessage,
    tenantId: string,
    op: OutboxOperation | undefined,
    now: Date,
  ): Promise<Step> {
    if (!op) {
      return {
        send: {
          ok: false,
          permanent: true,
          durationMs: 0,
          error: `Operasi belum didukung: ${msg.operation}`,
        },
      };
    }
    let prepared;
    try {
      prepared = await op.prepare(msg, this.context(tenantId));
    } catch (err) {
      return {
        send: {
          ok: false,
          permanent: err instanceof PermanentOperationError,
          durationMs: 0,
          error: err instanceof PermanentOperationError ? err.message : `persiapan gagal: ${errorName(err)}`,
        },
      };
    }
    if ('skip' in prepared) {
      return { send: { ok: true, durationMs: 0, responseExcerpt: `dilewati: ${prepared.skip}` } };
    }
    if ('defer' in prepared) return this.resolveDefer(msg, tenantId, prepared.defer, now);
    if ('bpjs' in prepared) {
      return {
        send: await this.bpjs.send(msg, prepared.bpjs, { sensitive: op.sensitive, schema: prepared.schema }),
      };
    }
    return { send: await this.connector.send(msg, prepared, { sensitive: op.sensitive }) };
  }

  /**
   * Waktu jatuh tempo berikutnya untuk pesan yang ditunda. Prasyarat (`afterMessageId`) yang DLQ atau tidak ada
   * membuat pesan ini gagal permanen: urutan tidak mungkin dipenuhi tanpa tindakan manual.
   */
  private async resolveDefer(
    msg: OutboxMessage,
    tenantId: string,
    defer: OutboxDefer,
    now: Date,
  ): Promise<Step> {
    const permanent = (error: string): Step => ({
      send: { ok: false, permanent: true, durationMs: 0, error },
    });
    const earliest = now.getTime() + MIN_DEFER_MS;
    if ('untilMs' in defer) {
      if (!Number.isFinite(defer.untilMs)) return permanent('Penundaan tidak valid');
      return {
        defer: {
          until: new Date(Math.max(defer.untilMs, earliest)),
          reason: defer.reason ?? 'menunggu waktu kirim',
        },
      };
    }
    const depId = defer.afterMessageId;
    if (!UUID.test(depId) || depId === msg.id) return permanent('Prasyarat penundaan tidak valid');
    const dep = await withTenant(this.prisma, tenantId, (tx) =>
      tx.outboxMessage.findUnique({ where: { id: depId }, select: { status: true, nextAttemptAt: true } }),
    );
    if (!dep) return permanent(`Pesan prasyarat ${depId} tidak ditemukan`);
    if (dep.status === 'dead') return permanent(`Pesan prasyarat ${depId} masuk DLQ`);
    const reason = defer.reason ?? `menunggu pesan ${depId}`;
    if (dep.status === 'processing') {
      return { defer: { until: new Date(now.getTime() + DEFER_WHILE_PROCESSING_MS), reason } };
    }
    // `sent`: prasyarat sudah terkirim, coba lagi pada putaran berikutnya; selain itu setelah prasyarat dicoba.
    const after = dep.status === 'sent' ? 0 : dep.nextAttemptAt.getTime();
    return { defer: { until: new Date(Math.max(after + MIN_DEFER_MS, earliest)), reason } };
  }

  async dispatchOnce(opts: DispatchOptions = {}): Promise<DispatchSummary> {
    const summary: DispatchSummary = { tenants: 0, claimed: 0, sent: 0, failed: 0, dead: 0, deferred: 0 };
    const tenantIds = opts.tenantIds ?? (await listActiveTenantIds(this.prisma));
    summary.tenants = tenantIds.length;
    for (const tenantId of tenantIds) {
      const now = opts.now ?? new Date();
      const claimed = await withTenant(this.prisma, tenantId, (tx) =>
        claimDueOutbox(tx, this.env.OUTBOX_BATCH_SIZE, now),
      );
      summary.claimed += claimed.length;
      for (const msg of claimed) {
        const op = this.operations.get(msg.operation);
        const { deferDeadline, ...limits } = retryLimits(op?.retry, msg, opts.maxAttempts);
        const record: RecordAttemptOptions = { now: opts.now, ...limits };
        const step = await this.attempt(msg, tenantId, op, opts.now ?? new Date());

        let result: SendResult;
        if ('defer' in step) {
          if (step.defer.until.getTime() < deferDeadline.getTime()) {
            await withTenant(this.prisma, tenantId, (tx) => deferOutboxMessage(tx, msg, step.defer));
            summary.deferred += 1;
            continue;
          }
          result = {
            ok: false,
            permanent: true,
            durationMs: 0,
            error: `ditunda melewati batas waktu coba ulang: ${step.defer.reason}`,
          };
        } else result = step.send;

        const updated = await this.finish(tenantId, msg, op, result, record);
        if (updated.status === 'sent') summary.sent += 1;
        else if (updated.status === 'dead') {
          summary.dead += 1;
          // Alarm DLQ: tanpa payload (bisa memuat PHI), hanya ID dan sebab.
          this.logger.warn(
            `DLQ: outbox ${msg.id} (tenant ${tenantId}, ${msg.target}/${msg.operation}) · ${updated.lastError}`,
          );
        } else summary.failed += 1;
      }
    }
    return summary;
  }

  /**
   * Catat hasil percobaan bersama hook operasi dalam SATU transaksi: `onSuccess` sebelum "terkirim", `onDead`
   * setelah pindah ke DLQ. Bila `onSuccess` melempar → semua dibatalkan dan percobaan dicatat gagal permanen
   * (DLQ, tetap dengan `onDead`). Bila `onDead` melempar → perubahannya dibatalkan, pesan tetap DLQ dan alarmnya
   * dicatat di `last_error`, sehingga pesan tidak pernah macet di `processing`.
   */
  private async finish(
    tenantId: string,
    msg: OutboxMessage,
    op: OutboxOperation | undefined,
    sendResult: SendResult,
    record: RecordAttemptOptions,
  ): Promise<OutboxMessage> {
    const { responseBody, ...first } = sendResult;
    const stage: { at: 'onSuccess' | 'record' | 'onDead' } = { at: 'record' };
    // Dibaca lewat fungsi: tahap diubah di dalam callback transaksi, jadi penyempitan tipe TS tidak berlaku.
    const failedInOnDead = () => stage.at === 'onDead';
    const withHooks = (result: AttemptOutcome) =>
      withTenant(this.prisma, tenantId, async (tx) => {
        // Respons diproses di transaksi yang sama dengan pencatatan "terkirim": tidak ada hasil setengah jadi.
        if (result.ok && op?.onSuccess && responseBody !== undefined) {
          stage.at = 'onSuccess';
          await op.onSuccess(tx, msg, responseBody);
        }
        stage.at = 'record';
        const updated = await recordOutboxAttempt(tx, msg, result, record);
        if (updated.status === 'dead' && op?.onDead) {
          stage.at = 'onDead';
          await op.onDead(tx, updated);
          stage.at = 'record';
        }
        return updated;
      });

    let failure: AttemptOutcome;
    try {
      return await withHooks(first);
    } catch (err) {
      if (failedInOnDead()) return this.deadWithoutHook(tenantId, msg, first, record, err);
      if (!first.ok) throw err;
      failure = {
        ...first,
        ok: false,
        permanent: true,
        error:
          err instanceof PermanentOperationError
            ? err.message
            : `pemrosesan respons gagal: ${errorName(err)}`,
      };
    }
    try {
      return await withHooks(failure);
    } catch (err) {
      if (failedInOnDead()) return this.deadWithoutHook(tenantId, msg, failure, record, err);
      throw err;
    }
  }

  /** `onDead` gagal: pesan tetap dipindah ke DLQ tanpa perubahan domain, dengan catatan di `last_error`. */
  private async deadWithoutHook(
    tenantId: string,
    msg: OutboxMessage,
    result: AttemptOutcome,
    record: RecordAttemptOptions,
    err: unknown,
  ): Promise<OutboxMessage> {
    this.logger.error(
      `onDead gagal: outbox ${msg.id} (tenant ${tenantId}, ${msg.operation}) · ${errorName(err)}`,
    );
    const noted = { ...result, error: `${result.error ?? 'gagal'} · onDead gagal: ${errorName(err)}` };
    return withTenant(this.prisma, tenantId, (tx) => recordOutboxAttempt(tx, msg, noted, record));
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
