import { type DynamicModule, Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

/** Konfigurasi tervalidasi + koneksi DB/Redis, tersedia global untuk semua modul. */
@Global()
@Module({})
export class InfraModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: InfraModule,
      providers: [{ provide: API_ENV, useValue: env }, PrismaService, RedisService],
      exports: [API_ENV, PrismaService, RedisService],
    };
  }
}
