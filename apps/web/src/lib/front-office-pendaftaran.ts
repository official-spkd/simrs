import { PAYERS, QUEUE_NO_PATTERN, wallClockSchema } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';

/**
 * F03/F06 · Domain toko demo `pendaftaran` (ADR-0085): SEP yang terbit dan kunjungan rawat jalan yang terdaftar di
 * meja pendaftaran (mode presentasi). Kejadian `kunjungan.terdaftar` adalah KONTRAK keluar front office:
 *
 * - Klinis (CD-2) melanggan untuk memasukkan pasien ke worklist Poli (`poliCode`, `doctorId`, `queueNo`).
 * - Keuangan (CX-2) melanggan `charge` untuk charge capture administrasi rawat jalan (`ADM-RJ`, rupiah utuh sebagai
 *   string digit karena JSON tidak punya bigint; ubah dengan `BigInt(charge.amount)`).
 * - Antrean (`front-office-antrean.ts`) melanggan untuk menambah nomor poli ke papan TV dan menutup tiket loket.
 *
 * Pelaku selalu `ev.actor` (sesi). Jam `HH.MM` = jam hari demo di layar (hanya tampilan, bukan gerbang).
 */

export const REGISTRATION_DOMAIN = 'pendaftaran';

/** Kode tarif administrasi rawat jalan (fixture `tarif.ts`, ADM-RJ Rp 30.000). */
export const REGISTRATION_CHARGE = {
  itemCode: 'ADM-RJ',
  label: 'Administrasi rawat jalan',
  amount: 30_000n,
} as const;

const id = z.string().min(1).max(60);
const queueNo = z.string().regex(QUEUE_NO_PATTERN);
/** Nomor SEP fiktif format VClaim (19 karakter). */
const sepNo = z.string().regex(/^[0-9A-Z]{19}$/);

export const registrationEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** SEP terbit untuk pasien BPJS (rujukan aktif + diagnosa awal ICD-10 diperiksa server). */
    type: z.literal('sep.diterbitkan'),
    patientId: id,
    referralId: id,
    diagnosis: z.string().trim().min(3).max(120),
    sepNo,
    jam: wallClockSchema,
  }),
  z.strictObject({
    /** Kontrak lintas domain: kunjungan rawat jalan baru (lihat komentar modul). */
    type: z.literal('kunjungan.terdaftar'),
    visitId: z.string().regex(/^kj-\d{1,5}$/),
    patientId: id,
    rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
    patientName: z.string().min(1).max(120),
    payer: z.enum(PAYERS),
    poliCode: z.string().regex(/^[A-Z]{2}$/),
    poliName: z.string().min(1).max(80),
    room: z.string().min(1).max(80),
    doctorId: id,
    doctorName: z.string().min(1).max(120),
    /** Sesi praktik hari ini (`practitionerQuotaSchema.sessionId`). */
    sessionId: z.uuid(),
    queueNo,
    /** SEP untuk BPJS, null untuk umum/asuransi. */
    sepNo: sepNo.nullable(),
    /** Diagnosa awal (ICD-10 · label) bila ada SEP. */
    diagnosis: z.string().trim().min(3).max(120).nullable(),
    /** Tiket loket yang dilayani (anjungan/walk-in), null bila dicari langsung. */
    ticketNo: queueNo.nullable(),
    jam: wallClockSchema,
    charge: z.strictObject({
      itemCode: z.literal(REGISTRATION_CHARGE.itemCode),
      label: z.string().min(1).max(80),
      /** Rupiah utuh (bigint sebagai string digit). */
      amount: z.string().regex(/^\d{1,12}$/),
    }),
  }),
  z.strictObject({
    /** Tiket poli, SEP, dan gelang dicetak (dicatat untuk jejak audit cetak). */
    type: z.literal('kunjungan.dicetak'),
    visitId: z.string().regex(/^kj-\d{1,5}$/),
    jam: wallClockSchema,
  }),
]);
export type RegistrationEvent = z.infer<typeof registrationEventSchema>;
export type VisitRegisteredEvent = Extract<RegistrationEvent, { type: 'kunjungan.terdaftar' }>;

