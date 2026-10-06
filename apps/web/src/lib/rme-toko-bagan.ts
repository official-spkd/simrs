import { formAnswersSchema } from '@simrs/shared';
import { z } from 'zod';
import type { DomainEvent } from './demo/store/define';
import type { AssessmentResponse } from './rme-asesmen';
import type { AllergyEntry, EncounterDx, Problem, ProcedureEntry } from './rme-diagnosis';
import type { EduRecord } from './rme-edukasi';
import type { PatientDocument } from './rme-kelengkapan';
import type { ConsultAnswer, ConsultRequest } from './rme-konsul';

/**
 * Toko demo `rekam-medis` (ADR-0085), bagian bagan RME FE2: asesmen, diagnosis + problem list + alergi, konsultasi,
 * edukasi, paket layanan, kelengkapan + tutup kunjungan. Kejadian membawa rekaman versi baru yang sudah dihitung
 * Server Action dari keadaan server (aturan murni di `lib/rme-*.ts`), sehingga reducer hanya menambahkan (append-only;
 * koreksi = versi baru, CLAUDE.md §4.2). Pelaku dan jam selalu dari sesi/server.
 */

const encounterId = z.string().min(1).max(60);
const isoInstant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const recId = z.string().min(1).max(120);
const name = z.string().trim().min(1).max(80);
const reason = z.string().trim().min(10).max(500);
const versioned = {
  id: recId,
  version: z.int().min(1).max(99),
  supersedesId: recId.nullable(),
  by: name,
  at: isoInstant,
};

export const assessmentRecordSchema = z.strictObject({
  id: recId,
  formCode: z.string().min(1).max(60),
  encounterId,
  version: z.int().min(1).max(99),
  answers: formAnswersSchema,
  at: isoInstant,
  supersedesId: recId.nullable(),
  reason: reason.nullable(),
});

const dxSchema = z.strictObject({
  ...versioned,
  code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/),
  display: z.string().min(1).max(120),
  rank: z.enum(['utama', 'sekunder', 'komplikasi']),
  certainty: z.enum(['kerja', 'akhir']),
  status: z.enum(['aktif', 'salah-entri']),
  reason: reason.nullable(),
});
const procSchema = z.strictObject({
  id: recId,
  code: z.string().min(1).max(10),
  display: z.string().min(1).max(120),
  by: name,
  at: isoInstant,
});
const problemSchema = z.strictObject({
  ...versioned,
  code: z.string().min(1).max(10),
  display: z.string().min(1).max(120),
  onset: isoDate,
  status: z.enum(['aktif', 'teratasi']),
  resolvedOn: isoDate.nullable(),
  note: z.string().max(300).nullable(),
});
const allergySchema = z.strictObject({
  ...versioned,
  substance: z.string().trim().min(1).max(80),
  reaction: z.string().trim().min(1).max(120),
  severity: z.enum(['ringan', 'sedang', 'berat']),
  status: z.enum(['aktif', 'salah-entri']),
  reason: reason.nullable(),
});

const consultSchema = z.strictObject({
  id: recId,
  encounterId,
  patientId: z.string().min(1).max(60),
  from: name,
  toSpecialty: z.string().max(60),
  to: name,
  kind: z.enum(['sekali', 'rawat-bersama', 'alih-rawat']),
  urgency: z.enum(['cito', 'biasa']),
  question: z.string().trim().min(20).max(1000),
  sentAt: isoInstant,
  answer: z.null(),
});

const eduSchema = z.strictObject({
  id: recId,
  topics: z
    .array(z.enum(['penyakit', 'obat', 'insulin', 'diet', 'jatuh', 'nyeri', 'tindakan', 'pulang', 'infeksi']))
    .min(1),
  methods: z.array(z.enum(['lisan', 'demonstrasi', 'leaflet', 'video'])).min(1),
  educator: name,
  profession: z.string().min(1).max(40),
  recipient: z.enum(['pasien', 'keluarga', 'pasien-keluarga']),
  recipientName: name,
  understanding: z.enum(['paham', 'perlu-diulang', 'tidak-paham']),
  teachBack: z.string().max(1000),
  repeatAt: isoInstant.nullable(),
  signature: name,
  at: isoInstant,
});

