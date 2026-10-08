import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ACTIVE_ENCOUNTER_STATUSES } from '@simrs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited } from '../../common/audited.decorator';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SseService } from '../../infra/realtime/sse.service';
import { TenantDb } from '../../infra/tenant-db';
import { surgeryActivityChannel } from './surgery-activity.channel';

const dateQuery = z.strictObject({ date: z.iso.date().optional() });

interface StreamScope {
  all: boolean;
  unitId: string | null;
  encounterIds: ReadonlySet<string>;
}

/**
 * S06 · Aliran SSE aktivitas papan OK (4.7b, ADR-0106): setiap perubahan kasus (status, butir tilik, konfirmasi,
 * peristiwa, hitung, BHP, laporan, spesimen, formulir anestesi) sebagai sinyal tanpa PHI. Lingkup sama dengan papan:
 * `unit` = unit kamar operasi penugasan, `relationship` = kunjungan aktif pasien berelasi (dihitung saat berlangganan;
 * aliran ditutup ulang ≤ 5 menit sehingga relasi dihitung ulang). Berlangganan diaudit.
 */
@ApiTags('penunjang · kamar operasi (S06)')
@TenantScoped()
@RequireModule('S06')
@Controller('surgery')
export class SurgeryStreamController {
  constructor(
    private readonly sse: SseService,
    private readonly db: TenantDb,
  ) {}

  @RequirePermission('surgery', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'surgery_activity_stream' })
  @Get('board/events')
  async boardEvents(
    @Req() req: Request,
    @Res() res: Response,
    @Query(new ZodValidationPipe(dateQuery)) q: z.infer<typeof dateQuery>,
  ) {
    const scope = await this.scope();
    this.sse.stream(req, res, surgeryActivityChannel, {
      filter: (e) =>
        (q.date === undefined || e.data.date === q.date) &&
        (scope.all ||
          (scope.unitId !== null && scope.unitId === e.data.unitId) ||
          scope.encounterIds.has(e.data.encounterId)),
    });
  }

  private async scope(): Promise<StreamScope> {
    const scope = this.db.permissionScope();
    if (scope === 'all') return { all: true, unitId: null, encounterIds: new Set() };
    const actor = this.db.actor();
    const unitId = scope === 'unit' ? (actor.unitId ?? null) : null;
    if (scope !== 'relationship' || !actor.userId) return { all: false, unitId, encounterIds: new Set() };
    const userId = actor.userId;
    const encounterIds = await this.db.transaction(async () => {
      const tx = this.db.tx();
      const now = new Date();
      const rels = await tx.accessRelationship.findMany({
        where: { userId, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
        select: { patientId: true },
      });
      const encs = await tx.encounter.findMany({
        where: {
          patientId: { in: rels.map((r) => r.patientId) },
          status: { in: [...ACTIVE_ENCOUNTER_STATUSES] },
        },
        select: { id: true },
      });
      return new Set(encs.map((e) => e.id));
    });
    return { all: false, unitId, encounterIds };
  }
}
