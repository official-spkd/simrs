import { Injectable } from '@nestjs/common';
import { Prisma, readTenantSetting } from '@simrs/db';
import {
  ewsNeedsEscalation,
  ewsRisk,
  isoDateJakarta,
  type InpatientCensus,
  type InpatientCensusItem,
  type InpatientCensusQuery,
} from '@simrs/shared';
import { ageYears } from '../../infra/clinical/clinical-context';
import { TenantDb } from '../../infra/tenant-db';
import { patientAccessSql, PatientAccessService } from '../authz/patient-access.service';
import { DiagnosisService } from '../diagnosis/diagnosis.service';
import { allergyLabels } from '../summary/summary.service';

const CURRENT = { supersededBy: { none: {} } } as const;
const MAX_ROWS = 300;
const DAY_MS = 86_400_000;

interface CensusRow {
  id: string;
  number: string;
  patient_id: string;
  started_at: Date | null;
  created_at: Date;
  unit_id: string;
  bed_id: string | null;
}

/**
 * K04 · Daftar pasien rawat inap (layar W4): kunjungan `IMP` yang sedang berjalan, per unit tempat pasien kini (unit bed
 * yang ditempati, atau unit kunjungan bila belum ber-bed). Disaring ABAC SEBELUM batas baris lewat `patientAccessSql`
 * (sumber aturan yang sama dengan `PatientAccessService.basis`: relasi, akses darurat, lingkup unit tingkat bed); lingkup
 * `all` tanpa saringan. Setiap pasien yang tampil diaudit `read` (bahan temuan "akses pasien rahasia"). Isi per baris:
 * banner ringkas, DPJP, diagnosis utama, hari rawat, EWS terakhir, co-sign tertunda, dan dosis terlambat hari ini.
 */
