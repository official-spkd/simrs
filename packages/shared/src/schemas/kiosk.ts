import { z } from 'zod';
import { formatHariBulan } from '../datetime';
import { queueNoSchema, timeOfDaySchema } from './front-office';
import { SEP_NO_PATTERN } from './registration';
import { bookingCodeSchema } from './booking';

/**
 * F05 · Kontrak API anjungan mandiri (`/api/v1/kiosk`, rencana fase 2 potongan 6). Hanya prinsipal perangkat
 * berizin `kiosk.use` (ADR-0027); akun staf → 403 `DEVICE_NOT_ALLOWED`. Identitas dikonfirmasi lewat nama tersamar +
 * tanggal lahir tanpa tahun (keputusan fase 2 no. 3); pencarian dibatasi `kiosk.lookup_rate_per_min` per perangkat.
 * Anjungan tidak pernah menerima ID pasien: tindakan lanjutan memakai token pencarian berumur pendek.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** Pilihan layar awal (mockup Anjungan). */
export const KIOSK_PURPOSES = ['booking', 'bpjs', 'umum', 'farmasi_kasir'] as const;
export type KioskPurpose = (typeof KIOSK_PURPOSES)[number];
export const KIOSK_PURPOSE_LABEL: Record<KioskPurpose, string> = {
  booking: 'Saya sudah punya booking',
  bpjs: 'Pasien BPJS',
  umum: 'Pasien umum atau asuransi',
  farmasi_kasir: 'Ambil antrean farmasi atau kasir',
};

/** Cara identifikasi di keypad: panjang digit tetap. */
export const KIOSK_ID_METHODS = {
  nik: { label: 'NIK e-KTP', length: 16 },
  booking: { label: 'Kode booking', length: 10 },
  bpjs: { label: 'Nomor kartu BPJS', length: 13 },
} as const;
export type KioskIdMethod = keyof typeof KIOSK_ID_METHODS;

/** Token hasil pencarian: `kl1.` + 256 bit base64url; hanya berlaku di perangkat yang sama selama TTL. */
export const KIOSK_LOOKUP_TOKEN_PATTERN = /^kl1\.[A-Za-z0-9_-]{43}$/;
export const KIOSK_LOOKUP_TTL_SECONDS = 180;
export const kioskLookupTokenSchema = z.string().regex(KIOSK_LOOKUP_TOKEN_PATTERN);

export const kioskIdentifySchema = z
  .strictObject({
    purpose: z.enum(KIOSK_PURPOSES),
    method: z.enum(Object.keys(KIOSK_ID_METHODS) as [KioskIdMethod, ...KioskIdMethod[]]),
    value: z.string().regex(/^\d+$/, 'Hanya angka'),
  })
  .refine((v) => v.value.length === KIOSK_ID_METHODS[v.method].length, {
    message: 'Jumlah digit tidak sesuai',
    path: ['value'],
  });
export type KioskIdentifyInput = z.infer<typeof kioskIdentifySchema>;

/**
 * Hasil identifikasi (200 untuk ditemukan maupun tidak; tiap percobaan dihitung laju dan diaudit atas nama
 * perangkat). Yang ditampilkan hanya nama tersamar dan tanggal lahir tanpa tahun (tanpa RM, NIK, poli, atau dokter).
 */
export const kioskIdentifyResultSchema = z.discriminatedUnion('found', [
  z.strictObject({ found: z.literal(false) }),
  z.strictObject({
    found: z.literal(true),
    lookupToken: kioskLookupTokenSchema,
    expiresAt: isoDateTime,
    /** `maskNameForKiosk`, mis. `Si•• Ra•••••••`. */
    nameMasked: z.string().min(1).max(160),
    /** `formatHariBulan`, mis. `14 Mar`. */
    birthDayMonth: z.string().regex(/^\d{1,2} [A-Z][a-z]{2}$/),
    /** Ada booking untuk hari ini (tujuan `booking`). */
    hasBookingToday: z.boolean(),
  }),
]);
export type KioskIdentifyResult = z.infer<typeof kioskIdentifyResultSchema>;

/** Check-in booking hari ini (task 1). Header `Idempotency-Key` wajib (sentuhan ganda tidak mencetak dua tiket). */
export const kioskCheckInSchema = z.strictObject({ lookupToken: kioskLookupTokenSchema });

