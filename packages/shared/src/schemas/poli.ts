import { z } from 'zod';
import { SIGNATURE_STATUSES } from '../documents';
import { klinisPatientSchema, poliEncounterSchema, poliQueueItemSchema, poliWorklistSchema } from './klinis';
import { QUEUE_TICKET_STATUSES } from './queue';

/**
 * K01/K02 · Kontrak API layar Pemeriksaan poli (W1). Bentuk = kontrak mode presentasi `poliWorklistSchema` /
 * `poliEncounterSchema` (ADR-0023 keputusan 4) agar komponen layar sama di kedua mode; tambahan jalur api di `api`.
 * Nomor antrean dan NIK tersamar dilonggarkan: data api memakai nomor tiket nyata dan pasien tanpa tiket poli.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });

export const ENCOUNTER_STATUS_VALUES = [
  'planned',
  'arrived',
  'in_progress',
  'finished',
  'cancelled',
] as const;

export const poliWorklistItemApiSchema = poliQueueItemSchema.extend({
  /** Nomor tiket poli (`PD-027`) atau `—` bila kunjungan belum punya tiket poli. */
  queueNo: z.string().min(1).max(12),
  queueTicketId: uuid.nullable(),
  ticketStatus: z.enum(QUEUE_TICKET_STATUSES).nullable(),
  encounterStatus: z.enum(ENCOUNTER_STATUS_VALUES),
});
export type PoliWorklistItemApi = z.infer<typeof poliWorklistItemApiSchema>;

/** `GET /api/v1/poli/worklist`: antrean poli hari ini untuk unit penugasan (atau `serviceId`). */
export const poliWorklistApiSchema = poliWorklistSchema.extend({
  serviceId: uuid.nullable(),
  items: z.array(poliWorklistItemApiSchema),
});
export type PoliWorklistApi = z.infer<typeof poliWorklistApiSchema>;

export const poliWorklistQuerySchema = z.strictObject({ serviceId: uuid.optional() });

/**
 * `GET /api/v1/encounters/:id/poli-visit`: kunjungan rawat jalan untuk layar poli. `encounter` = bentuk kontrak demo
 * (banner, TTV, SOAP, diagnosis, rencana, hasil, obat, riwayat, dokumen); `api` = keadaan sungguhan untuk aksi
 * (tiket antrean, CPPT, resume RJ, status kunjungan).
 */
export const poliVisitSchema = z.strictObject({
  encounter: poliEncounterSchema.extend({
    queueNo: z.string().min(1).max(12),
    patient: klinisPatientSchema.extend({
      nikMasked: z.string().min(1).max(40),
      rm: z.string().min(1).max(20),
    }),
  }),
  api: z.strictObject({
    patientId: uuid,
    encounterStatus: z.enum(ENCOUNTER_STATUS_VALUES),
    queueTicketId: uuid.nullable(),
    ticketStatus: z.enum(QUEUE_TICKET_STATUSES).nullable(),
    /** CPPT dokter terkini kunjungan ini (final atau menunggu co-sign). */
    cppt: z
      .strictObject({
        id: uuid,
        status: z.enum(['final', 'menunggu_cosign', 'entered_in_error']),
        authorUserId: uuid,
        authorName: z.string(),
        recordedAt: instant,
      })
      .nullable(),
    /** Draf SOAP milik pengguna sesi (`clinical_drafts` jenis `soap`). */
    draftSavedAt: instant.nullable(),
    draft: z
      .strictObject({
        subjective: z.string(),
        objective: z.string(),
        diagnosisCodes: z.array(z.string()),
        plan: z.string(),
        followUp: z.string(),
        condition: z.string(),
      })
      .nullable(),
    /** Resume RJ: belum/draf/final + status TTE. */
    resume: z.strictObject({
      state: z.enum(['belum', 'draf', 'final']),
      signatureStatus: z.enum(SIGNATURE_STATUSES).nullable(),
    }),
    /** Pengguna sesi boleh TTE resume dan menutup kunjungan (DPJP kunjungan + `clinical.sign`). */
    canSign: z.boolean(),
  }),
});
export type PoliVisit = z.infer<typeof poliVisitSchema>;

/**
 * Isi SOAP draf (`PUT /drafts/:encounterId/soap`) dan masukan "Tanda tangani dan selesai": S/O, kode ICD-10, rencana
 * (P), tindak lanjut/kontrol, dan kondisi pulang untuk resume rawat jalan ringkas.
 */
export const poliSoapDraftSchema = z.strictObject({
  subjective: z.string().max(2000),
  objective: z.string().max(2000),
  diagnosisCodes: z.array(z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/)).max(10),
  plan: z.string().max(2000).default(''),
  followUp: z.string().max(1000).default(''),
  condition: z.string().max(40).default(''),
});
export type PoliSoapDraft = z.infer<typeof poliSoapDraftSchema>;
