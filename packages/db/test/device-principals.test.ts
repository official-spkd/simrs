/**
 * ADR-0027 · Prinsipal perangkat (`kiosk`, `display`) di `registered_devices`: isolasi tenant, FK unit komposit,
 * batasan (terikat unit, tanpa akun/PIN, jendela kode dan kredensial, token ⇔ terdaftar), dan penjaga pendaftaran
 * sekali pakai (hanya kolom pendaftaran, hanya sebelum kode kedaluwarsa, tidak bisa diulang, final setelah dicabut).
 */
import { hashToken, randomToken } from '@simrs/shared/node';
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, ensureSystemRoles, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
const T = newId();
const U = newId();
const units: Record<string, string> = {};
let adminT = '';

const hex = () => hashToken(randomToken());

async function unit(tenantId: string): Promise<string> {
  const facilityId = newId();
  const id = newId();
  await withTenant(app, tenantId, async (tx) => {
    await tx.facility.create({
      data: { id: facilityId, tenantId, code: `F${id.slice(-6).toUpperCase()}`, name: 'RS Uji' },
    });
    await tx.unit.create({
      data: {
        id,
        tenantId,
        facilityId,
        code: `U${id.slice(-6).toUpperCase()}`,
        name: 'Lobi utama',
        kind: 'administrasi',
      },
    });
  });
  return id;
}

const principal = (tenantId: string, over: object = {}) => {
  const createdAt = new Date();
  return {
    id: newId(),
    tenantId,
    kind: 'kiosk',
    name: 'Anjungan lobi',
    unitId: units[tenantId === T ? 't' : 'u'],
    enrolCodeHash: hex(),
    enrolExpiresAt: new Date(createdAt.getTime() + 15 * 60_000),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 365 * 86_400_000),
    ...over,
  };
};

