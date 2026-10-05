import { Module } from '@nestjs/common';
import { BpjsTaskEngine } from './bpjs-task.engine';
import { QueueController } from './queue.controller';
import { QueueDisplayController } from './queue-display.controller';
import { QueueRepository } from './queue.repository';
import { QueueService } from './queue.service';

/**
 * F04 · Antrean, display real-time, dan task ID BPJS (rencana fase 2 potongan 4a):
 * - API `/api/v1/queue` (`QueueController`): layanan, tiket (`allocateQueueNumber`), panggil berikutnya,
 *   panggil/ulang/lewati/mulai/selesai, daftar display (staf), status task ID;
 * - display TV (`QueueDisplayController`, prinsipal perangkat `queue.display.read`, ADR-0027): papan + aliran SSE
 *   (`queue_calls`, ADR-0026) untuk display yang terikat ke perangkat (`registered_devices.queue_display_id`);
 * - `BpjsTaskEngine` mendengar event domain (bukan tombol) dan menulis `bpjs_queue_tasks` + outbox
 *   `bpjs.antrean.updatewaktu`; worker menjaga urutan dengan `defer`.
 * `QueueService` diekspor untuk modul lain (registrasi 5a: `attachAppointment`, `issueTicket`).
 */
@Module({
  controllers: [QueueController, QueueDisplayController],
  providers: [QueueRepository, QueueService, BpjsTaskEngine],
  exports: [QueueService, BpjsTaskEngine],
})
export class QueueModule {}
