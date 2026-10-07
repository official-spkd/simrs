/**
 * Fase 4 · 4.0b · Skema penunjang (migrasi `20261008100000_support_services`): ledger stok + saldo (20 dispensing
 * serentak untuk sisa 5 unit → tepat 5; saldo = Σ ledger; batch ED ditolak), append-only juga bagi pemilik, RLS
 * antar-tenant, nilai kritis (CHECK read-back/penerima, durasi server, hanya laporan yang menutup), urutan validasi
 * lab, dosis CT, cek ganda dispensing, jadwal kamar tumpang tindih, daftar tilik WHO + gerbang insisi + hitung kasa,
 * kompatibilitas darah, seed master penunjang. Data fiktif.
 */
import { isoDateJakarta, newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  ensureSystemRoles,
  insertPatient,
  type PrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  seedSupportStock,
  type TenantTx,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

const keys = {
  encKeyB64: Buffer.alloc(32, 71).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 73).toString('base64'),
};

let app: PrismaClient;
let owner: PrismaClient;

interface Ctx {
  tenantId: string;
  pharmacist: string;
  pharmacist2: string;
  analyst: string;
  doctor: string;
  nurse: string;
  patientId: string;
  encounterId: string;
}
let A: Ctx;
let B: Ctx;

async function freshTenant(): Promise<Ctx> {
  const tenantId = newId();
  await withTenant(owner, tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, code: `SP${tenantId.slice(-6).toUpperCase()}`, name: 'RS Fiktif Uji Penunjang' },
    });
    await ensureSystemRoles(tx, tenantId);
    await seedHospitalStructure(tx, tenantId);
  });
  return withTenant(app, tenantId, async (tx) => {
    await seedClinicalMasters(tx, tenantId);
    await seedSupportMasters(tx, tenantId);
    const user = async (name: string) => {
      const id = newId();
      await tx.user.create({ data: { id, tenantId, username: `u.${id.slice(-10)}`, displayName: name } });
      return id;
    };
    const pharmacist = await user('apt. Satu');
    await seedSupportStock(tx, tenantId, pharmacist);
    const p = await insertPatient(tx, new PatientCrypto(keys, tenantId), {
      name: 'Tn. Uji Penunjang',
      sex: 'male',
      birthDate: '1970-01-01',
    });
    const melati = (await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } })).id;
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId,
        number: `RI-SP-${newId().slice(-8)}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: melati,
        plannedAt: new Date(),
      },
    });
    return {
      tenantId,
      pharmacist,
      pharmacist2: await user('apt. Dua'),
      analyst: await user('Analis Satu'),
      doctor: await user('dr. Satu'),
      nurse: await user('Ns. Satu'),
      patientId: p.id,
      encounterId: enc.id,
    };
  });
}

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 12 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  A = await freshTenant();
  B = await freshTenant();
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const inT = <T>(c: Ctx, fn: (tx: TenantTx) => Promise<T>, client: PrismaClient = app) =>
  withTenant(client, c.tenantId, fn);

/** Galat DB → teks (kode stabil ada di awal pesan RAISE/nama constraint). */
async function dbError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return String((err as Error).message);
  }
  throw new Error('Diharapkan galat database');
}

async function location(c: Ctx, code: string) {
  return inT(c, async (tx) => (await tx.stockLocation.findFirstOrThrow({ where: { code } })).id);
}

async function batch(c: Ctx, batchNo: string) {
  return inT(c, (tx) => tx.stockBatch.findFirstOrThrow({ where: { batchNo } }));
}

/** Kiriman resep + resep farmasi + satu baris order obat untuk dispensing. */
async function prescription(c: Ctx, drugName: string, highAlert = false) {
  return inT(c, async (tx) => {
    const group = await tx.orderGroup.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        encounterId: c.encounterId,
        patientId: c.patientId,
        idempotencyKey: newId(),
        requestHash: 'f'.repeat(64),
        orderedBy: c.doctor,
        orderedRole: 'dokter',
      },
    });
    const drug = await tx.drug.findFirstOrThrow({ where: { name: drugName } });
    const med = await tx.medicationRequest.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        orderGroupId: group.id,
        encounterId: c.encounterId,
        patientId: c.patientId,
        drugId: drug.id,
        name: drug.name,
        dose: '1',
        route: 'IV',
        frequency: 'stat',
        highAlert,
      },
    });
    const rx = await tx.pharmacyPrescription.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        prescriptionNo: `R-2610-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
        orderGroupId: group.id,
        encounterId: c.encounterId,
        patientId: c.patientId,
        stockLocationId: (await tx.stockLocation.findFirstOrThrow({ where: { code: 'DEPO-RI' } })).id,
        setting: 'rawat_inap',
        acceptedBy: c.pharmacist,
      },
    });
    return { group, med, rx, drugId: drug.id };
  });
}

