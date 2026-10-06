import { z } from 'zod';
import { defineDomain, on, type DomainEvent } from './demo/store/define';
import { LAB_TESTS, demoLabSamples, demoPrescriptions, demoRadiologyExams } from './demo/fixtures/penunjang';
import { demoBloodRequests, demoBloodUnits } from './demo/fixtures/penunjang-bank-darah';
import { DEPO_MASTER, demoDepoState } from './demo/fixtures/penunjang-depo';
import { demoCultures, demoPaCases } from './demo/fixtures/penunjang-mikro';
import { demoDietOrders, demoDeliveries } from './demo/fixtures/penunjang-gizi';
import { demoDiagOrders } from './demo/fixtures/penunjang-diagnostik';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { labFlag, deltaCheck, nextValidation, validationBlock, type LabLocal } from './penunjang';
import { applyStoredReportToSample, criticalDomain } from './penunjang-kritis';
import {
  cdsFollowUpGate,
  blockingAlerts,
  applyRxLocal,
  type RxLocal,
  HANDOVER_CHECKS,
} from './penunjang-farmasi';
import { radStartGate, radFinishGate, radSignGate } from './penunjang-radiologi';
import { applyBlood, issueGate, BLOOD_GATE_TEXT } from './penunjang-bank-darah';
import { applyDepo, dispenseGate, usableStock, DEPO_ERROR_TEXT } from './penunjang-depo';
import { deliveryGate, GIZI_GATE_TEXT, mstScore } from './penunjang-gizi';
import { applyCulture, MICRO_GATE_TEXT, paSignGate, paAddendumGate } from './penunjang-mikro';
import { applyDiag, DIAG_GATE_TEXT } from './penunjang-diagnostik';
import { KAMAR_OK } from './demo/fixtures/btn';
import { demoAnesthesia } from './demo/fixtures/penunjang-anestesi';
import {
  canConfirmPhase,
  currentPhase,
  EMPTY_LOCAL,
  withLocal,
  incisionGate,
  COUNT_ITEM,
  checkCounts,
  type OkLocal,
} from './btn-ok';
import {
  EMPTY_PRE,
  preAnesthesiaMissing,
  inductionGate,
  INDUCTION_BLOCK_TEXT,
  type AnesthesiaRecord,
} from './penunjang-anestesi';
import { integrationEventSchema, type IntegrationEvent } from './integrasi-event-schemas';
import { PROCESSED_TODAY } from './demo/fixtures/integrasi-perangkat';
import { processInbound, type InboundResult } from './integrasi-perangkat';
import type { CriticalItem, CriticalEvent } from './penunjang-kritis';
import { TEMPLATES } from './penunjang-diagnostik';
import {
  bloodInput,
  nutritionInput,
  microInput,
  diagnosticInput,
  operatingInput,
  anesthesiaInput,
} from './penunjang-event-schemas';

const id = z.string().min(1).max(80);
export interface DoseCheck {
  userId: string;
  name: string;
  at: string;
}
const depotInput = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('keluar'),
    depotId: id,
    itemId: id,
    qty: z.number().int().positive(),
    ref: z.string().max(120),
    batchId: id.optional(),
    reason: z.string().max(300).optional(),
    secondChecker: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('kirim'),
    from: id,
    to: id,
    itemId: id,
    qty: z.number().int().positive(),
  }),
  z.strictObject({ type: z.literal('terima'), transferId: id, receiver: z.string() }),
  z.strictObject({
    type: z.literal('opname'),
    depotId: id,
    counts: z.record(id, z.number().int().nonnegative()),
    reason: z.string().max(300),
  }),
  z.strictObject({ type: z.literal('karantina'), depotId: id, batchId: id }),
]);

