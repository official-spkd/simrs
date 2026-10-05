import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ACTIVE_ENCOUNTER_STATUSES } from '@simrs/shared';
import type { Request, Response } from 'express';
import { Audited } from '../../common/audited.decorator';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { SseService } from '../realtime/sse.service';
import { TenantDb } from '../tenant-db';
import { ewsChannel } from './clinical-channels';

/**
 * Saringan lingkup izin untuk aliran klinis: `all` → semua; `unit` → unit penugasan sesi; `relationship` → kunjungan
 * aktif pasien yang berelasi dengan pelaku (dihitung sekali saat berlangganan; aliran ditutup ulang tiap ≤ 5 menit).
 */
interface ScopeFilter {
  /** null = lingkup `all`. */
  unitId: string | null;
  encounterIds: ReadonlySet<string>;
  all: boolean;
}

const allows = (s: ScopeFilter, unitId: string | null, encounterId?: string) =>
  s.all ||
  (unitId !== null && unitId === s.unitId) ||
  (encounterId !== undefined && s.encounterIds.has(encounterId));

/**
 * Kanal SSE eskalasi EWS (potongan 3.1, ADR-0026) untuk staf. Berlangganan diaudit (`read`); muatan tanpa PHI. Papan
 * IGD dan papan bed (dengan potret awal) ada di modulnya: `/triage/board/events`, `/adt/beds/events` (potongan 3.3).
 */
@ApiTags('klinis · aliran SSE')
@TenantScoped()
@Controller('clinical/streams')
export class ClinicalStreamsController {
  constructor(
    private readonly sse: SseService,
    private readonly db: TenantDb,
  ) {}

  @RequireModule('K12')
  @RequirePermission('clinical', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'ews_stream' })
  @Get('ews')
  async ews(@Req() req: Request, @Res() res: Response) {
    const scope = await this.scopeFilter();
    this.sse.stream(req, res, ewsChannel, {
      filter: (e) => allows(scope, e.data.unitId, e.data.encounterId),
    });
  }

  private async scopeFilter(): Promise<ScopeFilter> {
    const scope = this.db.permissionScope();
    if (scope === 'all') return { all: true, unitId: null, encounterIds: new Set() };
    const actor = this.db.actor();
    const encounterIds = await this.db.transaction(async () => {
      const tx = this.db.tx();
      const now = new Date();
      if (!actor.userId) return new Set<string>();
      const rels = await tx.accessRelationship.findMany({
        where: {
          userId: actor.userId,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
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
    // Lingkup unit tanpa unit penugasan = tidak ada akses unit (ADR-0031 butir 4); hanya relasi.
    return { all: false, unitId: scope === 'unit' ? (actor.unitId ?? null) : null, encounterIds };
  }
}
