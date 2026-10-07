import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import { AppError, type BedBoardApi, type BedStatus } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { patientAccessSql } from '../authz/patient-access.service';
import { minutesSince, patientInitials } from './adt-helpers';

type RequestStatus = BedBoardApi['requests'][number]['status'];
type RequestOrigin = BedBoardApi['requests'][number]['origin'];
type RequestClass = BedBoardApi['requests'][number]['encounterClass'];

/** Status kirim Aplicare ruang: sudah diterima BPJS, menunggu worker, atau gagal terakhir kali (kode galat). */
export function aplicareState(r: {
  revision: number;
  sentRevision: number;
  lastErrorCode: string | null;
}): BedBoardApi['aplicare'][number]['state'] {
  if (r.sentRevision >= r.revision) return 'terkirim';
  return r.lastErrorCode ? 'gagal' : 'menunggu';
}

/**
 * K05 · Potret papan bed (bangsal rawat inap + bed IGD): status bertulisan + versi (dasar `baseVersion`), label pasien
 * HANYA inisial, permintaan bed terbuka dengan penanda boarding (> `bed.boarding_alert_hours`), status kirim Aplicare
 * per ruang (bangsal × kelas). Lingkup `unit`: unit penugasan saja. ADR-0109: lingkup `relationship` hanya melihat
 * penghuni/permintaan pasien berelasi (bed lain tetap tampil statusnya, tanpa kunjungan); catatan bebas permintaan bed
 * hanya untuk peminta dan pelaku berelasi dengan pasien (relasi aktif atau akses darurat), bukan papan umum.
 */
@Injectable()
export class BedBoardService {
  constructor(private readonly db: TenantDb) {}

