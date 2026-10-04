import { Inject, Injectable } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '../infra/object-storage';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface Readiness {
  status: 'ok' | 'degraded';
  checks: Record<'database' | 'redis', CheckResult> & {
    /** `driver` = penyimpanan berkas yang dikonfigurasi (`disk` lokal atau `s3`), untuk label di layar status. */
    storage: CheckResult & { driver: ObjectStorage['driver'] };
  };
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
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async readiness(): Promise<Readiness> {
    const [database, redis, storage] = await Promise.all([
      timed(() => this.prisma.client.$queryRaw`SELECT 1`),
      timed(() => this.redis.ping()),
      // Penyimpanan berkas dokumen sesuai driver: disk = folder bisa ditulis; s3 = HeadBucket (S3 apa pun, ADR-0020).
      timed(() => this.storage.check()),
    ]);
    const checks = { database, redis, storage: { ...storage, driver: this.storage.driver } };
    return { status: Object.values(checks).every((c) => c.ok) ? 'ok' : 'degraded', checks };
  }
}
