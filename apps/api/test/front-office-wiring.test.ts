/**
 * Fase 2 potongan 1b · Kerangka modul F01–F08 dan infrastruktur bersama terdaftar sekali di AppModule, sehingga potongan
 * berikutnya cukup mengisi folder modulnya tanpa mengubah app.module.ts.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/infra/events/domain-events';
import { LookupGateway } from '../src/infra/lookup/lookup.gateway';
import { PgNotificationHub } from '../src/infra/realtime/pg-notification-hub';
import { SseService } from '../src/infra/realtime/sse.service';
import { BookingModule } from '../src/modules/booking/booking.module';
import { KioskModule } from '../src/modules/kiosk/kiosk.module';
import { PatientPortalGatewayModule } from '../src/modules/patient-portal-gateway/patient-portal-gateway.module';
import { QueueModule } from '../src/modules/queue/queue.module';
import { ReferralModule } from '../src/modules/referral/referral.module';
import { RegistrationModule } from '../src/modules/registration/registration.module';
import { SchedulingModule } from '../src/modules/scheduling/scheduling.module';
import { SepModule } from '../src/modules/sep/sep.module';
import { createTestApp } from './helpers';

let app: NestExpressApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('kerangka fase 2', () => {
  it.each([
    ['F01', SchedulingModule],
    ['F02', BookingModule],
    ['F03', RegistrationModule],
    ['F04', QueueModule],
    ['F05', KioskModule],
    ['F06', SepModule],
    ['F07', ReferralModule],
    ['F08', PatientPortalGatewayModule],
  ])('%s terdaftar di AppModule', (_code, module) => {
    expect(() => app.select(module)).not.toThrow();
  });

  it('infrastruktur bersama tersedia global (satu instans)', () => {
    const fromQueue = app.select(QueueModule);
    expect(fromQueue.get(DomainEvents, { strict: false })).toBe(app.get(DomainEvents));
    expect(fromQueue.get(LookupGateway, { strict: false })).toBe(app.get(LookupGateway));
    expect(fromQueue.get(SseService, { strict: false })).toBe(app.get(SseService));
    expect(fromQueue.get(PgNotificationHub, { strict: false })).toBe(app.get(PgNotificationHub));
  });

  it('koneksi LISTEN tidak dibuka tanpa pelanggan', () => {
    expect(app.get(PgNotificationHub).isConnected()).toBe(false);
  });
});
