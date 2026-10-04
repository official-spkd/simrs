import { z } from 'zod';
import { ANTREAN_TASK_IDS } from '../integrations/bpjs/antrean';
import { QUEUE_PREFIX_PATTERN } from '../numbering';
import { bpjsSyncSchema, queueBoardSchema, queueNoSchema, serviceDateSchema } from './front-office';

/**
 * F04 · Kontrak API antrean (`/api/v1/queue`, rencana fase 2 potongan 4a) dan event display real-time (SSE,
 * ADR-0026). Nomor `<kode layanan>-<3 digit>` per layanan per hari (`NUMBER_KINDS.queue_ticket`).
 * Izin: baca `queue.read`; panggil/ulang/lewati/mulai/selesai `queue.call` (klinisi: lingkup unit); layanan dan
 * display `queue.manage`; papan TV dan SSE hanya prinsipal perangkat `queue.display.read`.
 * Task ID Antrean BPJS dibentuk dari event domain (`domain-events.ts`), bukan dari tombol.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const LABEL = z.string().trim().min(1).max(120);
/** Loket/ruang tempat pasien dipanggil (tampil di TV), mis. `Loket 3`, `Ruang Periksa 2`. */
export const counterLabelSchema = z.string().trim().min(1).max(40);

export const QUEUE_SERVICE_KINDS = ['admisi', 'poli', 'farmasi', 'kasir', 'penunjang'] as const;
export type QueueServiceKind = (typeof QUEUE_SERVICE_KINDS)[number];
export const QUEUE_SERVICE_KIND_LABEL: Record<QueueServiceKind, string> = {
  admisi: 'Loket pendaftaran',
  poli: 'Poli',
  farmasi: 'Farmasi',
  kasir: 'Kasir',
  penunjang: 'Penunjang',
};

export const queueServiceCodeSchema = z
  .string()
  .regex(QUEUE_PREFIX_PATTERN, 'Kode layanan 1–2 huruf kapital');

export const queueServiceSchema = z.strictObject({
  id: z.uuid(),
  /** Awalan nomor antrean. */
  code: queueServiceCodeSchema,
  name: LABEL,
  kind: z.enum(QUEUE_SERVICE_KINDS),
  /** Unit pemilik (lingkup `unit` klinisi); null untuk layanan umum RS. */
  unitId: z.uuid().nullable(),
  room: z.string().max(60).nullable(),
  /** Menimpa pengaturan `queue.avg_service_minutes` untuk estimasi. */
  avgServiceMinutes: z.number().int().min(1).max(120).nullable(),
  active: z.boolean(),
});
export type QueueService = z.infer<typeof queueServiceSchema>;

export const queueServiceInputSchema = z.strictObject({
  code: queueServiceCodeSchema,
  name: LABEL,
  kind: z.enum(QUEUE_SERVICE_KINDS),
  unitId: z.uuid().optional(),
  room: z.string().trim().max(60).optional(),
  avgServiceMinutes: z.number().int().min(1).max(120).optional(),
});
export type QueueServiceInput = z.infer<typeof queueServiceInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Tiket
// ---------------------------------------------------------------------------------------------------------------

/**
 * `waiting` → `called` (boleh dipanggil ulang) → `serving` → `done`; `skipped` (lewat, bisa dipanggil lagi);
 * `cancelled`. Waktu tiap transisi tidak pernah ditimpa (sumber task ID BPJS).
 */
export const QUEUE_TICKET_STATUSES = [
  'waiting',
  'called',
  'serving',
  'done',
  'skipped',
  'cancelled',
] as const;
export type QueueTicketStatus = (typeof QUEUE_TICKET_STATUSES)[number];
export const QUEUE_TICKET_STATUS_LABEL: Record<QueueTicketStatus, string> = {
  waiting: 'Menunggu',
  called: 'Dipanggil',
  serving: 'Dilayani',
  done: 'Selesai',
  skipped: 'Dilewati',
  cancelled: 'Batal',
};

export const queueTicketSchema = z.strictObject({
  id: z.uuid(),
  serviceId: z.uuid(),
  serviceCode: queueServiceCodeSchema,
  queueNo: queueNoSchema,
  serviceDate: serviceDateSchema,
  status: z.enum(QUEUE_TICKET_STATUSES),
  /**
   * Nomor yang dialokasikan ke booking (nomor poli saat booking): dipanggil petugas poli, bukan oleh "panggil
   * berikutnya" sebelum pasiennya terdaftar.
   */
  reserved: z.boolean(),
  appointmentId: z.uuid().nullable(),
  encounterId: z.uuid().nullable(),
  /** Tanpa nama/identitas: kontrak antrean tidak membawa PHI; layar berizin menggabungkan sendiri bila perlu. */
  patientId: z.uuid().nullable(),
  issuedAt: isoDateTime,
  calledAt: isoDateTime.nullable(),
  callCount: z.number().int().min(0),
  counter: counterLabelSchema.nullable(),
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  estimatedCallAt: isoDateTime.nullable(),
});
export type QueueTicket = z.infer<typeof queueTicketSchema>;