export const supportEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('lab.validasi'), sampleId: id, level: z.enum(['teknis', 'klinis']) }),
  z.strictObject({ type: z.literal('lab.sampel-ulang'), sampleId: id, cancel: z.boolean() }),
  z.strictObject({
    type: z.literal('rad.mulai'),
    examId: id,
    identityChecked: z.boolean(),
    contrastChecked: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('rad.akuisisi'),
    examId: id,
    ctdiVol: z.number().nullable(),
    dlp: z.number().nullable(),
  }),
  z.strictObject({
    type: z.literal('rad.tte'),
    examId: id,
    findings: z.string().max(4000),
    impression: z.string().max(1000),
  }),
  z.strictObject({
    type: z.literal('rx.telaah'),
    rxId: id,
    decision: z.enum(['setujui', 'tahan', 'lepas', 'sebagian']),
  }),
  z.strictObject({
    type: z.literal('rx.cds'),
    rxId: id,
    alertId: id,
    action: z.enum(['usul', 'setuju', 'konfirmasi', 'override']),
    reason: z.string().max(500).optional(),
  }),
  z.strictObject({ type: z.literal('rx.cek-ganda'), rxId: id }),
  z.strictObject({
    type: z.literal('rx.centang'),
    rxId: id,
    kind: z.enum(['prep', 'handover']),
    index: z.number().int().nonnegative(),
    checked: z.boolean(),
  }),
  z.strictObject({ type: z.literal('rx.siap'), rxId: id }),
  z.strictObject({
    type: z.literal('rx.serah'),
    rxId: id,
    receiver: z.enum(['pasien', 'keluarga', 'perawat']),
  }),
  z.strictObject({ type: z.literal('darah.aksi'), input: bloodInput }),
  z.strictObject({
    type: z.literal('darah.periksa'),
    requestId: id,
    unitId: id,
    stage: z.enum(['issue', 'bedside']),
    items: z.record(id, z.boolean()),
    reason: z.string().max(300).optional(),
  }),
  z.strictObject({ type: z.literal('depo.aksi'), input: depotInput }),
  z.strictObject({ type: z.literal('depo.periksa'), input: depotInput.options[0] }),
  z.strictObject({ type: z.literal('gizi.aksi'), input: nutritionInput }),
  z.strictObject({ type: z.literal('mikro.aksi'), input: microInput }),
  z.strictObject({ type: z.literal('diagnostik.aksi'), input: diagnosticInput }),
  z.strictObject({ type: z.literal('ok.aksi'), input: operatingInput }),
  z.strictObject({ type: z.literal('ok.centang'), caseId: id, itemId: id, checked: z.boolean() }),
  z.strictObject({
    type: z.literal('ok.hitung'),
    caseId: id,
    countId: id,
    value: z.number().int().nonnegative().max(10000).nullable(),
  }),
  z.strictObject({ type: z.literal('anestesi.aksi'), input: anesthesiaInput }),
]);
export type SupportEvent = z.infer<typeof supportEventSchema>;

export function initialSupportState() {
  return {
    samples: demoLabSamples(),
    labs: {} as Record<string, LabLocal>,
    exams: demoRadiologyExams(),
    prescriptions: demoPrescriptions(),
    rx: {} as Record<string, RxLocal>,
    preparers: {} as Record<string, string>,
    checks: {} as Record<string, DoseCheck[]>,
    blood: { requests: demoBloodRequests(), units: demoBloodUnits() },
    depo: demoDepoState(),
    cultures: demoCultures(),
    pa: demoPaCases(),
    diets: demoDietOrders(),
    deliveries: demoDeliveries(),
    diagnostics: demoDiagOrders(),
    operations: KAMAR_OK.flatMap((room) =>
      room.cases.map((c) =>
        c.scenario
          ? {
              ...c,
              status: 'terjadwal' as const,
              incisionAt: null,
              checklist: c.checklist.map((p) => ({
                ...p,
                items: p.items.map((i) => ({ ...i, checked: false })),
                confirmedAt: null,
                confirmedBy: null,
              })),
              counts: c.counts.map((x) => ({ ...x, final: null })),
            }
          : c,
      ),
    ),
    ok: {} as Record<string, OkLocal>,
    anesthesia: demoAnesthesia(),
    gatewayProcessed: [...PROCESSED_TODAY],
    criticals: [] as CriticalItem[],
    dispensations: [] as {
      rxId: string;
      patientId: string;
      at: string;
      by: string;
      items: { id: string; name: string; quantity: number; dose: string; route: string; frequency: string }[];
    }[],
    unmappedStock: {
      ...Object.fromEntries(
        demoPrescriptions().flatMap((rx) => rx.items.map((i) => [i.name, i.stock] as const)),
      ),
      'Pantoprazol 40 mg inj': 64,
    } as Record<string, number>,
    // Pantoprazol adalah substitusi fixture CDS; tanpa kode/harga yang dikarang.
    released: [] as { id: string; patientId: string; source: string; by: string; at: string }[],
  };
}
export type SupportState = ReturnType<typeof initialSupportState>;

const requireValue = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new Error(message);
  return value;
};
function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function depotCheckKey(a: z.infer<(typeof depotInput.options)[0]>): string {
  return JSON.stringify([a.depotId, a.itemId, a.qty, a.ref, a.batchId ?? null, a.reason ?? null]);
}
const allowedRole = (role: string | null, roles: readonly string[]) => {
  must(role && roles.includes(role), 'Posisi aktif tidak berhak menjalankan langkah ini.');
};
const update = <T extends { id: string }>(rows: T[], next: T): T[] =>
  rows.map((r) => (r.id === next.id ? next : r));

