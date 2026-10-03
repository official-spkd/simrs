import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadApiEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadApiEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app, { webOrigin: env.WEB_BASE_URL, docs: env.NODE_ENV !== 'production' });
  await app.listen(env.API_PORT, '0.0.0.0');
}

void main();
