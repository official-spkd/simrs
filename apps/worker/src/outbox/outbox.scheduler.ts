import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { bullConnection, resolveSchedulerMode } from '../infra/scheduler-mode';
import { type DispatchSummary, OutboxDispatcher } from './outbox.dispatcher';

export const OUTBOX_QUEUE = 'outbox';
const DISPATCH_SCHEDULER_ID = 'outbox-dispatch';

/**
 * BullMQ menjadwalkan putaran dispatch secara berkala (job scheduler) dan menjamin hanya satu putaran berjalan
 * per worker (concurrency 1). Status kirim, retry, dan DLQ tetap di Postgres (sumber kebenaran, ikut RLS).
 * Di luar produksi tanpa Redis (pengembangan tanpa Docker) dipakai timer biasa di proses ini.
 */
@Injectable()
export class OutboxScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxScheduler.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return; // tes memanggil start() sendiri
    await this.start();
  }

  async start(): Promise<void> {
    if ((await resolveSchedulerMode(this.env)) === 'interval') {
      this.startInterval();
      return;
    }
    this.connection = bullConnection(this.env);
    const prefix = this.env.BULLMQ_PREFIX;
    this.queue = new Queue(OUTBOX_QUEUE, { connection: this.connection, prefix });
    await this.queue.upsertJobScheduler(
      DISPATCH_SCHEDULER_ID,
      { every: this.env.OUTBOX_POLL_MS },
      { name: 'dispatch', data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    this.worker = new Worker(
      OUTBOX_QUEUE,
      async (job) => {
        if (job.name !== 'dispatch') return null;
        const summary = await this.dispatcher.dispatchOnce();
        this.logSummary(summary);
        return summary;
      },
      { connection: this.connection, prefix, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.id ?? '?'} gagal: ${err.name}`));
    this.logger.log(`Worker outbox aktif · interval ${this.env.OUTBOX_POLL_MS} ms`);
  }

  private logSummary(summary: DispatchSummary): void {
    if (summary.claimed > 0) {
      this.logger.log(
        `outbox: diklaim ${summary.claimed}, terkirim ${summary.sent}, gagal ${summary.failed}, DLQ ${summary.dead}, ditunda ${summary.deferred}`,
      );
    }
  }

  /** Timer tanpa tumpang tindih: putaran berikutnya baru dijadwalkan setelah putaran ini selesai. */
  private startInterval(): void {
    const tick = async () => {
      try {
        this.logSummary(await this.dispatcher.dispatchOnce());
      } catch (err) {
        this.logger.error(`putaran outbox gagal: ${err instanceof Error ? err.name : 'error'}`);
      } finally {
        // Putaran yang selesai setelah modul ditutup tidak menjadwalkan putaran baru.
        if (!this.stopped) this.timer = setTimeout(tick, this.env.OUTBOX_POLL_MS);
      }
    };
    this.timer = setTimeout(tick, 0);
    this.logger.warn(
      `Redis tidak dipakai: worker outbox memakai timer (${this.env.OUTBOX_POLL_MS} ms). Hanya untuk pengembangan; produksi wajib BullMQ.`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
