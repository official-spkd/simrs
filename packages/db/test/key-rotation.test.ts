/**
 * P05 · Rotasi kunci kolom v2 + job enkripsi ulang bertahap (ADR-0015, pembaruan 5 Okt 2026) di database:
 * data v1 tetap terbaca dan tercari selama rotasi, tulisan baru memakai v2, job menulis ulang semua ciphertext +
 * blind index (termasuk snapshot penggabungan bersarang), bisa dihentikan dan dilanjutkan, idempoten, aman bila
 * dua pelari bersamaan, terisolasi per tenant, dan gagal tertutup bila kunci lama hilang/salah.
 * Kunci uji acak khusus tes ini; semua data di tenant baru (tidak pernah menyentuh tenant seed bersama).
 */
import { randomBytes } from 'node:crypto';
import { type IdentifierSystem, newId } from '@simrs/shared';
import {
  decryptField,
  encryptField,
  type FieldKeys,
  fieldKeysFromEnv,
  hashToken,
  legacyFieldKeys,
  PatientCrypto,
  randomToken,
} from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  detectDuplicates,
  ensureSystemRoles,
  insertPatient,
  KeyRotationBlockedError,
  type KeyRotationTarget,
  listActiveTenantIds,
  listKeyRotationTenantIds,
  type NewPatientRecord,
  planTenantKeyRotation,
  type PrismaClient,
  revokePinsOnRetiredKeys,
  rotateTenantKeys,
  type SurvivorSnapshot,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

const key = () => randomBytes(32).toString('base64');
const v1Enc = key();
const v1Hash = key();
const v2Enc = key();
const v2Hash = key();
/** Sebelum rotasi: format lama (FIELD_*_KEY = v1). */
const before: FieldKeys = legacyFieldKeys(v1Enc, v1Hash);
/** Selama rotasi: v2 aktif, v1 hanya baca. */
const during = fieldKeysFromEnv({
  FIELD_ENCRYPTION_KEYS: `v2:${v2Enc}`,
  FIELD_ENCRYPTION_KEY: v1Enc,
  FIELD_HASH_KEYS: `v2:${v2Hash}`,
  FIELD_HASH_KEY: v1Hash,
});
/** Setelah kunci lama dipensiunkan. */
const after = fieldKeysFromEnv({ FIELD_ENCRYPTION_KEYS: `v2:${v2Enc}`, FIELD_HASH_KEYS: `v2:${v2Hash}` });

const ARGON =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

let app: PrismaClient;
let owner: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 6 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

