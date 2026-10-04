'use server';

import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { MAX_INPUT_LENGTH } from '@/lib/demo/engine/run';
import type { ScenarioId } from '@/lib/demo/engine/types';
import { SCENARIO_ORDER } from '@/lib/demo/skenario';
import { screenById } from '@/lib/screens';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { assertDemo } from '@/lib/server/demo-guard';
import { type DemoCommand, runDemoCommand } from '@/lib/server/demo/scenario';
import { assignmentsSchema, okSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action mode presentasi (ADR-0023). Setiap action adalah endpoint POST publik: gerbang demo, sesi lengkap,
 * dan input divalidasi di sini; aturan skenario ditegakkan mesin (`runDemoCommand`).
 */

export interface DemoActionResult {
  error?: string;
  /** Tugas yang galat (untuk menandai isian). */
  task?: string;
  /** Tampilan basi: tab lain sudah memajukan simulasi. */
  stale?: boolean;
}

const scenarioId = z.enum(SCENARIO_ORDER as [ScenarioId, ...ScenarioId[]]);
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('task'),
    step: z.number().int().min(0).max(50),
    task: z.string().regex(/^[a-z0-9]{1,30}$/i),
    value: z.union([z.literal(true), z.string().max(MAX_INPUT_LENGTH * 2)]),
  }),
  z.strictObject({ type: z.literal('next') }),
  z.strictObject({ type: z.literal('auto') }),
  z.strictObject({ type: z.literal('select'), scenario: scenarioId }),
  z.strictObject({ type: z.literal('reset'), scenario: scenarioId }),
  z.strictObject({ type: z.literal('jump'), scenario: scenarioId, step: z.number().int().min(0).max(50) }),
]);
export type DemoCommandInput = z.infer<typeof commandSchema>;

async function demoSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

export async function demoCommandAction(rev: number, input: DemoCommandInput): Promise<DemoActionResult> {
  const s = await demoSession();
  const r = z.number().int().min(0).safeParse(rev);
  const c = commandSchema.safeParse(input);
  if (!r.success || !c.success) return { error: 'Perintah tidak dikenal.' };
  const cmd = c.data;
  const mapped: DemoCommand =
    cmd.type === 'select' || cmd.type === 'reset' || cmd.type === 'jump'
      ? cmd
      : { type: 'scenario', action: cmd };
  const out = await runDemoCommand(s, r.data, mapped);
  revalidatePath('/', 'layout');
  return out.ok ? {} : { error: out.error, task: out.task, stale: out.stale };
}

/**
 * "Buka layar X sebagai posisi Y": ganti posisi akun demo (bila perlu) lewat `POST /auth/assignment` yang sudah
 * ada (tercatat di audit), lalu buka layarnya. Akun tanpa posisi itu mendapat pesan, tidak dialihkan diam-diam.
 */
export async function openScreenAsAction(screenId: string, role: string | null): Promise<DemoActionResult> {
  const s = await demoSession();
  const screen = screenById(screenId);
  if (!screen || screen.status === 'belum') return { error: 'Layar ini belum tersedia di presentasi.' };
  if (role !== null && !Object.hasOwn(SYSTEM_ROLES, role)) return { error: 'Posisi tidak dikenal.' };
  if (role && s.role?.code !== role) {
    let assignmentId: string | undefined;
    try {
      const options = await api('/api/v1/auth/assignments', { schema: assignmentsSchema });
      assignmentId = options.find((o) => o.roleCode === role)?.id;
      if (assignmentId) {
        await api('/api/v1/auth/assignment', {
          method: 'POST',
          body: { assignmentId },
          schema: okSchema,
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) redirect('/masuk');
      return { error: err instanceof ApiError ? err.message : 'Gagal mengganti posisi. Coba lagi.' };
    }
    if (!assignmentId) {
      return {
        error: `Akun ini tidak punya posisi ${SYSTEM_ROLES[role as SystemRoleCode]}. Pakai akun demo yang memegang semua posisi.`,
      };
    }
    revalidatePath('/', 'layout');
  }
  redirect(screen.route);
}
