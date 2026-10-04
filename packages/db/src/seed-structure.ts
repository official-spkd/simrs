import { newId } from '@simrs/shared';
import type { TenantTx } from './client';
import { SEED_ROOMS, SEED_UNITS } from './seed-data';

/**
 * P01 · Struktur RS fiktif seed: gedung utama, 12 unit (`SEED_UNITS`), kamar dan bed (`SEED_ROOMS`). Upsert per kode,
 * jadi aman diulang dan tidak menimpa perubahan nama dari layar. Dipanggil di dalam `withTenant` (seed, tes).
 */
export async function seedHospitalStructure(tx: TenantTx, tenantId: string): Promise<Map<string, string>> {
  const facility = await tx.facility.upsert({
    where: { tenantId_code: { tenantId, code: 'UTAMA' } },
    update: {},
    create: { id: newId(), tenantId, code: 'UTAMA', name: 'Gedung Utama' },
  });
  const units = new Map<string, string>();
  for (const u of SEED_UNITS) {
    const row = await tx.unit.upsert({
      where: { tenantId_code: { tenantId, code: u.code } },
      update: {},
      create: { id: newId(), tenantId, facilityId: facility.id, ...u },
    });
    units.set(u.code, row.id);
  }
  for (const [unitCode, code, name, careClass, beds] of SEED_ROOMS) {
    const unitId = units.get(unitCode);
    if (!unitId) throw new Error(`Unit seed ${unitCode} tidak ada`);
    const room = await tx.location.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { id: newId(), tenantId, unitId, kind: 'kamar', code, name, careClass },
    });
    for (let i = 0; i < beds; i++) {
      const letter = String.fromCharCode(65 + i);
      await tx.location.upsert({
        where: { tenantId_code: { tenantId, code: `${code}-${letter}` } },
        update: {},
        create: {
          id: newId(),
          tenantId,
          unitId,
          parentId: room.id,
          kind: 'bed',
          code: `${code}-${letter}`,
          name: `Bed ${letter}`,
          careClass,
        },
      });
    }
  }
  return units;
}
