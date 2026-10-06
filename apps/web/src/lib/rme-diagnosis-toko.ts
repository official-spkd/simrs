import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { hasReason } from './rme';
import {
  activeAllergies,
  addAllergyBlocker,
  addDxBlocker,
  type AllergyEntry,
  canAddToProblems,
  canEditAllergy,
  canEditDiagnosis,
  current,
  DX_RANK_LABEL,
  type EncounterDx,
  finalizeBlocker,
  finalizeDx,
  markAllergyError,
  markDxError,
  nkdaBlocker,
  type Problem,
  type ProcedureEntry,
  resolveProblem,
  setPrimary,
} from './rme-diagnosis';
import type { RmeExtraState } from './rme-toko-bagan';

/**
 * K08 · Operasi layar Diagnosis yang dijalankan Server Action terhadap daftar server (rekam awal + toko demo
 * `rekam-medis`, ADR-0085). Fungsi murni: memeriksa gerbang (posisi, kode ganda, satu diagnosis utama, alasan salah
 * entri, NKDA) lalu menghasilkan entri versi baru yang ditambahkan (tidak pernah mengubah entri lama).
 */

export const diagnosisOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('tambah-dx'),
    code: z.string().min(1).max(10),
    rank: z.enum(['utama', 'sekunder', 'komplikasi']),
    certainty: z.enum(['kerja', 'akhir']),
  }),
  z.strictObject({ op: z.literal('utama'), dxId: z.string().min(1).max(120) }),
  z.strictObject({ op: z.literal('ke-masalah'), dxId: z.string().min(1).max(120) }),
  z.strictObject({
    op: z.literal('salah-dx'),
    dxId: z.string().min(1).max(120),
    reason: z.string().max(500),
  }),
  z.strictObject({ op: z.literal('akhir') }),
  z.strictObject({
    op: z.literal('teratasi'),
    problemId: z.string().min(1).max(120),
    date: z.iso.date(),
    note: z.string().max(300),
  }),
  z.strictObject({
    op: z.literal('tambah-alergi'),
    substance: z.string().max(80),
    reaction: z.string().max(120),
    severity: z.enum(['ringan', 'sedang', 'berat']),
  }),
  z.strictObject({
    op: z.literal('salah-alergi'),
    allergyId: z.string().min(1).max(120),
    reason: z.string().max(500),
  }),
  z.strictObject({ op: z.literal('nkda') }),
  z.strictObject({ op: z.literal('tambah-prosedur'), code: z.string().min(1).max(10) }),
]);
export type DiagnosisOp = z.infer<typeof diagnosisOpSchema>;

export interface DiagnosisLists {
  dx: EncounterDx[];
  procs: ProcedureEntry[];
  problems: Problem[];
  allergies: AllergyEntry[];
  nkdaAt: string | null;
}

/** Daftar rekam awal + versi tersimpan kunjungan ini. */
export function diagnosisLists(base: DiagnosisLists, s: RmeExtraState, enc: string): DiagnosisLists {
  const strip = <T extends { encounterId: string }>(x: T) => {
    const { encounterId: _e, ...rest } = x;
    return rest;
  };
  return {
    dx: [...base.dx, ...s.dx.filter((x) => x.encounterId === enc).map(strip)],
    procs: [...base.procs, ...s.procs.filter((x) => x.encounterId === enc).map(strip)],
    problems: [...base.problems, ...s.problems.filter((x) => x.encounterId === enc).map(strip)],
    allergies: [...base.allergies, ...s.allergies.filter((x) => x.encounterId === enc).map(strip)],
    nkdaAt: Object.hasOwn(s.nkda, enc) ? (s.nkda[enc] ?? null) : base.nkdaAt,
  };
}

export interface DiagnosisCtx {
  role: string | null;
  by: string;
  at: string;
  today: string;
  /** Id baru per jenis: `<kunjungan>-<jenis>-t<urut>`. */
  newId: (prefix: string) => (n: number) => string;
  icd10: ReadonlyArray<{ code: string; display: string }>;
  icd9: ReadonlyArray<{ code: string; display: string }>;
}

export type DiagnosisResult =
  | {
      ok: true;
      message: string;
      dx: EncounterDx[];
      procs: ProcedureEntry[];
      problems: Problem[];
      allergies: AllergyEntry[];
      nkda: 'verifikasi' | 'hapus' | null;
    }
  | { ok: false; error: string };

const DOCTOR = 'Diagnosis ditetapkan dokter (DPJP/residen).';
type Appended = Omit<Extract<DiagnosisResult, { ok: true }>, 'ok' | 'message'>;
const done = (message: string, part: Partial<Appended>): DiagnosisResult => ({
  ok: true,
  message,
  dx: [],
  procs: [],
  problems: [],
  allergies: [],
  nkda: null,
  ...part,
});

