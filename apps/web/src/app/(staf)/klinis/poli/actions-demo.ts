'use server';

import {
  type CpptDraftInput,
  cpptDraftInputSchema,
  cpptSignInputSchema,
  formatJam,
  poliVitalsInputSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  canRecordVitals,
  canWriteDoctorNote,
  cpptNeedsCosign,
  ICD10_OPTIONS,
  nextWaiting,
} from '@/lib/klinis';
import { pendingCosign } from '@/lib/klinis-poli-toko';
import { getPoliWorklist } from '@/lib/server/data/klinis/poli';
import { demoActionSession } from '@/lib/server/data/klinis/shared';
import { commitEvent, readDomain } from '@/lib/server/demo/state';
import type { SessionView } from '@/lib/session-view';

/**
 * K01/K02 · Server Action pemeriksaan poli (mode presentasi, ADR-0023): gerbang demo, sesi lengkap, posisi
 * (CPPT dokter: dokter/dokter residen; tanda vital: perawat/bidan), dan validasi zod. CPPT residen tidak final
 * sebelum co-sign DPJP (posisi dokter, bukan penulisnya). Pasien skenario Simulasi ditolak: rekam medisnya hanya maju
 * lewat tugas skenario. Tersimpan di toko demo (`klinis-poli`, ADR-0085) atas nama pengguna sesi; kelak diganti
 * `POST /api/v1/klinis/cppt` (versi baru, bukan UPDATE).
 */

export interface KlinisActionResult {
  ok: boolean;
  /** Jam simpan `08.53`. */
  at?: string;
  message?: string;
  error?: string;
  /** Isian yang galat (untuk menandai field). */
  field?: string;
  /** CPPT residen: tersimpan tetapi belum final, menunggu co-sign DPJP. */
  cosignRequired?: true;
  /** Tampilan basi: halaman dimuat ulang. */
  stale?: boolean;
}

const KNOWN_ICD10 = new Set(ICD10_OPTIONS.map((o) => o.code));
const revSchema = z.int().min(0);
const fail = (error: string, field?: string): KlinisActionResult => ({ ok: false, error, field });

/** Kunjungan non-skenario di antrean poli hari ini (data server), atau pesan galat. */
async function poliItem(s: SessionView, encounterId: string) {
  const w = await getPoliWorklist(s);
  const item = w.items.find((i) => i.encounterId === encounterId);
  if (!item) return { error: 'Kunjungan tidak ada di antrean poli hari ini.' } as const;
  if (item.scenario) {
    return {
      error:
        'Pasien simulasi: rekam medis mengikuti langkah skenario. Simpan lewat tugas skenario di layar ini.',
    } as const;
  }
  return { item, worklist: w } as const;
}

