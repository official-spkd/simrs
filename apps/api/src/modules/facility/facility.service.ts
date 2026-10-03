import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CreateFacilityInput,
  type CreateLocationInput,
  type CreateUnitInput,
  type ListQuery,
  type UpdateFacilityInput,
  type UpdateLocationInput,
  type UpdateUnitInput,
} from '@simrs/shared';
import { toPage } from '../../common/pagination';
import { FacilityRepository } from './facility.repository';

/** Kedalaman maksimum pohon unit (pengaman saat memeriksa siklus). */
const MAX_UNIT_DEPTH = 10;

const notFound = (what: string) => new AppError('NOT_FOUND', `${what} tidak ditemukan`, 404);
const invalid = (message: string) => new AppError('VALIDATION_FAILED', message, 400);

/**
 * P01 · Aturan integritas struktur RS:
 * - referensi (faskes, unit induk, lokasi induk) harus ada dan aktif di tenant yang sama;
 * - hierarki lokasi ruang → kamar → bed dalam unit yang sama, bed wajib punya kelas perawatan;
 * - tidak ada siklus di pohon unit;
 * - entitas tidak bisa dinonaktifkan selama masih punya turunan aktif.
 */
@Injectable()
export class FacilityService {
  constructor(private readonly repo: FacilityRepository) {}

  // ---------- faskes ----------
  async listFacilities(q: ListQuery) {
    return toPage(await this.repo.listFacilities(q), q.limit);
  }

  createFacility(input: CreateFacilityInput) {
    return this.repo.createFacility(input);
  }

  async updateFacility(id: string, input: UpdateFacilityInput) {
    if (!(await this.repo.findFacility(id))) throw notFound('Faskes');
    if (input.active === false && (await this.repo.countActiveUnits(id)) > 0) {
      throw new AppError('CONFLICT', 'Nonaktifkan unit di faskes ini terlebih dahulu', 409);
    }
    return this.repo.updateFacility(id, input);
  }

  // ---------- unit ----------
  async listUnits(q: ListQuery & { facilityId?: string; kind?: string }) {
    return toPage(await this.repo.listUnits(q), q.limit);
  }

  async createUnit(input: CreateUnitInput) {
    const facility = await this.repo.findFacility(input.facilityId);
    if (!facility?.active) throw invalid('Faskes tidak ditemukan atau tidak aktif');
    if (input.parentId) await this.assertUnitParent(input.parentId, input.facilityId);
    return this.repo.createUnit(input);
  }

  async updateUnit(id: string, input: UpdateUnitInput) {
    const unit = await this.repo.findUnit(id);
    if (!unit) throw notFound('Unit');
    if (input.parentId) {
      await this.assertUnitParent(input.parentId, unit.facilityId);
      await this.assertNoUnitCycle(id, input.parentId);
    }
    if (input.active === false && (await this.repo.countActiveChildren(id)) > 0) {
      throw new AppError('CONFLICT', 'Nonaktifkan sub-unit dan lokasi di unit ini terlebih dahulu', 409);
    }
    return this.repo.updateUnit(id, input);
  }

  private async assertUnitParent(parentId: string, facilityId: string) {
    const parent = await this.repo.findUnit(parentId);
    if (!parent?.active) throw invalid('Unit induk tidak ditemukan atau tidak aktif');
    if (parent.facilityId !== facilityId) throw invalid('Unit induk harus berada di faskes yang sama');
  }

  /** Menjadikan `parentId` induk dari `unitId` tidak boleh membuat lingkaran. */
  private async assertNoUnitCycle(unitId: string, parentId: string) {
    let current: string | null = parentId;
    for (let depth = 0; current; depth++) {
      if (current === unitId) throw invalid('Unit tidak boleh menjadi induk dari dirinya sendiri (siklus)');
      if (depth >= MAX_UNIT_DEPTH) throw invalid(`Pohon unit maksimal ${MAX_UNIT_DEPTH} tingkat`);
      current = (await this.repo.findUnit(current))?.parentId ?? null;
    }
  }

  // ---------- lokasi ----------
  async listLocations(q: ListQuery & { unitId?: string; parentId?: string; kind?: string }) {
    return toPage(await this.repo.listLocations(q), q.limit);
  }

  async createLocation(input: CreateLocationInput) {
    const unit = await this.repo.findUnit(input.unitId);
    if (!unit?.active) throw invalid('Unit tidak ditemukan atau tidak aktif');

    const parent = input.parentId ? await this.repo.findLocation(input.parentId) : null;
    if (input.parentId && !parent?.active) throw invalid('Lokasi induk tidak ditemukan atau tidak aktif');
    if (parent && parent.unitId !== input.unitId)
      throw invalid('Lokasi induk harus berada di unit yang sama');

    if (input.kind === 'ruang' && parent) throw invalid('Ruang tidak boleh punya induk');
    if (input.kind === 'kamar' && parent && parent.kind !== 'ruang') throw invalid('Induk kamar harus ruang');
    if (input.kind === 'bed') {
      if (parent?.kind !== 'kamar') throw invalid('Bed wajib berada di dalam kamar');
      const careClass = input.careClass ?? parent.careClass ?? undefined;
      if (!careClass) throw invalid('Kelas perawatan bed wajib (isi di bed atau kamarnya)');
      return this.repo.createLocation({ ...input, careClass: careClass as CreateLocationInput['careClass'] });
    }
    return this.repo.createLocation(input);
  }

  async updateLocation(id: string, input: UpdateLocationInput) {
    const location = await this.repo.findLocation(id);
    if (!location) throw notFound('Lokasi');
    if (location.kind === 'bed' && input.careClass === null)
      throw invalid('Kelas perawatan bed tidak boleh dikosongkan');
    if (input.active === false && (await this.repo.countActiveLocationChildren(id)) > 0) {
      throw new AppError('CONFLICT', 'Nonaktifkan lokasi di dalamnya terlebih dahulu', 409);
    }
    return this.repo.updateLocation(id, input);
  }
}