const move = (
  c: Ctx,
  data: { location: string; batch: string; kind: string; quantity: number; reason?: string },
) =>
  inT(c, (tx) =>
    tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        stockLocationId: data.location,
        stockBatchId: data.batch,
        kind: data.kind,
        quantity: data.quantity,
        refType: 'uji',
        refId: newId(),
        reason: data.reason ?? null,
        unitCost: data.kind === 'receipt' ? 100n : null,
        encounterId: ['dispense', 'usage'].includes(data.kind) ? c.encounterId : null,
        patientId: ['dispense', 'usage'].includes(data.kind) ? c.patientId : null,
        createdBy: c.pharmacist,
      },
    }),
  );

describe('seed master penunjang', () => {
  it('tes lab + rentang, modalitas, depo, kamar OK, templat WHO, stok awal lewat ledger', async () => {
    await inT(A, async (tx) => {
      expect(await tx.labTestDefinition.count()).toBe(13);
      const k = await tx.labTestDefinition.findFirstOrThrow({
        where: { code: 'K' },
        include: { referenceRanges: true },
      });
      expect(k.loinc).toBe('2823-3');
      expect(Number(k.referenceRanges[0]?.criticalHigh)).toBe(6);
      expect(await tx.radiologyModality.count()).toBe(4);
      expect(await tx.stockLocation.count()).toBe(5);
      expect(await tx.location.count({ where: { code: { startsWith: 'OK-' } } })).toBe(4);
      expect(await tx.surgeryChecklistTemplate.count()).toBe(1);
      expect(await tx.bloodUnit.count()).toBe(5);
      const balances = await tx.stockBalance.findMany();
      for (const b of balances) {
        const sum = await tx.stockMovement.aggregate({
          where: { stockLocationId: b.stockLocationId, stockBatchId: b.stockBatchId },
          _sum: { quantity: true },
        });
        expect(sum._sum.quantity).toBe(b.quantity);
      }
    });
    // Idempoten: seed ulang tidak menggandakan.
    await inT(A, async (tx) => {
      await seedSupportMasters(tx, A.tenantId);
      expect(await seedSupportStock(tx, A.tenantId, A.pharmacist)).toEqual({
        receipts: 0,
        batches: 0,
        bloodUnits: 0,
      });
      expect(await tx.labTestDefinition.count()).toBe(13);
    });
  });
});

