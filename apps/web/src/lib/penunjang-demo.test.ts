import { describe, expect, it } from 'vitest';
import {
  initialSupportState,
  reduceSupport,
  supportEventSchema,
  supportDomain,
  receiveGateway,
  prescriptionsWithStock,
} from './penunjang-demo';
import { integrationDomain, initialIntegrationState, reduceIntegration } from './integrasi-demo';
import { project, type DemoActor, type StoredEvent } from './demo/store/define';
import { PRESET_MESSAGES } from './demo/fixtures/integrasi-perangkat';
import { DEMO_NOW, DEMO_TODAY } from './demo/fixtures/waktu';
import { ISSUE_CHECKS, applyBlood, stageOf } from './penunjang-bank-darah';
import { LAB_SAMPLE_ID } from './demo/fixtures/ids';

const actor = (role: string, userId = 'u1'): DemoActor => ({
  userId,
  name: `Petugas ${userId}`,
  role,
  baseRole: null,
});
const event = (data: unknown, role: string, seq = 1, userId = 'u1') => ({
  seq,
  domain: 'penunjang',
  at: DEMO_NOW,
  actor: actor(role, userId),
  data: supportEventSchema.parse(data),
});
const apply = (
  s: ReturnType<typeof initialSupportState>,
  data: unknown,
  role: string,
  seq = 1,
  userId = 'u1',
) => reduceSupport(s, event(data, role, seq, userId));

