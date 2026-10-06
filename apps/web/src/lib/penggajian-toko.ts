import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import {
  type ActorRef,
  actorRef,
  jamSchema,
  type LogLine,
  must,
  pushLog,
  sameUserBlock,
  whenSchema,
} from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import { PAYROLL_INPUTS, PAYROLL_PERIOD, SERVICE_FEES } from './demo/fixtures/penggajian';
import { calculateBlock, computeSlip, journalBalanced, type PayInput, payrollJournal } from './penggajian';

/**
 * B05 · Domain toko demo `penggajian` (ADR-0085, CX-3): run gaji satu periode `draf → dihitung → disetujui →
 * diposting` + kirim slip. Penyusun = pengguna sesi yang menekan "Hitung gaji"; penyetuju wajib PENGGUNA LAIN (ID
 * sesi, bukan nama dari dropdown; utang bug 6 Okt) dengan posisi Akuntan atau Manajemen.
 *
 * Kejadian `run.diposting` membawa jurnal gaji berpasangan (rupiah string digit, debit = kredit, diperiksa ulang
 * `validate`) sebagai kontrak untuk Akuntansi (CX-2) bila ingin dilanggan.
 */

export const PAYROLL_DOMAIN = 'penggajian';
export const PAYROLL_APPROVER_ROLES = ['akuntan', 'manajemen'] as const;

const rupiah = z.string().regex(/^\d{1,12}$/);
const journalLine = z.strictObject({ account: z.string().min(1).max(80), debit: rupiah, credit: rupiah });

export const payrollEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('jaspel.diimpor'), when: whenSchema }),
  z.strictObject({
    type: z.literal('run.dihitung'),
    /** PPh 21 manual per pegawai (rupiah utuh). */
    pph: z.record(z.string().min(1).max(80), rupiah),
    when: whenSchema,
  }),
  z.strictObject({ type: z.literal('run.dikembalikan'), when: whenSchema }),
  z.strictObject({ type: z.literal('run.disetujui'), when: whenSchema }),
  z.strictObject({
    type: z.literal('run.diposting'),
    number: z.string().min(1).max(40),
    journal: z.array(journalLine).min(2).max(10),
    when: whenSchema,
  }),
  z.strictObject({ type: z.literal('slip.dikirim'), jam: jamSchema }),
]);
export type PayrollEvent = z.infer<typeof payrollEventSchema>;

export interface PayrollStoreState {
  /** 0 draf · 1 dihitung · 2 disetujui · 3 diposting. */
  stage: 0 | 1 | 2 | 3;
  imported: boolean;
  /** PPh 21 tersimpan saat dihitung (rupiah string). */
  pph: Record<string, string>;
  preparedBy: ActorRef | null;
  approvedBy: ActorRef | null;
  postedBy: ActorRef | null;
  /** Cap waktu demo per tahap (1 dihitung, 2 disetujui, 3 diposting). */
  at: Partial<Record<1 | 2 | 3, string>>;
  slipsSent: { by: ActorRef; jam: string } | null;
  log: LogLine[];
}

export function initialPayroll(): PayrollStoreState {
  return {
    stage: 0,
    imported: false,
    pph: {},
    preparedBy: null,
    approvedBy: null,
    postedBy: null,
    at: {},
    slipsSent: null,
    log: [],
  };
}

/** Baris run dari keadaan toko: jasa pelayanan bila sudah diimpor, PPh 21 tersimpan (atau isian layar). */
export function payrollLines(
  s: Pick<PayrollStoreState, 'imported' | 'pph' | 'stage'>,
  pphDraft: Readonly<Record<string, bigint | null>> = {},
): PayInput[] {
  return PAYROLL_INPUTS.map((i) => {
    const saved = s.pph[i.employeeId];
    return {
      ...i,
      serviceFee: s.imported ? BigInt(SERVICE_FEES[i.name] ?? 0) : 0n,
      pph21:
        s.stage > 0 && saved !== undefined
          ? BigInt(saved)
          : i.employeeId in pphDraft
            ? (pphDraft[i.employeeId] ?? null)
            : i.pph21,
    };
  });
}

export function payrollJournalOf(s: PayrollStoreState) {
  return payrollJournal(payrollLines(s).map(computeSlip));
}

const jl = (j: { account: string; debit: bigint; credit: bigint }) => ({
  account: j.account,
  debit: j.debit.toString(),
  credit: j.credit.toString(),
});

