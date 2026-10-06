import { type Claim, type ClaimBoard, sumRupiah } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain, on } from './demo/store/define';
import { BERKAS_KODING, BUKTI_RME } from './demo/fixtures/koding';
import { CBG, DOCS_RI, DOCS_RJ, ICD9_NAME, ICD10_NAME, STATIC_CLAIMS } from './demo/fixtures/keuangan';
import { patientByEncounterId } from './demo/fixtures/pasien';
import { poliDomain } from './klinis-poli-toko';
import {
  applyAnswer,
  type BerkasKoding,
  codeStatus,
  KEEP_REASON_MIN,
  type KodeBerkas,
  validateBerkas,
  versionProblem,
} from './keuangan-koding';
import type { ClaimLocal } from './keuangan-klaim';
import { tagihanDomain, type TagihanEvent } from './keuangan-tagihan-toko';
import { resumeDomain } from './rawat-inap-resume-toko';
import { rekamDomain } from './rme-toko';

/**
 * U05/U06 · Domain toko demo `klaim` (ADR-0085): Klaim & koding + Workbench koder (mode presentasi).
 *
 * - Langganan `tagihan` (`tagihan.tutup`/`tagihan.bayar` BPJS): kunjungan BPJS yang ditutup di Kasir menjadi berkas klaim
 *   (kode dari CPPT poli/resume/SEP, grouper dari estimasi INA-CBG tagihan), atau memperbarui billing final klaim yang
 *   sudah ada untuk pasien itu.
 * - Langganan klinis (CD-2): `resume-medis` · `resume.final` (resume ber-TTE → berkas klaim RI lengkap), `klinis-poli` ·
 *   CPPT final (kode diagnosis RJ), `rekam-medis` · `diagnosis.dicatat` (kode RME masuk workbench koder).
 * - Aksi koder: kelengkapan berkas, saran kode, query DPJP, kirim E-Klaim/tanggapan/banding, alasan bukti, hasil
 *   verifikasi BPJS (disimulasikan, mock E-Klaim) → klaim layak bayar masuk pool Pembiayaan BTN.
 * - Workbench koder: tautan bukti, alasan pertahankan, keputusan saran, hapus kode (versi baru), query + jawaban DPJP
 *   (disimulasikan), validasi/versi koding → status klaim pasien yang sama ikut berubah.
 *
 * Kontrak keluar: `klaim.verifikasi` (klaim layak bayar; `amount` = tarif INA-CBG final) dilanggan Pembiayaan BTN.
 */

export const KLAIM_DOMAIN = 'klaim';

const stamp = z.iso.datetime({ offset: true });
const claimId = z.string().regex(/^[a-z0-9-]{1,60}$/);
const berkasId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rupiah = z.string().regex(/^\d{1,15}$/);

export const klaimEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('klaim.berkas'), claimId, docId: berkasId, ok: z.boolean(), at: stamp }),
  z.strictObject({
    type: z.literal('klaim.saran'),
    claimId,
    code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/),
    at: stamp,
  }),
  z.strictObject({ type: z.literal('klaim.query'), claimId, at: stamp }),
  z.strictObject({
    type: z.literal('klaim.kirim'),
    claimId,
    kind: z.enum(['kirim', 'tanggapan', 'banding']),
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('klaim.alasan'),
    claimId,
    reason: z.string().trim().min(10).max(500),
    at: stamp,
  }),
  z.strictObject({
    /** Kontrak: hasil verifikasi BPJS (mock E-Klaim) → layak bayar, nominal = tarif INA-CBG final. */
    type: z.literal('klaim.verifikasi'),
    claimId,
    patient: z.strictObject({
      id: z.string().min(1).max(60),
      name: z.string().min(1).max(120),
      rm: z.string(),
    }),
    sep: z.string().min(1).max(30),
    kind: z.enum(['rawat-jalan', 'rawat-inap']),
    amount: rupiah,
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('koding.kode'),
    berkasId,
    codeId: berkasId,
    patch: z.discriminatedUnion('op', [
      z.strictObject({ op: z.literal('bukti'), evidenceId: berkasId }),
      z.strictObject({ op: z.literal('alasan'), reason: z.string().trim().min(KEEP_REASON_MIN).max(300) }),
      z.strictObject({ op: z.literal('terima') }),
      z.strictObject({ op: z.literal('tolak'), reason: z.string().trim().min(KEEP_REASON_MIN).max(300) }),
      z.strictObject({ op: z.literal('hapus') }),
    ]),
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('koding.query'),
    berkasId,
    question: z.string().trim().min(20).max(500),
    at: stamp,
  }),
  z.strictObject({ type: z.literal('koding.jawaban'), berkasId, at: stamp }),
  z.strictObject({ type: z.literal('koding.pengingat'), berkasId, at: stamp }),
  z.strictObject({
    type: z.literal('koding.selesai'),
    berkasId,
    versionReason: z.string().trim().max(300).nullable(),
    at: stamp,
  }),
]);
export type KlaimEvent = z.infer<typeof klaimEventSchema>;

