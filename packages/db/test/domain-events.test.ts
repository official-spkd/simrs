/**
 * Event domain tersimpan (`domain_events`): append-only juga bagi pemilik tabel, payload datar tanpa objek bersarang,
 * nama berformat, isolasi tenant. Penjaga "tanpa PHI" per kunci + penyimpanan dalam transaksi diuji di apps/api.
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type Prisma, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
let A: string;
let B: string;

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  A = await freshTenant();
  B = await freshTenant();
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

async function freshTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({ data: { id, code: `EV${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Event' } }),
  );
  return id;
}

const insert = (tenantId: string, name: string, payload: Prisma.InputJsonValue) =>
  withTenant(app, tenantId, (tx) =>
    tx.domainEvent.create({ data: { id: newId(), tenantId, name, payload } }),
  );

describe('domain_events di database', () => {
  it('payload objek datar (skalar atau larik skalar); nama berformat `konteks.kejadian`', async () => {
    await insert(A, 'booking.checked_in', { appointmentId: newId(), channel: 'loket', ticketIds: [newId()] });
    for (const bad of [{ detail: { nik: '9999' } }, { ids: [{ a: 1 }] }, { ids: [['x']] }, ['x']]) {
      await expect(insert(A, 'booking.checked_in', bad)).rejects.toThrow(/domain_events_payload_flat/);
    }
    for (const name of ['Booking.checked_in', 'booking', 'booking checked in']) {
      await expect(insert(A, name, {})).rejects.toThrow(/domain_events_name_format/);
    }
  });

  it('append-only: UPDATE/DELETE ditolak untuk aplikasi (hak) dan pemilik tabel (trigger)', async () => {
    const e = await insert(A, 'sep.issued', { sepId: newId(), encounterId: newId() });
    await expect(
      withTenant(app, A, (tx) =>
        tx.domainEvent.update({ where: { id: e.id }, data: { name: 'sep.cancelled' } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(withTenant(app, A, (tx) => tx.domainEvent.delete({ where: { id: e.id } }))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      withTenant(
        owner,
        A,
        (tx) => tx.$executeRaw`UPDATE domain_events SET name = 'sep.cancelled' WHERE id = ${e.id}::uuid`,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
    await expect(
      withTenant(owner, A, (tx) => tx.$executeRaw`DELETE FROM domain_events WHERE id = ${e.id}::uuid`),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('isolasi tenant: RS lain tidak melihat dan tidak bisa menulis atas nama RS ini', async () => {
    const e = await insert(A, 'encounter.registered', { encounterId: newId(), patientId: newId() });
    expect(await withTenant(app, B, (tx) => tx.domainEvent.findUnique({ where: { id: e.id } }))).toBeNull();
    expect(
      await withTenant(app, A, (tx) => tx.domainEvent.findUnique({ where: { id: e.id } })),
    ).not.toBeNull();
    await expect(
      withTenant(app, B, (tx) =>
        tx.domainEvent.create({ data: { id: newId(), tenantId: A, name: 'sep.issued', payload: {} } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
