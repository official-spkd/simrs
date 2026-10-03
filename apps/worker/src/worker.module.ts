import { Module } from '@nestjs/common';
import { loadWorkerEnv, WORKER_ENV } from './config/env';
import { HttpConnector } from './outbox/http-connector';
import { OutboxDispatcher } from './outbox/outbox.dispatcher';
import { OutboxScheduler } from './outbox/outbox.scheduler';

@Module({
  providers: [
    { provide: WORKER_ENV, useFactory: () => loadWorkerEnv() },
    HttpConnector,
    OutboxDispatcher,
    OutboxScheduler,
  ],
  exports: [OutboxDispatcher, OutboxScheduler],
})
export class WorkerModule {}
