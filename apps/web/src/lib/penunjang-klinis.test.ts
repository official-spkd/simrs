import { describe, expect, it } from 'vitest';
import { project, type StoredEvent } from './demo/store/define';
import { CPOE_CATALOG } from './demo/fixtures/klinis';
import { PATIENT_ID } from './demo/fixtures/ids';
import { supportPatient } from './demo/fixtures/penunjang';
import { DEMO_NOW } from './demo/fixtures/waktu';
import {
  clinicalOrderSource,
  clinicalConsentSource,
  receiveClinicalOrder,
  receiveClinicalConsent,
} from './penunjang-klinis';
import {
  initialSupportState,
  supportDomain,
  supportClinicalSubscriptions,
  reduceSupport,
  supportEventSchema,
  receiveGateway,
} from './penunjang-demo';
import { integrationDomain, integrationClinicalSubscriptions } from './integrasi-demo';

const actor = { userId: 'dokter1', name: 'Dokter Pengirim Fiktif', role: 'dokter', baseRole: null };
const p = supportPatient(PATIENT_ID.endang);
const catalogIds = ['darah-lengkap', 'kreatinin', 'foto-toraks', 'ekg', 'metformin-500', 'vitamin-d'];
const order = {
  seq: 1,
  domain: 'klinis-order',
  at: DEMO_NOW,
  actor,
  data: clinicalOrderSource.eventSchema.parse({
    type: 'order.ditandatangani',
    encounterId: 'kunjungan-fiktif',
    patientId: p.id,
    patientName: p.name,
    rm: p.rm,
    payer: p.guarantor,
    setting: 'rawat-jalan',
    signedAt: DEMO_NOW,
    lines: catalogIds.map((id, i) => {
      const c = CPOE_CATALOG.find((x) => x.id === id)!;
      return {
        lineId: `order-${i}-${id}`,
        catalogId: c.id,
        kind: c.kind,
        name: c.name,
        detail: c.detail,
        code: c.code,
        priority: c.priority,
        coverage: c.coverage,
        tariff: c.tariff,
        override: null,
        dest: c.kind === 'obat' ? 'farmasi' : c.kind,
      };
    }),
  }),
};
describe('kontrak keluar CD-2 → Penunjang', () => {
  it('satu CPOE masuk Lab/Rad/Diagnostik dan rincian belum lengkap ditahan terlihat; replay idempoten', () => {
    const initial = initialSupportState();
    const s = receiveClinicalOrder(initial, order);
    expect(s.samples).toHaveLength(initial.samples.length + 2);
    expect(s.samples.at(-1)?.results[0]?.ref).toEqual({ low: 0.5, high: 1.1 });
    expect(s.exams.at(-1)).toMatchObject({
      patient: p,
      sender: actor.name,
      modality: 'DR',
      status: 'terjadwal',
    });
    expect(s.diagnostics.at(-1)).toMatchObject({ patient: p, kind: 'ekg', orderedBy: actor.name });
    expect(s.incomingOrders.filter((x) => x.reason).map((x) => x.name)).toEqual([
      'Metformin 500 mg tablet',
      'Vitamin D (25-OH)',
    ]);
    expect(receiveClinicalOrder(s, order)).toEqual(s);
    const view = { seq: 1, resetSeq: 0, events: [order] as StoredEvent[] };
    expect(
      project(
        {
          ...supportDomain,
          subscriptions: [...supportDomain.subscriptions, ...supportClinicalSubscriptions],
        },
        view,
      ).state,
    ).toEqual(s);
    expect(
      project(
        {
          ...integrationDomain,
          subscriptions: [...integrationDomain.subscriptions, ...integrationClinicalSubscriptions],
        },
        view,
      ).state.support,
    ).toEqual(s);
  });
  it('spesimen CPOE harus diterima dengan dua identitas sebelum hasil alat diproses', () => {
    let s = receiveClinicalOrder(initialSupportState(), order);
    const sample = s.samples.at(-1)!;
    const raw = `MSH|^~\\&|ANALYZER|LAB|SIMRS|RS|202610061000||ORU^R01|CX-CPOE-1|P|2.5\rPID|1||FIKTIF||SAMAR\rOBR|1|${sample.labNo}||KIMIA\rOBX|1|NM|2160-0^Kreatinin^LN||0.8|mg/dL|0.5-1.1|N|||F`;
    expect(receiveGateway(s, raw, DEMO_NOW).result.ack).toBe('AE');
    const receive = {
      seq: 2,
      domain: 'penunjang',
      at: DEMO_NOW,
      actor: { ...actor, role: 'analis_lab' },
      data: supportEventSchema.parse({
        type: 'lab.terima',
        sampleId: sample.id,
        specimen: 'Serum',
        identityConfirmed: false,
      }),
    };
    expect(() => reduceSupport(s, receive)).toThrow(/dua identitas/);
    s = reduceSupport(s, {
      ...receive,
      data: supportEventSchema.parse({ ...receive.data, identityConfirmed: true }),
    });
    expect(receiveGateway(s, raw, DEMO_NOW).result.ack).toBe('AA');
    expect(() =>
      reduceSupport(s, {
        ...receive,
        data: supportEventSchema.parse({ ...receive.data, identityConfirmed: true }),
      }),
    ).toThrow(/sudah diterima/);
  });
  it('persetujuan ditolak menahan sign in/induksi; dokumen final lain tidak meluluskan prosedur ini', () => {
    let s = initialSupportState();
    const c = s.operations.find((x) => !x.checklist[0]?.confirmedAt)!;
    const refusal = {
      seq: 1,
      domain: 'persetujuan',
      at: DEMO_NOW,
      actor,
      data: clinicalConsentSource.eventSchema.parse({
        type: 'consent.ditolak',
        consentId: 'consent-fiktif',
        encounterId: 'kunjungan-fiktif',
        patientId: c.patient.id,
        procedure: c.procedure,
        reason: 'Pasien memilih menunda tindakan setelah penjelasan.',
        at: DEMO_NOW,
      }),
    };
    s = receiveClinicalConsent(s, refusal);
    expect(s.consents[0]).toMatchObject({ status: 'ditolak', by: actor.name });
    expect(receiveClinicalConsent(s, refusal)).toEqual(s);
    expect(() =>
      reduceSupport(s, {
        seq: 2,
        domain: 'penunjang',
        at: DEMO_NOW,
        actor,
        data: supportEventSchema.parse({
          type: 'ok.aksi',
          input: { kind: 'konfirmasi', caseId: c.id, phase: 'sign-in' },
        }),
      }),
    ).toThrow(/Persetujuan tindakan ditolak/);
    expect(() =>
      reduceSupport(s, {
        seq: 2,
        domain: 'penunjang',
        at: DEMO_NOW,
        actor,
        data: supportEventSchema.parse({
          type: 'anestesi.aksi',
          input: { kind: 'induksi', caseId: c.id, preSigned: true, signInConfirmed: true },
        }),
      }),
    ).toThrow(/Persetujuan tindakan ditolak/);
  });
});
