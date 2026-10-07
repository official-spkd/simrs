import 'reflect-metadata';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ALLOW_INCOMPLETE_SESSION_KEY } from '../src/infra/auth/allow-incomplete-session.decorator';
import { AuthGuard } from '../src/infra/auth/auth.guard';
import { DEVICE_PERMISSION_KEY, DeviceGuard } from '../src/infra/auth/device.guard';
import { AUTH_RATE_LIMITED_KEY } from '../src/common/auth-rate-limited.decorator';
import { PUBLIC_RATE_LIMITED_KEY } from '../src/common/public-rate-limited.decorator';
import { REQUIRED_PERMISSION_KEY, type RequiredPermission } from '../src/common/require-permission.decorator';
import { TenantTransactionInterceptor } from '../src/common/tenant-transaction.interceptor';

/**
 * Gerbang statis keamanan rute (docs/05 §5): setiap endpoint API HARUS jelas golongannya. Endpoint baru yang lupa
 * `@RequirePermission`, lupa `@TenantScoped()`/`@DeviceScoped()`, atau terbuka tanpa batas laju membuat tes ini
 * gagal sampai pemasangnya memutuskan secara sadar (memperbaiki dekorator, atau menambah ke daftar di bawah
 * dengan alasan yang ditinjau).
 *
 * Golongan:
 * - staf: `AuthGuard` + `TenantTransactionInterceptor` + `@RequirePermission` (bawaan),
 * - perangkat: `DeviceGuard` + interceptor, tanpa `@RequirePermission` (ADR-0027),
 * - swalayan staf: login tetapi tanpa izin matriks (data milik akun itu sendiri) → `SELF_SERVICE`,
 * - publik tanpa login → `PUBLIC`, wajib batas laju ketat kecuali probe kesehatan.
 */

type Ctor = abstract new (...args: never[]) => unknown;

interface Route {
  key: string;
  method: string;
  controller: string;
  handler: string;
  guards: unknown[];
  interceptors: unknown[];
  permission: RequiredPermission | undefined;
  devicePermission: unknown;
  authRateLimited: boolean;
  publicRateLimited: boolean;
  allowIncomplete: boolean;
}

/** Endpoint login tanpa izin matriks: hanya data/sesi milik akun itu sendiri. */
const SELF_SERVICE = new Set([
  'GET auth/me',
  'POST auth/logout',
  'POST auth/password',
  'POST auth/mfa/enroll',
  'POST auth/mfa/enroll/confirm',
  'GET auth/assignments',
  'POST auth/assignment',
  'GET auth/pin/devices',
  'POST auth/pin/devices',
  'POST auth/pin/devices/:id/revoke',
  'GET notifications',
  'GET notifications/unread-count',
  'POST notifications/read-all',
  'POST notifications/:id/read',
  'GET tenancy/current',
]);

/** Endpoint tanpa login. Selain probe kesehatan, wajib `@AuthRateLimited()` atau `@PublicRateLimited()`. */
const PUBLIC = new Set([
  'GET health',
  'GET ready',
  'POST auth/login',
  'POST auth/mfa/verify',
  'POST auth/mfa/backup-code',
  'POST auth/mfa/backup-options',
  'POST auth/refresh',
  'POST auth/pin/login',
  'POST auth/pin/accounts',
  'POST devices/enrol',
  // Fase 4 §4.1a · gateway analyzer lab menukar kode pendaftaran (batas laju kredensial).
  'POST devices/lis/enrol',
  'GET verification/signatures/:code',
  'GET public/:tenantCode/schedules',
  'GET public/:tenantCode/queues',
  'GET public/:tenantCode/queues/:serviceCode',
  'POST public/:tenantCode/bookings/status',
]);

/** Publik tanpa batas laju khusus (hanya batas umum per IP): probe kesehatan + kode verifikasi 256 bit. */
const PUBLIC_WITHOUT_STRICT_LIMIT = new Set(['GET health', 'GET ready', 'GET verification/signatures/:code']);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const joinPath = (...parts: unknown[]) =>
  parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

