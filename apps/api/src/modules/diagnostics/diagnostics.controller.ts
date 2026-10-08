import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type DiagnosticFormInput,
  diagnosticFormInputSchema,
  type DiagnosticReportCreateInput,
  diagnosticReportCreateInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DiagnosticsService } from './diagnostics.service';

const uuid = new ParseUUIDPipe();

/**
 * S10 · `/api/v1/diagnostics/*`: worklist order EKG/USG/echo/endoskopi/treadmill, laporan (isian P07 + lampiran P08 +
 * kesimpulan), TTE. Katalog izin tidak punya aksi baca diagnostik: worklist memakai `diagnostics.write`.
 */
@ApiTags('penunjang · diagnostik lain (S10)')
@TenantScoped()
@RequireModule('S10')
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @RequirePermission('diagnostics', 'write')
  @Get('worklist')
  worklist() {
    return this.diagnostics.worklist();
  }

  @RequirePermission('diagnostics', 'write')
  @Post('requests/:id/form')
  fillForm(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(diagnosticFormInputSchema)) body: DiagnosticFormInput,
  ) {
    return this.diagnostics.fillForm(id, body);
  }

  @RequirePermission('diagnostics', 'write')
  @Post('reports')
  create(@Body(new ZodValidationPipe(diagnosticReportCreateInputSchema)) body: DiagnosticReportCreateInput) {
    return this.diagnostics.create(body);
  }

  @RequirePermission('diagnostics', 'sign')
  @Post('reports/:id/sign')
  sign(@Param('id', uuid) id: string) {
    return this.diagnostics.sign(id);
  }
}
