import { Injectable } from '@nestjs/common';
import { allocateNumber, Prisma } from '@simrs/db';
import {
  AppError,
  aboCompatible,
  type BloodAboRule,
  type BloodBoard,
  type BloodBoardQuery,
  type BloodGroupInput,
  type BloodIssueCheckInput,
  bloodIssueBlock,
  type BloodIssueConfirmInput,
  type BloodRequestInput,
  type BloodRequestRecord,
  type BloodUnitInput,
  type BloodUnitRecord,
  newId,
  rhCompatible,
  supportError,
} from '@simrs/shared';
import type { z } from 'zod';
import type { crossmatchInputSchema } from '@simrs/shared';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import {
  assertSupportItem,
  inSupportWindow,
  patientsLite,
  supportScope,
  supportWrite,
} from '../../infra/clinical/support-access';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { COMPONENT_SELECT, loadRequests, toComponent, toUnit } from './blood-records';

type CrossmatchInput = z.infer<typeof crossmatchInputSchema>;

const MAX_REQUESTS = 200;
const MAX_UNITS = 300;
const ACTIVE = new Set(['diminta', 'diproses']);

/**
 * S08 · Bank darah (rencana fase 4 §4.9, keputusan no. 22, ADR-0105): permintaan darah DPJP (`BD-YYMM-NNNN`),
 * penerimaan + golongan pasien, crossmatch, cek ganda DUA petugas bank darah (sesi masing-masing) sebelum kantong
 * keluar, dan event `blood.unit_issued`. Gerbang ABO/Rh, crossmatch, ED, darurat golongan O, dan petugas kedua
 * ditegakkan trigger database; service ini memeriksa lebih dulu agar galatnya jelas. Transfusi di samping pasien
 * ada di `TransfusionService`.
 */
