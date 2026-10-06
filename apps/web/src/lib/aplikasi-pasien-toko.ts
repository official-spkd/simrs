import { z } from 'zod';
import { idSchema, jamSchema, must } from './backoffice-toko';
import { DURATIONS, FAMILY_SCOPES, type FamilyScope, grantBlock } from './akses-keluarga';
import { defineDomain, on } from './demo/store/define';
import { PATIENT_ID } from './demo/fixtures/ids';
import { scheduleDomain } from './front-office-jadwal';

/**
 * I07 · Domain toko demo `aplikasi-pasien` (ADR-0085, CX-3): aksi Tn. Suryo di pratinjau aplikasi pasien: booking
 * jadwal poli (slot dari Jadwal dokter CD-3, kuota + cuti diperiksa Server Action), gula darah mandiri, dan akses
 * keluarga (setuju/tolak/cabut). Melanggan `jadwal` (`cuti.dicatat`): booking pada slot yang menjadi cuti ditandai
 * dan pasien diberi notifikasi.
 *
 * Kejadian `booking.dibuat` adalah KONTRAK keluar untuk Pendaftaran/anjungan (CD-3): `{ code, patientId, slotId,
 * doctorId, doctorName, poliCode, poliName, date, start }` (slotId = `scheduleCellId(dokter, tanggal)`), untuk
 * menambah booking di kuota slot dan check-in anjungan dengan kode booking.
 */

export const PATIENT_APP_DOMAIN = 'aplikasi-pasien';
export const APP_PATIENT_ID = PATIENT_ID.suryo;
export const FAMILY_REQUEST = { name: 'Bayu Nugroho', relation: 'Anak · 24 th', via: 'aplikasi pasien, 5 Okt 07.40' };
export const FAMILY_EXISTING = { name: 'Ny. Ratih Nugroho', relation: 'Istri', scopes: ['jadwal'] as FamilyScope[], until: null, at: '12 Mar 2025' };

const scope = z.enum(FAMILY_SCOPES.map((s) => s.id) as [FamilyScope, ...FamilyScope[]]);

export const patientAppEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('booking.dibuat'),
    code: z.string().regex(/^BK-\d{4}-\d{3}$/),
    patientId: idSchema,
    slotId: idSchema,
    doctorId: idSchema,
    doctorName: z.string().min(1).max(120),
    poliCode: z.string().regex(/^[A-Z]{2}$/),
    poliName: z.string().min(1).max(80),
    date: z.iso.date(),
    start: jamSchema,
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('booking.dibatalkan'), code: z.string().regex(/^BK-\d{4}-\d{3}$/), jam: jamSchema }),
  z.strictObject({ type: z.literal('gula.dicatat'), value: z.number().int().min(20).max(600), jam: jamSchema }),
  z.strictObject({
    type: z.literal('keluarga.disetujui'),
    scopes: z.array(scope).min(1).max(FAMILY_SCOPES.length),
    duration: z.enum(DURATIONS.map((d) => d.id) as [string, ...string[]]),
    until: z.iso.date().nullable(),
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('keluarga.ditolak'), jam: jamSchema }),
  z.strictObject({ type: z.literal('keluarga.dicabut'), name: z.string().min(1).max(120), jam: jamSchema }),
]);
export type PatientAppEvent = z.infer<typeof patientAppEventSchema>;
export type BookingEvent = Extract<PatientAppEvent, { type: 'booking.dibuat' }>;

export interface StoredBooking extends Omit<BookingEvent, 'type'> {
  cancelled: boolean;
  /** Dokter cuti pada slot ini (dari Jadwal dokter) setelah booking dibuat. */
  onLeave: boolean;
}

export interface FamilyGrant {
  name: string;
  relation: string;
  scopes: FamilyScope[];
  until: string | null;
  at: string;
}

export interface PatientAppStoreState {
  bookings: StoredBooking[];
  seq: number;
  glucose: Array<{ value: number; jam: string }>;
  family: { pending: boolean; grants: FamilyGrant[]; notice: string | null };
  /** Slot yang dicatat cuti (dari langganan `jadwal`). */
  leaves: string[];
}

