import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { isAuthRateLimited } from './common/auth-rate-limited.decorator';
import { AppErrorFilter } from './common/error.filter';
import { genRequestId } from './common/request-id';
import type { ApiEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { DomainEventsModule } from './infra/events/domain-events.module';
import { InfraModule } from './infra/infra.module';
import { LookupModule } from './infra/lookup/lookup.module';
import { RealtimeModule } from './infra/realtime/realtime.module';
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
import { BookingModule } from './modules/booking/booking.module';
import { KioskModule } from './modules/kiosk/kiosk.module';
import { PatientPortalGatewayModule } from './modules/patient-portal-gateway/patient-portal-gateway.module';
import { QueueModule } from './modules/queue/queue.module';
import { ReferralModule } from './modules/referral/referral.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { SepModule } from './modules/sep/sep.module';

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
        // Per IP per menit. Di RS banyak staf berbagi satu IP (NAT); batas per pengguna menyusul di P02.
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MIN },
          // Batas ketat khusus endpoint kredensial (@AuthRateLimited), per IP per menit.
          {
            name: 'auth',
            ttl: 60_000,
            limit: env.AUTH_RATE_LIMIT_PER_MIN,
            skipIf: (ctx) => !isAuthRateLimited(ctx),
          },
        ]),
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
        // Fase 2 · infrastruktur front office: event domain (sinkron), lookup sinkron (ADR-0025), SSE (ADR-0026).
        DomainEventsModule,
        LookupModule,
        RealtimeModule,
        // Fase 2 · modul front office F01–F08 (kerangka dulu; isi per potongan, tanpa mengubah daftar ini lagi).
        SchedulingModule,
        BookingModule,
        RegistrationModule,
        QueueModule,
        KioskModule,
        SepModule,
        ReferralModule,
        PatientPortalGatewayModule,
        // Endpoint bantu pengembangan tidak terdaftar sama sekali di produksi (rute tidak ada → 404).
        ...(env.devTools ? [DevToolsModule] : []),
      ],
      providers: [
        { provide: APP_FILTER, useClass: AppErrorFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    };
  }
}