export interface StoredClaimLocal extends ClaimLocal {
  sentBy?: string;
  sentKind?: 'kirim' | 'tanggapan' | 'banding';
  queryBy?: string;
  acceptedBy?: string;
  reason?: { text: string; by: string; at: string };
  verifiedAt?: string;
  /** Billing final dari Kasir (tarif RS). */
  billing?: { hospitalCost: string; at: string; invoiceNo: string };
  /** Resume final ber-TTE dari Resume medis. */
  resume?: {
    at: string;
    dpjp: string;
    codes: Array<{ system: string; code: string; label: string; primary: boolean }>;
  };
}

export interface KlaimState {
  local: Readonly<Record<string, StoredClaimLocal>>;
  /** Klaim baru dari kunjungan BPJS yang ditutup di Kasir. */
  created: readonly Claim[];
  /** Kode diagnosis terakhir per pasien dari CPPT poli final. */
  poliCodes: Readonly<Record<string, readonly string[]>>;
  /** Resume final per pasien (bila klaimnya belum ada saat resume ditandatangani). */
  resumes: Readonly<Record<string, NonNullable<StoredClaimLocal['resume']>>>;
  /** Workbench koder: berkas setelah tindakan (awal = fixture). */
  berkas: Readonly<Record<string, BerkasKoding>>;
  reminders: Readonly<Record<string, string>>;
}

const DPJP_ANSWER = 'Ya, sesuai bukti klinis; addendum resume ditandatangani.';

function berkasOf(s: KlaimState, id: string): BerkasKoding | undefined {
  return s.berkas[id] ?? BERKAS_KODING.find((b) => b.id === id);
}

function allClaims(s: KlaimState): Claim[] {
  return [...STATIC_CLAIMS, ...s.created];
}

function localOf(s: KlaimState, id: string): StoredClaimLocal {
  return s.local[id] ?? {};
}

function patchLocal(s: KlaimState, id: string, p: Partial<StoredClaimLocal>): KlaimState {
  return { ...s, local: { ...s.local, [id]: { ...localOf(s, id), ...p } } };
}

/** Status klaim setelah tindakan tersimpan. */
export function effectiveStatus(c: Pick<Claim, 'id' | 'status'>, l: StoredClaimLocal): Claim['status'] {
  if (l.verifiedAt) return 'payable';
  if (l.sentAt && c.status === 'draft') return 'sent';
  return c.status;
}

function codingGate(s: KlaimState, ev: KlaimEvent): string | null {
  if (!('berkasId' in ev)) return null;
  const b = berkasOf(s, ev.berkasId);
  if (!b) return 'Berkas koding tidak ditemukan.';
  const done = b.status === 'siap-grouping' || b.status === 'tanggapan-siap';
  switch (ev.type) {
    case 'koding.kode': {
      if (done) return 'Berkas sudah tervalidasi; perubahan lewat versi koding baru.';
      const c = b.codes.find((x) => x.id === ev.codeId);
      if (!c) return 'Kode tidak ditemukan di berkas.';
      const p = ev.patch;
      if (p.op === 'bukti' && !(BUKTI_RME[b.id] ?? []).some((e) => e.id === p.evidenceId)) {
        return 'Bukti tidak ada di RME pasien ini.';
      }
      if ((p.op === 'terima' || p.op === 'tolak') && (!c.suggestion || c.suggestion.decided)) {
        return 'Tidak ada saran kode yang perlu diputuskan.';
      }
      if (p.op === 'hapus' && (!b.sent || c.role !== 'sekunder' || c.removed)) {
        return 'Hanya diagnosis sekunder berkas terkirim yang bisa dihapus pada versi baru.';
      }
      return null;
    }
    case 'koding.query':
      return b.query ? 'Query DPJP sudah dikirim.' : done ? 'Berkas sudah tervalidasi.' : null;
    case 'koding.jawaban':
    case 'koding.pengingat':
      return b.query && !b.query.answer ? null : 'Tidak ada query DPJP yang menunggu jawaban.';
    case 'koding.selesai': {
      if (done) return 'Berkas sudah tervalidasi.';
      const issues = validateBerkas(b);
      if (issues.length) return `Belum bisa diteruskan: ${issues.join('; ')}.`;
      const v = versionProblem(b, ev.versionReason ?? '');
      return v;
    }
  }
}

