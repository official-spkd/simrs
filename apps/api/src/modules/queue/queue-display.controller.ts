import { Controller, Get, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { QUEUE_SSE_EVENTS, type QueueDisplayEvent } from '@simrs/shared';
import type { Request, Response } from 'express';
import { Audited, param } from '../../common/audited.decorator';
import { DeviceScoped } from '../../common/device-scoped.decorator';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { SseService } from '../../infra/realtime/sse.service';
import { TenantDb } from '../../infra/tenant-db';
import { queueCallsChannel } from './queue-calls.channel';
import { QueueService } from './queue.service';

const uuid = new ParseUUIDPipe();

/**
 * F04 · Display TV ruang tunggu (prinsipal perangkat `queue.display.read`, ADR-0027). Perangkat hanya membaca display
 * yang terikat padanya (`registered_devices.queue_display_id`); token staf di sini → 403.
 */
@ApiTags('queue (F04) · display')
@DeviceScoped('queue.display.read')
@RequireModule('F04')
@Controller('queue/displays')
export class QueueDisplayController {
  constructor(
    private readonly queue: QueueService,
    private readonly sse: SseService,
    private readonly db: TenantDb,
  ) {}

  @Get(':id/board')
  async board(@Param('id', uuid) id: string) {
    await this.queue.assertDeviceDisplay(id);
    return this.queue.board(id);
  }

  /**
   * Aliran SSE (ADR-0026): `queue.board` (potret papan, tanpa `id:`) saat tersambung dan setelah replay, lalu
   * `queue.call` untuk layanan display ini (replay `Last-Event-ID`). Tanpa transaksi permintaan; pengikatan display
   * dan layanannya dibaca di transaksi pendek sebelum aliran dimulai.
   */
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'queue_display_stream', resourceId: param('id') })
  @Get(':id/events')
  async events(@Param('id', uuid) id: string, @Req() req: Request, @Res() res: Response) {
    const codes = await this.db.transaction(async () => {
      await this.queue.assertDeviceDisplay(id);
      return this.queue.displayServiceCodes(id);
    });
    this.sse.stream(req, res, queueCallsChannel, {
      filter: (e) => codes.has(e.data.serviceCode),
      initial: async () => {
        const board: QueueDisplayEvent = { type: 'board', board: await this.queue.board(id) };
        return [{ event: QUEUE_SSE_EVENTS.board, data: board }];
      },
    });
  }
}
