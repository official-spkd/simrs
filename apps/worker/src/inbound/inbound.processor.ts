import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  claimDueInbound,
  createPrismaClient,
  type InboundEvent,
  listActiveTenantIds,
  markInboundProcessed,
  type PrismaClient,
  recordInboundFailure,
  withTenant,
} from '@simrs/db';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { recordDomainEvent } from '../infra/domain-events';
import {
  INBOUND_HANDLER_REGISTRY,
  type InboundHandler,
  type InboundHandlerContext,
  PermanentInboundError,
  RetryableInboundError,
} from './handlers';

export interface InboundSummary {
  tenants: number;
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
}

export interface InboundRunOptions {
  now?: Date;
  /** Batasi ke tenant tertentu (tes paralel); bawaan semua tenant aktif. */
  tenantIds?: string[];
  maxAttempts?: number;
  random?: () => number;
}

/** Teks galat aman: pesan hanya dari galat yang ditulis untuk ditampilkan; selain itu nama kelas saja (tanpa PHI). */
function safeError(err: unknown): string {
  if (err instanceof PermanentInboundError || err instanceof RetryableInboundError) return err.message;
  return `galat pemrosesan: ${err instanceof Error ? err.name : 'Error'}`;
}

/**
 * Pemroses pesan masuk generik (rencana fase 4 §4.1a; ADR-0017 untuk atomisitas):
 * 1. tenant aktif (fungsi SECURITY DEFINER sempit), per tenant klaim pesan jatuh tempo dari sumber yang punya penangan,
 * 2. tiap pesan diproses di transaksi tenant baru: penangan + penanda `processed` commit bersama,
 * 3. gagal → transaksi itu batal, lalu di transaksi lain dicatat `failed` (backoff eksponensial) atau `dead`
 *    (galat permanen / batas percobaan). Status terlihat di `inbound_events` (layar pemilik sumber).
 */
@Injectable()
export class InboundProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(InboundProcessor.name);
  readonly prisma: PrismaClient;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(INBOUND_HANDLER_REGISTRY) private readonly handlers: ReadonlyMap<string, InboundHandler>,
  ) {
    this.prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 3 });
  }

  async processOnce(opts: InboundRunOptions = {}): Promise<InboundSummary> {
    const summary: InboundSummary = { tenants: 0, claimed: 0, processed: 0, failed: 0, dead: 0 };
    const sources = [...this.handlers.keys()];
    if (sources.length === 0) return summary;
    const tenantIds = opts.tenantIds ?? (await listActiveTenantIds(this.prisma));
    summary.tenants = tenantIds.length;
    for (const tenantId of tenantIds) {
      const now = opts.now ?? new Date();
      const claimed = await withTenant(this.prisma, tenantId, (tx) =>
        claimDueInbound(tx, sources, this.env.INBOUND_BATCH_SIZE, now),
      );
      summary.claimed += claimed.length;
      for (const event of claimed) {
        const outcome = await this.processOne(tenantId, event, now, opts);
        summary[outcome] += 1;
      }
    }
    return summary;
  }

  private async processOne(
    tenantId: string,
    event: InboundEvent,
    now: Date,
    opts: InboundRunOptions,
  ): Promise<'processed' | 'failed' | 'dead'> {
    const handler = this.handlers.get(event.source);
    try {
      if (!handler) throw new PermanentInboundError(`Sumber belum didukung: ${event.source}`);
      await withTenant(this.prisma, tenantId, async (tx) => {
        await handler.handle(event, this.context(tenantId, tx, now, event));
        await markInboundProcessed(tx, event, now);
      });
      return 'processed';
    } catch (err) {
      const status = await withTenant(this.prisma, tenantId, (tx) =>
        recordInboundFailure(tx, event, safeError(err), {
          now,
          permanent: err instanceof PermanentInboundError,
          maxAttempts: opts.maxAttempts,
          random: opts.random,
        }),
      );
      if (status === 'dead') {
        // Tanpa isi pesan (bisa memuat data klinis): hanya ID, sumber, sebab.
        this.logger.warn(
          `inbound dead: ${event.id} (tenant ${tenantId}, ${event.source}) · ${safeError(err)}`,
        );
      }
      return status;
    }
  }

  private context(
    tenantId: string,
    tx: InboundHandlerContext['tx'],
    now: Date,
    event: InboundEvent,
  ): InboundHandlerContext {
    return {
      tenantId,
      tx,
      now,
      recordEvent: (name, payload) =>
        recordDomainEvent(tx, tenantId, name, payload, { occurredAt: now, actorDeviceId: event.deviceId }),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
