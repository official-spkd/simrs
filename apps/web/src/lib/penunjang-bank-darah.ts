import type { SupportPatient } from '@simrs/shared';

/**
 * S08 · Bank darah (mode presentasi, ADR-0023): permintaan → golongan darah pasien → crossmatch → pengeluaran
 * kantong dengan cek ganda dua petugas → pindai gelang + kantong di samping pasien → pemantauan reaksi transfusi.
 * Aturan mengikuti rencana fase 4 §4.9 dan keputusan #22: kantong ABO/Rh-inkompatibel atau kedaluwarsa tidak
 * pernah keluar (tanpa override); salah pasien/kantong di samping pasien memblokir tanpa override.
 */

export type Abo = 'O' | 'A' | 'B' | 'AB';
export type Rh = '+' | '-';
export type BloodComponent = 'PRC' | 'TC' | 'FFP';

export const COMPONENT_LABEL: Record<BloodComponent, string> = {
  PRC: 'Packed red cell (PRC)',
  TC: 'Trombosit konsentrat (TC)',
  FFP: 'Fresh frozen plasma (FFP)',
};

export interface BloodUnit {
  id: string;
  bagNo: string;
  component: BloodComponent;
  abo: Abo;
  rh: Rh;
  volumeMl: number;
  /** `YYYY-MM-DD`. */
  expiry: string;
  status: 'tersedia' | 'dicadangkan' | 'dikeluarkan';
  /** Id permintaan yang memegang kantong (dicadangkan/dikeluarkan). */
  requestId: string | null;
}

export type RequestStage = 'permintaan' | 'golongan' | 'crossmatch' | 'pengeluaran' | 'transfusi' | 'selesai';

export const STAGES: ReadonlyArray<{ id: RequestStage; label: string }> = [
  { id: 'permintaan', label: 'Terima permintaan' },
  { id: 'golongan', label: 'Golongan darah' },
  { id: 'crossmatch', label: 'Crossmatch' },
  { id: 'pengeluaran', label: 'Cek ganda & keluar' },
  { id: 'transfusi', label: 'Di samping pasien' },
  { id: 'selesai', label: 'Selesai' },
];

export interface Vitals {
  at: string;
  label: string;
  tempC: number;
  systolic: number;
  diastolic: number;
  pulse: number;
}

export interface Crossmatch {
  unitId: string;
  result: 'kompatibel' | 'inkompatibel';
  at: string;
  by: string;
}

export interface BloodRequest {
  id: string;
  patient: SupportPatient;
  location: string;
  dpjp: string;
  component: BloodComponent;
  units: number;
  indication: string;
  urgency: 'rutin' | 'cito';
  requestedAt: string;
  /** Diterima bank darah (sampel cocok label). */
  receivedAt: string | null;
  /** Golongan pasien; `groupSource` menjelaskan asalnya (LIS / diperiksa BDRS). */
  abo: Abo | null;
  rh: Rh | null;
  groupSource: string | null;
  crossmatches: readonly Crossmatch[];
  /** Kantong yang sudah dikeluarkan dengan cek ganda. */
  issued: ReadonlyArray<{ unitId: string; at: string; checkers: readonly [string, string] }>;
  /** Kantong yang telah ditransfusikan sebelum kantong aktif. */
  transfusions?: ReadonlyArray<NonNullable<BloodRequest['transfusion']>>;
  /** Transfusi berjalan (kantong yang dipasang + TTV). */
  transfusion: {
    unitId: string;
    startedAt: string;
    verifiedBy: string;
    manualReason: string | null;
    vitals: readonly Vitals[];
    reaction: { at: string; signs: readonly string[] } | null;
    finishedAt: string | null;
  } | null;
}

// ─── Kompatibilitas ─────────────────────────────────────────────────────────────────────────────────────────

const RED_CELL: Record<Abo, readonly Abo[]> = {
  O: ['O'],
  A: ['A', 'O'],
  B: ['B', 'O'],
  AB: ['AB', 'A', 'B', 'O'],
};
const PLASMA: Record<Abo, readonly Abo[]> = {
  O: ['O', 'A', 'B', 'AB'],
  A: ['A', 'AB'],
  B: ['B', 'AB'],
  AB: ['AB'],
};

/**
 * Tabel kompatibilitas ABO/Rh: sel darah merah (PRC) mengikuti antigen donor; plasma dan trombosit mengikuti
 * antibodi donor (AB = donor plasma universal). Rh-negatif hanya menerima sel Rh-negatif.
 */
