import { allocateNumber } from './platform';
import { isoDateJakarta, newId } from '@simrs/shared';
import type { TenantTx } from './client';

/**
 * S01–S10 · Master penunjang fiktif per RS (rencana fase 4 §4.0b, seed). Idempoten (per kode). Kode baku HANYA dari
 * `SEED_REF_SAMPLES` (LOINC/ICD-9-CM yang sama dengan orderable fase 3); nilai rujukan/batas kritis contoh, bukan
 * pedoman klinis: wajib ditinjau komite medik/PK sebelum dipakai.
 * - `seedSupportMasters`: tes lab + rentang (per JK/usia) + batas kritis, 2 analyzer tanpa merek, 4 modalitas + ruang,
 *   prosedur radiologi, depo (Farmasi RJ, RI, IGD, OK, Gudang), pemasok, profil formularium, 4 kamar OK, templat
 *   daftar tilik WHO v1 (butir sama dengan mockup Kamar operasi + butir persetujuan diisi sistem), jenis diet,
 *   komponen darah.
 * - `seedSupportStock`: batch dengan ED berbeda (satu kedaluwarsa, satu dekat ED) lewat ledger penerimaan, dan kantong
 *   darah fiktif. Butuh pengguna pelaku (staf seed apoteker).
 */

type Range = readonly [
  sex: 'male' | 'female' | 'any',
  refLow: number | null,
  refHigh: number | null,
  critLow: number | null,
  critHigh: number | null,
];

/** Prosedur radiologi contoh: [kode, nama, modalitas, ICD-9-CM (dari `SEED_REF_SAMPLES`), orderable fase 3, kontras, templat]. */
export const SEED_RADIOLOGY_PROCEDURES = [
  ['RAD-TORAKS', 'Foto toraks PA', 'DR', null, 'Foto toraks', false, 'toraks'],
  ['RAD-CT-KEPALA', 'CT scan kepala tanpa kontras', 'CT', '87.03', 'CT scan kepala', false, 'ct-kepala'],
  ['RAD-CT-KEPALA-K', 'CT scan kepala dengan kontras', 'CT', '87.03', null, true, 'ct-kepala'],
  ['RAD-USG-ABD', 'USG abdomen', 'USG', '88.76', 'USG abdomen', false, 'usg-abdomen'],
] as const;

/** [kode, nama, LOINC, spesimen, satuan, desimal, panel, nama orderable fase 3, batas delta, rentang dewasa]. */
export const SEED_LAB_TESTS: ReadonlyArray<
  readonly [
    string,
    string,
    string,
    string,
    string,
    number,
    string | null,
    string,
    number | null,
    readonly Range[],
  ]
> = [
  [
    'HB',
    'Hemoglobin',
    '718-7',
    'darah_edta',
    'g/dL',
    1,
    'DL',
    'Hemoglobin',
    2,
    [
      ['male', 13.2, 17.3, 7, 20],
      ['female', 11.7, 15.5, 7, 20],
    ],
  ],
  ['LEU', 'Leukosit', '6690-2', 'darah_edta', '10³/µL', 1, 'DL', 'Leukosit', null, [['any', 3.6, 11, 1, 30]]],
  [
    'TROM',
    'Trombosit',
    '777-3',
    'darah_edta',
    '10³/µL',
    0,
    'DL',
    'Trombosit',
    null,
    [['any', 150, 440, 20, 1000]],
  ],
  [
    'GDS',
    'Glukosa sewaktu',
    '2345-7',
    'serum',
    'mg/dL',
    0,
    null,
    'Glukosa sewaktu',
    null,
    [['any', 70, 140, 40, 450]],
  ],
  ['HBA1C', 'HbA1c', '4548-4', 'darah_edta', '%', 1, null, 'HbA1c', null, [['any', 4, 5.6, null, null]]],
  [
    'KREA',
    'Kreatinin',
    '2160-0',
    'serum',
    'mg/dL',
    2,
    'KIMIA',
    'Kreatinin',
    0.3,
    [
      ['male', 0.7, 1.3, null, 7],
      ['female', 0.6, 1.1, null, 7],
    ],
  ],
  ['UR', 'Ureum', '3094-0', 'serum', 'mg/dL', 0, 'KIMIA', 'Ureum', null, [['any', 15, 40, null, 200]]],
  ['K', 'Kalium', '2823-3', 'serum', 'mmol/L', 1, 'ELEKTROLIT', 'Kalium', 1, [['any', 3.5, 5.1, 2.5, 6]]],
  [
    'NA',
    'Natrium',
    '2951-2',
    'serum',
    'mmol/L',
    0,
    'ELEKTROLIT',
    'Natrium',
    null,
    [['any', 135, 145, 120, 160]],
  ],
  [
    'TROPI',
    'Troponin I',
    '10839-9',
    'serum',
    'ng/mL',
    3,
    null,
    'Troponin I',
    null,
    [['any', null, 0.04, null, 0.4]],
  ],
  ['CRP', 'CRP', '1988-5', 'serum', 'mg/L', 1, null, 'CRP', null, [['any', null, 5, null, null]]],
  [
    'KOL',
    'Kolesterol total',
    '2093-3',
    'serum',
    'mg/dL',
    0,
    'LIPID',
    'Kolesterol total',
    null,
    [['any', null, 200, null, null]],
  ],
  ['ABO', 'Golongan darah ABO', '883-9', 'darah_edta', '', 0, null, 'Golongan darah ABO', null, []],
];

