'use server';

import {
  bpjsParticipantLookupSchema,
  bpjsRejectedDetailsSchema,
  callResultSchema,
  counterLabelSchema,
  createPatientSchema,
  type DukcapilLookupResult,
  dukcapilLookupResultSchema,
  dukcapilLookupSchema,
  type EligibilityResult,
  eligibilityResultSchema,
  idempotencyKeySchema,
  outpatientRegistrationSchema,
  type PatientContact,
  patientContactSchema,
  type Referral,
  referralLookupResultSchema,
  registrationResultSchema,
  sepSchema,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  activeGeneralConsent,
  type ConsentView,
  consentViewSchema,
  patientDetailSchema,
  type PatientDetailView,
  patientSearchResultSchema,
  type PatientSummaryView,
} from '@/lib/registration-api';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * F03/F06 · Server Action layar Pendaftaran mode api (fase 2 potongan 5b). Satu-satunya jalan klien ke API (BFF): sesi
 * + izin diperiksa di sini agar pesannya jelas, lalu ditegakkan ulang API (izin, ABAC, kuota, Idempotency-Key). Data
 * pribadi (NIK, no. kartu) hanya di body permintaan, tidak pernah di URL; pencarian dan pembukaan pasien diaudit API.
 * Tidak ada `revalidatePath`: halaman hasil registrasi memuat datanya sendiri dari URL `?kunjungan=`.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

type Need =
  'encounter.write' | 'patient.read' | 'patient.write' | 'coverage.read' | 'coverage.write' | 'queue.call';

const DENIED: Record<Need, string> = {
  'encounter.write': 'Peran Anda tidak berizin mendaftarkan kunjungan.',
  'patient.read': 'Peran Anda tidak berizin membuka data pasien.',
  'patient.write': 'Peran Anda tidak berizin mendaftarkan pasien baru.',
  'coverage.read': 'Peran Anda tidak berizin memeriksa kepesertaan BPJS.',
  'coverage.write': 'Peran Anda tidak berizin mengirim ulang SEP.',
  'queue.call': 'Peran Anda tidak berizin memanggil antrean loket.',
};

async function authorize(need: Need): Promise<{ ok: false; message: string } | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const [resource, action] = need.split('.') as [string, string];
  return can(s, resource, action) ? null : { ok: false, message: DENIED[need] };
}