function gate(s: KlaimState, ev: KlaimEvent): string | null {
  if ('berkasId' in ev) return codingGate(s, ev);
  // Alasan ketidaksesuaian kode juga dicatat untuk klaim pasien skenario (anotasi audit, tidak memajukan skenario).
  if (ev.type === 'klaim.alasan') return localOf(s, ev.claimId).reason ? 'Alasan sudah tercatat.' : null;
  const c = allClaims(s).find((x) => x.id === ev.claimId);
  if (!c) return 'Klaim tidak ditemukan.';
  if (c.scenario) return 'Klaim pasien simulasi dimajukan lewat tugas skenario.';
  const l = localOf(s, c.id);
  const status = effectiveStatus(c, l);
  switch (ev.type) {
    case 'klaim.berkas':
    case 'klaim.saran':
    case 'klaim.query':
      if (l.sentAt || !['draft', 'pending', 'dispute'].includes(status)) {
        return 'Berkas sudah terkirim dan dikunci untuk verifikasi.';
      }
      if (ev.type === 'klaim.berkas' && !c.documents.some((d) => d.id === ev.docId))
        return 'Dokumen tidak dikenal.';
      if (ev.type === 'klaim.saran' && (!c.suggestion || c.suggestion.to !== ev.code || l.acceptedAt)) {
        return 'Tidak ada saran koding ini untuk diterima.';
      }
      if (ev.type === 'klaim.query' && l.queryAt) return 'Query sudah terkirim ke DPJP.';
      return null;
    case 'klaim.kirim':
      if (l.sentAt) return 'Berkas sudah terkirim.';
      return ['draft', 'pending', 'dispute'].includes(status) ? null : 'Berkas sudah di verifikator.';
    case 'klaim.verifikasi':
      if (l.verifiedAt) return 'Hasil verifikasi sudah tercatat.';
      return status === 'sent' ? null : 'Hanya klaim terkirim yang menunggu hasil verifikasi.';
  }
}

function patchKode(b: BerkasKoding, codeId: string, patch: Partial<KodeBerkas>): BerkasKoding {
  return { ...b, codes: b.codes.map((c) => (c.id === codeId ? { ...c, ...patch } : c)) };
}

function reduceCoding(s: KlaimState, ev: Extract<KlaimEvent, { berkasId: string }>, by: string): KlaimState {
  const b = berkasOf(s, ev.berkasId);
  if (!b) return s;
  let next: BerkasKoding = b;
  switch (ev.type) {
    case 'koding.kode': {
      const c = b.codes.find((x) => x.id === ev.codeId);
      if (!c) return s;
      const p = ev.patch;
      if (p.op === 'bukti') {
        const e = (BUKTI_RME[b.id] ?? []).find((x) => x.id === p.evidenceId) ?? null;
        next = patchKode(b, c.id, { evidence: e });
      } else if (p.op === 'alasan') next = patchKode(b, c.id, { keepReason: p.reason });
      else if (p.op === 'terima' && c.suggestion)
        next = patchKode(b, c.id, { suggestion: { ...c.suggestion, decided: 'terima' } });
      else if (p.op === 'tolak' && c.suggestion)
        next = patchKode(b, c.id, {
          suggestion: { ...c.suggestion, decided: 'tolak' },
          keepReason: p.reason,
        });
      else if (p.op === 'hapus') next = patchKode(b, c.id, { removed: true });
      break;
    }
    case 'koding.query': {
      const target = b.codes.find((c) => codeStatus(c) === 'perlu-bukti');
      next = {
        ...b,
        status: 'query-dpjp',
        query: {
          question: ev.question,
          to: b.dpjp,
          askedAt: ev.at,
          answer: null,
          answeredAt: null,
          confirms: target?.code ?? '',
        },
      };
      break;
    }
    case 'koding.jawaban':
      next = applyAnswer(b, DPJP_ANSWER, ev.at);
      break;
    case 'koding.pengingat':
      return { ...s, reminders: { ...s.reminders, [b.id]: ev.at } };
    case 'koding.selesai': {
      if (b.sent) {
        const version = (b.versions.at(-1)?.version ?? 1) + 1;
        next = {
          ...b,
          status: 'tanggapan-siap',
          versions: [...b.versions, { version, at: ev.at, by, note: (ev.versionReason ?? '').trim() }],
        };
      } else next = { ...b, status: 'siap-grouping' };
      break;
    }
  }
  return { ...s, berkas: { ...s.berkas, [b.id]: next } };
}

