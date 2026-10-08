import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PrismaClient, seedSupportMasters, seedSupportStock, withTenant } from '@simrs/db';
import type { Account } from './accounts';
import { account } from './clinical';

/**
 * Fase 4 · fixture E2E stok depo (potongan 4.6a): master penunjang RSFA (depo, gudang, pemasok) + stok awal fiktif
 * (sekali per DB) dan dua akun apoteker baru tiap run: unit FARMASI (gudang + depo RJ/RI) dan unit IGD (depo IGD,
 * penerima mutasi). Kredensial di folder sementara E2E (mode 0600), tidak pernah di repo.
 */

export const STOCK_FIXTURES_FILE = 'stock-fixtures.json';

export interface StockFixtures {
  format: 1;
  /** `telaah` = apoteker FARMASI kedua untuk layar Farmasi (4.5), agar setiap akun masuk sekali per run. */
  accounts: { farmasi: Account; igd: Account; telaah: Account };
}

export async function ensureStockFixtures(prisma: PrismaClient, tenantId: string, tmpDir: string) {
  const accounts = await withTenant(prisma, tenantId, async (tx) => {
    await seedSupportMasters(tx, tenantId);
    return {
      farmasi: await account(tx, tenantId, 'apoteker', 'FARMASI', 'apt. Farmasi E2E Fiktif'),
      igd: await account(tx, tenantId, 'apoteker', 'IGD', 'apt. IGD E2E Fiktif'),
      telaah: await account(tx, tenantId, 'apoteker', 'FARMASI', 'apt. Telaah E2E Fiktif'),
    };
  });
  await withTenant(prisma, tenantId, (tx) => seedSupportStock(tx, tenantId, accounts.farmasi.id));
  const data: StockFixtures = { format: 1, accounts };
  writeFileSync(join(tmpDir, STOCK_FIXTURES_FILE), JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
  return data;
}

export function stockFixtures(tmpDir: string): StockFixtures {
  return JSON.parse(readFileSync(join(tmpDir, STOCK_FIXTURES_FILE), 'utf8')) as StockFixtures;
}