export function compatible(
  patient: { abo: Abo; rh: Rh },
  unit: Pick<BloodUnit, 'abo' | 'rh' | 'component'>,
): boolean {
  if (unit.component === 'PRC') {
    if (patient.rh === '-' && unit.rh === '+') return false;
    return RED_CELL[patient.abo].includes(unit.abo);
  }
  return PLASMA[patient.abo].includes(unit.abo);
}

const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
export const isExpired = (u: Pick<BloodUnit, 'expiry'>, today: string) => dayNum(u.expiry) < dayNum(today);

export function stageOf(r: BloodRequest): RequestStage {
  if (r.transfusion?.reaction) return 'selesai';
  if (r.transfusion?.finishedAt && (r.transfusions?.length ?? 0) + 1 >= r.units) return 'selesai';
  if (r.transfusion) return 'transfusi';
  if (r.issued.length > 0) return 'transfusi';
  if (!r.receivedAt) return 'permintaan';
  if (!r.abo || !r.rh) return 'golongan';
  const ok = r.crossmatches.filter((c) => c.result === 'kompatibel').length;
  if (ok < r.units) return 'crossmatch';
  return 'pengeluaran';
}

export type BloodGateCode =
  | 'GROUP_REQUIRED'
  | 'BAG_UNAVAILABLE'
  | 'BAG_EXPIRED'
  | 'COMPONENT_MISMATCH'
  | 'ABO_INCOMPATIBLE'
  | 'CROSSMATCH_REQUIRED'
  | 'CHECKER_REQUIRED'
  | 'CHECKER_SAME'
  | 'CHECKLIST_INCOMPLETE'
  | 'WRONG_PATIENT'
  | 'WRONG_BAG'
  | 'MANUAL_REASON'
  | 'MANUAL_IDENTITY'
  | 'NOT_ISSUED';

export const BLOOD_GATE_TEXT: Record<BloodGateCode, string> = {
  GROUP_REQUIRED: 'Golongan darah pasien (ABO dan Rh) belum diperiksa.',
  BAG_UNAVAILABLE: 'Kantong tidak tersedia (sudah dicadangkan atau dikeluarkan untuk pasien lain).',
  BAG_EXPIRED: 'Kantong kedaluwarsa tidak boleh dipakai.',
  COMPONENT_MISMATCH: 'Komponen kantong tidak sesuai permintaan.',
  ABO_INCOMPATIBLE:
    'Golongan kantong tidak kompatibel dengan pasien. Kantong ABO/Rh-inkompatibel tidak pernah keluar.',
  CROSSMATCH_REQUIRED: 'Kantong belum crossmatch kompatibel dengan pasien ini.',
  CHECKER_REQUIRED: 'Cek ganda wajib dua petugas (nama masing-masing minimal 5 karakter).',
  CHECKER_SAME: 'Petugas pemeriksa kedua harus orang lain.',
  CHECKLIST_INCOMPLETE: 'Semua butir cek ganda wajib dicentang.',
  WRONG_PATIENT: 'Gelang pasien tidak cocok dengan permintaan. Hentikan: jangan pasang kantong.',
  WRONG_BAG: 'Nomor kantong tidak cocok dengan kantong yang dikeluarkan untuk pasien ini.',
  MANUAL_REASON:
    'Verifikasi manual (barcode tidak terbaca) wajib alasan minimal 10 karakter dan nama petugas kedua.',
  MANUAL_IDENTITY:
    'Verifikasi manual: kedua petugas wajib mencocokkan nama, tanggal lahir, dan No. RM di gelang dengan label kantong.',
  NOT_ISSUED: 'Kantong ini belum dikeluarkan untuk pasien ini.',
};

/** Gerbang memilih kantong untuk crossmatch: golongan diketahui, kantong tersedia, belum ED, komponen dan ABO/Rh cocok. */
export function unitGate(r: BloodRequest, u: BloodUnit, today: string): BloodGateCode | null {
  if (!r.abo || !r.rh) return 'GROUP_REQUIRED';
  if (u.component !== r.component) return 'COMPONENT_MISMATCH';
  if (isExpired(u, today)) return 'BAG_EXPIRED';
  if (u.status !== 'tersedia' && u.requestId !== r.id) return 'BAG_UNAVAILABLE';
  if (!compatible({ abo: r.abo, rh: r.rh }, u)) return 'ABO_INCOMPATIBLE';
  return null;
}

