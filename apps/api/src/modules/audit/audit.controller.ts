import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audited, queryPatientId } from '../../common/audited.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuditService, auditListSchemaLimits } from './audit.service';

const listQuerySchema = z.strictObject({
  cursor: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(auditListSchemaLimits.maxLimit)
    .default(auditListSchemaLimits.defaultLimit),
  patientId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/** P04 · Jejak audit. Membaca audit juga diaudit (siapa melihat jejak siapa). Izin per peran menyusul di P03. */
@ApiTags('audit')
@TenantScoped()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('verify')
  @Audited({ action: 'verify', resource: 'audit_chain' })
  verify() {
    return this.audit.verifyChain();
  }

  @Get('events')
  @Audited({
    action: 'read',
    resource: 'audit_event',
    patientId: queryPatientId,
    details: ({ result }) => ({ count: (result as { items: unknown[] }).items.length }),
  })
  list(@Query(new ZodValidationPipe(listQuerySchema)) q: ListQuery) {
    return this.audit.list(q);
  }
}
