'use server';
import { z } from 'zod';
import { redactPid } from '@/lib/integrasi-perangkat';
import { saveIntegration } from '@/lib/integrasi-aksi';
import { readDomain } from '@/lib/server/demo/state';
import { assertDemo } from '@/lib/server/demo-guard';
const input = z.strictObject({
  raw: z
    .string()
    .min(1)
    .max(64 * 1024),
  processed: z.array(z.string()).max(500).optional(),
});
export async function processHl7Action(raw: unknown, rev: number) {
  assertDemo();
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Pesan tidak dikenal (maks. 64 KB teks).' };
  const redacted = redactPid(p.data.raw);
  const saved = await saveIntegration('perangkat', { type: 'gateway.terima', raw: redacted }, rev);
  const result = saved.ok ? (await readDomain('integrasi')).state.gatewayLog[0]?.result : undefined;
  return { ...saved, result, redacted: saved.ok ? redacted : undefined };
}