describe('ledger stok', () => {
  it('20 dispensing serentak untuk sisa 5 unit → tepat 5 berhasil; saldo = Σ ledger, tidak negatif', async () => {
    const depo = await location(A, 'DEPO-RI');
    const b = await batch(A, 'PCT-01');
    const current = await inT(A, (tx) =>
      tx.stockBalance.findFirstOrThrow({ where: { stockLocationId: depo, stockBatchId: b.id } }),
    );
    await move(A, {
      location: depo,
      batch: b.id,
      kind: 'adjustment',
      quantity: 5 - current.quantity,
      reason: 'Opname uji serentak dispensing',
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        move(A, { location: depo, batch: b.id, kind: 'dispense', quantity: -1 }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/STOCK_INSUFFICIENT/);
    }
    await inT(A, async (tx) => {
      const bal = await tx.stockBalance.findFirstOrThrow({
        where: { stockLocationId: depo, stockBatchId: b.id },
      });
      const sum = await tx.stockMovement.aggregate({
        where: { stockLocationId: depo, stockBatchId: b.id },
        _sum: { quantity: true },
      });
      expect(bal.quantity).toBe(0);
      expect(sum._sum.quantity).toBe(0);
    });
  });

  it('batch kedaluwarsa tidak keluar ke pasien; tanda qty per jenis dijaga; saldo hanya lewat ledger', async () => {
    const depo = await location(A, 'DEPO-RI');
    const expired = await batch(A, 'SFX-LAMA');
    expect(expired.expiryDate.toISOString().slice(0, 10) <= isoDateJakarta()).toBe(true);
    expect(
      await dbError(move(A, { location: depo, batch: expired.id, kind: 'dispense', quantity: -1 })),
    ).toMatch(/BATCH_EXPIRED/);
    // Pemusnahan batch kedaluwarsa (bukan ke pasien) boleh, beralasan.
    await move(A, {
      location: depo,
      batch: expired.id,
      kind: 'write_off',
      quantity: -1,
      reason: 'Pemusnahan batch ED',
    });
    expect(
      await dbError(move(A, { location: depo, batch: expired.id, kind: 'receipt', quantity: -1 })),
    ).toMatch(/stock_movements_values_valid/);
    const bal = await inT(A, (tx) => tx.stockBalance.findFirstOrThrow({ where: { stockLocationId: depo } }));
    expect(
      await dbError(
        inT(A, (tx) => tx.stockBalance.update({ where: { id: bal.id }, data: { quantity: 999 } })),
      ),
    ).toMatch(/permission denied/i);
  });

  it('append-only juga bagi pemilik tabel; tenant lain tidak melihat stok', async () => {
    const m = await inT(A, (tx) => tx.stockMovement.findFirstOrThrow());
    for (const client of [app, owner]) {
      expect(
        await dbError(
          inT(
            A,
            (tx) => tx.stockMovement.update({ where: { id: m.id }, data: { reason: 'ubah diam-diam' } }),
            client,
          ),
        ),
      ).toMatch(/APPEND_ONLY|permission denied/i);
    }
    expect(await dbError(inT(A, (tx) => tx.stockMovement.delete({ where: { id: m.id } }), owner))).toMatch(
      /APPEND_ONLY/,
    );
    expect(await inT(B, (tx) => tx.stockMovement.count({ where: { id: m.id } }))).toBe(0);
  });
});

describe('dispensing', () => {
  it('cek ganda oleh penyiap ditolak; serah obat kewaspadaan tinggi tanpa cek ganda ditolak', async () => {
    const { rx } = await prescription(A, 'Enoksaparin 60 mg/0,6 mL injeksi', true);
    const dispense = await inT(A, (tx) =>
      tx.dispense.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          pharmacyPrescriptionId: rx.id,
          encounterId: A.encounterId,
          patientId: A.patientId,
          stockLocationId: rx.stockLocationId,
          preparedBy: A.pharmacist,
          hasHighAlert: true,
        },
      }),
    );
    expect(
      await dbError(
        inT(A, (tx) =>
          tx.dispense.update({
            where: { id: dispense.id },
            data: { doubleCheckedBy: A.pharmacist, doubleCheckedAt: new Date() },
          }),
        ),
      ),
    ).toMatch(/dispenses_double_check_other_user/);
    expect(
      await dbError(
        inT(A, (tx) =>
          tx.dispense.update({
            where: { id: dispense.id },
            data: {
              handedOverBy: A.pharmacist,
              handedOverAt: new Date(),
              receiverKind: 'perawat',
              receiverName: 'Ns. Penerima',
              counselingGiven: true,
            },
          }),
        ),
      ),
    ).toMatch(/dispenses_values_valid/);
    await inT(A, (tx) =>
      tx.dispense.update({
        where: { id: dispense.id },
        data: {
          doubleCheckedBy: A.pharmacist2,
          doubleCheckedAt: new Date(),
          handedOverBy: A.pharmacist,
          handedOverAt: new Date(),
          receiverKind: 'perawat',
          receiverName: 'Ns. Penerima',
          counselingGiven: true,
        },
      }),
    );
  });
});

