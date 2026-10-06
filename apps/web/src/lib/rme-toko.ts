import {
  CONSCIOUSNESS,
  CPPT_ROLES,
  type CpptEntry,
  type CpptRole,
  type EwsObservation,
  type InpatientDetail,
  type InpatientFlag,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { z } from 'zod';
import { type DemoActor, defineDomain, type DomainEvent } from './demo/store/define';
import { emarGivenLabel, emarKey, ewsMaxParam, newCpptEntry, supersededIds } from './rawat-inap';
import type { EvalResult, NursingDx, Shift, ShiftEval } from './rme-askep';
import type { Handover, Sbar } from './rme-cppt';
import {
  type RmeExtraEvent,
  rmeExtraEventSchema,
  reduceRmeExtra,
  rmeExtraConflict,
  type RmeExtraState,
  RME_EXTRA_INITIAL,
} from './rme-toko-bagan';

/**
 * Toko demo bersama (ADR-0085) · domain `rekam-medis`: rekam medis elektronik pasien yang dipakai bersama layar
 * Rawat inap (CPPT, eMAR, observasi, askep) dan layar bagan RME (worklist, CPPT, asesmen, diagnosis, konsultasi,
 * edukasi, asuhan keperawatan, ringkasan, paket layanan, kelengkapan). Satu domain agar co-sign di worklist tampil di
 * CPPT, Rawat inap, dan Kelengkapan; pemberian obat di Asuhan keperawatan tercatat di eMAR Rawat inap.
 *
 * Entri klinis immutable (CLAUDE.md §4.2): kejadian hanya menambah (CPPT baru/koreksi berversi/addendum, atestasi,
 * pemberian, observasi). Pelaku (`ev.actor`) dan jam dihitung server; gerbang yang butuh fixture (gelang = RM,
 * obat/slot eMAR, penulis catatan) diperiksa Server Action sebelum `commitEvent`. Reducer murni menolak duplikat.
 */

const encounterId = z.string().min(1).max(60);
const isoInstant = z.iso.datetime({ offset: true });
const hm = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
const isoDate = z.iso.date();
const shift = z.enum(['pagi', 'siang', 'malam']);
const name = z.string().trim().min(1).max(80);
const longText = (max: number) => z.string().trim().max(max);

export const rekamCoreEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** CPPT baru (versi 1), koreksi (versi + 1, alasan wajib), atau addendum PPA lain. */
    type: z.literal('cppt.ditulis'),
    encounterId,
    role: z.enum(CPPT_ROLES),
    s: z.string().trim().min(1).max(1000),
    o: longText(1000),
    a: z.string().trim().min(1).max(1000),
    p: longText(1000),
    version: z.int().min(1).max(99),
    supersedesId: z.string().min(1).max(80).nullable(),
    correctionReason: z.string().trim().min(SAFETY_REASON_MIN).max(500).nullable(),
    addendumOf: z.string().min(1).max(80).nullable(),
    /** Jam pencatatan kunjungan (server). */
    writtenAt: isoInstant,
  }),
  z.strictObject({
    type: z.literal('cppt.cosign'),
    encounterId,
    entryId: z.string().min(1).max(80),
    at: isoInstant,
  }),
  z.strictObject({
    type: z.literal('cppt.verifikasi'),
    encounterId,
    entryId: z.string().min(1).max(80),
    at: isoInstant,
  }),
  z.strictObject({
    /** Satu dosis eMAR tercatat (gelang/override, label obat, terlambat, cek ganda sudah diperiksa server). */
    type: z.literal('emar.diberikan'),
    encounterId,
    medicationId: z.string().min(1).max(80),
    /** Slot jadwal `HH.MM`. */
    time: hm,
    /** Jam pemberian `HH.MM` (jam kunjungan server). */
    at: hm,
    /** Instan pemberian (ISO), untuk tagihan dan urutan. */
    givenAt: isoInstant,
    name: name,
    late: z.boolean(),
    lateReason: z.string().trim().min(SAFETY_REASON_MIN).max(500).nullable(),
    doubleCheckedBy: name.nullable(),
    /** Identitas lewat override verifikasi manual (bukan pindai gelang). */
    override: z.boolean(),
    overrideReason: z.string().trim().min(SAFETY_REASON_MIN).max(500).nullable(),
    /** Kode KFA obat (untuk tagihan farmasi), null bila belum dipetakan. */
    kfa: z
      .string()
      .regex(/^\d{8}$/)
      .nullable(),
    /** Layar asal: Rawat inap (grid eMAR) atau Asuhan keperawatan (ronde obat). */
    via: z.enum(['ranap', 'askep']),
  }),
  z.strictObject({
    type: z.literal('observasi.dicatat'),
    encounterId,
    at: isoInstant,
    temp: z.number().min(30).max(45),
    hr: z.int().min(20).max(250),
    rr: z.int().min(4).max(60),
    sbp: z.int().min(40).max(260),
    dbp: z.int().min(20).max(160),
    spo2: z.int().min(50).max(100),
    onOxygen: z.boolean(),
    consciousness: z.enum(CONSCIOUSNESS),
    score: z.int().min(0).max(20),
  }),
  z.strictObject({
    type: z.literal('askep.intervensi'),
    encounterId,
    dxId: z.string().min(1).max(100),
    interventionId: z.string().min(1).max(100),
    shift,
    date: isoDate,
    at: isoInstant,
  }),
  z.strictObject({
    type: z.literal('askep.evaluasi'),
    encounterId,
    dxId: z.string().min(1).max(100),
    shift,
    date: isoDate,
    s: longText(500),
    o: z.string().trim().min(1).max(500),
    result: z.enum(['teratasi', 'sebagian', 'belum']),
    p: z.string().trim().min(1).max(500),
    at: isoInstant,
  }),
  z.strictObject({
    type: z.literal('askep.diagnosis'),
    encounterId,
    label: name,
    outcome: z.string().trim().min(1).max(300),
    interventions: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
    since: isoDate,
    at: isoInstant,
  }),
  z.strictObject({
    type: z.literal('serahterima.diserahkan'),
    encounterId,
    shift: z.string().trim().min(1).max(40),
    receiver: name,
    sbar: z.strictObject({
      s: z.string().trim().min(1).max(600),
      b: z.string().trim().min(1).max(600),
      a: z.string().trim().min(1).max(600),
      r: z.string().trim().min(1).max(600),
    }),
    at: isoInstant,
  }),
  z.strictObject({
    type: z.literal('serahterima.diterima'),
    encounterId,
    handoverId: z.string().min(1).max(100),
    at: isoInstant,
  }),
  z.strictObject({
    /** Tugas worklist diselesaikan langsung di worklist (baca ulang nilai kritis, tandai dibaca, setujui order). */
    type: z.literal('worklist.selesai'),
    encounterId,
    taskId: z.string().min(1).max(120),
    note: z.string().trim().min(1).max(200),
    at: isoInstant,
  }),
]);
export type RekamCoreEvent = z.infer<typeof rekamCoreEventSchema>;

