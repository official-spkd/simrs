/**
 * P05 · FK access_relationships / break_glass_grants → patients divalidasi (migrasi 20261005091000, ADR-0015
 * pembaruan 5 Okt 2026). Jalur bersih: kedua FK tervalidasi dan pemanggilan ulang aman. Jalur data lama (baris
 * yatim) disimulasikan di transaksi pemilik yang dibatalkan: FK tetap NOT VALID, tidak ada data yang dihapus.
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const FKS = [
  'access_relationships_tenant_id_patient_id_fkey',
  'break_glass_grants_tenant_id_patient_id_fkey',
];

type Row = { constraint_name: string; orphan_rows: bigint; validated: boolean };
const asPlain = (rows: Row[]) =>
  rows.map((r) => ({ name: r.constraint_name, orphans: Number(r.orphan_rows), validated: r.validated }));

const forced = (db: Pick<PrismaClient, '$queryRaw'>) =>
  db.$queryRaw<Array<{ relname: string; forced: boolean }>>`
    SELECT relname, relforcerowsecurity AS forced FROM pg_class
    WHERE relname IN ('patients', 'access_relationships', 'break_glass_grants') AND relkind = 'r'
    ORDER BY relname`;

class Rollback extends Error {}

describe('FK pasien pada relasi dan akses darurat', () => {
  it('jalur bersih: kedua FK tervalidasi; pemanggilan ulang aman dan FORCE RLS tetap terpasang', async () => {
    const before = await owner.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY(${FKS}) ORDER BY conname`;
    expect(before).toEqual(FKS.map((conname) => ({ conname, convalidated: true })));

    const rows = await owner.$queryRaw<Row[]>`SELECT * FROM app_validate_patient_fks()`;
    expect(asPlain(rows)).toEqual(FKS.map((name) => ({ name, orphans: 0, validated: true })));
    expect((await forced(owner)).every((r) => r.forced)).toBe(true);
  });

  it('role aplikasi tidak bisa menjalankan validasi (hanya pemilik tabel/operator)', async () => {
    await expect(app.$queryRaw`SELECT * FROM app_validate_patient_fks()`).rejects.toThrow(
      /permission denied/,
    );
  });

  it('data lama berisi baris yatim: dilaporkan, FK dibiarkan NOT VALID, tidak ada yang dihapus, migrasi tidak gagal', async () => {
    // Simulasi basis data lama di transaksi pemilik yang dibatalkan: FK dipasang ulang NOT VALID setelah baris yang
    // merujuk pasien acak dimasukkan. Konteks tenant transaksi sengaja tenant LAIN: fungsi tetap melihat semua tenant.
    const [rsa, rsb] = [newId(), newId()];
    const orphanId = newId();
    const outcome: Record<string, unknown> = {};
    await owner
      .$transaction(async (tx) => {
        for (const id of [rsa, rsb]) {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
          await tx.tenant.create({
            data: { id, code: `FK${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif FK' },
          });
        }
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${rsa}, true)`;
        const userId = newId();
        await tx.user.create({
          data: { id: userId, tenantId: rsa, username: `fk.${orphanId.slice(-6)}`, displayName: 'Uji FK' },
        });
        await tx.$executeRaw`ALTER TABLE access_relationships DROP CONSTRAINT access_relationships_tenant_id_patient_id_fkey`;
        await tx.accessRelationship.create({
          data: { id: orphanId, tenantId: rsa, userId, patientId: newId(), kind: 'dpjp' },
        });
        await tx.$executeRaw`
          ALTER TABLE access_relationships ADD CONSTRAINT access_relationships_tenant_id_patient_id_fkey
          FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id)
          ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID`;
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${rsb}, true)`;

        outcome.rows = asPlain(await tx.$queryRaw<Row[]>`SELECT * FROM app_validate_patient_fks()`);
        const [con] = await tx.$queryRaw<Array<{ convalidated: boolean }>>`
          SELECT convalidated FROM pg_constraint WHERE conname = ${FKS[0]}`;
        outcome.validated = con?.convalidated;
        outcome.forced = await forced(tx);
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${rsa}, true)`;
        outcome.kept = await tx.accessRelationship.count({ where: { id: orphanId } });
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });

    expect(outcome.rows).toEqual([
      { name: FKS[0], orphans: 1, validated: false },
      { name: FKS[1], orphans: 0, validated: true },
    ]);
    expect(outcome.validated).toBe(false);
    expect(outcome.kept).toBe(1);
    expect((outcome.forced as Array<{ forced: boolean }>).every((r) => r.forced)).toBe(true);

    // Transaksi dibatalkan: FK asli kembali tervalidasi, tidak ada sisa data uji.
    const [after] = await owner.$queryRaw<Array<{ convalidated: boolean }>>`
      SELECT convalidated FROM pg_constraint WHERE conname = ${FKS[0]}`;
    expect(after?.convalidated).toBe(true);
    const left = await withTenant(owner, rsa, (tx) =>
      tx.accessRelationship.count({ where: { id: orphanId } }),
    );
    expect(left).toBe(0);
  });
});
