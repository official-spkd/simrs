import './load-env';
import 'reflect-metadata';
import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadApiEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadApiEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app, env);

  // Batas waktu koneksi: menutup klien lambat (slowloris) tanpa memotong permintaan normal.
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  await app.listen(env.API_PORT, env.HOST);
}

// Galat yang lolos dari semua penanganan: catat lalu hentikan proses agar supervisor memulai ulang
// dalam keadaan bersih (lebih aman daripada berjalan dengan state tidak pasti).
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason instanceof Error ? reason.name : typeof reason);
  process.exit(1);
});

void main();
