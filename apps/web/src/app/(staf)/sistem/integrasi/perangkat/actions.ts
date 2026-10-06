'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { LAB_TESTS } from '@/lib/demo/fixtures/penunjang';
import { type InboundResult, processInbound, redactPid } from '@/lib/integrasi-perangkat';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';
import { getDeviceGateway } from '@/lib/server/data/integrasi-lanjut';

/**
 * I06 · Server Action device gateway (simulasi, mode presentasi ADR-0023): memproses pesan HL7 contoh di server
 * (parser, pencocokan nomor lab terhadap worklist Lab, idempotensi control ID) dan mengembalikan ACK. Tidak ada yang
 * disimpan; produksi menyimpan pesan mentah terenkripsi lalu memproses async.
 */

export interface GatewayActionResult {
  ok: boolean;
  message: string;
  at?: string;
  result?: InboundResult;
  redacted?: string;
}

const input = z.strictObject({
  raw: z
    .string()
    .min(1)
    .max(64 * 1024),
  processed: z.array(z.string().max(40)).max(500),
});

export async function processHl7Action(raw: unknown): Promise<GatewayActionResult> {
  if (!(await manajemenSession('perangkat'))) return { ok: false, message: DENIED_MESSAGE };
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Pesan tidak dikenal (maks. 64 KB teks).' };
  const data = await getDeviceGateway();
  const loinc = new Set(Object.values(LAB_TESTS).map((t) => t.loinc));
  const result = processInbound(
    p.data.raw,
    data.specimens,
    new Set([...data.processed, ...p.data.processed]),
    loinc,
  );
  const at = formatJam(new Date());
  return {
    ok: true,
    at,
    result,
    redacted: redactPid(p.data.raw),
    message: `ACK ${result.ack} · ${result.text} · ${at} (simulasi, tidak disimpan)`,
  };
}
