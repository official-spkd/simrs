import { Injectable } from '@nestjs/common';
import { getConcept, listCodeSystems, listRegions, searchConcepts } from '@simrs/db';
import {
  AppError,
  REF_CODE_SYSTEMS,
  type RefCodeSystem,
  type RefRegionsQuery,
  type RefSearchQuery,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/**
 * P06 · Baca data rujukan global (skema `ref`). Tidak ada data pasien di sini, jadi tidak diaudit; yang dijaga
 * adalah izin `ref.read`. Pengisian dataset lewat `pnpm db:import-ref` (operator platform), bukan API.
 */
@Injectable()
export class RefService {
  constructor(private readonly db: TenantDb) {}

  async systems() {
    const rows = await listCodeSystems(this.db.tx());
    return rows.map((r) => ({
      ...r,
      label: REF_CODE_SYSTEMS[r.id].label,
      importedAt: r.importedAt?.toISOString() ?? null,
    }));
  }

  search(q: RefSearchQuery) {
    return searchConcepts(this.db.tx(), {
      system: q.system,
      q: q.q,
      limit: q.limit,
      includeInactive: q.includeInactive,
    });
  }

  async get(system: RefCodeSystem, code: string) {
    const concept = await getConcept(this.db.tx(), system, code.toUpperCase());
    if (!concept) {
      throw new AppError('NOT_FOUND', `Kode ${code} tidak ada di ${REF_CODE_SYSTEMS[system].label}`, 404);
    }
    return concept;
  }

  regions(q: RefRegionsQuery) {
    return listRegions(this.db.tx(), { parent: q.parent ?? null, q: q.q, limit: q.limit });
  }
}