export const rekamEventSchema = z.union([rekamCoreEventSchema, rmeExtraEventSchema]);
export type RekamEvent = RekamCoreEvent | RmeExtraEvent;

/** Atestasi (co-sign, verifikasi, intervensi): nama dan id pengguna sesi + jam. */
export interface RekamSign {
  by: string;
  byId: string;
  at: string;
}

export interface StoredCppt {
  entry: CpptEntry;
  /** Id pengguna penulis (pemisahan tugas: co-sign/koreksi dibandingkan dengan id, bukan nama). */
  authorId: string;
}

export interface StoredDose {
  encounterId: string;
  medicationId: string;
  name: string;
  time: string;
  at: string;
  givenAt: string;
  late: boolean;
  lateReason: string | null;
  doubleCheckedBy: string | null;
  override: boolean;
  overrideReason: string | null;
  kfa: string | null;
  via: 'ranap' | 'askep';
  by: string;
  byId: string;
}

export interface StoredObservation {
  encounterId: string;
  obs: EwsObservation;
  by: string;
}

export interface StoredHandover extends Handover {
  encounterId: string;
  giverId: string;
  acceptedBy: string | null;
}

export interface StoredWorklistDone extends RekamSign {
  encounterId: string;
  note: string;
}

export interface RekamCoreState {
  cppt: readonly StoredCppt[];
  cosign: Readonly<Record<string, RekamSign>>;
  verify: Readonly<Record<string, RekamSign>>;
  doses: readonly StoredDose[];
  observations: readonly StoredObservation[];
  /** Intervensi keperawatan dikerjakan: kunci `interventionKey(dx, intv, shift, date)`. */
  askepDone: Readonly<Record<string, RekamSign>>;
  askepEvals: readonly (ShiftEval & { encounterId: string })[];
  askepDx: readonly (NursingDx & { encounterId: string })[];
  handovers: readonly StoredHandover[];
  worklist: Readonly<Record<string, StoredWorklistDone>>;
}

