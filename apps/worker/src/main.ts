import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Baris log tetap setelah bootstrap (penjadwal outbox sudah berjalan). Worker tidak punya port HTTP; E2E menunggu
 * baris ini sebagai tanda siap (`webServer.wait.stdout` di apps/web/playwright.config.ts): ubah keduanya bersamaan.
 */
const READY_LOG = 'Worker outbox siap';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('Worker').log(READY_LOG);
}

void main();