/** Kode item daftar tilik + label (mockup Kamar operasi, 5 butir per fase) + butir persetujuan diisi sistem. */
export const SEED_WHO_CHECKLIST = {
  'sign-in': [
    { code: 'sign-in-1', label: 'Identitas, lokasi, prosedur dikonfirmasi pasien' },
    { code: 'sign-in-2', label: 'Penandaan lokasi operasi' },
    { code: 'sign-in-3', label: 'Mesin dan obat anestesi dicek' },
    { code: 'sign-in-4', label: 'Pulse oksimetri terpasang' },
    { code: 'sign-in-5', label: 'Risiko jalan napas sulit / aspirasi dinilai' },
    { code: 'sign-in-consent', label: 'Persetujuan tindakan bertanda tangan', system: true },
  ],
  'time-out': [
    { code: 'time-out-1', label: 'Semua anggota tim memperkenalkan diri' },
    { code: 'time-out-2', label: 'Nama pasien, prosedur, lokasi insisi' },
    { code: 'time-out-3', label: 'Antibiotik profilaksis ≤ 60 mnt sebelum insisi' },
    { code: 'time-out-4', label: 'Antisipasi kejadian kritis (bedah, anestesi, perawat)' },
    { code: 'time-out-5', label: 'Pencitraan penting ditampilkan' },
  ],
  'sign-out': [
    { code: 'sign-out-1', label: 'Nama prosedur yang dicatat' },
    { code: 'sign-out-2', label: 'Hitung kasa, jarum, instrumen lengkap', system: true },
    { code: 'sign-out-3', label: 'Label spesimen' },
    { code: 'sign-out-4', label: 'Masalah alat' },
    { code: 'sign-out-5', label: 'Rencana pemulihan' },
  ],
} as const;

export interface SeedSupportResult {
  labTests: number;
  modalities: number;
  stockLocations: number;
  orRooms: number;
}

async function room(
  tx: TenantTx,
  tenantId: string,
  unitCode: string,
  code: string,
  name: string,
): Promise<string> {
  const unit = await tx.unit.findFirstOrThrow({ where: { code: unitCode } });
  const row = await tx.location.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: {},
    create: { id: newId(), tenantId, unitId: unit.id, kind: 'ruang', code, name },
  });
  return row.id;
}

