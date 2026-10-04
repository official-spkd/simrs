import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppErrorFilter } from './common/error.filter';
import { genRequestId } from './common/request-id';
import type { ApiEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { IpThrottlerGuard, rateLimitThrottlers } from './infra/rate-limit';
import { RateLimitStorage } from './infra/rate-limit.storage';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthzModule } from './modules/authz/authz.module';
import { IamModule } from './modules/iam/iam.module';
import { MpiModule } from './modules/mpi/mpi.module';
import { DevToolsModule } from './modules/dev-tools/dev-tools.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FacilityModule } from './modules/facility/facility.module';
import { FormsModule } from './modules/forms/forms.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { RefModule } from './modules/ref/ref.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

/**
 * Akar aplikasi. Env diteruskan eksplisit (bukan dibaca saat impor) agar tes dan runtime memakai
 * konfigurasi yang sama persis. Modul domain baru didaftarkan di daftar `imports`.
 */
@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.NODE_ENV === 'test' ? 'silent' : 'info',
            genReqId: genRequestId,
            // Tanpa PHI di log: hanya metode, path tanpa query, status, durasi, request id.
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                path: req.url.split('?')[0],
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            transport:
              env.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        }),
        InfraModule.forRoot(env),
        // Batas laju per IP, per endpoint kredensial, dan per pengguna (infra/rate-limit.ts); penghitung di Redis
        // (RateLimitStorage) agar sama di semua instans API.
        ThrottlerModule.forRootAsync({
          inject: [RateLimitStorage],
          useFactory: (storage: RateLimitStorage) => ({ storage, throttlers: rateLimitThrottlers(env) }),
        }),
        HealthModule,
        AuthModule,
        IamModule,
        AuthzModule,
        TenancyModule,
        AuditModule,
        MpiModule,
        RefModule,
        FormsModule,
        DocumentsModule,
        NotificationsModule,
        SettingsModule,
        NumberingModule,
        FacilityModule,
        // Endpoint bantu pengembangan tidak terdaftar sama sekali di produksi (rute tidak ada → 404).
        ...(env.devTools ? [DevToolsModule] : []),
      ],
      providers: [
        { provide: APP_FILTER, useClass: AppErrorFilter },
        { provide: APP_GUARD, useClass: IpThrottlerGuard },
      ],
    };
  }
}
