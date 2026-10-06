import { Inject, Injectable } from '@nestjs/common';
import {
  type AdmissionResultApi,
  type AdmitInput,
  AppError,
  type BedRequestInput,
  type BedStatus,
  type BedStatusChangeInput,
  clinicalError,
  type DischargeInput,
  encounterClassToken,
  type EncounterClass,
  frontOfficeError,
  manualBedTransitionAllowed,
  newId,
  type TransferInput,
  type WristbandPrint,
} from '@simrs/shared';
import { CareTeamService } from '../../infra/clinical/care-team.service';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { SepService } from '../sep/sep.service';
import { newWristbandCode } from './adt-helpers';
import { BedOpsService } from './bed-ops.service';
import { DISCHARGE_GATE, type DischargeGate } from './discharge-gate';

const ACTIVE = ['planned', 'arrived', 'in_progress'] as const;
const stateInvalid = (message: string) => frontOfficeError('ENCOUNTER_STATE_INVALID', undefined, message);
const invalid = (message: string) => new AppError('VALIDATION_FAILED', message, 422);

/**
 * K04/K05 · ADT (rencana fase 3 §3.3): status bed manual berversi, permintaan + alokasi bed, admisi nyata (kunjungan
 * rawat inap `planned` → `in_progress` + bed + gelang + DPJP di tim + SEP rawat inap), transfer, pulang (lewat
 * `DischargeGate`), gelang. Setiap langkah: event domain, staging SATUSEHAT `held` Encounter + `billable_events`
 * (ADR-0032), Aplicare. Semua dalam transaksi permintaan; tidak ada panggilan BPJS langsung.
 */
@Injectable()
export class AdtService {
  constructor(
    private readonly db: TenantDb,
    private readonly beds: BedOpsService,
    private readonly events: DomainEvents,
    private readonly access: PatientAccessService,
    private readonly careTeam: CareTeamService,
    private readonly satusehat: SatusehatRecorder,
    private readonly billable: BillableRecorder,
    private readonly sep: SepService,
    @Inject(DISCHARGE_GATE) private readonly gate: DischargeGate,
  ) {}

  // ----------------------------------------------------------------------------------------------------------
  // Status bed manual
  // ----------------------------------------------------------------------------------------------------------

  async changeBedStatus(locationId: string, input: BedStatusChangeInput) {
    const bed = await this.beds.bedByLocation(locationId);
    await this.assertUnitScope(bed.unitId);
    if (bed.version !== input.baseVersion) throw clinicalError('BED_VERSION_CONFLICT');
    const from = bed.status as BedStatus;
    if (!manualBedTransitionAllowed(from, input.status)) {
      throw invalid(`Status bed tidak bisa diubah dari ${from} ke ${input.status} lewat papan`);
    }
    const keepEncounter = input.status === 'pulang' || input.status === 'terisi';
    const updated = await this.beds.setStatus(bed, input.status, {
      encounterId: keepEncounter ? bed.encounterId : null,
      note: input.note,
      baseVersion: input.baseVersion,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'bed_status',
      resourceId: locationId,
      details: { from, to: input.status, version: updated.version },
    });
    return { bedId: locationId, status: updated.status, version: updated.version };
  }

  // ----------------------------------------------------------------------------------------------------------
  // Permintaan dan alokasi bed
  // ----------------------------------------------------------------------------------------------------------

