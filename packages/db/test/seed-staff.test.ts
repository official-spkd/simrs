/**
 * Fase 1 potongan 10d · Seed staf fiktif: isi daftar (NIP fiktif, 16 peran, unit seed), akun tanpa kata sandi dan
 * tanpa MFA, penugasan sah, idempoten (juga bila dua seed berjalan bersamaan), dan isolasi tenant. Bukti bahwa staf
 * seed tidak bisa masuk sampai admin mereset sandinya ada di apps/api (`seed-staff.test.ts`).
 */
import { createUserSchema, newId, normalizePhone, SYSTEM_ROLES } from '@simrs/shared';
import { decryptField } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeAssignments,
  createPrismaClient,
  ensureSystemRoles,
  PRESENTATION_PERSONAS,
  PRESENTATION_USERNAME_PREFIX,
  type PrismaClient,
  SEED_STAFF,
  SEED_STAFF_VALID_FROM,
  SEED_UNITS,
  seedHospitalStructure,
  seedStaff,
  seedStaffPhone,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

// Kunci uji khusus tes ini (bukan .env): no. HP staf hanya dienkripsi di tenant baru, tidak di RSFA/RSFB bersama.
const encKeyB64 = Buffer.alloc(32, 21).toString('base64');
const NIPS = SEED_STAFF.map((s) => s.nip);
const POSITIONS = SEED_STAFF.reduce((n, s) => n + s.positions.length, 0);
const ROLE_CODES = Object.keys(SYSTEM_ROLES).sort();

let app: PrismaClient;
let owner: PrismaClient;

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 4 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

/** RS fiktif baru dengan 16 peran bawaan; `structure` = gedung + unit + kamar seed (seperti `pnpm db:seed`). */
async function freshTenant(opts: { roles?: boolean; structure?: boolean } = {}): Promise<string> {
  const id = newId();
  await withTenant(owner, id, async (tx) => {
    await tx.tenant.create({
      data: { id, code: `STF${id.slice(-6).toUpperCase()}`, name: 'RS Fiktif Uji Staf' },
    });
    if (opts.roles !== false) await ensureSystemRoles(tx, id);
    if (opts.structure !== false) await seedHospitalStructure(tx, id);
  });
  return id;
}

/** Staf seed di tenant aktif beserta kredensial, faktor MFA, dan penugasannya (dibaca sebagai simrs_app, RLS). */
function readSeededStaff(tenantId: string) {
  return withTenant(app, tenantId, (tx) =>
    tx.user.findMany({
      where: { username: { in: NIPS } },
      orderBy: { username: 'asc' },
      select: {
        id: true,
        tenantId: true,
        username: true,
        displayName: true,
        phoneEnc: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        credential: { select: { userId: true } },
        mfaFactors: { select: { id: true } },
        assignments: {
          select: {
            validFrom: true,
            validUntil: true,
            role: { select: { code: true } },
            unit: { select: { code: true, tenantId: true } },
          },
        },
      },
    }),
  );
}

