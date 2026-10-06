import { z } from 'zod';
import {
  type ActorRef,
  actorRef,
  idSchema,
  jamSchema,
  type LogLine,
  must,
  pushLog,
  roleBlock,
  whenSchema,
} from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import { LOAN_UNITS, RECORD_FILES, RECORD_LOANS, ROI_REQUESTS } from './demo/fixtures/rekam-medis-adm';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { DESTRUCTION_STAGES, lendBlock, loanDueDate, type RecordLoan } from './rekam-medis-adm';

/**
 * B09 · Domain toko demo `rekam-medis-adm` (ADR-0085, CX-3): pelepasan informasi/hak subjek data, peminjaman berkas
 * fisik, dan pemusnahan berjejak. Pemisahan tugas memakai pengguna sesi (utang bug 6 Okt): penyetuju ROI ≠
 * pemverifikasi (ID sesi) dan ≠ penerima; penyetuju pemusnahan (direktur) ≠ pengusul. Langkah per posisi berhak.
 */

export const RECORDS_ADMIN_DOMAIN = 'rekam-medis-adm';

/** Posisi penyetuju pelepasan informasi (petugas privasi atau manajemen), bukan penerima loket RM. */
export const ROI_APPROVER_ROLES = ['petugas_privasi', 'manajemen'] as const;
/** Pengusul pemusnahan (komite RM) dan penyetuju/penanda tangan berita acara (direktur). */
export const DESTRUCTION_PROPOSER_ROLES = ['petugas_rm', 'manajemen'] as const;
export const DESTRUCTION_DIRECTOR_ROLES = ['manajemen'] as const;
export const MIN_LOAN_PURPOSE = 10;
export const MIN_ROI_REJECT = 10;

export const recordsAdminEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('roi.diverifikasi'), id: idSchema, when: whenSchema }),
  z.strictObject({ type: z.literal('roi.disetujui'), id: idSchema, when: whenSchema }),
  z.strictObject({ type: z.literal('roi.dipenuhi'), id: idSchema, when: whenSchema }),
  z.strictObject({
    type: z.literal('roi.ditolak'),
    id: idSchema,
    reason: z.string().trim().min(MIN_ROI_REJECT).max(500),
    when: whenSchema,
  }),
  z.strictObject({
    type: z.literal('berkas.dipinjam'),
    fileId: idSchema,
    unit: z.string().min(1).max(80),
    borrower: z.string().trim().min(3).max(120),
    purpose: z.string().trim().min(MIN_LOAN_PURPOSE).max(300),
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('berkas.kembali'), loanId: idSchema, when: whenSchema }),
  z.strictObject({ type: z.literal('pengingat.dikirim'), loanId: idSchema, jam: jamSchema }),
  z.strictObject({
    type: z.literal('pemusnahan.maju'),
    /** Tahap tujuan 1…4 (tidak bisa dilompati). */
    target: z.number().int().min(1).max(4),
    when: whenSchema,
  }),
]);
export type RecordsAdminEvent = z.infer<typeof recordsAdminEventSchema>;

export interface RoiProgress {
  stage: 0 | 1 | 2 | 3;
  verifiedBy: ActorRef | null;
  verifiedAt: string | null;
  approvedBy: ActorRef | null;
  approvedAt: string | null;
  fulfilledBy: ActorRef | null;
  fulfilledAt: string | null;
  rejected: { reason: string; when: string; by: ActorRef } | null;
}

export interface StoredLoan extends RecordLoan {
  lentBy?: string;
  returnedBy?: string;
}

export interface DestructionStep {
  /** Nama pelaku (sistem untuk tahap 0). */
  who: string;
  userId: string | null;
  when: string;
}

export interface RecordsAdminStoreState {
  roi: Record<string, RoiProgress>;
  loans: StoredLoan[];
  loanSeq: number;
  destruction: { stage: number; steps: DestructionStep[] };
  log: LogLine[];
}

export const RETENTION_COMPUTED_AT = `${DEMO_TODAY}T01:30:00+07:00`;

export function initialRecordsAdmin(): RecordsAdminStoreState {
  return {
    roi: Object.fromEntries(
      ROI_REQUESTS.map((r) => [
        r.id,
        {
          stage: r.stage,
          // Fixture terverifikasi oleh penerima loket (bukan akun sesi): penyetuju cukup beda dari nama itu.
          verifiedBy: r.stage > 0 ? { userId: `fixture:${r.receiver}`, name: r.receiver, role: 'petugas_rm' } : null,
          verifiedAt: r.verifiedAt ?? null,
          approvedBy: null,
          approvedAt: null,
          fulfilledBy: null,
          fulfilledAt: null,
          rejected: null,
        } satisfies RoiProgress,
      ]),
    ),
    loans: RECORD_LOANS.map((l) => ({ ...l })),
    loanSeq: 0,
    destruction: { stage: 0, steps: [{ who: 'Sistem (job retensi 01.30)', userId: null, when: RETENTION_COMPUTED_AT }] },
    log: [],
  };
}

const SOD_ROI = 'Penyetuju harus pengguna lain dari pemverifikasi dan penerima permintaan (pemisahan tugas).';