export type RekamState = RekamCoreState & RmeExtraState;

export const REKAM_INITIAL: RekamCoreState = {
  cppt: [],
  cosign: {},
  verify: {},
  doses: [],
  observations: [],
  askepDone: {},
  askepEvals: [],
  askepDx: [],
  handovers: [],
  worklist: {},
};

const sign = (ev: { actor: DemoActor }, at: string): RekamSign => ({
  by: ev.actor.name,
  byId: ev.actor.userId,
  at,
});

/** Id CPPT tersimpan: id kunjungan + urutan kejadian (unik per ruang data). */
export const storedCpptId = (encounterId: string, seq: number) => `${encounterId}-cppt-t${seq}`;
/** Id diagnosis keperawatan tambahan. */
export const storedAskepDxId = (encounterId: string, seq: number) => `${encounterId}-askep-t${seq}`;
/** Id serah terima tersimpan. */
export const storedHandoverId = (encounterId: string, seq: number) => `${encounterId}-sbar-t${seq}`;

export const askepKey = (dxId: string, intvId: string, s: Shift, date: string) =>
  `${dxId}|${intvId}|${s}|${date}`;

/** Konflik kejadian inti terhadap keadaan (duplikat atestasi/pemberian). Null = boleh. */
export function rekamCoreConflict(s: RekamCoreState, d: RekamCoreEvent): string | null {
  switch (d.type) {
    case 'cppt.ditulis':
      if (d.supersedesId && s.cppt.some((c) => c.entry.supersedesId === d.supersedesId))
        return 'Entri ini sudah dikoreksi; koreksi versi terbaru.';
      return null;
    case 'cppt.cosign':
      return s.cosign[d.entryId] ? 'Sudah di-co-sign DPJP.' : null;
    case 'cppt.verifikasi':
      return s.verify[d.entryId] ? 'Sudah diverifikasi DPJP.' : null;
    case 'emar.diberikan':
      return s.doses.some(
        (x) => x.encounterId === d.encounterId && x.medicationId === d.medicationId && x.time === d.time,
      )
        ? `${d.name} jam ${d.time} sudah tercatat diberikan.`
        : null;
    case 'askep.intervensi':
      return s.askepDone[askepKey(d.dxId, d.interventionId, d.shift, d.date)]
        ? 'Intervensi ini sudah tercatat pada shift ini.'
        : null;
    case 'askep.evaluasi':
      return s.askepEvals.some((e) => e.dxId === d.dxId && e.shift === d.shift && e.date === d.date)
        ? 'Evaluasi diagnosis ini sudah final pada shift ini.'
        : null;
    case 'askep.diagnosis':
      return s.askepDx.some((x) => x.encounterId === d.encounterId && x.label === d.label)
        ? `Diagnosis keperawatan ${d.label} sudah ada.`
        : null;
    case 'serahterima.diterima': {
      const h = s.handovers.find((x) => x.id === d.handoverId);
      if (!h) return 'Serah terima tidak ditemukan.';
      return h.acceptedAt ? 'Serah terima sudah dikonfirmasi penerima.' : null;
    }
    case 'serahterima.diserahkan':
      return s.handovers.some((x) => x.encounterId === d.encounterId && !x.acceptedAt)
        ? 'Masih ada serah terima yang menunggu konfirmasi penerima.'
        : null;
    case 'worklist.selesai':
      return s.worklist[d.taskId] ? 'Tugas ini sudah diselesaikan.' : null;
    case 'observasi.dicatat':
      return null;
  }
}

