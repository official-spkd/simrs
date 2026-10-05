import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateDeviceInput,
  createDeviceSchema,
  devicePrincipalKindSchema,
  type EnrolDeviceInput,
  enrolDeviceSchema,
} from '@simrs/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { Audited, type AuditSource, paramId, resultId } from '../../common/audited.decorator';
import { AuthRateLimited } from '../../common/auth-rate-limited.decorator';
import { DeviceScoped } from '../../common/device-scoped.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DevicesService, type EnrolMeta } from './devices.service';

const uuid = new ParseUUIDPipe();

const listQuerySchema = z.object({
  kind: devicePrincipalKindSchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Jenis + unit perangkat (bukan PHI) untuk audit pendaftaran; kode pendaftaran tidak pernah masuk jejak. */
const createdDetails = ({ body }: AuditSource) => {
  const b = (body ?? {}) as { kind?: unknown; unitId?: unknown; queueDisplayId?: unknown };
  return {
    kind: b.kind,
    unitId: b.unitId,
    ...(b.queueDisplayId ? { queueDisplayId: b.queueDisplayId } : {}),
  };
};

function meta(req: Request & { id?: unknown }): EnrolMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
    host: req.hostname ?? null,
  };
}

/**
 * ADR-0027 · Admin mengelola perangkat anjungan/TV (layar Akses → Perangkat). Izin sama dengan pencabutan PIN
 * perangkat (`iam.users`), karena pendaftaran perangkat adalah keputusan akses.
 */
@ApiTags('perangkat (ADR-0027)')
@TenantScoped()
@Controller('iam/devices')
export class DevicesAdminController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('iam.users', 'read')
  list(@Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.devices.list(q);
  }

  /** Daftarkan perangkat; kode pendaftaran sekali pakai hanya ada di respons ini. */
  @Post()
  @RequirePermission('iam.users', 'write')
  @Audited({ action: 'create', resource: 'registered_device', resourceId: resultId, details: createdDetails })
  create(@Body(new ZodValidationPipe(createDeviceSchema)) body: CreateDeviceInput) {
    return this.devices.create(body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermission('iam.users', 'write')
  @Audited({
    action: 'deactivate',
    resource: 'registered_device',
    resourceId: paramId,
    details: () => ({ reason: 'admin_revoked' }),
  })
  revoke(@Param('id', uuid) id: string) {
    return this.devices.revoke(id);
  }
}

/** Perangkat menukar kode pendaftaran dengan kredensialnya (publik, batas laju endpoint kredensial). */
@ApiTags('perangkat (ADR-0027)')
@AuthRateLimited()
@Controller('devices')
export class DeviceEnrolmentController {
  constructor(private readonly devices: DevicesService) {}

  @Post('enrol')
  @HttpCode(200)
  enrol(@Body(new ZodValidationPipe(enrolDeviceSchema)) body: EnrolDeviceInput, @Req() req: Request) {
    return this.devices.enrol(body, meta(req));
  }
}

/** Endpoint milik perangkat itu sendiri. */
@ApiTags('perangkat (ADR-0027)')
@DeviceScoped()
@Controller('devices')
export class DeviceSelfController {
  constructor(private readonly devices: DevicesService) {}

  @Get('me')
  me() {
    return this.devices.self();
  }
}
