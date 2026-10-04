import {
  type AccountingBoard,
  type Claim,
  type ClaimBoard,
  type Invoice,
  type JournalEntry,
  type KasirBoard,
  type Payment,
  periodYYMM,
} from '@simrs/shared';
import { firstOpenTask, taskKey, taskOptions, visibleTasks } from './demo/engine/run';
import { formatSimClock, simInstant } from './demo/engine/format';
import type { RunResult, ScenarioId, TaskValue } from './demo/engine/types';
import { SCENARIO_ORDER } from './demo/skenario';
import {
  ACCOUNTING_KPIS,
  AGING,
  AKUN,
  BANK_RECON,
  buildClaim,
  buildInvoice,
  buildJournal,
  CBG,
  CLAIM_KPIS,
  CLAIM_TOTALS,
  credit,
  debit,
  DOCS_RI,
  DOCS_RJ,
  dx,
  JOURNAL_COUNT,
  type JournalInput,
  KASIR_SHIFT,
  line,
  MAPPING_OPTIONS,
  PERIODS,
  px,
  recognitionLines,
  type SplitInput,
  STATIC_CLAIMS,
  STATIC_INVOICES,
  STATIC_JOURNALS,
} from './demo/fixtures/keuangan';
import { DEMO_NOW } from './demo/fixtures/waktu';
import type { FlowTask, ScenarioFlow } from './keuangan-flow';
import { REKENING } from './demo/fixtures/rs';
import { STAF } from './demo/fixtures/staf';
import { categorizeCharge } from './keuangan';

/**
 * Proyeksi pasien skenario Simulasi ke layar keuangan (ADR-0023): tagihan Kasir = `R.charges` (charge capture
 * tiap langkah), klaim muncul setelah pasien pulang, jurnal terbentuk dari tonggak pembayaran. Murni (tanpa
 * server-only) agar bisa diuji dengan `runScenario` + `advanceTo`.
 */

export function stepIndex(R: RunResult, stepId: string): number {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new Error(`Langkah ${stepId} tidak ada di skenario ${R.def.id}`);
  return i;
}

/** Tugas sudah selesai? */
export function has(R: RunResult, stepId: string, taskId: string): boolean {
  return R.done.has(taskKey(stepIndex(R, stepId), taskId));
}

export function valueOf(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  return R.done.get(taskKey(stepIndex(R, stepId), taskId));
}

/** Instan (ISO) saat tugas selesai, atau null. */
export function doneAt(R: RunResult, stepId: string, taskId: string): string | null {
  const m = R.doneAt.get(taskKey(stepIndex(R, stepId), taskId));
  return m === undefined ? null : simInstant(R.def, m).toISOString();
}

/** Langkah sudah dimulai (aktif atau lewat)? */
export function reached(R: RunResult, stepId: string): boolean {
  return R.finished || R.step >= stepIndex(R, stepId);
}

/** Keadaan langkah `stepId` untuk tombol-tombol layar asli (dikirim ke klien sebagai data biasa). */
export function scenarioFlow(R: RunResult, stepId: string): ScenarioFlow {
  const i = stepIndex(R, stepId);
  const step = R.def.steps[i];
  const active = !R.finished && R.step === i;
  const open = active ? firstOpenTask(R, i) : null;
  const shown = new Set(visibleTasks(R, i).map((t) => t.id));
  const tasks: Record<string, FlowTask> = {};
  for (const t of step?.tasks ?? []) {
    const v = R.done.get(taskKey(i, t.id));
    tasks[t.id] = {
      id: t.id,
      label: t.label,
      btn: t.kind === 'act' ? t.btn : '',
      done: v !== undefined,
      enabled: open?.id === t.id,
      visible: shown.has(t.id),
      value: v === undefined ? null : v === true ? 'ya' : v,
      at: ((m) => (m === undefined ? null : formatSimClock(R.def, m)))(R.doneAt.get(taskKey(i, t.id))),
      options:
        t.kind === 'choice'
          ? taskOptions(t, R.rec).map((o) => ({ id: o.id, label: o.label, sub: o.sub ?? '' }))
          : [],
    };
  }
  return {
    scenario: R.def.id,
    step: i,
    active,
    activeTitle: R.finished ? null : (R.def.steps[R.step]?.title ?? null),
    next: open ? { id: open.id, label: open.label } : null,
    tasks,
  };
}

