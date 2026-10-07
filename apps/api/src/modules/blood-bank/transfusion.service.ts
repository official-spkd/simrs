import { Injectable } from '@nestjs/common';
import {
  AppError,
  newId,
  normalizeScanCode,
  SUPPORT_ERRORS,
  type SupportErrorCode,
  transfusionReactionCheck,
  type TransfusionRecord,
  type TransfusionStartInput,
  type TransfusionStopInput,
  type TransfusionVerifyInput,
  type TransfusionVitalsInput,
  type TransfusionVitalsResult,
} from '@simrs/shared';
import type { z } from 'zod';
import type { transfusionReactionInputSchema } from '@simrs/shared';
import { AuditedDenial } from '../../common/audited-denial';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import {
  assertSupportItem,
  inSupportWindow,
  supportScope,
  supportWrite,
} from '../../infra/clinical/support-access';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { loadTransfusion } from './blood-records';

type ReactionInput = z.infer<typeof transfusionReactionInputSchema>;

/**
 * S08 · Transfusi di samping pasien (ADR-0105). Gerbang wajib, ditegakkan trigger `transfusions`:
 * 1. gelang ↔ kantong: pemasang memindai gelang pasien (pindaian gelang fase 3, harus cocok dengan gelang aktif
 *    kunjungan permintaan) dan nomor kantong (harus sama dengan kantong yang dikeluarkan). Salah pasien/kantong
 *    menolak tanpa override (422, tercatat di audit walau transaksi batal);
 * 2. petugas kedua: transfusi baru `berjalan` setelah petugas LAIN memindai ulang gelang + kantong dari sesinya
 *    sendiri. Gelang tidak terbaca = ganti gelang beralasan (ADR-0096), bukan verifikasi manual.
 * TTV awal/15 menit/1 jam/selesai append-only; dugaan reaksi (gejala, suhu naik ≥ 1 °C, sistolik turun ≥ 30 mmHg)
 * menghentikan transfusi di transaksi yang sama; laporan reaksi transfusi beralasan.
 */