// ---------------------------------------------------------------------------------------------------------------
// Berkas klaim baru dari Kasir (BPJS) + resume/CPPT.
// ---------------------------------------------------------------------------------------------------------------

type ClosedEvent = Extract<TagihanEvent, { type: 'tagihan.tutup' | 'tagihan.bayar' }>;

function cbgName(code: string): { name: string; classLabel: string } {
  for (const c of Object.values(CBG)) if (c.code === code) return { name: c.name, classLabel: c.classLabel };
  return { name: 'Kelompok INA-CBG (estimasi grouper)', classLabel: 'estimasi' };
}

const dxName = (code: string, fallback: string) => ICD10_NAME[code] ?? fallback;

function applyClosed(s: KlaimState, d: ClosedEvent, at: string): KlaimState {
  const st = d.settlement;
  if (st.scheme !== 'bpjs' || !st.cbg) return s;
  const existing = allClaims(s).find(
    (c) => c.patient.id === d.patient.id && !c.scenario && (!st.sep || c.encounter.sep === st.sep),
  );
  if (existing) {
    return patchLocal(s, existing.id, {
      billing: { hospitalCost: st.hospitalTotal, at, invoiceNo: d.invoiceNo },
    });
  }
  const id = `kl-${d.invoiceId}`.slice(0, 60);
  if (s.created.some((c) => c.id === id)) return s;
  const ri = st.setting !== 'rawat-jalan';
  const resume = s.resumes[d.patient.id];
  const codes: Claim['diagnoses'] = resume
    ? resume.codes
        .filter((c) => c.system === 'ICD-10')
        .map((c) => ({ code: c.code, name: dxName(c.code, c.label), role: c.primary ? 'utama' : 'sekunder' }))
    : (s.poliCodes[d.patient.id] ?? (st.diagnosis ? [st.diagnosis.split(/[\s·]/)[0] ?? ''] : []))
        .filter((c) => /^[A-Z]\d{2}(\.\d{1,2})?$/.test(c))
        .map((c, i) => ({
          code: c,
          name: dxName(c, st.diagnosis?.split('·')[1]?.trim() || c),
          role: i === 0 ? ('utama' as const) : ('sekunder' as const),
        }));
  if (codes.length === 0) return s;
  const procedures: Claim['procedures'] = resume
    ? resume.codes
        .filter((c) => c.system === 'ICD-9-CM' && ICD9_NAME[c.code])
        .map((c) => ({ code: c.code, name: ICD9_NAME[c.code] ?? c.label }))
    : [];
  const g = cbgName(st.cbg);
  const claim: Claim = {
    id,
    scenario: null,
    patient: { id: d.patient.id, rm: d.patient.rm, name: d.patient.name },
    encounter: {
      kind: ri ? 'rawat-inap' : 'rawat-jalan',
      summary: `${ri ? 'RI' : 'RJ'} · ${codes[0]?.name ?? ''}`.slice(0, 80),
      title: st.label,
      sep: st.sep ?? '—',
      classLabel: ri ? g.classLabel : 'rawat jalan',
      dpjp: st.dpjp,
      resume: resume
        ? `resume final ber-TTE · ${resume.dpjp}`
        : s.poliCodes[d.patient.id]
          ? 'catatan poli ber-TTE'
          : 'diagnosa awal SEP (catatan poli belum final)',
      discharged: true,
    },
    status: 'draft',
    tag: { label: 'Siap grouping', level: 'ok' },
    ageLabel: 'H+0',
    diagnoses: codes,
    procedures,
    grouper: {
      cbg: st.cbg,
      name: g.name,
      classLabel: ri ? g.classLabel : 'rawat jalan',
      tariff: st.payerPays,
      specialCmg: null,
      final: false,
    },
    hospitalCost: st.hospitalTotal,
    documents: (ri ? DOCS_RI : DOCS_RJ).map(([docId, label]) => ({ id: docId, label, ok: true })),
    note: {
      level: 'ok',
      title: 'Berkas dari Kasir.',
      text: `Kunjungan ditutup ${d.invoiceNo}; kode ditarik dari ${resume ? 'resume' : 'CPPT/SEP'}, koder memvalidasi.`,
    },
    suggestion: null,
    submittedAt: null,
  };
  return { ...s, created: [...s.created, claim] };
}

