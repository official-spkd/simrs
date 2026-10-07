import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import {
  AppError,
  clinicalError,
  frontOfficeError,
  idempotencyKeySchema,
  medicationRouteConflict,
  newId,
  type OrderEvaluation,
  type OrderGroup,
  type OrderSubmitInput,
} from '@simrs/shared';
import { requestFingerprint } from '../../common/idempotency';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { CdsService, type EvaluatedLine } from '../cds/cds.service';
import { ClinicalPdfService } from '../documents/clinical-pdf.service';
import { BILLABLE_FOR, OrdersView } from './orders-view';
import { hasPrescription, prescriptionSections } from './prescription';

/** Kunjungan yang boleh diberi order: sudah datang dan belum selesai/batal. */
const ORDERABLE_ENCOUNTER_STATUSES = ['arrived', 'in_progress'];

/** Peran tim perawatan yang boleh meninjau order residen (sama dengan co-sign CPPT). */
const REVIEWING_TEAM_ROLES = ['dpjp_utama', 'rawat_bersama'];

export type SubmitOutcome =
  | { kind: 'created'; group: OrderGroup }
  | { kind: 'replayed'; group: OrderGroup }
  | { kind: 'blocked'; evaluation: OrderEvaluation };

/**
 * K09 · CPOE (rencana fase 3 §3.4): pratinjau CDS, kirim order (Idempotency-Key), batal beralasan, resep.
 *
 * Kirim order dijalankan dalam satu transaksi pendek (`TenantDb.transaction`, handler `@NoRequestTransaction`) agar
 * kiriman yang DITOLAK CDS tetap tercatat: temuan `block` tanpa override beralasan → baris `cds_alerts` berkeputusan
 * `diblokir` + audit `denied` di-commit, lalu 422 `CDS_BLOCKED` (rencana §3.4: "semua di cds_alerts"). Kiriman yang
 * lolos: `order_groups` + order beku + status `aktif` + `cds_alerts` (diterima/override) + staging biaya dan SATUSEHAT
 * `held` (ADR-0032) + event `order.activated` + resep PDF ber-TTE (ADR-0029) bila penulis berwenang TTE
 * (`clinical.sign`). Order oleh penulis tanpa `clinical.sign` (residen) langsung aktif tetapi `needs_review` untuk
 * DPJP (keputusan fase 3 no. 4); resepnya ditandatangani saat ditinjau.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly cds: CdsService,
    private readonly view: OrdersView,
    private readonly satusehat: SatusehatRecorder,
    private readonly billable: BillableRecorder,
    private readonly events: DomainEvents,
    private readonly matrix: PermissionMatrix,
    private readonly pdf: ClinicalPdfService,
  ) {}

  /** Kunjungan aktif + akses pasien (ABAC). */
  private async encounter(encounterId: string) {
    const enc = await this.db.tx().encounter.findUnique({
      where: { id: encounterId },
      select: {
        id: true,
        patientId: true,
        status: true,
        number: true,
        unit: { select: { name: true } },
      },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    await this.access.assert(enc.patientId);
    return enc;
  }

  private present(encounterId: string, lines: readonly EvaluatedLine[]): OrderEvaluation {
    return {
      encounterId,
      blocked: lines.some((l) => l.blocked),
      lines: lines.map((l) => ({
        index: l.index,
        name: l.name,
        findings: l.findings.map((f) => ({
          level: f.level,
          rule: f.rule,
          ruleCode: f.ruleCode,
          message: f.message,
        })),
        top: l.top,
        blocked: l.blocked,
        overridden: l.overridden,
      })),
    };
  }

  /** Pratinjau CDS server (tidak menyimpan apa pun); pembacaan konteks pasien diaudit. */
  async evaluate(input: OrderSubmitInput): Promise<OrderEvaluation> {
    this.records.author();
    const enc = await this.encounter(input.encounterId);
    const { lines } = await this.cds.evaluate(enc, input.items);
    this.db.audit({
      action: 'read',
      resourceType: 'order_evaluation',
      patientId: enc.patientId,
      details: { encounterId: enc.id, lines: lines.length, blocked: lines.filter((l) => l.blocked).length },
    });
    return this.present(enc.id, lines);
  }

  /** Penulis berwenang TTE (`clinical.sign`) menurut matriks peran RS. */
  private async canSign(role: string): Promise<boolean> {
    return (await this.matrix.cache.scope(this.db.tenantId(), role, 'clinical', 'sign')) !== null;
  }

  /**
   * Kirim order. Dipanggil di dalam `TenantDb.transaction()` oleh controller. Idempotency-Key (UUID) dikunci advisory
   * per RS; kunci sama + isi sama → kiriman yang sudah ada; isi berbeda → 409 `IDEMPOTENCY_KEY_REUSED`.
   */
  async submit(rawKey: unknown, input: OrderSubmitInput): Promise<SubmitOutcome> {
    const author = this.records.author();
    const key = idempotencyKeySchema.safeParse(
      typeof rawKey === 'string' ? rawKey.trim().toLowerCase() : rawKey,
    );
    if (!key.success) throw frontOfficeError('IDEMPOTENCY_KEY_REQUIRED');
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const enc = await this.encounter(input.encounterId);
    const hash = requestFingerprint(author.userId, input);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:orders.submit:${key.data}`}, 0))`;
    const existing = await tx.orderGroup.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key.data } },
      select: { id: true, requestHash: true },
    });
    if (existing) {
      if (existing.requestHash !== hash) throw frontOfficeError('IDEMPOTENCY_KEY_REUSED');
      const group = await this.view.group(existing.id);
      if (!group) throw new AppError('NOT_FOUND', 'Kiriman order tidak ditemukan', 404);
      return { kind: 'replayed', group };
    }
    if (!ORDERABLE_ENCOUNTER_STATUSES.includes(enc.status)) {
      throw new AppError('CONFLICT', 'Order hanya untuk kunjungan yang sedang berjalan', 409);
    }
    if (input.orderSetId) {
      const set = await tx.orderSet.findUnique({ where: { id: input.orderSetId }, select: { active: true } });
      if (!set?.active) throw new AppError('VALIDATION_FAILED', 'Order set tidak dikenal atau nonaktif', 422);
    }

    const { lines, patient } = await this.cds.evaluate(enc, input.items);
    // Keselamatan resep: rute obat tunggal tidak boleh bertentangan dengan bentuk sediaannya (injeksi + oral).
    for (const [i, line] of input.items.entries()) {
      const r = lines[i]?.resolved;
      if (line.type !== 'obat' || line.compound || r?.type !== 'obat') continue;
      const drug = r.drugs[0];
      if (drug && medicationRouteConflict(drug.dosageForm, line.route)) {
        throw clinicalError('MEDICATION_ROUTE_INVALID', {
          line: i,
          drug: drug.name,
          dosageForm: drug.dosageForm,
          route: line.route,
        });
      }
    }
    if (lines.some((l) => l.blocked)) {
      await this.recordAlerts(enc, author, lines, null);
      this.db.audit({
        action: 'create',
        resourceType: 'order_group',
        patientId: enc.patientId,
        outcome: 'denied',
        details: {
          reason: 'CDS_BLOCKED',
          encounterId: enc.id,
          blockedLines: lines.filter((l) => l.blocked).map((l) => l.index),
        },
      });
      return { kind: 'blocked', evaluation: this.present(enc.id, lines) };
    }

    const signer = await this.canSign(author.role);
    const groupId = newId();
    const orderedAt = new Date();
    await tx.orderGroup.create({
      data: {
        id: groupId,
        tenantId,
        encounterId: enc.id,
        patientId: enc.patientId,
        idempotencyKey: key.data,
        requestHash: hash,
        orderSetId: input.orderSetId,
        orderedBy: author.userId,
        orderedRole: author.role,
        needsReview: !signer,
        orderedAt,
      },
    });
    const lineIds: Array<{ serviceRequestId: string | null; medicationRequestId: string | null }> = [];
    const serviceRequestIds: string[] = [];
    const medicationRequestIds: string[] = [];
    for (const [i, line] of input.items.entries()) {
      const ev = lines[i] as EvaluatedLine;
      const r = ev.resolved;
      const base = { tenantId, orderGroupId: groupId, encounterId: enc.id, patientId: enc.patientId };
      if (line.type === 'layanan' && r.type === 'layanan') {
        const id = newId();
        await tx.serviceRequest.create({
          data: {
            ...base,
            id,
            orderableId: r.orderable.id,
            name: r.orderable.name,
            codeSystem: r.orderable.codeSystem,
            code: r.orderable.code,
            priority: line.priority,
            instructions: line.instructions,
          },
        });
        await tx.orderStatusEvent.create({
          data: { id: newId(), tenantId, serviceRequestId: id, status: 'aktif', changedBy: author.userId },
        });
        const billableKind = BILLABLE_FOR[r.orderable.kind];
        if (billableKind) {
          await this.billable.record({
            encounterId: enc.id,
            patientId: enc.patientId,
            sourceType: 'service_requests',
            sourceId: id,
            kind: billableKind,
            occurredAt: orderedAt,
          });
        }
        await this.satusehat.record('ServiceRequest', id, 1);
        serviceRequestIds.push(id);
        lineIds.push({ serviceRequestId: id, medicationRequestId: null });
      } else if (line.type === 'obat' && r.type === 'obat') {
        const id = newId();
        await tx.medicationRequest.create({
          data: {
            ...base,
            id,
            drugId: line.drugId,
            compound: line.compound ? (line.compound as unknown as Prisma.InputJsonValue) : undefined,
            name: r.name,
            dose: line.dose,
            route: line.route,
            frequency: line.frequency,
            customTimes: line.customTimes ?? [],
            durationDays: line.durationDays,
            instructions: line.instructions,
            highAlert: r.drugs.some((d) => d.highAlert),
          },
        });
        await tx.orderStatusEvent.create({
          data: { id: newId(), tenantId, medicationRequestId: id, status: 'aktif', changedBy: author.userId },
        });
        await this.satusehat.record('MedicationRequest', id, 1);
        medicationRequestIds.push(id);
        lineIds.push({ serviceRequestId: null, medicationRequestId: id });
      }
    }
    await this.recordAlerts(enc, author, lines, { groupId, lineIds });
    await this.events.publish('order.activated', {
      orderGroupId: groupId,
      encounterId: enc.id,
      patientId: enc.patientId,
      serviceRequestIds,
      medicationRequestIds,
      needsReview: !signer,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'order_group',
      resourceId: groupId,
      patientId: enc.patientId,
      details: {
        encounterId: enc.id,
        services: serviceRequestIds.length,
        medications: medicationRequestIds.length,
        overrides: lines.filter((l) => l.overridden).length,
        needsReview: !signer,
      },
    });

    const created = await this.view.group(groupId);
    if (!created) throw new Error('Kiriman order baru tidak terbaca');
    if (signer && hasPrescription(created)) {
      await this.issuePrescription(
        created,
        enc,
        patient.allergies.map((a) => a.label),
        'Dokter penulis resep',
      );
    }
    const group = await this.view.group(groupId);
    if (!group) throw new Error('Kiriman order baru tidak terbaca');
    return { kind: 'created', group };
  }

  /**
   * Lembar resep PDF ber-TTE pengguna sesi (ADR-0029) dari isi order TERSIMPAN, sumber `order_groups` (satu resep per
   * kiriman). Waktu terbit = waktu order, sehingga PDF bisa dibangun ulang dari data.
   */
  private async issuePrescription(
    group: OrderGroup,
    enc: { number: string; unit: { name: string } },
    allergies: readonly string[],
    role: string,
  ): Promise<void> {
    await this.pdf.issue({
      patientId: group.patientId,
      kind: 'lainnya',
      title: 'Resep',
      fileName: `resep ${enc.number}`,
      issuedAt: new Date(group.orderedAt),
      patientExtra: [
        { label: 'Kunjungan', value: enc.number },
        { label: 'Unit', value: enc.unit.name },
        { label: 'Penulis order', value: `${group.orderedBy.nama} (${group.orderedBy.peran})` },
      ],
      sections: prescriptionSections(group, allergies, await this.view.medicationOverrides(group.id)),
      source: { table: 'order_groups', id: group.id },
      tte: { role, caption: null },
    });
  }

  /**
   * Tinjauan DPJP atas order residen (keputusan fase 3 no. 4): peninjau wajib berwenang `clinical.sign` DAN DPJP utama,
   * rawat bersama, atau DPJP kunjungan (keputusan orkestrator, sama dengan co-sign 3.2b); atestasi
   * `review_order` (append-only, satu per peninjau, `clinical_attestations`); resep ber-TTE peninjau diterbitkan bila
   * kiriman memuat obat aktif dan belum punya resep. `order_groups` tidak diubah: "sudah ditinjau" = ada atestasinya.
   */
  async completeReview(groupId: string): Promise<OrderGroup> {
    const reviewer = this.records.author();
    if (!(await this.canSign(reviewer.role))) {
      throw new AppError('FORBIDDEN', 'Tinjauan order residen hanya oleh DPJP yang berwenang TTE', 403);
    }
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:orders.review:${groupId}`}, 0))`;
    const row = await tx.orderGroup.findUnique({
      where: { id: groupId },
      select: { id: true, patientId: true, encounterId: true, needsReview: true, orderedBy: true },
    });
    if (!row) throw new AppError('NOT_FOUND', 'Kiriman order tidak ditemukan', 404);
    await this.access.assert(row.patientId);
    if (!row.needsReview)
      throw new AppError('CONFLICT', 'Kiriman order ini tidak memerlukan tinjauan DPJP', 409);
    if (row.orderedBy === reviewer.userId) {
      throw new AppError('FORBIDDEN', 'Peninjau order bukan penulis order itu sendiri', 403);
    }
    // Atestasi atas pekerjaan orang lain (seperti co-sign CPPT 3.2b): hanya DPJP utama / rawat bersama aktif di tim
    // perawatan, atau DPJP kunjungan.
    const [member, enc] = await Promise.all([
      tx.encounterParticipant.findFirst({
        where: {
          encounterId: row.encounterId,
          userId: reviewer.userId,
          endedAt: null,
          role: { in: REVIEWING_TEAM_ROLES },
        },
        select: { id: true },
      }),
      tx.encounter.findUniqueOrThrow({
        where: { id: row.encounterId },
        select: { practitioner: { select: { userId: true } } },
      }),
    ]);
    if (!member && enc.practitioner?.userId !== reviewer.userId) {
      throw clinicalError(
        'COSIGN_NOT_ALLOWED',
        { kind: 'review_order' },
        'Tinjauan order residen hanya oleh DPJP utama, DPJP rawat bersama, atau DPJP kunjungan ini',
      );
    }
    const reviewed = await tx.clinicalAttestation.findFirst({
      where: { targetType: 'order_groups', targetId: groupId, kind: 'review_order' },
      select: { id: true },
    });
    if (reviewed) throw new AppError('CONFLICT', 'Kiriman order ini sudah ditinjau', 409);
    await this.records.insert(() =>
      tx.clinicalAttestation.create({
        data: {
          id: newId(),
          tenantId,
          patientId: row.patientId,
          encounterId: row.encounterId,
          targetType: 'order_groups',
          targetId: groupId,
          kind: 'review_order',
          userId: reviewer.userId,
          userRole: reviewer.role,
        },
      }),
    );
    const group = await this.view.group(groupId);
    if (!group) throw new Error('Kiriman order tidak terbaca');
    if (hasPrescription(group) && !group.prescription) {
      const enc = await this.encounter(row.encounterId);
      const patient = await this.cds.patientContext(row.encounterId, row.patientId);
      await this.issuePrescription(
        group,
        enc,
        patient.allergies.map((a) => a.label),
        'DPJP peninjau resep',
      );
    }
    this.db.audit({
      action: 'verify',
      resourceType: 'order_group',
      resourceId: groupId,
      patientId: row.patientId,
      details: { kind: 'review_order', encounterId: row.encounterId },
    });
    const done = await this.view.group(groupId);
    if (!done) throw new Error('Kiriman order tidak terbaca');
    return done;
  }

  /**
   * Catat setiap temuan CDS (append-only). Kiriman tersimpan: peringatan `diterima`, blok `override` dengan alasan.
   * Kiriman ditolak (`target` null): blok tanpa alasan `diblokir`, blok beralasan `override`, peringatan `diterima`.
   */
  private async recordAlerts(
    enc: { id: string; patientId: string },
    author: { userId: string; role: string },
    lines: readonly EvaluatedLine[],
    target: {
      groupId: string;
      lineIds: Array<{ serviceRequestId: string | null; medicationRequestId: string | null }>;
    } | null,
  ): Promise<void> {
    const data = lines.flatMap((l) =>
      l.findings.map((f) => {
        const decision = f.level !== 'block' ? 'diterima' : l.override ? 'override' : 'diblokir';
        return {
          id: newId(),
          tenantId: this.db.tenantId(),
          encounterId: enc.id,
          patientId: enc.patientId,
          orderGroupId: target?.groupId ?? null,
          serviceRequestId: target?.lineIds[l.index]?.serviceRequestId ?? null,
          medicationRequestId: target?.lineIds[l.index]?.medicationRequestId ?? null,
          lineIndex: l.index,
          ruleCode: f.ruleCode,
          ruleVersion: f.ruleVersion,
          level: f.level,
          rule: f.rule,
          message: f.message.slice(0, 500),
          decision,
          overrideReason: decision === 'override' ? l.override : null,
          decidedBy: author.userId,
          decidedRole: author.role,
        };
      }),
    );
    if (data.length > 0) await this.db.tx().cdsAlert.createMany({ data });
  }

  /** Batalkan satu order aktif (penunjang/tindakan atau obat) dengan alasan; isi order tetap (append-only). */
  async cancel(orderId: string, reason: string): Promise<OrderGroup> {
    const author = this.records.author();
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:orders.line:${orderId}`}, 0))`;
    const [service, medication] = await Promise.all([
      tx.serviceRequest.findUnique({
        where: { id: orderId },
        select: { id: true, orderGroupId: true, encounterId: true, patientId: true },
      }),
      tx.medicationRequest.findUnique({
        where: { id: orderId },
        select: { id: true, orderGroupId: true, encounterId: true, patientId: true },
      }),
    ]);
    const line = service ?? medication;
    if (!line) throw new AppError('NOT_FOUND', 'Order tidak ditemukan', 404);
    await this.access.assert(line.patientId);
    const last = await tx.orderStatusEvent.findFirst({
      where: service ? { serviceRequestId: orderId } : { medicationRequestId: orderId },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      select: { status: true },
    });
    if (last && last.status !== 'aktif') {
      throw new AppError(
        'CONFLICT',
        last.status === 'dibatalkan'
          ? 'Order ini sudah dibatalkan'
          : 'Order yang sudah selesai tidak bisa dibatalkan',
        409,
      );
    }
    await tx.orderStatusEvent.create({
      data: {
        id: newId(),
        tenantId,
        serviceRequestId: service ? orderId : null,
        medicationRequestId: service ? null : orderId,
        status: 'dibatalkan',
        reason,
        changedBy: author.userId,
      },
    });
    // Revisi 2 = status order berubah (dibatalkan); fase 7 mengirim ServiceRequest/MedicationRequest `revoked`.
    await this.satusehat.record(service ? 'ServiceRequest' : 'MedicationRequest', orderId, 2);
    await this.events.publish('order.cancelled', {
      orderId,
      orderType: service ? 'service' : 'medication',
      encounterId: line.encounterId,
      patientId: line.patientId,
    });
    this.db.audit({
      action: 'update',
      resourceType: service ? 'service_request' : 'medication_request',
      resourceId: orderId,
      patientId: line.patientId,
      reason,
      details: { status: 'dibatalkan', orderGroupId: line.orderGroupId },
    });
    const group = await this.view.group(line.orderGroupId);
    if (!group) throw new Error('Kiriman order tidak terbaca');
    return group;
  }

  /** Semua kiriman order satu kunjungan (terbaru dulu), dengan status dan resep. */
  async forEncounter(encounterId: string): Promise<OrderGroup[]> {
    const enc = await this.encounter(encounterId);
    const groups = await this.view.groups({ encounterId: enc.id });
    this.db.audit({
      action: 'read',
      resourceType: 'order_group',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: groups.length },
    });
    return groups;
  }
}
