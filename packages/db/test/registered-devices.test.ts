/**
 * P02 · Perangkat terdaftar jenis `staff_pin` (PIN masuk cepat, ADR-0024) di database: isolasi tenant, FK komposit
 * (akun/posisi/sesi tenant lain ditolak), batasan (jenis, kolom wajib PIN, format hash, jendela 30 hari, maks. 5 salah,
 * alasan pencabutan), hak role aplikasi (tanpa hapus, hanya kolom pakai/salah/cabut yang bisa diubah), dan
 * pencabutan final (juga bagi pemilik tabel).
 */
import { hashToken, randomToken } from '@simrs/shared/node';
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, ensureSystemRoles, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
/** Dua RS fiktif baru per jalan tes (tidak bergantung pada isi database). */
const T = newId();
const U = newId();
const people: Record<string, { userId: string; assignmentId: string }> = {};

const ARGON =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

async function person(tenantId: string) {
  const userId = newId();
  const assignmentId = newId();
  await withTenant(app, tenantId, async (tx) => {
    await tx.user.create({
      data: { id: userId, tenantId, username: `pin.${userId.slice(-8)}`, displayName: 'Perawat Uji Fiktif' },
    });
    const role = await tx.role.findFirstOrThrow({ where: { code: 'perawat' } });
    await tx.staffAssignment.create({ data: { id: assignmentId, tenantId, userId, roleId: role.id } });
  });
  return { userId, assignmentId };
}

