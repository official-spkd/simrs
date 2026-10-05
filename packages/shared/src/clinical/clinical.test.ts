import { describe, expect, it } from 'vitest';
import { RESUME_CHECK_IDS } from '../schemas/rawat-inap';
import {
  findForbiddenAbbreviations,
  forbiddenAbbreviationSchema,
  SAMPLE_FORBIDDEN_ABBREVIATIONS,
} from './abbreviations';
import {
  type CdsAllergy,
  cdsBlocked,
  type CdsOrderItem,
  type CdsPatientContext,
  cdsRuleSchema,
  evaluateCdsItem,
  SAMPLE_CDS_RULES,
  SAMPLE_SUBSTANCE_CLASSES,
  topCdsFinding,
} from './cds';
import {
  EMAR_EARLY_WINDOW_MINUTES,
  emarIsLate,
  emarScheduleForDay,
  emarScheduleTimes,
  emarSlotState,
  wristbandScanValid,
} from './emar';
import { isLateEntry, nextVersion, occurredInFuture } from './entries';
import { ewsMaxParam, ewsNeedsEscalation, ewsParamScores, ewsRisk, ewsScore, type News2Input } from './ews';
import { RESUME_CHECK_LABEL, resumeChecklist, resumeCompleteness, type ResumeEvidence } from './resume';
import {
  ATS_TARGET_MINUTES,
  suggestTriage,
  TRIAGE_DEFAULT_LEVEL,
  triageBlockReason,
  type TriageInput,
  type TriageVitals,
} from './triage';

// ---------------------------------------------------------------------------------------------------------------
// CDS · golden dari angka demo (klinis-cds.test.ts web, mockup CPOE)
// ---------------------------------------------------------------------------------------------------------------

const drug = (
  id: string,
  substance: string,
  classes: string[],
  extra: Partial<CdsOrderItem> = {},
): CdsOrderItem => ({
  id,
  name: `${substance[0]?.toUpperCase()}${substance.slice(1)}`,
  kind: 'obat',
  substance,
  classes,
  coverage: 'fornas',
  ...extra,
});
const allergy = (label: string): CdsAllergy => {
  const substance = label.toLowerCase();
  return { label, substance, classes: SAMPLE_SUBSTANCE_CLASSES[substance] ?? [] };
};
const patient = (p: Partial<CdsPatientContext>): CdsPatientContext => ({
  allergies: [],
  activeMeds: [],
  flags: [],
  egfr: null,
  payer: 'BPJS',
  ...p,
});

/** Ny. Endang (mockup CPOE): alergi amoksisilin, metformin rutin. */
const endang = patient({
  allergies: [allergy('Amoksisilin')],
  activeMeds: [{ name: 'Metformin 500 mg · 2×1', substance: 'metformin', itemId: 'metformin-500' }],
});

