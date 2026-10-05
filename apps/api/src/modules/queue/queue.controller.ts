import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CallTicketInput,
  callTicketSchema,
  type IssueTicketInput,
  issueTicketSchema,
  queueTicketQuerySchema,
  skipTicketSchema,
} from '@simrs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited, type AuditSource, param, paramId } from '../../common/audited.decorator';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SseService } from '../../infra/realtime/sse.service';
import { TenantDb } from '../../infra/tenant-db';
import { queueCallsChannel } from './queue-calls.channel';
import { QueueService } from './queue.service';

const uuid = new ParseUUIDPipe();
const bpjsTasksQuery = z.strictObject({ appointmentId: z.uuid() });

const count = ({ result }: AuditSource) => ({
  count: Array.isArray(result) ? result.length : undefined,
});

/**
 * F04 · `/api/v1/queue`: layanan, tiket, panggilan (`queue.call`, klinisi berlingkup unit), papan + aliran SSE display,
 * dan status task ID BPJS per booking. Kontrak di `@simrs/shared` (`schemas/queue.ts`).
 *
 * Papan dan SSE sementara memakai sesi staf (`queue.read`). Display TV memakai prinsipal perangkat
 * (`queue.display.read`, ADR-0027) setelah potongan 1b menyediakannya: cukup mengganti `@RequirePermission` dua
 * handler `displays/*` ke izin perangkat; isi dan penyaringannya sama.
 */
@ApiTags('queue (F04)')
@TenantScoped()
@RequireModule('F04')
@Controller('queue')
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly sse: SseService,
    private readonly db: TenantDb,
  ) {}

  @RequirePermission('queue', 'read')
  @Get('services')
  services() {
    return this.queue.listServices();
  }

  /** Daftar tiket hari ini (atau `serviceDate`). Berisi ID pasien tanpa identitas; dicatat sebagai baca daftar. */
  @RequirePermission('queue', 'read')
  @Audited({ action: 'read', resource: 'queue_service', resourceId: paramId, details: count })
  @Get('services/:id/tickets')
  tickets(
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(queueTicketQuerySchema)) q: z.infer<typeof queueTicketQuerySchema>,
  ) {
    return this.queue.listTickets(id, q);
  }

  @RequirePermission('queue', 'call')
  @Post('services/:id/tickets')
  issue(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(issueTicketSchema)) body: IssueTicketInput,
  ) {
    return this.queue.issueTicket(id, body);
  }

  @RequirePermission('queue', 'call')
  @Post('services/:id/call-next')
  @HttpCode(200)
  callNext(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(callTicketSchema)) body: CallTicketInput,
  ) {
    return this.queue.callNext(id, body);
  }

  @RequirePermission('queue', 'call')
  @Post('tickets/:id/call')
  @HttpCode(200)
  call(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(callTicketSchema)) body: CallTicketInput) {
    return this.queue.callTicket(id, body);
  }

  @RequirePermission('queue', 'call')
  @Post('tickets/:id/recall')
  @HttpCode(200)
  recall(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(callTicketSchema)) body: CallTicketInput,
  ) {
    return this.queue.recall(id, body);
  }

  @RequirePermission('queue', 'call')
  @Post('tickets/:id/skip')
  @HttpCode(200)
  skip(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(skipTicketSchema)) body: z.infer<typeof skipTicketSchema>,
  ) {
    return this.queue.skip(id, body.reason);
  }

  @RequirePermission('queue', 'call')
  @Post('tickets/:id/start')
  @HttpCode(200)
  start(@Param('id', uuid) id: string) {
    return this.queue.start(id);
  }

  @RequirePermission('queue', 'call')
  @Post('tickets/:id/finish')
  @HttpCode(200)
  finish(@Param('id', uuid) id: string) {
    return this.queue.finish(id);
  }

  @RequirePermission('queue', 'read')
  @Get('displays/:id/board')
  board(@Param('id', uuid) id: string) {
    return this.queue.board(id);
  }

  /**
   * Aliran SSE panggilan untuk satu display (ADR-0026): hanya layanan display ini; replay `Last-Event-ID`. Tanpa
   * transaksi permintaan; layanan display dibaca di transaksi pendek sebelum aliran dimulai.
   */
  @NoRequestTransaction()
  @RequirePermission('queue', 'read')
  @Audited({ action: 'read', resource: 'queue_display_stream', resourceId: param('id') })
  @Get('displays/:id/events')
  async events(@Param('id', uuid) id: string, @Req() req: Request, @Res() res: Response) {
    const codes = await this.db.transaction(() => this.queue.displayServiceCodes(id));
    this.sse.stream(req, res, queueCallsChannel, { filter: (e) => codes.has(e.data.serviceCode) });
  }

  /** Status task ID BPJS satu booking (chip task 1–3 di Pendaftaran). */
  @RequirePermission('queue', 'read')
  @Get('bpjs-tasks')
  async bpjsTasks(@Query(new ZodValidationPipe(bpjsTasksQuery)) q: z.infer<typeof bpjsTasksQuery>) {
    const { patientId, items } = await this.queue.bpjsTasks(q.appointmentId);
    this.db.audit({
      action: 'read',
      resourceType: 'bpjs_queue_task',
      resourceId: q.appointmentId,
      patientId,
      details: { count: items.length },
    });
    return items;
  }
}
