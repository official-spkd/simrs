import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import {
  type AtsLevel,
  AppError,
  type CareTeamClaimResult,
  clinicalError,
  type EdBoardApi,
  type EdStatus,
  type EdStatusInput,
  type EdZone,
  encounterClassToken,
  type PayerKind,
  type SepStatus,
  frontOfficeError,
  isoDateJakarta,
  newId,
  SAFETY_REASON_MIN,
  suggestTriage,
  triageBlockReason,
  type TriageAssessmentInput,
  type TriageAssessmentRecord,
  type TriageDiscriminator,
  type TriageSuggestionApi,
  type TriageSuggestionInput,
  type TriageVitals,
} from '@simrs/shared';
import { ageYears } from '../../infra/clinical/clinical-context';
import { DEV_ROLE } from '../../common/request-context';
import { CareTeamService } from '../../infra/clinical/care-team.service';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { minutesSince } from '../adt/adt-helpers';
import { AdtService } from '../adt/adt.service';
import { BedOpsService } from '../adt/bed-ops.service';
import { PatientAccessService } from '../authz/patient-access.service';

const ACTIVE = ['arrived', 'in_progress'] as const;

/** Umur pasien untuk saran triase pada tanggal WIB saat penilaian (bukan tanggal UTC). */
export function triageAgeYears(birthDate: Date | null, now: Date): number | null {
  return ageYears(birthDate, isoDateJakarta(now));
}

/**
 * K03 · Triase IGD (rencana fase 3 §3.3, keputusan no. 6): saran ATS dihitung SERVER dari tanda vital + diskriminator
 * (`suggestTriage`, `@simrs/shared`), pilihan petugas berversi (`triage_assessments`, ADR-0028). Turun dari saran tanpa
 * alasan ≥ 10 → 422 `TRIAGE_REASON_REQUIRED`; di bawah batas protokol → 422 `TRIAGE_LEVEL_NOT_ALLOWED` (juga CHECK
 * database). Triase pertama memulai pelayanan klinis (`encounter.started`), staging biaya IGD dan SATUSEHAT Encounter.
 * Papan IGD + status alur (`ed_status_events`, penempatan bed IGD).
 */