function failure(err: unknown): { ok: false; message: string; code?: string } {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    if (err.code === 'BPJS_REJECTED') {
      const d = bpjsRejectedDetailsSchema.safeParse(err.details);
      return {
        ok: false,
        code: err.code,
        message: d.success ? `Ditolak BPJS: ${d.data.bpjsMessage}` : err.message,
      };
    }
    return { ok: false, code: err.code, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const uuid = z.uuid();

// ---------------------------------------------------------------------------------------------------------------
// Pasien (MPI)
// ---------------------------------------------------------------------------------------------------------------

const searchInput = z.strictObject({
  q: z.string().trim().min(3, 'Masukkan minimal 3 karakter: NIK, No. RM, No. BPJS, atau nama.').max(100),
  birthDate: z.iso.date().optional(),
});

/** Cari pasien (RM, NIK, no. BPJS, IHS, atau nama + tanggal lahir opsional). Hasil tersamar, diaudit API. */
export async function searchPatientsAction(input: unknown): Promise<ActionResult<PatientSummaryView[]>> {
  const denied = await authorize('patient.read');
  if (denied) return denied;
  const p = searchInput.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Isian cari tidak dikenali.' };
  const qs = new URLSearchParams({ q: p.data.q, limit: '10' });
  if (p.data.birthDate) qs.set('birthDate', p.data.birthDate);
  try {
    const r = await api(`/api/v1/patients?${qs.toString()}`, { schema: patientSearchResultSchema });
    return { ok: true, data: r.items };
  } catch (err) {
    return failure(err);
  }
}

export interface OpenedPatient {
  patient: PatientDetailView;
  contacts: PatientContact[];
  consent: ConsentView | null;
}

/** Buka satu pasien untuk didaftarkan: identitas tersamar, penanggung jawab, persetujuan umum aktif. */
export async function openPatientAction(patientId: unknown): Promise<ActionResult<OpenedPatient>> {
  const denied = await authorize('patient.read');
  if (denied) return denied;
  const id = uuid.safeParse(patientId);
  if (!id.success) return { ok: false, message: 'Pasien tidak dikenali.' };
  try {
    const patient = await api(`/api/v1/patients/${id.data}`, { schema: patientDetailSchema });
    const [contacts, consents] = await Promise.all([
      api(`/api/v1/patients/${id.data}/contacts`, { schema: z.array(patientContactSchema) }),
      api(`/api/v1/patients/${id.data}/consents`, { schema: z.array(consentViewSchema) }),
    ]);
    return {
      ok: true,
      data: { patient, contacts: contacts.filter((c) => c.active), consent: activeGeneralConsent(consents) },
    };
  } catch (err) {
    return failure(err);
  }
}

/** Isian otomatis pasien baru dari Dukcapil (NIK di body; tidak disimpan sebelum petugas menyimpan pasien). */
export async function dukcapilLookupAction(input: unknown): Promise<ActionResult<DukcapilLookupResult>> {
  const denied = await authorize('patient.write');
  if (denied) return denied;
  const p = dukcapilLookupSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'NIK 16 digit.' };
  try {
    const r = await api('/api/v1/registration/dukcapil-lookup', {
      method: 'POST',
      body: p.data,
      schema: dukcapilLookupResultSchema,
    });
    return { ok: true, data: r };
  } catch (err) {
    return failure(err);
  }
}

const duplicateInput = z.strictObject({
  nik: z
    .string()
    .regex(/^\d{16}$/)
    .optional(),
  bpjs: z
    .string()
    .regex(/^\d{13}$/)
    .optional(),
  name: z.string().trim().min(3).max(120),
  birthDate: z.iso.date(),
});

/**
 * Cek duplikat sebelum pasien baru disimpan: pasien dengan NIK atau no. BPJS sama, atau nama mirip dengan tanggal
 * lahir sama. Petugas memilih pasien yang ada atau menyatakan tetap membuat pasien baru (detektor MPI tetap berjalan
 * setelah disimpan).
 */
export async function findDuplicatesAction(input: unknown): Promise<ActionResult<PatientSummaryView[]>> {
  const denied = await authorize('patient.read');
  if (denied) return denied;
  const p = duplicateInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Lengkapi NIK, nama, dan tanggal lahir.' };
  const queries: URLSearchParams[] = [];
  if (p.data.nik) queries.push(new URLSearchParams({ q: p.data.nik, limit: '5' }));
  if (p.data.bpjs) queries.push(new URLSearchParams({ q: p.data.bpjs, limit: '5' }));
  queries.push(new URLSearchParams({ q: p.data.name, birthDate: p.data.birthDate, limit: '5' }));
  try {
    const found = new Map<string, PatientSummaryView>();
    for (const qs of queries) {
      const r = await api(`/api/v1/patients?${qs.toString()}`, { schema: patientSearchResultSchema });
      for (const item of r.items) if (item.status === 'active') found.set(item.id, item);
    }
    return { ok: true, data: [...found.values()] };
  } catch (err) {
    return failure(err);
  }
}

/** Simpan pasien baru di MPI (nomor RM dari layanan penomoran; NIK diverifikasi ke Dukcapil lewat outbox). */
export async function createPatientAction(
  input: unknown,
): Promise<ActionResult<{ id: string; mrn: string }>> {
  const denied = await authorize('patient.write');
  if (denied) return denied;
  const p = createPatientSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Data pasien belum lengkap.' };
  try {
    const r = await api('/api/v1/patients', { method: 'POST', body: p.data, schema: patientDetailSchema });
    return { ok: true, data: { id: r.id, mrn: r.mrn } };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Penjaminan BPJS (lookup sinkron, ADR-0025)
// ---------------------------------------------------------------------------------------------------------------

const eligibilityInput = z.strictObject({ patientId: z.uuid(), participant: bpjsParticipantLookupSchema });

/** Cek kepesertaan JKN (no. kartu/NIK di body, audit dikaitkan ke pasien). */
export async function checkEligibilityAction(input: unknown): Promise<ActionResult<EligibilityResult>> {
  const denied = await authorize('coverage.read');
  if (denied) return denied;
  const p = eligibilityInput.safeParse(input);
  if (!p.success) {
    return { ok: false, message: 'Masukkan no. kartu BPJS (13 digit) atau NIK (16 digit) pasien.' };
  }
  try {
    const r = await api(`/api/v1/sep/eligibility-checks?patientId=${p.data.patientId}`, {
      method: 'POST',
      body: p.data.participant,
      schema: eligibilityResultSchema,
    });
    return { ok: true, data: r };
  } catch (err) {
    return failure(err);
  }
}

/** Rujukan FKTP (VClaim, per no. kartu pasien dibaca server) + surat kontrol RS yang aktif. */
export async function loadReferralsAction(patientId: unknown): Promise<ActionResult<Referral[]>> {
  const denied = await authorize('coverage.read');
  if (denied) return denied;
  const id = uuid.safeParse(patientId);
  if (!id.success) return { ok: false, message: 'Pasien tidak dikenali.' };
  try {
    const r = await api(`/api/v1/sep/referrals?patientId=${id.data}`, { schema: referralLookupResultSchema });
    return { ok: true, data: r.referrals };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Registrasi, SEP, loket
// ---------------------------------------------------------------------------------------------------------------

const registerInput = z.strictObject({
  key: idempotencyKeySchema,
  registration: outpatientRegistrationSchema,
});

/**
 * Daftarkan kunjungan rawat jalan. `key` = Idempotency-Key dari klien (sama untuk isi yang sama, jadi kirim ulang
 * setelah jaringan putus tidak membuat kunjungan kedua). SEP BPJS dibuat `pending` dan dikirim worker: gangguan BPJS
 * tidak menggagalkan pendaftaran.
 */
export async function registerOutpatientAction(
  input: unknown,
): Promise<ActionResult<{ encounterId: string }>> {
  const denied = await authorize('encounter.write');
  if (denied) return denied;
  const p = registerInput.safeParse(input);
  if (!p.success)
    return { ok: false, message: p.error.issues[0]?.message ?? 'Data pendaftaran belum lengkap.' };
  try {
    const r = await api('/api/v1/registration/outpatient', {
      method: 'POST',
      body: p.data.registration,
      idempotencyKey: p.data.key,
      schema: registrationResultSchema,
      timeoutMs: 20_000,
    });
    return { ok: true, data: { encounterId: r.encounter.id } };
  } catch (err) {
    return failure(err);
  }
}

/** Kirim ulang SEP yang ditolak BPJS / gagal permanen (DLQ): kembali `pending` dengan pesan outbox baru. */
export async function retrySepAction(sepId: unknown): Promise<ActionResult<{ status: string }>> {
  const denied = await authorize('coverage.write');
  if (denied) return denied;
  const id = uuid.safeParse(sepId);
  if (!id.success) return { ok: false, message: 'SEP tidak dikenali.' };
  try {
    const r = await api(`/api/v1/sep/${id.data}/retry`, { method: 'POST', body: {}, schema: sepSchema });
    return { ok: true, data: { status: r.status } };
  } catch (err) {
    return failure(err);
  }
}

const callNextInput = z.strictObject({ serviceId: z.uuid(), counter: counterLabelSchema });

export interface CalledTicket {
  ticketId: string;
  queueNo: string;
  patientId: string | null;
}

/** Panggil nomor loket berikutnya ke loket ini (tampil di TV; task 2 dari panggilan pertama). */
export async function callNextCounterAction(input: unknown): Promise<ActionResult<CalledTicket>> {
  const denied = await authorize('queue.call');
  if (denied) return denied;
  const p = callNextInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Pilih loket pemanggil.' };
  try {
    const r = await api(`/api/v1/queue/services/${p.data.serviceId}/call-next`, {
      method: 'POST',
      body: { counter: p.data.counter },
      schema: callResultSchema,
    });
    return {
      ok: true,
      data: { ticketId: r.ticket.id, queueNo: r.ticket.queueNo, patientId: r.ticket.patientId },
    };
  } catch (err) {
    return failure(err);
  }
}
