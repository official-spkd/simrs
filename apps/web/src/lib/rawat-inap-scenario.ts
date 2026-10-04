import type {
  Bed,
  BedRequest,
  ClinicalResult,
  CodedDiagnosis,
  ConsentDocument,
  DischargeSummary,
  ResumeSection,
  EdStatus,
  EdTrackingItem,
  InpatientDetail,
  TriageLevel,
} from '@simrs/shared';
import { simInstant } from './demo/engine/format';
import { firstOpenTask, taskKey, taskOptions, visibleTasks } from './demo/engine/run';
import type { RunResult, ScenarioId, TaskValue } from './demo/engine/types';
import { encounterIdOf, patientByScenario } from './demo/fixtures/pasien';
import {
  buildInpatient,
  hartonoConsentBase,
  ratnaConsentBase,
  resumeChecklist,
  type DxSeed,
  type InpatientSeed,
  minutesBefore,
  type NoteSeed,
  type ResultSeed,
  wib,
} from './demo/fixtures/rawat-inap';
import { PERSONA, STAF, STAF_LAIN } from './demo/fixtures/staf';
import { isTriageLevel } from './rawat-inap';

/**
 * Proyeksi pasien skenario Simulasi (Tn. Hartono · igd-ranap, Ny. Ratna · elektif-btn) ke layar IGD, tempat
 * tidur, rawat inap, resume, dan persetujuan tindakan (ADR-0023). Murni: hanya membaca `RunResult` hasil replay,
 * sehingga layar mana pun dan tab mana pun menampilkan keadaan yang sama.
 */

export function stepIndexOf(R: RunResult, stepId: string): number {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new Error(`Langkah ${stepId} tidak ada di skenario ${R.def.id}`);
  return i;
}

/** Tugas `stepId.taskId` sudah selesai? */
export function isDone(R: RunResult, stepId: string, taskId: string): boolean {
  return R.done.has(taskKey(stepIndexOf(R, stepId), taskId));
}

export function valueOf(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  return R.done.get(taskKey(stepIndexOf(R, stepId), taskId));
}

/** Langkah sudah dimulai (aktif atau lewat)? */
export function reached(R: RunResult, stepId: string): boolean {
  return R.finished || R.step >= stepIndexOf(R, stepId);
}

export interface ScenarioTaskState {
  /** Tugas terbuka pertama di langkah aktif: tombol asli layar boleh menjalankannya. */
  enabled: boolean;
  done: boolean;
  /** Syarat `when` terpenuhi (mis. alasan triase hanya bila level 3). */
  visible: boolean;
  /** Nilai selesai: id pilihan, isi isian, atau "true" untuk aksi. */
  value: string | null;
  options: Array<{ id: string; label: string; sub: string }>;
}

/** Keadaan satu langkah skenario untuk komponen klien (bisa diserialisasi). */
export interface ScenarioStepState {
  scenario: ScenarioId;
  stepId: string;
  step: number;
  active: boolean;
  rev: number;
  tasks: Record<string, ScenarioTaskState>;
}

export function stepState(R: RunResult, stepId: string, rev: number): ScenarioStepState {
  const i = stepIndexOf(R, stepId);
  const active = !R.finished && R.step === i;
  const open = active ? firstOpenTask(R, i) : null;
  const visible = new Set(visibleTasks(R, i).map((t) => t.id));
  const tasks: Record<string, ScenarioTaskState> = {};
  for (const t of R.def.steps[i]?.tasks ?? []) {
    const v = R.done.get(taskKey(i, t.id));
    tasks[t.id] = {
      enabled: open?.id === t.id,
      done: v !== undefined,
      visible: visible.has(t.id),
      value: v === undefined ? null : v === true ? 'true' : v,
      options:
        t.kind === 'choice'
          ? taskOptions(t, R.rec).map((o) => ({ id: o.id, label: o.label, sub: o.sub ?? '' }))
          : [],
    };
  }
  return { scenario: R.def.id, stepId, step: i, active, rev, tasks };
}

function choiceOptions(R: RunResult, stepId: string, taskId: string) {
  const t = R.def.steps[stepIndexOf(R, stepId)]?.tasks.find((x) => x.id === taskId);
  return t?.kind === 'choice' ? taskOptions(t, R.rec) : [];
}

/** Id opsi bed skenario → kode bed papan: "Anggrek A-07" → "A-07", "Paviliun VIP 3" → "VIP 3". */
export function scenarioBedCode(optionId: string): string {
  return optionId
    .replace(/ ·.*$/, '')
    .replace(/^(Anggrek|Paviliun|Melati) /, '')
    .trim();
}

// ---------------------------------------------------------------------------------------------------------
// Tempat tidur · permintaan bed dan bed pasien skenario
// ---------------------------------------------------------------------------------------------------------

const DISPO_NEED: Record<string, { kelas: BedRequest['kelas']; need: string }> = {
  icu: { kelas: 'ICU', need: 'ICU/ICCU · NSTEMI + hiperkalemia · BPJS kelas 1' },
  hcu: { kelas: 'HCU', need: 'HCU · NSTEMI + hiperkalemia · BPJS kelas 1' },
  bangsal: { kelas: 'Kelas 1', need: 'Bangsal telemetri · kelas 1 · NSTEMI' },
};

