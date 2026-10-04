import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { OutboxDispatcher } from './outbox.dispatcher';

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

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return; // tes memanggil start() sendiri
    await this.start();
  }

  async start(): Promise<void> {
    const mode = this.env.OUTBOX_SCHEDULER;
    if (
      mode === 'interval' ||
      (mode === 'auto' && this.env.APP_ENV !== 'production' && !(await this.redisReachable()))
    ) {
      this.startInterval();
      return;
    }
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(OUTBOX_QUEUE, { connection: this.connection });
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
        if (summary.claimed > 0) {
          this.logger.log(
            `outbox: diklaim ${summary.claimed}, terkirim ${summary.sent}, gagal ${summary.failed}, DLQ ${summary.dead}`,
          );
        }
        return summary;
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.id ?? '?'} gagal: ${err.name}`));
    this.logger.log(`Worker outbox aktif · interval ${this.env.OUTBOX_POLL_MS} ms`);
  }

  private async redisReachable(): Promise<boolean> {
    const probe = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    try {
      await probe.connect();
      await probe.ping();
      return true;
    } catch {
      return false;
    } finally {
      probe.disconnect();
    }
  }

  /** Timer tanpa tumpang tindih: putaran berikutnya baru dijadwalkan setelah putaran ini selesai. */
  private startInterval(): void {
    const tick = async () => {
      try {
        const summary = await this.dispatcher.dispatchOnce();
        if (summary.claimed > 0) {
          this.logger.log(
            `outbox: diklaim ${summary.claimed}, terkirim ${summary.sent}, gagal ${summary.failed}, DLQ ${summary.dead}`,
          );
        }
      } catch (err) {
        this.logger.error(`putaran outbox gagal: ${err instanceof Error ? err.name : 'error'}`);
      } finally {
        this.timer = setTimeout(tick, this.env.OUTBOX_POLL_MS);
      }
    };
    this.timer = setTimeout(tick, 0);
    this.logger.warn(
      `Redis tidak dipakai: worker outbox memakai timer (${this.env.OUTBOX_POLL_MS} ms). Hanya untuk pengembangan; produksi wajib BullMQ.`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
