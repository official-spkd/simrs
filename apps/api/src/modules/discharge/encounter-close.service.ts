import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  clinicalError,
  encounterClassToken,
  type EncounterCloseInput,
  type EncounterCloseResult,
  frontOfficeError,
  newId,
} from '@simrs/shared';
import { SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { AdtService } from '../adt/adt.service';
import { DISCHARGE_GATE, type DischargeGate } from '../adt/discharge-gate';
import { PatientAccessService } from '../authz/patient-access.service';
import { QueueService } from '../queue/queue.service';

/**
 * K13 · Tutup kunjungan dari layar klinis (`POST /encounters/:id/close`), selalu lewat `DischargeGate`:
 * - rawat inap/IGD: diteruskan ke `AdtService.discharge` (bed kotor, gelang batal, tim berakhir, staging, event);
 *   dokter boleh memulangkan tanpa izin `bed.write` lewat jalur ini;
 * - rawat jalan (penutupan poli): resume RJ final ber-TTE → kunjungan `finished` + disposisi, staging SATUSEHAT
 *   `held` Encounter, event `encounter.finished`, dan tiket poli diselesaikan (`queue.ticket_finished` → task 5
 *   Antrean BPJS lewat mesin task ID). Tiket yang belum dimulai dimulai dulu agar urutan task 4 → 5 terjaga.
 */
@Injectable()
export class EncounterCloseService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly adt: AdtService,
    private readonly queue: QueueService,
    private readonly satusehat: SatusehatRecorder,
    private readonly events: DomainEvents,
    @Inject(DISCHARGE_GATE) private readonly gate: DischargeGate,
  ) {}

  async close(encounterId: string, input: EncounterCloseInput): Promise<EncounterCloseResult> {
    const tx = this.db.tx();
    const head = await tx.encounter.findUnique({
      where: { id: encounterId },
      select: { encounterClass: true, patientId: true },
    });
    if (!head) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    await this.access.assert(head.patientId);
    if (head.encounterClass !== 'AMB') {
      const r = await this.adt.discharge({ encounterId, disposition: input.disposition });
      return { encounterId: r.encounterId, disposition: r.disposition, queueTicketId: null, bedId: r.bedId };
    }

    await tx.$queryRaw`SELECT id FROM encounters WHERE id = ${encounterId}::uuid FOR UPDATE`;
    const enc = await tx.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    if (enc.status !== 'arrived' && enc.status !== 'in_progress') {
      throw frontOfficeError('ENCOUNTER_STATE_INVALID', undefined, 'Kunjungan ini sudah selesai atau batal');
    }
    const gate = await this.gate.check({
      encounterId,
      encounterClass: 'AMB',
      disposition: input.disposition,
    });
    if (!gate.ok) {
      if (gate.forbidden) throw new AppError('FORBIDDEN', gate.reasons.join('; '), 403);
      throw clinicalError('DISCHARGE_BLOCKED', { reasons: gate.reasons });
    }

    // Tiket poli → selesai (task 5). Tiket menunggu/dipanggil dimulai dulu (task 4) agar urutan BPJS utuh.
    let queueTicketId: string | null = null;
    if (enc.queueTicketId) {
      const ticket = await tx.queueTicket.findUnique({
        where: { id: enc.queueTicketId },
        select: { id: true, status: true },
      });
      if (ticket && ['waiting', 'called', 'serving'].includes(ticket.status)) {
        if (ticket.status !== 'serving') await this.queue.start(ticket.id);
        await this.queue.finish(ticket.id);
        queueTicketId = ticket.id;
      }
    }

    const now = new Date();
    await tx.encounter.update({
      where: { id: encounterId },
      data: {
        status: 'finished',
        startedAt: enc.startedAt ?? enc.arrivedAt ?? now,
        endedAt: now,
        disposition: input.disposition,
        updatedBy: this.db.actorUserId(),
      },
    });
    await tx.encounterStatusHistory.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId,
        fromStatus: enc.status,
        toStatus: 'finished',
        changedBy: this.db.actorUserId(),
      },
    });
    await this.events.publish('encounter.finished', {
      encounterId,
      patientId: enc.patientId,
      encounterClass: encounterClassToken('AMB'),
      unitId: enc.unitId,
    });
    await this.satusehat.record('Encounter', encounterId, await this.adt.encounterRevision(encounterId));
    this.db.audit({
      action: 'update',
      resourceType: 'encounter_close',
      resourceId: encounterId,
      patientId: enc.patientId,
      details: { disposition: input.disposition, queueTicketId },
    });
    return { encounterId, disposition: input.disposition, queueTicketId, bedId: null };
  }
}
