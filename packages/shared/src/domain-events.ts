import { z } from 'zod';
import { ENCOUNTER_CLASSES, type EncounterClass, PAYER_KINDS } from './schemas/registration';
import type { AntreanTaskId } from './integrations/bpjs/antrean';
import { QUEUE_SERVICE_KINDS } from './schemas/queue';
import { MEDICATION_ADMINISTRATION_STATUSES } from './clinical/emar';
import { BED_STATUSES, DISCHARGE_DISPOSITIONS } from './schemas/rawat-inap';
import { SUPPORT_PRIORITIES } from './schemas/penunjang';
import { surgerySpecimenSentPayloadSchema } from './schemas/surgery-specimen';
import {
  CRITICAL_SOURCES,
  DIAGNOSTIC_KINDS,
  MICRO_REPORT_STAGES,
  PHARMACY_SETTINGS,
  RAD_MODALITY_TOKENS,
  SPECIMEN_REJECT_REASONS,
  STOCK_TRANSFER_STAGES,
  SURGERY_PRIORITIES,
} from './schemas/penunjang-api';

/**
 * Event domain internal (CLAUDE.md §5) fase 2–3: nama + skema MUATAN. Amplop (`id`, `tenantId`, `occurredAt`, `actor`)
 * milik publisher API (`apps/api/src/infra/events`, potongan 1b) yang menjalankan penangan secara sinkron di transaksi
 * penerbit. Muatan hanya ID dan kode yang dibutuhkan pendengar, tanpa PHI (nama, NIK, diagnosis).
 * Pendengar utama fase 2: mesin task ID Antrean BPJS (potongan 4a, `bpjsTaskForEvent`).
 */

/** Tiket antrean pada transisi panggil/mulai/selesai. `serviceKind` menentukan task BPJS yang terbentuk. */
const ticketEvent = z.strictObject({
  ticketId: z.uuid(),
  queueServiceId: z.uuid(),
  serviceKind: z.enum(QUEUE_SERVICE_KINDS),
  appointmentId: z.uuid().nullable(),
  encounterId: z.uuid().nullable(),
});

/**
 * Muatan event datar karena tersimpan di `domain_events` (migrasi 0b susulan): kunci `…Id` = UUID, `…Ids` = larik
 * UUID, selain itu hanya null, boolean, angka, atau token enum huruf kecil (tanpa teks bebas/PHI).
 */
export const ENCOUNTER_CLASS_TOKENS = ['amb', 'emer', 'imp'] as const;
export type EncounterClassToken = (typeof ENCOUNTER_CLASS_TOKENS)[number];
export function encounterClassToken(c: EncounterClass): EncounterClassToken {
  return c.toLowerCase() as EncounterClassToken;
}
/** Kebalikan `encounterClassToken`. */
export function encounterClassFromToken(t: EncounterClassToken): EncounterClass {
  return ENCOUNTER_CLASSES[ENCOUNTER_CLASS_TOKENS.indexOf(t)] as EncounterClass;
}

/** Muatan event klinis tingkat kunjungan. */
const clinicalEncounterEvent = z.strictObject({
  encounterId: z.uuid(),
  patientId: z.uuid(),
  encounterClass: z.enum(ENCOUNTER_CLASS_TOKENS),
  unitId: z.uuid(),
});

const uuid = z.uuid();
/** Event penunjang tingkat kunjungan: kunjungan, pasien, dan unit pelaksana (lab, radiologi, depo, OK). */
const supportEncounter = { encounterId: uuid, patientId: uuid, unitId: uuid };

