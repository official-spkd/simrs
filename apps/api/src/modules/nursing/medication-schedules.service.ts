import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import {
  emarScheduleForDay,
  emarScheduleTimes,
  isoDateJakarta,
  newId,
  type MedicationFrequency,
} from '@simrs/shared';
import { DomainEvents } from '../../infra/events/domain-events';

/** Jadwal dibuat idempoten dari order aktif; pengisian satu hari dibatasi durasi dan waktu order. */
@Injectable()
export class MedicationSchedulesService implements OnModuleInit {
  constructor(private readonly events: DomainEvents) {}

  onModuleInit(): void {
    this.events.on(
      'order.activated',
      (event, ctx) =>
        this.ensureDay(ctx.tx, ctx.tenantId, event.payload.medicationRequestIds, isoDateJakarta(new Date())),
      { label: 'nursing.medication-schedules' },
    );
  }

  async ensureDay(tx: TenantTx, tenantId: string, ids: string[], date: string): Promise<void> {
    if (ids.length === 0) return;
    const meds = await tx.medicationRequest.findMany({ where: { id: { in: ids } } });
    for (const m of meds) {
      if (m.frequency === 'prn' || m.frequency === 'stat') continue;
      const startDay = isoDateJakarta(m.createdAt);
      const days = Math.round(
        (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000,
      );
      if (days < 0 || (m.durationDays !== null && days >= m.durationDays)) continue;
      const times = emarScheduleTimes(m.frequency as MedicationFrequency, m.customTimes);
      const slots = emarScheduleForDay(date, times, m.createdAt);
      if (slots.length === 0) continue;
      await tx.medicationSchedule.createMany({
        data: slots.map((scheduledAt) => ({
          id: newId(),
          tenantId,
          medicationRequestId: m.id,
          encounterId: m.encounterId,
          scheduledAt,
        })),
        skipDuplicates: true,
      });
    }
  }
}