  async requestBed(input: BedRequestInput) {
    const enc = await this.activeEncounter(input.encounterId);
    await this.access.assert(enc.patientId);
    const id = newId();
    try {
      await this.db.tx().bedRequest.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          patientId: enc.patientId,
          encounterId: enc.id,
          origin: input.origin,
          careClass: input.careClass,
          unitId: input.unitId,
          isolation: input.isolation,
          note: input.note,
          requestedBy: this.db.actorUserId(),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new AppError('CONFLICT', 'Kunjungan ini sudah punya permintaan bed yang terbuka', 409);
      }
      throw err;
    }
    this.db.audit({
      action: 'create',
      resourceType: 'bed_request',
      resourceId: id,
      patientId: enc.patientId,
    });
    return { id };
  }

  async allocate(requestId: string, locationId: string) {
    const tx = this.db.tx();
    const req = await tx.bedRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new AppError('NOT_FOUND', 'Permintaan bed tidak ditemukan', 404);
    if (req.status !== 'menunggu' && req.status !== 'dialokasi') {
      throw new AppError('CONFLICT', 'Permintaan bed sudah ditutup', 409);
    }
    const bed = await this.beds.bedByLocation(locationId);
    await this.assertUnitScope(bed.unitId);
    if (bed.status !== 'siap') throw clinicalError('BED_NOT_AVAILABLE');
    const location = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { careClass: true, unit: { select: { kind: true } } },
    });
    if (location.unit.kind !== 'rawat_inap') throw invalid('Bed yang dialokasikan harus di unit rawat inap');
    // Alokasi ulang: bed lama kembali siap.
    if (req.allocatedLocationId && req.allocatedLocationId !== locationId) {
      await this.releaseReservation(req.allocatedLocationId, req.encounterId);
    }
    await this.beds.setStatus(bed, 'dipesan', { encounterId: req.encounterId });
    await tx.bedRequest.update({
      where: { id: req.id },
      data: {
        status: 'dialokasi',
        allocatedLocationId: locationId,
        allocatedAt: new Date(),
        allocatedBy: this.db.actorUserId(),
      },
    });
    this.db.audit({
      action: 'update',
      resourceType: 'bed_request',
      resourceId: req.id,
      patientId: req.patientId,
      details: { allocated: locationId },
    });
    return { id: req.id, bedId: locationId, status: 'dialokasi' as const };
  }

  async cancelRequest(requestId: string, reason: string) {
    const tx = this.db.tx();
    const req = await tx.bedRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new AppError('NOT_FOUND', 'Permintaan bed tidak ditemukan', 404);
    if (req.status !== 'menunggu' && req.status !== 'dialokasi') {
      throw new AppError('CONFLICT', 'Permintaan bed sudah ditutup', 409);
    }
    if (req.allocatedLocationId) await this.releaseReservation(req.allocatedLocationId, req.encounterId);
    await tx.bedRequest.update({
      where: { id: req.id },
      data: { status: 'batal', closedAt: new Date(), closedBy: this.db.actorUserId(), closeReason: reason },
    });
    this.db.audit({
      action: 'update',
      resourceType: 'bed_request',
      resourceId: req.id,
      patientId: req.patientId,
      reason,
      details: { status: 'batal' },
    });
    return { id: req.id, status: 'batal' as const };
  }

  // ----------------------------------------------------------------------------------------------------------
  // Admisi, transfer, pulang
  // ----------------------------------------------------------------------------------------------------------

  async admit(input: AdmitInput): Promise<AdmissionResultApi> {
    const tx = this.db.tx();
    await this.lockEncounter(input.encounterId);
    const enc = await tx.encounter.findUnique({ where: { id: input.encounterId } });
    if (!enc || enc.encounterClass !== 'IMP')
      throw new AppError('NOT_FOUND', 'Admisi rawat inap tidak ditemukan', 404);
    if (enc.status !== 'planned')
      throw stateInvalid('Hanya admisi berstatus rencana yang bisa dimasukkan ke bed');
    const bed = await this.beds.bedByLocation(input.locationId);
    await this.assertUnitScope(bed.unitId);
    const location = await tx.location.findUniqueOrThrow({
      where: { id: input.locationId },
      select: { unit: { select: { id: true, kind: true } } },
    });
    if (location.unit.kind !== 'rawat_inap') throw invalid('Bed admisi harus di unit rawat inap');
    if (enc.sourceEncounterId) await this.lockEncounter(enc.sourceEncounterId);
    const reservedForMe =
      bed.status === 'dipesan' &&
      bed.encounterId !== null &&
      [enc.id, enc.sourceEncounterId].includes(bed.encounterId);
    if (bed.status !== 'siap' && !reservedForMe) throw clinicalError('BED_NOT_AVAILABLE');

    // SEP rawat inap (utang fase 2): BPJS tanpa SEP untuk admisi ini wajib diagnosa awal.
    const coverage = await tx.coverage.findFirst({
      where: { encounterId: enc.id, status: 'active' },
      orderBy: { priority: 'asc' },
      select: { id: true, payer: { select: { kind: true } } },
    });
    const needsSep =
      coverage?.payer.kind === 'bpjs' && !(await tx.sep.findFirst({ where: { encounterId: enc.id } }));
    if (needsSep && !input.initialDiagnosis) {
      throw invalid('Admisi BPJS: isi diagnosa awal untuk SEP rawat inap');
    }

    const now = new Date();
    await this.beds.assign(enc.id, enc.patientId, input.locationId, now);
    await this.beds.setStatus(bed, 'terisi', { encounterId: enc.id });
    await tx.encounter.update({
      where: { id: enc.id },
      data: {
        status: 'in_progress',
        startedAt: now,
        unitId: location.unit.id,
        updatedBy: this.db.actorUserId(),
      },
    });
    await this.statusHistory(enc.id, 'planned', 'in_progress');
    await this.closeOpenRequests(
      [enc.id, ...(enc.sourceEncounterId ? [enc.sourceEncounterId] : [])],
      { placedAt: input.locationId },
      now,
    );
    const wristbandCode = await this.issueWristband(enc.id, enc.patientId, null);

    // DPJP admisi masuk tim perawatan (relasi akses, ADR-0031).
    if (enc.practitionerId) {
      const p = await tx.practitioner.findUnique({
        where: { id: enc.practitionerId },
        select: { userId: true },
      });
      const hasPrimary = await tx.encounterParticipant.findFirst({
        where: { encounterId: enc.id, role: 'dpjp_utama', endedAt: null },
      });
      if (p?.userId && !hasPrimary) {
        await this.careTeam.add({ encounterId: enc.id, userId: p.userId, role: 'dpjp_utama', at: now });
      }
    }

    // IGD asal selesai dengan disposisi rawat inap (keputusan fase 3 no. 7); bed IGD-nya kotor.
    if (enc.sourceEncounterId) {
      const src = await tx.encounter.findUnique({ where: { id: enc.sourceEncounterId } });
      if (src && src.encounterClass === 'EMER' && (ACTIVE as readonly string[]).includes(src.status)) {
        await this.finishEncounter(
          src.id,
          src.status,
          src.encounterClass as EncounterClass,
          src.patientId,
          src.unitId,
          'rawat_inap',
          now,
        );
      }
    }

    let sepId: string | null = null;
    if (needsSep && coverage && input.initialDiagnosis) {
      sepId = await this.sep.createPending({
        encounterId: enc.id,
        coverageId: coverage.id,
        referralId: enc.referralId,
        poliCode: null,
        diagnosis: input.initialDiagnosis,
        note: null,
        serviceType: 'rawat_inap',
      });
    }

    await this.events.publish('encounter.started', {
      encounterId: enc.id,
      patientId: enc.patientId,
      encounterClass: encounterClassToken('IMP'),
      unitId: location.unit.id,
    });
    await this.events.publish('adt.admitted', {
      encounterId: enc.id,
      patientId: enc.patientId,
      unitId: location.unit.id,
      bedId: input.locationId,
      sourceEncounterId: enc.sourceEncounterId,
    });
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'encounters',
      sourceId: enc.id,
      kind: 'admisi',
      occurredAt: now,
    });
    await this.satusehat.record('Encounter', enc.id, await this.encounterRevision(enc.id));
    this.db.audit({
      action: 'create',
      resourceType: 'admission',
      resourceId: enc.id,
      patientId: enc.patientId,
      details: { bed: input.locationId, sep: sepId !== null },
    });
    return { encounterId: enc.id, bedId: input.locationId, wristbandCode, sepId };
  }

  async transfer(input: TransferInput) {
    const tx = this.db.tx();
    await this.lockEncounter(input.encounterId);
    const enc = await tx.encounter.findUnique({ where: { id: input.encounterId } });
    if (!enc || enc.encounterClass !== 'IMP' || enc.status !== 'in_progress') {
      throw stateInvalid('Transfer hanya untuk pasien rawat inap yang sedang dirawat');
    }
    await this.access.assert(enc.patientId);
    const target = await this.beds.bedByLocation(input.locationId);
    const location = await tx.location.findUniqueOrThrow({
      where: { id: input.locationId },
      select: { unit: { select: { id: true, kind: true } } },
    });
    if (location.unit.kind !== 'rawat_inap') throw invalid('Bed tujuan harus di unit rawat inap');
    const reservedForMe = target.status === 'dipesan' && target.encounterId === enc.id;
    if (target.status !== 'siap' && !reservedForMe) throw clinicalError('BED_NOT_AVAILABLE');
    const now = new Date();
    const from = await this.beds.endOpenAssignment(enc.id, 'transfer', now);
    if (from === input.locationId) throw invalid('Bed tujuan sama dengan bed sekarang');
    const assignmentId = await this.beds.assign(enc.id, enc.patientId, input.locationId, now);
    await this.beds.setStatus(target, 'terisi', { encounterId: enc.id });
    if (from) await this.beds.vacate(from);
    await this.closeOpenRequests([enc.id], { placedAt: input.locationId }, now);
    await tx.encounter.update({
      where: { id: enc.id },
      data: { unitId: location.unit.id, updatedBy: this.db.actorUserId() },
    });
    const fromUnit = enc.unitId;
    await this.events.publish('adt.transferred', {
      encounterId: enc.id,
      patientId: enc.patientId,
      fromUnitId: fromUnit,
      toUnitId: location.unit.id,
      fromBedId: from,
      toBedId: input.locationId,
    });
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'bed_assignments',
      sourceId: assignmentId,
      kind: 'transfer',
      occurredAt: now,
    });
    await this.satusehat.record('Encounter', enc.id, await this.encounterRevision(enc.id));
    this.db.audit({
      action: 'update',
      resourceType: 'admission',
      resourceId: enc.id,
      patientId: enc.patientId,
      reason: input.reason,
      details: { transfer: { from, to: input.locationId } },
    });
    return { encounterId: enc.id, bedId: input.locationId, unitId: location.unit.id };
  }

  async discharge(input: DischargeInput) {
    const tx = this.db.tx();
    await this.lockEncounter(input.encounterId);
    const enc = await tx.encounter.findUnique({ where: { id: input.encounterId } });
    if (!enc || (enc.encounterClass !== 'IMP' && enc.encounterClass !== 'EMER')) {
      throw new AppError('NOT_FOUND', 'Kunjungan rawat inap/IGD tidak ditemukan', 404);
    }
    if (!(ACTIVE as readonly string[]).includes(enc.status) || enc.status === 'planned') {
      throw stateInvalid('Hanya kunjungan yang sedang dilayani yang bisa dipulangkan');
    }
    await this.access.assert(enc.patientId);
    const gate = await this.gate.check({
      encounterId: enc.id,
      encounterClass: enc.encounterClass as 'EMER' | 'IMP',
      disposition: input.disposition,
    });
    if (!gate.ok) throw clinicalError('DISCHARGE_BLOCKED', { reasons: gate.reasons });
    const now = new Date();
    const bedId = await this.finishEncounter(
      enc.id,
      enc.status,
      enc.encounterClass as EncounterClass,
      enc.patientId,
      enc.unitId,
      input.disposition,
      now,
    );
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'encounters',
      sourceId: enc.id,
      kind: 'pulang',
      occurredAt: now,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'discharge',
      resourceId: enc.id,
      patientId: enc.patientId,
      details: { disposition: input.disposition },
    });
    return { encounterId: enc.id, disposition: input.disposition, bedId };
  }

  // ----------------------------------------------------------------------------------------------------------
  // Gelang
  // ----------------------------------------------------------------------------------------------------------

  async wristband(encounterId: string): Promise<WristbandPrint> {
    const tx = this.db.tx();
    const band = await tx.patientWristband.findFirst({
      where: { encounterId, voidedAt: null },
      include: { patient: { select: { id: true, name: true, mrn: true, birthDate: true, sex: true } } },
    });
    if (!band) throw new AppError('NOT_FOUND', 'Gelang aktif tidak ditemukan', 404);
    await this.access.assert(band.patientId);
    this.db.audit({
      action: 'print',
      resourceType: 'wristband',
      resourceId: band.id,
      patientId: band.patientId,
    });
    return {
      encounterId,
      code: band.code,
      patientName: band.patient.name,
      rm: band.patient.mrn,
      birthDate: band.patient.birthDate ? band.patient.birthDate.toISOString().slice(0, 10) : null,
      sex: band.patient.sex,
      issuedAt: band.issuedAt.toISOString(),
    };
  }

  /** Cetak ulang beralasan: gelang lama batal (tutup-sekali), kode baru terbit. */
  async reprintWristband(encounterId: string, reason: string): Promise<WristbandPrint> {
    const enc = await this.activeEncounter(encounterId);
    await this.access.assert(enc.patientId);
    await this.issueWristband(enc.id, enc.patientId, reason);
    return this.wristband(enc.id);
  }

  // ----------------------------------------------------------------------------------------------------------
  // Bantu
  // ----------------------------------------------------------------------------------------------------------

  private async issueWristband(
    encounterId: string,
    patientId: string,
    voidReason: string | null,
  ): Promise<string> {
    const tx = this.db.tx();
    const now = new Date();
    await tx.patientWristband.updateMany({
      where: { encounterId, voidedAt: null },
      data: {
        voidedAt: now,
        voidedBy: this.db.actorUserId(),
        voidReason: voidReason ?? 'Gelang baru diterbitkan',
      },
    });
    const code = newWristbandCode();
    await tx.patientWristband.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId,
        patientId,
        code,
        issuedBy: this.db.actorUserId(),
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'wristband',
      resourceId: encounterId,
      patientId,
      reason: voidReason,
    });
    return code;
  }

  /** Tutup kunjungan: penempatan bed selesai (bed → kotor), gelang batal, tim berakhir, status + disposisi. */
  private async finishEncounter(
    encounterId: string,
    fromStatus: string,
    encounterClass: EncounterClass,
    patientId: string,
    unitId: string,
    disposition: 'pulang' | 'rujuk' | 'pulang_paksa' | 'meninggal' | 'pindah_rawat' | 'rawat_inap',
    at: Date,
  ): Promise<string | null> {
    const tx = this.db.tx();
    const bedId = await this.beds.endOpenAssignment(
      encounterId,
      disposition === 'rawat_inap' ? 'transfer' : 'pulang',
      at,
    );
    if (bedId) await this.beds.vacate(bedId);
    // Permintaan bed yang belum ditempati (mis. pasien IGD pulang/meninggal saat menunggu bed): batal, bed pesanan
    // kembali siap. Admisi dari IGD sudah menutupnya sebagai `selesai` sebelum langkah ini.
    await this.closeOpenRequests([encounterId], { cancelReason: 'Pasien keluar sebelum menempati bed' }, at);
    await tx.patientWristband.updateMany({
      where: { encounterId, voidedAt: null },
      data: {
        voidedAt: at,
        voidedBy: this.db.actorUserId(),
        voidReason: 'Kunjungan selesai (pasien keluar)',
      },
    });
    const members = await tx.encounterParticipant.findMany({
      where: { encounterId, endedAt: null },
      select: { id: true },
    });
    for (const m of members) await this.careTeam.end(m.id, 'Kunjungan selesai', at);
    await tx.encounter.update({
      where: { id: encounterId },
      data: { status: 'finished', endedAt: at, disposition, updatedBy: this.db.actorUserId() },
    });
    await this.statusHistory(encounterId, fromStatus, 'finished');
    if (disposition !== 'rawat_inap') {
      await this.events.publish('adt.discharged', { encounterId, patientId, unitId, bedId, disposition });
    }
    await this.events.publish('encounter.finished', {
      encounterId,
      patientId,
      encounterClass: encounterClassToken(encounterClass),
      unitId,
    });
    await this.satusehat.record('Encounter', encounterId, await this.encounterRevision(encounterId));
    return bedId;
  }

  /**
   * Kunci baris kunjungan sampai commit: langkah ADT bersamaan pada kunjungan yang sama (klik ganda pulang, admisi,
   * transfer) berurutan, dan yang kedua membaca status terbaru (→ 409 `ENCOUNTER_STATE_INVALID` / `BED_NOT_AVAILABLE`),
   * bukan galat trigger 500 atau event ganda.
   */
  private async lockEncounter(id: string): Promise<void> {
    await this.db.tx().$queryRaw`SELECT id FROM encounters WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Bed yang masih `dipesan` untuk kunjungan ini kembali `siap`. */
  private async releaseReservation(locationId: string, encounterId: string): Promise<void> {
    const bed = await this.beds.bedByLocation(locationId);
    if (bed.status === 'dipesan' && bed.encounterId === encounterId) {
      await this.beds.setStatus(bed, 'siap', { encounterId: null });
    }
  }

  /**
   * Tutup permintaan bed terbuka kunjungan. `placedAt` = bed yang ditempati pasien → `selesai` di bed itu; bed lain
   * yang sempat dipesan untuknya dilepas (tanpa ini bed tersangkut `dipesan`: papan tidak punya transisi manual keluar
   * dari `dipesan`). `cancelReason` → `batal` beralasan, bed pesanan dilepas.
   */
  private async closeOpenRequests(
    encounterIds: string[],
    outcome: { placedAt: string } | { cancelReason: string },
    at: Date,
  ): Promise<void> {
    const tx = this.db.tx();
    const actor = this.db.actorUserId();
    const open = await tx.bedRequest.findMany({
      where: { encounterId: { in: encounterIds }, status: { in: ['menunggu', 'dialokasi'] } },
    });
    for (const req of open) {
      const placedAt = 'placedAt' in outcome ? outcome.placedAt : null;
      if (req.allocatedLocationId && req.allocatedLocationId !== placedAt) {
        await this.releaseReservation(req.allocatedLocationId, req.encounterId);
      }
      await tx.bedRequest.update({
        where: { id: req.id },
        data:
          placedAt === null
            ? {
                status: 'batal',
                closedAt: at,
                closedBy: actor,
                closeReason: (outcome as { cancelReason: string }).cancelReason,
              }
            : {
                status: 'selesai',
                closedAt: at,
                closedBy: actor,
                ...(req.allocatedLocationId === placedAt
                  ? {}
                  : { allocatedLocationId: placedAt, allocatedAt: at, allocatedBy: actor }),
              },
      });
      this.db.audit({
        action: 'update',
        resourceType: 'bed_request',
        resourceId: req.id,
        patientId: req.patientId,
        details: { status: placedAt === null ? 'batal' : 'selesai', bed: placedAt },
      });
    }
  }

  private statusHistory(encounterId: string, from: string | null, to: string) {
    return this.db.tx().encounterStatusHistory.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId,
        fromStatus: from,
        toStatus: to,
        changedBy: this.db.actorUserId(),
      },
    });
  }

  /** Revisi staging SATUSEHAT Encounter: naik setiap perubahan status atau penempatan bed. */
  async encounterRevision(encounterId: string): Promise<number> {
    const tx = this.db.tx();
    const [h, b] = await Promise.all([
      tx.encounterStatusHistory.count({ where: { encounterId } }),
      tx.bedAssignment.count({ where: { encounterId } }),
    ]);
    return Math.max(1, h + b);
  }

  private async activeEncounter(id: string) {
    const enc = await this.db.tx().encounter.findUnique({ where: { id } });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    if (!(ACTIVE as readonly string[]).includes(enc.status)) throw stateInvalid('Kunjungan tidak aktif');
    return enc;
  }

  /** `bed.write` berlingkup unit: hanya bed di unit penugasan (ADR-0031). */
  private async assertUnitScope(unitId: string): Promise<void> {
    if (this.db.permissionScope() === 'all') return;
    if (this.db.actor().unitId !== unitId) {
      throw new AppError('FORBIDDEN', 'Tempat tidur ini bukan di unit penugasan Anda', 403);
    }
  }
}