  async board(unitId?: string, now: Date = new Date()): Promise<BedBoardApi> {
    const tx = this.db.tx();
    const scope = this.db.permissionScope();
    let unitFilter = unitId;
    if (scope !== 'all') {
      const own = this.db.actor().unitId;
      if (!own)
        return { asOf: now.toISOString(), boardingAlertHours: 4, aplicare: [], units: [], requests: [] };
      if (unitId && unitId !== own)
        throw new AppError('FORBIDDEN', 'Papan bed unit lain di luar penugasan', 403);
      unitFilter = own;
    }
    const boardingAlertHours = await readTenantSetting(tx, 'bed.boarding_alert_hours');
    const units = await tx.unit.findMany({
      where: { active: true, kind: { in: ['rawat_inap', 'igd'] }, ...(unitFilter ? { id: unitFilter } : {}) },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, kind: true },
    });
    const unitIds = units.map((u) => u.id);
    const locations = await tx.location.findMany({
      where: { kind: 'bed', active: true, unitId: { in: unitIds } },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        unitId: true,
        careClass: true,
        parent: { select: { name: true } },
        bedStatus: true,
      },
    });
    const encounterIds = locations.flatMap((l) =>
      l.bedStatus?.encounterId ? [l.bedStatus.encounterId] : [],
    );
    const allRequests = await tx.bedRequest.findMany({
      where: {
        status: { in: ['menunggu', 'dialokasi'] },
        ...(unitFilter
          ? { OR: [{ unitId: unitFilter }, { allocatedLocation: { unitId: unitFilter } }] }
          : {}),
      },
      orderBy: { requestedAt: 'asc' },
    });
    const patients = await this.encounterPatients([
      ...encounterIds,
      ...allRequests.map((r) => r.encounterId),
    ]);
    const related = await this.relatedPatients(
      [...new Set([...patients.values()].map((p) => p.patientId))],
      now,
    );
    const me = this.db.actorUserId();
    const visible = (encounterId: string) =>
      scope !== 'relationship' || related.has(patients.get(encounterId)?.patientId ?? '');
    const requests = allRequests.filter((r) => visible(r.encounterId));
    const names = new Map([...patients].map(([id, p]) => [id, p.name]));
    const requestEncounters = await this.requestEncounters(requests.map((r) => r.encounterId));
    const rooms = await tx.aplicareRoom.findMany({
      where: { unitId: { in: unitIds } },
      orderBy: { roomCode: 'asc' },
    });
    return {
      asOf: now.toISOString(),
      boardingAlertHours,
      aplicare: rooms.map((r) => ({
        unitId: r.unitId,
        careClass: r.careClass,
        roomCode: r.roomCode,
        state: aplicareState(r),
        revision: r.revision,
        sentRevision: r.sentRevision,
        lastErrorCode: r.lastErrorCode,
        updatedAt: r.updatedAt.toISOString(),
      })),
      units: units.map((u) => ({
        unitId: u.id,
        code: u.code,
        name: u.name,
        kind: u.kind,
        beds: locations
          .filter((l) => l.unitId === u.id && l.bedStatus)
          .map((l) => {
            const s = l.bedStatus as NonNullable<typeof l.bedStatus>;
            const shown = s.encounterId && visible(s.encounterId) ? s.encounterId : null;
            const name = shown ? names.get(shown) : undefined;
            return {
              bedId: l.id,
              code: l.code,
              room: l.parent?.name ?? '',
              careClass: l.careClass,
              status: s.status as BedStatus,
              version: s.version,
              encounterId: shown,
              patientLabel: name ? patientInitials(name) : null,
              since: s.changedAt.toISOString(),
            };
          }),
      })),
      requests: requests.map((r) => {
        const wait = minutesSince(r.requestedAt, now);
        const enc = requestEncounters.get(r.encounterId);
        return {
          id: r.id,
          encounterId: r.encounterId,
          encounterClass: enc?.encounterClass ?? 'AMB',
          plannedAdmissionId: enc?.plannedAdmissionId ?? null,
          patientLabel: patientInitials(names.get(r.encounterId) ?? ''),
          origin: r.origin as RequestOrigin,
          careClass: r.careClass,
          unitId: r.unitId,
          isolation: r.isolation,
          status: r.status as RequestStatus,
          requestedAt: r.requestedAt.toISOString(),
          waitMinutes: wait,
          boarding: r.origin === 'igd' && wait >= boardingAlertHours * 60,
          allocatedBedId: r.allocatedLocationId,
          note: (me !== null && r.requestedBy === me) || related.has(r.patientId) ? r.note : null,
        };
      }),
    };
  }

  /**
   * Kelas kunjungan asal permintaan + admisi rawat inap `planned` yang menunggu bed (kunjungan IMP itu sendiri, atau
   * IMP ber-`sourceEncounterId` kunjungan IGD/RJ asal).
   */
  private async requestEncounters(
    encounterIds: string[],
  ): Promise<Map<string, { encounterClass: RequestClass; plannedAdmissionId: string | null }>> {
    if (encounterIds.length === 0) return new Map();
    const tx = this.db.tx();
    const ids = [...new Set(encounterIds)];
    const [rows, planned] = await Promise.all([
      tx.encounter.findMany({
        where: { id: { in: ids } },
        select: { id: true, encounterClass: true, status: true },
      }),
      tx.encounter.findMany({
        where: { sourceEncounterId: { in: ids }, encounterClass: 'IMP', status: 'planned' },
        select: { id: true, sourceEncounterId: true },
      }),
    ]);
    return new Map(
      rows.map((e) => [
        e.id,
        {
          encounterClass: e.encounterClass as RequestClass,
          plannedAdmissionId:
            e.encounterClass === 'IMP'
              ? e.status === 'planned'
                ? e.id
                : null
              : (planned.find((p) => p.sourceEncounterId === e.id)?.id ?? null),
        },
      ]),
    );
  }

  private async encounterPatients(
    encounterIds: string[],
  ): Promise<Map<string, { patientId: string; name: string }>> {
    if (encounterIds.length === 0) return new Map();
    const rows = await this.db.tx().encounter.findMany({
      where: { id: { in: [...new Set(encounterIds)] } },
      select: { id: true, patientId: true, patient: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.id, { patientId: r.patientId, name: r.patient.name }]));
  }

  /** Pasien yang berelasi dengan pelaku (relasi aktif atau akses darurat; tanpa dasar unit/peran). */
  private async relatedPatients(patientIds: string[], now: Date): Promise<Set<string>> {
    const userId = this.db.actorUserId();
    if (!userId || patientIds.length === 0) return new Set();
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT p.id::text FROM patients p
      WHERE p.id = ANY(${patientIds}::uuid[]) AND ${patientAccessSql({ userId, unitId: null }, now)}`;
    return new Set(rows.map((r) => r.id));
  }
}
