import type { BrowserContext } from '@playwright/test';
import { type Booking, isoDateJakarta, newId } from '@simrs/shared';
import { inTenant, TENANTS } from './accounts';
import { E2E_API_PORT, E2E_MOCK_URL } from './slot';

/**
 * Helper E2E front office fase 2 (rantai DoD potongan 9): sesi praktik yang cocok dengan HFIS mock, booking JKN lewat
 * API dengan sesi petugas yang sedang login, SEP/task di DB, dan API panel BPJS mock (antrean + task, gangguan per
 * peserta). Data fiktif (NIK 9999…, kartu 0000…).
 */

const API_URL = `http://127.0.0.1:${E2E_API_PORT}`;

/**
 * Jadwal HFIS mock dokter poli PD (apps/mock `MOCK_HFIS_TEMPLAT`) per hari (0 = Minggu): Antrean BPJS menolak booking
 * yang jam praktiknya tidak ada di HFIS, jadi alur task ID memakai sesi yang sama persis.
 */
const PD_HFIS: Record<number, { doctor: string; start: string; end: string } | undefined> = {
  1: { doctor: 'dr. Andini Prameswari, Sp.PD', start: '08:00', end: '12:00' },
  2: { doctor: 'dr. Andini Prameswari, Sp.PD', start: '08:00', end: '12:00' },
  3: { doctor: 'dr. Andini Prameswari, Sp.PD', start: '08:00', end: '12:00' },
  4: { doctor: 'dr. Andini Prameswari, Sp.PD', start: '08:00', end: '12:00' },
  5: { doctor: 'dr. Rahmat Hidayat, Sp.PD', start: '13:00', end: '16:00' },
  6: { doctor: 'dr. Andini Prameswari, Sp.PD', start: '08:00', end: '11:00' },
};

/**
 * Sesi praktik poli PD HARI INI yang sama dengan jadwal HFIS mock (dipakai ulang bila sudah dibangkitkan dari templat),
 * kuota dilonggarkan. Null pada hari Minggu (tidak ada praktik PD di HFIS mock).
 */
export async function hfisSession(): Promise<{ id: string; label: RegExp } | null> {
  const today = isoDateJakarta(new Date());
  const h = PD_HFIS[new Date(`${today}T00:00:00.000Z`).getUTCDay()];
  if (!h) return null;
  const startTime = new Date(`1970-01-01T${h.start}:00.000Z`);
  const id = await inTenant(TENANTS.RSFA, async (tx) => {
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
    const practitioner = await tx.practitioner.findFirstOrThrow({ where: { name: h.doctor } });
    const where = {
      practitionerId: practitioner.id,
      sessionDate: new Date(`${today}T00:00:00.000Z`),
      startTime,
    };
    const found = await tx.scheduleSession.findFirst({
      where,
      select: { id: true, bookedJkn: true, bookedNonJkn: true },
    });
    if (found) {
      await tx.scheduleSession.update({
        where: { id: found.id },
        data: { kind: 'praktik', quotaJkn: found.bookedJkn + 50, quotaNonJkn: found.bookedNonJkn + 50 },
      });
      return found.id;
    }
    const created = await tx.scheduleSession.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        ...where,
        serviceId: service.id,
        endTime: new Date(`1970-01-01T${h.end}:00.000Z`),
        quotaJkn: 50,
        quotaNonJkn: 50,
      },
    });
    return created.id;
  });
  const esc = h.doctor.replace(/[.]/g, '\\.');
  return {
    id,
    label: new RegExp(`${esc}\\s*${h.start.replace(':', '\\.')}–${h.end.replace(':', '\\.')}`),
  };
}

/** SEP terbaru kunjungan (status + nomor). */
export function sepOf(encounterId: string) {
  return inTenant(TENANTS.RSFA, (tx) =>
    tx.sep.findFirst({
      where: { encounterId },
      orderBy: { version: 'desc' },
      select: { id: true, status: true, sepNo: true },
    }),
  );
}

/** Percobaan kirim `bpjs.vclaim.sep.insert` untuk SEP ini (0 = worker belum mencoba). */
export function sepInsertAttempts(sepId: string) {
  return inTenant(TENANTS.RSFA, async (tx) => {
    const m = await tx.outboxMessage.findFirst({
      where: { operation: 'bpjs.vclaim.sep.insert', idempotencyKey: { contains: sepId } },
      select: { attempts: true },
    });
    return m?.attempts ?? 0;
  });
}

/** Status kirim task ID 1–3 booking di DB (`bpjs_queue_tasks`), urut task. */
export function bpjsTaskStatuses(appointmentId: string) {
  return inTenant(TENANTS.RSFA, (tx) =>
    tx.bpjsQueueTask.findMany({
      where: { appointmentId },
      orderBy: { taskId: 'asc' },
      select: { taskId: true, status: true },
    }),
  );
}

/**
 * Booking JKN hari ini lewat API (`POST /booking/appointments`) memakai token akses petugas yang sedang login di
 * konteks browser itu (cookie httpOnly `simrs_at`, hanya dibaca Playwright): kuota, nomor poli cadangan, dan outbox
 * `bpjs.antrean.add` berjalan seperti booking sungguhan. Tidak ada layar booking staf di fase 2.
 */
export async function createJknBooking(
  staff: BrowserContext,
  input: { patientId: string; sessionId: string; referenceNumber: string },
): Promise<Booking> {
  const token = (await staff.cookies()).find((c) => c.name.endsWith('simrs_at'))?.value;
  if (!token) throw new Error('Petugas belum login di konteks ini (cookie simrs_at tidak ada)');
  const res = await fetch(`${API_URL}/api/v1/booking/appointments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      patientId: input.patientId,
      sessionId: input.sessionId,
      quotaBucket: 'jkn',
      jkn: { visitKind: 'rujukan_fktp', referenceNumber: input.referenceNumber },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status !== 201) throw new Error(`Booking gagal: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as Booking;
}

/** Nomor rujukan FKTP aktif mock milik kartu (`<PPK FKTP><9 digit akhir kartu><urut>`). */
export const rujukanNo = (card: string, urut = '01') => `9999P001${card.slice(-9)}${urut}`;

/** Antrean BPJS di mock (null bila belum diterima): task yang diterima urut kedatangan. */
export async function mockAntrean(
  kodebooking: string,
): Promise<{ status: string; nomorantrean: string; tasks: Array<{ taskid: number }> } | null> {
  const res = await fetch(`${E2E_MOCK_URL}/_panel/api/bpjs/antrean/${kodebooking}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Panel BPJS mock: HTTP ${res.status}`);
  return (await res.json()) as { status: string; nomorantrean: string; tasks: Array<{ taskid: number }> };
}

/** SEP di mock BPJS (null bila tidak ada). */
export async function mockSep(noSep: string): Promise<{ status: string; noKartu: string } | null> {
  const res = await fetch(`${E2E_MOCK_URL}/_panel/api/bpjs/sep/${noSep}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Panel BPJS mock: HTTP ${res.status}`);
  return (await res.json()) as { status: string; noKartu: string };
}

/**
 * Gangguan BPJS mock HANYA untuk peserta ini (permintaan yang menyebut kartunya → 503). Sistem `bpjs` tetap normal
 * bagi tes lain yang berjalan paralel; dibersihkan juga oleh reset panel.
 */
export async function setBpjsOutage(noKartu: string, aktif: boolean): Promise<void> {
  const res = await fetch(`${E2E_MOCK_URL}/_panel/api/bpjs/outage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ noKartu, aktif }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Panel BPJS mock outage: HTTP ${res.status} ${await res.text()}`);
}