/** Jam tahap asal charge (mulai langkah), mis. "07.32" atau "Sab 3 Okt · 21.40". */
function stageClock(R: RunResult, stage: string): string {
  const i = R.def.steps.findIndex((s) => s.stage === stage);
  const start = i < 0 ? null : (R.stepStart[i] ?? null);
  return start === null ? '' : formatSimClock(R.def, start);
}

const SCENARIO_PATIENT: Record<ScenarioId, string> = {
  'rawat-jalan': 'ps-suryo',
  'igd-ranap': 'ps-hartono',
  'elektif-btn': 'ps-ratna',
};

/** Selisih naik kelas VIP skenario elektif (persetujuan admisi; master aturan selisih JKN, simulasi). */
export const ELEKTIF_SELISIH = 9_400_000n;

function splitOf(id: ScenarioId, R: RunResult): SplitInput {
  const dx = R.rec.dx.length > 0;
  if (id === 'rawat-jalan') {
    return {
      scheme: 'bpjs',
      payerLabel: 'BPJS hak kelas 2',
      inacbg: dx ? { ...CBG.rjKronis, estimate: true } : null,
    };
  }
  const sent = has(R, 'klaim', 'kirim');
  if (id === 'igd-ranap') {
    return {
      scheme: 'bpjs',
      payerLabel: 'BPJS hak kelas 1',
      inacbg: dx ? { ...CBG.imaK1, estimate: !sent } : null,
    };
  }
  return {
    scheme: 'bpjs',
    payerLabel: 'BPJS hak kelas 2',
    inacbg: dx ? { ...CBG.empeduK2, estimate: !sent } : null,
    upgrade: R.rec.vip
      ? {
          label: 'Naik kelas VIP (atas permintaan)',
          amount: ELEKTIF_SELISIH,
          rule: 'Master aturan selisih biaya JKN · persetujuan ditandatangani saat admisi',
        }
      : null,
  };
}

function paymentsOf(id: ScenarioId, R: RunResult): Payment[] {
  if (id !== 'elektif-btn') return [];
  const out: Payment[] = [];
  const r = R.rec;
  const dp = doneAt(R, 'deposit', 'webhook');
  if (r.deposit > 0n && dp) {
    out.push({
      id: 'pay-ratna-dp',
      kind: 'deposit',
      method: r.kanal === 'qris' ? 'qris' : 'va',
      amount: r.deposit.toString(),
      at: dp,
      reference: r.kanal === 'qris' ? 'QRIS INV-DP-2610-0412' : 'VA BTN 8808 0127 0005 2031',
    });
  }
  const cair = doneAt(R, 'kasir', 'cair');
  if (r.dibiayai > 0n && cair) {
    out.push({
      id: 'pay-ratna-btn',
      kind: 'pelunasan',
      method: 'cicilan',
      amount: r.dibiayai.toString(),
      at: cair,
      reference: `PB-2610-0088 · tenor ${r.tenor ?? '-'} bulan`,
    });
  }
  const qris = doneAt(R, 'kasir', 'qrisbayar');
  if (r.lunasQris > 0n && qris) {
    out.push({
      id: 'pay-ratna-qris',
      kind: 'pelunasan',
      method: 'qris',
      amount: r.lunasQris.toString(),
      at: qris,
      reference: 'QR-2610-90412',
    });
  }
  return out;
}

const ENCOUNTER: Record<ScenarioId, { seq: number; kind: Invoice['encounter']['kind']; label: string }> = {
  'rawat-jalan': { seq: 2230, kind: 'rawat-jalan', label: 'Rawat jalan Poli Penyakit Dalam' },
  'igd-ranap': { seq: 2164, kind: 'rawat-inap', label: 'IGD → rawat inap · nyeri dada' },
  'elektif-btn': { seq: 2391, kind: 'rawat-inap', label: 'Bedah elektif · kolesistektomi laparoskopik' },
};

const DPJP: Record<ScenarioId, string> = {
  'rawat-jalan': STAF.dpjpPenyakitDalam,
  'igd-ranap': STAF.dpjpJantung,
  'elektif-btn': STAF.dpjpBedah,
};