describe('CDS · KB contoh', () => {
  it('golden: sefadroksil pada alergi amoksisilin diblokir (reaksi silang sefalosporin gen. 1)', () => {
    const f = evaluateCdsItem(
      drug('sefadroksil-500', 'sefadroksil', ['sefalosporin-1']),
      endang,
      SAMPLE_CDS_RULES,
    );
    expect(f[0]).toMatchObject({
      level: 'block',
      rule: 'alergi-silang',
      ruleCode: 'alergi-silang-penisilin-sefalosporin-1',
    });
    expect(f[0]?.message).toBe(
      'Diblokir: reaksi silang mungkin dengan alergi amoksisilin (beta-laktam). Pilih alternatif atau isi alasan klinis.',
    );
    expect(cdsBlocked(f)).toBe(true);
  });

  it('alergi zat sama dan golongan sama diblokir; sefalosporin gen. 3 hanya peringatan', () => {
    expect(
      evaluateCdsItem(drug('amoksisilin-500', 'amoksisilin', ['penisilin']), endang, SAMPLE_CDS_RULES)[0],
    ).toMatchObject({ level: 'block', rule: 'alergi', message: expect.stringMatching(/alergi amoksisilin/) });
    expect(
      evaluateCdsItem(drug('ampisilin-1g', 'ampisilin', ['penisilin']), endang, SAMPLE_CDS_RULES)[0],
    ).toMatchObject({ level: 'block', rule: 'alergi', ruleCode: 'bawaan:alergi-golongan' });
    expect(
      evaluateCdsItem(drug('seftriakson-2g', 'seftriakson', ['sefalosporin-3']), endang, SAMPLE_CDS_RULES)[0],
    ).toMatchObject({ level: 'warn', rule: 'alergi-silang' });
  });

  it('alergi teks bebas tanpa kode tetap dicocokkan dengan nama zat', () => {
    const p = patient({ allergies: [{ label: 'Kotrimoksazol (sulfa)', substance: null, classes: [] }] });
    expect(evaluateCdsItem(drug('kotri', 'kotrimoksazol', ['sulfonamid']), p, [])[0]).toMatchObject({
      level: 'block',
      rule: 'alergi',
    });
  });

  it('interaksi klopidogrel × omeprazol: obat rutin dan order lain di kiriman yang sama', () => {
    const hartono = patient({
      activeMeds: [{ name: 'Omeprazol 20 mg', substance: 'omeprazol', itemId: 'omeprazol-20' }],
      flags: ['ckd'],
    });
    const klop = drug('klopidogrel-75', 'klopidogrel', ['antiplatelet']);
    expect(evaluateCdsItem(klop, hartono, SAMPLE_CDS_RULES)[0]).toMatchObject({
      level: 'block',
      rule: 'interaksi',
      message: expect.stringMatching(/^Diblokir: interaksi dengan omeprazol: /),
    });
    expect(
      evaluateCdsItem(klop, patient({}), SAMPLE_CDS_RULES, { others: [{ substance: 'omeprazol' }] })[0]
        ?.level,
    ).toBe('block');
    expect(evaluateCdsItem(klop, patient({}), SAMPLE_CDS_RULES)).toEqual([]);
  });

  it('riwayat hipoglikemia berat + sulfonilurea diblokir; tanpa riwayat hanya interaksi dengan metformin', () => {
    const glim = drug('glimepirid-2', 'glimepirid', ['sulfonilurea']);
    const suryo = patient({ ...endang, allergies: [], flags: ['hipoglikemia-berat'] });
    expect(evaluateCdsItem(glim, suryo, SAMPLE_CDS_RULES)[0]).toMatchObject({
      level: 'block',
      rule: 'riwayat',
    });
    expect(evaluateCdsItem(glim, { ...suryo, flags: [] }, SAMPLE_CDS_RULES)[0]).toMatchObject({
      level: 'warn',
      rule: 'interaksi',
    });
  });

  it('dosis ginjal: metformin eGFR < 30 diblokir, eGFR 45 tidak', () => {
    const met = drug('metformin-1000', 'metformin', ['biguanid']);
    expect(evaluateCdsItem(met, patient({ egfr: 24 }), SAMPLE_CDS_RULES)[0]).toMatchObject({
      level: 'block',
      rule: 'ginjal',
      ruleCode: 'ginjal-metformin-egfr-30',
    });
    expect(evaluateCdsItem(met, patient({ egfr: 45 }), SAMPLE_CDS_RULES)).toEqual([]);
  });

  it('duplikasi lab dalam 24 jam = peringatan; di luar jendela tidak', () => {
    const hb: CdsOrderItem = { ...drug('hb', 'x', []), kind: 'lab', substance: null };
    const now = '2026-10-05T10:00:00+07:00';
    const recent = (orderedAt: string) =>
      patient({ recentOrders: [{ itemId: 'hb', kind: 'lab', orderedAt }] });
    expect(
      evaluateCdsItem(hb, recent('2026-10-05T06:00:00+07:00'), SAMPLE_CDS_RULES, { now })[0],
    ).toMatchObject({
      level: 'warn',
      rule: 'duplikasi',
    });
    expect(evaluateCdsItem(hb, recent('2026-10-03T06:00:00+07:00'), SAMPLE_CDS_RULES, { now })).toEqual([]);
  });

  it('dosis berubah dari obat rutin, di luar paket, singkatan terlarang: peringatan', () => {
    const siti = patient({
      activeMeds: [{ name: 'Amlodipin 5 mg', substance: 'amlodipin', itemId: 'amlodipin-5' }],
    });
    const aml10 = drug('amlodipin-10', 'amlodipin', ['ccb'], {
      coverage: 'tidak-ditanggung',
      instructions: '10 mg QD pagi',
    });
    const f = evaluateCdsItem(aml10, siti, SAMPLE_CDS_RULES, {
      abbreviations: SAMPLE_FORBIDDEN_ABBREVIATIONS,
    });
    expect(f.map((x) => x.rule)).toEqual(['dosis', 'biaya', 'singkatan']);
    expect(f.every((x) => x.level === 'warn')).toBe(true);
    // Pasien umum membayar sendiri: tanpa temuan biaya; penjamin belum diketahui juga tanpa temuan.
    expect(evaluateCdsItem(aml10, { ...siti, payer: 'Umum' }, []).map((x) => x.rule)).toEqual(['dosis']);
    expect(evaluateCdsItem(aml10, { ...siti, payer: null }, []).map((x) => x.rule)).toEqual(['dosis']);
  });

  it('temuan teratas: paling berat; tanpa temuan = info aman berisi catatan (lanjutan obat rutin berawalan)', () => {
    expect(topCdsFinding([], { note: 'Aman.', continuation: false })).toEqual({
      level: 'info',
      rule: 'aman',
      message: 'Aman.',
    });
    expect(topCdsFinding([], { note: 'Aman.', continuation: true }).message).toBe(
      'Lanjutan obat rutin. Aman.',
    );
  });

  it('KB contoh valid terhadap skema aturan; aturan rusak ditolak', () => {
    for (const r of SAMPLE_CDS_RULES) expect(cdsRuleSchema.safeParse(r).success, r.code).toBe(true);
    expect(new Set(SAMPLE_CDS_RULES.map((r) => r.code)).size).toBe(SAMPLE_CDS_RULES.length);
    expect(
      cdsRuleSchema.safeParse({
        code: 'x-1',
        definition: { kind: 'renal', target: { substance: 'Metformin!' } },
      }).success,
    ).toBe(false);
    expect(
      cdsRuleSchema.safeParse({
        code: 'jenis-asing',
        definition: { kind: 'eval', level: 'block', message: 'kode bebas tidak boleh' },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// NEWS2 · golden dari observasi pasien rawat inap demo
// ---------------------------------------------------------------------------------------------------------------

const obs = (
  temp: number,
  hr: number,
  rr: number,
  sbp: number,
  spo2: number,
  onOxygen: boolean,
  consciousness: News2Input['consciousness'],
): News2Input => ({ temp, hr, rr, sbp, spo2, onOxygen, consciousness });

describe('NEWS2', () => {
  it.each([
    // [suhu, nadi, napas, TD sistolik, SpO2, O2, kesadaran] → skor, parameter tertinggi
    [obs(37.6, 92, 22, 128, 95, false, 'A'), 4, 2],
    [obs(37.9, 104, 18, 112, 95, true, 'V'), 7, 3],
    [obs(38.4, 112, 24, 96, 93, true, 'A'), 11, 2],
    [obs(38.2, 108, 22, 98, 98, false, 'A'), 6, 2],
    [obs(36.7, 82, 18, 152, 97, false, 'A'), 0, 0],
  ] as const)('golden demo %#', (o, score, maxParam) => {
    expect(ewsScore(o)).toBe(score);
    expect(ewsMaxParam(o)).toBe(maxParam);
  });

  it('batas pita persis NEWS2 (napas 8/9, 20/21, 24/25; SpO2 91/92; TD 90/91, 219/220; suhu 35/35,1)', () => {
    const base = obs(37, 70, 16, 120, 97, false, 'A');
    const rr = (v: number) => ewsParamScores({ ...base, rr: v })[0];
    expect([rr(8), rr(9), rr(11), rr(12), rr(20), rr(21), rr(24), rr(25)]).toEqual([3, 1, 1, 0, 0, 2, 2, 3]);
    const sp = (v: number) => ewsParamScores({ ...base, spo2: v })[1];
    expect([sp(91), sp(92), sp(93), sp(94), sp(95), sp(96)]).toEqual([3, 2, 2, 1, 1, 0]);
    const bp = (v: number) => ewsParamScores({ ...base, sbp: v })[3];
    expect([bp(90), bp(91), bp(100), bp(101), bp(110), bp(111), bp(219), bp(220)]).toEqual([
      3, 2, 2, 1, 1, 0, 0, 3,
    ]);
    const t = (v: number) => ewsParamScores({ ...base, temp: v })[6];
    expect([t(35), t(35.1), t(36), t(36.1), t(38), t(38.1), t(39), t(39.1)]).toEqual([
      3, 1, 1, 0, 0, 1, 1, 2,
    ]);
  });

  it('risiko: ≥ 7 tinggi, 5–6 sedang, satu parameter 3 minimal sedang; eskalasi sesuai ambang RS', () => {
    expect(ewsRisk(7).level).toBe('tinggi');
    expect(ewsRisk(5).level).toBe('sedang');
    expect(ewsRisk(3, 3).level).toBe('sedang');
    expect(ewsRisk(4, 2).level).toBe('rendah');
    expect(ewsNeedsEscalation(5, 2, 5)).toBe(true);
    expect(ewsNeedsEscalation(4, 2, 5)).toBe(false);
    expect(ewsNeedsEscalation(3, 3, 5)).toBe(true);
    expect(ewsNeedsEscalation(5, 2, 6)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Saran triase ATS · golden dari papan IGD demo (level yang ditetapkan di fixture)
// ---------------------------------------------------------------------------------------------------------------

const v = (p: Partial<TriageVitals>): TriageVitals => ({
  sbp: null,
  dbp: null,
  hr: null,
  rr: null,
  spo2: null,
  temp: null,
  gcs: null,
  ...p,
});

describe('saran triase ATS', () => {
  const golden: Array<[string, TriageInput, number, number]> = [
    [
      'R1 Tn. X trauma, GCS 8, napas 8',
      {
        vitals: v({ sbp: 90, dbp: 60, hr: 124, rr: 8, spo2: 91, temp: 36.2, gcs: 8 }),
        discriminators: ['trauma_mayor'],
        ageYears: null,
      },
      1,
      5,
    ],
    [
      'B3 stroke < 4,5 jam',
      {
        vitals: v({ sbp: 186, dbp: 104, hr: 92, rr: 20, spo2: 97, temp: 36.7, gcs: 14 }),
        discriminators: ['defisit_neurologis_akut'],
        ageYears: 65,
      },
      2,
      5,
    ],
    [
      'B4 anak 4 th demam + muntah',
      {
        vitals: v({ sbp: 90, dbp: 60, hr: 132, rr: 28, spo2: 98, temp: 38.9, gcs: 15 }),
        discriminators: ['muntah_dehidrasi'],
        ageYears: 4,
      },
      3,
      5,
    ],
    [
      'B5 nyeri perut sedang',
      {
        vitals: v({ sbp: 132, dbp: 84, hr: 96, rr: 20, spo2: 98, temp: 37.9, gcs: 15 }),
        discriminators: ['nyeri_sedang'],
        ageYears: 52,
      },
      3,
      5,
    ],
    [
      'B6 cedera lutut ringan',
      {
        vitals: v({ sbp: 138, dbp: 88, hr: 88, rr: 18, spo2: 99, temp: 36.9, gcs: 15 }),
        discriminators: ['cedera_ringan'],
        ageYears: 46,
      },
      4,
      5,
    ],
    [
      'B7 nyeri ulu hati ringan',
      {
        vitals: v({ sbp: 124, dbp: 80, hr: 84, rr: 18, spo2: 99, temp: 36.8, gcs: 15 }),
        discriminators: ['nyeri_ringan'],
        ageYears: 49,
      },
      4,
      5,
    ],
    [
      'B8 sesak, SpO2 93',
      {
        vitals: v({ sbp: 150, dbp: 92, hr: 104, rr: 24, spo2: 93, temp: 36.9, gcs: 15 }),
        discriminators: ['sesak_sedang'],
        ageYears: 63,
      },
      3,
      5,
    ],
    [
      'K1 batuk pilek',
      {
        vitals: v({ sbp: 118, dbp: 76, hr: 82, rr: 18, spo2: 98, temp: 37.4, gcs: 15 }),
        discriminators: ['keluhan_ringan'],
        ageYears: 30,
      },
      5,
      5,
    ],
    [
      'Tn. Hartono nyeri dada khas (skenario IGD): saran 2, protokol paling rendah 3',
      // Skenario IGD → ranap, tugas "Tanda vital": 158/94 · 112 · 24 · 94%.
      {
        vitals: v({ sbp: 158, dbp: 94, hr: 112, rr: 24, spo2: 94 }),
        discriminators: ['nyeri_dada_kardiak'],
        ageYears: 61,
      },
      2,
      3,
    ],
  ];

  it.each(golden)('%s', (_label, input, level, maxLevel) => {
    const s = suggestTriage(input);
    expect(s.level).toBe(level);
    expect(s.maxLevel).toBe(maxLevel);
    expect(s.reasons.length).toBeGreaterThan(0);
  });

  it('tanpa kriteria apa pun: semi-urgen (bukan tidak urgen diam-diam); alasan diurut paling mendesak', () => {
    expect(suggestTriage({ vitals: v({}), discriminators: [], ageYears: 30 }).level).toBe(
      TRIAGE_DEFAULT_LEVEL,
    );
    const r = suggestTriage({
      vitals: v({ gcs: 8, spo2: 93 }),
      discriminators: ['nyeri_ringan'],
      ageYears: 30,
    });
    expect(r.reasons[0]).toMatch(/^Level 1: GCS 8/);
    expect(ATS_TARGET_MINUTES).toEqual({ 1: 0, 2: 10, 3: 30, 4: 60, 5: 120 });
  });

  it('gerbang: turun dari saran wajib alasan ≥ 10; di bawah batas protokol ditolak; naik bebas', () => {
    const s = { level: 2 as const, maxLevel: 3 as const };
    expect(triageBlockReason(s, 3, '', 10)).toBe('TRIAGE_REASON_REQUIRED');
    expect(triageBlockReason(s, 3, 'Nyeri sudah hilang, EKG normal', 10)).toBeNull();
    expect(triageBlockReason(s, 4, 'Nyeri sudah hilang, EKG normal', 10)).toBe('TRIAGE_LEVEL_NOT_ALLOWED');
    expect(triageBlockReason(s, 1, null, 10)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Resume, eMAR, singkatan, entri berversi
// ---------------------------------------------------------------------------------------------------------------

const evidence: ResumeEvidence = {
  identityComplete: true,
  anamnesis: 'Demam dan batuk 3 hari',
  physicalOnAdmission: 'Ronki basah kanan bawah',
  physicalOnDischarge: 'Ronki berkurang',
  importantResults: 'Leukosit 16.200 → 8.900',
  primaryDiagnosisCoded: true,
  uncodedSecondaryDiagnoses: 0,
  uncodedProcedures: 0,
  therapySummary: 'Seftriakson 2 g IV H1–H5',
  reconciliationConfirmed: true,
  education: 'Edukasi inhaler dan tanda bahaya',
  dischargeInstructions: 'Kembali bila sesak',
  followUp: 'Kontrol Poli Paru 12 Okt',
  dischargeCondition: 'Membaik',
  dischargeMethod: 'Atas persetujuan DPJP',
};

describe('kelengkapan resume (12 butir)', () => {
  it('lengkap bila semua bukti ada; label 12 butir tetap urut', () => {
    expect(Object.keys(RESUME_CHECK_LABEL)).toEqual([...RESUME_CHECK_IDS]);
    const c = resumeCompleteness(resumeChecklist(evidence));
    expect(c).toMatchObject({ done: 12, total: 12, complete: true, missing: [] });
  });

  it('golden demo Ny. Endang sebelum rekonsiliasi: 10/12 (rekonsiliasi + kontrol belum)', () => {
    const c = resumeCompleteness(
      resumeChecklist({ ...evidence, reconciliationConfirmed: false, followUp: '  ' }),
    );
    expect(c.done).toBe(10);
    expect(c.missingIds).toEqual(['rekonsiliasi', 'kontrol']);
    expect(c.missing).toEqual([
      'rekonsiliasi obat pulang dikonfirmasi dpjp',
      'jadwal kontrol dan surat kontrol',
    ]);
  });

  it('diagnosis sekunder atau prosedur tanpa kode menahan TTE; butir yang tidak ada dianggap belum', () => {
    expect(
      resumeCompleteness(resumeChecklist({ ...evidence, uncodedSecondaryDiagnoses: 1 })).missingIds,
    ).toEqual(['diagnosis']);
    expect(resumeCompleteness(resumeChecklist({ ...evidence, uncodedProcedures: 2 })).missingIds).toEqual([
      'prosedur',
    ]);
    expect(resumeCompleteness([{ id: 'ident', done: true }]).done).toBe(1);
  });
});

describe('eMAR', () => {
  it('jam dari frekuensi (WIB), jam khusus order menang, jam rusak ditolak', () => {
    expect(emarScheduleTimes('3x1')).toEqual(['06.00', '14.00', '22.00']);
    expect(emarScheduleTimes('2x1')).toEqual(['06.00', '18.00']);
    expect(emarScheduleTimes('prn')).toEqual([]);
    expect(emarScheduleTimes('1x1_pagi', ['22.00'])).toEqual(['22.00']);
    expect(() => emarScheduleTimes('1x1_pagi', ['24.00'])).toThrow(RangeError);
  });

  it('instan jadwal = jam WIB (UTC+7), dosis sebelum order aktif tidak dibentuk', () => {
    const days = emarScheduleForDay('2026-10-05', ['06.00', '14.00', '22.00'], '2026-10-05T10:00:00+07:00');
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-10-05T07:00:00.000Z',
      '2026-10-05T15:00:00.000Z',
    ]);
  });

  it('status slot: rencana → jadwal (jendela 60 menit sebelum) → terlambat; catatan pemberian menang', () => {
    const scheduledAt = '2026-10-05T12:00:00+07:00';
    const at = (hm: string) => `2026-10-05T${hm}:00+07:00`;
    const st = (now: string, administration: { status: 'given' | 'held' | 'refused' } | null = null) =>
      emarSlotState({ scheduledAt, now, administration, lateMinutes: 60 });
    expect(EMAR_EARLY_WINDOW_MINUTES).toBe(60);
    expect(st(at('10:59'))).toBe('rencana');
    expect(st(at('11:00'))).toBe('jadwal');
    expect(st(at('13:00'))).toBe('jadwal');
    expect(st(at('13:01'))).toBe('terlambat');
    expect(st(at('13:30'), { status: 'given' })).toBe('diberikan');
    expect(st(at('12:00'), { status: 'held' })).toBe('ditunda');
    expect(st(at('12:00'), { status: 'refused' })).toBe('ditolak');
    expect(emarIsLate(scheduledAt, at('13:01'), 60)).toBe(true);
    expect(emarIsLate(scheduledAt, at('12:59'), 60)).toBe(false);
  });

  it('pindaian gelang berlaku 10 menit untuk perawat dan kunjungan yang sama, hanya bila cocok', () => {
    const scan = { matched: true, encounterId: 'e1', userId: 'u1', scannedAt: '2026-10-05T12:00:00Z' };
    const use = { encounterId: 'e1', userId: 'u1', at: '2026-10-05T12:10:00Z' };
    expect(wristbandScanValid(scan, use, 10)).toBe(true);
    expect(wristbandScanValid(scan, { ...use, at: '2026-10-05T12:10:01Z' }, 10)).toBe(false);
    expect(wristbandScanValid(scan, { ...use, userId: 'u2' }, 10)).toBe(false);
    expect(wristbandScanValid(scan, { ...use, encounterId: 'e2' }, 10)).toBe(false);
    expect(wristbandScanValid({ ...scan, matched: false }, use, 10)).toBe(false);
  });
});

describe('singkatan terlarang', () => {
  const find = (t: string) =>
    findForbiddenAbbreviations(t, SAMPLE_FORBIDDEN_ABBREVIATIONS).map((m) => m.found);

  it('token utuh peka huruf besar, termasuk menempel angka (10U)', () => {
    expect(find('Insulin 10 U SC, metformin 500 mg QD')).toEqual(['U', 'QD']);
    expect(find('Insulin 10U malam')).toEqual(['U']);
    expect(find('Unit, QID, QRS 120 ms, MgSO4 drip')).toEqual(['MgSO4']);
    expect(find('Q.D. pagi')).toEqual(['Q.D.']);
  });

  it('nol di belakang koma dan tanpa nol di depan koma', () => {
    expect(find('warfarin 1,0 mg dan digoksin ,25 mg')).toEqual(['1,0 mg', ',25 mg']);
    expect(find('warfarin 1 mg, digoksin 0,25 mg, mual, 2 kali')).toEqual([]);
  });

  it('daftar contoh valid; pola regex rusak ditolak skema', () => {
    for (const a of SAMPLE_FORBIDDEN_ABBREVIATIONS) {
      expect(forbiddenAbbreviationSchema.safeParse(a).success, a.term).toBe(true);
    }
    expect(
      forbiddenAbbreviationSchema.safeParse({ kind: 'pattern', term: '(', suggestion: 'x' }).success,
    ).toBe(false);
  });
});

describe('entri klinis berversi', () => {
  it('entri terlambat bila catat > batas jam sesudah kejadian; kejadian di masa depan > 5 menit tidak sah', () => {
    expect(isLateEntry('2026-10-04T08:00:00Z', '2026-10-05T08:00:01Z', 24)).toBe(true);
    expect(isLateEntry('2026-10-04T08:00:00Z', '2026-10-05T08:00:00Z', 24)).toBe(false);
    expect(occurredInFuture('2026-10-05T08:06:00Z', '2026-10-05T08:00:00Z')).toBe(true);
    expect(occurredInFuture('2026-10-05T08:04:00Z', '2026-10-05T08:00:00Z')).toBe(false);
  });

  it('versi berikutnya = pendahulu + 1, akar tetap', () => {
    expect(nextVersion({ id: 'b', rootId: 'a', version: 2 })).toEqual({
      rootId: 'a',
      version: 3,
      supersedesId: 'b',
    });
  });
});
