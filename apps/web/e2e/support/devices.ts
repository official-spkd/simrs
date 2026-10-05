import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { type PrismaClient, withTenant } from '@simrs/db';
import { DEVICE_PRINCIPAL_DAYS, type DevicePrincipalKind, newId } from '@simrs/shared';
import { hashToken, randomToken } from '@simrs/shared/node';
import { DEMO_ACCOUNTS_FILE } from '../demo-accounts-file';

/** Konteks global setup untuk perangkat uji. */
export interface TestDeviceContext {
  /** Klien migrator ke DB tes (tanpa RLS), sama dengan global setup. */
  prisma: PrismaClient;
  /** Tenant RS uji (RSFA). */
  tenantId: string;
  /** Folder sementara slot E2E (`E2E_TMP_NAME`), tempat berkas rahasia uji seperti kredensial akun presentasi. */
  tmpDir: string;
}

const FACILITY_CODE = 'E2E-DEV';
const UNIT_CODE = 'E2E-LOBI';
/**
 * Nama unit perangkat uji (tampil di layar perangkat). Hindari kata yang memuat label lain di layar Akses (mis.
 * "perangkat" memuat "Peran": `getByLabel('Peran')` di spesifikasi Akses ikut mencocokkan pilihan unit).
 */
export const TEST_DEVICE_UNIT = 'Lobi anjungan uji';
const devicesFile = (tmpDir: string) => join(tmpDir, 'devices.json');

/**
 * ADR-0027 · Perangkat uji untuk E2E fase 2: satu anjungan dan satu display yang SUDAH terdaftar di unit uji RSFA
 * (langsung di DB, seolah sudah menukar kode). Tokennya ditulis ke `tmpDir` (mode 0600, seperti `DEMO_ACCOUNTS_FILE`)
 * agar spesifikasi anjungan/display (potongan 4b, 6) bisa membuka layar sebagai perangkat, bukan akun staf. Setiap
 * jalan membuat pasangan baru (tidak destruktif); alur pendaftaran lewat kode diuji `e2e/perangkat.spec.ts`.
 */
export async function registerTestDevices(ctx: TestDeviceContext): Promise<void> {
  const tokens = await withTenant(ctx.prisma, ctx.tenantId, async (tx) => {
    const facility = await tx.facility.upsert({
      where: { tenantId_code: { tenantId: ctx.tenantId, code: FACILITY_CODE } },
      update: {},
      create: { id: newId(), tenantId: ctx.tenantId, code: FACILITY_CODE, name: 'Gedung anjungan uji' },
      select: { id: true },
    });
    const unit = await tx.unit.upsert({
      where: { tenantId_code: { tenantId: ctx.tenantId, code: UNIT_CODE } },
      update: { name: TEST_DEVICE_UNIT },
      create: {
        id: newId(),
        tenantId: ctx.tenantId,
        facilityId: facility.id,
        code: UNIT_CODE,
        name: TEST_DEVICE_UNIT,
        kind: 'administrasi',
      },
      select: { id: true },
    });
    const out: Record<DevicePrincipalKind, string> = { kiosk: '', queue_display: '' };
    for (const kind of ['kiosk', 'queue_display'] as const) {
      const id = newId();
      const secret = randomToken();
      const now = new Date();
      await tx.registeredDevice.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          kind,
          name: kind === 'kiosk' ? 'Anjungan uji' : 'Display uji',
          unitId: unit.id,
          tokenHash: hashToken(secret),
          createdAt: now,
          expiresAt: new Date(now.getTime() + DEVICE_PRINCIPAL_DAYS * 86_400_000),
          enrolExpiresAt: new Date(now.getTime() + 15 * 60_000),
          enrolledAt: now,
        },
      });
      out[kind] = `dv1.${ctx.tenantId}.${id}.${secret}`;
    }
    return out;
  });
  writeFileSync(devicesFile(ctx.tmpDir), JSON.stringify(tokens), { encoding: 'utf8', mode: 0o600 });
}

/** Token perangkat uji (dibuat global setup). */
export function testDeviceToken(kind: DevicePrincipalKind): string {
  const dir = join(DEMO_ACCOUNTS_FILE, '..');
  const tokens = JSON.parse(readFileSync(devicesFile(dir), 'utf8')) as Record<DevicePrincipalKind, string>;
  return tokens[kind];
}

/**
 * F04 · Display uji yang SUDAH terikat ke papan antrean `displayCode` (potongan 4b). Perangkat tidak bisa diubah
 * setelah dibuat (`DEVICE_IMMUTABLE`), jadi ikatannya diberikan saat dibuat, di unit perangkat uji global setup.
 * Mengembalikan token `dv1` untuk `useDeviceToken`.
 */
export async function registerBoundTestDisplay(
  prisma: PrismaClient,
  tenantId: string,
  displayCode: string,
): Promise<string> {
  return withTenant(prisma, tenantId, async (tx) => {
    const unit = await tx.unit.findUniqueOrThrow({
      where: { tenantId_code: { tenantId, code: UNIT_CODE } },
      select: { id: true },
    });
    const display = await tx.queueDisplay.findUniqueOrThrow({
      where: { tenantId_code: { tenantId, code: displayCode } },
      select: { id: true },
    });
    const id = newId();
    const secret = randomToken();
    const now = new Date();
    await tx.registeredDevice.create({
      data: {
        id,
        tenantId,
        kind: 'queue_display',
        name: `Display ${displayCode} uji`,
        unitId: unit.id,
        queueDisplayId: display.id,
        tokenHash: hashToken(secret),
        createdAt: now,
        expiresAt: new Date(now.getTime() + DEVICE_PRINCIPAL_DAYS * 86_400_000),
        enrolExpiresAt: new Date(now.getTime() + 15 * 60_000),
        enrolledAt: now,
      },
    });
    return `dv1.${tenantId}.${id}.${secret}`;
  });
}

/** Pasang cookie perangkat uji di konteks browser (web lokal: tanpa `__Host-`/Secure). */
export async function useTestDevice(context: BrowserContext, kind: DevicePrincipalKind): Promise<void> {
  await useDeviceToken(context, testDeviceToken(kind));
}

/** Pasang cookie perangkat dengan token `dv1` tertentu (mis. dari `registerBoundTestDisplay`). */
export async function useDeviceToken(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    {
      name: 'simrs_device',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
}