export const rmeExtraEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Isian asesmen final (versi 1) atau koreksi berversi. */
    type: z.literal('asesmen.disimpan'),
    encounterId,
    response: assessmentRecordSchema,
  }),
  z.strictObject({
    /** Versi baru diagnosis/prosedur/masalah/alergi (append-only) dan perubahan NKDA. */
    type: z.literal('diagnosis.dicatat'),
    encounterId,
    dx: z.array(dxSchema).max(20),
    procs: z.array(procSchema).max(5),
    problems: z.array(problemSchema).max(5),
    allergies: z.array(allergySchema).max(5),
    /** `verifikasi` = NKDA diverifikasi; `hapus` = alergi baru tercatat (NKDA tidak berlaku lagi). */
    nkda: z.enum(['verifikasi', 'hapus']).nullable(),
    at: isoInstant,
  }),
  z.strictObject({ type: z.literal('konsul.dikirim'), encounterId, consult: consultSchema }),
  z.strictObject({
    type: z.literal('konsul.dijawab'),
    encounterId,
    consultId: recId,
    findings: z.string().max(1000),
    conclusion: z.string().trim().min(1).max(1000),
    recommendation: z.string().trim().min(1).max(1000),
    followUp: z.enum(['selesai', 'rawat-bersama', 'alih-rawat']),
    at: isoInstant,
  }),
  z.strictObject({ type: z.literal('edukasi.dicatat'), encounterId, record: eduSchema }),
  z.strictObject({
    /** Butir kelengkapan sesi paket layanan hari ini selesai. */
    type: z.literal('paket.butir'),
    encounterId,
    itemId: recId,
    at: isoInstant,
  }),
  z.strictObject({
    /** Gerbang lab sesi hari ini: tunda (ikuti rekomendasi) atau override beralasan. */
    type: z.literal('paket.gerbang'),
    encounterId,
    decision: z.enum(['tunda', 'override']),
    reason: reason.nullable(),
    note: z.string().max(200),
    at: isoInstant,
  }),
  z.strictObject({
    /** Sesi hari ini dimulai / selesai. */
    type: z.literal('paket.sesi'),
    encounterId,
    to: z.enum(['berlangsung', 'selesai']),
    note: z.string().max(200),
    at: isoInstant,
  }),
  z.strictObject({
    /** Dokumen pasien: kirim ulang TTE berhasil atau dibatalkan beralasan (dokumen tidak pernah dihapus). */
    type: z.literal('kelengkapan.dokumen'),
    encounterId,
    docId: recId,
    change: z.enum(['tte-ulang', 'batal']),
    reason: reason.nullable(),
    at: isoInstant,
  }),
  z.strictObject({
    type: z.literal('kelengkapan.unggah'),
    encounterId,
    title: z.string().trim().min(3).max(80),
    kind: z.string().min(1).max(40),
    at: isoInstant,
  }),
  z.strictObject({
    /** Surat keterangan kematian ber-TTE (K-1, menunggu konfirmasi pemilik produk). */
    type: z.literal('kelengkapan.kematian'),
    encounterId,
    diedAt: isoInstant,
    causeCode: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/),
    causeLabel: z.string().min(1).max(120),
    certificateNo: z.string().min(1).max(40),
    at: isoInstant,
  }),
  z.strictObject({
    /** Kunjungan ditutup DPJP (semua butir lengkap + disposisi); rekam terkunci. */
    type: z.literal('kunjungan.ditutup'),
    encounterId,
    disposition: z.enum(['pulang', 'rujuk', 'aps', 'meninggal']),
    at: isoInstant,
  }),
]);
export type RmeExtraEvent = z.infer<typeof rmeExtraEventSchema>;

export interface StoredConsult extends ConsultRequest {
  answer: ConsultAnswer | null;
}

export interface StoredDocChange {
  encounterId: string;
  docId: string;
  change: 'tte-ulang' | 'batal';
  reason: string | null;
  by: string;
  at: string;
}

export interface PaketChanges {
  items: Readonly<Record<string, { by: string; at: string }>>;
  decision: {
    kind: 'tunda' | 'override';
    reason: string | null;
    note: string;
    by: string;
    at: string;
  } | null;
  session: { to: 'berlangsung' | 'selesai'; note: string; by: string; at: string } | null;
}