/** Semua transisi diperiksa pada keadaan server terkini di dalam kunci toko. */
export function reduceSupport(s: SupportState, ev: DomainEvent<SupportEvent>): SupportState {
  const a = ev.data;
  const { actor, at } = ev;
  const by = actor.name;
  const release = (id: string, patientId: string, source: string) => ({
    ...s,
    released: [...s.released, { id, patientId, source, by, at }],
  });
  if (a.type.startsWith('lab.')) {
    const p = a as Extract<SupportEvent, { type: 'lab.validasi' | 'lab.sampel-ulang' }>;
    const sample = requireValue(
      s.samples.find((x) => x.id === p.sampleId),
      'Sampel tidak ditemukan.',
    );
    const local = s.labs[sample.id] ?? {};
    if (p.type === 'lab.sampel-ulang') {
      allowedRole(actor.role, ['analis_lab', 'dokter']);
      must(
        sample.status !== 'selesai' && sample.results.length > 0,
        'Hasil final tidak boleh diulang tanpa revisi.',
      );
      return { ...s, labs: { ...s.labs, [sample.id]: p.cancel ? {} : { resampleAt: at } } };
    }
    allowedRole(actor.role, p.level === 'klinis' ? ['dokter'] : ['analis_lab', 'dokter']);
    must(nextValidation(sample) === p.level, 'Urutan validasi tidak sesuai atau hasil sudah dirilis.');
    must(
      !validationBlock(sample, !!local.resampleAt),
      validationBlock(sample, !!local.resampleAt) ?? 'Validasi diblokir.',
    );
    const next =
      p.level === 'teknis'
        ? { ...sample, status: 'validasi-teknis' as const, technical: { by, at } }
        : { ...sample, status: 'selesai' as const, clinical: { by, at } };
    return {
      ...(p.level === 'klinis' ? release(sample.id, sample.patient.id, 'lab') : s),
      samples: update(s.samples, next),
    };
  }
  switch (a.type) {
    case 'rad.mulai': {
      allowedRole(actor.role, ['radiografer', 'dokter']);
      const x = requireValue(
        s.exams.find((x) => x.id === a.examId),
        'Pemeriksaan tidak ditemukan.',
      );
      must(x.status === 'terjadwal', 'Pemeriksaan sudah dimulai.');
      const g = radStartGate(x, a.identityChecked, a.contrastChecked);
      must(!g, g?.message ?? 'Mulai ditolak.');
      return { ...s, exams: update(s.exams, { ...x, status: 'berlangsung', startedAt: at }) };
    }
    case 'rad.akuisisi': {
      allowedRole(actor.role, ['radiografer', 'dokter']);
      const x = requireValue(
        s.exams.find((x) => x.id === a.examId),
        'Pemeriksaan tidak ditemukan.',
      );
      must(x.status === 'berlangsung', 'Mulai pemeriksaan lebih dulu.');
      const g = radFinishGate(x, a.ctdiVol, a.dlp);
      must(!g, g?.message ?? 'Dosis tidak sah.');
      return {
        ...s,
        exams: update(s.exams, {
          ...x,
          status: 'ekspertise',
          dose: a.ctdiVol === null || a.dlp === null ? x.dose : { ctdiVol: a.ctdiVol, dlp: a.dlp },
        }),
      };
    }
    case 'rad.tte': {
      allowedRole(actor.role, ['dokter']);
      const x = requireValue(
        s.exams.find((x) => x.id === a.examId),
        'Pemeriksaan tidak ditemukan.',
      );
      must(x.status === 'ekspertise', 'Ekspertise hanya setelah akuisisi, hasil final terkunci.');
      const g = radSignGate(x, a.findings, a.impression);
      must(!g, g?.message ?? 'Ekspertise belum lengkap.');
      return {
        ...release(x.id, x.patient.id, 'radiologi'),
        exams: update(s.exams, {
          ...x,
          status: 'ditandatangani',
          report: { findings: a.findings, impression: a.impression, radiologist: by, signedAt: at },
        }),
      };
    }
    case 'rx.telaah':
    case 'rx.cds':
    case 'rx.cek-ganda':
    case 'rx.centang':
    case 'rx.siap':
    case 'rx.serah': {
      allowedRole(actor.role, a.type === 'rx.cds' && a.action === 'setuju' ? ['dokter'] : ['apoteker']);
      const rx = requireValue(
        s.prescriptions.find((x) => x.id === a.rxId),
        'Resep tidak ditemukan.',
      );
      const l = s.rx[rx.id] ?? {};
      must((l.stage ?? rx.stage) !== 'selesai', 'Resep sudah diserahkan.');
      let next: RxLocal = { ...l };
      let preparers = s.preparers;
      if (a.type === 'rx.telaah') {
        if (a.decision === 'setujui') {
          must((l.stage ?? rx.stage) === 'telaah', 'Resep tidak berada pada tahap telaah.');
          must(!l.hold, 'Lepas tahanan resep lebih dulu.');
          must(!blockingAlerts(rx, l).length, 'Selesaikan peringatan CDS sebelum menyetujui telaah.');
          next = { ...next, stage: 'siap', hold: undefined };
          preparers = { ...preparers, [rx.id]: actor.userId };
        } else if (a.decision === 'tahan') next.hold = at;
        else if (a.decision === 'lepas') next.hold = undefined;
        else next.partial = at;
      } else if (a.type === 'rx.cds') {
        const g = cdsFollowUpGate(rx, a.alertId, a.action, a.reason);
        must(!g, g?.message ?? 'CDS ditolak.');
        if (a.action === 'setuju')
          must(
            l.alerts?.[a.alertId]?.state === 'diusulkan',
            'Persetujuan dokter hanya setelah usulan apoteker.',
          );
        next.doubleCheck = undefined;
        const states = {
          usul: 'diusulkan',
          setuju: 'disetujui',
          konfirmasi: 'dikonfirmasi',
          override: 'override',
        } as const;
        next.alerts = { ...l.alerts, [a.alertId]: { state: states[a.action], at, text: a.reason ?? by } };
      } else if (a.type === 'rx.cek-ganda') {
        must(
          rx.items.some((i) => i.highAlert),
          'Resep ini tidak memerlukan cek ganda.',
        );
        must(
          s.preparers[rx.id] && s.preparers[rx.id] !== actor.userId,
          'Pemeriksa kedua harus masuk dari sesi petugas berbeda dari penyiap.',
        );
        next.doubleCheck = { by, at };
      } else if (a.type === 'rx.centang') {
        must(
          (l.stage ?? rx.stage) === (a.kind === 'prep' ? 'siap' : 'serah'),
          'Checklist tidak sesuai tahap resep.',
        );
        must(
          a.index < (a.kind === 'prep' ? rx.items.length : HANDOVER_CHECKS.length),
          'Butir checklist tidak dikenal.',
        );
        next[a.kind] = { ...l[a.kind], [a.index]: a.checked };
        if (a.kind === 'prep' && !preparers[rx.id]) preparers = { ...preparers, [rx.id]: actor.userId };
      } else if (a.type === 'rx.siap') {
        must((l.stage ?? rx.stage) === 'siap' && !l.hold, 'Telaah belum disetujui atau resep ditahan.');
        must(
          !rx.items.some((i) => i.highAlert) || l.doubleCheck,
          'Cek ganda dari sesi apoteker kedua wajib.',
        );
        must(
          rx.items.every((_, i) => l.prep?.[i]),
          'Lengkapi checklist penyiapan.',
        );
        next.stage = 'serah';
      } else {
        must((l.stage ?? rx.stage) === 'serah', 'Obat belum selesai disiapkan.');
        must(
          HANDOVER_CHECKS.every((_, i) => l.handover?.[i]),
          'Lengkapi checklist serah terima.',
        );
        next.stage = 'selesai';
        next.receiver = a.receiver;
        let depo = s.depo;
        const unmappedStock = { ...s.unmappedStock };
        for (const item of rx.items) {
          const product = DEPO_MASTER.items.find((p) =>
            item.kfa ? p.kfa === item.kfa : p.name.split(' ')[0] === item.name.split(' ')[0],
          );
          if (product) {
            const depot = requireValue(
              DEPO_MASTER.depots.find((d) => d.name === rx.depot),
              'Depo resep belum dipetakan.',
            );
            let n = 0;
            const out = applyDepo(
              depo,
              DEPO_MASTER,
              {
                type: 'keluar',
                depotId: depot.id,
                itemId: product.id,
                qty: item.quantity,
                ref: rx.no,
                secondChecker: l.doubleCheck?.by,
              },
              { at, by, today: DEMO_TODAY, nextId: (prefix) => `${prefix}-rx-${ev.seq}-${item.id}-${++n}` },
            );
            must(out.ok, out.message);
            depo = out.state;
          } else {
            must((unmappedStock[item.name] ?? 0) >= item.quantity, `Stok ${item.name} tidak cukup.`);
            unmappedStock[item.name] = (unmappedStock[item.name] ?? 0) - item.quantity;
          }
        }
        return {
          ...release(rx.id, rx.patient.id, 'farmasi'),
          depo,
          unmappedStock,
          preparers,
          rx: { ...s.rx, [rx.id]: next },
          prescriptions: update(s.prescriptions, {
            ...applyRxLocal(rx, next),
            dispensedTo: a.receiver,
            dispensedAt: at,
          }),
          dispensations: [
            ...s.dispensations,
            {
              rxId: rx.id,
              patientId: rx.patient.id,
              at,
              by,
              items: rx.items.map(({ id, name, quantity, dose, route, frequency }) => ({
                id,
                name,
                quantity,
                dose,
                route,
                frequency,
              })),
            },
          ],
        };
      }
      return {
        ...s,
        preparers,
        rx: { ...s.rx, [rx.id]: next },
        prescriptions: update(s.prescriptions, applyRxLocal(rx, next)),
      };
    }
    case 'darah.periksa': {
      allowedRole(actor.role, ['analis_lab', 'perawat', 'dokter']);
      const r = requireValue(
        s.blood.requests.find((x) => x.id === a.requestId),
        'Permintaan tidak ditemukan.',
      );
      const u = requireValue(
        s.blood.units.find((x) => x.id === a.unitId),
        'Kantong tidak ditemukan.',
      );
      if (a.stage === 'issue') {
        const gate = issueGate(r, u, DEMO_TODAY, {
          first: 'Petugas pertama',
          second: 'Petugas kedua',
          items: a.items,
        });
        must(!gate, gate ? BLOOD_GATE_TEXT[gate] : 'Pemeriksaan ditolak.');
        must(!r.issued.some((x) => x.unitId === u.id), 'Kantong sudah dikeluarkan.');
      } else {
        must(
          r.issued.some((x) => x.unitId === u.id),
          'Kantong belum dikeluarkan.',
        );
        must(
          (a.reason ?? '').trim().length >= 10 && a.items.identitas,
          'Verifikasi manual wajib alasan dan konfirmasi identitas.',
        );
      }
      const key = a.stage === 'issue' ? `${r.id}:${u.id}` : `bedside:${r.id}:${u.id}:${a.reason?.trim()}`;
      const checks = s.checks[key] ?? [];
      must(
        !checks.some((c) => c.userId === actor.userId),
        'Pemeriksaan Anda sudah dicatat; petugas kedua harus memakai sesi berbeda.',
      );
      must(checks.length < 2, 'Dua pemeriksaan sudah tercatat.');
      return { ...s, checks: { ...s.checks, [key]: [...checks, { userId: actor.userId, name: by, at }] } };
    }
    case 'darah.aksi': {
      allowedRole(actor.role, ['analis_lab', 'perawat', 'dokter']);
      let p = a.input;
      if (p.type === 'keluarkan') {
        const checks = s.checks[`${p.requestId}:${p.unitId}`] ?? [];
        must(
          checks.length >= 2 && checks.some((x) => x.userId === actor.userId),
          'Dua petugas harus mencatat pemeriksaan dari sesi masing-masing.',
        );
        p = {
          ...p,
          first: requireValue(checks[0], 'Pemeriksaan pertama belum ada.').name,
          second: requireValue(checks[1], 'Pemeriksaan kedua belum ada.').name,
        };
      }
      if (p.type === 'pasang' && p.manual) {
        const r = requireValue(
          s.blood.requests.find((x) => x.id === p.requestId),
          'Permintaan tidak ditemukan.',
        );
        const completed = new Set(
          (r.transfusions ?? [])
            .map((t) => t.unitId)
            .concat(r.transfusion?.finishedAt ? [r.transfusion.unitId] : []),
        );
        const bag = p.bag;
        const u = requireValue(
          s.blood.units.find(
            (u) => r.issued.some((i) => i.unitId === u.id) && !completed.has(u.id) && u.bagNo === bag,
          ),
          'Pilih kantong yang belum ditransfusikan.',
        );
        const checks = s.checks[`bedside:${r.id}:${u.id}:${p.manual.reason.trim()}`] ?? [];
        const second = checks.find((x) => x.userId !== actor.userId);
        must(
          checks.some((x) => x.userId === actor.userId) && second,
          'Verifikasi manual harus dicatat dua petugas dari sesi masing-masing dengan alasan yang sama.',
        );
        p = { ...p, manual: { ...p.manual, secondVerifier: second.name } };
      }
      const result = applyBlood(s.blood, p, { at, by, today: DEMO_TODAY });
      must(result.ok, result.message);
      return { ...s, blood: { requests: [...result.state.requests], units: [...result.state.units] } };
    }
    case 'depo.periksa': {
      allowedRole(actor.role, ['apoteker']);
      const gate = dispenseGate(s.depo, DEPO_MASTER, a.input, DEMO_TODAY);
      must(!('code' in gate), 'code' in gate ? DEPO_ERROR_TEXT[gate.code] : 'Stok tidak sah.');
      must(
        DEPO_MASTER.items.find((i) => i.id === a.input.itemId)?.highAlert,
        'Obat ini tidak memerlukan pemeriksa kedua.',
      );
      const key = depotCheckKey(a.input);
      must(!s.checks[key]?.some((c) => c.userId === actor.userId), 'Pemeriksaan Anda sudah tersimpan.');
      return { ...s, checks: { ...s.checks, [key]: [{ userId: actor.userId, name: by, at }] } };
    }
    case 'depo.aksi': {
      allowedRole(actor.role, ['apoteker']);
      let p = a.input;
      if (p.type === 'keluar') {
        const key = depotCheckKey(p);
        const check = s.checks[key]?.find((c) => c.userId !== actor.userId);
        p = { ...p, secondChecker: check?.name };
      } else if (p.type === 'terima') p = { ...p, receiver: by };
      let movement = 0;
      const result = applyDepo(s.depo, DEPO_MASTER, p, {
        at,
        by,
        today: DEMO_TODAY,
        nextId: (prefix) => `${prefix}-${ev.seq}-${++movement}`,
      });
      must(result.ok, result.message);
      return { ...s, depo: result.state };
    }
    case 'gizi.aksi': {
      allowedRole(actor.role, ['perawat', 'dokter']);
      const p = a.input;
      const o = requireValue(
        s.diets.find((x) => x.id === p.orderId),
        'Order diet tidak ditemukan.',
      );
      if (p.kind === 'skrining') {
        const m = mstScore(p.weightLoss, p.poorAppetite);
        return { ...s, diets: update(s.diets, { ...o, screening: { ...m, at, by } }) };
      }
      if (p.kind === 'verifikasi') {
        must(o.screening, 'Skrining gizi belum dicatat di server.');
        must(o.status !== 'diverifikasi', 'Order diet sudah diverifikasi.');
        return { ...s, diets: update(s.diets, { ...o, status: 'diverifikasi', verifiedBy: by }) };
      }
      const key = `${o.id}|${p.meal}`;
      if (p.kind === 'antar') {
        const g = deliveryGate(o, p.meal, p);
        must(!g, g ? GIZI_GATE_TEXT[g] : 'Distribusi ditolak.');
        must(
          s.deliveries[key]?.status !== 'diantar' && s.deliveries[key]?.status !== 'diterima',
          'Baki sudah diantar.',
        );
        return {
          ...s,
          deliveries: {
            ...s.deliveries,
            [key]: {
              status: 'diantar',
              substituted: p.substituted,
              overrideReason: p.overrideReason,
              at,
              leftover: null,
            },
          },
        };
      }
      const d = requireValue(s.deliveries[key], 'Baki belum diantar.');
      must(d.status === 'diantar', 'Baki belum diantar atau sudah diterima.');
      return {
        ...s,
        deliveries: { ...s.deliveries, [key]: { ...d, status: 'diterima', leftover: p.leftover } },
      };
    }
    case 'mikro.aksi': {
      const p = a.input;
      allowedRole(
        actor.role,
        ['pa-tte', 'pa-addendum', 'final'].includes(p.kind) ? ['dokter'] : ['analis_lab', 'dokter'],
      );
      if (p.kind === 'pa-tte' || p.kind === 'pa-addendum') {
        const x = requireValue(
          s.pa.find((x) => x.id === p.caseId),
          'Kasus PA tidak ditemukan.',
        );
        if (p.kind === 'pa-tte') {
          const g = paSignGate({ ...x, macro: p.macro, micro: p.micro, diagnosis: p.diagnosis });
          must(!g, g ? MICRO_GATE_TEXT[g] : 'PA ditolak.');
          return {
            ...release(x.id, x.patient.id, 'patologi'),
            pa: update(s.pa, {
              ...x,
              macro: p.macro,
              micro: p.micro,
              diagnosis: p.diagnosis,
              signed: { at, by },
            }),
          };
        }
        const g = paAddendumGate(x, p.text);
        must(!g, g ? MICRO_GATE_TEXT[g] : 'Addendum ditolak.');
        return { ...s, pa: update(s.pa, { ...x, addenda: [...x.addenda, { text: p.text, at, by }] }) };
      }
      const x = requireValue(
        s.cultures.find((x) => x.id === p.caseId),
        'Kultur tidak ditemukan.',
      );
      const result = applyCulture(
        x,
        p.kind === 'pertumbuhan'
          ? { type: p.kind, grew: p.grew }
          : p.kind === 'gram'
            ? { type: p.kind, result: p.result }
            : p.kind === 'identifikasi'
              ? { type: p.kind, organism: p.organism }
              : p.kind === 'kepekaan'
                ? { type: p.kind, results: p.results }
                : { type: 'final' },
        { at, by },
      );
      must(result.ok, result.ok ? '' : MICRO_GATE_TEXT[result.code]);
      const criticals =
        p.kind === 'gram' && x.blood
          ? [
              ...s.criticals,
              {
                id: `kr-${x.id}`,
                source: 'mikrobiologi' as const,
                unit: 'Laboratorium · mikrobiologi',
                patient: x.patient,
                location: x.location,
                test: `Kultur darah · ${x.labNo}`,
                valueText: p.result,
                limitText: 'kultur darah positif = selalu kritis',
                raisedAt: at,
                limitMinutes: 30,
                dpjp: x.dpjp,
                recipients: [{ name: x.dpjp, role: 'DPJP' }],
                report: null,
              },
            ]
          : s.criticals;
      return {
        ...(p.kind === 'final' ? release(x.id, x.patient.id, 'mikrobiologi') : s),
        criticals,
        cultures: update(s.cultures, result.next),
      };
    }
    case 'ok.aksi':
    case 'ok.centang':
    case 'ok.hitung':
    case 'anestesi.aksi': {
      allowedRole(actor.role, a.type === 'anestesi.aksi' ? ['dokter'] : ['dokter', 'perawat']);
      const caseId = a.type === 'ok.aksi' || a.type === 'anestesi.aksi' ? a.input.caseId : a.caseId;
      const c = requireValue(
        s.operations.find((x) => x.id === caseId),
        'Kasus operasi tidak ditemukan.',
      );
      const l = s.ok[c.id] ?? EMPTY_LOCAL;
      if (a.type === 'anestesi.aksi') {
        must(c.status !== 'selesai', 'Operasi sudah selesai; catatan terkunci.');
        const p = a.input;
        const rec = s.anesthesia[c.id] ?? { pre: { ...EMPTY_PRE }, inductionAt: null, vitals: [] };
        let next: AnesthesiaRecord;
        if (p.kind === 'tte') {
          must(!rec.pre.signed, 'Asesmen ber-TTE terkunci.');
          const missing = preAnesthesiaMissing({ ...p.pre, signed: null });
          must(!missing.length, `Asesmen pra-anestesi belum lengkap: ${missing.join(', ')}.`);
          next = { ...rec, pre: { ...p.pre, signed: { at, by } } };
        } else if (p.kind === 'induksi') {
          const g = inductionGate(rec, !!c.checklist.find((p) => p.phase === 'sign-in')?.confirmedAt);
          must(!g, g ? INDUCTION_BLOCK_TEXT[g] : 'Induksi ditolak.');
          next = { ...rec, inductionAt: at };
        } else {
          must(rec.inductionAt, 'Catat induksi sebelum monitoring intraoperasi.');
          next = { ...rec, vitals: [...rec.vitals, { ...p.vitals, at }] };
        }
        return { ...s, anesthesia: { ...s.anesthesia, [c.id]: next } };
      }
      must(
        c.status !== 'selesai' || (a.type === 'ok.aksi' && a.input.kind === 'pulih'),
        'Operasi selesai dan catatan keselamatan terkunci.',
      );
      const next: OkLocal = { ...l };
      if (a.type === 'ok.centang') {
        const phase = c.checklist[currentPhase(c.checklist)];
        must(
          phase?.items.some((i) => i.id === a.itemId) && a.itemId !== COUNT_ITEM,
          'Butir bukan fase aktif atau dihitung otomatis.',
        );
        next.checked = { ...l.checked, [a.itemId]: a.checked };
      } else if (a.type === 'ok.hitung') {
        must(
          currentPhase(c.checklist) === 2 && c.counts.some((x) => x.id === a.countId),
          'Hitung akhir hanya pada sign out.',
        );
        next.finals = { ...l.finals, [a.countId]: a.value };
      } else {
        const p = a.input;
        if (p.kind === 'konfirmasi') {
          const index = c.checklist.findIndex((x) => x.phase === p.phase);
          must(
            canConfirmPhase(c, index),
            'Lengkapi semua butir fase aktif dan hitung akhir sebelum konfirmasi.',
          );
          next.confirmed = { ...l.confirmed, [p.phase]: at };
          // Butir hitung otomatis disimpan juga pada daftar tilik final.
          if (p.phase === 'sign-out') next.checked = { ...l.checked, [COUNT_ITEM]: checkCounts(c.counts).ok };
        } else if (p.kind === 'insisi' || p.kind === 'override') {
          must(actor.role === 'dokter', 'Insisi hanya dicatat dokter.');
          must(!c.incisionAt, 'Insisi sudah dicatat.');
          must(c.checklist[0]?.confirmedAt, 'Sign in belum dikonfirmasi.');
          if (p.kind === 'insisi') must(incisionGate(c).allowed, 'Time out belum dikonfirmasi di server.');
          next.incisionAt = at;
          if (p.kind === 'override') next.overrideReason = p.reason;
        } else if (p.kind === 'selesai') {
          must(
            c.incisionAt && c.checklist[2]?.confirmedAt,
            'Insisi dan sign out wajib sebelum menutup operasi.',
          );
          next.finishedAt = at;
        } else {
          must(
            c.status === 'selesai' && !l.movedAt,
            'Tutup operasi lebih dulu atau pasien sudah di ruang pulih.',
          );
          next.movedAt = at;
        }
      }
      return {
        ...(a.type === 'ok.aksi' && a.input.kind === 'selesai' ? release(c.id, c.patient.id, 'operasi') : s),
        ok: { ...s.ok, [c.id]: next },
        operations: update(s.operations, withLocal(c, next, by)),
      };
    }
    case 'diagnostik.aksi': {
      const p = a.input;
      allowedRole(actor.role, p.kind === 'tte' ? ['dokter'] : ['dokter', 'perawat', 'radiografer']);
      const x = requireValue(
        s.diagnostics.find((x) => x.id === p.orderId),
        'Order tidak ditemukan.',
      );
      const result = applyDiag(
        x,
        p.kind === 'jadwal'
          ? { type: p.kind, slot: p.slot }
          : p.kind === 'laksana'
            ? { type: p.kind, identityConfirmed: p.identityConfirmed }
            : { type: p.kind, findings: p.findings, critical: p.critical },
        { at, by },
      );
      must(result.ok, result.ok ? '' : DIAG_GATE_TEXT[result.code]);
      const next = p.kind === 'tte' ? { ...result.next, signed: { at, by } } : result.next;
      const criticals =
        p.kind === 'tte' && p.critical
          ? [
              ...s.criticals,
              {
                id: `kr-${x.id}`,
                source: 'diagnostik' as const,
                unit: 'Penunjang diagnostik',
                patient: x.patient,
                location: x.location,
                test: TEMPLATES[x.kind].label,
                valueText: p.findings.Kesimpulan ?? Object.values(p.findings).join('; '),
                limitText: 'temuan ditandai kritis oleh dokter',
                raisedAt: at,
                limitMinutes: 30,
                dpjp: x.orderedBy,
                recipients: [{ name: x.orderedBy, role: 'Dokter pengirim' }],
                report: null,
              },
            ]
          : s.criticals;
      return {
        ...(p.kind === 'tte' ? release(x.id, x.patient.id, 'diagnostik') : s),
        criticals,
        diagnostics: update(s.diagnostics, next),
      };
    }
  }
  return s;
}

