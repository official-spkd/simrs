import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import {
  AppError,
  type ClinicalEntryMeta,
  ewsMaxParam,
  ewsNeedsEscalation,
  ewsRisk,
  ewsScore,
  type News2Consciousness,
  type VitalSignsInput,
  type VitalSignsRecord,
} from '@simrs/shared';
import { clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService, type ClinicalRowLike } from '../../infra/clinical/clinical-record.service';
import { SatusehatRecorder } from '../../infra/clinical/staging';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { NotificationsService } from '../notifications/notifications.service';

const CURRENT = { supersededBy: { none: {} } } as const;

/** Nilai tanda vital tersimpan di `observations.components` (panel tanpa kode LOINC). */
type VitalValues = VitalSignsRecord['values'];

type VitalRow = ClinicalRowLike & {
  encounterId: string;
  components: unknown;
  ewsScore: number | null;
  ewsMaxParam: number | null;
};

/** Interpretasi tersimpan dari tingkat risiko NEWS2 (arah tertulis, bukan hanya warna). */
const INTERPRETATION = { rendah: 'normal', sedang: 'abnormal', tinggi: 'kritis' } as const;

export const EWS_NOTIFICATION_KIND = 'ews_escalation';

/**
 * K12 (observasi) · Tanda vital dewasa + NEWS2 dihitung SERVER dari nilai (keputusan fase 3 no. 11; skor tidak pernah
 * diterima dari klien). Disimpan sebagai `observations` kategori `vital` berversi (ADR-0028). Eskalasi (skor ≥
 * `ews.escalation_score` atau satu parameter bernilai 3):
 * - SSE `ews.escalation` dari trigger `observations_vitals_notify` (kanal 3.1, saringan lingkup unit);
 * - notifikasi P09 TANPA PHI ke tim perawatan aktif + DPJP kunjungan (in-app + WhatsApp), tautan ke kunjungan.
 * Staging SATUSEHAT `held` Observation per versi.
 */
@Injectable()
export class VitalsService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly satusehat: SatusehatRecorder,
    private readonly notifications: NotificationsService,
  ) {}

  async record(encounterId: string, input: VitalSignsInput): Promise<VitalSignsRecord> {
    if (input.encounterId !== encounterId) {
      throw new AppError('VALIDATION_FAILED', 'encounterId body berbeda dengan path', 422, {
        fields: ['encounterId'],
      });
    }
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    const news2 = {
      rr: input.rr,
      spo2: input.spo2,
      onOxygen: input.onOxygen,
      sbp: input.sbp,
      hr: input.hr,
      consciousness: input.consciousness as News2Consciousness,
      temp: input.temp,
    };
    const score = ewsScore(news2);
    const maxParam = ewsMaxParam(news2);
    const risk = ewsRisk(score, maxParam).level;
    const values: VitalValues = {
      temp: input.temp,
      hr: input.hr,
      rr: input.rr,
      sbp: input.sbp,
      dbp: input.dbp,
      spo2: input.spo2,
      onOxygen: input.onOxygen,
      consciousness: input.consciousness,
      weightKg: input.weightKg,
    };
    const tx = this.db.tx();
    const f = await this.records.prepare('observations', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: { kind: 'baru' },
    });
    await this.records.insert(() =>
      tx.observation.create({
        data: {
          ...f,
          encounterId: enc.id,
          category: 'vital',
          display: 'Tanda vital',
          components: values,
          interpretation: INTERPRETATION[risk],
          ewsScore: score,
          ewsMaxParam: maxParam,
        },
      }),
    );
    await this.satusehat.record('Observation', f.id, f.version);
    const threshold = await readTenantSetting(tx, 'ews.escalation_score');
    const escalated = ewsNeedsEscalation(score, maxParam, threshold);
    this.db.audit({
      action: 'create',
      resourceType: 'observation',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { category: 'vital', ewsScore: score, escalated },
    });
    if (escalated) await this.escalate(enc, score, risk);
    const row = await tx.observation.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.present([row]))[0] as VitalSignsRecord;
  }

  async list(encounterId: string): Promise<VitalSignsRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().observation.findMany({
      where: { encounterId: enc.id, category: 'vital', status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    this.db.audit({
      action: 'read',
      resourceType: 'observation',
      patientId: enc.patientId,
      details: { category: 'vital', encounterId: enc.id, count: rows.length },
    });
    return this.present(rows);
  }

  async enteredInError(encounterId: string, id: string, reason: string): Promise<ClinicalEntryMeta> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const target = await this.db.tx().observation.findUnique({
      where: { id },
      select: { encounterId: true, category: true },
    });
    if (!target || target.encounterId !== enc.id || target.category !== 'vital') {
      throw new AppError('NOT_FOUND', 'Tanda vital tidak ditemukan di kunjungan ini', 404);
    }
    const done = await this.records.enteredInError('observations', id, reason);
    const row = await this.db.tx().observation.findUniqueOrThrow({ where: { id: done.id } });
    const meta = (await this.records.meta('observations', [row])).get(row.id) as ClinicalEntryMeta;
    await this.satusehat.record('Observation', meta.id, meta.version);
    this.db.audit({
      action: 'correct',
      resourceType: 'observation',
      resourceId: meta.id,
      patientId: enc.patientId,
      reason,
      details: { category: 'vital', version: meta.version, status: 'entered_in_error', supersedesId: id },
    });
    return meta;
  }

  async present(rows: VitalRow[]): Promise<VitalSignsRecord[]> {
    const meta = await this.records.meta('observations', rows);
    const threshold = await readTenantSetting(this.db.tx(), 'ews.escalation_score');
    return rows.map((r) => {
      const score = r.ewsScore ?? 0;
      const maxParam = r.ewsMaxParam ?? 0;
      return {
        ...(meta.get(r.id) as ClinicalEntryMeta),
        encounterId: r.encounterId,
        values: r.components as VitalValues,
        ews: {
          score,
          maxParam,
          risk: ewsRisk(score, maxParam).level,
          escalated: ewsNeedsEscalation(score, maxParam, threshold),
        },
      };
    });
  }

  /** Penerima: tim perawatan aktif + DPJP kunjungan (akun praktisi), selain pencatat. Isi tanpa PHI. */
  private async escalate(
    enc: { id: string; unitId: string; practitionerId: string | null },
    score: number,
    risk: string,
  ): Promise<void> {
    const tx = this.db.tx();
    const [team, practitioner, unit] = await Promise.all([
      tx.encounterParticipant.findMany({
        where: { encounterId: enc.id, endedAt: null },
        select: { userId: true },
      }),
      enc.practitionerId
        ? tx.practitioner.findUnique({ where: { id: enc.practitionerId }, select: { userId: true } })
        : null,
      tx.unit.findUnique({ where: { id: enc.unitId }, select: { name: true } }),
    ]);
    const me = this.db.actorUserId();
    const recipients = [...team.map((t) => t.userId), practitioner?.userId ?? null].filter(
      (u): u is string => !!u && u !== me,
    );
    await this.notifications.notify(
      recipients,
      {
        kind: EWS_NOTIFICATION_KIND,
        title: `Eskalasi EWS: skor ${score} (risiko ${risk})`,
        body: `Seorang pasien di ${unit?.name ?? 'unit Anda'} perlu ditinjau segera. Buka tautan untuk rinciannya.`,
        link: `/klinis/rawat-inap?kunjungan=${enc.id}`,
      },
      ['in_app', 'whatsapp'],
    );
  }
}
