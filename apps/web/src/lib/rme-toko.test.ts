import { describe, expect, it } from 'vitest';
import { type DemoActor, project, type StoredEvent } from './demo/store/define';
import { cpptNoteId, ENCOUNTER_ID, PATIENT_ID } from './demo/fixtures/ids';
import { demoInpatients } from './demo/fixtures/rawat-inap';
import { WORKLIST_TASKS } from './demo/fixtures/rme-worklist';
import { emarKey } from './rawat-inap';
import {
  applyRekamInpatient,
  emarGiven,
  emarLog,
  rekamDomain,
  type RekamEvent,
  storedAuthorId,
  storedCpptId,
} from './rme-toko';
import { criticalFor, criticalStatusText, worklistDone, type WorklistSources } from './rme-worklist-toko';

const E = ENCOUNTER_ID.endang;
const nurse: DemoActor = { userId: 'u-perawat', name: 'Ns. Uji Fiktif', role: 'perawat', baseRole: null };
const doctor: DemoActor = { userId: 'u-dokter', name: 'dr. Uji Fiktif', role: 'dokter', baseRole: null };
const AT = '2026-10-05T10:50:00+07:00';

let seq = 0;
function ev(data: RekamEvent, actor: DemoActor = nurse): StoredEvent {
  seq += 1;
  return { seq, domain: 'rekam-medis', at: AT, actor, data };
}
const view = (events: StoredEvent[]) => project(rekamDomain, { seq, resetSeq: 0, events });

const endang = demoInpatients().find((d) => d.summary.encounterId === E);
if (!endang) throw new Error('fixture Ny. Endang hilang');

const note = (extra: Partial<Extract<RekamEvent, { type: 'cppt.ditulis' }>> = {}): RekamEvent => ({
  type: 'cppt.ditulis',
  encounterId: E,
  role: 'perawat',
  s: 'Pusing ringan',
  o: 'TD 150/90',
  a: 'Risiko jatuh',
  p: '',
  version: 1,
  supersedesId: null,
  correctionReason: null,
  addendumOf: null,
  writtenAt: AT,
  ...extra,
});

const dose = (time: string, medicationId = `${E}-obat-7`): RekamEvent => ({
  type: 'emar.diberikan',
  encounterId: E,
  medicationId,
  time,
  at: '10.52',
  givenAt: AT,
  name: 'Omeprazol 40 mg injeksi',
  late: true,
  lateReason: 'Pasien sedang foto toraks',
  doubleCheckedBy: null,
  override: false,
  overrideReason: null,
  kfa: '93001152',
  via: 'ranap',
});

describe('toko rekam-medis: CPPT, co-sign, eMAR', () => {
  it('CPPT tersimpan atas nama pelaku sesi, koreksi = versi baru, versi lama tidak bisa dikoreksi dua kali', () => {
    const first = ev(note());
    const id = storedCpptId(E, first.seq);
    const fix = ev(
      note({ version: 2, supersedesId: id, correctionReason: 'Salah ketik sistolik', o: 'TD 130/90' }),
    );
    const again = ev(
      note({ version: 2, supersedesId: id, correctionReason: 'Koreksi kedua kali', o: 'TD 120/80' }),
    );
    const { state, applied } = view([first, fix, again]);
    expect(applied).toBe(2);
    expect(state.cppt.map((c) => c.entry.version)).toEqual([1, 2]);
    expect(state.cppt[0]?.entry.author).toBe('Ns. Uji Fiktif');
    expect(storedAuthorId(state, id)).toBe('u-perawat');
    expect(rekamDomain.validate?.(state, again.data as RekamEvent, nurse)).toMatch(/sudah dikoreksi/);
  });

  it('co-sign sekali saja; rekam rawat inap kehilangan penanda co-sign', () => {
    const entryId = cpptNoteId(E, 1);
    const c1 = ev({ type: 'cppt.cosign', encounterId: E, entryId, at: AT }, doctor);
    const c2 = ev({ type: 'cppt.cosign', encounterId: E, entryId, at: AT }, doctor);
    const { state } = view([c1, c2]);
    expect(state.cosign[entryId]).toEqual({ by: 'dr. Uji Fiktif', byId: 'u-dokter', at: AT });
    const d = applyRekamInpatient(endang, state, '2026-10-05');
    expect(d.cppt.find((e) => e.id === entryId)?.cosignedBy).toBe('dr. Uji Fiktif');
    expect(endang.summary.flags).toContain('cosign');
    expect(d.summary.flags).not.toContain('cosign');
  });

  it('dosis eMAR satu kali per slot; label, log, dan penanda obat terlambat dihitung dari rekam', () => {
    const { state } = view([ev(dose('08.00')), ev(dose('08.00'))]);
    expect(state.doses).toHaveLength(1);
    expect(emarGiven(state, E)[emarKey(`${E}-obat-7`, '08.00')]).toBe('✓ 10.52 · telat');
    expect(emarLog(state, E)[0]?.note).toContain('terlambat · Pasien sedang foto toraks');
    expect(applyRekamInpatient(endang, state, '2026-10-05').summary.flags).not.toContain('emar-terlambat');
  });

  it('observasi baru memperbarui EWS ringkasan; intervensi askep shift ini tercentang', () => {
    const obs = ev({
      type: 'observasi.dicatat',
      encounterId: E,
      at: '2026-10-05T11:00:00+07:00',
      temp: 39.2,
      hr: 118,
      rr: 26,
      sbp: 95,
      dbp: 60,
      spo2: 91,
      onOxygen: true,
      consciousness: 'A',
      score: 12,
    });
    const intv = endang.nursing[0]?.interventions.find((x) => !x.done);
    if (!intv) throw new Error('fixture intervensi');
    const ask = ev({
      type: 'askep.intervensi',
      encounterId: E,
      dxId: `${E}-askep-1`,
      interventionId: intv.id,
      shift: 'pagi',
      date: '2026-10-05',
      at: AT,
    });
    const { state } = view([obs, ask]);
    const d = applyRekamInpatient(endang, state, '2026-10-05');
    expect(d.summary.lastEws).toBe(12);
    expect(d.observations.at(-1)?.score).toBe(12);
    expect(d.nursing[0]?.interventions.find((x) => x.id === intv.id)?.done).toBe(true);
  });

  it('serah terima: hanya satu yang menunggu; konfirmasi tercatat sekali', () => {
    const give = ev({
      type: 'serahterima.diserahkan',
      encounterId: E,
      shift: 'Pagi → siang',
      receiver: 'Ns. Penerima Fiktif',
      sbar: { s: 's', b: 'b', a: 'a', r: 'r' },
      at: AT,
    });
    const second = ev({ ...(give.data as Extract<RekamEvent, { type: 'serahterima.diserahkan' }>) });
    const { state } = view([give, second]);
    expect(state.handovers).toHaveLength(1);
    const id = state.handovers[0]?.id ?? '';
    const accepted = view([
      give,
      ev({ type: 'serahterima.diterima', encounterId: E, handoverId: id, at: AT }),
    ]);
    expect(accepted.state.handovers[0]?.acceptedBy).toBe('Ns. Uji Fiktif');
  });
});