/** Cocokkan pesan alat ke order server, jangan percaya flag/rentang yang dikirim alat. */
export function receiveGateway(
  s: SupportState,
  raw: string,
  at: string,
): { state: SupportState; result: InboundResult } {
  const result = processInbound(
    raw,
    s.samples.map((x) => ({ labNo: x.labNo, patientName: x.patient.name, received: !!x.receivedAt })),
    new Set(s.gatewayProcessed),
    new Set(Object.values(LAB_TESTS).map((t) => t.loinc)),
  );
  if (result.status !== 'dicocokkan') return { state: s, result };
  const sample = s.samples.find((x) => x.labNo === result.accession);
  const reject = (text: string) => ({
    state: s,
    result: { ...result, ack: 'AE' as const, status: 'ditolak' as const, text },
  });
  if (!sample || sample.technical || sample.clinical)
    return reject('Hasil tervalidasi terkunci; gunakan revisi hasil melalui Lab.');
  if (new Set(result.observations.map((o) => o.loinc)).size !== result.observations.length)
    return reject('Parameter hasil ganda dalam pesan alat.');
  let results = [...sample.results];
  for (const o of result.observations) {
    const prev = results.find((x) => x.loinc === o.loinc);
    if (!prev) return reject(`Parameter ${o.loinc} tidak dipesan pada sampel ini.`);
    if (!o.value.trim() || !Number.isFinite(Number(o.value)) || o.unit.replace('/uL', '/µL') !== prev.unit)
      return reject(`Nilai/satuan ${o.loinc} tidak sesuai katalog order.`);
    const value = Number(o.value);
    results = results.map((x) =>
      x.loinc === o.loinc
        ? {
            ...x,
            value,
            text: null,
            pending: false,
            flag: labFlag(value, x.ref, x.critical),
            delta: deltaCheck(value, x.previous, x.deltaLimit),
          }
        : x,
    );
  }
  const critical = results.find((x) => x.flag === 'KRITIS' && x.value !== null);
  const next = {
    ...sample,
    results,
    status: 'hasil' as const,
    critical: critical
      ? {
          loinc: critical.loinc,
          analyte: critical.name,
          value: critical.value!,
          unit: critical.unit,
          decimals: critical.decimals,
          resultAt: at,
          limitMinutes: 30,
          elapsedSeconds: 0,
          recipient: null,
          reportedAt: null,
          readBackAt: null,
          minutesToReport: null,
        }
      : null,
  };
  return {
    state: {
      ...s,
      samples: update(s.samples, next),
      gatewayProcessed: [...s.gatewayProcessed, result.controlId!],
    },
    result,
  };
}

