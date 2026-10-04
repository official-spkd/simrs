import type { DispenseStage, PharmacyCdsAlert, PharmacyItem, PharmacyPrescription } from '@simrs/shared';
import type { RunResult } from './demo/engine/types';
import { obat, supportPatient } from './demo/fixtures/penunjang';
import { STAF } from './demo/fixtures/staf';
import {
  type ScenarioResults,
  scenarioPatientId,
  simIso,
  taskAt,
  taskDone,
  taskValue,
} from './penunjang-skenario';

/**
 * Proyeksi resep pasien skenario ke antrean farmasi (pembangun-layar §6). Tn. Suryo: resep yang sama persis dengan
 * yang ditulis dokter (`rec.obat`, PRB 30 hari atau 7 hari) muncul setelah `resep.tte`, lalu mengikuti tugas
 * `farmasi.telaah → siap → serah`. Tn. Hartono: klopidogrel 300 mg loading + PPI sesuai keputusan CDS
 * (`tata-laksana.cds`) di antrean IGD.
 */

const RJ_DRUGS = [
  {
    match: 'Metformin 1000 mg',
    id: 'metformin',
    name: 'Metformin 1000 mg tab',
    dose: '1000 mg',
    freq: '2×1 (pagi, malam)',
    perDay: 2,
    stock: 900,
  },
  {
    match: 'Glimepirid 2 mg',
    id: 'glimepirid',
    name: 'Glimepirid 2 mg tab',
    dose: '2 mg',
    freq: '1×1 pagi',
    perDay: 1,
    stock: 260,
  },
  {
    match: 'Atorvastatin 20 mg',
    id: 'atorvastatin',
    name: 'Atorvastatin 20 mg tab',
    dose: '20 mg',
    freq: '1×1 malam',
    perDay: 1,
    stock: 600,
  },
] as const;

function suryoStage(R: RunResult): DispenseStage {
  if (taskDone(R, 'farmasi', 'serah')) return 'selesai';
  if (taskDone(R, 'farmasi', 'siap')) return 'serah';
  if (taskDone(R, 'farmasi', 'telaah')) return 'siap';
  return 'telaah';
}

/** Tn. Suryo · resep rawat jalan dari `rec.obat`; ada setelah resume/resep ditandatangani (`resep.tte`). */
export function suryoPrescription(R: RunResult): PharmacyPrescription | null {
  const tteAt = taskAt(R, 'resep', 'tte');
  if (tteAt === undefined) return null;
  const prb = R.rec.prb === true;
  const days = prb ? 30 : 7;
  const items: PharmacyItem[] = R.rec.obat.flatMap((o) => {
    const d = RJ_DRUGS.find((x) => o.startsWith(x.match));
    return d
      ? [obat(`suryo-${d.id}`, d.name, null, d.dose, 'PO', d.freq, d.perDay * days, 'tab', d.stock)]
      : [];
  });
  const cds = taskValue(R, 'resep', 'cds');
  const alert = (
    status: 'teratasi' | 'override',
    resolution: string,
    itemIds: string[],
  ): PharmacyCdsAlert => ({
    id: 'suryo-sulfonilurea',
    level: 'mayor',
    kind: 'kontraindikasi',
    title: 'Sulfonilurea pada riwayat hipoglikemia berat',
    detail: 'Glimepirid meningkatkan risiko hipoglikemia berulang (riwayat hipoglikemia berat 2025).',
    recommendation: 'Edukasi hipoglikemia dan cek gula mandiri',
    itemIds,
    status,
    resolution,
  });
  const serahAt = taskAt(R, 'farmasi', 'serah');
  const receiver = taskValue(R, 'farmasi', 'serah');
  return {
    id: 'rx-suryo',
    no: 'R-2610-0890',
    patient: supportPatient(scenarioPatientId('rawat-jalan')),
    location: 'Poli Penyakit Dalam',
    setting: 'rawat-jalan',
    depot: 'Depo rawat jalan',
    prescriber: STAF.dpjpPenyakitDalam,
    writtenAt: simIso(R.def, tteAt),
    stage: suryoStage(R),
    cito: false,
    tag: prb ? 'PRB' : 'Rawat jalan',
    prb,
    days,
    weightKg: null,
    egfr: R.rec.hasil.some((h) => h.includes('eGFR 74')) ? 74 : null,
    items,
    alerts:
      cds === 'lanjut'
        ? [
            alert(
              'override',
              'Override DPJP di CPOE dengan alasan: edukasi hipoglikemia + cek gula mandiri.',
              ['suryo-glimepirid'],
            ),
          ]
        : cds === 'ganti'
          ? [alert('teratasi', 'Glimepirid dihapus di CPOE (CDS dokter); metformin dioptimalkan.', [])]
          : [],
    dispensedTo: receiver === 'pasien' || receiver === 'keluarga' ? receiver : null,
    dispensedAt: serahAt === undefined ? null : simIso(R.def, serahAt),
  };
}