export async function saveCpptDraftAction(input: CpptDraftInput, rev: unknown): Promise<KlinisActionResult> {
  const s = await demoActionSession();
  if (!canWriteDoctorNote(s.role?.code)) return fail('CPPT dokter hanya bisa diisi posisi dokter.');
  const p = cpptDraftInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return fail('Isian CPPT tidak valid (maksimal 2.000 karakter per bagian).');
  if (p.data.diagnosisCodes.some((c) => !KNOWN_ICD10.has(c))) return fail('Kode ICD-10 tidak dikenal.');
  const found = await poliItem(s, p.data.encounterId);
  if ('error' in found) return fail(found.error ?? 'Kunjungan tidak dikenal.');
  const at = formatJam(demoNow());
  const c = await commitEvent(
    'klinis-poli',
    {
      type: 'cppt.draf',
      encounterId: p.data.encounterId,
      patientId: found.item.patientId,
      subjective: p.data.subjective,
      objective: p.data.objective,
      diagnosisCodes: p.data.diagnosisCodes,
      at,
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, error: c.error, stale: c.stale };
  return { ok: true, at, message: `Draf disimpan ${at}` };
}

export async function signCpptAction(input: CpptDraftInput, rev: unknown): Promise<KlinisActionResult> {
  const s = await demoActionSession();
  if (!canWriteDoctorNote(s.role?.code)) return fail('Tanda tangan CPPT hanya untuk posisi dokter.');
  const p = cpptSignInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) {
    return fail('Isi minimal satu diagnosis (A · Asesmen ICD-10) agar kunjungan bisa diselesaikan.');
  }
  if (p.data.diagnosisCodes.some((c) => !KNOWN_ICD10.has(c))) return fail('Kode ICD-10 tidak dikenal.');
  const found = await poliItem(s, p.data.encounterId);
  if ('error' in found) return fail(found.error ?? 'Kunjungan tidak dikenal.');
  const at = formatJam(demoNow());
  const resident = cpptNeedsCosign(s.role?.code);
  const c = await commitEvent(
    'klinis-poli',
    {
      type: 'cppt.ditandatangani',
      encounterId: p.data.encounterId,
      patientId: found.item.patientId,
      subjective: p.data.subjective,
      objective: p.data.objective,
      diagnosisCodes: p.data.diagnosisCodes,
      final: !resident,
      at,
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, error: c.error, stale: c.stale };
  if (resident) {
    return {
      ok: true,
      at,
      cosignRequired: true,
      message: `CPPT residen disimpan ${at} · menunggu co-sign DPJP, belum final`,
    };
  }
  return { ok: true, at, message: `Ditandatangani ${at} · CPPT versi final` };
}

/** Co-sign DPJP atas CPPT residen poli: posisi dokter, bukan penulis catatan (id pengguna). */
export async function cosignPoliCpptAction(input: unknown, rev: unknown): Promise<KlinisActionResult> {
  const s = await demoActionSession();
  if (s.role?.code !== 'dokter') return fail('Co-sign hanya oleh DPJP (posisi dokter).');
  const p = z.strictObject({ encounterId: z.string().min(1).max(60) }).safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return fail('Permintaan co-sign tidak valid.');
  const found = await poliItem(s, p.data.encounterId);
  if ('error' in found) return fail(found.error ?? 'Kunjungan tidak dikenal.');
  const { state } = await readDomain('klinis-poli');
  const pending = pendingCosign(state, p.data.encounterId);
  if (!pending) return fail('Tidak ada CPPT residen yang menunggu co-sign.');
  if (pending.authorId === s.user.id) return fail('Tidak bisa co-sign catatan sendiri.');
  const at = formatJam(demoNow());
  const c = await commitEvent(
    'klinis-poli',
    { type: 'cppt.cosign', encounterId: p.data.encounterId, patientId: found.item.patientId, at },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, error: c.error, stale: c.stale };
  return {
    ok: true,
    at,
    message: `Co-sign DPJP ${s.user.displayName} · ${at} · CPPT final, kunjungan selesai`,
  };
}

/** Isian formulir tanda vital (teks; dikonversi dan divalidasi skema). */
export interface VitalsFormInput {
  encounterId: string;
  td: string;
  nadi: string;
  suhu: string;
  spo2: string;
}

export async function recordVitalsAction(input: VitalsFormInput, rev: unknown): Promise<KlinisActionResult> {
  const s = await demoActionSession();
  if (!canRecordVitals(s.role?.code)) {
    return fail('Asesmen keperawatan dan tanda vital hanya diisi posisi perawat atau bidan.');
  }
  const p = poliVitalsInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) {
    const issue = p.error?.issues[0];
    return fail(issue?.message ?? 'Isian tanda vital tidak valid.', String(issue?.path[0] ?? ''));
  }
  const found = await poliItem(s, p.data.encounterId);
  if ('error' in found) return fail(found.error ?? 'Kunjungan tidak dikenal.');
  const at = formatJam(demoNow());
  const c = await commitEvent(
    'klinis-poli',
    {
      type: 'vital.dicatat',
      encounterId: p.data.encounterId,
      td: p.data.td,
      nadi: p.data.nadi,
      suhu: p.data.suhu,
      spo2: p.data.spo2,
      at,
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, error: c.error, stale: c.stale };
  return { ok: true, at, message: `Tanda vital tersimpan ${at}` };
}

/**
 * Panggil pasien berikutnya (non-skenario) dari antrean server: pasien yang sedang diperiksa dijeda. Pasien skenario
 * dipanggil lewat tugas skenario.
 */
export async function callNextAction(rev: unknown): Promise<KlinisActionResult & { patientId?: string }> {
  const s = await demoActionSession();
  if (!canWriteDoctorNote(s.role?.code)) return fail('Pasien dipanggil oleh dokter pemeriksa.');
  const r = revSchema.safeParse(rev);
  if (!r.success) return fail('Permintaan tidak valid.');
  const w = await getPoliWorklist(s);
  const next = nextWaiting(w.items, (i) => i.status);
  if (!next) return fail('Tidak ada pasien yang menunggu.');
  if (next.scenario) {
    return {
      ok: false,
      patientId: next.patientId,
      error: `${next.queueNo} · ${next.name} adalah pasien skenario: buka lalu tekan "Panggil pasien".`,
    };
  }
  const at = formatJam(demoNow());
  const c = await commitEvent(
    'klinis-poli',
    {
      type: 'antrean.dipanggil',
      patientId: next.patientId,
      at,
      paused: w.items.filter((i) => !i.scenario && i.status === 'diperiksa').map((i) => i.patientId),
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, error: c.error, stale: c.stale };
  return {
    ok: true,
    at,
    patientId: next.patientId,
    message: `${next.queueNo} · ${next.name} dipanggil ${at} · tampil di layar antrean`,
  };
}