/** Order lab + hasil kritis K 6,8 (versi 1). */
async function criticalLab(c: Ctx) {
  return inT(c, async (tx) => {
    const lab = (await tx.unit.findFirstOrThrow({ where: { code: 'LAB' } })).id;
    const order = await tx.labOrder.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        labNo: `L261007${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
        encounterId: c.encounterId,
        patientId: c.patientId,
        unitId: lab,
        priority: 'cito',
        status: 'hasil',
        idempotencyKey: newId(),
        acceptedBy: c.analyst,
      },
    });
    const def = await tx.labTestDefinition.findFirstOrThrow({ where: { code: 'K' } });
    const id = newId();
    const result = await tx.labResult.create({
      data: {
        id,
        rootId: id,
        tenantId: c.tenantId,
        patientId: c.patientId,
        encounterId: c.encounterId,
        occurredAt: new Date(),
        authorUserId: c.analyst,
        authorRole: 'analis_lab',
        labOrderId: order.id,
        testDefinitionId: def.id,
        loinc: def.loinc,
        name: def.name,
        valueNumeric: 6.8,
        unit: 'mmol/L',
        decimals: 1,
        refLow: 3.5,
        refHigh: 5.1,
        criticalLow: 2.5,
        criticalHigh: 6,
        flag: 'KRITIS',
        source: 'manual',
      },
    });
    const critical = await tx.criticalResult.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        source: 'lab',
        labResultId: result.id,
        encounterId: c.encounterId,
        patientId: c.patientId,
        unitId: lab,
        analyte: 'Kalium',
        valueText: '6,8 mmol/L',
        limitMinutes: 30,
        status: 'dilaporkan',
        raisedAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
    return { order, result, critical };
  });
}

const report = (c: Ctx, criticalResultId: string, over: Record<string, unknown> = {}) =>
  inT(c, (tx) =>
    tx.criticalResultReport.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        criticalResultId,
        recipientUserId: c.doctor,
        channel: 'telepon',
        readBackText: 'Kalium 6,8 mmol/L',
        readBackConfirmed: true,
        reportedBy: c.analyst,
        reportedAt: new Date('2020-01-01T00:00:00Z'),
        minutesToReport: 999,
        withinLimit: false,
        ...over,
      },
    }),
  );

const validate = (c: Ctx, labOrderId: string, level: 'teknis' | 'klinis') =>
  inT(c, (tx) =>
    tx.labValidation.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        labOrderId,
        level,
        snapshotHash: 'a'.repeat(64),
        validatedBy: level === 'teknis' ? c.analyst : c.doctor,
        validatorRole: level === 'teknis' ? 'analis_lab' : 'dokter',
      },
    }),
  );

describe('nilai kritis dan validasi lab', () => {
  it('muncul terbuka dengan waktu server; penutupan hanya lewat laporan ber-read-back dengan penerima', async () => {
    const { order, critical } = await criticalLab(A);
    expect(critical.status).toBe('terbuka');
    expect(critical.raisedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await dbError(validate(A, order.id, 'teknis'))).toMatch(/CRITICAL_OPEN/);
    expect(await dbError(report(A, critical.id, { readBackConfirmed: false }))).toMatch(
      /critical_result_reports_read_back_required/,
    );
    expect(
      await dbError(
        report(A, critical.id, { recipientUserId: null, recipientName: 'dr A', recipientRole: 'DPJP' }),
      ),
    ).toMatch(/critical_result_reports_recipient_required/);
    expect(
      await dbError(
        inT(A, (tx) =>
          tx.criticalResult.update({ where: { id: critical.id }, data: { status: 'dilaporkan' } }),
        ),
      ),
    ).toMatch(/permission denied/i);
    const ok = await report(A, critical.id, {
      recipientUserId: null,
      recipientName: 'dr. Andi Fiktif',
      recipientRole: 'DPJP jaga',
    });
    expect(ok.minutesToReport).toBe(0);
    expect(ok.withinLimit).toBe(true);
    expect(ok.reportedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      (await inT(A, (tx) => tx.criticalResult.findUniqueOrThrow({ where: { id: critical.id } }))).status,
    ).toBe('dilaporkan');
    expect(await dbError(report(A, critical.id))).toMatch(/CONFLICT|Unique/);
    expect(await dbError(validate(A, order.id, 'klinis'))).toMatch(/VALIDATION_ORDER/);
    await validate(A, order.id, 'teknis');
    await validate(A, order.id, 'klinis');
    expect(await dbError(validate(A, order.id, 'klinis'))).toMatch(/Unique/i);
  });

  it('hasil lab append-only juga bagi pemilik; koreksi = versi baru beralasan', async () => {
    const { result } = await criticalLab(A);
    expect(
      await dbError(
        inT(A, (tx) => tx.labResult.update({ where: { id: result.id }, data: { comment: 'x' } }), owner),
      ),
    ).toMatch(/APPEND_ONLY/);
    expect(
      await dbError(
        inT(A, (tx) =>
          tx.labResult.create({
            data: {
              ...result,
              id: newId(),
              version: 2,
              supersedesId: result.id,
              correctionReason: null,
              valueNumeric: 4.2,
              flag: 'N',
            },
          }),
        ),
      ),
    ).toMatch(/lab_results_version_chain/);
    const v2 = await inT(A, (tx) =>
      tx.labResult.create({
        data: {
          ...result,
          id: newId(),
          version: 2,
          supersedesId: result.id,
          correctionReason: 'Salah input, nilai benar 4,2',
          valueNumeric: 4.2,
          flag: 'N',
        },
      }),
    );
    expect(v2.version).toBe(2);
  });
});

describe('radiologi', () => {
  it('CT tidak bisa selesai tanpa CTDIvol + DLP (CHECK)', async () => {
    await inT(A, async (tx) => {
      const group = await tx.orderGroup.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          encounterId: A.encounterId,
          patientId: A.patientId,
          idempotencyKey: newId(),
          requestHash: 'e'.repeat(64),
          orderedBy: A.doctor,
          orderedRole: 'dokter',
        },
      });
      const orderable = await tx.orderable.findFirstOrThrow({ where: { name: 'CT scan kepala' } });
      const sr = await tx.serviceRequest.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          orderGroupId: group.id,
          encounterId: A.encounterId,
          patientId: A.patientId,
          orderableId: orderable.id,
          name: orderable.name,
          priority: 'rutin',
        },
      });
      const modality = await tx.radiologyModality.findFirstOrThrow({ where: { modality: 'CT' } });
      const rad = (await tx.unit.findFirstOrThrow({ where: { code: 'RAD' } })).id;
      const study = await tx.imagingStudy.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          accession: 'RAD-2610-0001',
          serviceRequestId: sr.id,
          encounterId: A.encounterId,
          patientId: A.patientId,
          unitId: rad,
          modalityId: modality.id,
          modality: 'CT',
          scheduledAt: new Date(),
          acceptedBy: A.doctor,
          identityConfirmedBy: A.doctor,
          status: 'berlangsung',
        },
      });
      return study.id;
    }).then(async (studyId) => {
      expect(
        await dbError(
          inT(A, (tx) => tx.imagingStudy.update({ where: { id: studyId }, data: { status: 'selesai' } })),
        ),
      ).toMatch(/imaging_studies_ct_dose_required/);
      await inT(A, (tx) =>
        tx.imagingStudy.update({
          where: { id: studyId },
          data: { status: 'selesai', ctdiVol: 45.2, dlp: 812 },
        }),
      );
    });
  });
});

/** Kasus OK di kamar `room` pada jam `startH`–`endH` (UTC) besok. */
async function surgeryCase(c: Ctx, room: string, startH: number, endH: number, status = 'terjadwal') {
  return inT(c, async (tx) => {
    const roomId = (await tx.location.findFirstOrThrow({ where: { code: room } })).id;
    const template = await tx.surgeryChecklistTemplate.findFirstOrThrow({ where: { version: 1 } });
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    return tx.surgeryCase.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        caseNo: `OK-2610-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
        encounterId: c.encounterId,
        patientId: c.patientId,
        roomId,
        startsAt: new Date(`${day}T${String(startH).padStart(2, '0')}:00:00Z`),
        endsAt: new Date(`${day}T${String(endH).padStart(2, '0')}:00:00Z`),
        priority: 'elektif',
        status,
        cancelReason: status === 'batal' ? 'Pasien demam, ditunda' : null,
        procedureName: 'Kolesistektomi laparoskopik',
        checklistTemplateId: template.id,
        createdBy: c.doctor,
      },
    });
  });
}