/** Tn. Hartono · resep IGD setelah keputusan CDS klopidogrel–omeprazol; keluar antrean saat pindah ke ruangan. */
export function hartonoPrescription(R: RunResult): PharmacyPrescription | null {
  const cdsAt = taskAt(R, 'tata-laksana', 'cds');
  if (cdsAt === undefined) return null;
  const swapped = (R.rec.ppi ?? 'Pantoprazol').startsWith('Pantoprazol');
  const ppi = swapped
    ? obat('hartono-pantoprazol', 'Pantoprazol 40 mg inj', null, '40 mg', 'IV', '1×1', 1, 'vial', 64, {
        note: 'pengganti omeprazol (CDS)',
      })
    : obat('hartono-omeprazol', 'Omeprazol 20 mg kaps', null, '20 mg', 'PO', '1×1', 1, 'kaps', 420, {
        note: 'obat rutin pasien',
      });
  const items: PharmacyItem[] = [
    obat(
      'hartono-klopidogrel',
      'Klopidogrel 75 mg tab',
      '93000387',
      '300 mg (4 tab)',
      'PO',
      '1× loading',
      4,
      'tab',
      180,
    ),
    ppi,
    obat(
      'hartono-kalsium',
      'Kalsium glukonat 10% 10 mL inj',
      null,
      '10 mL',
      'IV pelan',
      '1×, ulang bila perlu',
      2,
      'ampul',
      54,
    ),
  ];
  if (taskValue(R, 'tata-laksana', 'k') === 'lengkap') {
    items.push(
      obat(
        'hartono-insulin',
        'Insulin reguler 100 IU/mL + dekstrosa 40%',
        null,
        '10 unit + 50 mL',
        'IV',
        '1×',
        1,
        'vial',
        38,
        {
          highAlert: true,
          stockMin: 10,
          note: 'tata laksana hiperkalemia',
        },
      ),
    );
  }
  const interaction: PharmacyCdsAlert = {
    id: 'hartono-interaksi',
    level: 'mayor',
    kind: 'interaksi',
    title: 'Interaksi mayor: Klopidogrel + Omeprazol (obat rutin)',
    detail: 'Omeprazol menghambat CYP2C19 sehingga efek antiplatelet klopidogrel turun.',
    recommendation: swapped ? null : 'Usulkan ke dokter: ganti pantoprazol',
    itemIds: ['hartono-klopidogrel', ppi.id],
    status: swapped ? 'teratasi' : 'override',
    resolution: swapped
      ? 'CDS di CPOE: omeprazol diganti pantoprazol 40 mg; klopidogrel 300 mg loading tetap diberikan.'
      : 'Dokter jaga melanjutkan omeprazol dengan alasan klinis (tercatat di CPOE).',
  };
  return {
    id: 'rx-hartono',
    no: 'R-2610-0893',
    patient: supportPatient(scenarioPatientId('igd-ranap')),
    location: 'IGD · bed resusitasi 2',
    setting: 'igd',
    depot: 'Depo IGD',
    prescriber: STAF.dokterJagaIgd,
    writtenAt: simIso(R.def, cdsAt),
    stage: taskDone(R, 'admisi', 'transfer') ? 'selesai' : 'telaah',
    cito: true,
    tag: 'Cito',
    prb: false,
    days: null,
    weightKg: 70,
    egfr: 38,
    items,
    alerts: [interaction],
    dispensedTo: null,
    dispensedAt: null,
  };
}

/** Resep pasien skenario yang sudah ada di antrean farmasi. */
export function scenarioPrescriptions(results: ScenarioResults): PharmacyPrescription[] {
  return [hartonoPrescription(results['igd-ranap']), suryoPrescription(results['rawat-jalan'])].filter(
    (p): p is PharmacyPrescription => p !== null,
  );
}
