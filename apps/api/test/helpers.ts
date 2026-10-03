import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { testDbUrls } from '@simrs/db/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadApiEnv } from '../src/config/env';

export const TENANT_A = '0199a000-0000-7000-8000-000000000001';
export const TENANT_B = '0199a000-0000-7000-8000-000000000002';

/** Bangun aplikasi persis seperti main.ts, dengan env yang bisa ditimpa per tes. DB = simrs_test (simrs_app). */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const env = loadApiEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'local',
    DATABASE_URL: testDbUrls().app,
    ...overrides,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true, rawBody: true });
  configureApp(app, env);
  await app.init();
  return app;
}