export const ISSUE_CHECKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'identitas', label: 'Nama, RM, dan tanggal lahir pasien sama di formulir dan label kantong' },
  { id: 'nomor', label: 'Nomor kantong sama dengan hasil crossmatch' },
  { id: 'golongan', label: 'Golongan ABO/Rh kantong kompatibel dengan pasien' },
  { id: 'ed', label: 'Tanggal kedaluwarsa belum lewat; kantong utuh, tidak hemolisis/bekuan' },
  { id: 'crossmatch', label: 'Hasil crossmatch kompatibel dan ditandatangani' },
];

/** Gerbang pengeluaran kantong: crossmatch kompatibel + dua petugas berbeda + semua butir cek ganda. */
export function issueGate(
  r: BloodRequest,
  u: BloodUnit,
  today: string,
  check: { first: string; second: string; items: Readonly<Record<string, boolean>> },
  checkerIds?: readonly [string, string],
): BloodGateCode | null {
  const g = unitGate(r, u, today);
  if (g) return g;
  if (!r.crossmatches.some((c) => c.unitId === u.id && c.result === 'kompatibel'))
    return 'CROSSMATCH_REQUIRED';
  const a = check.first.trim();
  const b = check.second.trim();
  if (checkerIds) {
    if (!checkerIds[0] || !checkerIds[1] || !a || !b) return 'CHECKER_REQUIRED';
    if (checkerIds[0] === checkerIds[1]) return 'CHECKER_SAME';
  } else {
    if (a.length < 5 || b.length < 5) return 'CHECKER_REQUIRED';
    if (a.toLowerCase() === b.toLowerCase()) return 'CHECKER_SAME';
  }
  if (!ISSUE_CHECKS.every((c) => check.items[c.id])) return 'CHECKLIST_INCOMPLETE';
  return null;
}

/** Isian verifikasi manual di samping pasien (barcode tidak terbaca). */
export interface ManualBedside {
  reason: string;
  /** Petugas kedua: orang lain dari petugas yang memasang. */
  secondVerifier: string;
  /** Kedua petugas sudah mencocokkan nama, tanggal lahir, dan No. RM gelang dengan label kantong. */
  identityConfirmed: boolean;
}

/** Gerbang verifikasi manual (dipakai juga Server Action): alasan, identitas dicocokkan, petugas kedua orang lain. */
export function manualBedsideGate(m: ManualBedside, by: string): BloodGateCode | null {
  if (m.reason.trim().length < 10 || m.secondVerifier.trim().length < 5) return 'MANUAL_REASON';
  if (!m.identityConfirmed) return 'MANUAL_IDENTITY';
  if (m.secondVerifier.trim().toLowerCase() === by.trim().toLowerCase()) return 'CHECKER_SAME';
  return null;
}

/**
 * Gerbang di samping pasien: pindai gelang (RM) dan kantong. Salah pasien/kantong memblokir tanpa override.
 * Hanya bila barcode tidak terbaca, verifikasi manual dua petugas BERBEDA yang mencocokkan identitas gelang ↔ label
 * kantong, dengan alasan tercatat.
 */
export function bedsideGate(
  r: BloodRequest,
  input: { wristband: string; bag: string; manual?: ManualBedside },
  units: readonly BloodUnit[],
  by: string,
): { code: BloodGateCode } | { unitId: string; manual: boolean } {
  const completed = new Set(
    (r.transfusions ?? [])
      .map((t) => t.unitId)
      .concat(r.transfusion?.finishedAt ? [r.transfusion.unitId] : []),
  );
  const issuedUnits = r.issued
    .filter((i) => !completed.has(i.unitId))
    .map((i) => units.find((u) => u.id === i.unitId))
    .filter((u) => !!u);
  if (input.manual) {
    const code = manualBedsideGate(input.manual, by);
    if (code) return { code };
    const u =
      issuedUnits.find((u) => u.bagNo === input.bag) ??
      (issuedUnits.length === 1 ? issuedUnits[0] : undefined);
    return u ? { unitId: u.id, manual: true } : { code: 'NOT_ISSUED' };
  }
  const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  if (norm(input.wristband) !== norm(r.patient.rm)) return { code: 'WRONG_PATIENT' };
  const u = issuedUnits.find((x) => norm(x.bagNo) === norm(input.bag));
  if (!u) return { code: 'WRONG_BAG' };
  return { unitId: u.id, manual: false };
}

export const REACTION_SIGNS = [
  'Menggigil',
  'Gatal / urtikaria',
  'Sesak napas',
  'Nyeri dada / pinggang',
  'Urine gelap',
] as const;