/** Event fase 4 (penunjang). Dipisah agar daftar fase 2–3 tetap terbaca; digabung ke `DOMAIN_EVENT_SCHEMAS`. */
const SUPPORT_DOMAIN_EVENT_SCHEMAS = {
  /** S01 · Unit lab menerima order (`lab_orders` + nomor lab + spesimen terbentuk). */
  'lab.order_accepted': z.strictObject({
    labOrderId: uuid,
    serviceRequestIds: z.array(uuid).min(1),
    ...supportEncounter,
    priority: z.enum(SUPPORT_PRIORITIES),
  }),
  /** S01 · Spesimen diterima di lab (awal TAT). */
  'lab.specimen_received': z.strictObject({ specimenId: uuid, labOrderId: uuid, ...supportEncounter }),
  /** S01 · Spesimen ditolak → notifikasi ruangan "sampel ulang". */
  'lab.specimen_rejected': z.strictObject({
    specimenId: uuid,
    labOrderId: uuid,
    ...supportEncounter,
    reason: z.enum(SPECIMEN_REJECT_REASONS),
  }),
  /** S01 · Hasil divalidasi klinis dan dirilis (TTE diminta) → panel hasil, notifikasi DPJP, charge fase 5. */
  'lab.result_released': z.strictObject({
    labOrderId: uuid,
    ...supportEncounter,
    labResultIds: z.array(uuid).min(1),
  }),
  /** S01 · Hasil dikoreksi (versi baru); `released` = koreksi atas hasil yang sudah dirilis (DPJP diberi tahu). */
  'lab.result_corrected': z.strictObject({
    labResultId: uuid,
    supersedesId: uuid,
    labOrderId: uuid,
    ...supportEncounter,
    released: z.boolean(),
  }),
  /** S01 · Satu pemeriksaan dibatalkan setelah diterima lab (order dibatalkan dokter/tidak bisa dikerjakan). */
  'lab.test_voided': z.strictObject({ labOrderId: uuid, serviceRequestId: uuid, ...supportEncounter }),
  /** S09 · Nilai kritis muncul (hasil lab atau ekspertise radiologi); timer dari waktu server. */
  'critical_result.raised': z.strictObject({
    criticalResultId: uuid,
    source: z.enum(CRITICAL_SOURCES),
    sourceId: uuid,
    ...supportEncounter,
    limitMinutes: z.int().min(1),
  }),
  /** S09 · Dilaporkan dengan read-back (satu-satunya jalan menutup nilai kritis). */
  'critical_result.reported': z.strictObject({
    criticalResultId: uuid,
    criticalResultReportId: uuid,
    ...supportEncounter,
    recipientUserId: uuid.nullable(),
    minutesToReport: z.int().min(0),
    withinLimit: z.boolean(),
  }),
  /** S09 · Eskalasi tingkat `level` (1 = batas waktu, 2 = batas + langkah). */
  'critical_result.escalated': z.strictObject({
    criticalResultId: uuid,
    ...supportEncounter,
    level: z.int().min(1).max(3),
  }),
  /** S03 · Akuisisi selesai (dosis CT tercatat) → charge fase 5. */
  'radiology.exam_completed': z.strictObject({
    imagingStudyId: uuid,
    serviceRequestId: uuid,
    ...supportEncounter,
    modality: z.enum(RAD_MODALITY_TOKENS),
    contrast: z.boolean(),
  }),
  /** S03 · Ekspertise ditandatangani radiolog (TTE diminta). */
  'radiology.report_signed': z.strictObject({
    imagingReportId: uuid,
    imagingStudyId: uuid,
    ...supportEncounter,
    critical: z.boolean(),
    addendum: z.boolean(),
  }),
  /** S04 · Farmasi mulai melayani resep (nomor R terbit) → task 6 lewat tiket antrean farmasi. */
  'pharmacy.service_started': z.strictObject({
    pharmacyPrescriptionId: uuid,
    orderGroupId: uuid,
    ...supportEncounter,
    setting: z.enum(PHARMACY_SETTINGS),
  }),
  /** S05 · Obat diserahkan (titik tagih obat, keputusan fase 4 no. 11). */
  'pharmacy.dispensed': z.strictObject({
    dispenseId: uuid,
    pharmacyPrescriptionId: uuid,
    ...supportEncounter,
    dispenseItemIds: z.array(uuid).min(1),
  }),
  /** S05 · Retur obat: layak kembali ke stok (`restocked`) atau dihapusbukukan; mengkredit tagihan. */
  'pharmacy.returned': z.strictObject({
    dispenseReturnId: uuid,
    dispenseId: uuid,
    ...supportEncounter,
    restocked: z.boolean(),
  }),
  /** S05 · Penerimaan barang ke depo/gudang. */
  'stock.received': z.strictObject({
    stockReceiptId: uuid,
    stockLocationId: uuid,
    stockMovementIds: z.array(uuid).min(1),
  }),
  /** S05 · Penyesuaian stok beralasan. */
  'stock.adjusted': z.strictObject({
    stockAdjustmentId: uuid,
    stockLocationId: uuid,
    stockMovementIds: z.array(uuid).min(1),
  }),
  /** S05 · Mutasi dua langkah: `dikirim` (keluar depo asal) lalu `diterima` (masuk depo tujuan). */
  'stock.transferred': z.strictObject({
    stockTransferId: uuid,
    fromStockLocationId: uuid,
    toStockLocationId: uuid,
    stage: z.enum(STOCK_TRANSFER_STAGES),
  }),
  /** S06 · Kasus operasi dijadwalkan di kamar. */
  'surgery.case_scheduled': z.strictObject({
    surgeryCaseId: uuid,
    ...supportEncounter,
    roomId: uuid,
    priority: z.enum(SURGERY_PRIORITIES),
  }),
  /** S06 · Insisi tercatat; `override` = sebelum time out dengan alasan dokter (ditinjau mutu). */
  'surgery.incision_recorded': z.strictObject({
    surgeryCaseId: uuid,
    ...supportEncounter,
    override: z.boolean(),
  }),
  /** S06 · Kasus selesai (laporan operasi + sign out) → charge fase 5 (prosedur, durasi, BHP). */
  'surgery.case_completed': z.strictObject({
    surgeryCaseId: uuid,
    ...supportEncounter,
    roomId: uuid,
    durationMinutes: z.int().min(0),
    supplyUsageIds: z.array(uuid),
  }),
  /** S06 · Kasus dibatalkan (beralasan; alasan di tabel, bukan di event). */
  'surgery.case_cancelled': z.strictObject({ surgeryCaseId: uuid, ...supportEncounter, roomId: uuid }),
  /** S06 → S02 · Spesimen operasi dikirim ke PA (4.7b); penangan 4.8 membuat order PA (`schemas/surgery-specimen.ts`). */
  'surgery.specimen_sent': surgerySpecimenSentPayloadSchema,
  /** S08 · Kantong darah dikeluarkan; `emergency` = jalur darurat tanpa crossmatch (keputusan no. 22). */
  'blood.unit_issued': z.strictObject({
    bloodIssueId: uuid,
    bloodUnitId: uuid,
    bloodRequestId: uuid,
    ...supportEncounter,
    emergency: z.boolean(),
  }),
  /** S10 · Laporan diagnostik lain (EKG, USG, echo, endoskopi, treadmill) ditandatangani. */
  'diagnostic.report_signed': z.strictObject({
    diagnosticReportId: uuid,
    serviceRequestId: uuid.nullable(),
    ...supportEncounter,
    kind: z.enum(DIAGNOSTIC_KINDS),
  }),
  /** S02 · Laporan mikrobiologi (awal/akhir) dirilis. */
  'micro.report_released': z.strictObject({
    labOrderId: uuid,
    ...supportEncounter,
    stage: z.enum(MICRO_REPORT_STAGES),
    isolateIds: z.array(uuid),
  }),
  /** S02 · Laporan patologi anatomi ditandatangani. */
  'pa.report_signed': z.strictObject({
    paReportId: uuid,
    ...supportEncounter,
    surgeryCaseId: uuid.nullable(),
  }),
} as const;