describe('worklist dari toko', () => {
  const tasks = [...WORKLIST_TASKS.dokter, ...WORKLIST_TASKS.perawat, ...WORKLIST_TASKS.dokter_residen];
  const base = (): WorklistSources => ({
    state: view([]).state,
    cosigned: {},
    verified: {},
    resumeFinal: {},
    consultAnswered: {},
    assessed: {},
    askepEvaluated: {},
    rmOf: { [ENCOUNTER_ID.yusuf]: '00-11-22-33' },
    critical: [],
  });

  it('co-sign di layar mana pun menutup tugas DPJP dan tugas tunggu residen', () => {
    const src = { ...base(), cosigned: { [cpptNoteId(E, 1)]: { by: 'dr. Uji', at: AT } } };
    const done = worklistDone(tasks, src);
    expect(done[`${E}-wl-cosign`]?.note).toBe('Co-sign DPJP · CPPT residen final');
    expect(done[`${cpptNoteId(E, 1)}-wl-menunggu`]?.note).toMatch(/^Co-sign DPJP dr\. Uji/);
  });

  it('dosis di eMAR menutup tugas obat perawat; penyelesaian langsung tercatat', () => {
    const { state } = view([
      ev(dose('08.00')),
      ev({ type: 'worklist.selesai', encounterId: E, taskId: `${E}-wl-gds`, note: 'Hasil dibaca', at: AT }),
    ]);
    const done = worklistDone(tasks, { ...base(), state });
    expect(done[`${E}-wl-omeprazol`]?.note).toMatch(/^Diberikan 10\.52/);
    expect(done[`${E}-wl-gds`]?.by).toBe('Ns. Uji Fiktif');
    expect(done[`${E}-wl-aspart`]).toBeUndefined();
  });

  it('nilai kritis membawa status pelaporan lab (domain hasil-kritis)', () => {
    const t = WORKLIST_TASKS.dokter.find((x) => x.ref?.kind === 'kritis');
    if (!t) throw new Error('tugas kritis');
    const src = {
      ...base(),
      critical: [
        {
          rm: '00-11-22-33',
          test: 'Kalium · LOINC 2823-3',
          valueText: '6,4 mmol/L',
          report: {
            recipient: 'dr. Jaga Fiktif',
            recipientRole: 'Dokter jaga',
            reportedBy: 'Analis Fiktif',
            reportedAt: AT,
          },
        },
      ],
    };
    const c = criticalFor(t, src);
    expect(c && criticalStatusText(c)).toBe(
      'Lab: dilaporkan Analis Fiktif ke dr. Jaga Fiktif (Dokter jaga) · 10.50 · read-back terkonfirmasi',
    );
    expect(PATIENT_ID.yusuf).toBe(t.patientId);
  });
});
