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
 */
@Injectable()
export class OutboxScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxScheduler.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return; // tes memanggil start() sendiri
    await this.start();
  }

  async start(): Promise<void> {
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

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