export function initialPatientApp(): PatientAppStoreState {
  return {
    bookings: [],
    seq: 41,
    glucose: [],
    family: { pending: true, grants: [{ ...FAMILY_EXISTING, scopes: [...FAMILY_EXISTING.scopes] }], notice: null },
    leaves: [],
  };
}

export const bookingCode = (seq: number) => `BK-2610-${String(seq).padStart(3, '0')}`;

function gate(s: PatientAppStoreState, ev: PatientAppEvent): string | null {
  switch (ev.type) {
    case 'booking.dibuat':
      if (ev.code !== bookingCode(s.seq)) return 'Kode booking berikutnya berbeda; muat ulang aplikasi.';
      if (s.leaves.includes(ev.slotId)) return 'Dokter cuti pada jadwal ini.';
      return s.bookings.some((b) => !b.cancelled && b.slotId === ev.slotId) ? 'Anda sudah booking jadwal ini.' : null;
    case 'booking.dibatalkan':
      return s.bookings.some((b) => b.code === ev.code && !b.cancelled) ? null : 'Booking tidak ditemukan.';
    case 'gula.dicatat':
      return null;
    case 'keluarga.disetujui':
      if (!s.family.pending) return 'Tidak ada permintaan akses yang menunggu.';
      return grantBlock(ev.scopes, ev.duration, true);
    case 'keluarga.ditolak':
      return s.family.pending ? null : 'Tidak ada permintaan akses yang menunggu.';
    case 'keluarga.dicabut':
      return s.family.grants.some((g) => g.name === ev.name) ? null : 'Akses keluarga tidak ditemukan.';
  }
}

export const patientAppDomain = defineDomain<PatientAppStoreState, PatientAppEvent>(PATIENT_APP_DOMAIN, {
  initial: initialPatientApp,
  eventSchema: patientAppEventSchema,
  screens: ['app-pasien'],
  validate: (s, ev) => gate(s, ev),
  subscriptions: [
    on(scheduleDomain, (s, ev) => {
      if (ev.data.type !== 'cuti.dicatat') return s;
      const slot = ev.data.slotId;
      return {
        ...s,
        leaves: [...s.leaves, slot],
        bookings: s.bookings.map((b) => (b.slotId === slot && !b.cancelled ? { ...b, onLeave: true } : b)),
      };
    }),
  ],
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d));
    switch (d.type) {
      case 'booking.dibuat': {
        const { type: _t, ...rest } = d;
        return { ...s, seq: s.seq + 1, bookings: [...s.bookings, { ...rest, cancelled: false, onLeave: false }] };
      }
      case 'booking.dibatalkan':
        return { ...s, bookings: s.bookings.map((b) => (b.code === d.code ? { ...b, cancelled: true } : b)) };
      case 'gula.dicatat':
        return { ...s, glucose: [...s.glucose, { value: d.value, jam: d.jam }] };
      case 'keluarga.disetujui':
        return {
          ...s,
          family: {
            pending: false,
            grants: [
              ...s.family.grants,
              { name: FAMILY_REQUEST.name, relation: FAMILY_REQUEST.relation, scopes: [...d.scopes], until: d.until, at: d.jam },
            ],
            notice: `Akses ${FAMILY_REQUEST.name} aktif ${d.jam}`,
          },
        };
      case 'keluarga.ditolak':
        return {
          ...s,
          family: { ...s.family, pending: false, notice: `Permintaan ${FAMILY_REQUEST.name} ditolak ${d.jam}; pemohon diberi tahu.` },
        };
      case 'keluarga.dicabut':
        return {
          ...s,
          family: {
            ...s.family,
            grants: s.family.grants.filter((g) => g.name !== d.name),
            notice: `Akses ${d.name} dicabut ${d.jam}; sesi aplikasinya berakhir.`,
          },
        };
    }
  },
});