function collectRoutes(): Route[] {
  const modules = import.meta.glob<Record<string, unknown>>(['../src/**/*.controller.ts'], { eager: true });
  const routes: Route[] = [];
  for (const mod of Object.values(modules)) {
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const ctor = exported as Ctor;
      const basePath: unknown = Reflect.getMetadata(PATH_METADATA, ctor);
      if (basePath === undefined) continue;
      const proto = ctor.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const sub: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        const meta = <T>(key: string): T | undefined =>
          (Reflect.getMetadata(key, handler) as T | undefined) ??
          (Reflect.getMetadata(key, ctor) as T | undefined);
        const methodName = RequestMethod[method as RequestMethod];
        routes.push({
          key: `${methodName} ${joinPath(basePath, sub)}`,
          method: methodName,
          controller: ctor.name,
          handler: name,
          guards: [
            ...((Reflect.getMetadata(GUARDS_METADATA, ctor) as unknown[] | undefined) ?? []),
            ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? []),
          ],
          interceptors: [
            ...((Reflect.getMetadata(INTERCEPTORS_METADATA, ctor) as unknown[] | undefined) ?? []),
            ...((Reflect.getMetadata(INTERCEPTORS_METADATA, handler) as unknown[] | undefined) ?? []),
          ],
          permission: meta<RequiredPermission>(REQUIRED_PERMISSION_KEY),
          devicePermission: meta(DEVICE_PERMISSION_KEY),
          authRateLimited: meta<boolean>(AUTH_RATE_LIMITED_KEY) === true,
          publicRateLimited: meta<boolean>(PUBLIC_RATE_LIMITED_KEY) === true,
          allowIncomplete: meta<boolean>(ALLOW_INCOMPLETE_SESSION_KEY) === true,
        });
      }
    }
  }
  return routes;
}

const routes = collectRoutes();
const isStaff = (r: Route) => r.guards.includes(AuthGuard);
const isDevice = (r: Route) => r.guards.includes(DeviceGuard);
const describeRoute = (r: Route) => `${r.key} (${r.controller}.${r.handler})`;

describe('gerbang statis keamanan rute API', () => {
  it('menemukan seluruh controller (pengaman agar tes tidak lolos kosong)', () => {
    expect(routes.length).toBeGreaterThan(200);
    expect(routes.filter(isDevice).length).toBeGreaterThan(5);
  });

  it('kunci rute unik (tidak ada dua handler untuk metode + path yang sama)', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const r of routes) {
      const prev = seen.get(r.key);
      if (prev) dupes.push(`${describeRoute(r)} bentrok dengan ${prev}`);
      seen.set(r.key, `${r.controller}.${r.handler}`);
    }
    expect(dupes).toEqual([]);
  });

  it('setiap endpoint staf/perangkat memakai transaksi ber-RLS + audit (TenantTransactionInterceptor)', () => {
    const missing = routes
      .filter((r) => (isStaff(r) || isDevice(r)) !== r.interceptors.includes(TenantTransactionInterceptor))
      .map(describeRoute);
    expect(missing).toEqual([]);
  });

  it('endpoint staf wajib @RequirePermission kecuali swalayan akun sendiri yang terdaftar', () => {
    const missing = routes
      .filter((r) => isStaff(r) && !r.permission && !SELF_SERVICE.has(r.key))
      .map(describeRoute);
    expect(missing).toEqual([]);
    const stale = [...SELF_SERVICE].filter(
      (k) => !routes.some((r) => r.key === k && isStaff(r) && !r.permission),
    );
    expect(stale, 'hapus entri SELF_SERVICE yang sudah tidak berlaku').toEqual([]);
  });

  it('endpoint perangkat tidak memakai matriks peran manusia dan tidak bercampur guard staf', () => {
    const wrong = routes
      .filter((r) => isDevice(r) && (r.permission !== undefined || isStaff(r)))
      .map(describeRoute);
    expect(wrong).toEqual([]);
  });

  it('endpoint tanpa login hanya yang terdaftar, dan ber-batas laju ketat', () => {
    const anonymous = routes.filter((r) => !isStaff(r) && !isDevice(r));
    expect(anonymous.filter((r) => !PUBLIC.has(r.key)).map(describeRoute)).toEqual([]);
    expect(
      anonymous
        .filter((r) => !PUBLIC_WITHOUT_STRICT_LIMIT.has(r.key) && !r.authRateLimited && !r.publicRateLimited)
        .map(describeRoute),
    ).toEqual([]);
    expect([...PUBLIC].filter((k) => !anonymous.some((r) => r.key === k))).toEqual([]);
  });

  it('@AllowIncompleteSession (sesi tanpa MFA / wajib ganti sandi) hanya di endpoint akun sendiri', () => {
    const wrong = routes.filter((r) => r.allowIncomplete && (!SELF_SERVICE.has(r.key) || r.permission));
    expect(wrong.map(describeRoute)).toEqual([]);
  });

  it('endpoint staf yang mengubah data tidak berizin `read` kecuali yang terdaftar', () => {
    const wrong = routes
      .filter((r) => isStaff(r) && MUTATING.has(r.method) && r.permission?.action === 'read')
      .filter((r) => !MUTATING_WITH_READ.has(r.key))
      .map((r) => `${describeRoute(r)} → ${r.permission?.resource}.read`);
    expect(wrong).toEqual([]);
  });
});

/**
 * POST yang hanya membaca (pencarian dengan body, pratinjau, cetak ber-audit) boleh berizin `read`. Setiap entri
 * diperiksa tidak mengubah data klinis/administratif.
 */
const MUTATING_WITH_READ = new Set<string>([
  // F06 · cek kepesertaan JKN: data pribadi di body (bukan URL), lookup sinkron baca-saja (ADR-0025).
  'POST sep/eligibility-checks',
]);