@Injectable()
export class InpatientCensusService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly diagnosis: DiagnosisService,
  ) {}

  async census(query: InpatientCensusQuery): Promise<InpatientCensus> {
    const tx = this.db.tx();
    const now = new Date();
    const actor = this.access.scopedActor();
    // Lingkup bukan `all` tanpa pengguna (mis. prinsipal perangkat) tidak melihat pasien siapa pun.
    if (!actor && this.db.permissionScope() !== 'all') {
      return { generatedAt: now.toISOString(), units: [], items: [] };
    }
    const abac = actor ? Prisma.sql`AND ${patientAccessSql(actor, now)}` : Prisma.empty;
    const rows = await tx.$queryRaw<CensusRow[]>`
      SELECT e.id::text AS id, e.number, e.patient_id::text AS patient_id, e.started_at, e.created_at,
             coalesce(l.unit_id, e.unit_id)::text AS unit_id, ba.location_id::text AS bed_id
      FROM encounters e
      JOIN patients p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
      LEFT JOIN bed_assignments ba ON ba.tenant_id = e.tenant_id AND ba.encounter_id = e.id AND ba.ended_at IS NULL
      LEFT JOIN locations l ON l.tenant_id = ba.tenant_id AND l.id = ba.location_id
      WHERE e.class = 'IMP' AND e.status = 'in_progress' ${abac}
      ORDER BY l.code NULLS LAST, e.created_at, e.id
      LIMIT ${MAX_ROWS}`;

    const ids = rows.map((r) => r.id);
    const unitIds = [...new Set(rows.map((r) => r.unit_id))];
    const [units, beds, patients, team, encounters, primaries, vitals, threshold] = await Promise.all([
      tx.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, code: true, name: true } }),
      tx.location.findMany({
        where: { id: { in: rows.flatMap((r) => (r.bed_id ? [r.bed_id] : [])) } },
        select: { id: true, code: true, name: true },
      }),
      tx.patient.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.patient_id))] } },
        select: { id: true, name: true, mrn: true, sex: true, birthDate: true, confidential: true },
      }),
      tx.encounterParticipant.findMany({
        where: { encounterId: { in: ids }, role: 'dpjp_utama', endedAt: null },
        select: { encounterId: true, user: { select: { displayName: true } } },
      }),
      tx.encounter.findMany({
        where: { id: { in: ids } },
        select: { id: true, practitioner: { select: { name: true } } },
      }),
      tx.condition.findMany({
        where: { encounterId: { in: ids }, kind: 'encounter', role: 'utama', status: 'final', ...CURRENT },
        select: { encounterId: true, code: true, display: true },
      }),
      tx.observation.findMany({
        where: {
          encounterId: { in: ids },
          category: 'vital',
          status: 'final',
          ewsScore: { not: null },
          ...CURRENT,
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        distinct: ['encounterId'],
        select: { encounterId: true, ewsScore: true, ewsMaxParam: true, occurredAt: true },
      }),
      readTenantSetting(tx, 'ews.escalation_score'),
    ]);
    const [cosign, late] = await Promise.all([this.pendingCosign(ids), this.lateDoses(ids, now)]);

    const today = isoDateJakarta(now);
    const unitOf = new Map(units.map((u) => [u.id, u]));
    const bedOf = new Map(beds.map((b) => [b.id, b]));
    const patientOf = new Map(patients.map((p) => [p.id, p]));
    const items: InpatientCensusItem[] = [];
    for (const r of rows) {
      const p = patientOf.get(r.patient_id);
      const unit = unitOf.get(r.unit_id);
      if (!p || !unit) continue;
      if (query.unitId && unit.id !== query.unitId) continue;
      const start = r.started_at ?? r.created_at;
      const admittedOn = isoDateJakarta(start);
      const v = vitals.find((x) => x.encounterId === r.id);
      const score = v?.ewsScore ?? 0;
      const maxParam = v?.ewsMaxParam ?? 0;
      const allergies = await this.diagnosis.allergiesOf(p.id);
      items.push({
        encounterId: r.id,
        encounterNumber: r.number,
        patientId: p.id,
        name: p.name,
        mrn: p.mrn,
        sex: p.sex as InpatientCensusItem['sex'],
        ageYears: ageYears(p.birthDate, today),
        unit,
        bed: r.bed_id ? (bedOf.get(r.bed_id) ?? null) : null,
        dpjp:
          team.find((t) => t.encounterId === r.id)?.user.displayName ??
          encounters.find((e) => e.id === r.id)?.practitioner?.name ??
          null,
        primaryDiagnosis: primaries.find((c) => c.encounterId === r.id) ?? null,
        admittedOn,
        day: Math.max(1, Math.round((Date.parse(today) - Date.parse(admittedOn)) / DAY_MS) + 1),
        ews: v
          ? {
              score,
              maxParam,
              risk: ewsRisk(score, maxParam).level,
              at: v.occurredAt.toISOString(),
              escalated: ewsNeedsEscalation(score, maxParam, threshold),
            }
          : null,
        allergy: { status: allergies.status, labels: allergyLabels(allergies) },
        pendingCosign: cosign.get(r.id) ?? 0,
        lateDoses: late.get(r.id) ?? 0,
        confidential: p.confidential,
      });
    }

    // Saringan unit hanya memilih tampilan; daftar unit tetap menampilkan semua unit yang terlihat pelaku.
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.unit_id, (counts.get(r.unit_id) ?? 0) + 1);
    for (const pid of new Set(items.map((i) => i.patientId))) {
      this.db.audit({ action: 'read', resourceType: 'inpatient_census', patientId: pid });
    }
    return {
      generatedAt: now.toISOString(),
      units: units
        .map((u) => ({ ...u, count: counts.get(u.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'id')),
      items,
    };
  }

  /** Catatan residen final terkini yang belum di-co-sign, per kunjungan. */
  private async pendingCosign(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const tx = this.db.tx();
    const entries = await tx.cpptEntry.findMany({
      where: { encounterId: { in: ids }, status: 'final', cosignRequired: true, ...CURRENT },
      select: { id: true, encounterId: true },
    });
    const signed = new Set(
      (
        await tx.clinicalAttestation.findMany({
          where: { targetType: 'cppt_entries', targetId: { in: entries.map((e) => e.id) }, kind: 'cosign' },
          select: { targetId: true },
        })
      ).map((a) => a.targetId),
    );
    for (const e of entries) {
      if (!signed.has(e.id)) out.set(e.encounterId, (out.get(e.encounterId) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Dosis terjadwal hari ini (WIB) yang sudah lewat `emar.late_minutes` tanpa catatan pemberian apa pun, dari order
   * yang masih aktif. Sama dengan status slot `terlambat` di papan eMAR.
   */
  private async lateDoses(ids: string[], now: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const tx = this.db.tx();
    const lateMinutes = await readTenantSetting(tx, 'emar.late_minutes');
    const dayStart = new Date(`${isoDateJakarta(now)}T00:00:00+07:00`);
    const slots = await tx.medicationSchedule.findMany({
      where: {
        encounterId: { in: ids },
        scheduledAt: { gte: dayStart, lt: new Date(now.getTime() - lateMinutes * 60_000) },
        administrations: { none: {} },
      },
      select: {
        encounterId: true,
        medicationRequest: {
          select: {
            statusEvents: {
              orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    });
    for (const s of slots) {
      if (s.medicationRequest.statusEvents[0]?.status !== 'aktif') continue;
      out.set(s.encounterId, (out.get(s.encounterId) ?? 0) + 1);
    }
    return out;
  }
}
