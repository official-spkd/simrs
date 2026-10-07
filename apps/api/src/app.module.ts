import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppErrorFilter } from './common/error.filter';
import { genRequestId } from './common/request-id';
import type { ApiEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { DomainEventsModule } from './infra/events/domain-events.module';
import { InfraModule } from './infra/infra.module';
import { LookupModule } from './infra/lookup/lookup.module';
import { IpThrottlerGuard, rateLimitThrottlers } from './infra/rate-limit';
import { RateLimitStorage } from './infra/rate-limit.storage';
import { RealtimeModule } from './infra/realtime/realtime.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthzModule } from './modules/authz/authz.module';
import { IamModule } from './modules/iam/iam.module';
import { MpiModule } from './modules/mpi/mpi.module';
import { DevToolsModule } from './modules/dev-tools/dev-tools.module';
import { DevicesModule } from './modules/devices/devices.module';
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
import { ClinicalInfraModule } from './infra/clinical/clinical-infra.module';
import { DraftsModule } from './modules/drafts/drafts.module';
import { WorklistModule } from './modules/worklist/worklist.module';
import { EncounterModule } from './modules/encounter/encounter.module';
import { TriageModule } from './modules/triage/triage.module';
import { AdtModule } from './modules/adt/adt.module';
import { AssessmentModule } from './modules/assessment/assessment.module';
import { CpptModule } from './modules/cppt/cppt.module';
import { DiagnosisModule } from './modules/diagnosis/diagnosis.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CdsModule } from './modules/cds/cds.module';
import { ConsultModule } from './modules/consult/consult.module';
import { ConsentModule } from './modules/consent/consent.module';
import { NursingModule } from './modules/nursing/nursing.module';
import { DischargeModule } from './modules/discharge/discharge.module';
import { SummaryModule } from './modules/summary/summary.module';
import { CarePackagesModule } from './modules/care-packages/care-packages.module';
import { ResultsModule } from './modules/results/results.module';
import { SupportInfraModule } from './infra/support/support-infra.module';
import { LabModule } from './modules/lab/lab.module';
import { CriticalResultsModule } from './modules/critical-results/critical-results.module';
import { RadiologyModule } from './modules/radiology/radiology.module';
import { PharmacyClinicalModule } from './modules/pharmacy-clinical/pharmacy-clinical.module';
import { DispensingModule } from './modules/dispensing/dispensing.module';
import { MicroPaModule } from './modules/micro-pa/micro-pa.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { BloodBankModule } from './modules/blood-bank/blood-bank.module';

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
        // Fase 2 · infrastruktur front office: event domain (sinkron), lookup sinkron (ADR-0025), SSE (ADR-0026).
        DomainEventsModule,
        LookupModule,
        RealtimeModule,
        // Fase 2 · prinsipal perangkat anjungan/TV (ADR-0027).
        DevicesModule,
        // Fase 2 · modul front office F01–F08 (kerangka dulu; isi per potongan, tanpa mengubah daftar ini lagi).
        SchedulingModule,
        BookingModule,
        RegistrationModule,
        QueueModule,
        KioskModule,
        SepModule,
        ReferralModule,
        PatientPortalGatewayModule,
        // Fase 3 · infrastruktur klinis (potongan 3.1): pola entri berversi, staging, ABAC tim, SSE klinis, draf.
        ClinicalInfraModule,
        DraftsModule,
        // Fase 3 · modul klinis K01–K15 (kerangka dulu; isi per potongan 3.2–3.8, tanpa mengubah daftar ini lagi).
        WorklistModule,
        EncounterModule,
        TriageModule,
        AdtModule,
        AssessmentModule,
        CpptModule,
        DiagnosisModule,
        OrdersModule,
        CdsModule,
        ConsultModule,
        ConsentModule,
        NursingModule,
        DischargeModule,
        SummaryModule,
        CarePackagesModule,
        ResultsModule,
        // Fase 4 · infrastruktur penunjang (potongan 4.1a): SSE penunjang; modul S01–S10 (kerangka dulu, isi per
        // potongan 4.2–4.9). Stok (4.6a) dan kamar operasi (4.7) didaftarkan potongannya sendiri.
        SupportInfraModule,
        LabModule,
        CriticalResultsModule,
        RadiologyModule,
        PharmacyClinicalModule,
        DispensingModule,
        MicroPaModule,
        DiagnosticsModule,
        NutritionModule,
        BloodBankModule,
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