function reduceCore(s: RekamState, ev: DomainEvent<RekamCoreEvent>): RekamState {
  const d = ev.data;
  const conflict = rekamCoreConflict(s, d);
  if (conflict) throw new Error(conflict);
  switch (d.type) {
    case 'cppt.ditulis': {
      const base = newCpptEntry({
        id: storedCpptId(d.encounterId, ev.seq),
        encounterId: d.encounterId,
        role: d.role,
        author: ev.actor.name,
        at: d.writtenAt,
        soap: { s: d.s, o: d.o, a: d.a, p: d.p },
        addendumOf: d.addendumOf,
      });
      const entry: CpptEntry = {
        ...base,
        version: d.version,
        supersedesId: d.supersedesId,
        correctionReason: d.correctionReason,
      };
      return { ...s, cppt: [...s.cppt, { entry, authorId: ev.actor.userId }] };
    }
    case 'cppt.cosign':
      return { ...s, cosign: { ...s.cosign, [d.entryId]: sign(ev, d.at) } };
    case 'cppt.verifikasi':
      return { ...s, verify: { ...s.verify, [d.entryId]: sign(ev, d.at) } };
    case 'emar.diberikan':
      return {
        ...s,
        doses: [
          ...s.doses,
          {
            encounterId: d.encounterId,
            medicationId: d.medicationId,
            name: d.name,
            time: d.time,
            at: d.at,
            givenAt: d.givenAt,
            late: d.late,
            lateReason: d.lateReason,
            doubleCheckedBy: d.doubleCheckedBy,
            override: d.override,
            overrideReason: d.overrideReason,
            kfa: d.kfa,
            via: d.via,
            by: ev.actor.name,
            byId: ev.actor.userId,
          },
        ],
      };
    case 'observasi.dicatat': {
      const { type: _t, encounterId: enc, ...obs } = d;
      return { ...s, observations: [...s.observations, { encounterId: enc, obs, by: ev.actor.name }] };
    }
    case 'askep.intervensi':
      return {
        ...s,
        askepDone: { ...s.askepDone, [askepKey(d.dxId, d.interventionId, d.shift, d.date)]: sign(ev, d.at) },
      };
    case 'askep.evaluasi':
      return {
        ...s,
        askepEvals: [
          ...s.askepEvals,
          {
            id: `${d.dxId}-eval-t${ev.seq}`,
            encounterId: d.encounterId,
            dxId: d.dxId,
            shift: d.shift,
            date: d.date,
            s: d.s,
            o: d.o,
            result: d.result as EvalResult,
            p: d.p,
            by: ev.actor.name,
            at: d.at,
          },
        ],
      };
    case 'askep.diagnosis': {
      const id = storedAskepDxId(d.encounterId, ev.seq);
      return {
        ...s,
        askepDx: [
          ...s.askepDx,
          {
            id,
            encounterId: d.encounterId,
            label: d.label,
            since: d.since,
            outcome: d.outcome,
            interventions: d.interventions.map((label, i) => ({ id: `${id}-i${i}`, label })),
          },
        ],
      };
    }
    case 'serahterima.diserahkan':
      return {
        ...s,
        handovers: [
          ...s.handovers,
          {
            id: storedHandoverId(d.encounterId, ev.seq),
            encounterId: d.encounterId,
            shift: d.shift,
            giver: ev.actor.name,
            giverId: ev.actor.userId,
            receiver: d.receiver,
            sbar: d.sbar as Sbar,
            givenAt: d.at,
            acceptedAt: null,
            acceptedBy: null,
          },
        ],
      };
    case 'serahterima.diterima':
      return {
        ...s,
        handovers: s.handovers.map((h) =>
          h.id === d.handoverId ? { ...h, acceptedAt: d.at, acceptedBy: ev.actor.name } : h,
        ),
      };
    case 'worklist.selesai':
      return {
        ...s,
        worklist: {
          ...s.worklist,
          [d.taskId]: { ...sign(ev, d.at), encounterId: d.encounterId, note: d.note },
        },
      };
  }
}

