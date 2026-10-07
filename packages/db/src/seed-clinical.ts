import {
  type CdsRuleDefinition,
  ewsMaxParam,
  ewsScore,
  MORSE_FALL_SCALE,
  newId,
  SAMPLE_CDS_RULES,
  SAMPLE_FORBIDDEN_ABBREVIATIONS,
  SAMPLE_SUBSTANCE_CLASSES,
} from '@simrs/shared';
import { withTenant, type PrismaClient, type TenantTx } from './client';
import type { Prisma } from './generated/prisma/client';

/**
 * Fase 3 · potongan 3.0c · Seed klinis fiktif per RS: status bed awal, zat aktif + obat + item order dari katalog demo
 * CPOE, 4 order set, KB CDS contoh, daftar singkatan "Do Not Use", diagnosis keperawatan lokal, paket formulir
 * RJ/IGD/RI, dan riwayat klinis fiktif beberapa pasien seed. Kode baku HANYA dari `SEED_REF_SAMPLES` (KFA, LOINC,
 * ICD-9-CM); item tanpa kode di sana disimpan "belum dipetakan" (kode null). Idempoten (upsert per kode, entri riwayat
 * per nomor kunjungan tetap).
 */

/** Zat aktif: [kode, nama, golongan]. Golongan alergen sama dengan `SAMPLE_SUBSTANCE_CLASSES` (mesin CDS). */
export const SEED_SUBSTANCES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['amoksisilin', 'Amoksisilin', ['penisilin']],
  ['ampisilin', 'Ampisilin', ['penisilin']],
  ['sefadroksil', 'Sefadroksil', ['sefalosporin-1']],
  ['seftriakson', 'Seftriakson', ['sefalosporin-3']],
  ['klindamisin', 'Klindamisin', ['linkosamid']],
  ['azitromisin', 'Azitromisin', ['makrolid']],
  ['kotrimoksazol', 'Kotrimoksazol', ['sulfonamid']],
  ['parasetamol', 'Parasetamol', ['analgesik']],
  ['ibuprofen', 'Ibuprofen', ['ains']],
  ['asam mefenamat', 'Asam mefenamat', ['ains']],
  ['metformin', 'Metformin', ['biguanid']],
  ['glimepirid', 'Glimepirid', ['sulfonilurea']],
  ['insulin glargine', 'Insulin glargine', ['insulin']],
  ['amlodipin', 'Amlodipin', ['ccb']],
  ['bisoprolol', 'Bisoprolol', ['beta-bloker']],
  ['atorvastatin', 'Atorvastatin', ['statin']],
  ['klopidogrel', 'Klopidogrel', ['antiplatelet']],
  ['asetosal', 'Asetosal', ['antiplatelet']],
  ['omeprazol', 'Omeprazol', ['ppi']],
  ['pantoprazol', 'Pantoprazol', ['ppi']],
  ['enoksaparin', 'Enoksaparin', ['antikoagulan']],
];

interface SeedDrug {
  name: string;
  substance: string;
  dosageForm: string;
  strength: string;
  /** Hanya kode KFA yang ada di `SEED_REF_SAMPLES`; selain itu null (belum dipetakan). */
  kfa: string | null;
  fornas: boolean;
  highAlert: boolean;
  coverage: 'ditanggung' | 'fornas' | 'tidak-ditanggung';
}

const drug = (
  name: string,
  substance: string,
  dosageForm: string,
  strength: string,
  over: Partial<SeedDrug> = {},
): SeedDrug => ({
  name,
  substance,
  dosageForm,
  strength,
  kfa: null,
  fornas: true,
  highAlert: false,
  coverage: 'fornas',
  ...over,
});

