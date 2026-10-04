'use server';

import {
  type CpptDraftInput,
  cpptDraftInputSchema,
  cpptSignInputSchema,
  formatJam,
  poliVitalsInputSchema,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { ICD10_OPTIONS } from '@/lib/klinis';
import { getPoliWorklist } from '@/lib/server/data/klinis';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep, type SessionView } from '@/lib/session-view';

/**
 * K01/K02 · Server Action pemeriksaan poli (mode presentasi, ADR-0023): gerbang demo, sesi lengkap, posisi, dan
 * validasi zod. Tidak menyimpan apa pun; kelak diganti `POST /api/v1/klinis/cppt` (versi baru, bukan UPDATE).
 */

export interface KlinisActionResult {
  ok?: true;
  /** Jam simpan `08.53`. */
  at?: string;
  message?: string;
  error?: string;
  /** Isian yang galat (untuk menandai field). */
  field?: string;
}

const DOCTORS = ['dokter', 'dokter_residen'];
const CLINICIANS = ['dokter', 'dokter_residen', 'perawat', 'bidan'];
const KNOWN_ICD10 = new Set(ICD10_OPTIONS.map((o) => o.code));

async function demoSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

async function checkEncounter(s: SessionView, encounterId: string): Promise<string | null> {
  const w = await getPoliWorklist(s);
  return w.items.some((i) => i.encounterId === encounterId)
    ? null
    : 'Kunjungan tidak ada di antrean poli hari ini.';
}

export async function saveCpptDraftAction(input: CpptDraftInput): Promise<KlinisActionResult> {
  const s = await demoSession();
  if (!DOCTORS.includes(s.role?.code ?? '')) return { error: 'CPPT dokter hanya bisa diisi posisi dokter.' };
  const p = cpptDraftInputSchema.safeParse(input);
  if (!p.success) return { error: 'Isian CPPT tidak valid (maksimal 2.000 karakter per bagian).' };
  if (p.data.diagnosisCodes.some((c) => !KNOWN_ICD10.has(c))) return { error: 'Kode ICD-10 tidak dikenal.' };
  const missing = await checkEncounter(s, p.data.encounterId);
  if (missing) return { error: missing };
  const at = formatJam(new Date());
  return { ok: true, at, message: `Draf disimpan ${at} (simulasi, tidak disimpan)` };
}

export async function signCpptAction(input: CpptDraftInput): Promise<KlinisActionResult> {
  const s = await demoSession();
  if (!DOCTORS.includes(s.role?.code ?? '')) return { error: 'Tanda tangan CPPT hanya untuk posisi dokter.' };
  const p = cpptSignInputSchema.safeParse(input);
  if (!p.success) {
    return { error: 'Isi minimal satu diagnosis (A · Asesmen ICD-10) agar kunjungan bisa diselesaikan.' };
  }
  if (p.data.diagnosisCodes.some((c) => !KNOWN_ICD10.has(c))) return { error: 'Kode ICD-10 tidak dikenal.' };
  const missing = await checkEncounter(s, p.data.encounterId);
  if (missing) return { error: missing };
  const at = formatJam(new Date());
  return { ok: true, at, message: `Ditandatangani ${at} · CPPT versi final (simulasi, tidak disimpan)` };
}

/** Isian formulir tanda vital (teks; dikonversi dan divalidasi skema). */
export interface VitalsFormInput {
  encounterId: string;
  td: string;
  nadi: string;
  suhu: string;
  spo2: string;
}

export async function recordVitalsAction(input: VitalsFormInput): Promise<KlinisActionResult> {
  const s = await demoSession();
  if (!CLINICIANS.includes(s.role?.code ?? ''))
    return { error: 'Posisi ini tidak mengisi asesmen keperawatan.' };
  const p = poliVitalsInputSchema.safeParse(input);
  if (!p.success) {
    const issue = p.error.issues[0];
    return { error: issue?.message ?? 'Isian tanda vital tidak valid.', field: String(issue?.path[0] ?? '') };
  }
  const missing = await checkEncounter(s, p.data.encounterId);
  if (missing) return { error: missing };
  const at = formatJam(new Date());
  return { ok: true, at, message: `Tanda vital tersimpan ${at} (simulasi, tidak disimpan)` };
}