/**
 * Deteksi reaksi transfusi: gejala apa pun, suhu naik ≥ 1 °C dari awal, atau sistolik turun ≥ 30 mmHg →
 * transfusi dihentikan, jalur infus dipertahankan dengan NaCl 0,9%, DPJP dan bank darah dilapori.
 */
export function reactionCheck(
  baseline: Pick<Vitals, 'tempC' | 'systolic'>,
  current: Pick<Vitals, 'tempC' | 'systolic'>,
  signs: readonly string[],
): { reaction: boolean; reasons: string[] } {
  const reasons: string[] = [...signs];
  if (current.tempC - baseline.tempC >= 1)
    reasons.push(`Suhu naik ${(current.tempC - baseline.tempC).toFixed(1).replace('.', ',')} °C`);
  if (baseline.systolic - current.systolic >= 30)
    reasons.push(`Sistolik turun ${baseline.systolic - current.systolic} mmHg`);
  return { reaction: reasons.length > 0, reasons };
}

/** Jadwal TTV transfusi: awal, 15 menit, lalu tiap jam sampai selesai. */
export const VITALS_PLAN = ['Sebelum mulai', '15 menit', '1 jam', 'Selesai'] as const;

// ─── Keadaan lokal sesi (simulasi) ──────────────────────────────────────────────────────────────────────────

export interface BloodState {
  requests: readonly BloodRequest[];
  units: readonly BloodUnit[];
}

export type BloodAction =
  | { type: 'terima'; requestId: string }
  | { type: 'golongan'; requestId: string; abo: Abo; rh: Rh }
  | { type: 'crossmatch'; requestId: string; unitId: string; result: Crossmatch['result'] }
  | {
      type: 'keluarkan';
      requestId: string;
      unitId: string;
      first: string;
      second: string;
      items: Readonly<Record<string, boolean>>;
    }
  | {
      type: 'pasang';
      requestId: string;
      wristband: string;
      bag: string;
      manual?: ManualBedside;
      baseline: Omit<Vitals, 'at' | 'label'>;
    }
  | {
      type: 'ttv';
      requestId: string;
      label: string;
      vitals: Omit<Vitals, 'at' | 'label'>;
      signs: readonly string[];
    }
  | { type: 'selesai'; requestId: string };

export type BloodResult =
  | { ok: true; state: BloodState; message: string; reaction?: string[] }
  | { ok: false; code: BloodGateCode | 'REQUEST_UNKNOWN' | 'STAGE'; message: string };

const failB = (code: BloodGateCode): BloodResult => ({ ok: false, code, message: BLOOD_GATE_TEXT[code] });
const stageFail = (message: string): BloodResult => ({ ok: false, code: 'STAGE', message });

