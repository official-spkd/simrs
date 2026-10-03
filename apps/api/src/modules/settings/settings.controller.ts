import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audited, param } from '../../common/audited.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SettingsService } from './settings.service';

/** Skema input. Pipe dibuat di dekorator parameter (sama seperti controller lain). */
const schemas = {
  setValue: z.strictObject({ value: z.unknown() }),
  setModule: z.strictObject({ enabled: z.boolean() }),
  key: z.string().regex(/^[a-z][a-z0-9_.]{2,63}$/),
  code: z.string().regex(/^[PFKSUBI][0-9]{2}$/),
};

/** P12 pengaturan + P10 modul aktif. Izin (admin_tenant) dipasang di P03. */
@ApiTags('settings (P10, P12)')
@TenantScoped()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Put(':key')
  @Audited({ action: 'update', resource: 'tenant_setting', resourceId: param('key') })
  set(
    @Param('key', new ZodValidationPipe(schemas.key)) key: string,
    @Body(new ZodValidationPipe(schemas.setValue)) body: { value?: unknown },
  ) {
    return this.settings.set(key, body.value);
  }

  @Get('modules')
  listModules() {
    return this.settings.listModules();
  }

  @Put('modules/:code')
  @Audited({
    action: 'update',
    resource: 'tenant_module',
    resourceId: param('code'),
    details: ({ body }) => ({ enabled: (body as { enabled: boolean }).enabled }),
  })
  setModule(
    @Param('code', new ZodValidationPipe(schemas.code)) code: string,
    @Body(new ZodValidationPipe(schemas.setModule)) body: { enabled: boolean },
  ) {
    return this.settings.setModule(code, body.enabled);
  }
}
