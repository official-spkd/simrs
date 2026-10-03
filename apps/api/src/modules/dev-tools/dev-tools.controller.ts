import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { INTEGRATION_TARGETS } from '@simrs/shared';
import { z } from 'zod';
import { Audited, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DevToolsService } from './dev-tools.service';

const pingSchema = z.strictObject({ target: z.enum(INTEGRATION_TARGETS) });
type PingBody = z.infer<typeof pingSchema>;

/** Endpoint bantu pengembangan. Modulnya hanya didaftarkan bila dev tools aktif (lihat AppModule). */
@ApiTags('dev (non-produksi)')
@TenantScoped()
@RequireModule('I01')
@Controller('dev')
export class DevToolsController {
  constructor(private readonly dev: DevToolsService) {}

  @Post('outbox-ping')
  @Audited({ action: 'create', resource: 'outbox_message', resourceId: resultId })
  ping(@Body(new ZodValidationPipe(pingSchema)) body: PingBody) {
    return this.dev.enqueuePing(body.target);
  }

  @Get('outbox/:id')
  outbox(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.dev.outboxStatus(id);
  }
}
