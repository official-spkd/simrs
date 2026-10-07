'use server';

import {
  callResultSchema,
  conditionRecordSchema,
  cpptRecordSchema,
  dischargeSummaryViewSchema,
  encounterCloseResultSchema,
  formatJam,
  poliSoapDraftSchema,
  poliVisitSchema,
  vitalSignsRecordSchema,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { PoliActionResult, PoliSoapInput, PoliVitalsFormInput } from '@/components/klinis/poli-ops';
import { icd10Display } from '@/lib/klinis';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * K01/K02 · Server Action layar Pemeriksaan poli mode api (W1). Satu-satunya jalan klien ke API (BFF): sesi + izin
 * diperiksa di sini agar pesannya jelas, lalu ditegakkan ulang API (izin, ABAC, lingkup unit, CDS, kunci TTE).
 * Penulis entri selalu dari sesi API; tidak ada data pasien di URL.
 */

const uuid = z.uuid();
const ok = (message: string, extra: Partial<PoliActionResult> = {}): PoliActionResult => ({
  ok: true,
  at: formatJam(new Date()),
  message,
  ...extra,
});
const fail = (error: string, field?: string): PoliActionResult => ({ ok: false, error, field });

async function staff(perm: [string, string]): Promise<string | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, perm[0], perm[1]) ? null : 'Peran Anda tidak berizin untuk aksi ini.';
}

/** Pesan galat API untuk pengguna (pesan API sudah berbahasa Indonesia; detail butir resume ikut ditampilkan). */
function apiFail(err: unknown, prefix = ''): PoliActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return fail(`${prefix}${err.message}`);
  }
  throw err;
}

// ------------------------------------------------------------------------------------------------------------
// Antrean
// ------------------------------------------------------------------------------------------------------------

/** Panggil berikutnya di layanan poli (FIFO; nomor cadangan booking dilewati). */
export async function callNextPoliAction(serviceId: unknown, room: unknown): Promise<PoliActionResult> {
  const denied = await staff(['queue', 'call']);
  if (denied) return fail(denied);
  const sid = uuid.safeParse(serviceId);
  const counter = z.string().trim().min(1).max(40).safeParse(room);
  if (!sid.success || !counter.success) return fail('Layanan poli tidak dikenal.');
  try {
    const r = await api(`/api/v1/queue/services/${sid.data}/call-next`, {
      method: 'POST',
      body: { counter: counter.data },
      schema: callResultSchema,
    });
    return ok(`${r.ticket.queueNo} dipanggil · tampil di layar antrean`, {
      patientId: r.ticket.patientId ?? undefined,
    });
  } catch (err) {
    return apiFail(err);
  }
}

/** Panggil (atau panggil ulang) tiket pasien terpilih, atau mulai periksa (task 4). */
export async function ticketActionPoli(
  ticketId: unknown,
  action: unknown,
  room: unknown,
): Promise<PoliActionResult> {
  const denied = await staff(['queue', 'call']);
  if (denied) return fail(denied);
  const id = uuid.safeParse(ticketId);
  const act = z.enum(['call', 'start']).safeParse(action);
  const counter = z.string().trim().min(1).max(40).safeParse(room);
  if (!id.success || !act.success || !counter.success) return fail('Tiket antrean tidak dikenal.');
  try {
    const r = await api(`/api/v1/queue/tickets/${id.data}/${act.data}`, {
      method: 'POST',
      body: act.data === 'call' ? { counter: counter.data } : {},
      schema: callResultSchema,
    });
    return ok(
      act.data === 'call'
        ? `${r.ticket.queueNo} dipanggil ke ${counter.data}`
        : `Pemeriksaan ${r.ticket.queueNo} dimulai`,
    );
  } catch (err) {
    return apiFail(err);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Tanda vital
// ------------------------------------------------------------------------------------------------------------

const vitalsForm = z.strictObject({
  encounterId: uuid,
  td: z.string().regex(/^\d{2,3}\/\d{2,3}$/, 'Isi dengan format sistolik/diastolik, mis. 120/80.'),
  nadi: z.coerce
    .number({ error: 'Nadi 20–250 x/mnt.' })
    .int()
    .min(20, 'Nadi 20–250 x/mnt.')
    .max(250, 'Nadi 20–250 x/mnt.'),
  suhu: z
    .string()
    .regex(/^\d{2}([.,]\d)?$/, 'Suhu dalam °C, mis. 36,8.')
    .transform((v) => Number(v.replace(',', '.')))
    .refine((n) => n >= 30 && n <= 43, 'Suhu 30–43 °C.'),
  spo2: z.coerce.number({ error: 'SpO2 50–100%.' }).int().min(50, 'SpO2 50–100%.').max(100, 'SpO2 50–100%.'),
  napas: z.coerce
    .number({ error: 'Napas 4–60 x/mnt.' })
    .int()
    .min(4, 'Napas 4–60 x/mnt.')
    .max(60, 'Napas 4–60 x/mnt.'),
  kesadaran: z.enum(['A', 'C', 'V', 'P', 'U'], { error: 'Pilih tingkat kesadaran (ACVPU).' }),
  oksigen: z.boolean(),
  berat: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v.replace(',', '.')) : null))
    .refine((n) => n === null || (Number.isFinite(n) && n > 0 && n <= 400), 'Berat badan 0–400 kg.'),
});