describe('Penunjang: transisi otoritatif per sesi', () => {
  it('validasi wajib urutan, posisi dokter dan read-back kritis', () => {
    let s = initialSupportState();
    expect(() =>
      apply(s, { type: 'lab.validasi', sampleId: LAB_SAMPLE_ID.endang, level: 'klinis' }, 'dokter'),
    ).toThrow(/Urutan/);
    s = apply(s, { type: 'lab.validasi', sampleId: LAB_SAMPLE_ID.endang, level: 'teknis' }, 'analis_lab');
    expect(() =>
      apply(s, { type: 'lab.validasi', sampleId: LAB_SAMPLE_ID.endang, level: 'klinis' }, 'analis_lab'),
    ).toThrow(/Posisi/);
    s = apply(s, { type: 'lab.validasi', sampleId: LAB_SAMPLE_ID.endang, level: 'klinis' }, 'dokter');
    expect(s.samples.find((x) => x.id === LAB_SAMPLE_ID.endang)?.clinical?.by).toBe('Petugas u1');
    expect(s.released).toContainEqual(expect.objectContaining({ source: 'lab', id: LAB_SAMPLE_ID.endang }));
    expect(() =>
      apply(s, { type: 'lab.validasi', sampleId: LAB_SAMPLE_ID.yusuf, level: 'teknis' }, 'analis_lab'),
    ).toThrow(/kritis/);
  });

  it('cek ganda darah memerlukan dua id pengguna, boolean/nama klien tidak cukup', () => {
    let s = initialSupportState();
    const request = s.blood.requests.find((r) => r.crossmatches.some((c) => c.result === 'kompatibel'))!;
    const cm = request.crossmatches.find((c) => c.result === 'kompatibel')!;
    const items = Object.fromEntries(ISSUE_CHECKS.map((x) => [x.id, true]));
    const check = { type: 'darah.periksa', requestId: request.id, unitId: cm.unitId, stage: 'issue', items };
    const issue = {
      type: 'darah.aksi',
      input: {
        type: 'keluarkan',
        requestId: request.id,
        unitId: cm.unitId,
        items,
        group: { abo: request.abo, rh: request.rh },
        first: 'Petugas palsu 1',
        second: 'Petugas palsu 2',
      },
    };
    expect(() => apply(s, issue, 'analis_lab')).toThrow(/Dua petugas/);
    s = apply(s, check, 'analis_lab');
    expect(() => apply(s, check, 'perawat', 2)).toThrow(/sesi berbeda/);
    s = apply(s, check, 'perawat', 2, 'u2');
    s = apply(s, issue, 'analis_lab', 3);
    expect(s.blood.requests.find((r) => r.id === request.id)?.issued.at(-1)?.checkers).toEqual([
      'Petugas u1',
      'Petugas u2',
    ]);
  });

  it('kantong kedua bisa dipasang setelah kantong pertama selesai; tidak menghapus riwayat', () => {
    const s = initialSupportState();
    const r = s.blood.requests.find((x) => x.units === 2)!;
    const units = s.blood.units
      .filter(
        (x) => x.component === r.component && x.abo === r.abo && x.rh === r.rh,
      )
      .slice(0, 2);
    expect(units).toHaveLength(2);
    const request = {
      ...r,
      issued: units.map((u) => ({
        unitId: u.id,
        at: DEMO_NOW,
        checkers: ['Satu', 'Dua'] as [string, string],
      })),
      transfusion: {
        unitId: units[0]!.id,
        startedAt: DEMO_NOW,
        verifiedBy: 'Petugas',
        manualReason: null,
        vitals: [],
        reaction: null,
        finishedAt: DEMO_NOW,
      },
    };
    expect(stageOf(request)).toBe('transfusi');
    const out = applyBlood(
      { requests: [request], units },
      { type: 'pasang', requestId: r.id, wristband: r.patient.rm, bag: units[1]!.bagNo, baseline: { tempC: 36.7, systolic: 118, diastolic: 72, pulse: 96 } },
      { at: DEMO_NOW, by: 'Petugas', today: DEMO_TODAY },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.state.requests[0]?.transfusions).toHaveLength(1);
      expect(out.state.requests[0]?.transfusion?.unitId).toBe(units[1]!.id);
    }
  });

  it('gizi tidak mempercayai screened/verified dari klien', () => {
    const s = initialSupportState();
    const o = s.diets.find((x) => !x.screening)!;
    expect(() =>
      apply(
        s,
        { type: 'gizi.aksi', input: { kind: 'verifikasi', orderId: o.id, screened: true } },
        'perawat',
      ),
    ).toThrow(/Skrining/);
  });

  it('WHO tidak mempercayai checklist klien dan induksi tidak mempercayai preSigned', () => {
    const s = initialSupportState();
    const c = s.operations.find((x) => !x.checklist[0]?.confirmedAt)!;
    expect(() =>
      apply(
        s,
        {
          type: 'ok.aksi',
          input: {
            kind: 'insisi',
            caseId: c.id,
            checklist: c.checklist.map((p) => ({
              ...p,
              items: p.items.map((i) => ({ ...i, checked: true })),
              confirmedAt: DEMO_NOW,
              confirmedBy: 'Palsu',
            })),
          },
        },
        'dokter',
      ),
    ).toThrow();
    expect(() =>
      apply(
        s,
        {
          type: 'anestesi.aksi',
          input: { kind: 'induksi', caseId: c.id, preSigned: true, signInConfirmed: true },
        },
        'dokter',
      ),
    ).toThrow();
  });

  it('farmasi serah terima mengurangi saldo Depo satu kali dan membuat keluaran eMAR', () => {
    let s = initialSupportState();
    const rx = s.prescriptions.find((x) => x.stage === 'serah' && !x.items.some((i) => i.highAlert))!;
    const before = prescriptionsWithStock(s).find((x) => x.id === rx.id)!;
    for (let i = 0; i < 4; i++)
      s = apply(
        s,
        { type: 'rx.centang', rxId: rx.id, kind: 'handover', index: i, checked: true },
        'apoteker',
      );
    s = apply(s, { type: 'rx.serah', rxId: rx.id, receiver: 'pasien' }, 'apoteker');
    const after = prescriptionsWithStock(s).find((x) => x.id === rx.id)!;
    after.items.forEach((x, i) => expect(x.stock).toBe(before.items[i]!.stock - x.quantity));
    expect(s.dispensations[0]).toMatchObject({ rxId: rx.id, patientId: rx.patient.id, by: 'Petugas u1' });
    expect(() => apply(s, { type: 'rx.serah', rxId: rx.id, receiver: 'pasien' }, 'apoteker')).toThrow(
      /sudah diserahkan/,
    );
  });
});

