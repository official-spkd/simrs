import { type DynamicModule, Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { TenantDb } from './tenant-db';

/** Konfigurasi tervalidasi + koneksi DB/Redis, tersedia global untuk semua modul. */
@Global()
@Module({})
export class InfraModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: InfraModule,
      providers: [{ provide: API_ENV, useValue: env }, PrismaService, RedisService, TenantDb],
      exports: [API_ENV, PrismaService, RedisService, TenantDb],
    };
  }
}