const enrol = (tenantId: string, id: string, over: object = {}) =>
  withTenant(app, tenantId, (tx) =>
    tx.registeredDevice.update({
      where: { id },
      data: {
        tokenHash: hex(),
        enrolledAt: new Date(),
        enrolCodeHash: null,
        userAgent: 'Chrome kiosk',
        ...over,
      },
    }),
  );

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 3 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  for (const id of [T, U]) {
    await withTenant(owner, id, async (tx) => {
      await tx.tenant.create({
        data: { id, code: `DV${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji' },
      });
      await ensureSystemRoles(tx, id);
    });
  }
  units.t = await unit(T);
  units.u = await unit(U);
  adminT = newId();
  await withTenant(app, T, (tx) =>
    tx.user.create({
      data: { id: adminT, tenantId: T, username: `adm.${adminT.slice(-8)}`, displayName: 'Admin Uji' },
    }),
  );
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('registered_devices jenis kiosk/display (ADR-0027)', () => {
  it('isolasi tenant + unit dan pembuat harus milik tenant yang sama', async () => {
    const d = principal(T, { createdBy: adminT });
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    expect(
      await withTenant(app, U, (tx) => tx.registeredDevice.findUnique({ where: { id: d.id } })),
    ).toBeNull();
    await expect(
      withTenant(app, U, (tx) => tx.registeredDevice.create({ data: principal(T) })),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      withTenant(app, T, (tx) => tx.registeredDevice.create({ data: principal(T, { unitId: units.u }) })),
    ).rejects.toThrow(/Foreign key|foreign key/);
    await expect(
      withTenant(app, U, (tx) => tx.registeredDevice.create({ data: principal(U, { createdBy: adminT }) })),
    ).rejects.toThrow(/Foreign key|foreign key/);
    const r = await withTenant(app, U, (tx) =>
      tx.registeredDevice.updateMany({ where: { id: d.id }, data: { lastUsedAt: new Date() } }),
    );
    expect(r.count).toBe(0);
  });

  it('batasan: unit wajib, tanpa akun/PIN, jendela kode dan kredensial, token hanya bila terdaftar', async () => {
    const create = (over: object) =>
      withTenant(app, T, (tx) => tx.registeredDevice.create({ data: principal(T, over) }));
    const createdAt = new Date();
    for (const bad of [
      { unitId: null },
      { pinHash: '$argon2id$v=19$x' },
      { enrolExpiresAt: null },
      { enrolCodeHash: null },
      { createdAt, enrolExpiresAt: new Date(createdAt.getTime() + 2 * 86_400_000) },
      { createdAt, expiresAt: new Date(createdAt.getTime() + 400 * 86_400_000) },
      { tokenHash: hex() },
      { enrolledAt: new Date() },
    ]) {
      await expect(create(bad)).rejects.toThrow(/registered_devices_principal/);
    }
    await expect(create({ enrolCodeHash: 'kode-mentah' })).rejects.toThrow(
      /registered_devices_enrol_code_format/,
    );
    await expect(create({ queueDisplayId: newId() })).rejects.toThrow(/registered_devices_queue_display/);
    // Papan antrean (potongan 0b) harus milik tenant yang sama.
    const board = newId();
    await withTenant(app, U, (tx) =>
      tx.queueDisplay.create({
        data: { id: board, tenantId: U, code: `TV${board.slice(-6).toUpperCase()}`, name: 'TV uji' },
      }),
    );
    await expect(create({ kind: 'display', queueDisplayId: board })).rejects.toThrow(
      /Foreign key|foreign key/,
    );
    const own = newId();
    await withTenant(app, T, (tx) =>
      tx.queueDisplay.create({
        data: { id: own, tenantId: T, code: `TV${own.slice(-6).toUpperCase()}`, name: 'TV uji' },
      }),
    );
    await create({ kind: 'display', queueDisplayId: own });
    // Kode yang sama tidak boleh dipakai dua perangkat aktif di satu RS.
    const code = hex();
    await create({ enrolCodeHash: code });
    await expect(create({ enrolCodeHash: code })).rejects.toThrow(/registered_devices_enrol_code|Unique/);
  });

  it('PIN staf tetap wajib bertoken dan tidak boleh memakai kolom prinsipal', async () => {
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.create({
          data: { ...principal(T), kind: 'staff_pin', tokenHash: null },
        }),
      ),
    ).rejects.toThrow(/registered_devices_staff_pin/);
  });

  it('pendaftaran sekali: hanya kolom pendaftaran, kode dibuang, tidak bisa diulang', async () => {
    const d = principal(T);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    // Kode tidak dibuang → ditolak.
    await expect(enrol(T, d.id, { enrolCodeHash: d.enrolCodeHash })).rejects.toThrow(/DEVICE_IMMUTABLE/);
    // Menyelipkan perubahan lain saat mendaftar → ditolak (nama tidak bisa diubah aplikasi sama sekali).
    await expect(enrol(T, d.id, { name: 'Diganti' })).rejects.toThrow(/permission denied/);
    await enrol(T, d.id);
    const row = await withTenant(app, T, (tx) =>
      tx.registeredDevice.findUniqueOrThrow({ where: { id: d.id } }),
    );
    expect(row.enrolCodeHash).toBeNull();
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    // Token tidak bisa diganti setelah terdaftar.
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.update({ where: { id: d.id }, data: { tokenHash: hex() } }),
      ),
    ).rejects.toThrow(/DEVICE_IMMUTABLE/);
    // Hanya penanda pakai dan pencabutan yang masih bisa berubah.
    await withTenant(app, T, (tx) =>
      tx.registeredDevice.update({ where: { id: d.id }, data: { lastUsedAt: new Date() } }),
    );
  });

  it('kode kedaluwarsa tidak bisa dipakai mendaftar, juga oleh pemilik tabel', async () => {
    const createdAt = new Date(Date.now() - 20 * 60_000);
    const d = principal(T, { createdAt, enrolExpiresAt: new Date(createdAt.getTime() + 15 * 60_000) });
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    await expect(enrol(T, d.id)).rejects.toThrow(/DEVICE_IMMUTABLE/);
    await expect(
      withTenant(owner, T, (tx) =>
        tx.registeredDevice.update({
          where: { id: d.id },
          data: { tokenHash: hex(), enrolledAt: new Date(), enrolCodeHash: null },
        }),
      ),
    ).rejects.toThrow(/DEVICE_IMMUTABLE/);
  });

  it('dicabut (termasuk yang belum mendaftar) final', async () => {
    const d = principal(T);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    await withTenant(app, T, (tx) =>
      tx.registeredDevice.update({
        where: { id: d.id },
        data: { revokedAt: new Date(), revokedReason: 'admin_revoked', revokedBy: adminT },
      }),
    );
    await expect(enrol(T, d.id)).rejects.toThrow(/DEVICE_IMMUTABLE/);
  });
});
