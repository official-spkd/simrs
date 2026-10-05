import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CallTicketInput,
  callTicketSchema,
  type IssueTicketInput,
  issueTicketSchema,
  queueTicketQuerySchema,
  skipTicketSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { Audited, type AuditSource, paramId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { TenantDb } from '../../infra/tenant-db';
import { QueueService } from './queue.service';

const uuid = new ParseUUIDPipe();
const bpjsTasksQuery = z.strictObject({ appointmentId: z.uuid() });

const count = ({ result }: AuditSource) => ({
  count: Array.isArray(result) ? result.length : undefined,
});

/**
 * F04 · `/api/v1/queue` untuk STAF: layanan, tiket, panggilan (`queue.call`, klinisi berlingkup unit), daftar dan
 * pratinjau display, status task ID BPJS per booking. Kontrak di `@simrs/shared` (`schemas/queue.ts`). Papan dan
 * aliran SSE untuk TV ada di `QueueDisplayController` (prinsipal perangkat, ADR-0027).
 */
@ApiTags('queue (F04)')
@TenantScoped()
@RequireModule('F04')
@Controller('queue')
export class QueueController {
  constructor(
    private readonly queue: QueueService,
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

  /** Daftar display (admin mengikat TV ke display di layar perangkat). */
  @RequirePermission('queue', 'read')
  @Get('displays')
  displays() {
    return this.queue.listDisplays();
  }

  /** Papan display untuk staf (pratinjau, kendali antrean). TV memakai `QueueDisplayController`. */
  @RequirePermission('queue', 'read')
  @Get('displays/:id/preview')
  preview(@Param('id', uuid) id: string) {
    return this.queue.board(id);
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
