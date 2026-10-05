import 'server-only';
import {
  type KioskIdentifyInput,
  type KioskIdentifyResult,
  kioskHelpResultSchema,
  kioskIdentifyResultSchema,
  type KioskTicketRequest,
  type PrintableTicket,
  printableTicketSchema,
  type RegistrationPatient,
  registrationPatientSchema,
} from '@simrs/shared';
import { headers } from 'next/headers';
import type { z } from 'zod';
import { clientInfo } from '../../../client-info';
import { DEFAULT_PATIENT_ID, registrationPatients } from '../../../demo/fixtures/front-office';
import { ApiError, callApi } from '../../api-core';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { deviceToken } from './antrean';

/**
 * F05 · Data anjungan mandiri. Mode presentasi: data dummy. Mode api: PERANGKAT anjungan terdaftar memanggil
 * `/api/v1/kiosk` dengan token perangkat dari cookie httpOnly (ADR-0027); browser anjungan tidak pernah memegangnya.
 */

/** Pasien anjungan di luar skenario (Ny. Siti Rahmawati). */
export async function getKioskDefaultPatient(): Promise<RegistrationPatient> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const p = registrationPatients().find((x) => x.id === DEFAULT_PATIENT_ID);
    if (!p) throw new Error('Pasien bawaan anjungan tidak ada di fixture');
    return registrationPatientSchema.parse(p);
  }
  return notImplemented('anjungan');
}

async function kioskCall<S extends z.ZodType>(
  path: string,
  call: { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string; schema: S },
): Promise<z.infer<S>> {
  const env = webEnv();
  return callApi(env.apiBaseUrl, `/api/v1/kiosk${path}`, {
    ...call,
    accessToken: await deviceToken(),
    client: clientInfo(await headers()),
  });
}

/** Identifikasi: nama tersamar + tanggal lahir tanpa tahun + token sekali pakai, atau `{found:false}`. */
export function kioskIdentify(input: KioskIdentifyInput): Promise<KioskIdentifyResult> {
  return kioskCall('/identify', { method: 'POST', body: input, schema: kioskIdentifyResultSchema });
}

/** Check-in booking hari ini → tiket loket pendaftaran. */
export function kioskCheckIn(lookupToken: string, idempotencyKey: string): Promise<PrintableTicket> {
  return kioskCall('/check-in', {
    method: 'POST',
    body: { lookupToken },
    idempotencyKey,
    schema: printableTicketSchema,
  });
}

/** Tiket loket (tanpa identitas) atau farmasi/kasir (dengan token identifikasi). */
export function kioskTicket(input: KioskTicketRequest, idempotencyKey: string): Promise<PrintableTicket> {
  return kioskCall('/tickets', {
    method: 'POST',
    body: input,
    idempotencyKey,
    schema: printableTicketSchema,
  });
}

/** "Panggil petugas" (notifikasi tanpa PHI ke petugas pendaftaran). */
export function kioskAssist(): Promise<z.infer<typeof kioskHelpResultSchema>> {
  return kioskCall('/assist', { method: 'POST', body: {}, schema: kioskHelpResultSchema });
}

/** HTML tiket 80 mm dari API (hanya tiket yang diterbitkan perangkat ini hari ini). */
export async function kioskTicketHtml(ticketId: string): Promise<string> {
  const env = webEnv();
  const token = await deviceToken();
  const client = clientInfo(await headers());
  const h = new Headers({ accept: 'text/html' });
  if (token) h.set('authorization', `Bearer ${token}`);
  if (client.ip) h.set('x-forwarded-for', client.ip);
  if (client.host) h.set('x-forwarded-host', client.host);
  if (client.userAgent) h.set('user-agent', client.userAgent);
  let res: Response;
  try {
    res = await fetch(
      new URL(`/api/v1/kiosk/tickets/${encodeURIComponent(ticketId)}/print`, env.apiBaseUrl),
      { headers: h, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Printer tiket tidak dapat dihubungi.');
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('text/html')) {
    await res.body?.cancel();
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Tiket tidak dapat dicetak.');
  }
  return res.text();
}
