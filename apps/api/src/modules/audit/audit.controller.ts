import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_OUTCOMES,
  auditAnomalyReviewSchema,
  auditAnomalyReviewsQuerySchema,
  type AuditAnomalyReviewInput,
  type AuditVerifyResult,
  auditVerifyQuerySchema,
} from '@simrs/shared';
import { z } from 'zod';
import { Audited, type AuditSource, param, queryPatientId } from '../../common/audited.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuditService, auditListSchemaLimits } from './audit.service';

const SEQ = z.string().regex(/^\d{1,18}$/);
const groupKeys = Object.keys(AUDIT_ACTION_GROUPS) as [
  keyof typeof AUDIT_ACTION_GROUPS,
  ...Array<keyof typeof AUDIT_ACTION_GROUPS>,
];

const filterShape = {
  patientId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  actorRole: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,40}$/)
    .optional(),
  group: z.enum(groupKeys).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
};

const listQuerySchema = z.strictObject({
  ...filterShape,
  cursor: SEQ.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(auditListSchemaLimits.maxLimit)
    .default(auditListSchemaLimits.defaultLimit),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const exportQuerySchema = z.strictObject({
  ...filterShape,
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

const anomalyQuerySchema = z.strictObject({ days: z.coerce.number().int().min(1).max(90).default(30) });

/** Kunci temuan dari query (`?key=`), sudah lolos validasi pipe. */
const queryKey = ({ query }: AuditSource): string | undefined =>
  typeof query.key === 'string' ? query.key : undefined;

/**
 * P04 · Jejak audit (layar /sistem/audit). Membaca audit juga diaudit (siapa melihat jejak siapa).
 * Anomali dihitung dari jejak itu sendiri; keputusan tinjauannya juga menjadi entri audit.
 */
@ApiTags('audit (P04)')
@TenantScoped()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Keutuhan jejak audit (ADR-0072). `?mode=checkpoint` (bawaan) mulai dari jangkar sah terakhir; `?mode=full`
   * menghitung ulang seluruh rantai. Hasil (mode, utuh/tidak, kode temuan) ikut dicatat di entri audit `verify`.
   */
  @RequirePermission('audit', 'read')
  @Get('verify')
  @Audited({
    action: 'verify',
    resource: 'audit_chain',
    details: ({ result }) => {
      const r = result as AuditVerifyResult;
      return {
        mode: r.mode,
        intact: r.intact,
        checked: r.checked,
        issues: [...new Set(r.issues.map((i) => i.code))],
      };
    },
  })
  verify(@Query(new ZodValidationPipe(auditVerifyQuerySchema)) q: z.infer<typeof auditVerifyQuerySchema>) {
    return this.audit.verifyChain(q.mode);
  }

  @RequirePermission('audit', 'read')
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

  @RequirePermission('audit', 'read')
  @Get('events/:seq')
  @Audited({ action: 'read', resource: 'audit_event', resourceId: param('seq') })
  detail(@Param('seq', new ZodValidationPipe(SEQ)) seq: string) {
    return this.audit.detail(seq);
  }

  @RequirePermission('audit', 'read')
  @Get('anomalies')
  @Audited({
    action: 'read',
    resource: 'audit_anomaly',
    details: ({ result }) => ({ count: (result as { findings: unknown[] }).findings.length }),
  })
  anomalies(@Query(new ZodValidationPipe(anomalyQuerySchema)) q: z.infer<typeof anomalyQuerySchema>) {
    return this.audit.anomalies(q.days);
  }

  /**
   * Riwayat tinjauan satu temuan (peninjau, waktu, keputusan, catatan), terbaru dulu. Izinnya sama dengan membaca
   * temuan; pembukaannya dicatat dengan kunci temuan sebagai `resource_id`.
   */
  @RequirePermission('audit', 'read')
  @Get('anomalies/reviews')
  @Audited({
    action: 'read',
    resource: 'audit_anomaly',
    resourceId: queryKey,
    details: ({ result }) => ({ count: (result as { items: unknown[] }).items.length }),
  })
  anomalyReviews(
    @Query(new ZodValidationPipe(auditAnomalyReviewsQuerySchema))
    q: z.infer<typeof auditAnomalyReviewsQuerySchema>,
  ) {
    return this.audit.anomalyReviewHistory(q.key);
  }

  /** Keputusan tinjauan temuan (bukan akses darurat; itu lewat /authz/break-glass/:id/review). */
  @RequirePermission('audit', 'review')
  @Post('anomalies/review')
  @HttpCode(200)
  reviewAnomaly(@Body(new ZodValidationPipe(auditAnomalyReviewSchema)) body: AuditAnomalyReviewInput) {
    return this.audit.reviewAnomaly(body);
  }

  /** Paket bukti akreditasi (CSV). Ekspor dicatat di audit oleh service (beserta jumlah baris). */
  @RequirePermission('audit', 'export')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="jejak-audit.csv"')
  exportCsv(@Query(new ZodValidationPipe(exportQuerySchema)) q: z.infer<typeof exportQuerySchema>) {
    return this.audit.exportCsv(q);
  }
}