export function applyDiagnosisOp(l: DiagnosisLists, op: DiagnosisOp, c: DiagnosisCtx): DiagnosisResult {
  const fail = (error: string) => ({ ok: false, error }) as const;
  const jam = formatJam(c.at);
  const isDx = op.op !== 'tambah-alergi' && op.op !== 'salah-alergi' && op.op !== 'nkda';
  if (isDx && !canEditDiagnosis(c.role)) return fail(DOCTOR);
  if (!isDx && !canEditAllergy(c.role)) return fail('Alergi dicatat dokter, perawat, atau bidan.');
  const findDx = (id: string) => current(l.dx).find((d) => d.id === id && d.status === 'aktif');
  switch (op.op) {
    case 'tambah-dx': {
      const block = addDxBlocker(l.dx, op.code, op.rank);
      if (block) return fail(block);
      const code = c.icd10.find((x) => x.code === op.code);
      if (!code) return fail('Kode ICD-10 tidak ada di rujukan terminologi RS.');
      const entry: EncounterDx = {
        id: c.newId('dx')(0),
        version: 1,
        supersedesId: null,
        by: c.by,
        at: c.at,
        code: code.code,
        display: code.display,
        rank: op.rank,
        certainty: op.certainty,
        status: 'aktif',
        reason: null,
      };
      return done(
        `${entry.code} ${entry.display} tercatat sebagai diagnosis ${DX_RANK_LABEL[entry.rank].toLowerCase()} · ${jam}`,
        { dx: [entry] },
      );
    }
    case 'utama': {
      const d = findDx(op.dxId);
      if (!d) return fail('Diagnosis tidak ditemukan.');
      const added = setPrimary(l.dx, d.id, c.by, c.at, c.newId('dx'));
      return done(`${d.code} kini diagnosis utama · ${jam}; utama lama menjadi sekunder (versi baru)`, {
        dx: added,
      });
    }
    case 'ke-masalah': {
      const d = findDx(op.dxId);
      if (!d) return fail('Diagnosis tidak ditemukan.');
      if (!canAddToProblems(l.problems, d.code)) return fail(`${d.code} sudah ada di problem list aktif.`);
      const p: Problem = {
        id: c.newId('masalah')(0),
        version: 1,
        supersedesId: null,
        by: c.by,
        at: c.at,
        code: d.code,
        display: d.display,
        onset: c.today,
        status: 'aktif',
        resolvedOn: null,
        note: null,
      };
      return done(`${d.code} masuk problem list · ${jam}`, { problems: [p] });
    }
    case 'salah-dx': {
      const d = findDx(op.dxId);
      if (!d) return fail('Diagnosis tidak ditemukan.');
      if (!hasReason(op.reason)) return fail('Alasan salah entri minimal 10 karakter.');
      return done(`${d.code} ditandai salah entri · ${jam}; versi lama tetap tersimpan`, {
        dx: [markDxError(d, op.reason, c.by, c.at, c.newId('dx')(0))],
      });
    }
    case 'akhir': {
      // Diagnosis akhir menutup kodifikasi kunjungan: hanya DPJP (posisi dokter), bukan residen.
      if (c.role !== 'dokter') return fail('Diagnosis akhir ditetapkan DPJP (posisi dokter).');
      const block = finalizeBlocker(l.dx);
      if (block) return fail(block);
      const added = finalizeDx(l.dx, c.by, c.at, c.newId('dx'));
      return done(`Diagnosis akhir ditetapkan · ${jam} · ${added.length} diagnosis`, { dx: added });
    }
    case 'teratasi': {
      const p = current(l.problems).find((x) => x.id === op.problemId);
      if (!p) return fail('Masalah tidak ditemukan.');
      if (p.status === 'teratasi') return fail('Masalah sudah teratasi.');
      if (op.date > c.today) return fail('Tanggal teratasi tidak boleh di masa depan.');
      const resolved = resolveProblem(p, {
        resolvedOn: op.date,
        note: op.note,
        by: c.by,
        at: c.at,
        id: c.newId('masalah')(0),
      });
      return done(`${p.code} ditandai teratasi · ${jam} (versi baru)`, { problems: [resolved] });
    }
    case 'tambah-alergi': {
      const block = addAllergyBlocker(l.allergies, op.substance, op.reaction);
      if (block) return fail(block);
      const a: AllergyEntry = {
        id: c.newId('alergi')(0),
        version: 1,
        supersedesId: null,
        by: c.by,
        at: c.at,
        substance: op.substance.trim(),
        reaction: op.reaction.trim(),
        severity: op.severity,
        status: 'aktif',
        reason: null,
      };
      return done(`Alergi ${a.substance} tercatat · ${jam}; banner pasien dan CDS memakai data ini`, {
        allergies: [a],
        nkda: l.nkdaAt ? 'hapus' : null,
      });
    }
    case 'salah-alergi': {
      const a = activeAllergies(l.allergies).find((x) => x.id === op.allergyId);
      if (!a) return fail('Alergi tidak ditemukan.');
      if (!hasReason(op.reason)) return fail('Alasan salah entri minimal 10 karakter.');
      return done(`Alergi ${a.substance} ditandai salah entri · ${jam}`, {
        allergies: [markAllergyError(a, op.reason, c.by, c.at, c.newId('alergi')(0))],
      });
    }
    case 'nkda': {
      const block = nkdaBlocker(l.allergies);
      if (block) return fail(block);
      return done(`NKDA diverifikasi · ${jam}`, { nkda: 'verifikasi' });
    }
    case 'tambah-prosedur': {
      const code = c.icd9.find((x) => x.code === op.code);
      if (!code) return fail('Kode ICD-9-CM tidak ada di rujukan terminologi RS.');
      if (l.procs.some((p) => p.code === code.code)) return fail(`Prosedur ${code.code} sudah tercatat.`);
      const p: ProcedureEntry = {
        id: c.newId('proc')(0),
        code: code.code,
        display: code.display,
        by: c.by,
        at: c.at,
      };
      return done(`Prosedur ${code.code} ${code.display} tercatat · ${jam}`, { procs: [p] });
    }
  }
}
