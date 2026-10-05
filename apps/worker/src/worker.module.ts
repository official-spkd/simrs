import { Module } from '@nestjs/common';
import { AUDIT_ANCHOR_STORE, createAuditAnchorStore } from './audit/anchor-store';
import { AuditAnchorJob } from './audit/audit-anchor.job';
import { auditPeriodicJobs } from './audit/audit-periodic-jobs';
import { AuditSummaryJob } from './audit/audit-summary.job';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from './config/env';
import { PERIODIC_JOB_REGISTRY, PERIODIC_JOBS } from './jobs/periodic-jobs';
import { PeriodicScheduler } from './jobs/periodic.scheduler';
import { KeyRotationJob } from './key-rotation/key-rotation.job';
import { BpjsConnector } from './outbox/bpjs-connector';
import { HttpConnector } from './outbox/http-connector';
import { OUTBOX_OPERATION_REGISTRY, OUTBOX_OPERATIONS } from './outbox/operations';
import { OutboxDispatcher } from './outbox/outbox.dispatcher';
import { OutboxScheduler } from './outbox/outbox.scheduler';

@Module({
  providers: [
    { provide: WORKER_ENV, useFactory: () => loadWorkerEnv() },
    { provide: OUTBOX_OPERATION_REGISTRY, useValue: OUTBOX_OPERATIONS },
    // Peta job berkala P11 + job P04 yang butuh env (kunci jangkar, bucket WORM).
    {
      provide: PERIODIC_JOB_REGISTRY,
      useFactory: (anchors: AuditAnchorJob, summaries: AuditSummaryJob) =>
        new Map([...PERIODIC_JOBS, ...auditPeriodicJobs(anchors, summaries)]),
      inject: [AuditAnchorJob, AuditSummaryJob],
    },
    HttpConnector,
    BpjsConnector,
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
    PeriodicScheduler,
    KeyRotationJob,
  ],
  exports: [
    OutboxDispatcher,
    OutboxScheduler,
    PeriodicScheduler,
    AuditAnchorJob,
    AuditSummaryJob,
    KeyRotationJob,
  ],
})
export class WorkerModule {}
