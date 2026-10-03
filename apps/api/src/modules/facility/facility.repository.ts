import { Injectable } from '@nestjs/common';
import {
  type CreateFacilityInput,
  type CreateLocationInput,
  type CreateUnitInput,
  type ListQuery,
  newId,
  type UpdateFacilityInput,
  type UpdateLocationInput,
  type UpdateUnitInput,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

const FACILITY_SELECT = {
  id: true,
  code: true,
  name: true,
  kemenkesCode: true,
  address: true,
  active: true,
  updatedAt: true,
} as const;
const UNIT_SELECT = {
  id: true,
  facilityId: true,
  parentId: true,
  code: true,
  name: true,
  kind: true,
  active: true,
  updatedAt: true,
} as const;
const LOCATION_SELECT = {
  id: true,
  unitId: true,
  parentId: true,
  kind: true,
  code: true,
  name: true,
  careClass: true,
  satusehatLocationId: true,
  active: true,
  updatedAt: true,
} as const;

/** Kursor eksplisit `id > cursor` (UUID v7 urut waktu): terdefinisi jelas walau kursor tidak ada/milik tenant lain. */
const afterCursor = (q: ListQuery) => (q.cursor ? { id: { gt: q.cursor } } : {});
const page = (q: ListQuery) => ({ take: q.limit + 1, orderBy: { id: 'asc' as const } });

/** P01 · Akses data struktur faskes (selalu transaksi permintaan, RLS aktif). */
@Injectable()
export class FacilityRepository {
  constructor(private readonly db: TenantDb) {}

  private audit() {
    const actor = this.db.actorUserId();
    return { created: { createdBy: actor, updatedBy: actor }, updated: { updatedBy: actor } };
  }

  // ---------- faskes ----------
  listFacilities(q: ListQuery) {
    return this.db.tx().facility.findMany({
      where: { ...afterCursor(q), ...(q.includeInactive ? {} : { active: true }) },
      select: FACILITY_SELECT,
      ...page(q),
    });
  }
  findFacility(id: string) {
    return this.db.tx().facility.findUnique({ where: { id }, select: FACILITY_SELECT });
  }
  createFacility(input: CreateFacilityInput) {
    return this.db.tx().facility.create({
      data: { id: newId(), tenantId: this.db.tenantId(), ...input, ...this.audit().created },
      select: FACILITY_SELECT,
    });
  }
  updateFacility(id: string, input: UpdateFacilityInput) {
    return this.db.tx().facility.update({
      where: { id },
      data: { ...input, ...this.audit().updated },
      select: FACILITY_SELECT,
    });
  }
  countActiveUnits(facilityId: string) {
    return this.db.tx().unit.count({ where: { facilityId, active: true } });
  }

  // ---------- unit ----------
  listUnits(q: ListQuery & { facilityId?: string; kind?: string }) {
    return this.db.tx().unit.findMany({
      where: {
        ...afterCursor(q),
        ...(q.includeInactive ? {} : { active: true }),
        ...(q.facilityId ? { facilityId: q.facilityId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
      },
      select: UNIT_SELECT,
      ...page(q),
    });
  }
  findUnit(id: string) {
    return this.db.tx().unit.findUnique({ where: { id }, select: UNIT_SELECT });
  }
  createUnit(input: CreateUnitInput) {
    return this.db.tx().unit.create({
      data: { id: newId(), tenantId: this.db.tenantId(), ...input, ...this.audit().created },
      select: UNIT_SELECT,
    });
  }
  updateUnit(id: string, input: UpdateUnitInput) {
    return this.db.tx().unit.update({
      where: { id },
      data: { ...input, ...this.audit().updated },
      select: UNIT_SELECT,
    });
  }
  countActiveChildren(unitId: string) {
    return Promise.all([
      this.db.tx().unit.count({ where: { parentId: unitId, active: true } }),
      this.db.tx().location.count({ where: { unitId, active: true } }),
    ]).then(([units, locations]) => units + locations);
  }

  // ---------- lokasi ----------
  listLocations(q: ListQuery & { unitId?: string; parentId?: string; kind?: string }) {
    return this.db.tx().location.findMany({
      where: {
        ...afterCursor(q),
        ...(q.includeInactive ? {} : { active: true }),
        ...(q.unitId ? { unitId: q.unitId } : {}),
        ...(q.parentId ? { parentId: q.parentId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
      },
      select: LOCATION_SELECT,
      ...page(q),
    });
  }
  findLocation(id: string) {
    return this.db.tx().location.findUnique({ where: { id }, select: LOCATION_SELECT });
  }
  createLocation(input: CreateLocationInput) {
    return this.db.tx().location.create({
      data: { id: newId(), tenantId: this.db.tenantId(), ...input, ...this.audit().created },
      select: LOCATION_SELECT,
    });
  }
  updateLocation(id: string, input: UpdateLocationInput) {
    return this.db.tx().location.update({
      where: { id },
      data: { ...input, ...this.audit().updated },
      select: LOCATION_SELECT,
    });
  }
  countActiveLocationChildren(locationId: string) {
    return this.db.tx().location.count({ where: { parentId: locationId, active: true } });
  }
}