/** Tagihan pasien skenario: baris = `R.charges` (urutan charge capture), null bila belum ada charge. */
export function scenarioInvoice(id: ScenarioId, R: RunResult): Invoice | null {
  if (R.charges.length === 0) return null;
  const conf = ENCOUNTER[id];
  const final = has(R, 'kasir', 'final');
  const closed =
    id === 'rawat-jalan'
      ? has(R, 'kasir', 'tutup')
      : id === 'igd-ranap'
        ? has(R, 'kasir', 'pulang')
        : has(R, 'kasir', 'pulang') || has(R, 'kasir', 'cair') || has(R, 'kasir', 'qrisbayar');
  const atKasir = reached(R, 'kasir');
  const kind = id === 'igd-ranap' && !has(R, 'admisi', 'transfer') ? 'igd' : conf.kind;
  const startDay = formatSimClock({ ...R.def, showDay: true }, R.def.startMin).split(' · ')[0] ?? '';
  return buildInvoice({
    id: `inv-${SCENARIO_PATIENT[id].replace('ps-', '')}`,
    seq: conf.seq,
    queue: id === 'rawat-jalan' && atKasir ? 15 : null,
    patientId: SCENARIO_PATIENT[id],
    scenario: id,
    encounter: {
      kind,
      label: conf.label,
      location: R.rec.lokasi || 'Admisi',
      period: R.rec.pulangAt === null ? `${startDay} – sekarang` : `${startDay} – pulang`,
      sep: R.rec.sep || null,
      dpjp: DPJP[id],
      discharged: atKasir,
    },
    status: closed ? 'lunas' : final ? 'final' : 'berjalan',
    lines: R.charges.map((c, i) =>
      line(`${id}-${i + 1}`, categorizeCharge(c.name), c.src, stageClock(R, c.src), c.name, 1, c.amount),
    ),
    split: splitOf(id, R),
    payments: paymentsOf(id, R),
    finalizedAt: doneAt(R, 'kasir', 'final'),
    note: atKasir ? undefined : 'Charge capture berjalan · pasien masih dalam pelayanan',
  });
}

const grouperOf = (
  g: { code: string; name: string; classLabel: string; tariff: bigint },
  final: boolean,
) => ({
  cbg: g.code,
  name: g.name,
  classLabel: g.classLabel,
  tariff: g.tariff.toString(),
  specialCmg: null,
  final,
});

