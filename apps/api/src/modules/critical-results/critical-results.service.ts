import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import { AppError, newId } from '@simrs/shared';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';

/** Sumber nilai kritis: hasil lab (per versi hasil) atau ekspertise radiologi (per versi ekspertise). */
export type RaiseCriticalInput = {
  /** Nama analit/temuan singkat untuk layar berizin (bukan untuk notifikasi). */
  analyte: string;
  /** Nilai/teks temuan untuk layar berizin (bukan untuk notifikasi). */
  valueText: string;
} & (
  | { source: 'lab'; labResultId: string }
  | { source: 'radiology'; imagingReportId: string }
  /** 4.9b (ADR-0108): reaksi transfusi berat (satu per laporan reaksi). */
  | { source: 'transfusion'; transfusionReactionId: string }
);

export interface RaisedCritical {
  id: string;
  /** false = nilai kritis untuk sumber ini sudah ada (panggilan ulang idempoten). */
  created: boolean;
  limitMinutes: number;
}

/**
 * S09 · Kerangka nilai kritis (rencana fase 4 §4.1a; dilengkapi 4.3). `raise()` dipakai lab (hasil di luar batas
 * kritis) dan radiologi (temuan kritis di ekspertise): satu nilai kritis per versi hasil/ekspertise (indeks unik
 * database), waktu muncul + status dari trigger (jam server), batas lapor dari pengaturan RS
 * (`critical.report_limit_minutes`), event `critical_result.raised` tanpa PHI. Kanal SSE `support_critical` ikut
 * terkirim dari trigger. Gerbang `hasOpenCritical*` memblokir validasi teknis lab / rilis ekspertise selama masih
 * terbuka (keputusan fase 4 no. 7). Penutupan HANYA lewat laporan ber-read-back (4.3; dijaga trigger).
 */
@Injectable()
export class CriticalResultsService {
  constructor(
    private readonly db: TenantDb,
    private readonly events: DomainEvents,
  ) {}

  async raise(input: RaiseCriticalInput): Promise<RaisedCritical> {
    const tx = this.db.tx();
    const source = await this.sourceOf(input);
    const existing = await tx.criticalResult.findFirst({
      where:
        input.source === 'lab'
          ? { labResultId: input.labResultId }
          : input.source === 'radiology'
            ? { imagingReportId: input.imagingReportId }
            : { transfusionReactionId: input.transfusionReactionId },
      select: { id: true, limitMinutes: true },
    });
    if (existing) return { id: existing.id, created: false, limitMinutes: existing.limitMinutes };
    const limitMinutes = await readTenantSetting(tx, 'critical.report_limit_minutes');
    const id = newId();
    await tx.criticalResult.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        source: input.source,
        labResultId: input.source === 'lab' ? input.labResultId : null,
        imagingReportId: input.source === 'radiology' ? input.imagingReportId : null,
        transfusionReactionId: input.source === 'transfusion' ? input.transfusionReactionId : null,
        encounterId: source.encounterId,
        patientId: source.patientId,
        unitId: source.unitId,
        analyte: input.analyte.slice(0, 120),
        valueText: input.valueText.slice(0, 200),
        limitMinutes,
        raisedBy: this.db.actorUserId(),
      },
    });
    await this.events.publish('critical_result.raised', {
      criticalResultId: id,
      source: input.source,
      sourceId:
        input.source === 'lab'
          ? input.labResultId
          : input.source === 'radiology'
            ? input.imagingReportId
            : input.transfusionReactionId,
      encounterId: source.encounterId,
      patientId: source.patientId,
      unitId: source.unitId,
      limitMinutes,
    });
    return { id, created: true, limitMinutes };
  }

  /** Gerbang validasi teknis lab: masih ada nilai kritis terbuka untuk hasil order lab ini (versi mana pun). */
  async hasOpenCritical(labOrderId: string): Promise<boolean> {
    const n = await this.db.tx().criticalResult.count({
      where: { status: 'terbuka', labResult: { labOrderId } },
    });
    return n > 0;
  }

  /** Gerbang rilis ekspertise radiologi: nilai kritis terbuka untuk studi ini. */
  async hasOpenCriticalForStudy(imagingStudyId: string): Promise<boolean> {
    const n = await this.db.tx().criticalResult.count({
      where: { status: 'terbuka', imagingReport: { imagingStudyId } },
    });
    return n > 0;
  }

  private async sourceOf(input: RaiseCriticalInput) {
    const tx = this.db.tx();
    if (input.source === 'lab') {
      const r = await tx.labResult.findUnique({
        where: { id: input.labResultId },
        select: { encounterId: true, patientId: true, labOrder: { select: { unitId: true } } },
      });
      if (!r) throw new AppError('NOT_FOUND', 'Hasil lab tidak ditemukan', 404);
      return { encounterId: r.encounterId, patientId: r.patientId, unitId: r.labOrder.unitId };
    }
    if (input.source === 'transfusion') {
      const x = await tx.transfusionReaction.findUnique({
        where: { id: input.transfusionReactionId },
        select: {
          bloodIssue: {
            select: { encounterId: true, patientId: true, encounter: { select: { unitId: true } } },
          },
        },
      });
      if (!x) throw new AppError('NOT_FOUND', 'Reaksi transfusi tidak ditemukan', 404);
      return {
        encounterId: x.bloodIssue.encounterId,
        patientId: x.bloodIssue.patientId,
        unitId: x.bloodIssue.encounter.unitId,
      };
    }
    const r = await tx.imagingReport.findUnique({
      where: { id: input.imagingReportId },
      select: { encounterId: true, patientId: true, imagingStudy: { select: { unitId: true } } },
    });
    if (!r) throw new AppError('NOT_FOUND', 'Ekspertise radiologi tidak ditemukan', 404);
    return { encounterId: r.encounterId, patientId: r.patientId, unitId: r.imagingStudy.unitId };
  }
}