export async function seedSupportMasters(tx: TenantTx, tenantId: string): Promise<SeedSupportResult> {
  const unitId = async (code: string) => (await tx.unit.findFirstOrThrow({ where: { code } })).id;
  const orderable = async (kind: string, name: string) =>
    (await tx.orderable.findFirst({ where: { kind, name }, select: { id: true } }))?.id ?? null;
  const result: SeedSupportResult = { labTests: 0, modalities: 0, stockLocations: 0, orRooms: 0 };

  // S01 · Tes lab + rentang rujukan/batas kritis dewasa (≥ 18 tahun = 6570 hari) dan umum.
  let order = 0;
  for (const [
    code,
    name,
    loinc,
    specimenType,
    unit,
    decimals,
    panelCode,
    orderableName,
    deltaLimit,
    ranges,
  ] of SEED_LAB_TESTS) {
    order += 1;
    const exists = await tx.labTestDefinition.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (exists) continue;
    const id = newId();
    await tx.labTestDefinition.create({
      data: {
        id,
        tenantId,
        code,
        loinc,
        name,
        orderableId: await orderable('lab', orderableName),
        specimenType,
        unit,
        decimals,
        resultType: code === 'ABO' ? 'text' : 'numeric',
        panelCode,
        analyzerCode: loinc,
        deltaLimit,
        sortOrder: order,
      },
    });
    for (const [sex, refLow, refHigh, criticalLow, criticalHigh] of ranges) {
      await tx.labReferenceRange.create({
        data: {
          id: newId(),
          tenantId,
          testDefinitionId: id,
          sex,
          ageMinDays: 0,
          refLow,
          refHigh,
          criticalLow,
          criticalHigh,
        },
      });
    }
    result.labTests += 1;
  }
  const lab = await unitId('LAB');
  for (const [code, name] of [
    ['HEM-01', 'Analyzer hematologi 1'],
    ['KIM-01', 'Analyzer kimia klinik 1'],
  ] as const) {
    await tx.labAnalyzer.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { id: newId(), tenantId, code, name, unitId: lab },
    });
  }

  // S03 · Modalitas (ruang di unit Radiologi) + prosedur dari orderable fase 3.
  for (const [code, modality, name, roomCode] of [
    ['CT-1', 'CT', 'CT scan 64 slice', 'RAD-CT'],
    ['DR-1', 'DR', 'Radiografi digital', 'RAD-DR'],
    ['USG-1', 'USG', 'USG', 'RAD-USG'],
    ['MRI-1', 'MRI', 'MRI 1,5 T', 'RAD-MRI'],
  ] as const) {
    const locationId = await room(tx, tenantId, 'RAD', roomCode, `Ruang ${name}`);
    const exists = await tx.radiologyModality.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (exists) continue;
    await tx.radiologyModality.create({ data: { id: newId(), tenantId, code, modality, name, locationId } });
    result.modalities += 1;
  }
  for (const [
    code,
    name,
    modality,
    icd9cm,
    orderableName,
    contrast,
    templateCode,
  ] of SEED_RADIOLOGY_PROCEDURES) {
    await tx.radiologyProcedure.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: {
        id: newId(),
        tenantId,
        code,
        name,
        modality,
        icd9cm,
        orderableId: orderableName ? await orderable('radiologi', orderableName) : null,
        contrast,
        templateCode,
      },
    });
  }

  // S05 · Depo dan gudang.
  for (const [code, name, kind, unitCode] of [
    ['DEPO-RJ', 'Depo farmasi rawat jalan', 'depo', 'FARMASI'],
    ['DEPO-RI', 'Depo farmasi rawat inap', 'depo', 'FARMASI'],
    ['DEPO-IGD', 'Depo farmasi IGD', 'depo', 'IGD'],
    ['DEPO-OK', 'Depo kamar operasi', 'ok', 'OK'],
    ['GUDANG', 'Gudang farmasi', 'gudang', 'FARMASI'],
  ] as const) {
    const exists = await tx.stockLocation.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (exists) continue;
    await tx.stockLocation.create({
      data: { id: newId(), tenantId, code, name, kind, unitId: await unitId(unitCode) },
    });
    result.stockLocations += 1;
  }
  for (const [code, name] of [
    ['PBF-FIKTIF-1', 'PBF Sehat Sentosa (fiktif)'],
    ['PBF-FIKTIF-2', 'PBF Mitra Farma (fiktif)'],
  ] as const) {
    await tx.supplier.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { id: newId(), tenantId, code, name },
    });
  }

  // S06 · Empat kamar operasi + templat daftar tilik WHO v1.
  for (let i = 1; i <= 4; i++) {
    const code = `OK-${i}`;
    const before = await tx.location.findUnique({ where: { tenantId_code: { tenantId, code } } });
    await room(tx, tenantId, 'OK', code, `Kamar operasi ${i}`);
    if (!before) result.orRooms += 1;
  }
  if (
    !(await tx.surgeryChecklistTemplate.findUnique({ where: { tenantId_version: { tenantId, version: 1 } } }))
  ) {
    await tx.surgeryChecklistTemplate.create({
      data: { id: newId(), tenantId, version: 1, items: SEED_WHO_CHECKLIST },
    });
  }

  // S07/S08 · Jenis diet dan komponen darah.
  for (const [code, name] of [
    ['NB', 'Nasi biasa'],
    ['DM-1700', 'Diet diabetes 1.700 kkal'],
    ['RG', 'Rendah garam'],
    ['LUNAK', 'Diet lunak'],
    ['CAIR', 'Diet cair'],
  ] as const) {
    await tx.dietType.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { id: newId(), tenantId, code, name },
    });
  }
  // Aturan ABO per komponen (ADR-0105): sel darah merah, plasma (FFP/TC), identik (darah lengkap).
  for (const [code, name, shelfLifeDays, aboRule] of [
    ['PRC', 'Packed red cells', 42, 'sel_darah_merah'],
    ['TC', 'Trombosit konsentrat', 5, 'plasma'],
    ['FFP', 'Fresh frozen plasma', 365, 'plasma'],
    ['WB', 'Whole blood', 35, 'identik'],
  ] as const) {
    await tx.bloodComponent.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { id: newId(), tenantId, code, name, shelfLifeDays, aboRule },
    });
  }
  return result;
}