/** Isi kejadian posting yang benar untuk keadaan terkini (dipakai layar dan `validate`). */
export function postingEvent(
  s: PayrollStoreState,
  when: string,
): Extract<PayrollEvent, { type: 'run.diposting' }> {
  return { type: 'run.diposting', number: PAYROLL_PERIOD.number, journal: payrollJournalOf(s).map(jl), when };
}

const SOD = 'Penyetuju harus pengguna lain dari penyusun run gaji (pemisahan tugas).';

function gate(s: PayrollStoreState, ev: PayrollEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'jaspel.diimpor':
      if (s.stage !== 0) return 'Run sudah dihitung; kembalikan ke draf dulu.';
      return s.imported ? 'Jasa pelayanan periode ini sudah diimpor.' : null;
    case 'run.dihitung': {
      if (s.stage !== 0) return 'Run sudah dihitung.';
      const unknown = Object.keys(ev.pph).find((id) => !PAYROLL_INPUTS.some((i) => i.employeeId === id));
      if (unknown) return 'Ada pegawai yang tidak dikenal di run.';
      const lines = PAYROLL_INPUTS.map((i) => ({
        ...i,
        pph21: ev.pph[i.employeeId] === undefined ? null : BigInt(ev.pph[i.employeeId] ?? '0'),
      }));
      return calculateBlock(lines, s.imported);
    }
    case 'run.dikembalikan':
      return s.stage === 1
        ? null
        : 'Hanya run yang sudah dihitung (belum disetujui) yang bisa dikembalikan ke draf.';
    case 'run.disetujui':
      if (s.stage !== 1) return 'Run belum dihitung atau sudah disetujui.';
      if (!actor.role || !(PAYROLL_APPROVER_ROLES as readonly string[]).includes(actor.role))
        return 'Penyetuju run gaji: posisi Akuntan atau Manajemen.';
      return sameUserBlock(s.preparedBy, actor, SOD);
    case 'run.diposting': {
      if (s.stage !== 2) return 'Run belum disetujui atau sudah diposting.';
      const expected = postingEvent(s, ev.when);
      if (JSON.stringify(expected.journal) !== JSON.stringify(ev.journal) || ev.number !== expected.number)
        return 'Jurnal posting tidak sesuai run; muat ulang layar.';
      return journalBalanced(payrollJournalOf(s)) ? null : 'Jurnal tidak seimbang; periksa ulang run.';
    }
    case 'slip.dikirim':
      if (s.stage !== 3) return 'Slip dikirim setelah jurnal gaji diposting.';
      return s.slipsSent ? 'Slip periode ini sudah dikirim.' : null;
  }
}

export const payrollDomain = defineDomain<PayrollStoreState, PayrollEvent>(PAYROLL_DOMAIN, {
  initial: initialPayroll,
  eventSchema: payrollEventSchema,
  screens: ['penggajian'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    const jamOf = (iso: string) => formatJam(iso);
    const log = (jam: string, text: string) => pushLog(s.log, { jam, text, by: by.name });
    switch (d.type) {
      case 'jaspel.diimpor':
        return { ...s, imported: true, log: log(jamOf(d.when), 'Jasa pelayanan diimpor') };
      case 'run.dihitung':
        return {
          ...s,
          stage: 1,
          pph: { ...d.pph },
          preparedBy: by,
          at: { 1: d.when },
          log: log(jamOf(d.when), 'Run gaji dihitung'),
        };
      case 'run.dikembalikan':
        return {
          ...s,
          stage: 0,
          preparedBy: null,
          at: {},
          log: log(jamOf(d.when), 'Run dikembalikan ke draf'),
        };
      case 'run.disetujui':
        return {
          ...s,
          stage: 2,
          approvedBy: by,
          at: { ...s.at, 2: d.when },
          log: log(jamOf(d.when), 'Run gaji disetujui'),
        };
      case 'run.diposting':
        return {
          ...s,
          stage: 3,
          postedBy: by,
          at: { ...s.at, 3: d.when },
          log: log(jamOf(d.when), 'Jurnal gaji diposting'),
        };
      case 'slip.dikirim':
        return { ...s, slipsSent: { by, jam: d.jam }, log: log(d.jam, 'Slip dikirim ke pegawai') };
    }
  },
});
