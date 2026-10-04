import { type DynamicModule, Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env';
import { DiskObjectStorage, OBJECT_STORAGE } from './object-storage';
import { PermissionMatrix } from './permission-matrix';
import { PrismaService } from './prisma.service';
import { RateLimitStorage } from './rate-limit.storage';
import { RedisService } from './redis.service';
import { AuthGuard } from './auth/auth.guard';
import { SessionStore } from './auth/session-store';
import { TenantDb } from './tenant-db';

/**
 * Konfigurasi tervalidasi + koneksi DB/Redis + penyimpanan berkas + penghitung batas laju + cache matriks izin,
 * tersedia global untuk semua modul.
 */
@Global()
@Module({})
export class InfraModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: InfraModule,
      providers: [
        { provide: API_ENV, useValue: env },
        PrismaService,
        RedisService,
        RateLimitStorage,
        TenantDb,
        SessionStore,
        AuthGuard,
        PermissionMatrix,
        { provide: OBJECT_STORAGE, useValue: new DiskObjectStorage(env.STORAGE_DISK_ROOT) },
      ],
      exports: [
        API_ENV,
        PrismaService,
        RedisService,
        RateLimitStorage,
        TenantDb,
        SessionStore,
        AuthGuard,
        PermissionMatrix,
        OBJECT_STORAGE,
      ],
    };
  }
}
