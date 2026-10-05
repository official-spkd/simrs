import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { resolveTenantByCode, resolveTenantByHost } from '@simrs/db';
import {
  AppError,
  type CreateDeviceInput,
  DEVICE_ENROLMENT_MINUTES,
  DEVICE_PRINCIPAL_DAYS,
  type DevicePrincipalKind,
  type DeviceStatus,
  type DeviceView,
  devicePermissions,
  ENROLMENT_ALPHABET,
  ENROLMENT_CODE_LENGTH,
  type EnrolDeviceInput,
  formatEnrolmentCode,
  newId,
  normalizeEnrolmentCode,
} from '@simrs/shared';
import { blindIndex } from '@simrs/shared/node';
import { toPage } from '../../common/pagination';
import { API_ENV, type ApiEnv } from '../../config/env';
import { type AuditMeta, writeAudit } from '../../infra/audit-writer';
import { issueToken } from '../../infra/auth/session-tokens';
import { PrismaService } from '../../infra/prisma.service';
import { TenantDb } from '../../infra/tenant-db';
import { type DeviceRow, DevicesRepository } from './devices.repository';

export interface EnrolMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  host: string | null;
}

/** Pesan seragam untuk semua kegagalan pendaftaran (tidak membedakan RS tak dikenal, kode salah, kedaluwarsa). */
const enrolFailed = () =>
  new AppError(
    'UNAUTHENTICATED',
    'Kode pendaftaran salah atau sudah kedaluwarsa. Minta kode baru ke admin SIM RS.',
    401,
  );

function status(row: DeviceRow, now: Date): DeviceStatus {
  if (row.revokedAt) return 'revoked';
  if (!row.enrolledAt) return row.enrolExpiresAt && row.enrolExpiresAt > now ? 'pending' : 'expired';
  return row.expiresAt > now ? 'active' : 'expired';
}

