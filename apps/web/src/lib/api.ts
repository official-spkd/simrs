import { errorBodySchema } from '@simrs/shared';
import { z } from 'zod';

export const API_BASE_URL =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Klien API bertipe: setiap respons divalidasi skema zod, galat diterjemahkan ke `ApiError` berkode stabil. */
export async function apiGet<T extends z.ZodType>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorBodySchema.safeParse(body);
    throw new ApiError(
      res.status,
      parsed.success ? parsed.data.code : 'INTERNAL_ERROR',
      parsed.success ? parsed.data.message : res.statusText,
    );
  }
  return schema.parse(body);
}

export const readinessSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(
    z.string(),
    z.object({ ok: z.boolean(), latencyMs: z.number().optional(), error: z.string().optional() }),
  ),
});
export type Readiness = z.infer<typeof readinessSchema>;