const addDays = (date: string, days: number): Date =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);

/**
 * Stok awal fiktif: penerimaan ke gudang dan depo rawat inap lewat ledger (saldo dihitung trigger), termasuk satu batch
 * kedaluwarsa dan satu dekat ED, profil min/maks depo, dan kantong darah. Sekali per RS (lewati bila sudah ada
 * penerimaan). `actorUserId` = penerima barang (staf seed apoteker).
 */
export async function seedSupportStock(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string,
  today: string = isoDateJakarta(),
): Promise<{ receipts: number; batches: number; bloodUnits: number }> {
  if ((await tx.stockReceipt.count()) > 0) return { receipts: 0, batches: 0, bloodUnits: 0 };
  const loc = async (code: string) =>
    (await tx.stockLocation.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } })).id;
  const supplier = (
    await tx.supplier.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'PBF-FIKTIF-1' } } })
  ).id;
  const drug = async (name: string) => (await tx.drug.findFirstOrThrow({ where: { name } })).id;
  // [obat, batch, ED (hari dari hari ini), qty, harga pokok per satuan].
  const lines: ReadonlyArray<readonly [string, string, number, number, bigint]> = [
    ['Seftriakson 2 g injeksi', 'SFX-LAMA', -10, 20, 18_500n],
    ['Seftriakson 2 g injeksi', 'SFX-DEKAT', 45, 30, 18_500n],
    ['Seftriakson 2 g injeksi', 'SFX-BARU', 540, 100, 19_000n],
    ['Parasetamol 500 mg tablet', 'PCT-01', 400, 1000, 150n],
    ['Metformin 500 mg tablet', 'MET-01', 365, 600, 220n],
    ['Enoksaparin 60 mg/0,6 mL injeksi', 'ENX-01', 300, 40, 85_000n],
    ['Insulin glargine 100 unit/mL pen', 'INS-01', 200, 15, 160_000n],
    ['Omeprazol 40 mg injeksi', 'OMZ-01', 250, 50, 12_000n],
  ];
  let receipts = 0;
  let batches = 0;
  for (const target of ['GUDANG', 'DEPO-RI'] as const) {
    const stockLocationId = await loc(target);
    const receiptNo = (await allocateNumber(tx, tenantId, 'stock_receipt')).number;
    const receiptId = newId();
    await tx.stockReceipt.create({
      data: {
        id: receiptId,
        tenantId,
        receiptNo,
        stockLocationId,
        supplierId: supplier,
        invoiceNo: `FKT-${target}-001`,
        receivedBy: actorUserId,
      },
    });
    receipts += 1;
    for (const [drugName, batchNo, edDays, qty, unitCost] of lines) {
      const drugId = await drug(drugName);
      let batch = await tx.stockBatch.findUnique({
        where: { tenantId_drugId_batchNo: { tenantId, drugId, batchNo } },
      });
      if (!batch) {
        batch = await tx.stockBatch.create({
          data: {
            id: newId(),
            tenantId,
            drugId,
            batchNo,
            expiryDate: addDays(today, edDays),
            unitCost,
            supplierId: supplier,
          },
        });
        batches += 1;
      }
      await tx.stockMovement.create({
        data: {
          id: newId(),
          tenantId,
          stockLocationId,
          stockBatchId: batch.id,
          kind: 'receipt',
          quantity: target === 'GUDANG' ? qty : Math.ceil(qty / 4),
          refType: 'stock_receipts',
          refId: receiptId,
          createdBy: actorUserId,
        },
      });
      await tx.formularyStockProfile.upsert({
        where: { tenantId_drugId_stockLocationId: { tenantId, drugId, stockLocationId } },
        update: {},
        create: { id: newId(), tenantId, drugId, stockLocationId, unit: 'satuan', minQuantity: 5 },
      });
    }
  }
  const prc = (
    await tx.bloodComponent.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'PRC' } } })
  ).id;
  let bloodUnits = 0;
  for (const [bagNo, abo, rh, ageDays] of [
    ['KTG-0001', 'O', 'neg', 3],
    ['KTG-0002', 'O', 'pos', 5],
    ['KTG-0003', 'A', 'pos', 7],
    ['KTG-0004', 'B', 'pos', 10],
    ['KTG-0005', 'AB', 'pos', 41],
  ] as const) {
    const collectedAt = addDays(today, -ageDays);
    await tx.bloodUnit.create({
      data: {
        id: newId(),
        tenantId,
        bagNo,
        componentId: prc,
        abo,
        rh,
        collectedAt,
        expiresAt: addDays(today, 42 - ageDays),
      },
    });
    bloodUnits += 1;
  }
  return { receipts, batches, bloodUnits };
}