export const klaimDomain = defineDomain<KlaimState, KlaimEvent>(KLAIM_DOMAIN, {
  initial: () => ({ local: {}, created: [], poliCodes: {}, resumes: {}, berkas: {}, reminders: {} }),
  eventSchema: klaimEventSchema,
  screens: ['klaim', 'koding'],
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    if ('berkasId' in d) return reduceCoding(s, d, by);
    const l = localOf(s, d.claimId);
    const claim = allClaims(s).find((c) => c.id === d.claimId);
    switch (d.type) {
      case 'klaim.berkas': {
        const docs = (l.docs ?? claim?.documents ?? []).map((x) =>
          x.id === d.docId ? { ...x, ok: d.ok } : x,
        );
        return patchLocal(s, d.claimId, { docs });
      }
      case 'klaim.saran':
        return patchLocal(s, d.claimId, { acceptedAt: d.at, acceptedBy: by });
      case 'klaim.query':
        return patchLocal(s, d.claimId, { queryAt: d.at, queryBy: by });
      case 'klaim.kirim':
        return patchLocal(s, d.claimId, { sentAt: d.at, sentBy: by, sentKind: d.kind });
      case 'klaim.alasan':
        return patchLocal(s, d.claimId, { reason: { text: d.reason, by, at: d.at } });
      case 'klaim.verifikasi':
        return patchLocal(s, d.claimId, { verifiedAt: d.at });
    }
  },
  subscriptions: [
    on(tagihanDomain, (s, ev) =>
      ev.data.type === 'tagihan.tutup' || ev.data.type === 'tagihan.bayar'
        ? applyClosed(s, ev.data, ev.data.at)
        : s,
    ),
    on(resumeDomain, (s, ev) => {
      const d = ev.data;
      if (d.type !== 'resume.final') return s;
      const r = { at: d.signedAt, dpjp: d.dpjp, codes: d.codes.map((c) => ({ ...c })) };
      const next = { ...s, resumes: { ...s.resumes, [d.patientId]: r } };
      const c = allClaims(s).find(
        (x) => x.patient.id === d.patientId && !x.scenario && x.encounter.kind === 'rawat-inap',
      );
      return c ? patchLocal(next, c.id, { resume: r }) : next;
    }),
    on(poliDomain, (s, ev) =>
      ev.data.type === 'cppt.ditandatangani' && ev.data.final
        ? { ...s, poliCodes: { ...s.poliCodes, [ev.data.patientId]: ev.data.diagnosisCodes } }
        : s,
    ),
    on(rekamDomain, (s, ev) => {
      if (ev.data.type !== 'diagnosis.dicatat') return s;
      const p = patientByEncounterId(ev.data.encounterId);
      const b = p
        ? (Object.values(s.berkas).find((x) => x.patient.rm === p.rm) ??
          BERKAS_KODING.find((x) => x.patient.rm === p.rm))
        : undefined;
      if (!b || b.status === 'siap-grouping' || b.status === 'tanggapan-siap') return s;
      const added: KodeBerkas[] = ev.data.dx
        .filter((x) => x.status === 'aktif' && !b.codes.some((c) => c.code === x.code))
        .map((x) => ({
          id: `rme-${x.id}`.slice(0, 40),
          system: 'ICD-10' as const,
          code: x.code,
          name: dxName(x.code, x.display),
          role:
            x.rank === 'utama' && !b.codes.some((c) => c.role === 'utama' && !c.removed)
              ? 'utama'
              : 'sekunder',
          source: 'cppt' as const,
          sourceNote: `diagnosis RME ${x.certainty} oleh ${ev.actor.name}`,
          needsEvidence: false,
          evidence: null,
          keepReason: null,
          suggestion: null,
        }));
      return added.length
        ? { ...s, berkas: { ...s.berkas, [b.id]: { ...b, codes: [...b.codes, ...added] } } }
        : s;
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Penerapan ke papan Klaim dan Workbench koder.
// ---------------------------------------------------------------------------------------------------------------

const KIRIM_TAG: Record<NonNullable<StoredClaimLocal['sentKind']>, string> = {
  kirim: 'Terkirim',
  tanggapan: 'Tanggapan terkirim',
  banding: 'Banding diajukan',
};

/** Satu klaim setelah tindakan tersimpan (status, berkas, billing, resume, koding tervalidasi). */
export function applyClaim(c: Claim, l: StoredClaimLocal, coding: BerkasKoding | undefined): Claim {
  const status = effectiveStatus(c, l);
  let out: Claim = { ...c, status };
  if (l.docs) out = { ...out, documents: l.docs };
  if (l.billing) {
    out = {
      ...out,
      hospitalCost: l.billing.hospitalCost,
      documents: out.documents.map((d) => (d.id === 'billing' ? { ...d, ok: true } : d)),
    };
  }
  if (l.resume) {
    out = {
      ...out,
      encounter: { ...out.encounter, resume: `resume final ber-TTE · ${l.resume.dpjp}` },
      documents: out.documents.map((d) => (d.id === 'resume' ? { ...d, ok: true } : d)),
    };
  }
  if (status === 'sent' && c.status === 'draft') {
    out = { ...out, tag: { label: 'Terkirim', level: 'info' }, submittedAt: l.sentAt ?? null };
  } else if (status === 'payable' && c.status !== 'payable') {
    out = {
      ...out,
      tag: { label: 'Layak bayar', level: 'ok' },
      grouper: out.grouper ? { ...out.grouper, final: true } : out.grouper,
      note: {
        level: 'ok',
        title: 'Layak bayar.',
        text: 'BA verifikasi terbit; klaim masuk pool pembiayaan piutang BTN sebelum BPJS membayar.',
      },
    };
  } else if (l.sentKind && l.sentKind !== 'kirim') {
    out = { ...out, tag: { label: KIRIM_TAG[l.sentKind], level: 'ok' } };
  } else if (coding?.status === 'siap-grouping' && status === 'draft') {
    out = { ...out, tag: { label: 'Koding tervalidasi', level: 'ok' } };
  } else if (coding?.status === 'tanggapan-siap') {
    out = { ...out, tag: { label: 'Tanggapan siap', level: 'ok' } };
  }
  return out;
}

/** Berkas koding pasien klaim (cocok RM). */
function codingFor(s: KlaimState, c: Pick<Claim, 'patient'>): BerkasKoding | undefined {
  const b = BERKAS_KODING.find((x) => x.patient.rm === c.patient.rm);
  return b ? berkasOf(s, b.id) : undefined;
}

/** Papan Klaim (fixture + skenario) setelah keadaan toko diterapkan; KPI dan jumlah per status ikut. */
export function applyKlaim(board: ClaimBoard, s: KlaimState): ClaimBoard {
  const before = [...board.claims, ...s.created];
  const claims = before.map((c) => (c.scenario ? c : applyClaim(c, localOf(s, c.id), codingFor(s, c))));
  const totals = { ...board.totals };
  for (const c of s.created) totals[c.status] += 1;
  claims.forEach((c, i) => {
    const prev = before[i];
    if (prev && prev.status !== c.status) {
      totals[prev.status] = Math.max(0, totals[prev.status] - 1);
      totals[c.status] += 1;
    }
  });
  const sentValue = sumRupiah(
    claims
      .filter((c, i) => before[i]?.status === 'draft' && c.status !== 'draft')
      .map((c) => BigInt(c.grouper?.tariff ?? '0')),
  );
  const rj = s.created.filter((c) => c.encounter.kind === 'rawat-jalan').length;
  return {
    ...board,
    kpis: {
      ...board.kpis,
      claimsMonth: {
        total: board.kpis.claimsMonth.total + s.created.length,
        rj: board.kpis.claimsMonth.rj + rj,
        ri: board.kpis.claimsMonth.ri + s.created.length - rj,
      },
      submittedValue: (BigInt(board.kpis.submittedValue) + sentValue).toString(),
    },
    totals,
    claims,
  };
}

/** Keadaan tindakan koder per klaim untuk layar (bentuk `ClaimLocal` lama + siapa). */
export function claimLocals(s: KlaimState): Record<string, StoredClaimLocal> {
  return { ...s.local };
}

/** Berkas koding setelah tindakan tersimpan (urutan fixture). */
export function codingList(s: KlaimState): BerkasKoding[] {
  return BERKAS_KODING.map((b) => berkasOf(s, b.id) ?? b);
}