export const DOMAIN_EVENT_SCHEMAS = {
  /** F02 · Booking di-check-in (anjungan/loket) → task 1. */
  'booking.checked_in': z.strictObject({ appointmentId: z.uuid(), patientId: z.uuid() }),
  /** F02 · Booking dibatalkan → task 99 (dan `bpjs.antrean.batal` oleh modul booking). */
  'booking.cancelled': z.strictObject({ appointmentId: z.uuid(), patientId: z.uuid() }),
  /** F04 · Tiket dipanggil (termasuk ulang: `recall`). Loket pendaftaran (`loket`) → task 2. */
  'queue.ticket_called': ticketEvent.extend({ callId: z.uuid(), recall: z.boolean() }),
  /** F04 · Layanan dimulai. Poli → task 4; farmasi → task 6 (fase 4). */
  'queue.ticket_started': ticketEvent,
  /** F04 · Layanan selesai. Poli → task 5; farmasi → task 7 (fase 4). */
  'queue.ticket_finished': ticketEvent,
  /** F03 · Kunjungan terdaftar → task 3 (rawat jalan dari booking). */
  'encounter.registered': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    /** Kelas kunjungan sebagai token huruf kecil (`amb` | `emer` | `imp`; `encounters.class` huruf besar). */
    encounterClass: z.enum(ENCOUNTER_CLASS_TOKENS),
    unitId: z.uuid(),
    appointmentId: z.uuid().nullable(),
    payer: z.enum(PAYER_KINDS).nullable(),
  }),
  /** F06 · SEP terbit (nomor dari BPJS). */
  'sep.issued': z.strictObject({ sepId: z.uuid(), encounterId: z.uuid() }),
  /** F03 · Kunjungan dibatalkan → task 99 bila dari booking. */
  'encounter.cancelled': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    appointmentId: z.uuid().nullable(),
  }),
  // K01–K15 · Klinis RME (fase 3, rencana §3.0a). Pendengar: staging SATUSEHAT `held` dan `billable_events` (ADR-0032),
  // SSE papan IGD/bed, worklist. Tetap tanpa PHI: hanya ID dan token enum.
  /** K01/K02 · Pelayanan klinis kunjungan dimulai (dokter/perawat mulai memeriksa). */
  'encounter.started': clinicalEncounterEvent,
  /** K13 · Kunjungan selesai (gerbang tutup `DischargeGate` lolos). */
  'encounter.finished': clinicalEncounterEvent,
  /** K07 · CPPT final tersimpan (residen: `cosignRequired` → tugas co-sign DPJP). */
  'cppt.finalized': z.strictObject({
    cpptId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    cosignRequired: z.boolean(),
  }),
  /** K09 · Satu kiriman order aktif (lab/rad/tindakan → worklist penunjang fase 4; resep → farmasi). */
  'order.activated': z.strictObject({
    orderGroupId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    serviceRequestIds: z.array(z.uuid()),
    medicationRequestIds: z.array(z.uuid()),
    /** Order residen: tugas tinjau DPJP (keputusan fase 3 no. 4). */
    needsReview: z.boolean(),
  }),
  /** K09 · Satu order dibatalkan (beralasan). */
  'order.cancelled': z.strictObject({
    orderId: z.uuid(),
    orderType: z.enum(['service', 'medication']),
    encounterId: z.uuid(),
    patientId: z.uuid(),
  }),
  /** K12 · Pemberian obat tercatat (diberikan, ditunda, atau ditolak). */
  'medication.administered': z.strictObject({
    administrationId: z.uuid(),
    medicationRequestId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    status: z.enum(MEDICATION_ADMINISTRATION_STATUSES),
    /** Label lokal stok ruangan (ditagih eMAR); false = etiket farmasi (ditagih saat serah, 4.6b). Opsional: event lama. */
    wardStock: z.boolean().optional(),
  }),
  /** K04 · Admisi rawat inap (bed terisi, gelang terbit). */
  'adt.admitted': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    unitId: z.uuid(),
    bedId: z.uuid(),
    /** Kunjungan IGD/RJ asal (`part_of`), null bila dari SPRI/elektif. */
    sourceEncounterId: z.uuid().nullable(),
  }),
  /** K04 · Pindah unit/bed (akses lingkup unit ikut pindah, ADR-0031). */
  'adt.transferred': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    fromUnitId: z.uuid(),
    toUnitId: z.uuid(),
    fromBedId: z.uuid().nullable(),
    toBedId: z.uuid(),
  }),
  /** K04 · Pasien pulang (bed → kotor). */
  'adt.discharged': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    unitId: z.uuid(),
    bedId: z.uuid().nullable(),
    disposition: z.enum(DISCHARGE_DISPOSITIONS),
  }),
  /** K05 · Status bed berubah (papan bed SSE, Aplicare). */
  'bed.status_changed': z.strictObject({
    bedId: z.uuid(),
    unitId: z.uuid(),
    fromStatus: z.enum(BED_STATUSES),
    toStatus: z.enum(BED_STATUSES),
    version: z.int().min(1),
  }),
  /** K13 · Resume medis ditandatangani DPJP (TTE diminta; terkunci). */
  'discharge.signed': z.strictObject({
    dischargeSummaryId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
  }),
  /** K11 · Persetujuan, penolakan, atau pencabutan tindakan final (TTE diminta). */
  'consent.signed': z.strictObject({
    consentId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    outcome: z.enum(['setuju', 'tolak', 'dicabut']),
  }),
  // S01–S10 · Penunjang (fase 4, rencana §4.0a). Pendengar: charge capture fase 5, SATUSEHAT fase 7 (dibaca ulang dari
  // `domain_events`, keputusan fase 4 no. 16), SSE worklist, notifikasi. Muatan: ID, jumlah, token enum; tanpa
  // nama/nilai hasil/teks bebas. Kode baku (LOINC, ICD-9-CM, KFA) TIDAK di muatan (aturan muatan datar fase 2):
  // pendengar membacanya dari baris sumber lewat ID.
  ...SUPPORT_DOMAIN_EVENT_SCHEMAS,
} as const;

