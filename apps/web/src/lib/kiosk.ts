import {
  formatJam,
  KIOSK_PURPOSE_LABEL,
  KIOSK_PURPOSES,
  type KioskCounterReason,
  type KioskIdentifyResult,
  type KioskPurpose,
  type PrintableTicket,
} from '@simrs/shared';

/**
 * F05 · Logika layar anjungan mode api (fase 2 potongan 6), murni agar bisa diuji: tindakan sesudah identifikasi,
 * tampilan tiket dari `PrintableTicket`, dan pesan galat API untuk layar umum (tanpa data pasien).
 */

/** Tujuan kontrak dari judul pilihan layar awal (`PURPOSES` di `kiosk-screens.tsx` = `KIOSK_PURPOSE_LABEL`). */
export function kioskPurposeOf(title: string): KioskPurpose {
  return KIOSK_PURPOSES.find((p) => KIOSK_PURPOSE_LABEL[p] === title) ?? 'booking';
}

export type KioskFound = Extract<KioskIdentifyResult, { found: true }>;

/**
 * Tindakan sesudah pasien membenarkan datanya:
 * - farmasi/kasir (setelah pemeriksaan) → pilih antrean farmasi atau kasir;
 * - ada booking hari ini → check-in (tiket loket, task 1; sudah check-in → tiket loketnya dicetak ulang);
 * - selain itu (BPJS/umum tanpa booking) → nomor antrean loket pendaftaran. Registrasi mandiri dari anjungan
 *   (SEP/pilih dokter) menyusul setelah potongan 5a; titik perluasannya di sini.
 */
export type KioskNextStep = 'check-in' | 'farmasi-kasir' | 'loket';

export function kioskNextStep(
  purpose: KioskPurpose,
  found: Pick<KioskFound, 'hasBookingToday'>,
): KioskNextStep {
  if (purpose === 'farmasi_kasir') return 'farmasi-kasir';
  if (found.hasBookingToday) return 'check-in';
  return 'loket';
}

/** Tiket untuk layar anjungan (komponen `KioskTicket`). Perkiraan = jam ambil + menit tunggu. */
export function kioskTicketView(t: PrintableTicket): {
  no: string;
  tujuan: string;
  lokasi: string;
  sep: string | null;
  note: string | null;
} {
  const eta =
    t.estimatedWaitMinutes === null
      ? null
      : formatJam(new Date(Date.parse(t.issuedAt) + t.estimatedWaitMinutes * 60_000));
  return {
    no: t.queueNo,
    tujuan: t.destination,
    lokasi: eta ? `${t.location} · perkiraan dipanggil ${eta}` : t.location,
    sep: t.sepNo,
    note: t.bookingCode
      ? `Check-in booking ${t.bookingCode} berhasil. SEP dan nomor antrean poli diterbitkan petugas loket.`
      : null,
  };
}

/** Pesan ke loket per alasan API (`KIOSK_NEEDS_COUNTER`). */
const COUNTER_REASON: Record<KioskCounterReason, string> = {
  peserta_tidak_aktif: 'Kepesertaan BPJS Anda perlu diperiksa petugas.',
  rujukan_tidak_berlaku: 'Rujukan Anda perlu diperiksa petugas.',
  kuota_penuh: 'Kuota dokter hari ini penuh. Petugas akan membantu memilih jadwal.',
  perlu_verifikasi_sidik_jari: 'Verifikasi sidik jari dilakukan di loket.',
  bpjs_tidak_tersedia: 'Layanan BPJS sedang tidak tersedia. Petugas akan membantu.',
  bukan_hari_layanan: 'Tidak ada booking untuk hari ini.',
  data_belum_lengkap: 'Data Anda perlu dilengkapi petugas.',
};

export type KioskFailureAction = 'restart' | 'loket' | 'retry';

/**
 * Layar sesudah galat API: sesi berakhir → kembali ke awal; perlu ke loket → tawarkan nomor loket; selain itu (batas
 * laju, API tidak terjangkau) → tetap di layar dengan pesan.
 */
export function kioskFailure(code: string, reason?: KioskCounterReason, message?: string) {
  if (code === 'KIOSK_LOOKUP_EXPIRED') {
    return {
      action: 'restart' as KioskFailureAction,
      message: 'Sesi anjungan berakhir. Silakan ulangi dari awal.',
    };
  }
  if (code === 'KIOSK_NEEDS_COUNTER') {
    return {
      action: 'loket' as KioskFailureAction,
      message: `${reason ? COUNTER_REASON[reason] : 'Petugas loket akan membantu Anda.'} Silakan ambil nomor antrean loket pendaftaran.`,
    };
  }
  if (code === 'RATE_LIMITED') {
    return {
      action: 'retry' as KioskFailureAction,
      message: 'Terlalu banyak pencarian di anjungan ini. Tunggu sebentar atau sentuh Panggil petugas.',
    };
  }
  return {
    action: 'retry' as KioskFailureAction,
    message: message ?? 'Terjadi kesalahan. Silakan minta bantuan petugas.',
  };
}

/** Kunci idempotensi baru untuk satu tindakan anjungan (sentuhan ganda/ulang kirim → hasil yang sama). */
export function newKioskKey(): string {
  return `anjungan-${crypto.randomUUID()}`;
}
