import { expect, type Page } from '@playwright/test';
import {
  createPrismaClient,
  detectDuplicates,
  ensurePublishedForm,
  insertPatient,
  type NewPatientRecord,
  type PrismaClient,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { SEED_PLATFORM_TENANT, testDbUrls } from '@simrs/db/testing';
import { MORSE_FALL_SCALE, newId } from '@simrs/shared';
import {
  base32Decode,
  decryptField,
  encryptField,
  newVerifyCode,
  sha256Hex,
  generateTotpSecret,
  hashPassword,
  PatientCrypto,
  totpCode,
  totpStep,
} from '@simrs/shared/node';

/** Akun uji fiktif dibuat langsung di simrs_test (role aplikasi, RLS aktif). Nama pengguna unik per tes. */

export const TENANTS = {
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

/**
 * Transaksi ber-tenant untuk penyiapan data uji. Saat seluruh suite jalan paralel (build web + API + banyak browser),
 * membuka koneksi Postgres baru (di Windows: satu proses per koneksi) bisa melebihi batas tunggu bawaan Prisma 2 dtk.
 */
export function inTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return withTenant(prisma(), tenantId, fn, { maxWaitMs: 20_000 });
}

export async function createAccount(
  opts: {
    tenant?: TenantCode;
    roles?: string[];
    mfa?: boolean;
    mustChangePassword?: boolean;
    displayName?: string;
    /** false = akun tanpa kata sandi (belum diaktifkan, seperti staf seed); `password` tidak berlaku. */
    credential?: boolean;
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
  await inTenant(tenantId, async (tx) => {
    await tx.user.create({
      data: {
        id,
        tenantId,
        username: account.username,
        displayName: account.displayName,
        mustChangePassword: opts.mustChangePassword ?? false,
      },
    });
    if (opts.credential !== false) {
      await tx.userCredential.create({ data: { userId: id, tenantId, passwordHash } });
    }
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
  await inTenant(TENANTS[account.tenantCode], (tx) =>
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
  return inTenant(tenantId, (tx) =>
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
  const candidateId = await inTenant(tenantId, async (tx) => {
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
  await inTenant(tenantId, (tx) =>
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
  await inTenant(tenantId, async (tx) => {
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

/**
 * Isian Morse versi 1 (penulis) + koreksi versi 2 beralasan (pengoreksi) langsung di DB, beserta entri audit
 * `correct` berbentuk sama dengan tulisan API (layar isian klinis dibangun di fase 2–3; jalur API diuji di
 * apps/api/test/forms.test.ts). Detail Audit menghitung diff dari dua versi tersimpan ini.
 */
export async function createFormCorrection(
  author: Account,
  corrector: Account,
  reason: string,
): Promise<{ seq: string; patientId: string }> {
  const tenantId = TENANTS[author.tenantCode];
  const patient = await createPatient(author.tenantCode);
  const v1 = {
    q_riwayat_jatuh: 'ya',
    q_diag_sekunder: 'ya',
    q_alat_bantu: 'furnitur',
    q_infus: 'tidak',
    q_gaya_jalan: 'normal',
    q_mental: 'sadar',
  };
  return inTenant(tenantId, async (tx) => {
    const def = await ensurePublishedForm(tx, tenantId, MORSE_FALL_SCALE);
    const rootId = newId();
    const v2Id = newId();
    const common = {
      tenantId,
      patientId: patient.id,
      definitionId: def.id,
      formCode: 'morse_dewasa',
      rootId,
    };
    await tx.formResponse.create({
      data: {
        ...common,
        id: rootId,
        version: 1,
        answers: v1,
        score: 70,
        scoreBand: 'Risiko tinggi',
        createdBy: author.id,
      },
    });
    await tx.formResponse.create({
      data: {
        ...common,
        id: v2Id,
        version: 2,
        supersedesId: rootId,
        answers: { ...v1, q_alat_bantu: 'kruk' },
        score: 55,
        scoreBand: 'Risiko tinggi',
        correctionReason: reason,
        createdBy: corrector.id,
      },
    });
    const event = await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId,
        actorUserId: corrector.id,
        actorRole: 'perawat',
        patientId: patient.id,
        resourceType: 'form_response',
        resourceId: v2Id,
        action: 'correct',
        outcome: 'success',
        reason,
        details: { form: 'morse_dewasa', from: 1, to: 2, status: 'final', fields: ['q_alat_bantu'] },
      },
      select: { seq: true },
    });
    return { seq: event.seq.toString(), patientId: patient.id };
  });
}

/**
 * Dokumen pasien dengan tanda tangan elektronik (selesai atau masih diproses) langsung di DB; layar dokumen di
 * rekam medis klinis dibangun di fase 3. Mengembalikan kode verifikasi QR.
 */
export async function createSignedDocument(
  signer: Account,
  opts: { title: string; signed: boolean },
): Promise<{ code: string; sha256: string; patientName: string }> {
  const tenantId = TENANTS[signer.tenantCode];
  const patientName = 'Pasien Rahasia Fiktif';
  const patient = await createPatient(signer.tenantCode, { name: patientName });
  const docId = newId();
  const sha256 = sha256Hex(docId);
  const code = newVerifyCode(tenantId);
  await inTenant(tenantId, async (tx) => {
    await tx.document.create({
      data: {
        id: docId,
        tenantId,
        patientId: patient.id,
        kind: 'resume',
        title: opts.title,
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        sha256,
        storageKey: `${tenantId}/2026/10/${newId()}`,
        createdBy: signer.id,
      },
    });
    await tx.documentSignature.create({
      data: {
        id: newId(),
        tenantId,
        documentId: docId,
        signerUserId: signer.id,
        documentSha256: sha256,
        verifyCode: code,
      },
    });
    if (opts.signed) {
      await tx.documentSignature.update({
        where: { verifyCode: code },
        data: {
          status: 'signed',
          signedAt: new Date(),
          certificate: `CN=${signer.displayName}, O=Mock TTE Lokal, C=ID`,
          signature: 'c2lnbmF0dXJlLWZpa3RpZg==',
        },
      });
    }
  });
  return { code, sha256, patientName };
}

/** Notifikasi in-app untuk akun (seperti yang dibuat API, mis. saat akses darurat dipakai). */
export async function createNotification(
  account: Account,
  n: { title: string; body: string; link: string | null },
): Promise<string> {
  const tenantId = TENANTS[account.tenantCode];
  const id = newId();
  await inTenant(tenantId, (tx) =>
    tx.notification.create({
      data: { id, tenantId, recipientUserId: account.id, kind: 'break_glass', ...n },
    }),
  );
  return id;
}

/** No. HP staf (terenkripsi seperti yang ditulis API) untuk WhatsApp. */
export async function setStaffPhone(account: Account, phone: string): Promise<void> {
  const tenantId = TENANTS[account.tenantCode];
  await inTenant(tenantId, (tx) =>
    tx.user.update({
      where: { id: account.id },
      data: {
        phoneEnc: encryptField(phone, {
          keyB64: process.env.FIELD_ENCRYPTION_KEY ?? '',
          tenantId,
          purpose: 'staff_phone',
        }),
      },
    }),
  );
}

/** Kode cadangan terbaru untuk akun ini, seolah dibaca dari WhatsApp/email (worker tidak berjalan di E2E). */
export async function latestBackupCode(account: Account): Promise<string> {
  const tenantId = TENANTS[account.tenantCode];
  const ch = await inTenant(tenantId, (tx) =>
    tx.loginChallenge.findFirstOrThrow({
      where: { userId: account.id, otpEnc: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { otpEnc: true },
    }),
  );
  return decryptField(ch.otpEnc as string, {
    keyB64: process.env.FIELD_ENCRYPTION_KEY ?? '',
    tenantId,
    purpose: 'login_otp',
  });
}