/** Obat dari katalog demo CPOE (mockup CPOE, mode presentasi). */
export const SEED_DRUGS: readonly SeedDrug[] = [
  drug('Amoksisilin 500 mg kapsul', 'amoksisilin', 'kapsul', '500 mg'),
  drug('Sefadroksil 500 mg kapsul', 'sefadroksil', 'kapsul', '500 mg'),
  drug('Seftriakson 2 g injeksi', 'seftriakson', 'injeksi', '2 g'),
  drug('Klindamisin 300 mg kapsul', 'klindamisin', 'kapsul', '300 mg'),
  drug('Azitromisin 500 mg tablet', 'azitromisin', 'tablet', '500 mg'),
  drug('Parasetamol 500 mg tablet', 'parasetamol', 'tablet', '500 mg'),
  drug('Parasetamol 1 g infus', 'parasetamol', 'infus', '1 g'),
  drug('Ibuprofen 400 mg tablet', 'ibuprofen', 'tablet', '400 mg'),
  drug('Asam mefenamat 500 mg tablet', 'asam mefenamat', 'tablet', '500 mg'),
  drug('Metformin 500 mg tablet', 'metformin', 'tablet', '500 mg'),
  drug('Metformin 1000 mg tablet', 'metformin', 'tablet', '1000 mg', {
    fornas: false,
    coverage: 'ditanggung',
  }),
  drug('Glimepirid 2 mg tablet', 'glimepirid', 'tablet', '2 mg'),
  drug('Insulin glargine 100 unit/mL pen', 'insulin glargine', 'injeksi', '100 unit/mL', { highAlert: true }),
  drug('Amlodipin 5 mg tablet', 'amlodipin', 'tablet', '5 mg'),
  drug('Amlodipin 10 mg tablet', 'amlodipin', 'tablet', '10 mg'),
  drug('Bisoprolol 2,5 mg tablet', 'bisoprolol', 'tablet', '2,5 mg', { kfa: '93000655' }),
  drug('Atorvastatin 20 mg tablet', 'atorvastatin', 'tablet', '20 mg'),
  drug('Atorvastatin 40 mg tablet', 'atorvastatin', 'tablet', '40 mg', { kfa: '93000914' }),
  drug('Klopidogrel 75 mg tablet', 'klopidogrel', 'tablet', '75 mg', { kfa: '93000387' }),
  drug('Asetosal 160 mg tablet kunyah', 'asetosal', 'tablet kunyah', '160 mg'),
  drug('Omeprazol 20 mg kapsul', 'omeprazol', 'kapsul', '20 mg'),
  drug('Omeprazol 40 mg injeksi', 'omeprazol', 'injeksi', '40 mg', { kfa: '93001152' }),
  drug('Pantoprazol 40 mg tablet', 'pantoprazol', 'tablet', '40 mg', {
    fornas: false,
    coverage: 'tidak-ditanggung',
  }),
  drug('Enoksaparin 60 mg/0,6 mL injeksi', 'enoksaparin', 'injeksi', '60 mg/0,6 mL', {
    kfa: '93002210',
    highAlert: true,
  }),
];

type OrderableKind = 'lab' | 'radiologi' | 'tindakan' | 'kontrol';

/** Item order: [jenis, nama, sistem kode, kode, unit tujuan]. Kode hanya dari `SEED_REF_SAMPLES`. */
export const SEED_ORDERABLES: ReadonlyArray<
  readonly [OrderableKind, string, 'loinc' | 'icd9cm' | null, string | null, string | null]
> = [
  ['lab', 'Darah lengkap', null, null, 'LAB'],
  ['lab', 'Hemoglobin', 'loinc', '718-7', 'LAB'],
  ['lab', 'Leukosit', 'loinc', '6690-2', 'LAB'],
  ['lab', 'Trombosit', 'loinc', '777-3', 'LAB'],
  ['lab', 'Glukosa sewaktu', 'loinc', '2345-7', 'LAB'],
  ['lab', 'HbA1c', 'loinc', '4548-4', 'LAB'],
  ['lab', 'Kreatinin', 'loinc', '2160-0', 'LAB'],
  ['lab', 'Ureum', 'loinc', '3094-0', 'LAB'],
  ['lab', 'Kalium', 'loinc', '2823-3', 'LAB'],
  ['lab', 'Natrium', 'loinc', '2951-2', 'LAB'],
  ['lab', 'Troponin I', 'loinc', '10839-9', 'LAB'],
  ['lab', 'CRP', 'loinc', '1988-5', 'LAB'],
  ['lab', 'Kolesterol total', 'loinc', '2093-3', 'LAB'],
  ['lab', 'Golongan darah ABO', 'loinc', '883-9', 'LAB'],
  ['radiologi', 'Foto toraks', null, null, 'RAD'],
  ['radiologi', 'CT scan kepala', 'icd9cm', '87.03', 'RAD'],
  ['radiologi', 'USG abdomen', 'icd9cm', '88.76', 'RAD'],
  ['tindakan', 'EKG 12 sadapan', 'icd9cm', '89.52', null],
  ['tindakan', 'Ekokardiografi', 'icd9cm', '88.72', null],
  ['kontrol', 'Kontrol poli', null, null, null],
];

