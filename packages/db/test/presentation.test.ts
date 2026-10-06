/**
 * Akun presentasi (ADR-0023 §9): tetap satu penugasan aktif sesuai persona walau struktur RS baru di-seed setelah
 * akun dibuat. Dua posisi aktif membuat masuk cepat berhenti di langkah "Pilih posisi" (ditemukan di E2E pada DB
 * tes yang kemudian di-seed).
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createPrismaClient,
  PRESENTATION_ALL_ACCESS_LABEL,
  PRESENTATION_PERSONAS,
  PRESENTATION_USERNAME_PREFIX,
  type PrismaClient,
  seedHospitalStructure,
  upsertPresentationAccounts,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

const encKeyB64 = Buffer.alloc(32, 31).toString('base64');
const personas = [{ slug: 'perawat', role: 'perawat', unitCode: 'MELATI', displayName: 'Ns. Uji Fiktif' }];

let owner: PrismaClient;
beforeAll(() => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});
afterAll(async () => owner.$disconnect());

it('struktur RS di-seed setelah akun dibuat: penugasan tanpa unit diakhiri, tinggal satu sesuai persona', async () => {
  const tenantId = newId();
  await withTenant(owner, tenantId, (tx) =>
    tx.tenant.create({
      data: {
        id: tenantId,
        code: `PRS${tenantId.slice(-6).toUpperCase()}`,
        name: 'RS Fiktif Uji Presentasi',
      },
    }),
  );
  const [first] = await upsertPresentationAccounts(owner, tenantId, { encKeyB64, personas });
  expect(first?.unitName).toBeNull(); // unit MELATI belum ada

  await withTenant(owner, tenantId, (tx) => seedHospitalStructure(tx, tenantId));
  const [again] = await upsertPresentationAccounts(owner, tenantId, { encKeyB64, personas });
  expect(again?.unitName).toBe('Bangsal Melati');
  await upsertPresentationAccounts(owner, tenantId, { encKeyB64, personas }); // idempoten

  const rows = await withTenant(owner, tenantId, (tx) =>
    tx.staffAssignment.findMany({
      orderBy: { createdAt: 'asc' },
      select: { validUntil: true, endReason: true, unit: { select: { code: true } } },
    }),
  );
  const now = Date.now();
  const active = rows.filter((r) => r.validUntil === null || r.validUntil.getTime() > now);
  expect(active.map((r) => r.unit?.code ?? null)).toEqual(['MELATI']);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ unit: null, endReason: expect.stringContaining('persona') });
});

it('Superadmin demo: satu persona bertanda allAccess, peran bawaan hanya-baca tanpa unit; tanda hanya di kredensial', async () => {
  const flagged = PRESENTATION_PERSONAS.filter((p) => p.allAccess);
  expect(flagged).toEqual([
    {
      slug: 'superadmin-demo',
      role: 'manajemen',
      unitCode: null,
      displayName: 'Superadmin demo (presentasi)',
      allAccess: true,
    },
  ]);
  // Pencarian persona per peran (panduan "Buka layar sebagai posisi") tetap menemukan persona posisi itu sendiri.
  expect(PRESENTATION_PERSONAS.find((p) => p.role === 'manajemen')?.slug).toBe('direksi');

  const tenantId = newId();
  await withTenant(owner, tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        code: `PRS${tenantId.slice(-6).toUpperCase()}`,
        name: 'RS Fiktif Uji Superadmin Demo',
      },
    });
    await seedHospitalStructure(tx, tenantId);
  });
  const creds = await upsertPresentationAccounts(owner, tenantId, {
    encKeyB64,
    personas: [...personas, ...flagged],
  });
  expect(creds.map((c) => [c.username, c.role, c.roleName, c.unitName, c.allAccess])).toEqual([
    [`${PRESENTATION_USERNAME_PREFIX}perawat`, 'perawat', 'Perawat', 'Bangsal Melati', undefined],
    [
      `${PRESENTATION_USERNAME_PREFIX}superadmin-demo`,
      'manajemen',
      PRESENTATION_ALL_ACCESS_LABEL,
      null,
      true,
    ],
  ]);

  // Di database: akun biasa dengan tepat satu penugasan peran bawaan `manajemen` (tanpa peran/izin baru).
  const rows = await withTenant(owner, tenantId, (tx) =>
    tx.staffAssignment.findMany({
      where: { user: { username: `${PRESENTATION_USERNAME_PREFIX}superadmin-demo` } },
      select: { unitId: true, validUntil: true, role: { select: { code: true, isSystem: true } } },
    }),
  );
  expect(rows).toEqual([{ unitId: null, validUntil: null, role: { code: 'manajemen', isSystem: true } }]);
});