describe('Penunjang ↔ Integrasi: satu proyeksi pesan yang bisa diulang', () => {
  it('ORU mengisi hasil Lab, flag dihitung katalog, duplikat dan satuan salah tidak mengubahnya', () => {
    const initial = initialSupportState();
    const raw = PRESET_MESSAGES[0]!.raw;
    const { state, result } = receiveGateway(initial, raw, DEMO_NOW);
    expect(result.ack).toBe('AA');
    expect(
      state.samples.find((x) => x.labNo === 'L2610050163')?.results.find((x) => x.loinc === '718-7'),
    ).toMatchObject({ value: 11.8, flag: 'L', pending: false });
    expect(receiveGateway(state, raw, DEMO_NOW)).toMatchObject({ state, result: { status: 'duplikat' } });
    expect(receiveGateway(initial, raw.replace('g/dL', 'mg/dL'), DEMO_NOW)).toMatchObject({
      state: initial,
      result: { ack: 'AE' },
    });
    const final = apply(
      initial,
      { type: 'lab.validasi', sampleId: LAB_SAMPLE_ID.endang, level: 'teknis' },
      'analis_lab',
    );
    expect(receiveGateway(final, PRESET_MESSAGES[1]!.raw, DEMO_NOW).result.ack).toBe('AE');
  });

  it('replay/read-back dan final Lab membuat antrean anak ditahan sampai IHS + Encounter', () => {
    const s = initialSupportState();
    const sample = s.samples.find((x) => x.id === LAB_SAMPLE_ID.endang)!;
    const events: StoredEvent[] = [
      event({ type: 'lab.validasi', sampleId: sample.id, level: 'teknis' }, 'analis_lab', 1),
      event({ type: 'lab.validasi', sampleId: sample.id, level: 'klinis' }, 'dokter', 2),
    ];
    let i = project(integrationDomain, { seq: 2, resetSeq: 0, events }).state;
    expect(
      project(supportDomain, { seq: 2, resetSeq: 0, events }).state.samples.find((x) => x.id === sample.id)
        ?.clinical?.by,
    ).toBe('Petugas u1');
    const v = i.visits.find((x) => x.id === `ss-${sample.patient.id}`)!;
    const send = {
      seq: 3,
      domain: 'integrasi',
      at: DEMO_NOW,
      actor: actor('admin_tenant'),
      data: {
        type: 'satusehat.aksi' as const,
        input: {
          kind: 'kirim' as const,
          visitId: v.id,
          resourceId: v.resources[0]!.id,
          confirmed: true as const,
        },
      },
    };
    expect(() => reduceIntegration(i, send)).toThrow(/IHS/);
    i = reduceIntegration(i, {
      ...send,
      data: { type: 'satusehat.aksi', input: { kind: 'ihs', visitId: v.id } },
    });
    i = reduceIntegration(i, send);
    expect(i.visits.find((x) => x.id === v.id)?.resources.every((x) => x.sent)).toBe(true);
  });

  it('pemalsuan fixed, backlog, dan klien baru tidak melewati gerbang server', () => {
    const s = initialIntegrationState();
    const v = s.visits.find((x) => x.resources.some((r) => r.error?.fix === 'ihs'))!;
    const r = v.resources.find((x) => x.error?.fix === 'ihs')!;
    const ev = {
      seq: 1,
      domain: 'integrasi',
      at: DEMO_NOW,
      actor: actor('admin_tenant'),
      data: {
        type: 'satusehat.aksi' as const,
        input: {
          kind: 'kirim-ulang' as const,
          visitId: v.id,
          resourceId: r.id,
          confirmed: true as const,
          fixed: { ihs: true, loinc: true, kfa: true },
        },
      },
    };
    expect(() => reduceIntegration(s, ev)).toThrow(/Perbaiki data/);
    expect(() =>
      reduceIntegration(s, {
        ...ev,
        data: { type: 'bpjs.aksi', input: { kind: 'downtime-akhiri', backlog: 99 } },
      }),
    ).toThrow(/belum aktif/);
    expect(() =>
      reduceIntegration(s, {
        ...ev,
        data: { type: 'api.aksi', input: { kind: 'aktifkan', clientId: 'palsu' } },
      }),
    ).toThrow(/tidak terdaftar/);
  });
});