/** Order set institusi: [kode, nama, item (nama orderable atau obat)]. */
export const SEED_ORDER_SETS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  [
    'ska-awal',
    'Sindrom koroner akut · order awal IGD',
    [
      'EKG 12 sadapan',
      'Troponin I',
      'Darah lengkap',
      'Kalium',
      'Kreatinin',
      'Asetosal 160 mg tablet kunyah',
      'Klopidogrel 75 mg tablet',
    ],
  ],
  [
    'dm-kontrol',
    'Diabetes melitus tipe 2 · kontrol rutin',
    ['Glukosa sewaktu', 'HbA1c', 'Kreatinin', 'Metformin 500 mg tablet'],
  ],
  [
    'pra-operasi',
    'Pra-operasi elektif dewasa',
    [
      'Darah lengkap',
      'Golongan darah ABO',
      'Glukosa sewaktu',
      'Kreatinin',
      'Natrium',
      'Kalium',
      'EKG 12 sadapan',
      'Foto toraks',
    ],
  ],
  ['demam-anak', 'Demam pada anak · IGD', ['Darah lengkap', 'CRP', 'Parasetamol 500 mg tablet']],
];

/** Diagnosis keperawatan master lokal (tanpa kode resmi, keputusan fase 3 no. 15). */
export const SEED_NURSING_DIAGNOSES: ReadonlyArray<readonly [string, string]> = [
  ['risiko-jatuh', 'Risiko jatuh'],
  ['nyeri-akut', 'Nyeri akut'],
  ['bersihan-jalan-napas', 'Bersihan jalan napas tidak efektif'],
  ['hipertermia', 'Hipertermia'],
  ['ketidakstabilan-glukosa', 'Ketidakstabilan kadar glukosa darah'],
  ['risiko-infeksi', 'Risiko infeksi'],
];

/** Paket formulir per setting (EP 6b/7a). Hanya formulir yang terpasang di seed (Morse v1). */
export const SEED_FORM_PACKAGES: ReadonlyArray<
  readonly ['rawat_jalan' | 'igd' | 'rawat_inap', string, boolean]
> = [
  ['rawat_jalan', MORSE_FALL_SCALE.code, false],
  ['igd', MORSE_FALL_SCALE.code, true],
  ['rawat_inap', MORSE_FALL_SCALE.code, true],
];

/**
 * Flag riwayat KB contoh (`SAMPLE_CDS_RULES`, juga dipakai mode presentasi) → token diagnosis yang dihasilkan API dari
 * diagnosis ICD-10 aktif (ADR-0030: `icd10-<kategori>`). Hanya kode yang ada di `SEED_REF_SAMPLES` (N18 = penyakit
 * ginjal kronik); flag tanpa padanan kode contoh (`hipoglikemia-berat`) tetap apa adanya sampai KB RS menulisnya.
 */
const SEED_HISTORY_FLAG_TOKENS: Readonly<Record<string, string>> = { ckd: 'icd10-n18' };

function seedRuleDefinition(d: CdsRuleDefinition): CdsRuleDefinition {
  return d.kind === 'history' ? { ...d, flag: SEED_HISTORY_FLAG_TOKENS[d.flag] ?? d.flag } : d;
}

export interface SeedClinicalResult {
  beds: number;
  drugs: number;
  orderables: number;
  orderSets: number;
  cdsRules: number;
}

