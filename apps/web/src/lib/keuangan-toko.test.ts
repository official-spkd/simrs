import { journalBalanced, kasirBoardSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { type DemoActor, project, type StoredEvent } from './demo/store/define';
import { CAPTURE_EVENTS } from './demo/fixtures/charge-capture';
import { INVOICE_ID, PATIENT_ID } from './demo/fixtures/ids';
import { DISPUTE_JOURNAL_ID, JOURNAL_COUNT, KASIR_SHIFT, STATIC_INVOICES } from './demo/fixtures/keuangan';
import { DEMO_NOW } from './demo/fixtures/waktu';
import { REGISTRATION_CHARGE } from './front-office-pendaftaran';
import { akuntansiDomain, applyAkuntansi, closeCheck, periodLockMessage } from './keuangan-akuntansi-toko';
import {
  autoJurnalSchema,
  patientPaymentJournal,
  recognitionAutoJournal,
  type AutoJurnal,
} from './keuangan-jurnal';
import {
  applyCaptures,
  applyTagihan,
  heldByRm,
  registeredInvoiceId,
  resolvedFixtureCaptures,
  tagihanDomain,
  type TagihanEvent,
} from './keuangan-tagihan-toko';
import { demoAccountingBoard, type ScenarioResults } from './keuangan-skenario';
import { runScenario } from './demo/engine/run';
import { SCENARIO_ORDER, SCENARIOS } from './demo/skenario';
import { invoiceSettlement } from './keuangan';

const kasir: DemoActor = { userId: 'u-kasir', name: 'Kasir Sesi', role: 'kasir', baseRole: null };
const akuntan: DemoActor = { userId: 'u-ak1', name: 'Akuntan Pembuat', role: 'akuntan', baseRole: null };
const penyetuju: DemoActor = {
  userId: 'u-ak2',
  name: 'Superadmin Demo',
  role: 'akuntan',
  baseRole: 'superadmin',
};
const petugas: DemoActor = {
  userId: 'u-daftar',
  name: 'Petugas Daftar',
  role: 'petugas_pendaftaran',
  baseRole: null,
};

const AT = '2026-10-05T10:50:00+07:00';
let seq = 0;
const ev = (domain: string, data: unknown, actor: DemoActor = kasir): StoredEvent => ({
  seq: ++seq,
  domain,
  at: '2026-10-06T03:50:00.000Z',
  actor,
  data,
});
const log = (events: StoredEvent[]) => ({ seq: events.at(-1)?.seq ?? 0, resetSeq: 0, events });

const visit = (n: number, payer: 'BPJS' | 'Umum', patientId: string = PATIENT_ID.ayu) =>
  ev(
    'pendaftaran',
    {
      type: 'kunjungan.terdaftar',
      visitId: `kj-${n}`,
      patientId,
      rm: '00-12-45-78',
      patientName: 'Pasien Daftar Fiktif',
      payer,
      poliCode: 'PD',
      poliName: 'Poli Penyakit Dalam',
      room: 'Ruang periksa PD 2',
      doctorId: 'dr-andini',
      doctorName: 'dr. Andini Prameswari, Sp.PD',
      sessionId: '0199a000-0000-7000-8000-0000000000aa',
      queueNo: `PD-0${28 + n}`,
      sepNo: payer === 'BPJS' ? '0301R0011026V000812' : null,
      diagnosis: payer === 'BPJS' ? 'I10 · Hipertensi esensial (primer)' : null,
      ticketNo: null,
      jam: '09.10',
      charge: { itemCode: 'ADM-RJ', label: REGISTRATION_CHARGE.label, amount: '30000' },
    },
    petugas,
  );

const kasirBoard = () => ({
  asOf: DEMO_NOW,
  shift: { ...KASIR_SHIFT },
  invoices: [...STATIC_INVOICES],
});

/** PRNG deterministik (mulberry32) untuk tes properti tanpa dependensi baru. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const big = (r: () => number, max: number) => BigInt(Math.floor(r() * max));

const balanced = (j: AutoJurnal) =>
  journalBalanced(j.lines.map((l) => ({ debit: l.debit, credit: l.credit })));

describe('jurnal otomatis keuangan · tes properti (setiap mutasi uang seimbang)', () => {
  it('pengakuan pendapatan + pelunasan pasien selalu seimbang untuk pembagian penjamin acak', () => {
    const r = rng(20261005);
    for (let i = 0; i < 500; i++) {
      const scheme = (['bpjs', 'asuransi', 'umum'] as const)[i % 3] ?? 'umum';
      const hospitalTotal = big(r, 50_000_000) + 1n;
      const payerPays = scheme === 'umum' ? 0n : big(r, 60_000_000);
      const patientShare = scheme === 'umum' ? hospitalTotal : big(r, 5_000_000);
      const hospitalAbsorbs = hospitalTotal - payerPays - patientShare;
      const prepaid = big(r, Number(patientShare) + 1);
      const setting = (['rawat-jalan', 'igd', 'rawat-inap'] as const)[i % 3] ?? 'rawat-jalan';
      const rec = recognitionAutoJournal(
        { scheme, setting, hospitalTotal, payerPays, patientShare, hospitalAbsorbs, prepaid },
        'INV-2610-02401',
      );
      expect(balanced(rec), `pengakuan #${i}`).toBe(true);
      expect(autoJurnalSchema.safeParse(rec).success).toBe(true);
      const method = (['qris', 'va', 'debit', 'tunai', 'transfer', 'cicilan'] as const)[i % 6] ?? 'tunai';
      const pay = patientPaymentJournal(method, big(r, 9_000_000) + 1n, 'INV-2610-02401');
      expect(balanced(pay), `pelunasan #${i}`).toBe(true);
      expect(pay.status).toBe(method === 'qris' || method === 'va' ? 'menunggu-rekonsiliasi' : 'terposting');
    }
  });

  it('skema menolak jurnal yang tidak seimbang atau dua sisi', () => {
    const j = patientPaymentJournal('tunai', 10_000n, 'INV-2610-02401');
    const bad = { ...j, lines: j.lines.map((l, i) => (i === 0 ? { ...l, debit: '9999' } : l)) };
    expect(autoJurnalSchema.safeParse(bad).success).toBe(false);
    const both = { ...j, lines: j.lines.map((l) => ({ ...l, debit: '10000', credit: '10000' })) };
    expect(autoJurnalSchema.safeParse(both).success).toBe(false);
  });
});

describe('domain tagihan (Kasir + Charge capture)', () => {
  it('pendaftaran → tagihan rawat jalan baru (ADM-RJ Rp 30.000) di Kasir + event di Charge capture', () => {
    const p = project(tagihanDomain, log([visit(1, 'Umum'), visit(2, 'BPJS', PATIENT_ID.lukman)]));
    expect(p.state.registered).toHaveLength(2);
    const board = kasirBoardSchema.parse(applyTagihan(kasirBoard(), p.state));
    const umum = board.invoices.find((i) => i.id === registeredInvoiceId('kj-1'));
    expect(umum).toMatchObject({ number: 'INV-2610-02401', queueNo: 'K-021', status: 'berjalan' });
    expect(umum?.lines.map((l) => [l.name, l.amount])).toEqual([['Administrasi rawat jalan', '30000']]);
    expect(umum?.patientDue).toBe('30000');
    const bpjs = board.invoices.find((i) => i.id === registeredInvoiceId('kj-2'));
    expect(bpjs?.split.scheme).toBe('bpjs');
    expect(bpjs?.patientDue).toBe('0');
    const caps = applyCaptures(CAPTURE_EVENTS, p.state).filter((e) => e.source === 'pendaftaran');
    expect(caps.some((e) => e.event === 'encounter.registered' && e.line?.amount === 30_000n)).toBe(true);
  });

  it('item manual → final → bayar: tersimpan, lunas, pembayaran atas nama sesi; tagihan lunas terkunci', () => {
    const id = registeredInvoiceId('kj-1');
    const patient = {
      name: 'Pasien Daftar Fiktif',
      rm: '00-12-45-78',
      place: 'Ruang periksa PD 2',
      payer: 'Umum',
    };
    const manual: TagihanEvent = {
      type: 'item.manual',
      invoiceId: id,
      patient,
      name: 'Nebulisasi tambahan',
      category: 'tindakan',
      qty: 1,
      unitPrice: '35000',
      reason: 'Tindakan malam hari belum tercatat di eMAR',
      at: AT,
    };
    const events = [
      visit(1, 'Umum'),
      ev('tagihan', manual),
      ev('tagihan', { type: 'tagihan.final', invoiceId: id, at: AT }),
    ];
    let p = project(tagihanDomain, log(events));
    let inv = applyTagihan(kasirBoard(), p.state).invoices.find((i) => i.id === id);
    expect(inv?.status).toBe('final');
    const { due } = invoiceSettlement(inv as NonNullable<typeof inv>);
    expect(due).toBe(65_000n);
    const bayar = {
      type: 'tagihan.bayar',
      invoiceId: id,
      invoiceNo: 'INV-2610-02401',
      patient: { id: PATIENT_ID.ayu, name: 'Pasien Daftar Fiktif', rm: '00-12-45-78' },
      method: 'qris',
      amount: '65000',
      reference: 'QR-2610-09001',
      tenor: null,
      at: AT,
      settlement: {
        scheme: 'umum',
        payerLabel: 'Umum (bayar sendiri)',
        setting: 'rawat-jalan',
        hospitalTotal: '65000',
        payerPays: '0',
        patientShare: '65000',
        hospitalAbsorbs: '0',
        prepaid: '0',
        cbg: null,
      },
      jurnal: [
        patientPaymentJournal('qris', 65_000n, 'INV-2610-02401'),
        recognitionAutoJournal(
          {
            scheme: 'umum',
            setting: 'rawat-jalan',
            hospitalTotal: 65_000n,
            payerPays: 0n,
            patientShare: 65_000n,
            hospitalAbsorbs: 0n,
            prepaid: 0n,
          },
          'INV-2610-02401',
        ),
      ],
    };
    events.push(ev('tagihan', bayar));
    p = project(tagihanDomain, log(events));
    inv = applyTagihan(kasirBoard(), p.state).invoices.find((i) => i.id === id);
    expect(inv).toMatchObject({ status: 'lunas', patientDue: '0', receiptNo: 'KW-2610-02401' });
    expect(inv?.payments.at(-1)).toMatchObject({ method: 'qris', amount: '65000' });
    expect(tagihanDomain.validate?.(p.state, manual, kasir)).toMatch(/sudah lunas/);

    // Mengalir: Akuntansi menerima jurnal pelunasan (menunggu rekonsiliasi) + pengakuan pendapatan.
    const ak = project(akuntansiDomain, log(events));
    expect(ak.state.journals).toHaveLength(2);
    const board = applyAkuntansi(demoAccountingBoard(emptyScenarioResults()), ak.state);
    const own = board.journals.filter((j) => j.id.startsWith('ju-toko-'));
    expect(own.map((j) => j.number)).toEqual([`JU-2610${JOURNAL_COUNT + 1}`, `JU-2610${JOURNAL_COUNT + 2}`]);
    expect(own[0]?.status).toBe('menunggu-rekonsiliasi');
    for (const j of own) expect(journalBalanced(j.lines)).toBe(true);
    expect(BigInt(board.kpis.cashAndBank)).toBe(
      BigInt(demoAccountingBoard(emptyScenarioResults()).kpis.cashAndBank) + 65_000n,
    );
  });

  it('gerbang: tagihan pasien skenario ditolak; shift tertutup menolak pembayaran sampai dibuka', () => {
    const s0 = tagihanDomain.initial();
    expect(
      tagihanDomain.validate?.(s0, { type: 'tagihan.final', invoiceId: INVOICE_ID.suryo, at: AT }, kasir),
    ).toMatch(/pasien simulasi/);
    const closed = project(
      tagihanDomain,
      log([ev('tagihan', { type: 'shift.tutup', at: AT, settled: 3, cash: '0' })]),
    );
    const tutup = {
      type: 'tagihan.tutup',
      invoiceId: INVOICE_ID.lukman,
      invoiceNo: 'INV-2610-02224',
      patient: { id: PATIENT_ID.lukman, name: 'Tn. Lukman', rm: '00-12-45-78' },
      at: AT,
      settlement: {
        scheme: 'bpjs',
        payerLabel: 'BPJS',
        setting: 'rawat-jalan',
        hospitalTotal: '238000',
        payerPays: '412300',
        patientShare: '0',
        hospitalAbsorbs: '-174300',
        prepaid: '0',
        cbg: 'Q-5-44-0',
      },
      jurnal: [],
    } as unknown as TagihanEvent;
    expect(tagihanDomain.validate?.(closed.state, tutup, kasir)).toMatch(/Shift kasir sudah ditutup/);
    expect(tagihanDomain.validate?.(closed.state, { type: 'shift.buka', at: AT }, kasir)).toBeNull();
  });

  it('charge capture: kelas ditetapkan admisi → selesaikan → baris masuk tagihan berjalan Raka; finalisasi ditahan sebelumnya', () => {
    const raka = CAPTURE_EVENTS.find((e) => e.id === 'cc-11');
    expect(raka?.status).toBe('tertahan');
    const s0 = tagihanDomain.initial();
    expect(heldByRm(applyCaptures(CAPTURE_EVENTS, s0)).get(raka?.patient.rm ?? '')).toBe(1);
    expect(tagihanDomain.validate?.(s0, { type: 'capture.kelas', eventId: 'cc-11', at: AT }, kasir)).toMatch(
      /Minta admisi/,
    );
    const p = project(
      tagihanDomain,
      log([
        ev('tagihan', { type: 'capture.minta', eventId: 'cc-11', kind: 'kelas', reason: null, at: AT }),
        ev('tagihan', { type: 'capture.kelas', eventId: 'cc-11', at: AT }),
        ev('tagihan', { type: 'capture.selesaikan', eventId: 'cc-11', at: AT }),
      ]),
    );
    const caps = applyCaptures(CAPTURE_EVENTS, p.state);
    expect(caps.find((e) => e.id === 'cc-11')?.status).toBe('tertagih');
    expect(heldByRm(caps).get(raka?.patient.rm ?? '')).toBeUndefined();
    const board = applyTagihan(kasirBoard(), p.state, resolvedFixtureCaptures(CAPTURE_EVENTS, p.state));
    const inv = board.invoices.find((i) => i.id === INVOICE_ID.raka);
    expect(inv?.lines.at(-1)).toMatchObject({ name: 'Akomodasi kamar Kelas 2', amount: '450000' });
  });
});

describe('aliran klinis (CD-2) → charge capture + kasir', () => {
  it('order CPOE ber-tarif, eMAR, dan CPPT final masuk tagihan berjalan; tarif null tertahan', () => {
    const doctor: DemoActor = { userId: 'u-dr', name: 'dr. Sesi', role: 'dokter', baseRole: null };
    const order = ev(
      'klinis-order',
      {
        type: 'order.ditandatangani',
        encounterId: 'enc-rj-1',
        patientId: PATIENT_ID.ayu,
        rm: '00-12-45-78',
        patientName: 'Pasien Daftar Fiktif',
        setting: 'rawat-jalan',
        payer: 'Umum',
        signedAt: '2026-10-05T09:30:00+07:00',
        lines: [
          {
            lineId: 'enc-rj-1-o1-darah-lengkap',
            catalogId: 'darah-lengkap',
            kind: 'lab',
            name: 'Darah lengkap',
            detail: 'cito',
            code: { system: 'LOINC', code: '58410-2' },
            coverage: 'ditanggung',
            priority: 'rutin',
            tariff: '95000',
            override: null,
            dest: 'lab',
          },
          {
            lineId: 'enc-rj-1-o1-baru',
            catalogId: 'baru',
            kind: 'tindakan',
            name: 'Tindakan baru',
            detail: '—',
            code: null,
            coverage: 'ditanggung',
            priority: 'rutin',
            tariff: null,
            override: null,
            dest: 'tindakan',
          },
        ],
      },
      doctor,
    );
    const cppt = ev(
      'klinis-poli',
      {
        type: 'cppt.ditandatangani',
        encounterId: 'enc-rj-1',
        patientId: PATIENT_ID.ayu,
        subjective: 'Keluhan',
        objective: 'TD 150/90',
        diagnosisCodes: ['I10'],
        final: true,
        at: '09.40',
      },
      doctor,
    );
    const p = project(tagihanDomain, log([visit(1, 'Umum'), order, cppt]));
    const inv = applyTagihan(kasirBoard(), p.state).invoices.find(
      (i) => i.id === registeredInvoiceId('kj-1'),
    );
    expect(inv?.lines.map((l) => [l.name, l.amount])).toEqual([
      ['Administrasi rawat jalan', '30000'],
      ['Darah lengkap', '95000'],
      ['Konsultasi dokter spesialis', '150000'],
    ]);
    const caps = applyCaptures(CAPTURE_EVENTS, p.state);
    expect(caps.find((c) => c.id === 'cc-or-enc-rj-1-o1-baru')?.status).toBe('tertahan');
    expect(heldByRm(caps).get('00-12-45-78')).toBe(1);
  });
});

describe('domain akuntansi · pembuat ≠ penyetuju, K-2, periode terkunci', () => {
  const petakan = { type: 'jurnal.petakan', journalId: DISPUTE_JOURNAL_ID, accountCode: '1-1390', at: AT };
  const setujui = { type: 'jurnal.setujui', journalId: DISPUTE_JOURNAL_ID, at: AT } as const;
  const padankan = { type: 'rekening.padankan', accountId: 'btn-klaim', at: AT } as const;
  const tutup = { type: 'periode.tutup', periodId: '2026-10', at: AT } as const;

  it('penyetuju kedua harus pengguna lain (id pengguna sesi, bukan nama)', () => {
    const p = project(akuntansiDomain, log([ev('akuntansi', petakan, akuntan)]));
    expect(akuntansiDomain.validate?.(p.state, setujui, akuntan)).toMatch(
      /penyetuju kedua harus pengguna lain/,
    );
    const samaNama = { ...penyetuju, userId: akuntan.userId, name: 'Nama Lain' };
    expect(akuntansiDomain.validate?.(p.state, setujui, samaNama)).toMatch(/Pemisahan tugas/);
    expect(akuntansiDomain.validate?.(p.state, setujui, penyetuju)).toBeNull();
  });

  it('K-2: tutup periode diblokir selama ada jurnal menunggu penyetuju kedua', () => {
    const events = [ev('akuntansi', petakan, akuntan), ev('akuntansi', padankan, akuntan)];
    let p = project(akuntansiDomain, log(events));
    expect(closeCheck(p.state)).toMatchObject({ ready: false, pendingApproval: ['JU-26100417'] });
    expect(akuntansiDomain.validate?.(p.state, tutup, akuntan)).toMatch(/menunggu penyetuju kedua/);
    events.push(ev('akuntansi', setujui, penyetuju));
    p = project(akuntansiDomain, log(events));
    expect(closeCheck(p.state).ready).toBe(true);
    events.push(ev('akuntansi', tutup, akuntan));
    p = project(akuntansiDomain, log(events));
    expect(p.state.closed).toMatchObject({ periodId: '2026-10', by: 'Akuntan Pembuat' });
    // Periode terkunci: aksi akuntansi dan mutasi uang bertanggal Oktober ditolak.
    expect(akuntansiDomain.validate?.(p.state, padankan, akuntan)).toMatch(/sudah ditutup dan dikunci/);
    expect(periodLockMessage(p.state, AT)).toMatch(/Oktober 2026/);
    expect(periodLockMessage(p.state, '2026-11-02T09:00:00+07:00')).toBeNull();
    const board = applyAkuntansi(demoAccountingBoard(emptyScenarioResults()), p.state);
    expect(board.period).toMatchObject({ status: 'tertutup' });
    expect(board.journals.find((j) => j.id === DISPUTE_JOURNAL_ID)?.status).toBe('terposting');
  });

  it('periode September (tertutup sebelum demo) selalu terkunci', () => {
    expect(periodLockMessage(akuntansiDomain.initial(), '2026-09-30T10:00:00+07:00')).toMatch(
      /September 2026/,
    );
  });
});

function emptyScenarioResults(): ScenarioResults {
  return Object.fromEntries(
    SCENARIO_ORDER.map((id) => [id, runScenario(SCENARIOS[id], [])]),
  ) as ScenarioResults;
}