/** Tunggu sampai ada transaksi di database tes ini yang menunggu kunci (batas ~5 detik). */
async function waitForLockWaiter() {
  for (let i = 0; i < 100; i++) {
    const [row] = await owner.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND a.datname = current_database()`;
    if ((row?.n ?? 0) > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Tidak ada transaksi yang menunggu kunci');
}

const counts = (tenantId: string) =>
  withTenant(app, tenantId, async (tx) => ({
    users: await tx.user.count({ where: { username: { in: NIPS } } }),
    assignments: await tx.staffAssignment.count({ where: { user: { username: { in: NIPS } } } }),
    audits: await tx.auditEvent.count({ where: { resourceType: 'user', action: 'create' } }),
  }));

describe('daftar staf seed (SEED_STAFF)', () => {
  it('±30 staf fiktif: NIP berawalan 9999 berstruktur, unik, sah sebagai nama pengguna; no. HP fiktif sah', () => {
    expect(SEED_STAFF.length).toBeGreaterThanOrEqual(25);
    expect(SEED_STAFF.length).toBeLessThanOrEqual(35);
    // 9999 (tahun lahir mustahil) + MMDD lahir + YYYYMM pengangkatan + jenis kelamin + nomor urut.
    const nipFormat = /^9999(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(19|20)\d{2}(0[1-9]|1[0-2])[12]\d{3}$/;
    for (const s of SEED_STAFF) {
      expect(s.nip).toMatch(nipFormat);
      const parsed = createUserSchema.safeParse({
        username: s.nip,
        displayName: s.displayName,
        phone: seedStaffPhone(s),
      });
      expect(parsed.success, s.nip).toBe(true);
      expect(parsed.data?.username).toBe(s.nip);
      expect(parsed.data?.phone).toBe(seedStaffPhone(s));
      expect(normalizePhone(seedStaffPhone(s))).toBe(seedStaffPhone(s));
      expect(seedStaffPhone(s)).toMatch(/^6281300001\d{3}$/);
    }
    expect(new Set(NIPS).size).toBe(NIPS.length);
    expect(new Set(NIPS.map((n) => n.slice(-3))).size).toBe(NIPS.length);
    expect(new Set(SEED_STAFF.map((s) => s.displayName)).size).toBe(SEED_STAFF.length);
  });

  it('mencakup 16 peran bawaan dan hanya unit seed; tidak bertabrakan dengan akun presentasi', () => {
    const roles = new Set(SEED_STAFF.flatMap((s) => s.positions.map(([role]) => role)));
    expect([...roles].sort()).toEqual(ROLE_CODES);
    const unitCodes = new Set<string>(SEED_UNITS.map((u) => u.code));
    for (const s of SEED_STAFF) {
      expect(s.positions.length).toBeGreaterThan(0);
      for (const [, unit] of s.positions) if (unit !== null) expect(unitCodes.has(unit), unit).toBe(true);
    }
    const personaNames = new Set(PRESENTATION_PERSONAS.map((p) => p.displayName));
    for (const s of SEED_STAFF) {
      expect(s.nip.startsWith(PRESENTATION_USERNAME_PREFIX)).toBe(false);
      expect(personaNames.has(s.displayName), s.displayName).toBe(false);
    }
    expect(new Date(SEED_STAFF_VALID_FROM).getTime()).toBeLessThan(Date.now());
  });
});

describe('seedStaff di database', () => {
  it('membuat staf + penugasan; TANPA kredensial dan tanpa MFA; no. HP terenkripsi; audit pembuatan', async () => {
    const tenantId = await freshTenant();
    expect(await seedStaff(owner, tenantId, { encKeyB64 })).toEqual({
      created: SEED_STAFF.length,
      existing: 0,
    });

    const rows = await readSeededStaff(tenantId);
    expect(rows).toHaveLength(SEED_STAFF.length);
    for (const u of rows) {
      const s = SEED_STAFF.find((m) => m.nip === u.username);
      expect(s).toBeDefined();
      expect(u.displayName).toBe(s?.displayName);
      // Tidak ada sandi bawaan: tanpa baris user_credentials, tanpa faktor MFA, belum pernah masuk.
      expect(u.credential).toBeNull();
      expect(u.mfaFactors).toEqual([]);
      expect(u).toMatchObject({ tenantId, status: 'active', mustChangePassword: true, lastLoginAt: null });
      // No. HP tersimpan terenkripsi (staff_phone) dengan kunci tenant ini.
      expect(u.phoneEnc).not.toContain(seedStaffPhone({ nip: u.username }).slice(-7));
      expect(decryptField(u.phoneEnc ?? '', { keyB64: encKeyB64, tenantId, purpose: 'staff_phone' })).toBe(
        seedStaffPhone({ nip: u.username }),
      );
      // Penugasan persis seperti daftar: peran × unit RS ini, berlaku sejak tanggal seed, tanpa akhir.
      const got = u.assignments.map((a) => [a.role.code, a.unit?.code ?? null]).sort();
      expect(got).toEqual(s?.positions.map(([r, unit]) => [r, unit]).sort());
      for (const a of u.assignments) {
        expect(a.validFrom.toISOString()).toBe(new Date(SEED_STAFF_VALID_FROM).toISOString());
        expect(a.validUntil).toBeNull();
        if (a.unit) expect(a.unit.tenantId).toBe(tenantId);
      }
    }
    // Hitungan langsung di tabel kredensial/MFA (bukan hanya lewat relasi).
    const ids = rows.map((u) => u.id);
    const secrets = await withTenant(app, tenantId, async (tx) => ({
      credentials: await tx.userCredential.count({ where: { userId: { in: ids } } }),
      factors: await tx.mfaFactor.count({ where: { userId: { in: ids } } }),
    }));
    expect(secrets).toEqual({ credentials: 0, factors: 0 });

    // Penugasan berlaku sekarang, dan 16 peran terwakili di RS ini.
    const active = await withTenant(app, tenantId, async (tx) =>
      (await Promise.all(ids.map((id) => activeAssignments(tx, id)))).flat(),
    );
    expect(active).toHaveLength(POSITIONS);
    expect([...new Set(active.map((a) => a.role.code))].sort()).toEqual(ROLE_CODES);

    const audits = await withTenant(app, tenantId, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'user', action: 'create', resourceId: { in: ids } } }),
    );
    expect(audits).toHaveLength(SEED_STAFF.length);
    for (const a of audits) expect(a.details).toMatchObject({ via: 'seed' });
    expect(JSON.stringify(audits.map((a) => a.details))).not.toMatch(/password|sandi|phone|62813/i);
  });

  it('idempoten: diulang tidak menambah apa pun dan tidak menimpa perubahan admin', async () => {
    const tenantId = await freshTenant();
    await seedStaff(owner, tenantId, { encKeyB64 });
    const before = await counts(tenantId);
    expect(before).toEqual({ users: SEED_STAFF.length, assignments: POSITIONS, audits: SEED_STAFF.length });

    expect(await seedStaff(owner, tenantId, { encKeyB64 })).toEqual({
      created: 0,
      existing: SEED_STAFF.length,
    });
    expect(await counts(tenantId)).toEqual(before);

    // Admin menonaktifkan satu akun dan mengakhiri satu penugasan; seed ulang tidak mengembalikannya.
    const [first, second] = await readSeededStaff(tenantId);
    const ended = new Date();
    await withTenant(app, tenantId, async (tx) => {
      await tx.user.update({ where: { id: first?.id }, data: { status: 'disabled' } });
      await tx.staffAssignment.updateMany({
        where: { userId: second?.id },
        data: { validUntil: ended, endReason: 'Mutasi unit (uji)' },
      });
    });
    await seedStaff(owner, tenantId, { encKeyB64 });
    expect(await counts(tenantId)).toEqual(before);
    const after = await withTenant(app, tenantId, async (tx) => ({
      status: (await tx.user.findUnique({ where: { id: first?.id } }))?.status,
      active: (await activeAssignments(tx, second?.id ?? '')).length,
    }));
    expect(after).toEqual({ status: 'disabled', active: 0 });
  });

  it('dua seed bersamaan di RS yang sama tidak menggandakan akun', async () => {
    const tenantId = await freshTenant();
    const [a, b] = await Promise.all([
      seedStaff(owner, tenantId, { encKeyB64 }),
      seedStaff(owner, tenantId, { encKeyB64 }),
    ]);
    expect((a?.created ?? 0) + (b?.created ?? 0)).toBe(SEED_STAFF.length);
    expect((a?.existing ?? 0) + (b?.existing ?? 0)).toBe(SEED_STAFF.length);
    expect(await counts(tenantId)).toEqual({
      users: SEED_STAFF.length,
      assignments: POSITIONS,
      audits: SEED_STAFF.length,
    });
  });

  it('NIP sedang dibuat transaksi lain: seed menunggu, lalu menganggapnya sudah ada (tanpa galat, tanpa ganda)', async () => {
    const tenantId = await freshTenant();
    const member = SEED_STAFF[0];
    if (!member) throw new Error('SEED_STAFF kosong');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let inserted: () => void = () => undefined;
    const insertedSignal = new Promise<void>((r) => {
      inserted = r;
    });
    // Transaksi lain membuat NIP yang sama dan belum commit: insert seed tertahan indeks unik sampai commit.
    const holder = withTenant(
      app,
      tenantId,
      async (tx) => {
        await tx.user.create({
          data: { id: newId(), tenantId, username: member.nip, displayName: 'Akun bersaing (uji)' },
        });
        inserted();
        await gate;
      },
      { timeoutMs: 30_000 },
    );
    await insertedSignal;
    const seeding = seedStaff(owner, tenantId, { encKeyB64, staff: [member] });
    await waitForLockWaiter();
    release();
    await holder;
    expect(await seeding).toEqual({ created: 0, existing: 1 });
    const rows = await withTenant(app, tenantId, (tx) =>
      tx.user.findMany({ where: { username: member.nip }, select: { displayName: true } }),
    );
    expect(rows).toEqual([{ displayName: 'Akun bersaing (uji)' }]);
  });

  it('isolasi tenant: NIP yang sama di dua RS adalah dua akun terpisah, tidak saling terlihat', async () => {
    const tenantA = await freshTenant();
    const tenantB = await freshTenant();
    await seedStaff(owner, tenantA, { encKeyB64 });
    await seedStaff(owner, tenantB, { encKeyB64 });
    const a = await readSeededStaff(tenantA);
    const b = await readSeededStaff(tenantB);
    expect(a).toHaveLength(SEED_STAFF.length);
    expect(b).toHaveLength(SEED_STAFF.length);
    expect(a.every((u) => u.tenantId === tenantA)).toBe(true);
    expect(b.every((u) => u.tenantId === tenantB)).toBe(true);
    const idsB = b.map((u) => u.id);
    expect(a.some((u) => idsB.includes(u.id))).toBe(false);

    const leaks = await withTenant(app, tenantA, async (tx) => ({
      users: await tx.user.count({ where: { id: { in: idsB } } }),
      assignments: await tx.staffAssignment.count({ where: { userId: { in: idsB } } }),
    }));
    expect(leaks).toEqual({ users: 0, assignments: 0 });
    // No. HP terenkripsi per tenant: ciphertext RS B tidak bisa dibuka dengan konteks RS A.
    expect(() =>
      decryptField(b[0]?.phoneEnc ?? '', { keyB64: encKeyB64, tenantId: tenantA, purpose: 'staff_phone' }),
    ).toThrow();
  });

  it('peran atau struktur RS belum ada: gagal di awal tanpa menulis akun apa pun', async () => {
    const noUnits = await freshTenant({ structure: false });
    await expect(seedStaff(owner, noUnits, { encKeyB64 })).rejects.toThrow(/Unit seed .* belum ada/);
    expect(await counts(noUnits)).toEqual({ users: 0, assignments: 0, audits: 0 });
    const noRoles = await freshTenant({ roles: false });
    await expect(seedStaff(owner, noRoles, { encKeyB64 })).rejects.toThrow(/Peran .* belum ada/);
    expect(await counts(noRoles)).toEqual({ users: 0, assignments: 0, audits: 0 });
  });
});