/** Permintaan bed Tn. Hartono: muncul setelah keputusan rawat (`tata-laksana.dispo`) sampai serah terima. */
export function hartonoBedRequest(R: RunResult): BedRequest | null {
  if (!isDone(R, 'tata-laksana', 'dispo') || isDone(R, 'admisi', 'transfer')) return null;
  const p = patientByScenario('igd-ranap');
  if (!p) return null;
  const d = DISPO_NEED[R.rec.dispo ?? 'icu'] ?? DISPO_NEED.icu;
  const since = R.doneAt.get(taskKey(stepIndexOf(R, 'tata-laksana'), 'dispo')) ?? R.clock;
  const wait = Math.max(0, R.clock - since);
  return {
    id: 'rq-hartono',
    patientName: p.nama,
    sex: p.jk,
    ageYears: p.umur,
    rm: p.rm,
    from: 'IGD R2',
    need: d?.need ?? '',
    kelas: d?.kelas ?? 'ICU',
    waitMinutes: wait,
    late: wait >= 240,
    candidates: choiceOptions(R, 'admisi', 'alok').map((o) => ({
      bedCode: scenarioBedCode(o.id),
      label: o.label,
      note: o.sub ?? '',
    })),
    scenario: 'igd-ranap',
  };
}

/** Permintaan bed Ny. Ratna (admisi elektif) sampai SEP rawat inap terbit. */
export function ratnaBedRequest(R: RunResult): BedRequest | null {
  if (isDone(R, 'admisi', 'sep')) return null;
  const p = patientByScenario('elektif-btn');
  if (!p) return null;
  return {
    id: 'rq-ratna',
    patientName: p.nama,
    sex: p.jk,
    ageYears: p.umur,
    rm: p.rm,
    from: 'Admisi elektif · operasi Sel 13 Okt',
    need: 'Bedah · hak kelas 2 · BPJS · laparoskopi elektif',
    kelas: valueOf(R, 'admisi', 'kelas') === 'vip' ? 'VIP' : 'Kelas 2',
    waitMinutes: null,
    late: false,
    candidates: [
      { bedCode: 'VIP 3', label: 'Paviliun VIP 3 · naik kelas', note: 'selisih biaya dibayar pasien' },
      { bedCode: 'M-210', label: 'Melati M-210 · kelas 2', note: 'sesuai hak kelas, ditanggung BPJS' },
    ],
    scenario: 'elektif-btn',
  };
}

/** Kode bed Ny. Ratna sesuai pilihan kelas (`admisi.kelas`): VIP → "VIP 3", hak kelas → "M-210". */
export function ratnaBedCode(R: RunResult): string | null {
  const v = valueOf(R, 'admisi', 'kelas');
  return v === undefined ? null : v === 'vip' ? 'VIP 3' : 'M-210';
}

/** Tumpangkan bed pasien skenario ke papan bed (dipesan → terisi → pindah/pulang). Murni, tidak mengubah input. */
export function applyScenarioBeds(beds: readonly Bed[], igd: RunResult, elektif: RunResult): Bed[] {
  const patch = new Map<string, Partial<Bed>>();
  const hartono = patientByScenario('igd-ranap');
  const alok = valueOf(igd, 'admisi', 'alok');
  if (hartono && typeof alok === 'string') {
    const code = scenarioBedCode(alok);
    const who = { patientLabel: hartono.nama, encounterId: encounterIdOf(hartono.id) };
    const moved = isDone(igd, 'rawat-inap', 'pindah');
    const home = isDone(igd, 'kasir', 'pulang');
    if (!isDone(igd, 'admisi', 'transfer'))
      patch.set(code, { ...who, status: 'dipesan', note: 'dari IGD R2' });
    else if (!moved)
      patch.set(
        code,
        home ? kosong('pasien pulang') : { ...who, status: 'terisi', note: 'NSTEMI · monitor EKG' },
      );
    else {
      patch.set(code, kosong('pasien pindah ke Anggrek A-12'));
      patch.set(
        'A-12',
        home ? kosong('pasien pulang') : { ...who, status: 'terisi', note: 'step-down · telemetri' },
      );
    }
  }
  const ratna = patientByScenario('elektif-btn');
  const rCode = ratnaBedCode(elektif);
  if (ratna && rCode) {
    const who = { patientLabel: ratna.nama, encounterId: encounterIdOf(ratna.id) };
    if (isDone(elektif, 'kasir', 'pulang')) patch.set(rCode, kosong('pasien pulang'));
    else if (!isDone(elektif, 'admisi', 'sep'))
      patch.set(rCode, { ...who, status: 'dipesan', note: 'admisi elektif' });
    else
      patch.set(rCode, {
        ...who,
        status: isDone(elektif, 'pasca-operasi', 'h2') ? 'pulang' : 'terisi',
        note: isDone(elektif, 'operasi', 'op')
          ? 'pasca laparoskopi kolesistektomi'
          : 'pra-operasi, puasa mulai 24.00',
      });
  }
  return beds.map((b) => {
    const p = patch.get(b.code);
    return p ? { ...b, ...p } : b;
  });
}

function kosong(note: string): Partial<Bed> {
  return { status: 'kotor', patientLabel: null, encounterId: null, note };
}

// ---------------------------------------------------------------------------------------------------------
// IGD · Tn. Hartono
// ---------------------------------------------------------------------------------------------------------

const HARTONO_DEFAULT_VITALS = ['—', '—', '—', '—'] as const;

/** "158/94 · 112 · 24 · 94%" → [TD, nadi, RR, SpO2]. */
export function parseTtv(ttv: string): [string, string, string, string] {
  const parts = ttv.split('·').map((s) => s.trim());
  if (parts.length < 4) return [...HARTONO_DEFAULT_VITALS];
  return [parts[0] ?? '—', parts[1] ?? '—', parts[2] ?? '—', parts[3] ?? '—'];
}

function vitalsFrom(ttv: string): EdTrackingItem['vitals'] {
  const [td, hr, rr, spo2] = parseTtv(ttv);
  const sys = Number(td.split('/')[0]);
  return [
    { label: 'TD', value: td, abnormal: sys >= 140 },
    { label: 'Nadi', value: hr, abnormal: Number(hr) > 100 },
    { label: 'Napas', value: rr, abnormal: Number(rr) > 20 },
    { label: 'SpO2', value: spo2, abnormal: Number.parseInt(spo2, 10) < 95 },
    { label: 'Suhu', value: ttv ? '36,9' : '—', abnormal: false },
    { label: 'GCS', value: ttv ? '15' : '—', abnormal: false },
  ];
}