const check = (c: Ctx, caseId: string, phase: string, itemCode: string, source = 'manual') =>
  inT(c, (tx) =>
    tx.surgicalSafetyCheck.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        surgeryCaseId: caseId,
        phase,
        itemCode,
        source,
        checkedBy: c.nurse,
      },
    }),
  );
const confirm = (c: Ctx, caseId: string, phase: string) =>
  inT(c, (tx) =>
    tx.surgicalSafetyConfirmation.create({
      data: { id: newId(), tenantId: c.tenantId, surgeryCaseId: caseId, phase, confirmedBy: c.nurse },
    }),
  );
const event = (c: Ctx, caseId: string, kind: string, overrideReason: string | null = null) =>
  inT(c, (tx) =>
    tx.surgeryEvent.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        surgeryCaseId: caseId,
        kind,
        occurredAt: new Date(),
        overrideReason,
        recordedBy: c.doctor,
      },
    }),
  );
const count = (c: Ctx, caseId: string, kind: string, itemCode: string, quantity: number) =>
  inT(c, (tx) =>
    tx.surgicalCount.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        surgeryCaseId: caseId,
        kind,
        itemCode,
        label: itemCode,
        quantity,
        countedBy: c.nurse,
      },
    }),
  );

describe('kamar operasi', () => {
  it('jadwal kamar tumpang tindih ditolak (EXCLUDE); kasus batal tidak menghalangi', async () => {
    await surgeryCase(A, 'OK-2', 1, 3);
    expect(await dbError(surgeryCase(A, 'OK-2', 2, 4))).toMatch(/surgery_cases_no_room_overlap/);
    await surgeryCase(A, 'OK-3', 1, 3, 'batal');
    await surgeryCase(A, 'OK-3', 2, 4);
    await surgeryCase(A, 'OK-2', 3, 4);
  });

  it('daftar tilik berurutan dan lengkap; insisi butuh time out (atau override ≥ 15); sign out butuh hitung cocok', async () => {
    const k = await surgeryCase(A, 'OK-1', 5, 7);
    expect(await dbError(confirm(A, k.id, 'time-out'))).toMatch(/CHECKLIST_ORDER/);
    for (const i of [1, 2, 3, 4, 5]) await check(A, k.id, 'sign-in', `sign-in-${i}`);
    expect(await dbError(check(A, k.id, 'sign-in', 'sign-in-consent'))).toMatch(/CHECKLIST_INCOMPLETE/);
    expect(await dbError(check(A, k.id, 'sign-in', 'tidak-ada'))).toMatch(/VALIDATION_FAILED/);
    expect(await dbError(confirm(A, k.id, 'sign-in'))).toMatch(/CHECKLIST_INCOMPLETE/);
    await check(A, k.id, 'sign-in', 'sign-in-consent', 'system');
    expect(await dbError(event(A, k.id, 'induksi'))).toMatch(/CHECKLIST_ORDER/);
    await confirm(A, k.id, 'sign-in');
    expect(await dbError(check(A, k.id, 'sign-in', 'sign-in-1'))).toMatch(/CHECKLIST_ORDER|Unique/);
    await event(A, k.id, 'induksi');
    expect(await dbError(event(A, k.id, 'insisi'))).toMatch(/TIMEOUT_REQUIRED/);
    expect(await dbError(event(A, k.id, 'insisi', 'darurat sekali'))).toMatch(
      /TIMEOUT_REQUIRED|surgery_events_values_valid/,
    );
    await event(A, k.id, 'insisi', 'Perdarahan aktif, tidak bisa menunggu');

    const k2 = await surgeryCase(A, 'OK-4', 5, 7);
    for (const i of [1, 2, 3, 4, 5]) await check(A, k2.id, 'sign-in', `sign-in-${i}`);
    await check(A, k2.id, 'sign-in', 'sign-in-consent', 'system');
    await confirm(A, k2.id, 'sign-in');
    for (const i of [1, 2, 3, 4, 5]) await check(A, k2.id, 'time-out', `time-out-${i}`);
    await confirm(A, k2.id, 'time-out');
    await event(A, k2.id, 'insisi');
    for (const i of [1, 3, 4, 5]) await check(A, k2.id, 'sign-out', `sign-out-${i}`);
    await check(A, k2.id, 'sign-out', 'sign-out-2', 'system');
    await count(A, k2.id, 'awal', 'kasa', 10);
    await count(A, k2.id, 'tambahan', 'kasa', 5);
    await count(A, k2.id, 'akhir', 'kasa', 14);
    expect(await dbError(confirm(A, k2.id, 'sign-out'))).toMatch(/COUNT_MISMATCH/);
    await inT(A, (tx) =>
      tx.surgeryCountDiscrepancy.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          surgeryCaseId: k2.id,
          itemCode: 'kasa',
          action: 'Rontgen intraoperatif: tidak ada kasa tertinggal',
          recordedBy: A.doctor,
        },
      }),
    );
    await confirm(A, k2.id, 'sign-out');
    expect(await dbError(confirm(A, k2.id, 'sign-out'))).toMatch(/Unique/i);
  });
});