export async function recordVitalsApiAction(input: PoliVitalsFormInput): Promise<PoliActionResult> {
  const denied = await staff(['clinical', 'write']);
  if (denied) return fail(denied);
  const p = vitalsForm.safeParse({
    ...input,
    berat: input.berat ?? '',
    kesadaran: input.kesadaran ?? '',
    oksigen: input.oksigen ?? false,
  });
  if (!p.success) {
    const issue = p.error.issues[0];
    return fail(issue?.message ?? 'Isian tanda vital tidak valid.', String(issue?.path[0] ?? ''));
  }
  const [sbp, dbp] = p.data.td.split('/').map(Number) as [number, number];
  try {
    await api(`/api/v1/encounters/${p.data.encounterId}/observations`, {
      method: 'POST',
      body: {
        encounterId: p.data.encounterId,
        occurredAt: new Date().toISOString(),
        temp: p.data.suhu,
        hr: p.data.nadi,
        rr: p.data.napas,
        sbp,
        dbp,
        spo2: p.data.spo2,
        onOxygen: p.data.oksigen,
        consciousness: p.data.kesadaran,
        weightKg: p.data.berat,
      },
      schema: vitalSignsRecordSchema,
    });
    return ok(`Tanda vital tersimpan ${formatJam(new Date())}`);
  } catch (err) {
    return apiFail(err);
  }
}

// ------------------------------------------------------------------------------------------------------------
// SOAP: draf, tanda tangan + selesai, co-sign
// ------------------------------------------------------------------------------------------------------------

const soapInput = poliSoapDraftSchema.extend({ encounterId: uuid });

function parseSoap(input: PoliSoapInput) {
  return soapInput.safeParse({
    encounterId: input.encounterId,
    subjective: input.subjective,
    objective: input.objective,
    diagnosisCodes: input.diagnosisCodes,
    plan: input.plan ?? '',
    followUp: input.followUp ?? '',
    condition: input.condition ?? '',
    disposition: input.disposition ?? '',
  });
}

export async function savePoliDraftAction(input: PoliSoapInput): Promise<PoliActionResult> {
  const denied = await staff(['clinical', 'write']);
  if (denied) return fail(denied);
  const p = parseSoap(input);
  if (!p.success) return fail('Isian CPPT tidak valid (maksimal 2.000 karakter per bagian).');
  const { encounterId, ...content } = p.data;
  try {
    await api(`/api/v1/drafts/${encounterId}/soap`, {
      method: 'PUT',
      body: { content },
      schema: z.object({ updatedAt: z.string() }).loose(),
    });
    return ok(`Draf disimpan ${formatJam(new Date())}`);
  } catch (err) {
    return apiFail(err);
  }
}

const conditionList = z.array(conditionRecordSchema);

/** CPPT SOAP final (penulis dari sesi) + diagnosis ICD-10 yang belum tercatat. */
async function writeCpptAndDiagnoses(d: z.infer<typeof soapInput>) {
  const existing = await api(`/api/v1/encounters/${d.encounterId}/conditions`, { schema: conditionList });
  const enc = existing.filter((c) => c.kind === 'encounter');
  const now = new Date().toISOString();
  const cppt = await api('/api/v1/cppt/entries', {
    method: 'POST',
    body: {
      encounterId: d.encounterId,
      occurredAt: now,
      content: {
        format: 'soap',
        s: d.subjective,
        o: d.objective,
        a: d.diagnosisCodes.map((c) => `${c} ${icd10Display(c) ?? ''}`.trim()).join('; '),
        p: d.plan,
      },
      instruction: null,
      revision: { kind: 'baru' },
    },
    schema: cpptRecordSchema,
  });
  let hasPrimary = enc.some((c) => c.role === 'utama');
  for (const code of d.diagnosisCodes) {
    if (enc.some((c) => c.code === code)) continue;
    await api('/api/v1/diagnosis/conditions', {
      method: 'POST',
      body: {
        encounterId: d.encounterId,
        kind: 'encounter',
        role: hasPrimary ? 'sekunder' : 'utama',
        code,
        clinicalStatus: 'active',
        note: null,
        occurredAt: now,
        revision: { kind: 'baru' },
      },
      schema: conditionRecordSchema,
    });
    hasPrimary = true;
  }
  return cppt;
}