/** Label pasien IGD skenario sebelum identitasnya dicocokkan di MPI (tugas `kedatangan.id`). */
export const HARTONO_ANON_LABEL = 'Pasien laki-laki ±60 th · identitas belum dicocokkan';

/**
 * Tn. Hartono di papan IGD sejak skenario dimulai sampai serah terima ke ruang rawat. Sebelum identitas cocok di
 * MPI (`kedatangan.id`), tampil anonim tanpa RM dan penjamin.
 */
export function hartonoEdItem(R: RunResult, asOf: string): EdTrackingItem | null {
  if (isDone(R, 'admisi', 'transfer')) return null;
  const p = patientByScenario('igd-ranap');
  if (!p) return null;
  const known = isDone(R, 'kedatangan', 'id');
  const placed = isDone(R, 'triase', 'bed');
  let status: EdStatus = 'pemeriksaan';
  if (!isDone(R, 'kedatangan', 'gelang')) status = 'registrasi';
  else if (!placed) status = 'triase';
  else if (isDone(R, 'tata-laksana', 'dispo')) status = 'tunggu-bed';
  else if (isDone(R, 'nilai-kritis', 'hasil')) status = 'pemeriksaan';
  else if (isDone(R, 'asesmen-dokter', 'orderset')) status = 'tunggu-lab';
  const lv = Number(valueOf(R, 'triase', 'level'));
  const level: TriageLevel | null = isTriageLevel(lv) ? lv : null;
  const los = Math.max(0, R.clock - R.def.startMin);
  return {
    encounterId: encounterIdOf(p.id),
    bed: placed ? 'R2' : null,
    zone: placed ? 'R' : 'T',
    patientId: known ? p.id : null,
    patientName: known ? p.nama : HARTONO_ANON_LABEL,
    rm: known ? p.rm : null,
    sex: p.jk,
    ageLabel: known ? `${p.umur} th` : '±60 th',
    guarantor: !known
      ? 'Penjamin menyusul'
      : isDone(R, 'admisi', 'bpjs')
        ? 'BPJS Kelas 1 · aktif'
        : 'BPJS · cek menyusul',
    triageLevel: level,
    suggestedLevel: 2,
    maxLevel: 3,
    chiefComplaint: 'Nyeri dada kiri menjalar ke lengan, 40 menit',
    doctor: !placed ? null : isDone(R, 'tata-laksana', 'dispo') ? STAF.dpjpJantung : STAF.dokterJagaIgd,
    arrivedAt: minutesBefore(asOf, los),
    losMinutes: los,
    status,
    arrivalMode: 'diantar keluarga',
    vitals: vitalsFrom(R.rec.ttv),
    recommendation:
      'Nyeri dada tipikal + takikardia + SpO2 94%: triase 2, EKG ≤ 10 menit, aktifkan alur sindrom koroner akut.',
    orderTitle: 'Order awal otomatis (alur SKA)',
    orders: [
      { id: 'ekg', label: 'EKG 12 sadapan', defaultOn: true },
      { id: 'lab-ska', label: 'Troponin I, darah lengkap, elektrolit', defaultOn: true },
      { id: 'konsul-jantung', label: 'Konsul kardiologi jaga', defaultOn: false },
    ],
    scenario: true,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Rawat inap · Tn. Hartono (setelah serah terima) dan Ny. Ratna (setelah SEP rawat inap)
// ---------------------------------------------------------------------------------------------------------

/** Instan WIB saat tugas selesai (jam simulasi), atau jam simulasi kini. */
export function taskInstant(R: RunResult, stepId: string, taskId: string, plusMinutes = 0): string {
  const m = R.doneAt.get(taskKey(stepIndexOf(R, stepId), taskId)) ?? R.clock;
  return wib(simInstant(R.def, m + plusMinutes));
}

/** Jam simulasi kini (WIB): cap waktu catatan baru pasien skenario agar urut di lini masa skenarionya. */
export function scenarioNow(R: RunResult): string {
  return wib(simInstant(R.def, R.clock));
}

/** Hari rawat kalender (hari masuk = 1) menurut jam simulasi. */
function scenarioDay(R: RunResult, stepId: string, taskId: string): number {
  const m = R.doneAt.get(taskKey(stepIndexOf(R, stepId), taskId)) ?? R.clock;
  return Math.max(1, Math.floor(R.clock / 1440) - Math.floor(m / 1440) + 1);
}

/** "I21.4 · NSTEMI (kerja)" → kode berlabel; ICD-10 bila diawali huruf, selain itu ICD-9-CM. */
export function parseCoded(entries: readonly string[], primaryFirst: boolean): DxSeed[] {
  return entries.map((e, i) => {
    const [code = '', ...rest] = e.split(' · ');
    const system = /^[A-Z]/.test(code) ? 'ICD-10' : 'ICD-9-CM';
    return [system, code.trim(), rest.join(' · ').trim() || code, primaryFirst && i === 0];
  });
}

/** Hasil penunjang dari rekam medis skenario → [nama, nilai, penanda]. */
const HASIL: Array<[RegExp, string, string, ClinicalResult['flag']]> = [
  [/^EKG/, 'EKG 12 sadapan', 'Depresi ST V4–V6, T tinggi runcing', 'tinggi'],
  [/^Kalium 6,8/, 'Kalium', '6,8 mmol/L (nilai kritis, dilaporkan dengan read-back)', 'kritis'],
  [/^Troponin/, 'Troponin I', 'Meningkat', 'tinggi'],
  [/^Kreatinin/, 'Kreatinin', '1,8 mg/dL · eGFR 38', 'tinggi'],
  [/^Kalium ulang/, 'Kalium ulang', '5,1 mmol/L', 'tinggi'],
  [/^Ekokardiografi/, 'Ekokardiografi', 'EF 48%, hipokinetik anterior', 'rendah'],
];

function hartonoResults(R: RunResult): ResultSeed[] {
  const src: Array<[RegExp, string, string]> = [
    [/^EKG/, 'asesmen-dokter', 'ekg'],
    [/^(Kalium 6,8|Troponin|Kreatinin)/, 'nilai-kritis', 'hasil'],
    [/^Kalium ulang/, 'rawat-inap', 'h1'],
    [/^Ekokardiografi/, 'rawat-inap', 'echo'],
  ];
  return R.rec.hasil
    .map((h): ResultSeed | null => {
      const m = HASIL.find(([re]) => re.test(h));
      const s = src.find(([re]) => re.test(h));
      if (!m || !s) return null;
      return [taskInstant(R, s[1], s[2]), m[1], m[2], m[3]];
    })
    .filter((x): x is ResultSeed => x !== null)
    .reverse();
}

function wardOfBed(code: string): string {
  if (code.startsWith('ICU')) return 'ICU';
  if (code.startsWith('HCU')) return 'HCU';
  if (code.startsWith('VIP')) return 'VIP';
  if (code.startsWith('M-')) return 'MELATI';
  return 'ANGGREK';
}

/** Tn. Hartono di ruang rawat: konten bertambah sesuai hari perawatan yang sudah dilompati di Simulasi. */
export function hartonoInpatient(R: RunResult): InpatientDetail | null {
  if (!isDone(R, 'admisi', 'transfer')) return null;
  const p = patientByScenario('igd-ranap');
  if (!p) return null;
  const at = (step: string, task: string, plus = 0) => taskInstant(R, step, task, plus);
  const done = (step: string, task: string) => isDone(R, step, task);
  const moved = done('rawat-inap', 'pindah');
  const bed = moved ? 'A-12' : scenarioBedCode(String(valueOf(R, 'admisi', 'alok') ?? 'ICU 3'));
  const emar = done('rawat-inap', 'emar');
  const h1 = done('rawat-inap', 'h1');
  const akhir = done('rawat-inap', 'akhir');
  // Obat jadwal pertama (08.00) tercatat setelah perawat memberikan tiap dosis lewat pindai gelang, enoksaparin
  // dengan cek ganda (tugas `rawat-inap.emar` berjalan saat semua dosis jam itu tercatat).
  const am = emar ? 'g:08.10' : 'j';
  const enox = emar ? 'g:08.12 · cek ganda' : 'j';
  const obs: InpatientSeed['obs'] = [[at('admisi', 'transfer', 15), 36.8, 96, 20, 140, 88, 96, false, 'A']];
  if (h1) obs.push([at('rawat-inap', 'h1'), 36.7, 78, 18, 128, 80, 97, false, 'A']);
  if (akhir) obs.push([at('rawat-inap', 'akhir'), 36.6, 68, 16, 124, 78, 98, false, 'A']);
  const notes: NoteSeed[] = [
    {
      id: 'cppt-hartono-1',
      role: 'perawat',
      author: STAF_LAIN.perawat[2],
      at: at('admisi', 'transfer'),
      o: 'Tiba dari IGD dengan brankar, monitor EKG terpasang. Serah terima SBAR lengkap.',
      a: 'Risiko penurunan curah jantung.',
      p: 'Monitor EKG kontinu, tanda vital tiap 1 jam.',
    },
    {
      id: 'cppt-hartono-2',
      role: 'residen',
      author: PERSONA.dokterResiden,
      at: at('admisi', 'transfer', 30),
      s: 'Nyeri dada berkurang, skala 2.',
      o: 'TD 140/88 · nadi 96 · SpO2 96%. Kalium pasca koreksi menunggu hasil.',
      a: 'NSTEMI dengan hiperkalemia; CKD stadium 3.',
      p: 'Antiplatelet ganda + enoksaparin, kalium ulang 6 jam, ekokardiografi.',
      ...(h1 ? { cosign: [STAF.dpjpJantung, at('rawat-inap', 'h1')] as [string, string] } : {}),
    },
  ];
  if (h1)
    notes.push({
      id: 'cppt-hartono-3',
      role: 'dpjp',
      author: STAF.dpjpJantung,
      at: at('rawat-inap', 'h1'),
      s: 'Nyeri dada tidak ada.',
      o: 'Kalium ulang 5,1 mmol/L. EKG: perbaikan segmen ST.',
      a: 'NSTEMI, hiperkalemia teratasi.',
      p: 'Lanjut terapi, mobilisasi bertahap, ekokardiografi besok.',
    });
  if (done('rawat-inap', 'echo'))
    notes.push({
      id: 'cppt-hartono-4',
      role: 'dpjp',
      author: STAF.dpjpJantung,
      at: at('rawat-inap', 'echo'),
      o: 'Ekokardiografi: EF 48%, hipokinetik anterior.',
      a: 'NSTEMI dengan disfungsi ringan ventrikel kiri.',
      p: 'Lanjut bisoprolol; rencana angiografi koroner elektif lewat rawat jalan.',
    });
  if (moved)
    notes.push({
      id: 'cppt-hartono-5',
      role: 'perawat',
      author: PERSONA.perawat,
      at: at('rawat-inap', 'pindah'),
      o: 'Pindah ke Anggrek A-12, telemetri terpasang.',
      a: 'Kondisi stabil.',
      p: 'Mobilisasi jalan di ruangan, pantau telemetri.',
    });
  if (akhir)
    notes.push({
      id: 'cppt-hartono-6',
      role: 'dpjp',
      author: STAF.dpjpJantung,
      at: at('rawat-inap', 'akhir'),
      s: 'Tidak ada keluhan.',
      o: 'TD 124/78 · nadi 68 · SpO2 98%.',
      a: 'NSTEMI, stabil.',
      p: 'Rencana pulang besok; edukasi obat dan tanda bahaya.',
    });
  const seed: InpatientSeed = {
    patientId: p.id,
    wardCode: wardOfBed(bed),
    bed,
    dpjp: STAF.dpjpJantung,
    admittedOn: R.def.startDate,
    flags: [...(h1 ? [] : (['cosign'] as const)), ...(akhir ? (['rencana-pulang'] as const) : [])],
    risk: 'Pasca NSTEMI · risiko perdarahan (antiplatelet ganda + antikoagulan)',
    plan: akhir
      ? 'Stabil, rencana pulang besok; edukasi obat dan tanda bahaya; kontrol Poli Jantung.'
      : 'Monitor EKG kontinu, antiplatelet ganda + enoksaparin, kalium ulang, ekokardiografi.',
    dx: [...parseCoded(R.rec.dx, true), ...parseCoded(R.rec.tindakan, false)],
    emarNow: '08.00',
    emarNote: 'Pindai gelang sebelum obat jadwal pertama; enoksaparin obat kewaspadaan tinggi (cek ganda).',
    meds: [
      ['Aspirin 80 mg', 'PO · 1×1 pagi', null, false, ['', am, '', '', '']],
      ['Klopidogrel 75 mg', 'PO · 1×1 pagi', '93000387', false, ['', am, '', '', '']],
      ['Bisoprolol 2,5 mg', 'PO · 1×1 pagi', '93000655', false, ['', am, '', '', '']],
      [R.rec.ppi ?? 'Pantoprazol 40 mg 1×1', 'PO · sebelum makan pagi', null, false, ['', am, '', '', '']],
      ['Enoksaparin 60 mg/0,6 mL', 'SC · 2×1 (08, 22)', '93002210', true, ['', enox, '', '', 'r']],
      ['Atorvastatin 40 mg', 'PO · 1×1 malam', '93000914', false, ['', '', '', '', 'r']],
      ['Amlodipin 10 mg', 'PO · 1×1 pagi', null, false, ['', 'd:Ditunda · TD 110/70', '', '', '']],
    ],
    notes,
    obs,
    results: hartonoResults(R),
    nursing: [
      [
        'Risiko penurunan curah jantung',
        [
          ['Monitor EKG kontinu', true],
          ['Batasi aktivitas sesuai toleransi', true],
          ['Edukasi tanda nyeri dada berulang', akhir],
        ],
      ],
      [
        'Risiko perdarahan',
        [
          ['Pantau perdarahan gusi dan bekas suntikan', true],
          ['Hindari injeksi intramuskular', true],
        ],
      ],
    ],
  };
  return buildInpatient(seed, { scenario: true, day: scenarioDay(R, 'admisi', 'transfer') });
}

/** Ny. Ratna di ruang rawat sejak SEP terbit: pra-operasi → pasca laparoskopi → layak pulang. */
export function ratnaInpatient(R: RunResult): InpatientDetail | null {
  if (!isDone(R, 'admisi', 'sep')) return null;
  const p = patientByScenario('elektif-btn');
  if (!p) return null;
  const at = (step: string, task: string, plus = 0) => taskInstant(R, step, task, plus);
  const done = (step: string, task: string) => isDone(R, step, task);
  const bed = ratnaBedCode(R) ?? 'M-210';
  const op = done('operasi', 'op');
  const pulih = done('operasi', 'pulih');
  const emar = done('pasca-operasi', 'emar');
  const h2 = done('pasca-operasi', 'h2');
  const pm = emar ? 'g:18.10' : 'j';
  const notes: NoteSeed[] = [
    {
      id: 'cppt-ratna-1',
      role: 'perawat',
      author: PERSONA.perawat,
      at: at('admisi', 'sep', 20),
      s: 'Nyeri perut kanan atas hilang timbul, tidak demam.',
      o: 'Tanda vital stabil. Persetujuan tindakan dan anestesi sudah ditandatangani.',
      a: 'Ansietas pra-operasi ringan.',
      p: 'Edukasi puasa mulai 24.00, persiapan operasi besok 07.30.',
    },
    {
      id: 'cppt-ratna-2',
      role: 'dpjp',
      author: STAF.dpjpBedah,
      at: at('admisi', 'sep', 90),
      s: 'Kolik bilier berulang 6 bulan.',
      o: 'USG: batu kandung empedu multipel, dinding tidak menebal. Lab pra-operasi dalam batas normal.',
      a: 'Kolelitiasis simptomatik.',
      p: 'Laparoskopi kolesistektomi elektif besok.',
    },
  ];
  if (op)
    notes.push({
      id: 'cppt-ratna-3',
      role: 'dpjp',
      author: STAF.dpjpBedah,
      at: at('operasi', 'op'),
      o: 'Kolesistektomi laparoskopik tanpa penyulit, perdarahan minimal.',
      a: 'Pasca laparoskopi kolesistektomi.',
      p: 'Diet cair bertahap 6 jam pasca operasi, analgesik terjadwal.',
    });
  if (pulih)
    notes.push({
      id: 'cppt-ratna-4',
      role: 'perawat',
      author: STAF_LAIN.perawat[0],
      at: at('operasi', 'pulih'),
      s: 'Nyeri luka operasi skala 3.',
      o: 'Kembali dari ruang pulih, Aldrete 10.',
      a: 'Nyeri akut pasca operasi.',
      p: 'Kaji nyeri tiap 4 jam, mobilisasi 6 jam pasca operasi.',
    });
  if (h2)
    notes.push({
      id: 'cppt-ratna-5',
      role: 'dpjp',
      author: STAF.dpjpBedah,
      at: at('pasca-operasi', 'h2'),
      s: 'Nyeri minimal, sudah buang angin.',
      o: 'Luka operasi kering. Toleransi diet lunak baik.',
      a: 'Pasca laparoskopi kolesistektomi hari 1, baik.',
      p: 'Layak pulang besok pagi; resume dan obat pulang disiapkan.',
    });
  const obs: InpatientSeed['obs'] = [[at('admisi', 'sep', 20), 36.6, 78, 16, 118, 76, 99, false, 'A']];
  if (pulih) obs.push([at('operasi', 'pulih'), 36.9, 88, 18, 112, 70, 98, false, 'A']);
  if (h2) obs.push([at('pasca-operasi', 'h2'), 36.7, 76, 16, 116, 74, 99, false, 'A']);
  const seed: InpatientSeed = {
    patientId: p.id,
    wardCode: wardOfBed(bed),
    bed,
    dpjp: STAF.dpjpBedah,
    admittedOn: R.def.startDate,
    flags: h2 ? ['rencana-pulang'] : [],
    risk: op ? 'Pasca laparoskopi · risiko mual-muntah pasca operasi' : 'Puasa pra-operasi mulai 24.00',
    plan: op
      ? 'Mobilisasi dini, diet lunak bertahap, analgesik terjadwal; pulang bila nyeri terkontrol.'
      : 'Persiapan operasi besok 07.30: puasa, edukasi pra-anestesi, profilaksis antibiotik di kamar operasi.',
    dx: [
      ['ICD-10', 'K80.2', 'Batu kandung empedu tanpa kolesistitis', true],
      ...parseCoded(R.rec.tindakan, false),
    ],
    emarNow: '18.00',
    emarNote: op
      ? 'Pindai gelang sebelum analgesik dan antibiotik pasca operasi.'
      : 'Belum ada obat terjadwal; profilaksis diberikan di kamar operasi.',
    meds: op
      ? [
          ['Parasetamol 1 g', 'IV · 3×1', null, false, ['', '', '', pm, 'r']],
          ['Ketorolak 30 mg', 'IV · 3×1', null, false, ['', '', '', pm, 'r']],
          ['Omeprazol 40 mg injeksi', 'IV · 1×24 jam', '93001152', false, ['', '', '', pm, '']],
          ['Ondansetron 4 mg', 'IV · bila mual', null, false, ['', '', '', '', '']],
        ]
      : [
          [
            'Sefazolin 2 g',
            'IV · profilaksis 30 menit pra-insisi (di OK)',
            null,
            false,
            ['', '', '', '', ''],
          ],
        ],
    notes,
    obs,
    results: [
      [at('admisi', 'sep', 60), 'Hemoglobin', '12,8 g/dL', 'normal'],
      [at('admisi', 'sep', 60), 'Leukosit', '7.600 /µL', 'normal'],
    ],
    nursing: op
      ? [
          [
            'Nyeri akut pasca operasi',
            [
              ['Kaji skala nyeri tiap 4 jam', true],
              ['Mobilisasi dini 6 jam pasca operasi', h2],
            ],
          ],
        ]
      : [
          [
            'Ansietas pra-operasi',
            [
              ['Edukasi prosedur dan puasa', true],
              ['Persetujuan tindakan ditandatangani', true],
            ],
          ],
        ],
  };
  return buildInpatient(seed, { scenario: true, day: scenarioDay(R, 'admisi', 'sep') });
}

// ---------------------------------------------------------------------------------------------------------
// Resume medis pasien skenario: bagian terisi seiring milestone, TTE lewat tugas `resume.tte`
// ---------------------------------------------------------------------------------------------------------

function coded(entries: readonly string[], primaryFirst: boolean): CodedDiagnosis[] {
  return parseCoded(entries, primaryFirst).map(([system, code, label, primary]) => ({
    system,
    code,
    label,
    primary: !!primary,
  }));
}

type DischargeMed = DischargeSummary['medications'][number];

/** "Bisoprolol 2,5 mg 1×1" → nama + aturan pakai; semua obat baru kecuali `classify` menyatakan lain. */
function medsFrom(
  obat: readonly string[],
  classify: (name: string, sig: string) => Pick<DischargeMed, 'sig' | 'change'> | null = () => null,
): DischargeMed[] {
  return obat.map((o) => {
    const [name = o, ...rest] = o.split(/ (?=\d+×|SC|IV|PO)/);
    const sig = rest.join(' ').trim() || 'sesuai resep';
    return { name: name.trim(), ...(classify(name.trim(), sig) ?? { sig, change: 'baru' as const }) };
  });
}

/** Obat rutin Tn. Hartono sebelum masuk (sama dengan daftar obat aktif di CPOE IGD). */
const HARTONO_HOME = { amlodipin: 'Amlodipin 5 mg', ppi: 'Omeprazol 20 mg' } as const;

/**
 * Rekonsiliasi obat pulang Tn. Hartono terhadap obat rutin: amlodipin 5 mg → 10 mg (ubah dosis) atau dihentikan
 * (pilihan DPJP), omeprazol dihentikan bila diganti pantoprazol karena interaksi klopidogrel (CDS `cds = ganti`).
 */
export function hartonoDischargeMeds(
  obat: readonly string[],
  ppi: string | undefined,
  rekon: TaskValue | undefined,
): DischargeMed[] {
  const list = medsFrom(obat, (name, sig) => {
    if (name.startsWith('Amlodipin'))
      return { sig: `${sig} · naik dari 5 mg (obat rutin)`, change: 'ubah-dosis' };
    if (name.startsWith('Omeprazol')) return { sig, change: 'lanjut' };
    return null;
  });
  if (ppi?.startsWith('Pantoprazol')) {
    list.push({
      name: HARTONO_HOME.ppi,
      sig: 'diganti pantoprazol (interaksi klopidogrel)',
      change: 'dihentikan',
    });
  }
  if (rekon === 'stop') {
    list.push({ name: HARTONO_HOME.amlodipin, sig: 'TD terkontrol dengan bisoprolol', change: 'dihentikan' });
  }
  return list;
}

/** Resume Tn. Hartono: tiap bagian terisi saat sumbernya ada (triase, hasil, eMAR, himpun, rekonsiliasi, TTE). */
export function hartonoResume(R: RunResult): DischargeSummary {
  const p = patientByScenario('igd-ranap');
  const done = (step: string, task: string) => isDone(R, step, task);
  const himpun = done('resume', 'resume');
  const rekon = valueOf(R, 'resume', 'rekon');
  const akhir = done('rawat-inap', 'akhir');
  const [td, hr, rr, spo2] = parseTtv(R.rec.ttv);
  const fisik = R.rec.ttv
    ? `Masuk: TD ${td}, nadi ${hr}, napas ${rr}, SpO2 ${spo2}.${akhir ? ' Pulang: TD 124/78, nadi 68, SpO2 98%.' : ''}`
    : '';
  const base = R.def.startDate;
  const sections: ResumeSection[] = [
    {
      id: 'anamnesis',
      title: 'Alasan masuk dan anamnesis singkat',
      body: done('triase', 'level')
        ? `Nyeri dada kiri menjalar ke lengan 40 menit. ${R.rec.riwayat}. Triase ${R.rec.triase.toLowerCase()}.`
        : '',
      source: 'asesmen-igd',
    },
    { id: 'fisik', title: 'Pemeriksaan fisik penting', body: fisik, source: 'observasi' },
    {
      id: 'penunjang',
      title: 'Pemeriksaan penunjang',
      body: R.rec.hasil.length ? `${R.rec.hasil.join('. ')}.` : '',
      source: 'hasil',
    },
    {
      id: 'terapi',
      title: 'Terapi selama dirawat',
      body: done('rawat-inap', 'emar')
        ? 'Koreksi hiperkalemia (kalsium glukonat IV ± insulin–dekstrosa), antiplatelet ganda, enoksaparin, bisoprolol, atorvastatin; dicatat lewat pindai gelang eMAR.'
        : '',
      source: 'emar',
    },
    {
      id: 'obat-pulang',
      title: 'Obat pulang (hasil rekonsiliasi)',
      body: himpun ? 'Lihat daftar rekonsiliasi.' : '',
      source: 'rekonsiliasi',
    },
    {
      id: 'instruksi',
      title: 'Instruksi dan edukasi',
      body: himpun
        ? 'Minum antiplatelet ganda tanpa putus; diet rendah garam dan kalium; kembali ke IGD bila nyeri dada > 15 menit atau sesak.'
        : '',
      source: 'dpjp',
    },
    {
      id: 'tindak-lanjut',
      title: 'Tindak lanjut',
      body: R.rec.kontrol
        ? `Kontrol ${R.rec.kontrol} · ${STAF.dpjpJantung}. Angiografi koroner elektif dijadwalkan dari poli.`
        : himpun
          ? 'Kontrol Poli Jantung; surat kontrol terbit saat resume ditandatangani.'
          : '',
      source: 'surat-kontrol',
    },
  ];
  // Draf obat pulang sebelum rekonsiliasi = usulan "lanjutkan amlodipin"; keputusan DPJP lewat tugas `rekon`.
  const draft = [
    'Aspirin 80 mg 1×1',
    'Klopidogrel 75 mg 1×1',
    'Atorvastatin 40 mg 1×1 malam',
    'Bisoprolol 2,5 mg 1×1',
    R.rec.ppi ?? 'Pantoprazol 40 mg 1×1',
    'Amlodipin 10 mg 1×1',
  ];
  const meds = himpun ? hartonoDischargeMeds(rekon ? R.rec.obat : draft, R.rec.ppi, rekon) : [];
  const codes = [...coded(R.rec.dx, true), ...coded(R.rec.tindakan, false)];
  const filled = (id: string) => !!sections.find((s) => s.id === id)?.body;
  const signed = done('resume', 'tte');
  return {
    encounterId: p ? encounterIdOf(p.id) : 'kj-hartono',
    patientId: p?.id ?? 'ps-hartono',
    admittedAt: wib(simInstant(R.def, R.def.startMin)),
    dischargeAt: akhir ? taskInstant(R, 'rawat-inap', 'akhir', 1440) : `${shiftDays(base, 5)}T10:00:00+07:00`,
    admissionVia: 'IGD',
    dischargeMethod: 'Atas persetujuan dokter',
    condition: akhir ? 'Membaik' : 'Masih dirawat',
    location: isDone(R, 'rawat-inap', 'pindah') ? 'Anggrek A-12' : 'Ruang intensif',
    dpjp: STAF.dpjpJantung,
    sections,
    medications: meds,
    reconciliationConfirmedAt: rekon ? taskInstant(R, 'resume', 'rekon') : null,
    codes,
    checklist: resumeChecklist({
      ident: true,
      anamnesis: filled('anamnesis'),
      fisik: filled('fisik'),
      penunjang: filled('penunjang'),
      diagnosis: himpun && codes.some((c) => c.system === 'ICD-10'),
      prosedur: codes.some((c) => c.system === 'ICD-9-CM'),
      terapi: filled('terapi'),
      rekonsiliasi: !!rekon,
      edukasi: akhir,
      instruksi: filled('instruksi'),
      kontrol: himpun,
      kondisi: akhir,
    }),
    signedAt: signed ? taskInstant(R, 'resume', 'tte') : null,
    signedBy: signed ? STAF.dpjpJantung : null,
  };
}

function shiftDays(iso: string, days: number): string {
  const [y = 2026, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Resume Ny. Ratna: dihimpun dari asesmen pra-operasi, laporan operasi, CPPT, dan eMAR (tugas `resume.resume`). */
export function ratnaResume(R: RunResult): DischargeSummary {
  const p = patientByScenario('elektif-btn');
  const done = (step: string, task: string) => isDone(R, step, task);
  const admitted = done('admisi', 'sep');
  const op = done('operasi', 'op');
  const h2 = done('pasca-operasi', 'h2');
  const himpun = done('resume', 'resume');
  const signed = done('resume', 'tte');
  const sections: ResumeSection[] = [
    {
      id: 'anamnesis',
      title: 'Alasan masuk dan anamnesis singkat',
      body: admitted ? `${R.rec.riwayat}. Kolik bilier berulang 6 bulan, masuk untuk operasi elektif.` : '',
      source: 'cppt',
    },
    {
      id: 'fisik',
      title: 'Pemeriksaan fisik penting',
      body: admitted
        ? `Masuk: TD 118/76, nadi 78, SpO2 99%, nyeri tekan kuadran kanan atas ringan.${h2 ? ' Pulang: luka operasi kering, nyeri minimal.' : ''}`
        : '',
      source: 'observasi',
    },
    {
      id: 'penunjang',
      title: 'Pemeriksaan penunjang',
      body: admitted
        ? 'USG: batu kandung empedu multipel tanpa penebalan dinding. Hb 12,8 g/dL, leukosit 7.600 /µL.'
        : '',
      source: 'hasil',
    },
    {
      id: 'operasi',
      title: 'Tindakan operasi',
      body: op
        ? `Kolesistektomi laparoskopik oleh ${STAF.dpjpBedah}; tanpa penyulit, perdarahan minimal.`
        : '',
      source: 'laporan-operasi',
    },
    {
      id: 'terapi',
      title: 'Terapi selama dirawat',
      body: done('pasca-operasi', 'emar')
        ? 'Analgesik IV terjadwal, omeprazol, profilaksis antibiotik di kamar operasi; dicatat lewat pindai gelang eMAR.'
        : '',
      source: 'emar',
    },
    {
      id: 'obat-pulang',
      title: 'Obat pulang (hasil rekonsiliasi)',
      body: himpun ? 'Lihat daftar rekonsiliasi.' : '',
      source: 'rekonsiliasi',
    },
    {
      id: 'instruksi',
      title: 'Instruksi dan edukasi',
      body: himpun
        ? 'Jaga luka tetap kering 5 hari; diet rendah lemak bertahap; kembali bila demam, kuning, atau nyeri hebat.'
        : '',
      source: 'dpjp',
    },
    {
      id: 'tindak-lanjut',
      title: 'Tindak lanjut',
      body: R.rec.kontrol
        ? `Kontrol ${R.rec.kontrol} · ${STAF.dpjpBedah}.`
        : himpun
          ? 'Kontrol Poli Bedah; surat kontrol terbit saat resume ditandatangani.'
          : '',
      source: 'surat-kontrol',
    },
  ];
  const codes = [
    ...(R.rec.dx.length
      ? coded(R.rec.dx, true)
      : coded(['K80.2 · Batu kandung empedu tanpa kolesistitis'], true)),
    ...coded(R.rec.tindakan, false),
  ];
  const filled = (id: string) => !!sections.find((s) => s.id === id)?.body;
  return {
    encounterId: p ? encounterIdOf(p.id) : 'kj-ratna',
    patientId: p?.id ?? 'ps-ratna',
    admittedAt: admitted ? taskInstant(R, 'admisi', 'sep') : wib(simInstant(R.def, R.def.startMin)),
    dischargeAt: h2
      ? taskInstant(R, 'pasca-operasi', 'h2', 900)
      : `${shiftDays(R.def.startDate, 2)}T09:00:00+07:00`,
    admissionVia: 'Admisi elektif',
    dischargeMethod: 'Atas persetujuan dokter',
    condition: h2 ? 'Membaik' : 'Masih dirawat',
    location: ratnaBedCode(R) === 'VIP 3' ? 'Paviliun VIP 3' : 'Melati M-210',
    dpjp: STAF.dpjpBedah,
    sections,
    medications: himpun ? medsFrom(R.rec.obat) : [],
    reconciliationConfirmedAt: himpun ? taskInstant(R, 'resume', 'resume') : null,
    codes,
    checklist: resumeChecklist({
      ident: true,
      anamnesis: filled('anamnesis'),
      fisik: filled('fisik'),
      penunjang: filled('penunjang'),
      diagnosis: himpun,
      prosedur: codes.some((c) => c.system === 'ICD-9-CM'),
      terapi: filled('terapi'),
      rekonsiliasi: himpun,
      edukasi: h2,
      instruksi: filled('instruksi'),
      kontrol: himpun,
      kondisi: h2,
    }),
    signedAt: signed ? taskInstant(R, 'resume', 'tte') : null,
    signedBy: signed ? STAF.dpjpBedah : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Persetujuan tindakan pasien skenario
// ---------------------------------------------------------------------------------------------------------

/** Persetujuan Tn. Hartono: final setelah tugas `tata-laksana.consent` (tanda tangan + saksi + TTE di tablet). */
export function hartonoConsent(R: RunResult): ConsentDocument {
  const doc = hartonoConsentBase(taskInstant(R, 'tata-laksana', 'dispo'));
  return isDone(R, 'tata-laksana', 'consent')
    ? { ...doc, status: 'final', finalAt: taskInstant(R, 'tata-laksana', 'consent') }
    : doc;
}

/** Persetujuan operasi Ny. Ratna: ditandatangani saat admisi, final bersama SEP rawat inap. */
export function ratnaConsent(R: RunResult): ConsentDocument {
  const doc = ratnaConsentBase(wib(simInstant(R.def, R.def.startMin + 20)));
  return isDone(R, 'admisi', 'sep')
    ? { ...doc, status: 'final', finalAt: taskInstant(R, 'admisi', 'sep', -5) }
    : doc;
}