const isCore = (d: RekamEvent): d is RekamCoreEvent => rekamCoreEventSchema.safeParse(d).success;

/** Konflik kejadian apa pun terhadap keadaan (dipakai `validate` dan reducer). */
export function rekamConflict(s: RekamState, d: RekamEvent): string | null {
  return isCore(d) ? rekamCoreConflict(s, d) : rmeExtraConflict(s, d);
}

export const rekamDomain = defineDomain<RekamState, RekamEvent>('rekam-medis', {
  initial: () => ({ ...REKAM_INITIAL, ...RME_EXTRA_INITIAL }),
  eventSchema: rekamEventSchema as z.ZodType<RekamEvent>,
  screens: [
    'ranap',
    'worklist',
    'cppt',
    'asesmen',
    'diagnosis',
    'konsul',
    'edukasi',
    'askep',
    'ringkasan',
    'paket',
    'kelengkapan',
  ],
  validate: (s, ev) => rekamConflict(s, ev),
  reduce: (s, ev) =>
    isCore(ev.data)
      ? reduceCore(s, ev as DomainEvent<RekamCoreEvent>)
      : reduceRmeExtra(s, ev as DomainEvent<RmeExtraEvent>),
});

// ─── Penerapan ke rekam rawat inap (pengambil data) ─────────────────────────────────────────────────────────

/** CPPT kunjungan: rekam + tersimpan, dengan co-sign tersimpan diterapkan. */
export function cpptOf(base: readonly CpptEntry[], s: RekamCoreState, enc: string): CpptEntry[] {
  return [...base, ...s.cppt.filter((c) => c.entry.encounterId === enc).map((c) => c.entry)].map((e) => {
    const c = s.cosign[e.id];
    return c && !e.cosignedBy ? { ...e, cosignedBy: c.by, cosignedAt: c.at } : e;
  });
}

/** Penulis entri CPPT tersimpan (id pengguna), untuk pemisahan tugas sisi server. */
export function storedAuthorId(s: RekamCoreState, entryId: string): string | null {
  return s.cppt.find((c) => c.entry.id === entryId)?.authorId ?? null;
}

/** Pemberian tercatat per slot `<obat>|<jam>` → label slot ("✓ 12.03 · cek ganda" tanpa centang). */
export function emarGiven(s: RekamCoreState, enc: string): Record<string, string> {
  return Object.fromEntries(
    s.doses
      .filter((x) => x.encounterId === enc)
      .map((x) => [emarKey(x.medicationId, x.time), emarGivenLabel(x.at, x)]),
  );
}

export interface EmarLogLine {
  t: string;
  what: string;
  note: string;
}

/** Log "Pemberian tercatat" kunjungan (urut jam catat). */
export function emarLog(s: RekamCoreState, enc: string): EmarLogLine[] {
  return s.doses
    .filter((x) => x.encounterId === enc)
    .map((x) => ({
      t: x.at,
      what: x.name,
      note: `jadwal ${x.time}${x.late ? ` · terlambat · ${x.lateReason ?? ''}` : ''}${x.doubleCheckedBy ? ` · cek ganda ${x.doubleCheckedBy}` : ''}${x.override ? ' · identitas override beralasan' : ''} · ${x.by}`,
    }));
}

/**
 * Catatan pemberian per slot untuk ronde obat Asuhan keperawatan: "✓ Diberikan 10.52 · Ns. … · terlambat: … · cek
 * ganda …" (sumber sama dengan grid eMAR Rawat inap).
 */