/** Resume RJ ringkas ber-TTE lalu tutup kunjungan (tiket poli selesai → task 5). Lewati langkah yang sudah selesai. */
async function finishVisit(d: z.infer<typeof soapInput>): Promise<PoliActionResult> {
  const visit = await api(`/api/v1/encounters/${d.encounterId}/poli-visit`, { schema: poliVisitSchema });
  if (visit.api.encounterStatus === 'finished') return ok('Kunjungan sudah selesai.');
  if (visit.api.resume.state !== 'final') {
    const view = await api('/api/v1/discharge/summaries', {
      method: 'POST',
      body: { encounterId: d.encounterId },
      schema: dischargeSummaryViewSchema,
    });
    const base = view.draft;
    await api(`/api/v1/discharge/summaries/${d.encounterId}/draft`, {
      method: 'PUT',
      body: {
        dischargeAt: null,
        disposition: d.disposition,
        dischargeCondition: d.condition,
        notes: base?.notes ?? { anamnesis: null, fisik: null, penunjang: null, terapi: null },
        education: base?.education ?? null,
        instructions: base?.instructions ?? null,
        followUp: d.followUp.trim() || base?.followUp || null,
        medications: base?.medications ?? view.medications,
      },
      schema: dischargeSummaryViewSchema,
    });
    await api(`/api/v1/discharge/summaries/${d.encounterId}/finalize`, {
      method: 'POST',
      body: { revision: { kind: 'baru' } },
      schema: dischargeSummaryViewSchema,
    });
  }
  await api(`/api/v1/encounters/${d.encounterId}/close`, {
    method: 'POST',
    body: { disposition: d.disposition },
    schema: encounterCloseResultSchema,
  });
  const at = formatJam(new Date());
  return ok(`Ditandatangani ${at} · CPPT final, resume rawat jalan ber-TTE, kunjungan selesai`);
}

export async function signPoliAction(input: PoliSoapInput): Promise<PoliActionResult> {
  const denied = await staff(['clinical', 'write']);
  if (denied) return fail(denied);
  const p = parseSoap(input);
  if (!p.success) return fail('Isian CPPT tidak valid (maksimal 2.000 karakter per bagian).');
  if (p.data.diagnosisCodes.length === 0) {
    return fail('Isi minimal satu diagnosis (A · Asesmen ICD-10) agar kunjungan bisa diselesaikan.');
  }
  // Kondisi dan cara pulang masuk resume ber-TTE: wajib dipilih dokter (tanpa nilai bawaan).
  if (!p.data.condition || !p.data.disposition) {
    return fail('Pilih kondisi pulang dan cara pulang sebelum menandatangani resume rawat jalan.');
  }
  try {
    const visit = await api(`/api/v1/encounters/${p.data.encounterId}/poli-visit`, {
      schema: poliVisitSchema,
    });
    const done = visit.api.cppt && visit.api.cppt.status !== 'entered_in_error';
    if (!done) {
      const cppt = await writeCpptAndDiagnoses(p.data);
      if (cppt.status === 'menunggu_cosign') {
        return ok(`CPPT residen disimpan ${formatJam(new Date())} · menunggu co-sign DPJP, belum final`, {
          cosignRequired: true,
        });
      }
    } else if (visit.api.cppt?.status === 'menunggu_cosign') {
      return fail('CPPT kunjungan ini menunggu co-sign DPJP.');
    }
    if (!visit.api.canSign) {
      return ok('CPPT tersimpan. Resume rawat jalan ditandatangani DPJP kunjungan ini.');
    }
    return await finishVisit(p.data);
  } catch (err) {
    return apiFail(err, 'Belum selesai: ');
  }
}

/** Co-sign DPJP atas CPPT residen, lalu resume RJ + tutup kunjungan. */
export async function cosignPoliAction(input: PoliSoapInput): Promise<PoliActionResult> {
  const denied = await staff(['clinical', 'cosign']);
  if (denied) return fail('Co-sign hanya oleh DPJP.');
  const p = parseSoap(input);
  if (!p.success) return fail('Permintaan co-sign tidak valid.');
  try {
    const visit = await api(`/api/v1/encounters/${p.data.encounterId}/poli-visit`, {
      schema: poliVisitSchema,
    });
    const cppt = visit.api.cppt;
    if (!cppt || cppt.status !== 'menunggu_cosign')
      return fail('Tidak ada CPPT residen yang menunggu co-sign.');
    await api(`/api/v1/cppt/entries/${cppt.id}/cosign`, {
      method: 'POST',
      body: { note: null },
      schema: z.object({}).loose(),
    });
    return await finishVisit(p.data);
  } catch (err) {
    return apiFail(err, 'Belum selesai: ');
  }
}