export type DomainEventName = keyof typeof DOMAIN_EVENT_SCHEMAS;
export const DOMAIN_EVENT_NAMES = Object.keys(DOMAIN_EVENT_SCHEMAS) as [
  DomainEventName,
  ...DomainEventName[],
];
export type DomainEventPayload<N extends DomainEventName> = z.infer<(typeof DOMAIN_EVENT_SCHEMAS)[N]>;
/** Bagian amplop yang dibutuhkan pemetaan task ID (cocok dengan amplop publisher API). */
export type DomainEvent = {
  [N in DomainEventName]: { name: N; payload: DomainEventPayload<N>; occurredAt: Date | string };
}[DomainEventName];

export function isDomainEventName(name: string): name is DomainEventName {
  return Object.hasOwn(DOMAIN_EVENT_SCHEMAS, name);
}

/**
 * Event yang juga DITULIS WORKER (fase 4 §4.1a: job eskalasi nilai kritis, penangan pesan masuk analyzer). Worker
 * hanya menyimpan baris `domain_events`; penangan in-process milik API (`DomainEvents.on`) TIDAK berjalan untuk
 * event yang ditulis worker. Agar tidak ada jalur yang diam-diam tidak jalan:
 * - API menolak mendaftarkan penangan in-process untuk event di daftar ini (galat program saat start),
 * - worker hanya boleh menulis event di daftar ini,
 * - reaksi atas event ini wajib lewat jalur yang berlaku untuk kedua penulis: outbox di transaksi penulis
 *   (efek luar, notifikasi), `pg_notify`/SSE (trigger tabel sumber), atau pembaca ulang `domain_events` (fase 5/7).
 * Menambah nama ke daftar ini = memastikan belum ada penangan in-process untuknya.
 */