/** Stok yang ditampilkan Farmasi berasal dari saldo yang sama dengan Depo. */
export function prescriptionsWithStock(s: SupportState) {
  return s.prescriptions.map((rx) => ({
    ...rx,
    items: rx.items.map((item) => {
      const product = DEPO_MASTER.items.find((p) =>
        item.kfa ? p.kfa === item.kfa : p.name.split(' ')[0] === item.name.split(' ')[0],
      );
      const depot = DEPO_MASTER.depots.find((d) => d.name === rx.depot);
      return {
        ...item,
        stock:
          product && depot
            ? usableStock(s.depo, DEPO_MASTER, depot.id, product.id, DEMO_TODAY)
            : (s.unmappedStock[item.name] ?? item.stock),
      };
    }),
  }));
}

export function supportReadBack(s: SupportState, ev: DomainEvent<CriticalEvent>): SupportState {
  return {
    ...s,
    samples: s.samples.map((sample) =>
      applyStoredReportToSample(sample, {
        reports: {
          [ev.data.itemId]: {
            recipient: ev.data.recipient,
            recipientRole: ev.data.recipientRole,
            channel: ev.data.channel,
            reportedBy: ev.actor.name,
            reportedAt: ev.data.reportedAt,
            readBackConfirmed: true,
            via: ev.data.via,
          },
        },
      }),
    ),
  };
}
export const supportDomain = defineDomain('penunjang', {
  initial: initialSupportState,
  eventSchema: supportEventSchema,
  reduce: reduceSupport,
  screens: [
    'ok',
    'lab',
    'rad',
    'farmasi',
    'depo',
    'bank-darah',
    'gizi',
    'mikro',
    'diagnostik',
    'kritis',
    'ringkasan',
    'worklist',
    'ranap',
    'charge',
    'kasir',
    'satusehat',
  ],
  subscriptions: [
    on(criticalDomain, supportReadBack),
    on(
      { name: 'integrasi', eventSchema: integrationEventSchema },
      (s: SupportState, ev: DomainEvent<IntegrationEvent>) =>
        ev.data.type === 'gateway.terima' ? receiveGateway(s, ev.data.raw, ev.at).state : s,
    ),
  ],
});
