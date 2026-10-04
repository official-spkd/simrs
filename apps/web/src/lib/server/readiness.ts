import 'server-only';
import { z } from 'zod';
import { webEnv } from './web-env';

export const readinessSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(
    z.string(),
    z.object({
      ok: z.boolean(),
      latencyMs: z.number().optional(),
      error: z.string().optional(),
      /** Hanya pemeriksaan `storage`: driver penyimpanan berkas yang dikonfigurasi API. */
      driver: z.string().optional(),
    }),
  ),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** `/ready` menjawab 503 saat ada dependensi gagal; isinya tetap dibaca agar tiap pemeriksaan terlihat. */
export async function loadReadiness(): Promise<Readiness | null> {
  try {
    const res = await fetch(new URL('/ready', webEnv().apiBaseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const parsed = readinessSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