@Injectable()
export class TransfusionService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
  ) {}

  /** Pengeluaran kantong + akses (layanan: jendela; ruangan: ABAC pasien) + kunjungan berjalan. */
  private async issueFor(bloodIssueId: string) {
    const tx = this.db.tx();
    const issue = await tx.bloodIssue.findUnique({
      where: { id: bloodIssueId },
      include: {
        bloodUnit: { select: { bagNo: true } },
        encounter: { select: { status: true, endedAt: true } },
        transfusion: { select: { id: true, status: true } },
      },
    });
    if (!issue) throw new AppError('NOT_FOUND', 'Pengeluaran kantong tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(
      scope,
      this.access,
      issue.patientId,
      inSupportWindow(issue.encounter.status === 'in_progress', issue.encounter.endedAt),
    );
    return issue;
  }

  private async transfusionFor(id: string) {
    const tx = this.db.tx();
    await tx.$queryRaw`SELECT id FROM transfusions WHERE tenant_id = ${this.db.tenantId()}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const t = await tx.transfusion.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Transfusi tidak ditemukan', 404);
    await this.issueFor(t.bloodIssueId);
    return t;
  }

  private denial(code: SupportErrorCode, patientId: string, details: Record<string, unknown>): AuditedDenial {
    const def = SUPPORT_ERRORS[code];
    return new AuditedDenial(
      def.message,
      { resourceType: 'transfusion', patientId, details: { code, ...details } },
      undefined,
      { code, status: def.status },
    );
  }

  /** Pindaian gelang oleh pelaku (tabel pindaian fase 3). Tidak cocok → 422 tercatat. */
  private async scanWristband(encounterId: string, patientId: string, code: string, userId: string) {
    const tx = this.db.tx();
    const band = await tx.patientWristband.findFirst({
      where: { encounterId, code: code.trim(), voidedAt: null },
      select: { id: true },
    });
    if (!band) throw this.denial('BLOOD_WRONG_PATIENT', patientId, { encounterId });
    const scan = await tx.wristbandScan.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId,
        patientId,
        wristbandId: band.id,
        matched: true,
        scannedCode: code.trim(),
        userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'wristband_scan',
      resourceId: scan.id,
      patientId,
      details: { encounterId, matched: true, purpose: 'transfusi' },
    });
    return scan;
  }

  async start(input: TransfusionStartInput): Promise<TransfusionRecord> {
    const me = this.records.author();
    const issue = await this.issueFor(input.bloodIssueId);
    if (issue.encounter.status !== 'in_progress') {
      throw new AppError('CONFLICT', 'Transfusi hanya untuk kunjungan yang sedang berjalan', 409);
    }
    if (issue.transfusion) throw new AppError('CONFLICT', 'Kantong ini sudah dipasang', 409);
    const scan = await this.scanWristband(issue.encounterId, issue.patientId, input.wristbandCode, me.userId);
    if (normalizeScanCode(input.bagNo) !== normalizeScanCode(issue.bloodUnit.bagNo)) {
      throw this.denial('BLOOD_WRONG_BAG', issue.patientId, { bloodIssueId: issue.id });
    }
    const tx = this.db.tx();
    const id = newId();
    await supportWrite(() =>
      tx.transfusion.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          bloodIssueId: issue.id,
          encounterId: issue.encounterId,
          patientId: issue.patientId,
          startScanId: scan.id,
          startBagNo: input.bagNo.trim(),
          startedBy: me.userId,
        },
      }),
    );
    await tx.transfusionVital.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        transfusionId: id,
        label: 'awal',
        tempC: input.baseline.tempC,
        systolic: input.baseline.systolic,
        diastolic: input.baseline.diastolic,
        pulse: input.baseline.pulse,
        signs: [],
        recordedBy: me.userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'transfusion',
      resourceId: id,
      patientId: issue.patientId,
      details: { bloodIssueId: issue.id },
    });
    return loadTransfusion(tx, id);
  }

  /** Petugas kedua (bukan pemasang) memindai ulang gelang + kantong → transfusi berjalan. */
  async verify(id: string, input: TransfusionVerifyInput): Promise<TransfusionRecord> {
    const me = this.records.author();
    const t = await this.transfusionFor(id);
    if (t.status !== 'menunggu_verifikasi')
      throw new AppError('CONFLICT', 'Transfusi sudah diverifikasi', 409);
    if (t.startedBy === me.userId) {
      throw this.denial('BLOOD_SECOND_CHECKER_SAME', t.patientId, { transfusionId: id });
    }
    const scan = await this.scanWristband(t.encounterId, t.patientId, input.wristbandCode, me.userId);
    if (normalizeScanCode(input.bagNo) !== normalizeScanCode(t.startBagNo)) {
      throw this.denial('BLOOD_WRONG_BAG', t.patientId, { transfusionId: id });
    }
    await supportWrite(() =>
      this.db.tx().transfusion.update({
        where: { id },
        data: {
          status: 'berjalan',
          verifiedBy: me.userId,
          verifyScanId: scan.id,
          verifyBagNo: input.bagNo.trim(),
          verifiedAt: new Date(),
        },
      }),
    );
    this.db.audit({ action: 'update', resourceType: 'transfusion', resourceId: id, patientId: t.patientId });
    return loadTransfusion(this.db.tx(), id);
  }

  async vitals(id: string, input: TransfusionVitalsInput): Promise<TransfusionVitalsResult> {
    const me = this.records.author();
    const t = await this.transfusionFor(id);
    if (t.status !== 'berjalan') {
      throw new AppError(
        'CONFLICT',
        'TTV transfusi dicatat saat transfusi berjalan (setelah verifikasi)',
        409,
      );
    }
    if (input.label === 'awal') {
      throw new AppError('VALIDATION_FAILED', 'TTV awal dicatat saat pemasangan', 422, { fields: ['label'] });
    }
    const tx = this.db.tx();
    await tx.transfusionVital.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        transfusionId: id,
        label: input.label,
        tempC: input.tempC,
        systolic: input.systolic,
        diastolic: input.diastolic,
        pulse: input.pulse,
        signs: input.signs,
        recordedBy: me.userId,
      },
    });
    const baseline = await tx.transfusionVital.findFirst({
      where: { transfusionId: id, label: 'awal' },
      select: { tempC: true, systolic: true },
    });
    const check = transfusionReactionCheck(
      baseline ? { tempC: baseline.tempC.toNumber(), systolic: baseline.systolic } : null,
      input,
      input.signs,
    );
    if (check.reaction) {
      await supportWrite(() =>
        tx.transfusion.update({
          where: { id },
          data: {
            status: 'dihentikan',
            endedBy: me.userId,
            endedAt: new Date(),
            stopReason: `Dugaan reaksi transfusi: ${check.reasons.join(', ')}`.slice(0, 500),
          },
        }),
      );
    }
    this.db.audit({
      action: 'create',
      resourceType: 'transfusion_vital',
      resourceId: id,
      patientId: t.patientId,
      details: { label: input.label, reaction: check.reaction },
    });
    return { transfusion: await loadTransfusion(tx, id), reaction: check.reaction, reasons: check.reasons };
  }

  /** Selesai tanpa reaksi: wajib TTV 15 menit tercatat. */
  async finish(id: string): Promise<TransfusionRecord> {
    const me = this.records.author();
    const t = await this.transfusionFor(id);
    if (t.status !== 'berjalan') throw new AppError('CONFLICT', 'Tidak ada transfusi berjalan', 409);
    const tx = this.db.tx();
    if (
      !(await tx.transfusionVital.findFirst({
        where: { transfusionId: id, label: '15_menit' },
        select: { id: true },
      }))
    ) {
      throw new AppError('CONFLICT', 'Catat TTV 15 menit sebelum menutup transfusi', 409);
    }
    await supportWrite(() =>
      tx.transfusion.update({
        where: { id },
        data: { status: 'selesai', endedBy: me.userId, endedAt: new Date() },
      }),
    );
    this.db.audit({ action: 'update', resourceType: 'transfusion', resourceId: id, patientId: t.patientId });
    return loadTransfusion(tx, id);
  }

  /** Hentikan beralasan (mis. infus macet, pasien menolak). */
  async stop(id: string, input: TransfusionStopInput): Promise<TransfusionRecord> {
    const me = this.records.author();
    const t = await this.transfusionFor(id);
    if (t.status !== 'berjalan') throw new AppError('CONFLICT', 'Tidak ada transfusi berjalan', 409);
    const tx = this.db.tx();
    await supportWrite(() =>
      tx.transfusion.update({
        where: { id },
        data: { status: 'dihentikan', endedBy: me.userId, endedAt: new Date(), stopReason: input.reason },
      }),
    );
    this.db.audit({ action: 'update', resourceType: 'transfusion', resourceId: id, patientId: t.patientId });
    return loadTransfusion(tx, id);
  }

  /** Laporan reaksi transfusi (append-only); transfusi berjalan ikut dihentikan. */
  async reaction(input: ReactionInput): Promise<TransfusionRecord | null> {
    const me = this.records.author();
    const issue = await this.issueFor(input.bloodIssueId);
    const occurredAt = new Date(input.occurredAt);
    if (occurredAt.getTime() > Date.now() + 300_000) {
      throw new AppError('VALIDATION_FAILED', 'Waktu reaksi tidak boleh di masa depan', 422, {
        fields: ['occurredAt'],
      });
    }
    const tx = this.db.tx();
    const id = newId();
    await tx.transfusionReaction.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        bloodIssueId: issue.id,
        occurredAt,
        severity: input.severity,
        description: input.description,
        reportedBy: me.userId,
      },
    });
    if (issue.transfusion?.status === 'berjalan') {
      await supportWrite(() =>
        tx.transfusion.update({
          where: { id: issue.transfusion?.id },
          data: {
            status: 'dihentikan',
            endedBy: me.userId,
            endedAt: new Date(),
            stopReason: `Reaksi transfusi dilaporkan (${input.severity})`,
          },
        }),
      );
    }
    this.db.audit({
      action: 'create',
      resourceType: 'transfusion_reaction',
      resourceId: id,
      patientId: issue.patientId,
      details: { severity: input.severity },
    });
    return issue.transfusion ? loadTransfusion(tx, issue.transfusion.id) : null;
  }
}
