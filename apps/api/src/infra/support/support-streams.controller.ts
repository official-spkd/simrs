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
import { SseService } from '../realtime/sse.service';
import { TenantDb } from '../tenant-db';
import {
  criticalChannel,
  labWorklistChannel,
  pharmacyQueueChannel,
  surgeryBoardChannel,
} from './support-channels';

/**
 * Lingkup izin untuk aliran penunjang (keputusan fase 4 no. 3): `all` → semua; `unit` → unit penugasan sesi (unit
 * pelaksana: lab, depo, OK); `relationship` → kunjungan aktif pasien yang berelasi dengan pelaku (DPJP/perawat),
 * dihitung sekali saat berlangganan (aliran ditutup ulang ≤ 5 menit, jadi relasi dihitung ulang berkala).
 */
interface StreamScope {
  all: boolean;
  unitId: string | null;
  encounterIds: ReadonlySet<string>;
}

const allows = (s: StreamScope, unitId: string | null, encounterId?: string) =>
  s.all ||
  (unitId !== null && unitId === s.unitId) ||
  (encounterId !== undefined && s.encounterIds.has(encounterId));

const boardQuerySchema = z.object({
  /** Tanggal papan (`YYYY-MM-DD`, WIB); kosong = semua tanggal. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD')
    .optional(),
});

/**
 * Fase 4 §4.1a · Aliran SSE penunjang (ADR-0026) untuk staf: worklist lab per unit, antrean depo per unit, papan OK per
 * tanggal, nilai kritis per pengguna. Berlangganan diaudit (`read`, tanpa PHI); pembaruan berikutnya tidak diaudit
 * (muatan hanya ID + status). Layar memuat detail lewat endpoint berizin yang diaudit.
 */
@ApiTags('penunjang · aliran SSE')
@TenantScoped()
@Controller('support/streams')
export class SupportStreamsController {
  constructor(
    private readonly sse: SseService,
    private readonly db: TenantDb,
  ) {}

  @RequireModule('S01')
  @RequirePermission('lab.worklist', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'lab_worklist_stream' })
  @Get('lab-worklist')
  async labWorklist(@Req() req: Request, @Res() res: Response) {
    const scope = await this.scope({ relationship: false });
    this.sse.stream(req, res, labWorklistChannel, { filter: (e) => allows(scope, e.data.unitId) });
  }

  @RequireModule('S04')
  @RequirePermission('pharmacy.review', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'pharmacy_queue_stream' })
  @Get('pharmacy-queue')
  async pharmacyQueue(@Req() req: Request, @Res() res: Response) {
    const scope = await this.scope({ relationship: false });
    this.sse.stream(req, res, pharmacyQueueChannel, { filter: (e) => allows(scope, e.data.unitId) });
  }

  @RequireModule('S06')
  @RequirePermission('surgery', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'surgery_board_stream' })
  @Get('surgery-board')
  async surgeryBoard(
    @Req() req: Request,
    @Res() res: Response,
    @Query(new ZodValidationPipe(boardQuerySchema)) q: z.infer<typeof boardQuerySchema>,
  ) {
    const scope = await this.scope({ relationship: true });
    this.sse.stream(req, res, surgeryBoardChannel, {
      filter: (e) =>
        (q.date === undefined || e.data.date === q.date) && allows(scope, e.data.unitId, e.data.encounterId),
    });
  }

  @RequireModule('S09')
  @RequirePermission('critical_result', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'critical_result_stream' })
  @Get('critical')
  async critical(@Req() req: Request, @Res() res: Response) {
    const scope = await this.scope({ relationship: true });
    const me = this.db.actorUserId();
    this.sse.stream(req, res, criticalChannel, {
      filter: (e) =>
        allows(scope, e.data.unitId, e.data.encounterId) ||
        (me !== null && e.data.notifiedUserIds.includes(me)),
    });
  }

  private async scope(opts: { relationship: boolean }): Promise<StreamScope> {
    const scope = this.db.permissionScope();
    if (scope === 'all') return { all: true, unitId: null, encounterIds: new Set() };
    const actor = this.db.actor();
    // Lingkup unit tanpa unit penugasan = tidak ada akses unit (ADR-0031 butir 4).
    const unitId = scope === 'unit' ? (actor.unitId ?? null) : null;
    if (scope !== 'relationship' || !opts.relationship || !actor.userId) {
      return { all: false, unitId, encounterIds: new Set() };
    }
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
