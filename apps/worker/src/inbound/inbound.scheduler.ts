import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { bullConnection, resolveSchedulerMode } from '../infra/scheduler-mode';
import { InboundProcessor, type InboundSummary } from './inbound.processor';

export const INBOUND_QUEUE = 'inbound';
const PROCESS_SCHEDULER_ID = 'inbound-process';

/**
 * Putaran pemroses pesan masuk berkala (pola `OutboxScheduler`): BullMQ job scheduler, satu putaran per worker
 * (concurrency 1); status, retry, dan dead tetap di Postgres. Tanpa Redis di luar produksi: timer di proses ini.
 */
@Injectable()
export class InboundScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InboundScheduler.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly processor: InboundProcessor,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return; // tes memanggil processOnce() sendiri
    await this.start();
  }

  async start(): Promise<void> {
    if ((await resolveSchedulerMode(this.env)) === 'interval') {
      this.startInterval();
      return;
    }
    this.connection = bullConnection(this.env);
    const prefix = this.env.BULLMQ_PREFIX;
    this.queue = new Queue(INBOUND_QUEUE, { connection: this.connection, prefix });
    await this.queue.upsertJobScheduler(
      PROCESS_SCHEDULER_ID,
      { every: this.env.INBOUND_POLL_MS },
      { name: 'process', data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    this.worker = new Worker(
      INBOUND_QUEUE,
      async (job) => {
        if (job.name !== 'process') return null;
        const summary = await this.processor.processOnce();
        this.logSummary(summary);
        return summary;
      },
      { connection: this.connection, prefix, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.id ?? '?'} gagal: ${err.name}`));
    this.logger.log(`Pemroses pesan masuk aktif · interval ${this.env.INBOUND_POLL_MS} ms`);
  }

  private logSummary(s: InboundSummary): void {
    if (s.claimed > 0) {
      this.logger.log(
        `inbound: diklaim ${s.claimed}, selesai ${s.processed}, gagal ${s.failed}, berhenti ${s.dead}`,
      );
    }
  }

  /** Timer tanpa tumpang tindih: putaran berikutnya baru dijadwalkan setelah putaran ini selesai. */
  private startInterval(): void {
    const tick = async () => {
      try {
        this.logSummary(await this.processor.processOnce());
      } catch (err) {
        this.logger.error(`putaran inbound gagal: ${err instanceof Error ? err.name : 'error'}`);
      } finally {
        if (!this.stopped) this.timer = setTimeout(tick, this.env.INBOUND_POLL_MS);
      }
    };
    this.timer = setTimeout(tick, 0);
    this.logger.warn(
      `Redis tidak dipakai: pemroses pesan masuk memakai timer (${this.env.INBOUND_POLL_MS} ms). Hanya untuk pengembangan.`,
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
