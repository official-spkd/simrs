import { Module } from '@nestjs/common';
import { AUDIT_ANCHOR_STORE, createAuditAnchorStore } from './audit/anchor-store';
import { AuditAnchorJob } from './audit/audit-anchor.job';
import { AuditJobsScheduler } from './audit/audit-jobs.scheduler';
import { AuditSummaryJob } from './audit/audit-summary.job';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from './config/env';
import { HttpConnector } from './outbox/http-connector';
import { OutboxDispatcher } from './outbox/outbox.dispatcher';
import { OutboxScheduler } from './outbox/outbox.scheduler';

@Module({
  providers: [
    { provide: WORKER_ENV, useFactory: () => loadWorkerEnv() },
    HttpConnector,
    OutboxDispatcher,
    OutboxScheduler,
    // P04 · jangkar hash audit + ringkasan harian temuan anomali (ADR-0072).
    {
      provide: AUDIT_ANCHOR_STORE,
      useFactory: (env: WorkerEnv) => createAuditAnchorStore(env),
      inject: [WORKER_ENV],
    },
    AuditAnchorJob,
    AuditSummaryJob,
    AuditJobsScheduler,
  ],
  exports: [OutboxDispatcher, OutboxScheduler, AuditAnchorJob, AuditSummaryJob, AuditJobsScheduler],
})
export class WorkerModule {}