/** Terapkan satu langkah bank darah pada keadaan lokal; setiap gerbang dievaluasi sebelum keadaan berubah. */
export function applyBlood(
  state: BloodState,
  a: BloodAction,
  ctx: { at: string; by: string; today: string; checkerIds?: readonly [string, string] },
): BloodResult {
  const r = state.requests.find((x) => x.id === a.requestId);
  if (!r) return { ok: false, code: 'REQUEST_UNKNOWN', message: 'Permintaan darah tidak ditemukan.' };
  const put = (next: BloodRequest, units = state.units): BloodState => ({
    requests: state.requests.map((x) => (x.id === r.id ? next : x)),
    units,
  });
  const unitById = (id: string) => state.units.find((u) => u.id === id);
  switch (a.type) {
    case 'terima':
      if (r.receivedAt) return stageFail('Permintaan sudah diterima.');
      return {
        ok: true,
        state: put({ ...r, receivedAt: ctx.at }),
        message: `Permintaan dan sampel ${r.patient.name} diterima, label cocok`,
      };
    case 'golongan':
      if (!r.receivedAt) return stageFail('Terima permintaan dan sampel dulu.');
      if (r.crossmatches.length || r.issued.length) return stageFail('Golongan terkunci setelah crossmatch.');
      return {
        ok: true,
        state: put({ ...r, abo: a.abo, rh: a.rh, groupSource: `Diperiksa bank darah oleh ${ctx.by}` }),
        message: `Golongan darah ${r.patient.name}: ${a.abo} Rh${a.rh === '+' ? '+' : '−'}`,
      };
    case 'crossmatch': {
      const u = unitById(a.unitId);
      if (!u) return failB('BAG_UNAVAILABLE');
      const g = unitGate(r, u, ctx.today);
      if (g) return failB(g);
      if (r.crossmatches.some((c) => c.unitId === u.id)) return stageFail('Kantong ini sudah di-crossmatch.');
      const cm: Crossmatch = { unitId: u.id, result: a.result, at: ctx.at, by: ctx.by };
      const units =
        a.result === 'kompatibel'
          ? state.units.map((x) =>
              x.id === u.id ? { ...x, status: 'dicadangkan' as const, requestId: r.id } : x,
            )
          : state.units;
      return {
        ok: true,
        state: put({ ...r, crossmatches: [...r.crossmatches, cm] }, units),
        message:
          a.result === 'kompatibel'
            ? `Crossmatch ${u.bagNo} kompatibel, kantong dicadangkan untuk ${r.patient.name}`
            : `Crossmatch ${u.bagNo} inkompatibel, kantong tidak dipakai untuk pasien ini`,
      };
    }
    case 'keluarkan': {
      if (r.issued.length >= r.units) return stageFail('Jumlah kantong sesuai permintaan sudah dikeluarkan.');
      const u = unitById(a.unitId);
      if (!u) return failB('BAG_UNAVAILABLE');
      if (r.issued.some((i) => i.unitId === u.id)) return stageFail('Kantong ini sudah dikeluarkan.');
      const g = issueGate(r, u, ctx.today, a, ctx.checkerIds);
      if (g) return failB(g);
      return {
        ok: true,
        state: put(
          {
            ...r,
            issued: [...r.issued, { unitId: u.id, at: ctx.at, checkers: [a.first.trim(), a.second.trim()] }],
          },
          state.units.map((x) =>
            x.id === u.id ? { ...x, status: 'dikeluarkan' as const, requestId: r.id } : x,
          ),
        ),
        message: `Kantong ${u.bagNo} dikeluarkan setelah cek ganda ${a.first.trim()} dan ${a.second.trim()}`,
      };
    }
    case 'pasang': {
      if (r.transfusion && !r.transfusion.finishedAt)
        return stageFail('Transfusi sudah berjalan atau dihentikan karena reaksi.');
      const g = bedsideGate(r, a, state.units, ctx.by);
      if ('code' in g) return failB(g.code);
      const u = unitById(g.unitId);
      return {
        ok: true,
        state: put({
          ...r,
          transfusions: r.transfusion ? [...(r.transfusions ?? []), r.transfusion] : r.transfusions,
          transfusion: {
            unitId: g.unitId,
            startedAt: ctx.at,
            verifiedBy: a.manual ? `${ctx.by} + ${a.manual.secondVerifier.trim()}` : ctx.by,
            manualReason: a.manual ? a.manual.reason.trim() : null,
            vitals: [{ ...a.baseline, at: ctx.at, label: 'Sebelum mulai' }],
            reaction: null,
            finishedAt: null,
          },
        }),
        message: g.manual
          ? `Transfusi ${u?.bagNo ?? ''} dimulai dengan verifikasi manual dua petugas (alasan tercatat)`
          : `Gelang dan kantong ${u?.bagNo ?? ''} cocok, transfusi dimulai`,
      };
    }
    case 'ttv': {
      const t = r.transfusion;
      if (!t || t.finishedAt || t.reaction) return stageFail('Tidak ada transfusi yang berjalan.');
      const base = t.vitals[0];
      const check = base ? reactionCheck(base, a.vitals, a.signs) : { reaction: false, reasons: [] };
      const vitals = [...t.vitals, { ...a.vitals, at: ctx.at, label: a.label }];
      if (check.reaction) {
        return {
          ok: true,
          state: put({ ...r, transfusion: { ...t, vitals, reaction: { at: ctx.at, signs: check.reasons } } }),
          message: `Dugaan reaksi transfusi: ${check.reasons.join(', ')}. Transfusi dihentikan, DPJP dan bank darah dilapori`,
          reaction: check.reasons,
        };
      }
      return {
        ok: true,
        state: put({ ...r, transfusion: { ...t, vitals } }),
        message: `TTV ${a.label} dicatat, tanpa tanda reaksi`,
      };
    }
    case 'selesai': {
      const t = r.transfusion;
      if (!t || t.finishedAt || t.reaction) return stageFail('Tidak ada transfusi yang berjalan.');
      if (!t.vitals.some((v) => v.label === '15 menit'))
        return stageFail('Catat TTV 15 menit sebelum menutup transfusi.');
      return {
        ok: true,
        state: put({ ...r, transfusion: { ...t, finishedAt: ctx.at } }),
        message: `Transfusi ${r.patient.name} selesai tanpa reaksi`,
      };
    }
  }
}
