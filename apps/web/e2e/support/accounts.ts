import { expect, type Page } from '@playwright/test';
import {
  createPrismaClient,
  detectDuplicates,
  insertPatient,
  type NewPatientRecord,
  type PrismaClient,
  withTenant,
} from '@simrs/db';
import { SEED_PLATFORM_TENANT, testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import {
  base32Decode,
  encryptField,
  generateTotpSecret,
  hashPassword,
  PatientCrypto,
  totpCode,
  totpStep,
} from '@simrs/shared/node';

/** Akun uji fiktif dibuat langsung di simrs_test (role aplikasi, RLS aktif). Nama pengguna unik per tes. */

const TENANTS = {
  RSFA: '0199a000-0000-7000-8000-000000000001',
  PLATFORM: SEED_PLATFORM_TENANT.id,
} as const;
export type TenantCode = keyof typeof TENANTS;

export interface Account {
  id: string;
  tenantCode: TenantCode;
  username: string;
  password: string;
  displayName: string;
  totpSecret: string | null;
}

let db: PrismaClient | undefined;
function prisma(): PrismaClient {
  db ??= createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  return db;
}

export async function createAccount(
  opts: {
    tenant?: TenantCode;
    roles?: string[];
    mfa?: boolean;
    mustChangePassword?: boolean;
    displayName?: string;
  } = {},
): Promise<Account> {
  const tenantCode = opts.tenant ?? 'RSFA';
  const tenantId = TENANTS[tenantCode];
  const id = newId();
  const account: Account = {
    id,
    tenantCode,
    username: `e2e.${id.slice(-12)}`,
    password: `frasa uji e2e panjang ${id.slice(-6)}`,
    displayName: opts.displayName ?? 'Pengguna E2E Fiktif',
    totpSecret: opts.mfa === false ? null : generateTotpSecret(),
  };
  const passwordHash = await hashPassword(account.password);
  await withTenant(prisma(), tenantId, async (tx) => {
    await tx.user.create({
      data: {
        id,
        tenantId,
        username: account.username,
        displayName: account.displayName,
        mustChangePassword: opts.mustChangePassword ?? false,
      },
    });
    await tx.userCredential.create({ data: { userId: id, tenantId, passwordHash } });
    for (const code of opts.roles ?? []) {
      const role = await tx.role.findFirstOrThrow({ where: { code } });
      await tx.staffAssignment.create({ data: { id: newId(), tenantId, userId: id, roleId: role.id } });
    }
    if (account.totpSecret) {
      await tx.mfaFactor.create({
        data: {
          id: newId(),
          tenantId,
          userId: id,
          secretEnc: encryptField(account.totpSecret, {
            keyB64: process.env.FIELD_ENCRYPTION_KEY ?? '',
            tenantId,
            purpose: 'mfa_secret',
          }),
          confirmedAt: new Date(),
        },
      });
    }
  });
  return account;
}

/** Cabut semua sesi akun (mis. dinonaktifkan admin di tempat lain). */
export async function revokeSessions(account: Account): Promise<void> {
  await withTenant(prisma(), TENANTS[account.tenantCode], (tx) =>
    tx.authSession.updateMany({
      where: { userId: account.id, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date(), revokedReason: 'e2e' },
    }),
  );
}

/** Kode TOTP untuk langkah waktu berikutnya yang belum dipakai (API menolak pemakaian ulang). */
const lastStep = new Map<string, number>();
export function totpFor(secret: string): string {
  const step = Math.max(totpStep(), (lastStep.get(secret) ?? -Infinity) + 1);
  if (step > totpStep() + 1) throw new Error('Kode TOTP habis untuk jendela ini');
  lastStep.set(secret, step);
  return totpCode(base32Decode(secret), step);
}

/** Langkah 1 (+ kode RS di lokal). */
export async function submitPassword(
  page: Page,
  account: Pick<Account, 'tenantCode' | 'username'>,
  password: string,
) {
  await page.getByLabel('Kode RS').fill(account.tenantCode);
  await page.getByLabel('NIP atau email RS').fill(account.username);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk dan minta kode' }).click();
}

export async function typeCode(page: Page, code: string) {
  await page.getByLabel('Digit 1').pressSequentially(code);
}

/** Login penuh untuk akun ber-MFA dengan satu penugasan; berakhir di halaman tujuan. */
export async function loginAs(page: Page, account: Account, path = '/'): Promise<void> {
  if (!account.totpSecret) throw new Error('Akun tanpa MFA');
  await page.goto(path);
  await expect(page).toHaveURL(/\/masuk/);
  await submitPassword(page, account, account.password);
  await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
  await typeCode(page, totpFor(account.totpSecret));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await expect(page).not.toHaveURL(/\/masuk/);
}

function patientCrypto(tenantId: string): PatientCrypto {
  return new PatientCrypto(
    { encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '', hashKeyB64: process.env.FIELD_HASH_KEY ?? '' },
    tenantId,
  );
}

/** Pasien fiktif langsung di DB dengan kunci enkripsi yang sama dengan API. */
export function createPatient(
  tenantCode: TenantCode,
  rec: Partial<NewPatientRecord> = {},
): Promise<{ id: string; mrn: string }> {
  const tenantId = TENANTS[tenantCode];
  return withTenant(prisma(), tenantId, (tx) =>
    insertPatient(tx, patientCrypto(tenantId), {
      name: 'Pasien Uji Fiktif',
      sex: 'female',
      birthDate: '1980-01-01',
      ...rec,
    }),
  );
}

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/**
 * Pasangan kemungkinan rekam medis ganda: A lebih dulu (dengan NIK), B kemudian (ejaan beda, dengan BPJS),
 * lalu deteksi dijalankan seperti pendaftaran lewat API. Tanggal lahir dan no. HP acak per pasangan.
 */
export async function createDuplicatePair(tenantCode: TenantCode = 'RSFA') {
  const tenantId = TENANTS[tenantCode];
  const common = {
    sex: 'female' as const,
    birthDate: `19${30 + Math.floor(Math.random() * 70)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`,
    motherName: 'Aminah',
    phone: `62812${digits(8)}`,
  };
  const a = await createPatient(tenantCode, {
    ...common,
    name: 'Siti Rahmawati',
    address: 'Jl. Kenanga No. 12, Jakarta Timur',
    identifiers: { nik: `9999${digits(12)}` },
  });
  const b = await createPatient(tenantCode, {
    ...common,
    name: 'Siti Rachmawati',
    address: 'Kenanga No.12, Jaktim',
    identifiers: { bpjs: `0000${digits(9)}` },
  });
  const candidateId = await withTenant(prisma(), tenantId, async (tx) => {
    await detectDuplicates(tx, patientCrypto(tenantId), b.id);
    const c = await tx.patientMatchCandidate.findFirstOrThrow({
      where: { patientAId: a.id, patientBId: b.id },
      select: { id: true },
    });
    return c.id;
  });
  return { a, b, candidateId };
}

/** Izin akses darurat langsung di DB (layar klinis peminta akses darurat dibangun di fase 2–3). */
export async function createBreakGlassGrant(account: Account, reason: string): Promise<string> {
  const id = newId();
  const tenantId = TENANTS[account.tenantCode];
  const patient = await createPatient(account.tenantCode);
  const grantedAt = new Date();
  await withTenant(prisma(), tenantId, (tx) =>
    tx.breakGlassGrant.create({
      data: {
        id,
        tenantId,
        userId: account.id,
        patientId: patient.id,
        reason,
        grantedAt,
        expiresAt: new Date(grantedAt.getTime() + 3_600_000),
      },
    }),
  );
  return id;
}

/** Entri audit sintetis milik akun (waktu, nomor urut, dan hash tetap diisi trigger server). */
export async function insertAuditEvents(
  account: Account,
  role: string,
  action: string,
  count: number,
): Promise<void> {
  const tenantId = TENANTS[account.tenantCode];
  await withTenant(prisma(), tenantId, async (tx) => {
    for (let i = 0; i < count; i++) {
      await tx.auditEvent.create({
        data: {
          id: newId(),
          tenantId,
          actorUserId: account.id,
          actorRole: role,
          resourceType: 'session',
          action,
          outcome: action === 'login_failed' ? 'denied' : 'success',
        },
      });
    }
  });
}