/** Registrasi mandiri: BPJS (kontrol/rujukan aktif → SEP + antrean poli) atau umum (pilih sesi dokter). */
export const kioskRegisterSchema = z.discriminatedUnion('payer', [
  z.strictObject({ payer: z.literal('bpjs'), lookupToken: kioskLookupTokenSchema }),
  z.strictObject({ payer: z.literal('umum'), lookupToken: kioskLookupTokenSchema, sessionId: z.uuid() }),
]);
export type KioskRegisterInput = z.infer<typeof kioskRegisterSchema>;

/** Ambil tiket: loket pendaftaran (tanpa identitas), farmasi/kasir (setelah identifikasi). */
export const kioskTicketRequestSchema = z
  .strictObject({
    serviceKind: z.enum(['loket', 'farmasi', 'kasir']),
    lookupToken: kioskLookupTokenSchema.optional(),
  })
  .refine((v) => v.serviceKind === 'loket' || v.lookupToken !== undefined, {
    message: 'Antrean farmasi/kasir butuh identifikasi pasien',
    path: ['lookupToken'],
  });
export type KioskTicketRequest = z.infer<typeof kioskTicketRequestSchema>;

/** Tiket yang dicetak (HTML 80 mm, keputusan fase 2 no. 10); dipakai juga cetak tiket di loket. */
export const printableTicketSchema = z.strictObject({
  ticketId: z.uuid(),
  tenantName: z.string().min(1).max(160),
  queueNo: queueNoSchema,
  /** Tujuan, mis. `Loket pendaftaran`, `Poli Penyakit Dalam`. */
  destination: z.string().min(1).max(120),
  /** Lokasi, mis. `Lantai 1 · Loket 1–4`. */
  location: z.string().min(1).max(120),
  issuedAt: isoDateTime,
  estimatedWaitMinutes: z.number().int().min(0).nullable(),
  sepNo: z.string().regex(SEP_NO_PATTERN).nullable(),
  bookingCode: bookingCodeSchema.nullable(),
});
export type PrintableTicket = z.infer<typeof printableTicketSchema>;

/** Alasan anjungan mengarahkan pasien ke loket (`KIOSK_NEEDS_COUNTER`); anjungan sekaligus mencetak tiket loket. */
export const KIOSK_COUNTER_REASONS = [
  'peserta_tidak_aktif',
  'rujukan_tidak_berlaku',
  'kuota_penuh',
  'perlu_verifikasi_sidik_jari',
  'bpjs_tidak_tersedia',
  'bukan_hari_layanan',
  'data_belum_lengkap',
] as const;
export type KioskCounterReason = (typeof KIOSK_COUNTER_REASONS)[number];
export const kioskNeedsCounterDetailsSchema = z.strictObject({
  reason: z.enum(KIOSK_COUNTER_REASONS),
  ticket: printableTicketSchema.nullable(),
});

/** Sesi dokter hari ini untuk registrasi umum di anjungan (informasi publik, tanpa angka booking per pasien). */
export const kioskSessionOptionSchema = z.strictObject({
  sessionId: z.uuid(),
  poliName: z.string().min(1).max(160),
  practitionerName: z.string().min(1).max(160),
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  available: z.boolean(),
});
export type KioskSessionOption = z.infer<typeof kioskSessionOptionSchema>;

/** "Panggil petugas": notifikasi in-app ke petugas unit anjungan (tanpa PHI). */
export const kioskHelpResultSchema = z.strictObject({ requestedAt: isoDateTime });

/**
 * Nama tersamar untuk anjungan: tiap kata 2 huruf pertama + `•` sisanya; kata ≤ 2 huruf dan sapaan/gelar bertitik
 * (`Tn.`, `Ny.`, `dr.`) utuh. `Siti Rahmawati` → `Si•• Ra•••••••`. Cukup dikenali pemiliknya, tidak untuk orang lain.
 */
export function maskNameForKiosk(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 || w.endsWith('.') ? w : `${w.slice(0, 2)}${'•'.repeat(w.length - 2)}`))
    .join(' ');
}

/** Tanggal lahir tanpa tahun untuk konfirmasi di anjungan. */
export const kioskBirthDayMonth = formatHariBulan;