function gate(s: RecordsAdminStoreState, ev: RecordsAdminEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'roi.diverifikasi':
    case 'roi.disetujui':
    case 'roi.dipenuhi':
    case 'roi.ditolak': {
      const r = ROI_REQUESTS.find((x) => x.id === ev.id);
      const p = s.roi[ev.id];
      if (!r || !p) return 'Permintaan tidak ditemukan.';
      if (p.rejected) return `${r.number} sudah ditolak.`;
      if (ev.type === 'roi.diverifikasi' || ev.type === 'roi.ditolak')
        return p.stage === 0 ? null : `${r.number} sudah diverifikasi.`;
      if (ev.type === 'roi.disetujui') {
        if (p.stage !== 1) return `${r.number} belum diverifikasi atau sudah disetujui.`;
        const role = roleBlock(actor, ROI_APPROVER_ROLES, 'Penyetuju pelepasan informasi: posisi Petugas privasi atau Manajemen.');
        if (role) return role;
        if (p.verifiedBy?.userId === actor.userId || actor.name === r.receiver) return SOD_ROI;
        return null;
      }
      return p.stage === 2 ? null : `${r.number} belum disetujui atau sudah dipenuhi.`;
    }
    case 'berkas.dipinjam': {
      const f = RECORD_FILES.find((x) => x.id === ev.fileId);
      if (!f) return 'Berkas tidak ditemukan.';
      if (!(LOAN_UNITS as readonly string[]).includes(ev.unit)) return 'Unit peminjam tidak dikenal.';
      return lendBlock(f, s.loans);
    }
    case 'berkas.kembali':
    case 'pengingat.dikirim': {
      const l = s.loans.find((x) => x.id === ev.loanId);
      if (!l) return 'Peminjaman tidak ditemukan.';
      if (l.returnedAt) return 'Berkas sudah kembali.';
      if (ev.type === 'pengingat.dikirim' && l.remindedAt) return 'Pengingat sudah dikirim.';
      return null;
    }
    case 'pemusnahan.maju': {
      const cur = s.destruction.stage;
      if (cur >= DESTRUCTION_STAGES.length - 1) return 'Pemusnahan sudah tercatat selesai.';
      if (ev.target !== cur + 1) return 'Urutan persetujuan tidak bisa dilompati.';
      if (ev.target === 1)
        return roleBlock(actor, DESTRUCTION_PROPOSER_ROLES, 'Usulan pemusnahan diajukan komite RM (posisi Petugas rekam medis atau Manajemen).');
      if (ev.target === 2 || ev.target === 3) {
        const role = roleBlock(actor, DESTRUCTION_DIRECTOR_ROLES, 'Persetujuan dan berita acara pemusnahan ditandatangani direktur (posisi Manajemen).');
        if (role) return role;
        if (ev.target === 2 && s.destruction.steps[1]?.userId === actor.userId)
          return 'Penyetuju harus pengguna lain dari pengusul (pemisahan tugas).';
      }
      return null;
    }
  }
}

export const recordsAdminDomain = defineDomain<RecordsAdminStoreState, RecordsAdminEvent>(RECORDS_ADMIN_DOMAIN, {
  initial: initialRecordsAdmin,
  eventSchema: recordsAdminEventSchema,
  screens: ['rm-adm'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    const log = (jam: string, text: string) => pushLog(s.log, { jam, text, by: by.name });
    const roi = (id: string, patch: Partial<RoiProgress>) => ({
      ...s.roi,
      [id]: { ...(s.roi[id] as RoiProgress), ...patch },
    });
    switch (d.type) {
      case 'roi.diverifikasi':
        return { ...s, roi: roi(d.id, { stage: 1, verifiedBy: by, verifiedAt: d.when }) };
      case 'roi.disetujui':
        return { ...s, roi: roi(d.id, { stage: 2, approvedBy: by, approvedAt: d.when }) };
      case 'roi.dipenuhi':
        return { ...s, roi: roi(d.id, { stage: 3, fulfilledBy: by, fulfilledAt: d.when }) };
      case 'roi.ditolak':
        return { ...s, roi: roi(d.id, { rejected: { reason: d.reason.trim(), when: d.when, by } }) };
      case 'berkas.dipinjam': {
        const n = s.loanSeq + 1;
        return {
          ...s,
          loanSeq: n,
          loans: [
            {
              id: `pinjam-baru-${n}`,
              fileId: d.fileId,
              borrower: d.borrower.trim(),
              unit: d.unit,
              purpose: d.purpose.trim(),
              outDate: DEMO_TODAY,
              dueDate: loanDueDate(DEMO_TODAY),
              returnedAt: null,
              lentBy: by.name,
            },
            ...s.loans,
          ],
          log: log(d.jam, `Berkas ${d.fileId} keluar ke ${d.unit}`),
        };
      }
      case 'berkas.kembali':
        return {
          ...s,
          loans: s.loans.map((l) => (l.id === d.loanId ? { ...l, returnedAt: d.when, returnedBy: by.name } : l)),
        };
      case 'pengingat.dikirim':
        return { ...s, loans: s.loans.map((l) => (l.id === d.loanId ? { ...l, remindedAt: d.jam } : l)) };
      case 'pemusnahan.maju':
        return {
          ...s,
          destruction: {
            stage: d.target,
            steps: [...s.destruction.steps, { who: by.name, userId: by.userId, when: d.when }],
          },
        };
    }
  },
});
