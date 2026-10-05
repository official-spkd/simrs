'use server';

import {
  KIOSK_COUNTER_REASONS,
  type KioskCounterReason,
  type KioskIdentifyResult,
  kioskIdentifySchema,
  kioskLookupTokenSchema,
  kioskRegisterSchema,
  type KioskSessionOption,
  kioskTicketRequestSchema,
  type PrintableTicket,
} from '@simrs/shared';
import { z } from 'zod';
import { ApiError } from '@/lib/server/api-core';
import {
  kioskAssist,
  kioskCheckIn,
  kioskIdentify,
  kioskRegister,
  kioskSessions,
  kioskTicket,
  kioskTicketHtml,
} from '@/lib/server/data/front-office/kiosk';
import { getDevice } from '@/lib/server/device';
import { webEnv } from '@/lib/server/web-env';

/**
 * F05 · Server Action anjungan mode api (fase 2 potongan 6). Pemanggilnya PERANGKAT anjungan (cookie perangkat
 * httpOnly, ADR-0027), bukan sesi staf; izin `kiosk.use`, batas laju, dan token sekali pakai ditegakkan API.
 * Jawaban hanya berisi yang boleh tampil di layar umum (nama tersamar, nomor tiket), tanpa ID pasien.
 */

export type KioskFailure = {
  ok: false;
  /** Kode galat API (mis. `KIOSK_LOOKUP_EXPIRED`, `KIOSK_NEEDS_COUNTER`, `RATE_LIMITED`). */
  code: string;
  message: string;
  /** Alasan ke loket (`KIOSK_NEEDS_COUNTER`). */
  reason?: KioskCounterReason;
};
export type KioskResult<T> = ({ ok: true } & T) | KioskFailure;

const idempotencyKey = z.uuid();

async function asKiosk(): Promise<KioskFailure | null> {
  if (webEnv().dataSource !== 'api') {
    return { ok: false, code: 'FORBIDDEN', message: 'Anjungan mode presentasi tidak memanggil API.' };
  }
  const device = await getDevice();
  if (!device || device.kind !== 'kiosk') {
    return {
      ok: false,
      code: 'DEVICE_NOT_ALLOWED',
      message: 'Perangkat ini belum terdaftar sebagai anjungan. Hubungi petugas.',
    };
  }
  return null;
}

function failure(err: unknown): KioskFailure {
  if (err instanceof ApiError) {
    const details = z.object({ reason: z.enum(KIOSK_COUNTER_REASONS) }).safeParse(err.details);
    return {
      ok: false,
      code: err.code,
      message: err.message,
      ...(details.success ? { reason: details.data.reason } : {}),
    };
  }
  return { ok: false, code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan. Silakan minta bantuan petugas.' };
}

const invalid = (message: string): KioskFailure => ({ ok: false, code: 'VALIDATION_FAILED', message });

/** Cari data pasien dari NIK / kartu BPJS / kode booking yang diketik di keypad. */
export async function identifyAction(input: unknown): Promise<KioskResult<{ result: KioskIdentifyResult }>> {
  const denied = await asKiosk();
  if (denied) return denied;
  const p = kioskIdentifySchema.safeParse(input);
  if (!p.success) return invalid('Nomor atau tanggal lahir belum sesuai. Periksa kembali.');
  try {
    return { ok: true, result: await kioskIdentify(p.data) };
  } catch (err) {
    return failure(err);
  }
}

/** Check-in booking hari ini (setelah pasien membenarkan datanya). */
export async function checkInAction(input: unknown): Promise<KioskResult<{ ticket: PrintableTicket }>> {
  const denied = await asKiosk();
  if (denied) return denied;
  const p = z.strictObject({ lookupToken: kioskLookupTokenSchema, idempotencyKey }).safeParse(input);
  if (!p.success) return invalid('Sesi anjungan tidak dikenali. Ulangi dari awal.');
  try {
    return { ok: true, ticket: await kioskCheckIn(p.data.lookupToken, p.data.idempotencyKey) };
  } catch (err) {
    return failure(err);
  }
}

/** Ambil nomor antrean loket / farmasi / kasir. */
export async function ticketAction(input: unknown): Promise<KioskResult<{ ticket: PrintableTicket }>> {
  const denied = await asKiosk();
  if (denied) return denied;
  const p = z.strictObject({ request: kioskTicketRequestSchema, idempotencyKey }).safeParse(input);
  if (!p.success) return invalid('Pilihan antrean tidak dikenali. Ulangi dari awal.');
  try {
    return { ok: true, ticket: await kioskTicket(p.data.request, p.data.idempotencyKey) };
  } catch (err) {
    return failure(err);
  }
}

/** Sesi dokter hari ini (pasien umum memilih dokter). */
export async function sessionsAction(): Promise<KioskResult<{ sessions: KioskSessionOption[] }>> {
  const denied = await asKiosk();
  if (denied) return denied;
  try {
    return { ok: true, sessions: await kioskSessions() };
  } catch (err) {
    return failure(err);
  }
}

/** Registrasi mandiri rawat jalan (BPJS dengan booking kontrol/rujukan, atau umum dengan sesi pilihan). */
export async function registerAction(input: unknown): Promise<KioskResult<{ ticket: PrintableTicket }>> {
  const denied = await asKiosk();
  if (denied) return denied;
  const p = z.strictObject({ request: kioskRegisterSchema, idempotencyKey }).safeParse(input);
  if (!p.success) return invalid('Pilihan pendaftaran tidak dikenali. Ulangi dari awal.');
  try {
    return { ok: true, ticket: await kioskRegister(p.data.request, p.data.idempotencyKey) };
  } catch (err) {
    return failure(err);
  }
}

/** HTML tiket 80 mm untuk dicetak (iframe `srcdoc`, tanpa skrip). */
export async function ticketHtmlAction(input: unknown): Promise<KioskResult<{ html: string }>> {
  const denied = await asKiosk();
  if (denied) return denied;
  const p = z.strictObject({ ticketId: z.uuid() }).safeParse(input);
  if (!p.success) return invalid('Tiket tidak dikenali.');
  try {
    return { ok: true, html: await kioskTicketHtml(p.data.ticketId) };
  } catch (err) {
    return failure(err);
  }
}

/** "Panggil petugas": petugas pendaftaran mendapat notifikasi (tanpa data pasien). */
export async function assistAction(): Promise<KioskResult<{ requestedAt: string }>> {
  const denied = await asKiosk();
  if (denied) return denied;
  try {
    return { ok: true, ...(await kioskAssist()) };
  } catch (err) {
    return failure(err);
  }
}
