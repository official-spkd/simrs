import { describe, expect, it } from 'vitest';
import { type DemoActor, project, type StoredEvent } from './demo/store/define';
import { igdDomain, type IgdEvent } from './klinis-igd-toko';
import { oncologyDomain, type OncologyEvent, cycleStage } from './onkologi-toko';
import { bedDomain, type BedEvent } from './rawat-inap-bed-toko';
import { resumeDomain, type ResumeEvent } from './rawat-inap-resume-toko';

/**
 * Aliran antardomain klinis (ADR-0085): IGD → papan tempat tidur, resume final → pemulangan bed, dan urutan siklus
 * kemoterapi. Diuji lewat `project()` atas log kejadian campuran, persis seperti server memproyeksikan toko.
 */

const doctor: DemoActor = { userId: 'u-dokter', name: 'dr. Uji Fiktif', role: 'dokter', baseRole: null };
const AT = '2026-10-05T10:50:00+07:00';
const ENC = 'kj-igd-uji-1';

type AnyEvent = IgdEvent | BedEvent | ResumeEvent | OncologyEvent;
function log(items: Array<[string, AnyEvent]>) {
  const events: StoredEvent[] = items.map(([domain, data], i) => ({
    seq: i + 1,
    domain,
    at: AT,
    actor: doctor,
    data,
  }));
  return { seq: events.length, resetSeq: 0, events };
}

const admission: IgdEvent = {
  type: 'admisi.diminta',
  encounterId: ENC,
  requestId: `rb-igd-${ENC}`,
  patientId: null,
  patientName: 'Tn. Uji Fiktif',
  rm: null,
  sex: 'L',
  ageYears: 60,
  from: 'IGD B4',
  need: 'Observasi sepsis',
  kelas: 'Kelas 2',
  at: AT,
};
const death: IgdEvent = {
  type: 'pasien.meninggal',
  encounterId: ENC,
  patientId: null,
  patientName: 'Tn. Uji Fiktif',
  diedAt: AT,
  causeCode: 'A41.9',
  causeLabel: 'Sepsis, tidak spesifik',
  certificateNo: 'SKK/RSFA/0001',
  at: AT,
};

describe('aliran IGD → tempat tidur', () => {
  it('permintaan bed IGD masuk papan tempat tidur lewat langganan', () => {
    const { state, rev } = project(bedDomain, log([['klinis-igd', admission]]));
    expect(rev).toBe(1);
    expect(state.igdRequests).toEqual([
      expect.objectContaining({ id: `rb-igd-${ENC}`, encounterId: ENC, from: 'IGD B4', kelas: 'Kelas 2' }),
    ]);
  });

  it('pasien meninggal menolak admisi dan membatalkan alokasi bed', () => {
    const igd = project(
      igdDomain,
      log([
        ['klinis-igd', death],
        ['klinis-igd', admission],
      ]),
    ).state;
    expect(igd.death[ENC]?.causeCode).toBe('A41.9');
    expect(igd.admission[ENC]).toBeUndefined();
    const alloc: BedEvent = {
      type: 'bed.dialokasikan',
      requestId: `rb-igd-${ENC}`,
      bedCode: 'M-201',
      wardCode: 'MLT',
      patientLabel: 'Tn. Uji Fiktif',
      encounterId: ENC,
      from: 'IGD B4',
      at: AT,
    };
    const bed = project(
      bedDomain,
      log([
        ['klinis-igd', admission],
        ['klinis-igd', death],
        ['tempat-tidur', alloc],
      ]),
    ).state;
    expect(bed.cancelled[ENC]).toMatch(/meninggal/);
    expect(bed.allocations[`rb-igd-${ENC}`]).toBeUndefined();
  });

  it('transisi status bed mengikuti urutan sah dan resume final tercatat untuk pemulangan', () => {
    const final: ResumeEvent = {
      type: 'resume.final',
      encounterId: 'kj-ranap-uji',
      patientId: 'p-uji',
      rm: '00-00-01',
      patientName: 'Ny. Uji Fiktif',
      guarantor: 'Umum',
      admittedAt: AT,
      dischargeAt: AT,
      los: 3,
      dischargeMethod: 'Atas persetujuan dokter',
      condition: 'Membaik',
      dpjp: 'dr. Uji Fiktif',
      codes: [{ system: 'ICD-10', code: 'A41.9', label: 'Sepsis', primary: true }],
      signedAt: AT,
    };
    const step = (from: BedEvent & { type: 'bed.status' }) => from;
    const out = project(
      bedDomain,
      log([
        ['resume-medis', final],
        [
          'tempat-tidur',
          step({
            type: 'bed.status',
            bedCode: 'M-202',
            from: 'pulang',
            to: 'kotor',
            note: 'kosong sejak 10.50',
            clear: true,
            encounterId: 'kj-ranap-uji',
            at: AT,
          }),
        ],
        // Lompatan tidak sah (kotor → siap) dilewati reducer.
        [
          'tempat-tidur',
          step({
            type: 'bed.status',
            bedCode: 'M-202',
            from: 'kotor',
            to: 'siap',
            note: '',
            clear: false,
            encounterId: null,
            at: AT,
          }),
        ],
      ]),
    ).state;
    expect(out.resumeFinal['kj-ranap-uji']).toBe(AT);
    expect(out.discharged['kj-ranap-uji']).toBe(AT);
    expect(out.beds['M-202']).toMatchObject({ status: 'kotor', patientLabel: null, encounterId: null });
    // Resume tidak berubah setelah final.
    const resume = project(
      resumeDomain,
      log([
        ['resume-medis', final],
        [
          'resume-medis',
          { type: 'resume.rekonsiliasi', encounterId: 'kj-ranap-uji', confirmed: false, at: AT },
        ],
      ]),
    ).state;
    expect(resume.final['kj-ranap-uji']).toBeDefined();
  });
});

describe('siklus kemoterapi', () => {
  const order: OncologyEvent = {
    type: 'siklus.order',
    cycle: 4,
    heightCm: 158,
    weightKg: 52,
    pct: 100,
    reason: '',
    bsa: 1.51,
    doses: { Paklitaksel: 264 },
    at: AT,
  };
  const verify = (n: 1 | 2): OncologyEvent => ({
    type: 'siklus.diverifikasi',
    cycle: 4,
    n,
    verifier: n === 1 ? 'Apt. Uji Satu' : 'Ns. Uji Dua',
    doses: { Paklitaksel: 264 },
    at: AT,
  });

  it('verifikasi ganda hanya setelah order terkunci dan gerbang lab', () => {
    const early = project(
      oncologyDomain,
      log([
        ['onkologi', order],
        ['onkologi', verify(1)],
      ]),
    ).state;
    expect(early.cycles[4]?.verify).toEqual([]);
    expect(cycleStage(early.cycles[4])).toBe(1);
    const full = project(
      oncologyDomain,
      log([
        ['onkologi', order],
        [
          'onkologi',
          {
            type: 'siklus.gerbang',
            cycle: 4,
            decision: 'override',
            reason: 'Transfusi PRC selesai, Hb ulang 10,2',
            deferredTo: null,
            at: AT,
          },
        ],
        ['onkologi', verify(2)],
        ['onkologi', verify(1)],
        ['onkologi', verify(2)],
      ]),
    ).state;
    expect(full.cycles[4]?.verify.map((v) => v.n)).toEqual([1, 2]);
    expect(cycleStage(full.cycles[4])).toBe(4);
  });
});