@Injectable()
export class TriageService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly events: DomainEvents,
    private readonly beds: BedOpsService,
    private readonly adt: AdtService,
    private readonly satusehat: SatusehatRecorder,
    private readonly billable: BillableRecorder,
    private readonly careTeam: CareTeamService,
    private readonly matrix: PermissionMatrix,
  ) {}

  /**
   * "Ambil pasien" (keputusan orkestrator, tinjauan 3.6 pilihan c): dokter jaga (peran ber-`clinical.sign`) menjadi
   * penanggung jawab IGD = anggota tim `dpjp_utama` kunjungan IGD lewat `CareTeamService`, sehingga punya relasi resmi
   * untuk resume, surat kematian (K-1), dan dokumen ber-TTE lain tanpa akses darurat. Penanggung jawab lain yang masih
   * aktif digantikan (serah terima, keanggotaannya diakhiri beralasan). Diaudit.
   */
  async claim(encounterId: string): Promise<CareTeamClaimResult> {
    const tx = this.db.tx();
    const enc = await this.emergency(encounterId);
    await this.access.assert(enc.patientId);
    const actor = this.db.actor();
    const me = this.db.actorUserId();
    const doctor =
      !!me &&
      !!actor.role &&
      !actor.devicePrincipal &&
      (actor.role === DEV_ROLE ||
        (await this.matrix.scope(this.db.tenantId(), actor.role, 'clinical', 'sign')) !== null);
    if (!doctor || !me) {
      throw new AppError('FORBIDDEN', 'Ambil pasien hanya untuk dokter (berizin tanda tangan klinis)', 403);
    }
    await this.lockEncounter(enc.id);
    const current = await tx.encounterParticipant.findFirst({
      where: { encounterId: enc.id, role: 'dpjp_utama', endedAt: null },
    });
    if (current?.userId === me) {
      return { encounterId: enc.id, participantId: current.id, unchanged: true, replacedUserId: null };
    }
    if (current) await this.careTeam.end(current.id, 'Diambil alih dokter jaga IGD lain');
    const { id } = await this.careTeam.add({ encounterId: enc.id, userId: me, role: 'dpjp_utama' });
    this.db.audit({
      action: 'update',
      resourceType: 'care_team',
      resourceId: id,
      patientId: enc.patientId,
      details: { claim: true, role: 'dpjp_utama', replaced: current?.userId ?? null },
    });
    return {
      encounterId: enc.id,
      participantId: id,
      unchanged: false,
      replacedUserId: current?.userId ?? null,
    };
  }

  /** Pratinjau saran ATS untuk isian yang sedang diketik petugas (aturan yang sama dengan `assess`, tanpa menyimpan). */
  async suggest(input: TriageSuggestionInput): Promise<TriageSuggestionApi> {
    const enc = await this.emergency(input.encounterId);
    await this.access.assert(enc.patientId);
    const patient = await this.db.tx().patient.findUniqueOrThrow({
      where: { id: enc.patientId },
      select: { birthDate: true },
    });
    const age = triageAgeYears(patient.birthDate, new Date());
    const s = suggestTriage({ vitals: input.vitals, discriminators: input.discriminators, ageYears: age });
    return { level: s.level, maxLevel: s.maxLevel, reasons: s.reasons, ageYears: age };
  }

  async assess(input: TriageAssessmentInput): Promise<TriageAssessmentRecord> {
    const tx = this.db.tx();
    const enc = await this.emergency(input.encounterId);
    await this.access.assert(enc.patientId);
    // Triase dan status alur kunjungan yang sama berurutan (status otomatis `triase` di bawah membaca status terkini).
    await this.lockEncounter(enc.id);
    const now = new Date();
    const patient = await tx.patient.findUniqueOrThrow({
      where: { id: enc.patientId },
      select: { birthDate: true },
    });
    const suggestion = suggestTriage({
      vitals: input.vitals,
      discriminators: input.discriminators,
      ageYears: triageAgeYears(patient.birthDate, now),
    });
    const blocked = triageBlockReason(suggestion, input.chosenLevel, input.overrideReason, SAFETY_REASON_MIN);
    if (blocked)
      throw clinicalError(blocked, { suggestedLevel: suggestion.level, maxLevel: suggestion.maxLevel });
    const f = await this.records.prepare('triage_assessments', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    const overrideReason =
      input.chosenLevel > suggestion.level ? (input.overrideReason?.trim() ?? null) : null;
    await this.records.insert(() =>
      tx.triageAssessment.create({
        data: {
          ...f,
          encounterId: enc.id,
          scale: 'ATS',
          vitals: input.vitals,
          discriminators: [...input.discriminators],
          suggestedLevel: suggestion.level,
          maxLevel: suggestion.maxLevel,
          chosenLevel: input.chosenLevel,
          overrideReason,
          reasons: suggestion.reasons,
        },
      }),
    );
    if (enc.status === 'arrived') {
      await tx.encounter.update({
        where: { id: enc.id },
        data: { status: 'in_progress', startedAt: now, updatedBy: this.db.actorUserId() },
      });
      await tx.encounterStatusHistory.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          encounterId: enc.id,
          fromStatus: 'arrived',
          toStatus: 'in_progress',
          changedBy: this.db.actorUserId(),
        },
      });
      await this.events.publish('encounter.started', {
        encounterId: enc.id,
        patientId: enc.patientId,
        encounterClass: encounterClassToken('EMER'),
        unitId: enc.unitId,
      });
      await this.satusehat.record('Encounter', enc.id, await this.adt.encounterRevision(enc.id));
    }
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'encounters',
      sourceId: enc.id,
      kind: 'igd',
      occurredAt: f.occurredAt,
    });
    // Status alur: pasien yang baru terdaftar (belum berstatus atau `registrasi`) maju ke `triase` di zona/bed yang sama.
    const last = await this.lastStatus(enc.id);
    if (!last || last.status === 'registrasi') {
      await this.insertStatus(enc.id, enc.patientId, {
        status: 'triase',
        zone: (last?.zone as EdZone | null | undefined) ?? 'T',
        locationId: last?.locationId ?? null,
      });
    }
    this.db.audit({
      action: f.version > 1 ? 'correct' : 'create',
      resourceType: 'triage_assessment',
      resourceId: f.id,
      patientId: enc.patientId,
      reason: overrideReason ?? f.correctionReason,
      details: { level: input.chosenLevel, suggested: suggestion.level, override: overrideReason !== null },
    });
    const row = await tx.triageAssessment.findUniqueOrThrow({ where: { id: f.id } });
    const meta = (await this.records.meta('triage_assessments', [row])).get(row.id);
    if (!meta) throw new Error('meta triase hilang');
    return {
      ...meta,
      encounterId: enc.id,
      vitals: input.vitals,
      discriminators: [...input.discriminators],
      suggestedLevel: suggestion.level,
      maxLevel: suggestion.maxLevel,
      chosenLevel: input.chosenLevel,
      overrideReason,
      reasons: suggestion.reasons,
    };
  }

  /** Status alur IGD + zona; `locationId` = bed IGD (penempatan berpindah, bed lama kotor). */
  async setStatus(encounterId: string, input: EdStatusInput) {
    const tx = this.db.tx();
    const enc = await this.emergency(encounterId);
    await this.access.assert(enc.patientId);
    // Dua perubahan status kunjungan yang sama berurutan: yang kedua membaca penempatan + status terbaru.
    await this.lockEncounter(enc.id);
    const now = new Date();
    if (input.locationId) {
      const bed = await this.beds.bedByLocation(input.locationId);
      if (bed.unitId !== enc.unitId)
        throw new AppError('VALIDATION_FAILED', 'Bed bukan bed IGD kunjungan ini', 422);
      const open = await tx.bedAssignment.findFirst({ where: { encounterId: enc.id, endedAt: null } });
      if (open?.locationId !== input.locationId) {
        if (bed.status !== 'siap') throw clinicalError('BED_NOT_AVAILABLE');
        const from = await this.beds.endOpenAssignment(enc.id, 'transfer', now);
        await this.beds.assign(enc.id, enc.patientId, input.locationId, now);
        await this.beds.setStatus(bed, 'terisi', { encounterId: enc.id });
        if (from) await this.beds.vacate(from);
      }
    }
    const row = await this.insertStatus(enc.id, enc.patientId, input);
    return {
      id: row.id,
      encounterId: enc.id,
      status: input.status,
      zone: input.zone,
      at: row.changedAt.toISOString(),
    };
  }

  /**
   * Status alur terkini kunjungan: urut waktu ubah lalu id (UUID v7). Sebelumnya hanya `id desc`; id dua proses API
   * dalam milidetik yang sama tidak dijamin berurutan (utang 3.3).
   */
  private lastStatus(encounterId: string) {
    return this.db.tx().edStatusEvent.findFirst({
      where: { encounterId },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Catat event status alur. Waktu ubah dibuat naik ketat per kunjungan (≥ event terakhir + 1 ms, pemanggil memegang
   * kunci kunjungan), jadi urutan `changedAt desc` selalu sama dengan urutan pencatatan walau jam antar-instans API
   * sedikit berbeda atau dua event jatuh di milidetik yang sama.
   */
  private async insertStatus(
    encounterId: string,
    patientId: string,
    input: { status: EdStatus; zone: EdZone | null; locationId: string | null },
  ) {
    const last = await this.lastStatus(encounterId);
    const nowMs = Date.now();
    const changedAt = new Date(last ? Math.max(nowMs, last.changedAt.getTime() + 1) : nowMs);
    const id = newId();
    await this.db.tx().edStatusEvent.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        encounterId,
        status: input.status,
        zone: input.zone,
        locationId: input.locationId,
        changedAt,
        changedBy: this.db.actorUserId(),
      },
    });
    this.db.audit({
      action: 'update',
      resourceType: 'ed_status',
      resourceId: id,
      patientId,
      details: { status: input.status, zone: input.zone },
    });
    return { id, changedAt };
  }

  private async lockEncounter(id: string): Promise<void> {
    await this.db.tx().$queryRaw`SELECT id FROM encounters WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /**
   * Papan IGD unit penugasan (atau `unitId` bagi lingkup `all`); setiap pasien yang tampil diaudit `search`. Isi per
   * pasien mengikuti kebutuhan layar W3 (bentuk toko demo, ADR-0023 keputusan 4): identitas ringkas, penjamin, dokter,
   * triase terkini (tanda vital + alasan saran), penempatan bed IGD, permintaan bed, SEP IGD; plus bed unit IGD.
   */
  async board(unitId?: string, now: Date = new Date()): Promise<EdBoardApi> {
    const tx = this.db.tx();
    const scope = this.db.permissionScope();
    let target = unitId;
    if (scope !== 'all') {
      const own = this.db.actor().unitId;
      if (!own || (unitId && unitId !== own)) {
        throw new AppError('FORBIDDEN', 'Papan IGD unit lain di luar penugasan', 403);
      }
      target = own;
    }
    const unit = await tx.unit.findFirst({
      where: { kind: 'igd', active: true, ...(target ? { id: target } : {}) },
      orderBy: { code: 'asc' },
      select: { id: true, name: true },
    });
    if (!unit) throw new AppError('NOT_FOUND', 'Unit IGD tidak ditemukan', 404);
    const boardingHours = await readTenantSetting(tx, 'bed.boarding_alert_hours');
    const encounters = await tx.encounter.findMany({
      where: { unitId: unit.id, encounterClass: 'EMER', status: { in: [...ACTIVE] } },
      orderBy: { arrivedAt: 'asc' },
      select: {
        id: true,
        number: true,
        arrivedAt: true,
        createdAt: true,
        arrivalMode: true,
        practitioner: { select: { name: true } },
        patient: {
          select: { id: true, name: true, mrn: true, unidentified: true, sex: true, birthDate: true },
        },
        coverages: {
          where: { status: 'active' },
          orderBy: { priority: 'asc' },
          take: 1,
          select: { payer: { select: { kind: true, name: true } } },
        },
      },
    });
    const ids = encounters.map((e) => e.id);
    const [statuses, triages, requests, assignments, seps, igdBeds, leads] = await Promise.all([
      tx.edStatusEvent.findMany({
        where: { encounterId: { in: ids } },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      }),
      tx.$queryRaw<
        Array<{
          id: string;
          encounter_id: string;
          chosen_level: number;
          suggested_level: number;
          max_level: number;
          occurred_at: Date;
          vitals: TriageVitals;
          discriminators: string[];
          reasons: string[];
          override_reason: string | null;
        }>
      >`
        SELECT DISTINCT ON (encounter_id) id::text, encounter_id::text, chosen_level, suggested_level, max_level,
          occurred_at, vitals, discriminators, reasons, override_reason
        FROM triage_assessments_current
        WHERE encounter_id = ANY(${ids}::uuid[]) AND status = 'final'
        ORDER BY encounter_id, occurred_at DESC, recorded_at DESC, id DESC`,
      tx.bedRequest.findMany({
        where: { encounterId: { in: ids }, status: { in: ['menunggu', 'dialokasi'] } },
        include: { allocatedLocation: { select: { code: true } } },
      }),
      tx.bedAssignment.findMany({
        where: { encounterId: { in: ids }, endedAt: null },
        include: { location: { select: { code: true } } },
      }),
      tx.sep.findMany({
        where: { encounterId: { in: ids }, status: { not: 'cancelled' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, encounterId: true, status: true, sepNo: true },
      }),
      tx.location.findMany({
        where: { kind: 'bed', active: true, unitId: unit.id },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, parent: { select: { name: true } }, bedStatus: true },
      }),
      tx.encounterParticipant.findMany({
        where: { encounterId: { in: ids }, role: 'dpjp_utama', endedAt: null },
        select: { encounterId: true, userId: true, user: { select: { displayName: true } } },
      }),
    ]);
    const today = isoDateJakarta(now);
    const items: EdBoardApi['items'] = encounters.map((e) => {
      const st = statuses.find((s) => s.encounterId === e.id);
      const t = triages.find((x) => x.encounter_id === e.id);
      const r = requests.find((x) => x.encounterId === e.id);
      const a = assignments.find((b) => b.encounterId === e.id);
      const sep = seps.find((x) => x.encounterId === e.id);
      const payer = e.coverages[0]?.payer;
      const lead = leads.find((l) => l.encounterId === e.id);
      const wait = r ? minutesSince(r.requestedAt, now) : 0;
      return {
        encounterId: e.id,
        number: e.number,
        patientId: e.patient.id,
        patientName: e.patient.name,
        rm: e.patient.mrn,
        unidentified: e.patient.unidentified,
        sex: e.patient.sex as EdBoardApi['items'][number]['sex'],
        ageYears: ageYears(e.patient.birthDate, today),
        arrivalMode: (e.arrivalMode as EdBoardApi['items'][number]['arrivalMode']) ?? null,
        payer: payer ? { kind: payer.kind as PayerKind, name: payer.name } : null,
        doctor: lead?.user.displayName ?? e.practitioner?.name ?? null,
        doctorUserId: lead?.userId ?? null,
        arrivedAt: e.arrivedAt?.toISOString() ?? null,
        losMinutes: minutesSince(e.arrivedAt ?? e.createdAt, now),
        status: (st?.status as EdStatus | undefined) ?? null,
        zone: (st?.zone as EdZone | null | undefined) ?? null,
        bedId: a?.locationId ?? null,
        bedCode: a?.location.code ?? null,
        triage: t
          ? {
              id: t.id,
              level: t.chosen_level as AtsLevel,
              suggestedLevel: t.suggested_level as AtsLevel,
              maxLevel: t.max_level as AtsLevel,
              at: t.occurred_at.toISOString(),
              vitals: t.vitals,
              discriminators: t.discriminators as TriageDiscriminator[],
              reasons: t.reasons,
              overrideReason: t.override_reason,
            }
          : null,
        bedRequest: r
          ? {
              id: r.id,
              status: r.status as 'menunggu' | 'dialokasi',
              waitMinutes: wait,
              boarding: wait >= boardingHours * 60,
              allocatedBedCode: r.allocatedLocation?.code ?? null,
            }
          : null,
        sep: sep ? { id: sep.id, status: sep.status as SepStatus, number: sep.sepNo } : null,
      };
    });
    for (const i of items) {
      this.db.audit({ action: 'search', resourceType: 'ed_board', patientId: i.patientId });
    }
    return {
      asOf: now.toISOString(),
      unitId: unit.id,
      unitName: unit.name,
      items,
      beds: igdBeds.flatMap((l) =>
        l.bedStatus
          ? [
              {
                bedId: l.id,
                code: l.code,
                room: l.parent?.name ?? '',
                status: l.bedStatus.status as EdBoardApi['beds'][number]['status'],
                version: l.bedStatus.version,
                encounterId: l.bedStatus.encounterId,
              },
            ]
          : [],
      ),
    };
  }

  private async emergency(encounterId: string) {
    const enc = await this.db.tx().encounter.findUnique({ where: { id: encounterId } });
    if (!enc || enc.encounterClass !== 'EMER')
      throw new AppError('NOT_FOUND', 'Kunjungan IGD tidak ditemukan', 404);
    if (!(ACTIVE as readonly string[]).includes(enc.status)) {
      throw frontOfficeError('ENCOUNTER_STATE_INVALID', undefined, 'Kunjungan IGD tidak aktif');
    }
    return enc;
  }
}