/** Master klinis satu RS (di dalam `withTenant`; struktur RS dan form Morse sudah di-seed). */
export async function seedClinicalMasters(tx: TenantTx, tenantId: string): Promise<SeedClinicalResult> {
  const result: SeedClinicalResult = { beds: 0, drugs: 0, orderables: 0, orderSets: 0, cdsRules: 0 };

  // K05 · Status awal setiap bed: siap.
  const beds = await tx.location.findMany({ where: { kind: 'bed' }, select: { id: true, unitId: true } });
  const withStatus = new Set(
    (await tx.bedStatus.findMany({ select: { locationId: true } })).map((b) => b.locationId),
  );
  for (const b of beds) {
    if (withStatus.has(b.id)) continue;
    await tx.bedStatus.create({ data: { id: newId(), tenantId, locationId: b.id, unitId: b.unitId } });
    result.beds += 1;
  }

  const substances = new Map<string, string>();
  for (const [code, name, classes] of SEED_SUBSTANCES) {
    // Golongan alergen mesin CDS (SAMPLE_SUBSTANCE_CLASSES) menang bila ada: satu sumber kebenaran.
    const row = await tx.drugSubstance.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: {
        id: newId(),
        tenantId,
        code,
        name,
        classes: [...(SAMPLE_SUBSTANCE_CLASSES[code] ?? classes)],
      },
    });
    substances.set(code, row.id);
  }

  const drugs = new Map<string, string>();
  for (const d of SEED_DRUGS) {
    const existing = await tx.drug.findUnique({ where: { tenantId_name: { tenantId, name: d.name } } });
    const row =
      existing ??
      (await tx.drug.create({
        data: {
          id: newId(),
          tenantId,
          name: d.name,
          substanceId: substances.get(d.substance) ?? null,
          codeSystem: d.kfa ? 'kfa' : null,
          code: d.kfa,
          dosageForm: d.dosageForm,
          strength: d.strength,
          fornas: d.fornas,
          highAlert: d.highAlert,
          coverage: d.coverage,
          keywords: `${d.substance} ${d.name}`.toLowerCase(),
        },
      }));
    if (!existing) result.drugs += 1;
    drugs.set(d.name, row.id);
  }

  const units = new Map(
    (await tx.unit.findMany({ select: { id: true, code: true } })).map((u) => [u.code, u.id]),
  );
  const orderables = new Map<string, string>();
  for (const [kind, name, codeSystem, code, unitCode] of SEED_ORDERABLES) {
    const existing = await tx.orderable.findUnique({
      where: { tenantId_kind_name: { tenantId, kind, name } },
    });
    const row =
      existing ??
      (await tx.orderable.create({
        data: {
          id: newId(),
          tenantId,
          kind,
          name,
          codeSystem,
          code,
          unitId: unitCode ? (units.get(unitCode) ?? null) : null,
          keywords: name.toLowerCase(),
        },
      }));
    if (!existing) result.orderables += 1;
    orderables.set(name, row.id);
  }

  for (const [code, name, items] of SEED_ORDER_SETS) {
    if (await tx.orderSet.findUnique({ where: { tenantId_code: { tenantId, code } } })) continue;
    const set = await tx.orderSet.create({ data: { id: newId(), tenantId, code, name } });
    let sortOrder = 0;
    for (const item of items) {
      const orderableId = orderables.get(item) ?? null;
      const drugId = orderableId ? null : (drugs.get(item) ?? null);
      if (!orderableId && !drugId) throw new Error(`Item order set ${code} tidak dikenal: ${item}`);
      await tx.orderSetItem.create({
        data: { id: newId(), tenantId, orderSetId: set.id, orderableId, drugId, sortOrder: sortOrder++ },
      });
    }
    result.orderSets += 1;
  }

  // K09 · KB CDS contoh versi 1 (rencana §3.0c); RS mengganti lewat impor komite farmasi/PFT.
  for (const r of SAMPLE_CDS_RULES) {
    const { count } = await tx.cdsRule.createMany({
      data: [
        {
          id: newId(),
          tenantId,
          code: r.code,
          version: 1,
          definition: seedRuleDefinition(r.definition) as unknown as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    result.cdsRules += count;
  }

  await tx.abbreviation.createMany({
    data: SAMPLE_FORBIDDEN_ABBREVIATIONS.map((a) => ({ id: newId(), tenantId, ...a })),
    skipDuplicates: true,
  });
  await tx.nursingDiagnosis.createMany({
    data: SEED_NURSING_DIAGNOSES.map(([code, name]) => ({ id: newId(), tenantId, code, name })),
    skipDuplicates: true,
  });
  await tx.formPackage.createMany({
    data: SEED_FORM_PACKAGES.map(([setting, formCode, required], i) => ({
      id: newId(),
      tenantId,
      setting,
      formCode,
      required,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
  return result;
}

/** Instan WIB tetap di bulan lalu (riwayat fiktif tidak bergeser setiap seed). */
const at = (day: number, hm: string) => new Date(`2026-09-${String(day).padStart(2, '0')}T${hm}:00+07:00`);

/**
 * Riwayat klinis fiktif: kunjungan rawat jalan selesai (Sep 2026) untuk tiga pasien seed pertama, berisi tanda vital +
 * NEWS2, diagnosis + problem list, alergi (amoksisilin / NKDA), dan CPPT DPJP. Dilewati bila staf seed (dokter Poli
 * Penyakit Dalam, perawat) belum ada. Nomor kunjungan tetap `RJ-2609-9000NN` (idempoten).
 */
export async function seedClinicalHistory(prisma: PrismaClient, tenantId: string): Promise<number> {
  return withTenant(prisma, tenantId, async (tx) => {
    const poli = await tx.unit.findFirst({ where: { code: 'POLI-DALAM' } });
    if (!poli) return 0;
    const staffOf = (role: string) =>
      tx.staffAssignment.findFirst({
        where: { unitId: poli.id, role: { code: role } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      });
    const doctor = await staffOf('dokter');
    const nurse = (await staffOf('perawat')) ?? doctor;
    if (!doctor || !nurse) return 0;
    const patients = await tx.patient.findMany({
      where: { status: 'active', unidentified: false },
      orderBy: { mrn: 'asc' },
      take: 3,
      select: { id: true },
    });
    let created = 0;
    for (const [i, p] of patients.entries()) {
      const number = `RJ-2609-${String(900001 + i)}`;
      if (await tx.encounter.findUnique({ where: { tenantId_number: { tenantId, number } } })) continue;
      const day = 14 + i;
      const enc = await tx.encounter.create({
        data: {
          id: newId(),
          tenantId,
          number,
          patientId: p.id,
          encounterClass: 'AMB',
          status: 'finished',
          unitId: poli.id,
          arrivedAt: at(day, '08:10'),
          startedAt: at(day, '08:40'),
          endedAt: at(day, '09:05'),
        },
      });
      const entry = (author: string, role: string, occurredAt: Date) => {
        const id = newId();
        return {
          id,
          rootId: id,
          tenantId,
          patientId: p.id,
          encounterId: enc.id,
          occurredAt,
          authorUserId: author,
          authorRole: role,
        };
      };
      const vitals = {
        rr: 18,
        spo2: 97,
        onOxygen: false,
        sbp: 148,
        dbp: 92,
        hr: 84,
        consciousness: 'A' as const,
        temp: 36.8,
      };
      await tx.observation.create({
        data: {
          ...entry(nurse.userId, 'perawat', at(day, '08:20')),
          category: 'vital',
          display: 'Tanda vital',
          components: vitals,
          ewsScore: ewsScore(vitals),
          ewsMaxParam: ewsMaxParam(vitals),
        },
      });
      await tx.condition.createMany({
        data: [
          {
            ...entry(doctor.userId, 'dokter', at(day, '08:55')),
            kind: 'encounter',
            role: 'utama',
            code: 'E11.9',
            display: 'Diabetes melitus tipe 2 tanpa komplikasi',
            clinicalStatus: 'active',
          },
          {
            ...entry(doctor.userId, 'dokter', at(day, '08:55')),
            kind: 'encounter',
            role: 'sekunder',
            code: 'I10',
            display: 'Hipertensi esensial (primer)',
            clinicalStatus: 'active',
          },
          {
            ...entry(doctor.userId, 'dokter', at(day, '08:56')),
            kind: 'problem_list',
            role: null,
            code: 'E11.9',
            display: 'Diabetes melitus tipe 2 tanpa komplikasi',
            clinicalStatus: 'active',
          },
        ],
      });
      await tx.allergyIntolerance.create({
        data:
          i === 0
            ? {
                ...entry(nurse.userId, 'perawat', at(day, '08:15')),
                kind: 'alergi',
                substanceId:
                  (
                    await tx.drugSubstance.findUnique({
                      where: { tenantId_code: { tenantId, code: 'amoksisilin' } },
                    })
                  )?.id ?? null,
                text: 'Amoksisilin',
                category: 'obat',
                criticality: 'tinggi',
                reaction: 'Urtikaria dan sesak',
              }
            : { ...entry(nurse.userId, 'perawat', at(day, '08:15')), kind: 'nkda' },
      });
      await tx.cpptEntry.create({
        data: {
          ...entry(doctor.userId, 'dokter', at(day, '09:00')),
          ppa: 'dpjp',
          format: 'soap',
          content: {
            s: 'Kontrol rutin, keluhan sering haus berkurang.',
            o: 'TD 148/92, GDS 186 mg/dL.',
            a: 'DM tipe 2 terkontrol sebagian; hipertensi.',
            p: 'Lanjut metformin 2×500 mg, amlodipin 5 mg; kontrol 1 bulan.',
          },
        },
      });
      created += 1;
    }
    return created;
  });
}
