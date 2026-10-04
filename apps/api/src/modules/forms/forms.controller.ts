import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CorrectFormResponseInput,
  correctFormResponseSchema,
  type CreateFormDefinitionInput,
  createFormDefinitionSchema,
  type CreateFormResponseInput,
  createFormResponseSchema,
  formTransitionSchema,
  newFormDraftSchema,
  type UpdateFormDraftInput,
  updateFormDraftSchema,
  voidFormResponseSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { Audited, type AuditSource, param, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { FormDefinitionsService } from './form-definitions.service';
import { FormResponsesService } from './form-responses.service';

const uuid = new ParseUUIDPipe();
const codeParam = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Kode formulir tidak valid');
const listQuery = z.strictObject({ code: codeParam.optional() });
type Transition = z.infer<typeof formTransitionSchema>;

/** Pasien dari hasil handler (detail isian memuat `patientId`). */
const resultPatient = ({ result }: AuditSource): string | undefined =>
  typeof result === 'object' &&
  result !== null &&
  typeof (result as { patientId?: unknown }).patientId === 'string'
    ? (result as { patientId: string }).patientId
    : undefined;

/** P07 · Definisi formulir klinis berversi (komite rekam medis): draf, ajukan, terbitkan. */
@ApiTags('forms (P07)')
@TenantScoped()
@RequireModule('P07')
@Controller('forms')
export class FormDefinitionsController {
  constructor(private readonly defs: FormDefinitionsService) {}

  @RequirePermission('forms.definition', 'read')
  @Get()
  list() {
    return this.defs.list();
  }

  @RequirePermission('forms.definition', 'read')
  @Get(':code')
  get(@Param('code', new ZodValidationPipe(codeParam)) code: string) {
    return this.defs.get(code);
  }

  @RequirePermission('forms.definition', 'read')
  @Get(':code/versions/:version')
  version(
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.defs.getVersion(code, version);
  }

  @RequirePermission('forms.definition', 'write')
  @Post()
  create(@Body(new ZodValidationPipe(createFormDefinitionSchema)) body: CreateFormDefinitionInput) {
    return this.defs.create(body);
  }

  @RequirePermission('forms.definition', 'write')
  @Put(':code/draft')
  updateDraft(
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
    @Body(new ZodValidationPipe(updateFormDraftSchema)) body: UpdateFormDraftInput,
  ) {
    return this.defs.updateDraft(code, body);
  }

  @RequirePermission('forms.definition', 'write')
  @Post(':code/drafts')
  newDraft(
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
    @Body(new ZodValidationPipe(newFormDraftSchema)) body: z.infer<typeof newFormDraftSchema>,
  ) {
    return this.defs.newDraft(code, body.changeNote);
  }

  @RequirePermission('forms.definition', 'write')
  @Post(':code/submit')
  @HttpCode(200)
  submit(
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
    @Body(new ZodValidationPipe(formTransitionSchema)) body: Transition,
  ) {
    return this.defs.submit(code, body.baseUpdatedAt);
  }

  @RequirePermission('forms.definition', 'write')
  @Post(':code/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
    @Body(new ZodValidationPipe(formTransitionSchema)) body: Transition,
  ) {
    return this.defs.withdraw(code, body.baseUpdatedAt);
  }

  @RequirePermission('forms.definition', 'publish')
  @Post(':code/publish')
  @HttpCode(200)
  publish(
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
    @Body(new ZodValidationPipe(formTransitionSchema)) body: Transition,
  ) {
    return this.defs.publish(code, body.baseUpdatedAt);
  }
}

/**
 * P07 · Isian formulir pasien (append-only). Baca dan isi diaudit dengan `patientId`; koreksi diaudit di service
 * (alasan + field yang berubah).
 */
@ApiTags('forms (P07)')
@TenantScoped()
@RequireModule('P07')
@Controller()
export class FormResponsesController {
  constructor(private readonly responses: FormResponsesService) {}

  @RequirePermission('forms.response', 'write')
  @Post('patients/:patientId/forms/:code/responses')
  @Audited({
    action: 'create',
    resource: 'form_response',
    resourceId: resultId,
    patientId: param('patientId'),
    details: ({ params }) => ({ form: params.code }),
  })
  create(
    @Param('patientId', uuid) patientId: string,
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
    @Body(new ZodValidationPipe(createFormResponseSchema)) body: CreateFormResponseInput,
  ) {
    return this.responses.create(patientId, code, body.answers);
  }

  @RequirePermission('forms.response', 'read')
  @Get('patients/:patientId/form-responses')
  @Audited({ action: 'read', resource: 'form_response', patientId: param('patientId') })
  list(
    @Param('patientId', uuid) patientId: string,
    @Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.responses.listForPatient(patientId, q.code);
  }

  @RequirePermission('forms.response', 'read')
  @Get('form-responses/:id')
  @Audited({ action: 'read', resource: 'form_response', resourceId: param('id'), patientId: resultPatient })
  get(@Param('id', uuid) id: string) {
    return this.responses.get(id);
  }

  @RequirePermission('forms.response', 'correct')
  @Post('form-responses/:id/corrections')
  correct(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(correctFormResponseSchema)) body: CorrectFormResponseInput,
  ) {
    return this.responses.correct(id, body);
  }

  @RequirePermission('forms.response', 'correct')
  @Post('form-responses/:id/void')
  @HttpCode(200)
  void(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(voidFormResponseSchema)) body: z.infer<typeof voidFormResponseSchema>,
  ) {
    return this.responses.void(id, body.reason);
  }
}
