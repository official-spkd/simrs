'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { demoApiClients } from '@/lib/demo/fixtures/integrasi-api-publik';
import { FHIR_SCOPES, registerGate, suspendGate } from '@/lib/integrasi-api-publik';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';

/**
 * I12 · Server Action klien API publik/FHIR (mode presentasi, ADR-0023): pendaftaran klien (cakupan klinis wajib
 * dasar persetujuan), rotasi kunci berkonfirmasi, penangguhan beralasan, dan aktivasi ulang. Tidak ada kunci yang
 * dibuat atau disimpan.
 */

export interface ApiClientActionResult {
  ok: boolean;
  message: string;
}

const id = z.string().min(1).max(40);
const input = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('daftar'),
    name: z.string().max(120),
    purpose: z.string().max(300),
    scopes: z.array(z.enum(FHIR_SCOPES)).max(FHIR_SCOPES.length),
    basis: z.string().max(300),
  }),
  z.strictObject({ kind: z.literal('rotasi'), clientId: id, confirmed: z.literal(true) }),
  z.strictObject({ kind: z.literal('tangguhkan'), clientId: id, reason: z.string().max(300) }),
  z.strictObject({ kind: z.literal('aktifkan'), clientId: id }),
]);

const sim = (text: string): ApiClientActionResult => ({
  ok: true,
  message: `${text} · ${formatJam(new Date())} · tercatat di jejak audit (simulasi, tidak disimpan)`,
});

export async function apiClientAction(raw: unknown): Promise<ApiClientActionResult> {
  if (!(await manajemenSession('api-publik'))) return { ok: false, message: DENIED_MESSAGE };
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Permintaan tidak dikenal (rotasi wajib dikonfirmasi).' };
  const a = p.data;
  if (a.kind === 'daftar') {
    const errors = registerGate(a);
    if (errors.length) return { ok: false, message: errors.join(' ') };
    return sim(
      `Klien ${a.name.trim()} terdaftar dengan cakupan ${a.scopes.join(', ')}; kunci ditampilkan sekali`,
    );
  }
  // Klien baru di sesi ini tidak ada di fixture; aksi lanjutan tetap divalidasi bentuknya.
  const c = demoApiClients().find((x) => x.id === a.clientId);
  const name = c?.name ?? 'Klien baru';
  switch (a.kind) {
    case 'rotasi':
      return sim(`Kunci ${name} dirotasi; kunci lama dicabut seketika`);
    case 'tangguhkan': {
      const err = suspendGate(a.reason);
      if (err) return { ok: false, message: err };
      return sim(`${name} ditangguhkan: “${a.reason.trim()}”`);
    }
    case 'aktifkan':
      return sim(`${name} diaktifkan kembali`);
  }
}