export const queueTicketQuerySchema = z.strictObject({
  serviceDate: serviceDateSchema.optional(),
  status: z.enum(QUEUE_TICKET_STATUSES).optional(),
});

/** Ambil tiket untuk layanan (loket/staf). Anjungan memakai endpoint perangkat sendiri. */
export const issueTicketSchema = z.strictObject({
  appointmentId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
});
export type IssueTicketInput = z.infer<typeof issueTicketSchema>;

/** Panggil berikutnya (FIFO, melewati nomor cadangan) atau panggil/ulang tiket tertentu. Kosong → 409 `QUEUE_EMPTY`. */
export const callTicketSchema = z.strictObject({ counter: counterLabelSchema });
export type CallTicketInput = z.infer<typeof callTicketSchema>;

export const skipTicketSchema = z.strictObject({ reason: z.string().trim().max(300).optional() });

/** Panggilan (`queue_calls`, append-only; satu baris per panggilan termasuk ulang). */
export const queueCallRecordSchema = z.strictObject({
  id: z.uuid(),
  ticketId: z.uuid(),
  serviceCode: queueServiceCodeSchema,
  queueNo: queueNoSchema,
  counter: counterLabelSchema,
  recall: z.boolean(),
  at: isoDateTime,
  /** Staf pemanggil (audit); null bila oleh sistem. */
  calledBy: z.uuid().nullable(),
});
export type QueueCallRecord = z.infer<typeof queueCallRecordSchema>;

export const callResultSchema = z.strictObject({ ticket: queueTicketSchema, call: queueCallRecordSchema });

// ---------------------------------------------------------------------------------------------------------------
// Display (TV) dan event real-time
// ---------------------------------------------------------------------------------------------------------------

export const queueDisplayInputSchema = z.strictObject({
  name: LABEL,
  /** Area ruang tunggu, mis. "Rawat Jalan Lantai 2". */
  area: LABEL,
  unitId: z.uuid(),
  /** Layanan yang tampil (papan memuat maks. 4 poli). */
  serviceIds: z.array(z.uuid()).min(1).max(4),
  info: z.string().trim().min(1).max(300),
});
export type QueueDisplayInput = z.infer<typeof queueDisplayInputSchema>;

export const queueDisplaySchema = z.strictObject({
  id: z.uuid(),
  name: LABEL,
  area: LABEL,
  unitId: z.uuid(),
  serviceIds: z.array(z.uuid()).min(1).max(4),
  info: z.string().min(1).max(300),
  active: z.boolean(),
});
export type QueueDisplay = z.infer<typeof queueDisplaySchema>;

/** Nama event SSE (`event:`) di `/api/v1/queue/displays/:id/events`. Heartbeat = baris komentar SSE, bukan event. */
export const QUEUE_SSE_EVENTS = { call: 'queue.call', board: 'queue.board' } as const;

/**
 * Data event SSE display. `call` membawa ID panggilan (dipakai sebagai `id:` SSE untuk replay `Last-Event-ID`);
 * `board` = potret papan lengkap (saat tersambung, setelah replay, dan saat papan berubah tanpa panggilan).
 */
export const queueDisplayEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('call'),
    callId: z.uuid(),
    queueNo: queueNoSchema,
    serviceCode: queueServiceCodeSchema,
    /** Tujuan yang disebut suara panggilan. */
    counter: counterLabelSchema,
    recall: z.boolean(),
    at: isoDateTime,
  }),
  z.strictObject({ type: z.literal('board'), board: queueBoardSchema }),
]);
export type QueueDisplayEvent = z.infer<typeof queueDisplayEventSchema>;

/** Kanal `pg_notify` panggilan antrean. Muatan hanya tenant + ID panggilan (tanpa PHI, < 8000 byte). */
export const QUEUE_NOTIFY_CHANNEL = 'simrs_queue_call';
export const queueNotifyPayloadSchema = z.strictObject({ tenantId: z.uuid(), callId: z.uuid() });
export type QueueNotifyPayload = z.infer<typeof queueNotifyPayloadSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Task ID Antrean BPJS (docs/06 §2)
// ---------------------------------------------------------------------------------------------------------------

/** Task ID Antrean BPJS: sumber tunggal kontrak kawat (`ANTREAN_TASK_IDS`, arti di `ANTREAN_TASK_LABEL`). */
export const bpjsTaskIdSchema = z.literal(ANTREAN_TASK_IDS);

/** `bpjs_queue_tasks`: satu baris per (booking, task); waktu tidak bisa diubah. Chip task 1–3 di layar Pendaftaran. */
export const bpjsQueueTaskSchema = z.strictObject({
  id: z.uuid(),
  appointmentId: z.uuid(),
  taskId: bpjsTaskIdSchema,
  /** Waktu kejadian (dikirim ke BPJS sebagai milidetik epoch). */
  at: isoDateTime,
  sync: bpjsSyncSchema,
});
export type BpjsQueueTask = z.infer<typeof bpjsQueueTaskSchema>;
