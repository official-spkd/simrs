import { Module } from '@nestjs/common';
import { loadWorkerEnv, WORKER_ENV } from './config/env';
import { PERIODIC_JOB_REGISTRY, PERIODIC_JOBS } from './jobs/periodic-jobs';
import { PeriodicScheduler } from './jobs/periodic.scheduler';
import { BpjsConnector } from './outbox/bpjs-connector';
import { HttpConnector } from './outbox/http-connector';
import { OUTBOX_OPERATION_REGISTRY, OUTBOX_OPERATIONS } from './outbox/operations';
import { OutboxDispatcher } from './outbox/outbox.dispatcher';
import { OutboxScheduler } from './outbox/outbox.scheduler';

@Module({
  providers: [
    { provide: WORKER_ENV, useFactory: () => loadWorkerEnv() },
    { provide: OUTBOX_OPERATION_REGISTRY, useValue: OUTBOX_OPERATIONS },
    { provide: PERIODIC_JOB_REGISTRY, useValue: PERIODIC_JOBS },
    HttpConnector,
    BpjsConnector,
    OutboxDispatcher,
    OutboxScheduler,
    PeriodicScheduler,
  ],
  exports: [OutboxDispatcher, OutboxScheduler, PeriodicScheduler],
})
export class WorkerModule {}
