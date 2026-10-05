import { type DynamicModule, Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env';
import { createObjectStorage, OBJECT_STORAGE } from './object-storage';
import { PermissionMatrix } from './permission-matrix';
import { PrismaService } from './prisma.service';
import { RateLimitStorage } from './rate-limit.storage';
import { RedisService } from './redis.service';
import { AuthGuard } from './auth/auth.guard';
import { DeviceGuard } from './auth/device.guard';
import { DevicePrincipals } from './auth/device-principals';
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
        DevicePrincipals,
        DeviceGuard,
        PermissionMatrix,
        { provide: OBJECT_STORAGE, useValue: createObjectStorage(env) },
      ],
      exports: [
        API_ENV,
        PrismaService,
        RedisService,
        RateLimitStorage,
        TenantDb,
        SessionStore,
        AuthGuard,
        DevicePrincipals,
        DeviceGuard,
        PermissionMatrix,
        OBJECT_STORAGE,
      ],
    };
  }
}
