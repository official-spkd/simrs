import { Injectable } from '@nestjs/common';
import { raiseCriticalResult } from '@simrs/db';
import { AppError } from '@simrs/shared';
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
    // Sumber ada & dalam tenant (404 yang jelas sebelum inti `@simrs/db`, yang juga dipakai worker analyzer).
    const found =
      input.source === 'lab'
        ? await tx.labResult.count({ where: { id: input.labResultId } })
        : input.source === 'radiology'
          ? await tx.imagingReport.count({ where: { id: input.imagingReportId } })
          : await tx.transfusionReaction.count({ where: { id: input.transfusionReactionId } });
    if (found === 0) {
      const what = {
        lab: 'Hasil lab',
        radiology: 'Ekspertise radiologi',
        transfusion: 'Reaksi transfusi',
      }[input.source];
      throw new AppError('NOT_FOUND', `${what} tidak ditemukan`, 404);
    }
    const row = await raiseCriticalResult(tx, this.db.tenantId(), {
      ...input,
      raisedBy: this.db.actorUserId(),
    });
    if (row.created) {
      await this.events.publish('critical_result.raised', {
        criticalResultId: row.id,
        source: input.source,
        sourceId:
          input.source === 'lab'
            ? input.labResultId
            : input.source === 'radiology'
              ? input.imagingReportId
              : input.transfusionReactionId,
        encounterId: row.encounterId,
        patientId: row.patientId,
        unitId: row.unitId,
        limitMinutes: row.limitMinutes,
      });
    }
    return { id: row.id, created: row.created, limitMinutes: row.limitMinutes };
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
}