export function askepGivenNotes(s: RekamCoreState, enc: string): Record<string, string> {
  return Object.fromEntries(
    s.doses
      .filter((x) => x.encounterId === enc)
      .map((x) => [
        emarKey(x.medicationId, x.time),
        `✓ Diberikan ${x.at} · ${x.by}${x.late ? ` · terlambat: ${x.lateReason ?? ''}` : ''}${x.doubleCheckedBy ? ` · cek ganda ${x.doubleCheckedBy}` : ''}`,
      ]),
  );
}

/** Rencana askep kunjungan + toko: diagnosis tambahan, intervensi dikerjakan, evaluasi shift. */
export function askepView(
  base: { dxs: readonly NursingDx[]; done: Readonly<Record<string, true>>; evals: readonly ShiftEval[] },
  s: RekamCoreState,
  enc: string,
) {
  const dxs = [...base.dxs, ...s.askepDx.filter((x) => x.encounterId === enc)];
  const ids = new Set(dxs.map((d) => d.id));
  const done: Record<string, { by: string; at: string } | true> = { ...base.done };
  for (const [k, v] of Object.entries(s.askepDone)) {
    if (ids.has(k.split('|')[0] ?? '')) done[k] = { by: v.by, at: v.at };
  }
  const evals = [...base.evals, ...s.askepEvals.filter((e) => e.encounterId === enc)];
  return { dxs, done, evals };
}

/** Shift askep dari jam `HH.MM` eMAR (rawat inap memakai pagi/sore/malam; askep pagi/siang/malam). */
export function askepShiftOf(hhmm: string): Shift {
  const h = Number(hhmm.slice(0, 2));
  if (h >= 7 && h < 14) return 'pagi';
  if (h >= 14 && h < 21) return 'siang';
  return 'malam';
}

/**
 * Rekam rawat inap + toko: CPPT tersimpan dan co-sign, observasi baru (EWS ringkasan ikut), intervensi askep shift
 * berjalan, penanda daftar (co-sign/obat terlambat) dihitung ulang dari rekam. `date` = tanggal shift berjalan.
 */
export function applyRekamInpatient(d: InpatientDetail, s: RekamCoreState, date: string): InpatientDetail {
  const enc = d.summary.encounterId;
  const cppt = cpptOf(d.cppt, s, enc);
  const observations = [
    ...d.observations,
    ...s.observations.filter((o) => o.encounterId === enc).map((o) => o.obs),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const last = observations.at(-1);
  const given = emarGiven(s, enc);
  const sh = askepShiftOf(d.emarNow);
  const nursing = d.nursing.map((n, i) => ({
    ...n,
    interventions: n.interventions.map((x) => ({
      ...x,
      done: x.done || !!s.askepDone[askepKey(`${enc}-askep-${i + 1}`, x.id, sh, date)],
    })),
  }));
  const old = supersededIds(cppt);
  const pendingCosign = cppt.some((e) => !old.has(e.id) && e.cosignRequired && !e.cosignedBy);
  const lateOpen = d.medications.some((m) =>
    m.slots.some((x) => x.state === 'terlambat' && !given[emarKey(m.id, x.time)]),
  );
  const flags = d.summary.flags.filter((f) => f !== 'cosign' && f !== 'emar-terlambat');
  const nextFlags: InpatientFlag[] = [
    ...(pendingCosign ? (['cosign'] as const) : []),
    ...(lateOpen ? (['emar-terlambat'] as const) : []),
    ...flags,
  ];
  return {
    ...d,
    cppt,
    observations,
    nursing,
    summary: {
      ...d.summary,
      flags: nextFlags,
      ...(last && last.at > (d.observations.at(-1)?.at ?? '')
        ? { lastEws: last.score, lastEwsMaxParam: ewsMaxParam(last) }
        : {}),
    },
  };
}

/** Peran penulis CPPT yang wajib co-sign (residen). */
export const needsCosign = (role: CpptRole) => role === 'residen';