export interface RmeExtraState {
  assessments: readonly AssessmentResponse[];
  dx: readonly (EncounterDx & { encounterId: string })[];
  procs: readonly (ProcedureEntry & { encounterId: string })[];
  problems: readonly (Problem & { encounterId: string })[];
  allergies: readonly (AllergyEntry & { encounterId: string })[];
  /** NKDA per kunjungan: jam verifikasi, atau null bila dihapus oleh alergi baru. */
  nkda: Readonly<Record<string, string | null>>;
  consults: readonly StoredConsult[];
  /** Jawaban konsul atas konsul rekam awal (fixture), per id konsul. */
  answers: Readonly<Record<string, ConsultAnswer>>;
  edu: readonly (EduRecord & { encounterId: string })[];
  paket: Readonly<Record<string, PaketChanges>>;
  docChanges: readonly StoredDocChange[];
  uploads: readonly (PatientDocument & { encounterId: string })[];
  deaths: Readonly<
    Record<
      string,
      { diedAt: string; causeCode: string; causeLabel: string; certificateNo: string; by: string; at: string }
    >
  >;
  closed: Readonly<
    Record<string, { disposition: 'pulang' | 'rujuk' | 'aps' | 'meninggal'; by: string; at: string }>
  >;
}

export const RME_EXTRA_INITIAL: RmeExtraState = {
  assessments: [],
  dx: [],
  procs: [],
  problems: [],
  allergies: [],
  nkda: {},
  consults: [],
  answers: {},
  edu: [],
  paket: {},
  docChanges: [],
  uploads: [],
  deaths: {},
  closed: {},
};

export const VISIT_CLOSED = 'Kunjungan sudah ditutup; rekam medis terkunci (perubahan lewat addendum).';

const EMPTY_PAKET: PaketChanges = { items: {}, decision: null, session: null };

export function rmeExtraConflict(s: RmeExtraState, d: RmeExtraEvent): string | null {
  if (s.closed[d.encounterId] && d.type !== 'konsul.dijawab') return VISIT_CLOSED;
  switch (d.type) {
    case 'asesmen.disimpan':
      if (s.assessments.some((r) => r.id === d.response.id)) return 'Isian asesmen ganda.';
      if (d.response.supersedesId && s.assessments.some((r) => r.supersedesId === d.response.supersedesId))
        return 'Isian ini sudah dikoreksi; koreksi versi terbaru.';
      return null;
    case 'diagnosis.dicatat': {
      const ids = new Set([...s.dx, ...s.problems, ...s.allergies].map((x) => x.id));
      const sup = new Set(
        [...s.dx, ...s.problems, ...s.allergies].map((x) => x.supersedesId).filter((x): x is string => !!x),
      );
      const recs = [...d.dx, ...d.problems, ...d.allergies];
      if (recs.some((r) => ids.has(r.id)) || d.procs.some((p) => s.procs.some((x) => x.id === p.id)))
        return 'Entri ganda.';
      if (recs.some((r) => r.supersedesId && sup.has(r.supersedesId)))
        return 'Entri ini sudah diperbarui di tab lain; muat ulang.';
      return null;
    }
    case 'konsul.dikirim':
      return s.consults.some((c) => c.id === d.consult.id) ? 'Konsul ganda.' : null;
    case 'konsul.dijawab':
      return s.answers[d.consultId] || s.consults.some((c) => c.id === d.consultId && c.answer)
        ? 'Konsul sudah dijawab.'
        : null;
    case 'edukasi.dicatat':
      return s.edu.some((r) => r.id === d.record.id) ? 'Catatan edukasi ganda.' : null;
    case 'paket.butir':
      return s.paket[d.encounterId]?.items[d.itemId] ? 'Butir ini sudah selesai.' : null;
    case 'paket.gerbang':
      return s.paket[d.encounterId]?.decision ? 'Gerbang sesi hari ini sudah diputuskan.' : null;
    case 'paket.sesi': {
      const cur = s.paket[d.encounterId]?.session?.to;
      if (cur === 'selesai') return 'Sesi hari ini sudah selesai.';
      if (cur === d.to) return 'Sesi sudah berlangsung.';
      return null;
    }
    case 'kelengkapan.dokumen':
      return s.docChanges.some((c) => c.docId === d.docId && c.change === d.change)
        ? 'Dokumen ini sudah diproses.'
        : null;
    case 'kelengkapan.unggah':
      return null;
    case 'kelengkapan.kematian':
      return s.deaths[d.encounterId] ? 'Surat keterangan kematian sudah ber-TTE.' : null;
    case 'kunjungan.ditutup':
      return null;
  }
}

