import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, PrismaClient, withTenant, type TenantTx } from '@simrs/db';
import { API_ENV, type ApiEnv } from '../config/env';

/** Satu-satunya pintu ke DB. Runtime memakai role simrs_app (tanpa BYPASSRLS). */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = createPrismaClient({ connectionString: env.DATABASE_URL });
  }

  /** Semua akses data domain lewat sini agar RLS selalu punya konteks tenant. */
  forTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return withTenant(this.client, tenantId, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