const device = (tenantId: string, p: { userId: string; assignmentId: string }, over: object = {}) => {
  const createdAt = new Date();
  return {
    id: newId(),
    tenantId,
    userId: p.userId,
    assignmentId: p.assignmentId,
    name: 'Komputer nurse station',
    tokenHash: hashToken(randomToken()),
    pinHash: ARGON,
    pinKeyId: 'v1',
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 30 * 86_400_000),
    ...over,
  };
};

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 3 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  for (const id of [T, U]) {
    await withTenant(owner, id, async (tx) => {
      await tx.tenant.create({
        data: { id, code: `PN${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji PIN' },
      });
      await ensureSystemRoles(tx, id);
    });
  }
  people.t = await person(T);
  people.u = await person(U);
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('registered_devices jenis staff_pin (P02, ADR-0024)', () => {
  it('isolasi tenant: tidak terlihat, tidak bisa diubah, dan tidak bisa ditulis atas nama tenant lain', async () => {
    const d = device(T, people.t!);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    expect(
      await withTenant(app, U, (tx) => tx.registeredDevice.findUnique({ where: { id: d.id } })),
    ).toBeNull();
    const r = await withTenant(app, U, (tx) =>
      tx.registeredDevice.updateMany({ where: { id: d.id }, data: { failedAttempts: 1 } }),
    );
    expect(r.count).toBe(0);
    await expect(
      withTenant(app, U, (tx) => tx.registeredDevice.create({ data: device(T, people.t!) })),
    ).rejects.toThrow(/row-level security/i);
    expect(
      (await withTenant(app, T, (tx) => tx.registeredDevice.findUnique({ where: { id: d.id } })))?.id,
    ).toBe(d.id);
  });

  it('FK komposit: akun, posisi, dan pencabut harus milik tenant yang sama; sesi hanya ke PIN tenant sendiri', async () => {
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.create({ data: device(T, { ...people.t!, userId: people.u!.userId }) }),
      ),
    ).rejects.toThrow(/Foreign key|foreign key/);
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.create({
          data: device(T, { ...people.t!, assignmentId: people.u!.assignmentId }),
        }),
      ),
    ).rejects.toThrow(/Foreign key|foreign key/);
    const d = device(T, people.t!);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.update({
          where: { id: d.id },
          data: { revokedAt: new Date(), revokedReason: 'admin_revoked', revokedBy: people.u!.userId },
        }),
      ),
    ).rejects.toThrow(/Foreign key|foreign key/);
    const foreign = device(U, people.u!);
    await withTenant(app, U, (tx) => tx.registeredDevice.create({ data: foreign }));
    await expect(
      withTenant(app, T, (tx) =>
        tx.authSession.create({
          data: {
            id: newId(),
            tenantId: T,
            userId: people.t!.userId,
            accessHash: hashToken(randomToken()),
            accessExpiresAt: new Date(Date.now() + 60_000),
            refreshHash: hashToken(randomToken()),
            refreshExpiresAt: new Date(Date.now() + 60_000),
            lastSeenAt: new Date(),
            idleTimeoutMinutes: 5,
            deviceId: foreign.id,
          },
        }),
      ),
    ).rejects.toThrow(/Foreign key|foreign key/);
  });

  it('batasan: jenis, kolom wajib PIN, hash token/PIN, jendela maks. 30 hari, maks. 5 salah, alasan pencabutan', async () => {
    const create = (over: object) =>
      withTenant(app, T, (tx) => tx.registeredDevice.create({ data: device(T, people.t!, over) }));
    await expect(create({ kind: 'tablet' })).rejects.toThrow(/registered_devices_kind/);
    // Jenis prinsipal (ADR-0027) tidak boleh membawa akun/posisi/PIN.
    await expect(create({ kind: 'kiosk' })).rejects.toThrow(/registered_devices_principal/);
    for (const missing of [{ userId: null }, { assignmentId: null }, { pinHash: null }, { pinKeyId: null }]) {
      await expect(create(missing)).rejects.toThrow(/registered_devices_staff_pin/);
    }
    await expect(create({ pinKeyId: 'v01' })).rejects.toThrow(/registered_devices_pin_key_id/);
    await expect(create({ tokenHash: 'bukan-hash' })).rejects.toThrow(/registered_devices_token_hash_format/);
    await expect(create({ pinHash: '482913' })).rejects.toThrow(/registered_devices_pin_hash_argon2/);
    const createdAt = new Date();
    await expect(
      create({ createdAt, expiresAt: new Date(createdAt.getTime() + 31 * 86_400_000) }),
    ).rejects.toThrow(/registered_devices_staff_pin/);
    await expect(create({ createdAt, expiresAt: createdAt })).rejects.toThrow(/registered_devices_window/);
    await expect(create({ name: 'PC' })).rejects.toThrow(/registered_devices_name_length/);

    const d = device(T, people.t!);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    const update = (data: object) =>
      withTenant(app, T, (tx) => tx.registeredDevice.update({ where: { id: d.id }, data }));
    await update({ failedAttempts: 5 });
    await expect(update({ failedAttempts: 6 })).rejects.toThrow(/registered_devices_failed_attempts/);
    await expect(update({ revokedAt: new Date() })).rejects.toThrow(/registered_devices_revoked_consistent/);
    await expect(update({ revokedAt: new Date(), revokedReason: 'bosan' })).rejects.toThrow(
      /registered_devices_revoked_consistent/,
    );
    await expect(update({ revokedBy: people.t!.userId })).rejects.toThrow(
      /registered_devices_revoked_consistent/,
    );
    // Rotasi kunci hash: PIN berlada kunci yang dipensiunkan dicabut dengan alasan sendiri (ADR-0015).
    await update({ revokedAt: new Date(), revokedReason: 'key_rotated' });
  });

  it('role aplikasi: tanpa hapus; jenis, hash, akun, posisi, dan masa berlaku tidak bisa diubah', async () => {
    const d = device(T, people.t!);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    await expect(
      withTenant(app, T, (tx) => tx.$executeRaw`DELETE FROM registered_devices WHERE id = ${d.id}::uuid`),
    ).rejects.toThrow(/permission denied/);
    for (const data of [
      { pinHash: ARGON.replace('aGFz', 'aGF6') },
      { expiresAt: new Date(Date.now() + 86_400_000) },
      { name: 'Nama diganti' },
      { kind: 'staff_pin' },
      { userId: people.t!.userId },
      { pinKeyId: 'v2' },
    ]) {
      await expect(
        withTenant(app, T, (tx) => tx.registeredDevice.update({ where: { id: d.id }, data })),
      ).rejects.toThrow(/permission denied/);
    }
    // Kolom pendaftaran prinsipal (ADR-0027) bisa ditulis aplikasi, tetapi penjaga menolaknya untuk PIN.
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.update({ where: { id: d.id }, data: { tokenHash: hashToken(randomToken()) } }),
      ),
    ).rejects.toThrow(/DEVICE_IMMUTABLE/);
  });

  it('pencabutan final: tidak bisa dibatalkan atau diubah, juga oleh pemilik tabel', async () => {
    const d = device(T, people.t!);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: d }));
    await withTenant(app, T, (tx) =>
      tx.registeredDevice.update({
        where: { id: d.id },
        data: { revokedAt: new Date(), revokedReason: 'user_removed', revokedBy: people.t!.userId },
      }),
    );
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.update({
          where: { id: d.id },
          data: { revokedAt: null, revokedReason: null, revokedBy: null },
        }),
      ),
    ).rejects.toThrow(/DEVICE_IMMUTABLE/);
    await expect(
      withTenant(app, T, (tx) =>
        tx.registeredDevice.update({ where: { id: d.id }, data: { failedAttempts: 0 } }),
      ),
    ).rejects.toThrow(/DEVICE_IMMUTABLE/);
    const fresh = device(T, people.t!);
    await withTenant(app, T, (tx) => tx.registeredDevice.create({ data: fresh }));
    await expect(
      withTenant(
        owner,
        T,
        (tx) =>
          tx.$executeRaw`UPDATE registered_devices SET pin_hash = ${ARGON} || 'x' WHERE id = ${fresh.id}::uuid`,
      ),
    ).rejects.toThrow(/DEVICE_IMMUTABLE/);
  });
});