export function reduceRmeExtra<S extends RmeExtraState>(s: S, ev: DomainEvent<RmeExtraEvent>): S {
  const d = ev.data;
  const conflict = rmeExtraConflict(s, d);
  if (conflict) throw new Error(conflict);
  const by = ev.actor.name;
  const enc = d.encounterId;
  switch (d.type) {
    case 'asesmen.disimpan':
      return { ...s, assessments: [...s.assessments, { ...d.response, by }] };
    case 'diagnosis.dicatat':
      return {
        ...s,
        dx: [...s.dx, ...d.dx.map((x) => ({ ...x, encounterId: enc }))],
        procs: [...s.procs, ...d.procs.map((x) => ({ ...x, encounterId: enc }))],
        problems: [...s.problems, ...d.problems.map((x) => ({ ...x, encounterId: enc }))],
        allergies: [...s.allergies, ...d.allergies.map((x) => ({ ...x, encounterId: enc }))],
        nkda: d.nkda ? { ...s.nkda, [enc]: d.nkda === 'verifikasi' ? d.at : null } : s.nkda,
      };
    case 'konsul.dikirim':
      return { ...s, consults: [...s.consults, { ...d.consult, from: by, answer: null }] };
    case 'konsul.dijawab': {
      const answer: ConsultAnswer = {
        findings: d.findings,
        conclusion: d.conclusion,
        recommendation: d.recommendation,
        followUp: d.followUp,
        by,
        at: d.at,
      };
      const stored = s.consults.some((c) => c.id === d.consultId);
      return stored
        ? { ...s, consults: s.consults.map((c) => (c.id === d.consultId ? { ...c, answer } : c)) }
        : { ...s, answers: { ...s.answers, [d.consultId]: answer } };
    }
    case 'edukasi.dicatat':
      return { ...s, edu: [...s.edu, { ...d.record, educator: by, encounterId: enc }] };
    case 'paket.butir': {
      const p = s.paket[enc] ?? EMPTY_PAKET;
      return {
        ...s,
        paket: { ...s.paket, [enc]: { ...p, items: { ...p.items, [d.itemId]: { by, at: d.at } } } },
      };
    }
    case 'paket.gerbang': {
      const p = s.paket[enc] ?? EMPTY_PAKET;
      return {
        ...s,
        paket: {
          ...s.paket,
          [enc]: { ...p, decision: { kind: d.decision, reason: d.reason, note: d.note, by, at: d.at } },
        },
      };
    }
    case 'paket.sesi': {
      const p = s.paket[enc] ?? EMPTY_PAKET;
      return {
        ...s,
        paket: { ...s.paket, [enc]: { ...p, session: { to: d.to, note: d.note, by, at: d.at } } },
      };
    }
    case 'kelengkapan.dokumen':
      return {
        ...s,
        docChanges: [
          ...s.docChanges,
          { encounterId: enc, docId: d.docId, change: d.change, reason: d.reason, by, at: d.at },
        ],
      };
    case 'kelengkapan.unggah':
      return {
        ...s,
        uploads: [
          ...s.uploads,
          {
            id: `${enc}-dok-t${ev.seq}`,
            encounterId: enc,
            title: d.title,
            kind: d.kind,
            status: 'terunggah',
            by,
            at: d.at,
            note: null,
          },
        ],
      };
    case 'kelengkapan.kematian':
      return {
        ...s,
        deaths: {
          ...s.deaths,
          [enc]: {
            diedAt: d.diedAt,
            causeCode: d.causeCode,
            causeLabel: d.causeLabel,
            certificateNo: d.certificateNo,
            by,
            at: d.at,
          },
        },
      };
    case 'kunjungan.ditutup':
      return { ...s, closed: { ...s.closed, [enc]: { disposition: d.disposition, by, at: d.at } } };
  }
}