export interface StoredSep {
  sepNo: string;
  referralId: string;
  diagnosis: string;
  jam: string;
  by: string;
}

export interface StoredVisit extends Omit<VisitRegisteredEvent, 'type'> {
  /** Nama petugas yang mendaftarkan (pengguna sesi). */
  registeredBy: string;
  /** Jam server (ISO) saat dicatat. */
  at: string;
  printedAt: string | null;
}

export interface RegistrationState {
  /** SEP per pasien (hari demo). */
  seps: Readonly<Record<string, StoredSep>>;
  /** Kunjungan terdaftar, urut waktu daftar. */
  visits: readonly StoredVisit[];
}

/** Kunjungan pasien hari ini (satu pasien satu kunjungan rawat jalan per hari demo). */
export function visitOf(s: RegistrationState, patientId: string): StoredVisit | undefined {
  return s.visits.find((v) => v.patientId === patientId);
}

export const ALREADY_REGISTERED = (v: Pick<StoredVisit, 'queueNo' | 'doctorName'>) =>
  `Pasien sudah terdaftar hari ini · antrean ${v.queueNo} · ${v.doctorName}.`;

function gate(s: RegistrationState, ev: RegistrationEvent): string | null {
  switch (ev.type) {
    case 'sep.diterbitkan': {
      const v = visitOf(s, ev.patientId);
      if (v) return ALREADY_REGISTERED(v);
      return s.seps[ev.patientId] ? 'SEP pasien ini sudah terbit hari ini.' : null;
    }
    case 'kunjungan.terdaftar': {
      const v = visitOf(s, ev.patientId);
      if (v) return ALREADY_REGISTERED(v);
      if (s.visits.some((x) => x.visitId === ev.visitId)) return 'Nomor kunjungan sudah dipakai.';
      if (s.visits.some((x) => x.queueNo === ev.queueNo)) return `Nomor antrean ${ev.queueNo} sudah dipakai.`;
      if (ev.payer === 'BPJS' && !ev.sepNo) return 'Pasien BPJS wajib punya SEP.';
      return null;
    }
    case 'kunjungan.dicetak':
      return s.visits.some((x) => x.visitId === ev.visitId) ? null : 'Kunjungan tidak ditemukan.';
  }
}

export const registrationDomain = defineDomain<RegistrationState, RegistrationEvent>(REGISTRATION_DOMAIN, {
  initial: () => ({ seps: {}, visits: [] }),
  eventSchema: registrationEventSchema,
  screens: ['daftar', 'kiosk', 'antrean', 'jadwal', 'info-publik'],
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    switch (d.type) {
      case 'sep.diterbitkan':
        return {
          ...s,
          seps: {
            ...s.seps,
            [d.patientId]: {
              sepNo: d.sepNo,
              referralId: d.referralId,
              diagnosis: d.diagnosis,
              jam: d.jam,
              by: ev.actor.name,
            },
          },
        };
      case 'kunjungan.terdaftar': {
        const { type: _t, ...rest } = d;
        return {
          ...s,
          visits: [...s.visits, { ...rest, registeredBy: ev.actor.name, at: ev.at, printedAt: null }],
        };
      }
      case 'kunjungan.dicetak':
        return {
          ...s,
          visits: s.visits.map((v) => (v.visitId === d.visitId ? { ...v, printedAt: d.jam } : v)),
        };
    }
  },
});

/** Id kunjungan berikutnya (deterministik dari jumlah kunjungan). */
export const nextVisitId = (s: RegistrationState) => `kj-${s.visits.length + 1}`;

/** Jumlah pasien terdaftar per sesi praktik dan penjamin (menambah booking kuota hari ini). */
export function bookedBySession(s: RegistrationState): Map<string, { jkn: number; nonJkn: number }> {
  const out = new Map<string, { jkn: number; nonJkn: number }>();
  for (const v of s.visits) {
    const cur = out.get(v.sessionId) ?? { jkn: 0, nonJkn: 0 };
    out.set(
      v.sessionId,
      v.payer === 'BPJS' ? { ...cur, jkn: cur.jkn + 1 } : { ...cur, nonJkn: cur.nonJkn + 1 },
    );
  }
  return out;
}
