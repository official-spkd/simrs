import { SEED_REF_SAMPLES } from '@simrs/db';
import { type PharmacyPrescription, pharmacyQueueSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioDef, ScenarioEvent, TaskValue } from './demo/engine/types';
import { CDS_ALERT_ID, PRESCRIPTION_ID } from './demo/fixtures/ids';
import { APOTEKER_JAGA, demoPharmacyQueue, demoPrescriptions } from './demo/fixtures/penunjang';
import { SCENARIOS } from './demo/skenario';
import {
  applyRxLocal,
  blockingAlerts,
  cdsFollowUpGate,
  dispenseLines,
  doubleCheckGate,
  kfaText,
  liveRxLocal,
  parseStoredRxLocal,
  patchStoredRxLocal,
  requiresDoubleCheck,
  RX_UNKNOWN,
  rxGate,
  rxTag,
  secondPharmacistError,
  type StoredRxLocal,
  stockAfter,
  telaahBlock,
  workBlock,
} from './penunjang-farmasi';
import { hartonoPrescription, scenarioPrescriptions, suryoPrescription } from './penunjang-skenario-farmasi';

const kfa = new Set(SEED_REF_SAMPLES.kfa.map((c) => c.code));
const rxById = (id: string): PharmacyPrescription => {
  const r = demoPrescriptions().find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const RJ = SCENARIOS['rawat-jalan'];
const IGD = SCENARIOS['igd-ranap'];

function at(def: ScenarioDef, stepId: string): ScenarioEvent[] {
  const r = advanceTo(
    def,
    [],
    def.steps.findIndex((s) => s.id === stepId),
  );
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}
function act(def: ScenarioDef, seq: ScenarioEvent[], task: string, value: TaskValue = true): ScenarioEvent[] {
  const r = applyAction(def, seq, { type: 'task', step: runScenario(def, seq).step, task, value });
  if (!r.ok) throw new Error(`${task}: ${r.error}`);
  return r.seq;
}

describe('data dummy farmasi', () => {
  it('lolos kontrak ketat; 11 resep (6 telaah, 3 penyiapan, 2 serah) dengan nomor unik', () => {
    const q = pharmacyQueueSchema.parse(demoPharmacyQueue());
    expect(q.prescriptions).toHaveLength(11);
    expect(new Set(q.prescriptions.map((r) => r.no)).size).toBe(11);
    const count = (s: string) => q.prescriptions.filter((r) => r.stage === s).length;
    expect([count('telaah'), count('siap'), count('serah')]).toEqual([6, 3, 2]);
    expect(q.pharmacists).toEqual(APOTEKER_JAGA);
  });

  it('kode KFA hanya dari contoh seed; obat lain tampil "KFA belum dipetakan"', () => {
    const items = demoPrescriptions().flatMap((r) => r.items);
    for (const i of items) if (i.kfa) expect(kfa.has(i.kfa), i.name).toBe(true);
    expect(items.filter((i) => i.kfa).length).toBeGreaterThanOrEqual(5);
    expect(kfaText({ kfa: null })).toBe('KFA belum dipetakan');
    expect(kfaText({ kfa: '93000387' })).toBe('KFA 93000387');
    const enox = items.find((i) => i.kfa === '93002210');
    expect(enox?.highAlert).toBe(true);
  });
});

describe('telaah: gerbang CDS', () => {
  it('interaksi mayor + dosis ginjal menahan resep sampai ditindaklanjuti; usulan saja belum cukup', () => {
    const rx = rxById(PRESCRIPTION_ID.sutan);
    expect(blockingAlerts(rx, undefined)).toHaveLength(2);
    expect(telaahBlock(blockingAlerts(rx, undefined), false)).toMatch(/Tindak lanjuti 2 peringatan/);
    expect(rxTag(rx, undefined)).toEqual({ label: '2 peringatan', tone: 'warning' });
    const t = '2026-10-05T10:50:00+07:00';
    const usul = {
      alerts: { [CDS_ALERT_ID.sutanInteraction]: { state: 'diusulkan' as const, at: t, text: '' } },
    };
    expect(blockingAlerts(rx, usul)).toHaveLength(2);
    expect(rxTag(rx, usul).label).toBe('Menunggu dokter');
    const done = {
      alerts: {
        [CDS_ALERT_ID.sutanInteraction]: { state: 'disetujui' as const, at: t, text: '' },
        [CDS_ALERT_ID.sutanRenalDose]: { state: 'dikonfirmasi' as const, at: t, text: '' },
      },
    };
    expect(blockingAlerts(rx, done)).toHaveLength(0);
    expect(telaahBlock([], false)).toBeNull();
    expect(telaahBlock([], true)).toMatch(/ditahan/);
    const swapped = applyRxLocal(rx, done);
    expect(swapped.items.map((i) => i.name)).toContain('Pantoprazol 40 mg inj');
    expect(swapped.items.map((i) => i.name)).not.toContain('Omeprazol 40 mg inj');
  });

  it('override wajib ditinjau; info (alergi yang sudah dikaji) tidak menahan', () => {
    const rx = rxById(PRESCRIPTION_ID.sutan);
    const t = '2026-10-05T10:50:00+07:00';
    const local = {
      alerts: {
        [CDS_ALERT_ID.sutanInteraction]: { state: 'override' as const, at: t, text: 'alasan' },
        [CDS_ALERT_ID.sutanRenalDose]: { state: 'dikonfirmasi' as const, at: t, text: '' },
      },
    };
    expect(blockingAlerts(rx, local)).toHaveLength(0);
    expect(blockingAlerts(rxById(PRESCRIPTION_ID.endang), undefined)).toHaveLength(0);
    expect(rxTag(rxById(PRESCRIPTION_ID.aminah), undefined)).toEqual({ label: 'Cito', tone: 'danger' });
  });
});

describe('penyiapan: cek ganda high alert', () => {
  it('obat high alert wajib cek ganda oleh apoteker kedua yang bertugas, bukan penyiap', () => {
    expect(requiresDoubleCheck(rxById(PRESCRIPTION_ID.sutan))).toBe(true);
    expect(requiresDoubleCheck(rxById(PRESCRIPTION_ID.fajar))).toBe(false);
    const base = { total: 3, checked: 3, doubleCheckRequired: true };
    expect(workBlock({ ...base, doubleCheckDone: false })).toMatch(/Cek ganda/);
    expect(workBlock({ ...base, doubleCheckDone: true })).toBeNull();
    expect(workBlock({ ...base, checked: 1, doubleCheckDone: true })).toBe('Lengkapi 2 centang lagi.');
    const [a, b] = APOTEKER_JAGA;
    expect(secondPharmacistError('', a ?? '', APOTEKER_JAGA)).toBe('Pilih apoteker kedua.');
    expect(secondPharmacistError(a ?? '', a ?? '', APOTEKER_JAGA)).toMatch(/apoteker lain/);
    expect(secondPharmacistError('apt. Orang Lain', a ?? '', APOTEKER_JAGA)).toMatch(/tidak terdaftar/);
    expect(secondPharmacistError(b ?? '', a ?? '', APOTEKER_JAGA)).toBeNull();
  });

  it('serah terima mengurangi stok depo sebesar jumlah yang diserahkan', () => {
    const rx = rxById(PRESCRIPTION_ID.bonifasius);
    expect(stockAfter({ stock: 290, quantity: 30 })).toBe(260);
    expect(stockAfter({ stock: 5, quantity: 30 })).toBe(0);
    expect(dispenseLines(rx)[0]).toBe('Asetosal 80 mg tab 700 → 670 tab');
    expect(dispenseLines(rxById(PRESCRIPTION_ID.sutan)).find((l) => l.startsWith('Enoksaparin'))).toBe(
      'Enoksaparin 60 mg/0,6 mL 12 → 6 syringe (di bawah stok minimum)',
    );
  });
});

describe('resep pasien skenario', () => {
  it('Tn. Suryo: muncul setelah resep.tte (PRB 30 hari), lalu telaah → siap → serah', () => {
    expect(suryoPrescription(runScenario(RJ, at(RJ, 'resep')))).toBeNull();
    let seq = at(RJ, 'farmasi');
    let rx = suryoPrescription(runScenario(RJ, seq));
    expect(rx).toMatchObject({ stage: 'telaah', prb: true, days: 30, tag: 'PRB' });
    expect(rx?.items.map((i) => [i.name, i.quantity, i.kfa])).toEqual([
      ['Metformin 1000 mg tab', 60, null],
      ['Atorvastatin 20 mg tab', 30, null],
    ]);
    expect(rx && blockingAlerts(rx, undefined)).toHaveLength(0);
    seq = act(RJ, seq, 'telaah');
    expect(suryoPrescription(runScenario(RJ, seq))?.stage).toBe('siap');
    seq = act(RJ, seq, 'siap');
    expect(suryoPrescription(runScenario(RJ, seq))?.stage).toBe('serah');
    seq = act(RJ, seq, 'serah', 'keluarga');
    rx = suryoPrescription(runScenario(RJ, seq));
    expect(rx).toMatchObject({ stage: 'selesai', dispensedTo: 'keluarga' });
  });

  it('Tn. Suryo: override CDS glimepirid oleh DPJP tetap ditinjau apoteker; resep 7 hari tanpa PRB', () => {
    let seq = at(RJ, 'resep');
    seq = act(RJ, act(RJ, act(RJ, act(RJ, seq, 'terapi', 'a'), 'cds', 'lanjut'), 'prb', 'tidak'), 'tte');
    const rx = suryoPrescription(runScenario(RJ, seq));
    expect(rx?.items.map((i) => [i.name, i.quantity])).toContainEqual(['Glimepirid 2 mg tab', 7]);
    expect(rx && blockingAlerts(rx, undefined).map((a) => a.status)).toEqual(['override']);
  });

  it('Tn. Hartono: klopidogrel 300 mg loading + PPI sesuai CDS; insulin high alert wajib cek ganda', () => {
    expect(hartonoPrescription(runScenario(IGD, at(IGD, 'tata-laksana')))).toBeNull();
    let seq = act(IGD, at(IGD, 'tata-laksana'), 'k', 'lengkap');
    const ganti = hartonoPrescription(runScenario(IGD, act(IGD, seq, 'cds', 'ganti')));
    expect(ganti?.items.find((i) => i.kfa === '93000387')).toMatchObject({
      dose: '300 mg (4 tab)',
      quantity: 4,
    });
    expect(ganti?.items.map((i) => i.name)).toContain('Pantoprazol 40 mg inj');
    expect(ganti && blockingAlerts(ganti, undefined)).toHaveLength(0);
    expect(ganti && requiresDoubleCheck(ganti)).toBe(true);
    seq = act(IGD, seq, 'cds', 'lanjut');
    const lanjut = hartonoPrescription(runScenario(IGD, seq));
    expect(lanjut?.items.map((i) => i.name)).toContain('Omeprazol 20 mg kaps');
    expect(lanjut && blockingAlerts(lanjut, undefined)).toHaveLength(1);
    const results = {
      'rawat-jalan': runScenario(RJ, at(RJ, 'farmasi')),
      'igd-ranap': runScenario(IGD, seq),
      'elektif-btn': runScenario(SCENARIOS['elektif-btn'], []),
    };
    const q = pharmacyQueueSchema.parse(demoPharmacyQueue(scenarioPrescriptions(results)));
    expect(q.prescriptions).toHaveLength(13);
  });
});

describe('gerbang Server Action farmasi (resep dicari server, bukan dari klien)', () => {
  const [a, b] = APOTEKER_JAGA;

  it('id resep yang tidak ada di antrean ditolak', () => {
    expect(rxGate(undefined)).toEqual({ message: RX_UNKNOWN });
    expect(rxGate(rxById(PRESCRIPTION_ID.fajar))).toBeNull();
    expect(cdsFollowUpGate(undefined, CDS_ALERT_ID.sutanRenalDose, 'konfirmasi', undefined)).toEqual({
      message: RX_UNKNOWN,
    });
    expect(doubleCheckGate(undefined, b ?? '', a ?? '', APOTEKER_JAGA)).toEqual({ message: RX_UNKNOWN });
  });

  it('tindak lanjut CDS hanya atas peringatan milik resep itu yang memang menahan telaah', () => {
    const sutan = rxById(PRESCRIPTION_ID.sutan);
    expect(cdsFollowUpGate(sutan, CDS_ALERT_ID.sutanRenalDose, 'konfirmasi', undefined)).toBeNull();
    expect(cdsFollowUpGate(sutan, CDS_ALERT_ID.sutanInteraction, 'usul', undefined)).toBeNull();
    // Peringatan resep lain, dan peringatan yang tidak menahan (alergi yang sudah dikaji), ditolak.
    expect(cdsFollowUpGate(sutan, CDS_ALERT_ID.endangAllergy, 'konfirmasi', undefined)?.message).toMatch(
      /tidak ditemukan pada resep ini/,
    );
    expect(
      cdsFollowUpGate(
        rxById(PRESCRIPTION_ID.endang),
        CDS_ALERT_ID.endangAllergy,
        'override',
        'Alasan klinis yang cukup panjang',
      )?.message,
    ).toMatch(/tidak memerlukan tindak lanjut/);
    expect(cdsFollowUpGate(sutan, CDS_ALERT_ID.sutanRenalDose, 'override', 'singkat')).toEqual({
      message: 'Alasan klinis wajib diisi, minimal 10 karakter.',
      field: 'reason',
    });
    expect(
      cdsFollowUpGate(sutan, CDS_ALERT_ID.sutanRenalDose, 'override', 'Dosis disesuaikan, pantau anti-Xa'),
    ).toBeNull();
  });

  it('cek ganda hanya untuk resep dengan obat high alert, oleh apoteker kedua', () => {
    expect(doubleCheckGate(rxById(PRESCRIPTION_ID.fajar), b ?? '', a ?? '', APOTEKER_JAGA)?.message).toMatch(
      /tidak memuat obat high alert/,
    );
    const sutan = rxById(PRESCRIPTION_ID.sutan);
    expect(doubleCheckGate(sutan, a ?? '', a ?? '', APOTEKER_JAGA)).toEqual({
      message: expect.stringMatching(/apoteker lain/),
      field: 'second',
    });
    expect(doubleCheckGate(sutan, b ?? '', a ?? '', APOTEKER_JAGA)).toBeNull();
  });
});

describe('kemajuan lokal farmasi (sessionStorage)', () => {
  const rxs = [
    { id: PRESCRIPTION_ID.suryo, stage: 'serah' as const },
    { id: PRESCRIPTION_ID.sutan, stage: 'telaah' as const },
  ];
  const roundTrip = (s: StoredRxLocal) => parseStoredRxLocal(JSON.stringify(s));

  it('tersimpan per resep bersama tahap server dan bertahan selama tahap server sama', () => {
    let stored = patchStoredRxLocal({}, rxs, PRESCRIPTION_ID.suryo, (c) => ({
      ...c,
      handover: { ...c.handover, 0: true },
    }));
    stored = patchStoredRxLocal(roundTrip(stored), rxs, PRESCRIPTION_ID.suryo, (c) => ({
      ...c,
      receiver: 'keluarga',
    }));
    stored = patchStoredRxLocal(roundTrip(stored), rxs, PRESCRIPTION_ID.sutan, (c) => ({
      ...c,
      stage: 'siap',
    }));
    expect(liveRxLocal(roundTrip(stored), rxs)).toEqual({
      [PRESCRIPTION_ID.suryo]: { stage: 'serah', local: { handover: { 0: true }, receiver: 'keluarga' } },
      [PRESCRIPTION_ID.sutan]: { stage: 'telaah', local: { stage: 'siap' } },
    });
  });

  it('dibuang bila tahap server resep berubah atau resepnya hilang (mis. simulasi diulang)', () => {
    const stored = patchStoredRxLocal({}, rxs, PRESCRIPTION_ID.suryo, (c) => ({
      ...c,
      handover: { 0: true },
    }));
    expect(liveRxLocal(stored, [{ id: PRESCRIPTION_ID.suryo, stage: 'telaah' }])).toEqual({});
    expect(liveRxLocal(stored, [])).toEqual({});
    // Perubahan berikutnya berangkat dari kosong untuk tahap yang baru; id yang tidak di antrean tidak dicatat.
    const siap = [{ id: PRESCRIPTION_ID.suryo, stage: 'siap' as const }];
    expect(
      patchStoredRxLocal(stored, siap, PRESCRIPTION_ID.suryo, (c) => ({
        ...c,
        prep: { ...c.prep, 1: true },
      })),
    ).toEqual({
      [PRESCRIPTION_ID.suryo]: { stage: 'siap', local: { prep: { 1: true } } },
    });
    expect(
      patchStoredRxLocal({}, rxs, 'rx-lain', (c) => ({ ...c, hold: '2026-10-05T03:50:00.000Z' })),
    ).toEqual({});
  });

  it('isi rusak atau asing diabaikan (penyimpanan hanya kenyamanan)', () => {
    expect(parseStoredRxLocal(null)).toEqual({});
    expect(parseStoredRxLocal('{bukan json')).toEqual({});
    expect(
      parseStoredRxLocal(
        JSON.stringify({ [PRESCRIPTION_ID.suryo]: { stage: 'serah', local: { hold: 'kemarin' } } }),
      ),
    ).toEqual({});
    expect(
      parseStoredRxLocal(JSON.stringify({ [PRESCRIPTION_ID.suryo]: { stage: 'hilang', local: {} } })),
    ).toEqual({});
  });
});
