import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AdmitInput,
  admitInputSchema,
  bedAllocateInputSchema,
  type BedRequestInput,
  bedRequestCancelInputSchema,
  bedRequestInputSchema,
  type BedStatusChangeInput,
  bedStatusChangeInputSchema,
  type DischargeInput,
  dischargeInputSchema,
  type TransferInput,
  transferInputSchema,
  wristbandReprintInputSchema,
} from '@simrs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited } from '../../common/audited.decorator';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { bedBoardChannel } from '../../infra/clinical/clinical-channels';
import { SseService } from '../../infra/realtime/sse.service';
import { TenantDb } from '../../infra/tenant-db';
import { AdtService } from './adt.service';
import { BedBoardService } from './bed-board.service';

const uuid = new ParseUUIDPipe();
const boardQuery = z.strictObject({ unitId: z.uuid().optional() });

/**
 * K04/K05 · ADT dan papan bed (`/api/v1/adt`, rencana fase 3 §3.3). Izin `bed.read|write` (pendaftaran/admisi lingkup
 * `all`, perawat lingkup unit). Papan bed real-time lewat SSE (`/adt/beds/events`, potret awal + `bed.status`).
 */
@ApiTags('klinis · ADT dan papan bed (K04/K05)')
@TenantScoped()
@RequireModule('K04')
@Controller('adt')
export class AdtController {
  constructor(
    private readonly adt: AdtService,
    private readonly board: BedBoardService,
    private readonly sse: SseService,
    private readonly db: TenantDb,
  ) {}

  @RequirePermission('bed', 'read')
  @Audited({ action: 'read', resource: 'bed_board' })
  @Get('beds')
  beds(@Query(new ZodValidationPipe(boardQuery)) q: z.infer<typeof boardQuery>) {
    return this.board.board(q.unitId);
  }

  /** SSE papan bed: potret `bed.board` (tanpa id) lalu perubahan `bed.status` sesuai lingkup. */
  @RequirePermission('bed', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'bed_board_stream' })
  @Get('beds/events')
  async bedEvents(@Req() req: Request, @Res() res: Response) {
    const scope = this.db.permissionScope();
    const unitId = scope === 'all' ? null : (this.db.actor().unitId ?? '');
    this.sse.stream(req, res, bedBoardChannel, {
      filter: (e) => unitId === null || e.data.unitId === unitId,
      initial: async () => [{ event: 'bed.board', data: await this.board.board() }],
    });
  }

  @RequirePermission('bed', 'write')
  @Patch('beds/:locationId/status')
  status(
    @Param('locationId', uuid) locationId: string,
    @Body(new ZodValidationPipe(bedStatusChangeInputSchema)) body: BedStatusChangeInput,
  ) {
    return this.adt.changeBedStatus(locationId, body);
  }

  @RequirePermission('bed', 'write')
  @Post('bed-requests')
  request(@Body(new ZodValidationPipe(bedRequestInputSchema)) body: BedRequestInput) {
    return this.adt.requestBed(body);
  }

  @RequirePermission('bed', 'write')
  @Post('bed-requests/:id/allocate')
  @HttpCode(200)
  allocate(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(bedAllocateInputSchema)) body: { locationId: string },
  ) {
    return this.adt.allocate(id, body.locationId);
  }

  @RequirePermission('bed', 'write')
  @Post('bed-requests/:id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(bedRequestCancelInputSchema)) body: { reason: string },
  ) {
    return this.adt.cancelRequest(id, body.reason);
  }

  @RequirePermission('bed', 'write')
  @Post('admissions')
  admit(@Body(new ZodValidationPipe(admitInputSchema)) body: AdmitInput) {
    return this.adt.admit(body);
  }

  @RequirePermission('bed', 'write')
  @Post('transfers')
  transfer(@Body(new ZodValidationPipe(transferInputSchema)) body: TransferInput) {
    return this.adt.transfer(body);
  }

  @RequirePermission('bed', 'write')
  @Post('discharges')
  discharge(@Body(new ZodValidationPipe(dischargeInputSchema)) body: DischargeInput) {
    return this.adt.discharge(body);
  }
}

/**
 * K04 · Gelang identitas per kunjungan (bentuk rute per-kunjungan kanonik fase 3): `GET /api/v1/encounters/:id/wristband`
 * (data cetak, diaudit `print`) dan `POST /api/v1/encounters/:id/wristband/reprint` (beralasan; gelang lama batal).
 */
@ApiTags('klinis · ADT dan papan bed (K04/K05)')
@TenantScoped()
@RequireModule('K04')
@Controller('encounters')
export class AdtEncounterController {
  constructor(private readonly adt: AdtService) {}

  @RequirePermission('bed', 'write')
  @Get(':id/wristband')
  wristband(@Param('id', uuid) encounterId: string) {
    return this.adt.wristband(encounterId);
  }

  @RequirePermission('bed', 'write')
  @Post(':id/wristband/reprint')
  reprint(
    @Param('id', uuid) encounterId: string,
    @Body(new ZodValidationPipe(wristbandReprintInputSchema)) body: { reason: string },
  ) {
    return this.adt.reprintWristband(encounterId, body.reason);
  }
}
