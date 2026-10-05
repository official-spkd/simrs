import { Module } from '@nestjs/common';
import { loadWorkerEnv, WORKER_ENV } from './config/env';
import { KeyRotationJob } from './key-rotation/key-rotation.job';
import { HttpConnector } from './outbox/http-connector';
import { OutboxDispatcher } from './outbox/outbox.dispatcher';
import { OutboxScheduler } from './outbox/outbox.scheduler';

@Module({
  providers: [
    { provide: WORKER_ENV, useFactory: () => loadWorkerEnv() },
    HttpConnector,
    OutboxDispatcher,
    OutboxScheduler,
    KeyRotationJob,
  ],
  exports: [OutboxDispatcher, OutboxScheduler, KeyRotationJob],
})
export class WorkerModule {}