/** Klaim pasien skenario: muncul setelah pasien pulang (RJ: setelah berkas dikirim ke antrean koder). */
export function scenarioClaim(id: ScenarioId, R: RunResult): Claim | null {
  const inv = scenarioInvoice(id, R);
  if (!inv) return null;
  const sep = R.rec.sep || '—';
  if (id === 'rawat-jalan') {
    if (!has(R, 'pasca', 'klaim')) return null;
    const codes = R.rec.dx.map((d) => d.split(' ')[0] ?? '');
    return buildClaim({
      id: 'kl-suryo',
      patientId: SCENARIO_PATIENT[id],
      scenario: id,
      encounter: {
        kind: 'rawat-jalan',
        summary: `RJ · DM tipe 2${R.rec.prb ? ' · PRB' : ''}`,
        title: 'rawat jalan Poli Penyakit Dalam',
        sep,
        classLabel: 'rawat jalan',
        dpjp: DPJP[id],
        resume: 'catatan poli dan resep ber-TTE',
        discharged: true,
      },
      status: 'draft',
      tag: { label: 'Siap grouping', level: 'ok' },
      ageLabel: 'pulang H-0',
      diagnoses: codes.map((c, i) => dx(c, i === 0 ? 'utama' : 'sekunder')),
      procedures: [px('89.03')],
      grouper: grouperOf(CBG.rjKronis, false),
      hospitalCost: inv.split.hospitalTotal,
      documents: DOCS_RJ,
      note: {
        level: 'ok',
        title: 'Berkas lengkap otomatis.',
        text: `Kode ditarik dari CPPT dan order (${codes.join(', ')}); koder memvalidasi, bukan mengetik ulang.`,
      },
      suggestion: null,
    });
  }
  if (!has(R, 'kasir', 'pulang')) return null;
  const sent = has(R, 'klaim', 'kirim');
  if (id === 'igd-ranap') {
    const mismatch = valueOf(R, 'klaim', 'utama') === 'I20.0' && !has(R, 'klaim', 'bukti');
    const sekunder = has(R, 'klaim', 'sekunder');
    return buildClaim({
      id: 'kl-hartono',
      patientId: SCENARIO_PATIENT[id],
      scenario: id,
      encounter: {
        kind: 'rawat-inap',
        summary: 'RI · NSTEMI · ICU',
        title: 'IGD → rawat inap',
        sep,
        classLabel: 'hak kelas 1',
        dpjp: DPJP[id],
        resume: 'resume final ber-TTE',
        discharged: true,
      },
      status: sent ? 'sent' : 'draft',
      tag: sent
        ? { label: 'Terkirim', level: 'info' }
        : mismatch
          ? { label: 'Kode tidak sesuai bukti', level: 'bad' }
          : sekunder
            ? { label: 'Siap kirim', level: 'ok' }
            : { label: 'Perlu validasi', level: 'warn' },
      ageLabel: 'pulang H-1',
      diagnoses: [
        dx(mismatch ? 'I20.0' : 'I21.4', 'utama'),
        dx('E87.5', 'sekunder'),
        dx('N18.3', 'sekunder'),
        dx('I10', 'sekunder'),
      ],
      procedures: [px('89.52'), px('88.72')],
      grouper: mismatch ? null : grouperOf(CBG.imaK1, sent),
      hospitalCost: inv.split.hospitalTotal,
      documents: DOCS_RI,
      note: sent
        ? {
            level: 'info',
            title: 'Terkirim ke verifikator BPJS.',
            text: 'Berkas dikunci untuk verifikasi; piutang BPJS tetap terbuka sampai dana cair.',
          }
        : mismatch
          ? {
              level: 'bad',
              title: 'Kode tidak sesuai bukti:',
              text: 'troponin I meningkat dan EKG iskemik mendukung I21.4, bukan I20.0. Grouping ditahan.',
            }
          : {
              level: 'info',
              title: 'Kode ditarik dari resume final.',
              text: 'Validasi diagnosis utama, sekunder, dan prosedur sebelum grouping dan kirim E-Klaim.',
            },
      suggestion: null,
      submittedAt: doneAt(R, 'klaim', 'kirim'),
    });
  }
  const layak = has(R, 'klaim', 'layak');
  const paid = has(R, 'pembiayaan', 'bpjs');
  const extraDocs: Array<[string, string]> = [['lapop', 'Laporan operasi ber-TTE']];
  if (R.rec.vip) extraDocs.push(['naik-kelas', 'Persetujuan naik kelas bertanda tangan']);
  return buildClaim({
    id: 'kl-ratna',
    patientId: SCENARIO_PATIENT[id],
    scenario: id,
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · laparoskopi kolesistektomi',
      title: 'rawat inap bedah elektif',
      sep,
      classLabel: R.rec.vip ? 'hak kelas 2 · naik VIP' : 'hak kelas 2',
      dpjp: DPJP[id],
      resume: 'resume dan laporan operasi ber-TTE',
      discharged: true,
    },
    status: paid ? 'paid' : layak ? 'payable' : sent ? 'sent' : 'draft',
    tag: paid
      ? { label: 'Dibayar', level: 'ok' }
      : layak
        ? { label: 'Layak bayar', level: 'ok' }
        : sent
          ? { label: 'Terkirim', level: 'info' }
          : { label: has(R, 'klaim', 'kode') ? 'Siap kirim' : 'Siap', level: 'ok' },
    ageLabel: 'pulang H-0',
    diagnoses: [dx('K80.2', 'utama')],
    procedures: [px('51.23'), px('88.76')],
    grouper: grouperOf(CBG.empeduK2, sent),
    hospitalCost: inv.split.hospitalTotal,
    documents: [...DOCS_RI, ...extraDocs],
    note: paid
      ? {
          level: 'ok',
          title: 'Dibayar BPJS.',
          text: `Dana masuk rekening penampungan ${REKENING.penampungan}.`,
        }
      : layak
        ? {
            level: 'ok',
            title: 'Layak bayar.',
            text: 'Klaim bisa dimasukkan ke pool pembiayaan piutang BTN sebelum BPJS membayar.',
          }
        : sent
          ? { level: 'info', title: 'Terkirim ke verifikator BPJS.', text: 'Menunggu hasil verifikasi.' }
          : {
              level: 'ok',
              title: 'Tidak ada saran koding.',
              text: 'Kode sesuai resume dan laporan operasi ber-TTE.',
            },
    suggestion: null,
    submittedAt: doneAt(R, 'klaim', 'kirim'),
  });
}