@Injectable()
export class BloodBankService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly events: DomainEvents,
  ) {}

  async board(q: BloodBoardQuery): Promise<BloodBoard> {
    const tx = this.db.tx();
    const now = new Date();
    const scope = await supportScope(this.db, this.access);
    const components = (
      await tx.bloodComponent.findMany({
        where: { active: true },
        orderBy: [{ code: 'asc' }],
        select: COMPONENT_SELECT,
      })
    ).map(toComponent);
    const base = { serverNow: now.toISOString(), view: scope.view, components };
    if ('none' in scope) return { ...base, requests: [], units: [] };
    const abac = scope.view === 'ruangan' ? Prisma.sql`AND ${scope.filter}` : Prisma.empty;
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const window =
      q.encounterId && scope.view === 'ruangan'
        ? Prisma.empty
        : Prisma.sql`AND (r.status IN ('diminta', 'diproses') OR r.updated_at >= ${since})`;
    const enc = q.encounterId ? Prisma.sql`AND r.encounter_id = ${q.encounterId}::uuid` : Prisma.empty;
    const rows = await tx.$queryRaw<Array<{ id: string; encounter_id: string; patient_id: string }>>`
      SELECT r.id::text AS id, r.encounter_id::text AS encounter_id, r.patient_id::text AS patient_id
      FROM blood_requests r
      JOIN patients p ON p.tenant_id = r.tenant_id AND p.id = r.patient_id
      WHERE true ${enc} ${window} ${abac}
      ORDER BY (r.status IN ('diminta', 'diproses')) DESC,
               CASE r.urgency WHEN 'darurat' THEN 0 WHEN 'cito' THEN 1 ELSE 2 END, r.requested_at, r.id
      LIMIT ${MAX_REQUESTS}`;
    const patients = await patientsLite(
      tx,
      rows.map((r) => r.encounter_id),
    );
    const requests = await loadRequests(
      tx,
      rows.map((r) => r.id),
      patients,
      now,
    );
    for (const pid of new Set(rows.map((r) => r.patient_id))) {
      this.db.audit({ action: 'read', resourceType: 'blood_request', patientId: pid });
    }
    const units: BloodUnitRecord[] =
      scope.view === 'layanan'
        ? (
            await tx.bloodUnit.findMany({
              where: { status: { in: ['tersedia', 'dicadangkan'] } },
              orderBy: [{ expiresAt: 'asc' }, { bagNo: 'asc' }],
              take: MAX_UNITS,
              include: { component: { select: COMPONENT_SELECT } },
            })
          ).map((u) => toUnit(u, now))
        : [];
    return { ...base, requests, units };
  }

  /** Satu permintaan + pemeriksaan akses (layanan: jendela aktif + 7 hari; ruangan: ABAC pasien). */
  private async requestFor(id: string, lock = false) {
    const tx = this.db.tx();
    if (lock) {
      await tx.$queryRaw`SELECT id FROM blood_requests WHERE tenant_id = ${this.db.tenantId()}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    const r = await tx.bloodRequest.findUnique({
      where: { id },
      include: { component: { select: COMPONENT_SELECT } },
    });
    if (!r) throw new AppError('NOT_FOUND', 'Permintaan darah tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(
      scope,
      this.access,
      r.patientId,
      inSupportWindow(ACTIVE.has(r.status), r.updatedAt),
    );
    return { r, scope };
  }

  async get(id: string): Promise<BloodRequestRecord> {
    const { r } = await this.requestFor(id);
    this.db.audit({ action: 'read', resourceType: 'blood_request', resourceId: id, patientId: r.patientId });
    return this.record(id, r.encounterId);
  }

  private async record(id: string, encounterId: string): Promise<BloodRequestRecord> {
    const tx = this.db.tx();
    const patients = await patientsLite(tx, [encounterId]);
    const [rec] = await loadRequests(tx, [id], patients, new Date());
    if (!rec) throw new AppError('NOT_FOUND', 'Permintaan darah tidak ditemukan', 404);
    return rec;
  }

  private active(r: { status: string }) {
    if (!ACTIVE.has(r.status)) {
      throw new AppError('CONFLICT', 'Permintaan darah sudah selesai atau batal', 409);
    }
  }

  async createRequest(input: BloodRequestInput): Promise<BloodRequestRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const enc = await tx.encounter.findUnique({
      where: { id: input.encounterId },
      select: { id: true, patientId: true, status: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(scope, this.access, enc.patientId, enc.status === 'in_progress');
    if (enc.status !== 'in_progress') {
      throw new AppError('CONFLICT', 'Permintaan darah hanya untuk kunjungan yang sedang berjalan', 409);
    }
    const component = await tx.bloodComponent.findUnique({
      where: { tenantId_code: { tenantId: this.db.tenantId(), code: input.componentCode } },
      select: { id: true, active: true },
    });
    if (!component?.active) {
      throw new AppError('VALIDATION_FAILED', 'Komponen darah tidak dikenal', 422, {
        fields: ['componentCode'],
      });
    }
    if ((input.patientAbo === null) !== (input.patientRh === null)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Golongan pasien diisi lengkap (ABO dan Rh) atau dikosongkan',
        422,
        {
          fields: ['patientAbo', 'patientRh'],
        },
      );
    }
    const { number } = await allocateNumber(tx, this.db.tenantId(), 'blood_request');
    const id = newId();
    await tx.bloodRequest.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        requestNo: number,
        encounterId: enc.id,
        patientId: enc.patientId,
        componentId: component.id,
        units: input.units,
        urgency: input.urgency,
        indication: input.indication,
        patientAbo: input.patientAbo,
        patientRh: input.patientRh,
        requestedBy: me.userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'blood_request',
      resourceId: id,
      patientId: enc.patientId,
      details: { requestNo: number, units: input.units, urgency: input.urgency },
    });
    return this.record(id, enc.id);
  }

  /** Bank darah menerima permintaan + sampel (label cocok): `diminta` → `diproses`. */
  async receive(id: string): Promise<BloodRequestRecord> {
    this.records.author();
    const { r } = await this.requestFor(id, true);
    if (r.status !== 'diminta') throw new AppError('CONFLICT', 'Permintaan sudah diterima', 409);
    await this.db.tx().bloodRequest.update({ where: { id }, data: { status: 'diproses' } });
    this.db.audit({
      action: 'update',
      resourceType: 'blood_request',
      resourceId: id,
      patientId: r.patientId,
    });
    return this.record(id, r.encounterId);
  }

  /** Golongan pasien diperiksa bank darah; terkunci setelah crossmatch pertama (trigger `BLOOD_GROUP_LOCKED`). */
  async setGroup(id: string, input: BloodGroupInput): Promise<BloodRequestRecord> {
    this.records.author();
    const { r } = await this.requestFor(id, true);
    this.active(r);
    await supportWrite(() =>
      this.db.tx().bloodRequest.update({
        where: { id },
        data: { patientAbo: input.abo, patientRh: input.rh, status: 'diproses' },
      }),
    );
    this.db.audit({
      action: 'update',
      resourceType: 'blood_request',
      resourceId: id,
      patientId: r.patientId,
      details: { group: true },
    });
    return this.record(id, r.encounterId);
  }

  /** Kantong: komponen sama, belum ED, tersedia (atau dicadangkan untuk permintaan ini), ABO/Rh kompatibel. */
  private async unitFor(
    unitId: string,
    req: { id: string; componentId: string; patientAbo: string | null; patientRh: string | null },
    rule: BloodAboRule,
  ) {
    const tx = this.db.tx();
    await tx.$queryRaw`SELECT id FROM blood_units WHERE tenant_id = ${this.db.tenantId()}::uuid AND id = ${unitId}::uuid FOR UPDATE`;
    const u = await tx.bloodUnit.findUnique({ where: { id: unitId } });
    if (!u) throw new AppError('NOT_FOUND', 'Kantong tidak ditemukan', 404);
    if (u.componentId !== req.componentId) throw supportError('BLOOD_COMPONENT_MISMATCH');
    const mine = await tx.crossmatch.findFirst({
      where: { bloodRequestId: req.id, bloodUnitId: u.id, result: 'cocok' },
      select: { id: true },
    });
    if (
      u.expiresAt.getTime() <= Date.now() ||
      !(u.status === 'tersedia' || (u.status === 'dicadangkan' && mine))
    ) {
      throw supportError('BLOOD_UNIT_UNAVAILABLE');
    }
    if (
      (req.patientAbo && !aboCompatible(req.patientAbo as 'A', u.abo as 'A', rule)) ||
      (req.patientRh && !rhCompatible(req.patientRh as 'pos', u.rh as 'pos'))
    ) {
      throw supportError('BLOOD_INCOMPATIBLE');
    }
    return { u, crossmatched: !!mine };
  }

  async crossmatch(input: CrossmatchInput): Promise<BloodRequestRecord> {
    const me = this.records.author();
    const { r } = await this.requestFor(input.bloodRequestId, true);
    this.active(r);
    if (!r.patientAbo || !r.patientRh) throw supportError('BLOOD_GROUP_REQUIRED');
    const { u } = await this.unitFor(input.bloodUnitId, r, r.component.aboRule as BloodAboRule);
    const tx = this.db.tx();
    if (
      await tx.crossmatch.findFirst({
        where: { bloodRequestId: r.id, bloodUnitId: u.id },
        select: { id: true },
      })
    ) {
      throw new AppError('CONFLICT', 'Kantong ini sudah di-crossmatch untuk permintaan ini', 409);
    }
    await tx.crossmatch.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        bloodRequestId: r.id,
        bloodUnitId: u.id,
        result: input.result,
        method: input.method,
        testedBy: me.userId,
      },
    });
    if (input.result === 'cocok') {
      await tx.bloodUnit.update({ where: { id: u.id }, data: { status: 'dicadangkan' } });
    }
    if (r.status === 'diminta')
      await tx.bloodRequest.update({ where: { id: r.id }, data: { status: 'diproses' } });
    this.db.audit({
      action: 'create',
      resourceType: 'crossmatch',
      resourceId: r.id,
      patientId: r.patientId,
      details: { bloodUnitId: u.id, result: input.result },
    });
    return this.record(r.id, r.encounterId);
  }

  /** Cek ganda PERTAMA (lima butir) oleh petugas bank darah; kantong belum keluar. */
  async issueCheck(input: BloodIssueCheckInput): Promise<BloodRequestRecord> {
    const me = this.records.author();
    const { r } = await this.requestFor(input.bloodRequestId, true);
    this.active(r);
    const tx = this.db.tx();
    const issued = await tx.bloodIssue.count({ where: { bloodRequestId: r.id } });
    if (issued >= r.units)
      throw new AppError('CONFLICT', 'Jumlah kantong sesuai permintaan sudah keluar', 409);
    const rule = r.component.aboRule as BloodAboRule;
    const { u, crossmatched } = await this.unitFor(input.bloodUnitId, r, rule);
    const block = bloodIssueBlock({
      patientAbo: r.patientAbo as 'A' | null,
      patientRh: r.patientRh as 'pos' | null,
      unitAbo: u.abo as 'A',
      unitRh: u.rh as 'pos',
      unitExpired: u.expiresAt.getTime() <= Date.now(),
      crossmatchCompatible: crossmatched,
      emergencyReason: input.emergencyReason,
      rule,
    });
    if (block) throw supportError(block);
    if (crossmatched && input.emergencyReason) {
      throw new AppError('VALIDATION_FAILED', 'Alasan darurat hanya untuk kantong tanpa crossmatch', 422, {
        fields: ['emergencyReason'],
      });
    }
    const id = newId();
    await supportWrite(() =>
      tx.bloodIssueCheck.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          bloodRequestId: r.id,
          bloodUnitId: u.id,
          checklist: input.checklist,
          emergencyReason: input.emergencyReason,
          checkedBy: me.userId,
        },
      }),
    );
    this.db.audit({
      action: 'create',
      resourceType: 'blood_issue_check',
      resourceId: id,
      patientId: r.patientId,
      details: { bloodUnitId: u.id, emergency: input.emergencyReason !== null },
    });
    return this.record(r.id, r.encounterId);
  }

  /**
   * Pengeluaran oleh petugas KEDUA dari sesinya sendiri atas cek ganda pertama rekannya (≤ 30 menit). Kantong →
   * `dikeluarkan`; permintaan `selesai` bila jumlah kantong terpenuhi; event `blood.unit_issued`.
   */
  async confirmIssue(input: BloodIssueConfirmInput): Promise<BloodRequestRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const check = await tx.bloodIssueCheck.findUnique({
      where: { id: input.issueCheckId },
      include: { issue: { select: { id: true } } },
    });
    if (!check) throw new AppError('NOT_FOUND', 'Cek ganda tidak ditemukan', 404);
    const { r } = await this.requestFor(check.bloodRequestId, true);
    this.active(r);
    if (check.issue) throw new AppError('CONFLICT', 'Cek ganda ini sudah dipakai mengeluarkan kantong', 409);
    if (check.checkedBy === me.userId) throw supportError('BLOOD_SECOND_CHECKER_SAME');
    const issued = await tx.bloodIssue.count({ where: { bloodRequestId: r.id } });
    if (issued >= r.units)
      throw new AppError('CONFLICT', 'Jumlah kantong sesuai permintaan sudah keluar', 409);
    const enc = await tx.encounter.findUniqueOrThrow({
      where: { id: r.encounterId },
      select: { unitId: true },
    });
    const id = newId();
    await supportWrite(() =>
      tx.bloodIssue.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          bloodRequestId: r.id,
          bloodUnitId: check.bloodUnitId,
          encounterId: r.encounterId,
          patientId: r.patientId,
          emergencyReason: check.emergencyReason,
          issuedBy: me.userId,
          issueCheckId: check.id,
        },
      }),
    );
    await tx.bloodUnit.update({ where: { id: check.bloodUnitId }, data: { status: 'dikeluarkan' } });
    const next = issued + 1 >= r.units ? 'selesai' : 'diproses';
    if (next !== r.status) await tx.bloodRequest.update({ where: { id: r.id }, data: { status: next } });
    await this.events.publish('blood.unit_issued', {
      bloodIssueId: id,
      bloodUnitId: check.bloodUnitId,
      bloodRequestId: r.id,
      encounterId: r.encounterId,
      patientId: r.patientId,
      unitId: enc.unitId,
      emergency: check.emergencyReason !== null,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'blood_issue',
      resourceId: id,
      patientId: r.patientId,
      details: {
        bloodUnitId: check.bloodUnitId,
        issueCheckId: check.id,
        emergency: check.emergencyReason !== null,
      },
    });
    return this.record(r.id, r.encounterId);
  }

  /** Kantong masuk dari UTD/PMI (stok bank darah). */
  async registerUnit(input: BloodUnitInput): Promise<BloodUnitRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const component = await tx.bloodComponent.findUnique({
      where: { tenantId_code: { tenantId: this.db.tenantId(), code: input.componentCode } },
      select: { ...COMPONENT_SELECT, active: true },
    });
    if (!component?.active) {
      throw new AppError('VALIDATION_FAILED', 'Komponen darah tidak dikenal', 422, {
        fields: ['componentCode'],
      });
    }
    const collectedAt = new Date(input.collectedAt);
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt <= collectedAt || collectedAt.getTime() > Date.now() + 300_000) {
      throw new AppError('VALIDATION_FAILED', 'Tanggal ambil/kedaluwarsa kantong tidak masuk akal', 422, {
        fields: ['collectedAt', 'expiresAt'],
      });
    }
    const row = await tx.bloodUnit.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        bagNo: input.bagNo,
        componentId: component.id,
        abo: input.abo,
        rh: input.rh,
        collectedAt,
        expiresAt,
        createdBy: me.userId,
      },
      include: { component: { select: COMPONENT_SELECT } },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'blood_unit',
      resourceId: row.id,
      details: { abo: input.abo },
    });
    return toUnit(row, new Date());
  }
}
