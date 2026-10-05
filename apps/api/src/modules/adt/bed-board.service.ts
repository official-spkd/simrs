import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import { AppError, type BedBoardApi, type BedStatus } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { minutesSince, patientInitials } from './adt-helpers';

type RequestStatus = BedBoardApi['requests'][number]['status'];
type RequestOrigin = BedBoardApi['requests'][number]['origin'];

/**
 * K05 · Potret papan bed (bangsal rawat inap + bed IGD): status bertulisan + versi (dasar `baseVersion`), label pasien
 * HANYA inisial, permintaan bed terbuka dengan penanda boarding (> `bed.boarding_alert_hours`). Lingkup `unit`: unit
 * penugasan saja.
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
      if (!own) return { asOf: now.toISOString(), boardingAlertHours: 4, units: [], requests: [] };
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
    const requests = await tx.bedRequest.findMany({
      where: {
        status: { in: ['menunggu', 'dialokasi'] },
        ...(unitFilter
          ? { OR: [{ unitId: unitFilter }, { allocatedLocation: { unitId: unitFilter } }] }
          : {}),
      },
      orderBy: { requestedAt: 'asc' },
    });
    const names = await this.patientNames([...encounterIds, ...requests.map((r) => r.encounterId)]);
    return {
      asOf: now.toISOString(),
      boardingAlertHours,
      units: units.map((u) => ({
        unitId: u.id,
        code: u.code,
        name: u.name,
        kind: u.kind,
        beds: locations
          .filter((l) => l.unitId === u.id && l.bedStatus)
          .map((l) => {
            const s = l.bedStatus as NonNullable<typeof l.bedStatus>;
            const name = s.encounterId ? names.get(s.encounterId) : undefined;
            return {
              bedId: l.id,
              code: l.code,
              room: l.parent?.name ?? '',
              careClass: l.careClass,
              status: s.status as BedStatus,
              version: s.version,
              encounterId: s.encounterId,
              patientLabel: name ? patientInitials(name) : null,
              since: s.changedAt.toISOString(),
            };
          }),
      })),
      requests: requests.map((r) => {
        const wait = minutesSince(r.requestedAt, now);
        return {
          id: r.id,
          encounterId: r.encounterId,
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
        };
      }),
    };
  }

  private async patientNames(encounterIds: string[]): Promise<Map<string, string>> {
    if (encounterIds.length === 0) return new Map();
    const rows = await this.db.tx().encounter.findMany({
      where: { id: { in: [...new Set(encounterIds)] } },
      select: { id: true, patient: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.patient.name]));
  }
}
