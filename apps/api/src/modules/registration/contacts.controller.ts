import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type PatientContact, type PatientContactInput, patientContactInputSchema } from '@simrs/shared';
import { Audited, paramId, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ContactsService } from './contacts.service';

const uuid = new ParseUUIDPipe();

/**
 * F03 · Kontak / penanggung jawab pasien (`/api/v1/patients/:id/contacts`). Bagian identitas pasien (modul P05);
 * tambah = baris baru (append-only). Audit per pasien; rincian hanya hubungan, tanpa nama/no. HP.
 */
@ApiTags('registration (F03)')
@TenantScoped()
@RequireModule('P05')
@Controller('patients/:id/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @RequirePermission('patient', 'read')
  @Get()
  @Audited({ action: 'read', resource: 'patient_contact', resourceId: paramId, patientId: paramId })
  list(@Param('id', uuid) id: string): Promise<PatientContact[]> {
    return this.contacts.list(id);
  }

  @RequirePermission('patient', 'write')
  @Post()
  @Audited({
    action: 'create',
    resource: 'patient_contact',
    resourceId: resultId,
    patientId: paramId,
    details: ({ body }) => ({ relation: (body as PatientContactInput | undefined)?.relation }),
  })
  create(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(patientContactInputSchema)) body: PatientContactInput,
  ): Promise<PatientContact> {
    return this.contacts.create(id, body);
  }
}
