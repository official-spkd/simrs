'use server';

import { z } from 'zod';
import { demoDiagOrders } from '@/lib/demo/fixtures/penunjang-diagnostik';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { DIAG_GATE_TEXT, TEMPLATES } from '@/lib/penunjang-diagnostik';

/**
 * S10 · Server Action penunjang diagnostik lain (mode presentasi, ADR-0023). Order dicari server dari fixture;
 * slot harus dari templat, identitas wajib dikonfirmasi, dan ekspertise lengkap per templat sebelum TTE. Tidak
 * menyimpan apa pun.
 */

const id = z.string().min(1).max(40);

const input = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('jadwal'), orderId: id, slot: z.string().max(80) }),
  z.strictObject({ kind: z.literal('laksana'), orderId: id, identityConfirmed: z.boolean() }),
  z.strictObject({
    kind: z.literal('tte'),
    orderId: id,
    findings: z.record(z.string().max(60), z.string().max(1000)),
    critical: z.boolean(),
  }),
]);

export async function recordDiagAction(raw: unknown): Promise<PenunjangActionResult> {
  const s = await penunjangSession('diagnostik');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Langkah pemeriksaan tidak dikenal.');
  const a = p.data;
  const o = demoDiagOrders().find((x) => x.id === a.orderId);
  if (!o) return invalid('Order pemeriksaan tidak ditemukan.');
  const t = TEMPLATES[o.kind];
  switch (a.kind) {
    case 'jadwal':
      if (!t.slots.includes(a.slot)) return invalid(DIAG_GATE_TEXT.SLOT_UNKNOWN);
      return simulated(`${t.label} ${o.patient.name} dijadwalkan ${a.slot}`);
    case 'laksana':
      if (!a.identityConfirmed) return invalid(DIAG_GATE_TEXT.IDENTITY_REQUIRED);
      return simulated(`${t.label} ${o.patient.name} dilaksanakan`);
    case 'tte':
      if (!t.fields.every((f) => (a.findings[f] ?? '').trim().length > 0))
        return invalid(DIAG_GATE_TEXT.FINDINGS_INCOMPLETE);
      return simulated(`Ekspertise ${t.label} ditandatangani (TTE ${t.reader})`);
  }
}