/** Pembiayaan piutang skenario elektif: 90% klaim, pelunasan pokok + margin 21 hari saat BPJS membayar. */
const ANJAK = 6_426_000n;
const ANJAK_LUNAS = 6_455_600n;

/**
 * Jurnal otomatis dari tonggak skenario (selalu seimbang): pengakuan pendapatan saat kunjungan ditutup, deposit
 * dan pelunasan via TPDI × BTN (terposting setelah rekonsiliasi 3 arah), pembiayaan piutang, dan pembayaran BPJS.
 */
export function scenarioJournals(id: ScenarioId, R: RunResult): JournalEntry[] {
  const inv = scenarioInvoice(id, R);
  if (!inv) return [];
  const out: JournalEntry[] = [];
  const add = (j: Omit<JournalInput, 'period' | 'scenario'>) =>
    out.push(buildJournal({ ...j, period: periodYYMM(j.date), scenario: id }));
  const close = id === 'rawat-jalan' ? doneAt(R, 'kasir', 'tutup') : doneAt(R, 'kasir', 'pulang');
  if (id !== 'elektif-btn') {
    if (close) {
      add({
        id: `ju-${id}`,
        seq: id === 'rawat-jalan' ? 421 : 688,
        date: close,
        source: 'kasir',
        reference: `Kasir · ${inv.number}`,
        description:
          id === 'rawat-jalan'
            ? 'Tutup kunjungan RJ BPJS Tn. Suryo · tarif RS vs estimasi INA-CBG'
            : 'Pasien pulang · pengakuan pendapatan RI BPJS Tn. Hartono',
        lines: recognitionLines(inv, id === 'igd-ranap', AKUN.piutangPasien),
      });
    }
    return out;
  }
  const r = R.rec;
  const recon = has(R, 'rekonsiliasi', 'jurnal') ? 'terposting' : 'menunggu-rekonsiliasi';
  const dp = doneAt(R, 'deposit', 'webhook');
  if (dp && r.deposit > 0n) {
    add({
      id: 'ju-ratna-dp',
      seq: 851,
      date: dp,
      source: 'tpdi-btn',
      reference: 'TPDI · INV-DP-2610-0412',
      description: `Deposit naik kelas via ${r.kanal === 'qris' ? 'QRIS' : 'VA BTN'} · dana langsung ke BTN ${REKENING.operasional}`,
      status: recon,
      lines: [debit(AKUN.bankOps, r.deposit), credit(AKUN.uangMuka, r.deposit)],
    });
  }
  const lunas = doneAt(R, 'kasir', 'cair') ?? doneAt(R, 'kasir', 'qrisbayar');
  const sisa = r.dibiayai + r.lunasQris;
  if (lunas && sisa > 0n) {
    add({
      id: 'ju-ratna-lunas',
      seq: 867,
      date: lunas,
      source: 'tpdi-btn',
      reference: r.dibiayai > 0n ? 'BTN · pembiayaan PB-2610-0088' : 'TPDI · QR-2610-90412',
      description:
        r.dibiayai > 0n
          ? 'Pencairan cicilan BTN untuk sisa selisih naik kelas (pasien mengangsur ke BTN)'
          : 'Pelunasan sisa selisih naik kelas via QRIS',
      status: recon,
      lines: [debit(AKUN.bankOps, sisa), credit(AKUN.uangMuka, sisa)],
    });
  }
  if (close) {
    add({
      id: 'ju-ratna',
      seq: 869,
      date: close,
      source: 'kasir',
      reference: `Kasir · ${inv.number}`,
      description: 'Pasien pulang · pendapatan RI BPJS dan selisih naik kelas (uang muka diterapkan)',
      lines: recognitionLines(inv, true, AKUN.uangMuka),
    });
  }
  const cair = doneAt(R, 'pembiayaan', 'cair');
  if (cair) {
    add({
      id: 'ju-ratna-anjak',
      seq: 1042,
      date: cair,
      source: 'tpdi-btn',
      reference: 'BTN · fasilitas pembiayaan piutang',
      description: 'Pencairan 90% klaim layak bayar sebelum BPJS membayar',
      lines: [debit(AKUN.bankOps, ANJAK), credit(AKUN.utangPembiayaan, ANJAK)],
    });
  }
  const bpjs = doneAt(R, 'pembiayaan', 'bpjs');
  if (bpjs) {
    const tariff = CBG.empeduK2.tariff;
    add({
      id: 'ju-ratna-bpjs',
      seq: 215,
      date: bpjs,
      source: 'klaim',
      reference: 'BPJS · pembayaran klaim',
      description: `BPJS membayar klaim ke rekening penampungan ${REKENING.penampungan}`,
      lines: [debit(AKUN.bankKlaim, tariff), credit(AKUN.piutangBpjsRi, tariff)],
    });
    add({
      id: 'ju-ratna-teruskan',
      seq: 216,
      date: bpjs,
      source: 'tpdi-btn',
      reference: r.ajukan ? 'BTN · auto-debit pelunasan' : 'BTN · pemindahan dana',
      description: r.ajukan
        ? 'Pelunasan pokok + margin pembiayaan; sisa diteruskan ke rekening operasional'
        : 'Dana klaim diteruskan penuh ke rekening operasional',
      lines: r.ajukan
        ? [
            debit(AKUN.utangPembiayaan, ANJAK),
            debit(AKUN.bebanMargin, ANJAK_LUNAS - ANJAK),
            credit(AKUN.bankKlaim, ANJAK_LUNAS),
            debit(AKUN.bankOps, tariff - ANJAK_LUNAS),
            credit(AKUN.bankKlaim, tariff - ANJAK_LUNAS),
          ]
        : [debit(AKUN.bankOps, tariff), credit(AKUN.bankKlaim, tariff)],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Papan layar: fixture + proyeksi pasien skenario (divalidasi kontrak di `lib/server/data/keuangan.ts`).
// ---------------------------------------------------------------------------------------------------------------

export type ScenarioResults = Record<ScenarioId, RunResult>;

const STATUS_RANK: Record<Invoice['status'], number> = { final: 0, berjalan: 1, lunas: 2 };

/** Antrean kasir: pasien skenario yang belum lunas di atas, lalu siap bayar → berjalan → lunas. */
export function demoKasirBoard(results: ScenarioResults): KasirBoard {
  const scenario = SCENARIO_ORDER.flatMap((id) => {
    const inv = scenarioInvoice(id, results[id]);
    return inv ? [inv] : [];
  });
  const rank = (i: Invoice) => (i.scenario && i.status !== 'lunas' ? -1 : STATUS_RANK[i.status]);
  const invoices = [...scenario, ...STATIC_INVOICES].sort(
    (a, b) => rank(a) - rank(b) || a.number.localeCompare(b.number),
  );
  return { asOf: DEMO_NOW, shift: { ...KASIR_SHIFT }, invoices };
}

export function demoClaimBoard(results: ScenarioResults): ClaimBoard {
  const scenario = SCENARIO_ORDER.flatMap((id) => {
    const c = scenarioClaim(id, results[id]);
    return c ? [c] : [];
  });
  return {
    asOf: DEMO_NOW,
    periodLabel: 'Pelayanan Oktober 2026',
    kpis: {
      ...CLAIM_KPIS,
      claimsMonth: { ...CLAIM_KPIS.claimsMonth },
      pending: { ...CLAIM_KPIS.pending },
      dispute: { ...CLAIM_KPIS.dispute },
    },
    totals: { ...CLAIM_TOTALS },
    claims: [...scenario, ...STATIC_CLAIMS],
  };
}

export function demoAccountingBoard(results: ScenarioResults): AccountingBoard {
  const scenario = SCENARIO_ORDER.flatMap((id) => scenarioJournals(id, results[id]));
  const journals = [...STATIC_JOURNALS, ...scenario].sort(
    (a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
  );
  const btn = results['elektif-btn'];
  const matched = has(btn, 'rekonsiliasi', 'cocok');
  return {
    asOf: DEMO_NOW,
    ...PERIODS,
    kpis: ACCOUNTING_KPIS,
    journalCount: JOURNAL_COUNT + scenario.length,
    journals,
    mappingOptions: MAPPING_OPTIONS,
    aging: AGING,
    bankRecon: BANK_RECON.map((b) =>
      b.id === 'btn-ops' && matched
        ? { ...b, note: `${b.note} · transaksi Ny. Ratna Sari cocok di tiga sumber, 0 selisih` }
        : b,
    ),
  };
}