describe('bank darah', () => {
  async function request(c: Ctx, patientAbo: string | null, patientRh: string | null) {
    return inT(c, async (tx) => {
      const prc = await tx.bloodComponent.findFirstOrThrow({ where: { code: 'PRC' } });
      return tx.bloodRequest.create({
        data: {
          id: newId(),
          tenantId: c.tenantId,
          requestNo: `BD-2610-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
          encounterId: c.encounterId,
          patientId: c.patientId,
          componentId: prc.id,
          units: 1,
          urgency: 'cito',
          indication: 'Anemia berat',
          patientAbo,
          patientRh,
          requestedBy: c.doctor,
        },
      });
    });
  }
  const issue = (c: Ctx, requestId: string, bagNo: string, emergencyReason: string | null = null) =>
    inT(c, async (tx) => {
      const unit = await tx.bloodUnit.findFirstOrThrow({ where: { bagNo } });
      return tx.bloodIssue.create({
        data: {
          id: newId(),
          tenantId: c.tenantId,
          bloodRequestId: requestId,
          bloodUnitId: unit.id,
          encounterId: c.encounterId,
          patientId: c.patientId,
          emergencyReason,
          issuedBy: c.analyst,
        },
      });
    });
  const crossmatch = (c: Ctx, requestId: string, bagNo: string, result: string) =>
    inT(c, async (tx) => {
      const unit = await tx.bloodUnit.findFirstOrThrow({ where: { bagNo } });
      return tx.crossmatch.create({
        data: {
          id: newId(),
          tenantId: c.tenantId,
          bloodRequestId: requestId,
          bloodUnitId: unit.id,
          result,
          method: 'Gel',
          testedBy: c.analyst,
        },
      });
    });

  it('ABO/Rh tidak kompatibel ditolak; tanpa crossmatch ditolak; darurat hanya O beralasan; ED ditolak', async () => {
    const rqA = await request(B, 'A', 'pos');
    expect(await dbError(issue(B, rqA.id, 'KTG-0004'))).toMatch(/BLOOD_INCOMPATIBLE/);
    expect(await dbError(issue(B, rqA.id, 'KTG-0003'))).toMatch(/CROSSMATCH_REQUIRED/);
    await crossmatch(B, rqA.id, 'KTG-0003', 'cocok');
    await issue(B, rqA.id, 'KTG-0003');
    const unknown = await request(B, null, null);
    expect(
      await dbError(issue(B, unknown.id, 'KTG-0002', 'Syok hemoragik, tidak sempat crossmatch')),
    ).toMatch(/BLOOD_INCOMPATIBLE/);
    await issue(B, unknown.id, 'KTG-0001', 'Syok hemoragik, tidak sempat crossmatch');
    await inT(B, (tx) =>
      tx.bloodUnit.update({
        where: { tenantId_bagNo: { tenantId: B.tenantId, bagNo: 'KTG-0005' } },
        data: { status: 'tersedia' },
      }),
    );
    const ab = await request(B, 'AB', 'pos');
    await crossmatch(B, ab.id, 'KTG-0005', 'cocok');
    // KTG-0005 berumur 41 hari dari masa simpan 42: masih berlaku; buat kedaluwarsa lewat pemilik untuk uji ED.
    await inT(
      B,
      (tx) =>
        tx.$executeRaw`UPDATE blood_units SET expires_at = now() - interval '1 hour', collected_at = now() - interval '43 days' WHERE bag_no = 'KTG-0005'`,
      owner,
    );
    expect(await dbError(issue(B, ab.id, 'KTG-0005'))).toMatch(/BATCH_EXPIRED/);
  });
});

describe('pesan masuk generik (fase 4 §4.1a)', () => {
  const insert = (c: Ctx, over: Record<string, unknown>) =>
    inT(c, (tx) =>
      tx.inboundEvent.create({
        data: {
          id: newId(),
          tenantId: c.tenantId,
          source: 'uji',
          idempotencyKey: newId(),
          headers: {},
          rawBody: 'MSH|^~\\&|X',
          ...over,
        },
      }),
    );

  it('HL7 analyzer wajib tanpa PID/NK1 berisi dan bertanda perangkat; status baku; processed_at hanya untuk processed', async () => {
    expect(await dbError(insert(A, { source: 'lis-hl7', rawBody: 'MSH|^~\\&|X\rPID|1||RM1||Siti' }))).toMatch(
      /inbound_events_hl7_redacted|inbound_events_lis_device/,
    );
    expect(await dbError(insert(A, { status: 'selesai' }))).toMatch(/inbound_events_values_valid/);
    expect(await dbError(insert(A, { status: 'processed' }))).toMatch(/inbound_events_values_valid/);
    const ok = await insert(A, { rawBody: 'MSH|^~\\&|X\rPID|1\rNK1|1\rOBR|1' });
    expect(ok.status).toBe('received');
    expect(await inT(B, (tx) => tx.inboundEvent.count({ where: { id: ok.id } }))).toBe(0);
  });
});