async function freshTenant(status = 'active'): Promise<string> {
  const id = newId();
  await withTenant(owner, id, async (tx) => {
    await tx.tenant.create({
      data: { id, code: `KR${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Rotasi Kunci', status },
    });
    await ensureSystemRoles(tx, id);
  });
  return id;
}

/** NIK/BPJS fiktif unik (awalan 9999 / 0000). */
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const people = (n: number): NewPatientRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Pasien Fiktif ${['Ani', 'Budi', 'Citra', 'Dodi', 'Euis', 'Fajar', 'Gita', 'Hadi', 'Indah', 'Joko'][i % 10]}`,
    sex: i % 2 === 0 ? 'female' : 'male',
    birthDate: `19${50 + i}-0${(i % 9) + 1}-1${i % 9}`,
    motherName: 'Ibu Fiktif',
    address: `Jl. Uji No. ${i + 1}, Kota Fiktif`,
    phone: `62812${digits(8)}`,
    identifiers: { nik: `9999${digits(12)}`, bpjs: `0000${digits(9)}` },
  }));

const STATIC = {
  tenant: '',
  userId: '',
  deviceId: '',
  linkId: '',
  contactId: newId(),
  contactName: 'Anak Pasien Fiktif',
  phone: '62812555000111',
  otp: '482913',
};
const A: { id: string; records: Array<NewPatientRecord & { id: string }> } = { id: '', records: [] };
let B = '';

const sqlCount = async (
  tenantId: string,
  query: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<Array<{ n: number }>>,
) => (await withTenant(app, tenantId, query))[0]?.n ?? -1;

/** Baris tenant ini yang masih memakai kunci v1 (ciphertext `v1.` atau hash 64 hex) di semua kolom yang diputar. */
const v1Rows = (tenantId: string) =>
  sqlCount(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT (
        (SELECT count(*) FROM users WHERE phone_enc LIKE 'v1.%')
        + (SELECT count(*) FROM mfa_factors WHERE secret_enc LIKE 'v1.%')
        + (SELECT count(*) FROM login_challenges WHERE otp_enc LIKE 'v1.%')
        + (SELECT count(*) FROM patients WHERE address_enc LIKE 'v1.%' OR phone_enc LIKE 'v1.%' OR phone_hash !~ '^v2:')
        + (SELECT count(*) FROM patient_identifiers WHERE value_enc LIKE 'v1.%' OR value_hash !~ '^v2:')
        + (SELECT count(*) FROM patient_links WHERE survivor_snapshot_enc LIKE 'v1.%')
        + (SELECT count(*) FROM patient_contacts
           WHERE name_enc LIKE 'v1.%' OR phone_enc LIKE 'v1.%' OR address_enc LIKE 'v1.%')
      )::int AS n`,
  );

const findByIdentifier = (tenantId: string, keys: FieldKeys, system: IdentifierSystem, value: string) =>
  withTenant(app, tenantId, (tx) =>
    tx.patientIdentifier.findMany({
      where: {
        system,
        active: true,
        valueHash: { in: new PatientCrypto(keys, tenantId).identifierHashes(system, value) },
      },
      select: { patientId: true },
    }),
  );

/** Data tenant A ditulis dengan kunci v1 (seperti produksi sebelum rotasi). */
async function seedTenantA(): Promise<void> {
  A.id = await freshTenant();
  const crypto = new PatientCrypto(before, A.id);
  for (const rec of people(7)) {
    const { id } = await withTenant(app, A.id, (tx) => insertPatient(tx, crypto, rec));
    A.records.push({ ...rec, id });
  }
  const [p0, p1] = A.records as [NewPatientRecord & { id: string }, NewPatientRecord & { id: string }];
  const userId = newId();
  const deviceId = newId();
  const linkId = newId();
  await withTenant(app, A.id, async (tx) => {
    const enc = (plain: string, purpose: 'staff_phone' | 'mfa_secret' | 'login_otp') =>
      encryptField(plain, { ring: before.enc, tenantId: A.id, purpose });
    await tx.user.create({
      data: {
        id: userId,
        tenantId: A.id,
        username: `kr.${userId.slice(-8)}`,
        displayName: 'Perawat Uji Fiktif',
        phoneEnc: enc(STATIC.phone, 'staff_phone'),
      },
    });
    await tx.mfaFactor.create({
      data: { id: newId(), tenantId: A.id, userId, secretEnc: enc('JBSWY3DPEHPK3PXP', 'mfa_secret') },
    });
    await tx.loginChallenge.create({
      data: {
        id: newId(),
        tenantId: A.id,
        userId,
        secretHash: hashToken(randomToken()),
        expiresAt: new Date(Date.now() + 300_000),
        otpEnc: enc(STATIC.otp, 'login_otp'),
        otpChannel: 'whatsapp',
        otpSentAt: new Date(),
        otpSends: 1,
      },
    });
    const role = await tx.role.findFirstOrThrow({ where: { code: 'perawat' } });
    const assignmentId = newId();
    await tx.staffAssignment.create({ data: { id: assignmentId, tenantId: A.id, userId, roleId: role.id } });
    const createdAt = new Date();
    await tx.registeredDevice.create({
      data: {
        id: deviceId,
        tenantId: A.id,
        userId,
        assignmentId,
        name: 'Komputer nurse station',
        tokenHash: hashToken(randomToken()),
        pinHash: ARGON,
        pinKeyId: 'v1',
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 30 * 86_400_000),
      },
    });
    // Keluarga/penanggung jawab (F03, append-only) dengan nama + HP terenkripsi v1.
    await tx.patientContact.create({
      data: {
        id: STATIC.contactId,
        tenantId: A.id,
        patientId: p0.id,
        relation: 'anak',
        nameEnc: crypto.encryptContact(STATIC.contactName),
        phoneEnc: crypto.encryptContact(STATIC.phone),
        isGuarantor: true,
      },
    });
    // Snapshot penggabungan (B → A) berisi ciphertext + hash v1 bersarang.
    const p0row = await tx.patient.findUniqueOrThrow({
      where: { id: p0.id },
      select: { addressEnc: true, phoneEnc: true, phoneHash: true, identifiers: true },
    });
    const bpjs = p0row.identifiers.find((i) => i.system === 'bpjs');
    const snapshot: SurvivorSnapshot = {
      name: { name: p0.name, nameSearch: 'x' },
      address: p0row.addressEnc,
      phone: { enc: p0row.phoneEnc, hash: p0row.phoneHash },
      identifiers: { bpjs: bpjs ? { valueEnc: bpjs.valueEnc, valueHash: bpjs.valueHash } : null, ihs: null },
    };
    await tx.patientLink.create({
      data: {
        id: linkId,
        tenantId: A.id,
        survivorId: p0.id,
        mergedId: p1.id,
        reason: 'Pasangan uji rotasi kunci',
        takenAttributes: ['address', 'phone', 'bpjs'],
        survivorSnapshotEnc: crypto.encryptSnapshot(snapshot),
      },
    });
  });
  Object.assign(STATIC, { tenant: A.id, userId, deviceId, linkId });
}

beforeAll(async () => {
  await seedTenantA();
  B = await freshTenant();
  await withTenant(app, B, (tx) =>
    insertPatient(tx, new PatientCrypto(before, B), people(1)[0] as NewPatientRecord),
  );
});

const pendingOf = (plan: Awaited<ReturnType<typeof planTenantKeyRotation>>) =>
  Object.fromEntries(plan.targets.map((t) => [t.target, t.pending])) as Record<KeyRotationTarget, number>;

describe('rotasi kunci kolom v2 (P05, ADR-0015)', () => {
  it('dry-run: menghitung baris per versi kunci tanpa menulis; pemeriksaan awal bersih', async () => {
    const plan = await planTenantKeyRotation(app, A.id, during);
    expect(plan.problems).toEqual([]);
    expect(plan).toMatchObject({ encKeyId: 'v2', hashKeyId: 'v2', retireReady: false, pins: { v1: 1 } });
    expect(pendingOf(plan)).toEqual({
      users: 1,
      mfa_factors: 1,
      login_challenges: 1,
      patients: 7,
      patient_identifiers: 14,
      patient_links: 1,
      patient_contacts: 1,
    });
    const ids = plan.targets.find((t) => t.target === 'patient_identifiers');
    expect(ids?.columns).toEqual([
      { column: 'value_enc', kind: 'enc', counts: { v1: 14 } },
      { column: 'value_hash', kind: 'hash', counts: { v1: 14 } },
    ]);
    expect(await v1Rows(A.id)).toBeGreaterThan(0);
    expect(await withTenant(app, A.id, (tx) => tx.fieldKeyRotation.count())).toBe(0);
  });

  it('selama rotasi: data v1 terbaca dan tercari (NIK, BPJS, duplikat lintas versi kunci); tulisan baru v2', async () => {
    const crypto = new PatientCrypto(during, A.id);
    for (const r of A.records) {
      expect(await findByIdentifier(A.id, during, 'nik', r.identifiers?.nik as string)).toEqual([
        { patientId: r.id },
      ]);
      expect(await findByIdentifier(A.id, during, 'bpjs', r.identifiers?.bpjs as string)).toEqual([
        { patientId: r.id },
      ]);
    }
    // Tanpa cincin (hanya kunci v2) baris v1 tidak ketemu: inilah alasan pencarian memakai semua kunci.
    const r3 = A.records[3] as NewPatientRecord & { id: string };
    expect(await findByIdentifier(A.id, after, 'nik', r3.identifiers?.nik as string)).toEqual([]);

    // Pendaftaran baru (v2) dengan BPJS + HP sama dengan pasien lama (v1): hash beda versi kunci tetap terbanding.
    const dup = await withTenant(app, A.id, async (tx) => {
      const { id: _existing, ...same } = r3;
      const p = await insertPatient(tx, crypto, {
        ...same,
        name: `${r3.name}h`,
        identifiers: { bpjs: r3.identifiers?.bpjs as string },
      });
      return { ...p, result: await detectDuplicates(tx, crypto, p.id) };
    });
    expect(dup.result.unreadable).toEqual([]);
    expect(dup.result.proposed).toBeGreaterThanOrEqual(1);
    const cand = await withTenant(app, A.id, (tx) =>
      tx.patientMatchCandidate.findFirst({ where: { patientAId: r3.id, patientBId: dup.id } }),
    );
    expect(cand?.reasons).toEqual(expect.arrayContaining(['bpjs_sama', 'hp_sama']));
    const stored = await withTenant(app, A.id, (tx) =>
      tx.patientIdentifier.findFirstOrThrow({ where: { patientId: dup.id } }),
    );
    expect(stored.valueEnc.startsWith('v2.')).toBe(true);
    expect(stored.valueHash).toMatch(/^v2:[0-9a-f]{64}$/);
  });

  it('job berhenti di tengah lalu dilanjutkan dari kursor; data campuran tetap terbaca; akhirnya semua v2', async () => {
    const stop = new AbortController();
    const first = await rotateTenantKeys(app, A.id, during, {
      batchSize: 3,
      pauseMs: 0,
      signal: stop.signal,
      onBatch: (b) => {
        if (b.target === 'patients' && b.scanned > 0) stop.abort();
      },
    });
    expect(first.interrupted).toBe(true);
    const status = await withTenant(app, A.id, (tx) =>
      tx.fieldKeyRotation.findUniqueOrThrow({
        where: { tenantId_target: { tenantId: A.id, target: 'patients' } },
      }),
    );
    expect(status).toMatchObject({
      scanned: 3,
      rewritten: 3,
      finishedAt: null,
      encKeyId: 'v2',
      hashKeyId: 'v2',
    });
    expect(status.cursorId).not.toBeNull();

    // Campuran v1/v2: semua pasien tetap terbaca dengan cincin, identifier belum disentuh tetap tercari.
    const crypto = new PatientCrypto(during, A.id);
    const rows = await withTenant(app, A.id, (tx) =>
      tx.patient.findMany({ where: { id: { in: A.records.map((r) => r.id) } } }),
    );
    expect(new Set(rows.map((r) => r.addressEnc?.slice(0, 3)))).toEqual(new Set(['v1.', 'v2.']));
    for (const r of rows) {
      const rec = A.records.find((x) => x.id === r.id);
      expect(crypto.decryptContact(r.addressEnc as string)).toBe(rec?.address);
      expect(crypto.phoneHashes(rec?.phone as string)).toContain(r.phoneHash);
    }

    const resumed = await rotateTenantKeys(app, A.id, during, { batchSize: 3, pauseMs: 0 });
    expect(resumed.interrupted).toBe(false);
    const by = Object.fromEntries(resumed.targets.map((t) => [t.target, t]));
    // Dilanjutkan dari kursor: sisa 4 pasien, bukan memindai ulang dari awal.
    expect(by.patients).toMatchObject({ scanned: 4, rewritten: 4, failed: 0, remaining: 0 });
    expect(by.patient_identifiers).toMatchObject({ rewritten: 14, failed: 0, remaining: 0 });
    expect(by.patient_links).toMatchObject({ rewritten: 1, failed: 0, remaining: 0 });
    expect(by.patient_contacts).toMatchObject({ rewritten: 1, failed: 0, remaining: 0 });
    expect(await v1Rows(A.id)).toBe(0);

    const statuses = await withTenant(app, A.id, (tx) => tx.fieldKeyRotation.findMany());
    expect(statuses).toHaveLength(7);
    expect(statuses.every((s) => s.finishedAt !== null && s.remaining === 0 && s.failed === 0)).toBe(true);

    const audits = await withTenant(app, A.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'field_key_rotation' } }),
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const text = JSON.stringify(audits, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    for (const r of A.records) {
      expect(text).not.toContain(r.identifiers?.nik as string);
      expect(text).not.toContain(r.phone as string);
    }
  });

  it('idempoten; setelah job semua data terbaca dan tercari dengan kunci v2 saja, termasuk isi snapshot gabung', async () => {
    const again = await rotateTenantKeys(app, A.id, during, { batchSize: 3, pauseMs: 0 });
    expect(again.targets.every((t) => t.rewritten === 0 && t.failed === 0 && t.remaining === 0)).toBe(true);

    const crypto = new PatientCrypto(after, A.id);
    for (const r of A.records) {
      const found = await findByIdentifier(A.id, after, 'nik', r.identifiers?.nik as string);
      expect(found).toEqual([{ patientId: r.id }]);
      const ids = await withTenant(app, A.id, (tx) =>
        tx.patientIdentifier.findMany({ where: { patientId: r.id }, orderBy: { system: 'asc' } }),
      );
      expect(ids.map((i) => crypto.decryptIdentifier(i.valueEnc))).toEqual([
        r.identifiers?.bpjs,
        r.identifiers?.nik,
      ]);
    }
    const ctx = (purpose: 'staff_phone' | 'mfa_secret' | 'login_otp') => ({
      ring: after.enc,
      tenantId: A.id,
      purpose,
    });
    await withTenant(app, A.id, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: STATIC.userId } });
      expect(decryptField(user.phoneEnc as string, ctx('staff_phone'))).toBe(STATIC.phone);
      const factor = await tx.mfaFactor.findFirstOrThrow({ where: { userId: STATIC.userId } });
      expect(decryptField(factor.secretEnc, ctx('mfa_secret'))).toBe('JBSWY3DPEHPK3PXP');
      const ch = await tx.loginChallenge.findFirstOrThrow({ where: { userId: STATIC.userId } });
      expect(decryptField(ch.otpEnc as string, ctx('login_otp'))).toBe(STATIC.otp);

      const contact = await tx.patientContact.findUniqueOrThrow({ where: { id: STATIC.contactId } });
      expect(crypto.decryptContact(contact.nameEnc)).toBe(STATIC.contactName);
      expect(crypto.decryptContact(contact.phoneEnc as string)).toBe(STATIC.phone);
      expect(contact).toMatchObject({ relation: 'anak', isGuarantor: true, status: 'active' });

      const link = await tx.patientLink.findUniqueOrThrow({ where: { id: STATIC.linkId } });
      const snap = crypto.decryptSnapshot<SurvivorSnapshot>(link.survivorSnapshotEnc as string);
      const p0 = A.records[0] as NewPatientRecord & { id: string };
      expect(crypto.decryptContact(snap.address as string)).toBe(p0.address);
      expect(crypto.decryptContact(snap.phone?.enc as string)).toBe(p0.phone);
      expect(snap.phone?.hash).toBe(crypto.phoneHash(p0.phone as string));
      expect(crypto.decryptIdentifier(snap.identifiers?.bpjs?.valueEnc as string)).toBe(p0.identifiers?.bpjs);
      expect(snap.identifiers?.bpjs?.valueHash).toBe(
        crypto.identifierHash('bpjs', p0.identifiers?.bpjs as string),
      );
      expect(snap.identifiers?.ihs).toBeNull();
    });

    // Data sudah v2, tetapi PIN lama masih berlada v1: kunci hash lama belum boleh dipensiunkan.
    const plan = await planTenantKeyRotation(app, A.id, after);
    expect(plan.problems).toEqual([]);
    expect(Object.values(pendingOf(plan)).every((n) => n === 0)).toBe(true);
    expect(plan).toMatchObject({ pins: { v1: 1 }, retireReady: false });
    expect(await revokePinsOnRetiredKeys(app, A.id, after)).toBe(1);
    const device = await withTenant(app, A.id, (tx) =>
      tx.registeredDevice.findUniqueOrThrow({ where: { id: STATIC.deviceId } }),
    );
    expect(device.revokedReason).toBe('key_rotated');
    const pinAudit = await withTenant(app, A.id, (tx) =>
      tx.auditEvent.findFirst({ where: { resourceType: 'registered_device', reason: 'key_rotated' } }),
    );
    expect(pinAudit).toMatchObject({
      action: 'deactivate',
      details: { revoked: 1, keyIds: ['v1'], current: 'v2' },
    });
    expect(await planTenantKeyRotation(app, A.id, after)).toMatchObject({ retireReady: true, pins: {} });
  });

  it('isolasi tenant: tenant lain tidak tersentuh dan status rotasi tenant A tidak terlihat darinya', async () => {
    const [row] = await withTenant(app, B, (tx) => tx.patientIdentifier.findMany({ take: 1 }));
    expect(row?.valueEnc.startsWith('v1.')).toBe(true);
    expect(row?.valueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await withTenant(app, B, (tx) => tx.fieldKeyRotation.count())).toBe(0);
    expect(await withTenant(app, A.id, (tx) => tx.fieldKeyRotation.count())).toBe(7);
  });

  it('gagal tertutup: kunci lama hilang atau salah → masalah dilaporkan, job tidak menulis apa pun', async () => {
    const snapshot = () =>
      withTenant(app, B, (tx) =>
        tx.patientIdentifier.findMany({ select: { valueEnc: true, valueHash: true } }),
      );
    const original = await snapshot();
    const wrongEnc = fieldKeysFromEnv({
      FIELD_ENCRYPTION_KEYS: `v2:${v2Enc},v1:${key()}`,
      FIELD_HASH_KEYS: `v2:${v2Hash},v1:${v1Hash}`,
    });
    const wrongHash = fieldKeysFromEnv({
      FIELD_ENCRYPTION_KEYS: `v2:${v2Enc},v1:${v1Enc}`,
      FIELD_HASH_KEYS: `v2:${v2Hash},v1:${key()}`,
    });
    for (const [keys, code] of [
      [after, 'FIELD_KEY_UNKNOWN:v1'],
      [wrongEnc, 'FIELD_DECRYPT_FAILED:v1'],
      [wrongHash, 'BLIND_INDEX_MISMATCH:v1'],
    ] as const) {
      const plan = await planTenantKeyRotation(app, B, keys);
      expect(plan.problems.map((p) => p.code)).toContain(code);
      expect(plan.retireReady).toBe(false);
      const err = await rotateTenantKeys(app, B, keys, { pauseMs: 0 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KeyRotationBlockedError);
      expect((err as Error).message).toContain(code);
    }
    expect(await snapshot()).toEqual(original);
    expect(await withTenant(app, B, (tx) => tx.fieldKeyRotation.count())).toBe(0);
  });

  it('fungsi tulis ulang identifier: hanya ganti versi kunci, compare-and-swap, tunduk RLS', async () => {
    const crypto = new PatientCrypto(before, B);
    const [row] = await withTenant(app, B, (tx) => tx.patientIdentifier.findMany({ take: 1 }));
    if (!row) throw new Error('tidak ada identifier');
    const value = crypto.decryptIdentifier(row.valueEnc);
    const sameVersion = crypto.encryptIdentifier(row.system as IdentifierSystem, value);
    const rekey = (tenantId: string, oldEnc: string, newEnc: string, newHash: string) =>
      withTenant(app, tenantId, async (tx) => {
        const [r] = await tx.$queryRaw<Array<{ ok: boolean }>>`
          SELECT app_rekey_patient_identifier(${row.id}::uuid, ${oldEnc}, ${row.valueHash}, ${newEnc}, ${newHash}) AS ok`;
        return r?.ok;
      });
    await expect(rekey(B, row.valueEnc, sameVersion.valueEnc, row.valueHash)).rejects.toThrow(
      /REKEY_SAME_KEY/,
    );
    await expect(rekey(B, row.valueEnc, row.valueEnc, row.valueHash)).rejects.toThrow(/REKEY_SAME_KEY/);
    await expect(rekey(B, row.valueEnc, 'teks biasa', row.valueHash)).rejects.toThrow(/REKEY_FORMAT/);
    const next = new PatientCrypto(during, B).encryptIdentifier(row.system as IdentifierSystem, value);
    // Nilai lama tidak cocok (sudah diubah pihak lain) → tidak ada yang ditulis.
    expect(await rekey(B, sameVersion.valueEnc, next.valueEnc, next.valueHash)).toBe(false);
    // Dari tenant lain baris ini tidak terlihat (RLS juga berlaku untuk fungsi SECURITY DEFINER).
    expect(await rekey(A.id, row.valueEnc, next.valueEnc, next.valueHash)).toBe(false);
    expect(
      (await withTenant(app, B, (tx) => tx.patientIdentifier.findUniqueOrThrow({ where: { id: row.id } })))
        .valueEnc,
    ).toBe(row.valueEnc);
    await expect(
      withTenant(
        app,
        B,
        (tx) =>
          tx.$executeRaw`UPDATE patient_identifiers SET value_enc = ${next.valueEnc} WHERE id = ${row.id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('kontak pasien tetap append-only: hanya fungsi rotasi yang boleh mengganti versi kunci', async () => {
    const crypto = new PatientCrypto(during, A.id);
    const c = await withTenant(app, A.id, (tx) =>
      tx.patientContact.findUniqueOrThrow({ where: { id: STATIC.contactId } }),
    );
    // Role aplikasi tanpa hak UPDATE; pemilik tabel pun ditolak penjaga (tanpa penanda rotasi).
    await expect(
      withTenant(app, A.id, (tx) =>
        tx.patientContact.update({ where: { id: c.id }, data: { relation: 'wali' } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(owner, A.id, (tx) =>
        tx.patientContact.update({
          where: { id: c.id },
          data: { nameEnc: crypto.encryptContact('Nama lain') },
        }),
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
    await expect(
      withTenant(owner, A.id, (tx) => tx.$executeRaw`DELETE FROM patient_contacts WHERE id = ${c.id}::uuid`),
    ).rejects.toThrow(/APPEND_ONLY/);
    // Versi kunci sama (v2 → v2) ditolak: fungsi rotasi bukan jalan pintas mengoreksi kontak.
    await expect(
      withTenant(
        app,
        A.id,
        (tx) => tx.$queryRaw`
        SELECT app_rekey_patient_contact(${c.id}::uuid, ${c.nameEnc}, ${c.phoneEnc}, ${c.addressEnc},
          ${crypto.encryptContact('Nama lain')}, ${c.phoneEnc}, ${c.addressEnc})`,
      ),
    ).rejects.toThrow(/REKEY_SAME_KEY/);
  });

  it('daftar tenant rotasi memuat tenant nonaktif (datanya tetap harus terbaca); daftar tenant aktif tidak', async () => {
    const inactive = await freshTenant('suspended');
    expect(await listKeyRotationTenantIds(app)).toContain(inactive);
    expect(await listActiveTenantIds(app)).not.toContain(inactive);
  });

  it('dua pelari bersamaan (worker + CLI): tidak dobel, hasil utuh', async () => {
    const T = await freshTenant();
    const crypto = new PatientCrypto(before, T);
    const recs = people(10);
    for (const rec of recs) await withTenant(app, T, (tx) => insertPatient(tx, crypto, rec));
    const targets = ['patients', 'patient_identifiers'] as const;
    const [r1, r2] = await Promise.all([
      rotateTenantKeys(app, T, during, { batchSize: 2, pauseMs: 0, targets }),
      rotateTenantKeys(app, T, during, { batchSize: 2, pauseMs: 0, targets }),
    ]);
    const total = (target: string) =>
      [r1, r2].reduce((n, r) => n + (r.targets.find((t) => t.target === target)?.rewritten ?? 0), 0);
    expect(total('patients')).toBe(10);
    expect(total('patient_identifiers')).toBe(20);
    expect(await v1Rows(T)).toBe(0);
    for (const rec of recs) {
      expect(await findByIdentifier(T, after, 'nik', rec.identifiers?.nik as string)).toHaveLength(1);
    }
  });
});
