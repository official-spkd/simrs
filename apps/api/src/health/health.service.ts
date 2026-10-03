import { Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface Readiness {
  status: 'ok' | 'degraded';
  checks: Record<'database' | 'redis' | 'storage', CheckResult>;
}

const TIMEOUT_MS = 2000;

async function timed(fn: () => Promise<unknown>): Promise<CheckResult> {
  const start = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    // Hanya nama/kelas galat; tidak ada detail koneksi (kredensial) di respons.
    const error = err instanceof Error ? (err.message === 'timeout' ? 'timeout' : err.name) : 'error';
    return { ok: false, latencyMs: Math.round(performance.now() - start), error };
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async readiness(): Promise<Readiness> {
    const [database, redis, storage] = await Promise.all([
      timed(() => this.prisma.client.$queryRaw`SELECT 1`),
      timed(() => this.redis.ping()),
      // MinIO menyediakan endpoint kesehatan tanpa autentikasi. Untuk S3 lain, ganti dengan HeadBucket.
      timed(async () => {
        const res = await fetch(new URL('/minio/health/ready', this.env.S3_ENDPOINT));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }),
    ]);
    const checks = { database, redis, storage };
    return { status: Object.values(checks).every((c) => c.ok) ? 'ok' : 'degraded', checks };
  }
}