export function toDeviceView(row: DeviceRow, now = new Date()): DeviceView {
  return {
    id: row.id,
    kind: row.kind as DevicePrincipalKind,
    name: row.name,
    unit: row.unit ?? { id: '00000000-0000-0000-0000-000000000000', name: '-' },
    queueDisplay: row.queueDisplay,
    status: status(row, now),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    enrolExpiresAt: row.enrolExpiresAt?.toISOString() ?? null,
    enrolledAt: row.enrolledAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** Kode acak 10 karakter Crockford base32 (50 bit) dari CSPRNG. */
export function generateEnrolmentCode(): string {
  let code = '';
  for (let i = 0; i < ENROLMENT_CODE_LENGTH; i++)
    code += ENROLMENT_ALPHABET[randomInt(ENROLMENT_ALPHABET.length)];
  return code;
}

/**
 * ADR-0027 · Prinsipal perangkat anjungan/TV:
 * - admin mendaftarkan perangkat per unit → kode sekali pakai (15 menit) ditampilkan sekali; disimpan hanya HMAC-nya,
 * - perangkat menukar kode (tanpa login staf) dengan token `dv1` yang disimpan BFF di cookie httpOnly,
 * - admin mencabut kapan pun; berlaku di permintaan berikutnya.
 */
@Injectable()
export class DevicesService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly prisma: PrismaService,
    private readonly db: TenantDb,
    private readonly repo: DevicesRepository,
  ) {}

  private codeHash(tenantId: string, code: string): string {
    // Kunci hash aktif saja: kode hidup maks. 15 menit; rotasi kunci di tengah jendela itu = admin membuat kode baru.
    return blindIndex(code, { ring: this.env.fieldKeys.hash, tenantId, purpose: 'device_enrolment' });
  }

  async list(opts: { kind?: DevicePrincipalKind; cursor?: string; limit: number }) {
    const page = toPage(await this.repo.list(opts), opts.limit);
    const now = new Date();
    return { items: page.items.map((r) => toDeviceView(r, now)), nextCursor: page.nextCursor };
  }

  async create(input: CreateDeviceInput) {
    if (!(await this.repo.activeUnit(input.unitId))) {
      throw new AppError('VALIDATION_FAILED', 'Unit tidak ditemukan atau tidak aktif', 400, {
        fields: ['unitId'],
      });
    }
    if (input.queueDisplayId && !(await this.repo.activeQueueDisplay(input.queueDisplayId))) {
      throw new AppError('VALIDATION_FAILED', 'Papan antrean tidak ditemukan atau tidak aktif', 400, {
        fields: ['queueDisplayId'],
      });
    }
    const code = generateEnrolmentCode();
    const createdAt = new Date();
    const enrolExpiresAt = new Date(createdAt.getTime() + DEVICE_ENROLMENT_MINUTES * 60_000);
    const row = await this.repo.create({
      id: newId(),
      kind: input.kind,
      name: input.name,
      unitId: input.unitId,
      queueDisplayId: input.queueDisplayId ?? null,
      enrolCodeHash: this.codeHash(this.db.tenantId(), code),
      enrolExpiresAt,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + DEVICE_PRINCIPAL_DAYS * 86_400_000),
    });
    return {
      id: row.id,
      device: toDeviceView(row, createdAt),
      enrolmentCode: formatEnrolmentCode(code),
      enrolmentExpiresAt: enrolExpiresAt.toISOString(),
    };
  }

  async revoke(id: string): Promise<{ ok: true }> {
    const row = await this.repo.find(id);
    if (!row) throw new AppError('NOT_FOUND', 'Perangkat tidak ditemukan', 404);
    if (row.revokedAt) throw new AppError('CONFLICT', 'Perangkat sudah dicabut', 409);
    await this.repo.revoke(id);
    return { ok: true };
  }

  /** Identitas perangkat pemanggil (endpoint `@DeviceScoped()`). */
  async self() {
    const principal = this.db.actor().devicePrincipal;
    if (!principal) throw new AppError('FORBIDDEN', 'Hanya untuk perangkat terdaftar', 403);
    const row = await DevicesRepository.self(this.db.tx(), principal.id);
    if (!row?.unit) throw new AppError('UNAUTHENTICATED', 'Perangkat tidak berlaku', 401);
    return {
      id: row.id,
      kind: principal.kind,
      name: row.name,
      tenant: { name: row.tenant.name },
      unit: row.unit,
      queueDisplay: row.queueDisplay,
      permissions: [...principal.permissions],
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** Produksi: RS dari host (subdomain). Lokal/staging: kode RS dari formulir, host sebagai cadangan. */
  private resolveTenant(input: EnrolDeviceInput, host: string | null): Promise<string | null> {
    if (this.env.APP_ENV === 'production') {
      return host ? resolveTenantByHost(this.prisma.client, host) : Promise.resolve(null);
    }
    if (input.tenantCode) return resolveTenantByCode(this.prisma.client, input.tenantCode);
    return host ? resolveTenantByHost(this.prisma.client, host) : Promise.resolve(null);
  }

  /**
   * Perangkat menukar kode pendaftaran dengan token `dv1`. Di luar transaksi permintaan (tenant baru diketahui dari
   * kode RS/host). Kegagalan dicatat dan DI-COMMIT sebelum 401; tanpa kode atau token di jejak.
   */
  async enrol(input: EnrolDeviceInput, m: EnrolMeta) {
    const tenantId = await this.resolveTenant(input, m.host);
    const code = normalizeEnrolmentCode(input.code);
    if (!tenantId) throw enrolFailed();
    const meta = (device: { id: string; kind: string } | null): AuditMeta => ({
      actorUserId: null,
      actorRole: null,
      ip: m.ip,
      userAgent: m.userAgent?.slice(0, 300) ?? null,
      requestId: m.requestId,
      device,
    });
    const failed = (reason: string, device: { id: string; kind: string } | null = null) =>
      this.prisma.forTenant(tenantId, (tx) =>
        writeAudit(tx, tenantId, meta(device), [
          {
            action: 'login_failed',
            resourceType: 'registered_device',
            resourceId: device?.id ?? null,
            outcome: 'denied',
            details: { method: 'device_enrolment', reason },
          },
        ]),
      );
    if (!code) {
      await failed('bad_code_format');
      throw enrolFailed();
    }
    const hash = this.codeHash(tenantId, code);
    const result = await this.prisma.forTenant(tenantId, async (tx) => {
      const d = await DevicesRepository.findPendingByCode(tx, hash);
      if (!d) return { kind: 'unknown' as const };
      const device = { id: d.id, kind: d.kind };
      if (!d.enrolExpiresAt || d.enrolExpiresAt <= new Date()) return { kind: 'expired' as const, device };
      const t = issueToken('dv1', tenantId, d.id);
      const ok = await DevicesRepository.completeEnrolment(tx, d.id, {
        tokenHash: t.hash,
        userAgent: m.userAgent?.slice(0, 200) ?? null,
      });
      if (!ok) return { kind: 'unknown' as const };
      await writeAudit(tx, tenantId, meta(device), [
        {
          action: 'login',
          resourceType: 'registered_device',
          resourceId: d.id,
          details: { method: 'device_enrolment' },
        },
      ]);
      const row = await tx.registeredDevice.findUniqueOrThrow({
        where: { id: d.id },
        select: { expiresAt: true },
      });
      return {
        kind: 'ok' as const,
        token: t.token,
        expiresAt: row.expiresAt.toISOString(),
        device: { id: d.id, kind: d.kind as DevicePrincipalKind, name: d.name },
      };
    });
    if (result.kind !== 'ok') {
      await failed(
        result.kind === 'expired' ? 'code_expired' : 'bad_code',
        result.kind === 'expired' ? result.device : null,
      );
      throw enrolFailed();
    }
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      device: result.device,
      permissions: [...devicePermissions(result.device.kind)],
    };
  }
}