export const WORKER_EMITTED_EVENTS = [
  'critical_result.raised',
  'critical_result.escalated',
] as const satisfies readonly DomainEventName[];
export type WorkerEmittedEvent = (typeof WORKER_EMITTED_EVENTS)[number];

export function isWorkerEmittedEvent(name: string): name is WorkerEmittedEvent {
  return (WORKER_EMITTED_EVENTS as readonly string[]).includes(name);
}

/** Validasi muatan event (dipakai publisher sebelum menerbitkan dan pada tes). Melempar ZodError bila salah. */
export function parseDomainEvent<N extends DomainEventName>(
  name: N,
  payload: unknown,
): DomainEventPayload<N> {
  return DOMAIN_EVENT_SCHEMAS[name].parse(payload) as DomainEventPayload<N>;
}

/**
 * Task ID Antrean BPJS yang dibentuk sebuah event (docs/06 §2, rencana fase 2 potongan 4a), atau null.
 * Hanya kandidat: mesin task ID tetap menyaring booking JKN, menjaga urutan (task n menunggu n−1 lewat `defer`), dan
 * tidak pernah menimpa waktu task yang sudah tercatat. Panggilan ulang (`recall`) tidak membentuk task baru.
 */
export function bpjsTaskForEvent(
  event: DomainEvent,
): { appointmentId: string; taskId: AntreanTaskId; at: string } | null {
  const at = new Date(event.occurredAt).toISOString();
  const task = (appointmentId: string | null, taskId: AntreanTaskId | null) =>
    appointmentId && taskId ? { appointmentId, taskId, at } : null;
  switch (event.name) {
    case 'booking.checked_in':
      return task(event.payload.appointmentId, 1);
    case 'booking.cancelled':
      return task(event.payload.appointmentId, 99);
    case 'queue.ticket_called':
      return event.payload.recall
        ? null
        : task(event.payload.appointmentId, event.payload.serviceKind === 'loket' ? 2 : null);
    case 'encounter.registered':
      return task(event.payload.appointmentId, event.payload.encounterClass === 'amb' ? 3 : null);
    case 'queue.ticket_started':
      return task(
        event.payload.appointmentId,
        event.payload.serviceKind === 'poli' ? 4 : event.payload.serviceKind === 'farmasi' ? 6 : null,
      );
    case 'queue.ticket_finished':
      return task(
        event.payload.appointmentId,
        event.payload.serviceKind === 'poli' ? 5 : event.payload.serviceKind === 'farmasi' ? 7 : null,
      );
    case 'encounter.cancelled':
      return task(event.payload.appointmentId, 99);
    case 'sep.issued':
    case 'encounter.started':
    case 'encounter.finished':
    case 'cppt.finalized':
    case 'order.activated':
    case 'order.cancelled':
    case 'medication.administered':
    case 'adt.admitted':
    case 'adt.transferred':
    case 'adt.discharged':
    case 'bed.status_changed':
    case 'discharge.signed':
    case 'consent.signed':
      return null;
    // Fase 4: task 6/7 tetap dari tiket antrean farmasi (`queue.ticket_*`), bukan dari event farmasi.
    case 'lab.order_accepted':
    case 'lab.specimen_received':
    case 'lab.specimen_rejected':
    case 'lab.result_released':
    case 'lab.result_corrected':
    case 'lab.test_voided':
    case 'critical_result.raised':
    case 'critical_result.reported':
    case 'critical_result.escalated':
    case 'radiology.exam_completed':
    case 'radiology.report_signed':
    case 'pharmacy.service_started':
    case 'pharmacy.dispensed':
    case 'pharmacy.returned':
    case 'stock.received':
    case 'stock.adjusted':
    case 'stock.transferred':
    case 'surgery.case_scheduled':
    case 'surgery.incision_recorded':
    case 'surgery.case_completed':
    case 'surgery.case_cancelled':
    case 'surgery.specimen_sent':
    case 'blood.unit_issued':
    case 'diagnostic.report_signed':
    case 'micro.report_released':
    case 'pa.report_signed':
      return null;
  }
}
