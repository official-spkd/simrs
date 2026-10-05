import { Module } from '@nestjs/common';
import { BpjsTaskEngine } from './bpjs-task.engine';
import { QueueController } from './queue.controller';
import { QueueRepository } from './queue.repository';
import { QueueService } from './queue.service';

/**
 * F04 · Antrean, display real-time, dan task ID BPJS (rencana fase 2 potongan 4a):
 * - API `/api/v1/queue` (`QueueController`): layanan, tiket (`allocateQueueNumber`), panggil berikutnya,
 *   panggil/ulang/lewati/mulai/selesai, papan display, aliran SSE (`queue_calls`, ADR-0026), status task ID;
 * - `BpjsTaskEngine` mendengar event domain (bukan tombol) dan menulis `bpjs_queue_tasks` + outbox
 *   `bpjs.antrean.updatewaktu`; worker menjaga urutan dengan `defer`.
 * `QueueService` diekspor untuk modul lain (registrasi 5a: `attachAppointment`, `issueTicket`).
 */
@Module({
  controllers: [QueueController],
  providers: [QueueRepository, QueueService, BpjsTaskEngine],
  exports: [QueueService, BpjsTaskEngine],
})
export class QueueModule {}
