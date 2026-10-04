import { SEED_REF_SAMPLES } from '@simrs/db';
import { type PharmacyPrescription, pharmacyQueueSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioDef, ScenarioEvent, TaskValue } from './demo/engine/types';
import { APOTEKER_JAGA, demoPharmacyQueue, demoPrescriptions } from './demo/fixtures/penunjang';
import { SCENARIOS } from './demo/skenario';
import {
  applyRxLocal,
  blockingAlerts,
  dispenseLines,
  kfaText,
  requiresDoubleCheck,
  rxTag,
  secondPharmacistError,
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
    const rx = rxById('rx-sutan');
    expect(blockingAlerts(rx, undefined)).toHaveLength(2);
    expect(telaahBlock(blockingAlerts(rx, undefined), false)).toMatch(/Tindak lanjuti 2 peringatan/);
    expect(rxTag(rx, undefined)).toEqual({ label: '2 peringatan', tone: 'warning' });
    const t = '2026-10-05T10:50:00+07:00';
    const usul = { alerts: { 'sutan-interaksi': { state: 'diusulkan' as const, at: t, text: '' } } };
    expect(blockingAlerts(rx, usul)).toHaveLength(2);
    expect(rxTag(rx, usul).label).toBe('Menunggu dokter');
    const done = {
      alerts: {
        'sutan-interaksi': { state: 'disetujui' as const, at: t, text: '' },
        'sutan-ginjal': { state: 'dikonfirmasi' as const, at: t, text: '' },
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
    const rx = rxById('rx-sutan');
    const t = '2026-10-05T10:50:00+07:00';
    const local = {
      alerts: {
        'sutan-interaksi': { state: 'override' as const, at: t, text: 'alasan' },
        'sutan-ginjal': { state: 'dikonfirmasi' as const, at: t, text: '' },
      },
    };
    expect(blockingAlerts(rx, local)).toHaveLength(0);
    expect(blockingAlerts(rxById('rx-endang'), undefined)).toHaveLength(0);
    expect(rxTag(rxById('rx-aminah'), undefined)).toEqual({ label: 'Cito', tone: 'danger' });
  });
});

describe('penyiapan: cek ganda high alert', () => {
  it('obat high alert wajib cek ganda oleh apoteker kedua yang bertugas, bukan penyiap', () => {
    expect(requiresDoubleCheck(rxById('rx-sutan'))).toBe(true);
    expect(requiresDoubleCheck(rxById('rx-fajar'))).toBe(false);
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
    const rx = rxById('rx-bonifasius');
    expect(stockAfter({ stock: 290, quantity: 30 })).toBe(260);
    expect(stockAfter({ stock: 5, quantity: 30 })).toBe(0);
    expect(dispenseLines(rx)[0]).toBe('Asetosal 80 mg tab 700 → 670 tab');
    expect(dispenseLines(rxById('rx-sutan')).find((l) => l.startsWith('Enoksaparin'))).toBe(
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
