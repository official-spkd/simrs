/**
 * Fase 3 · potongan 3.0c · Skema II klinis (migrasi `20261006010000_clinical_adt_orders_emar`): hunian ganda ditolak
 * EXCLUDE (btree_gist), status bed berversi + jejak, gelang dan pindaian, pemberian obat tanpa pindai / tidak cocok /
 * kedaluwarsa / pengguna lain ditolak, dosis ganda ditolak, cek ganda high-alert, override CDS tanpa alasan ditolak,
 * triase turun tanpa alasan ditolak, outbox `held` tidak diklaim, lokasi pasien, isolasi tenant, seed master klinis.
 */
import { cdsRuleSchema, newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimDueOutbox,
  createPrismaClient,
  enqueueOutbox,
  ensureSystemRoles,
  insertPatient,
  type PrismaClient,
  SEED_ORDER_SETS,
  seedClinicalMasters,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

const keys = {
  encKeyB64: Buffer.alloc(32, 61).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 63).toString('base64'),
};

let app: PrismaClient;
let owner: PrismaClient;

interface Ctx {
  tenantId: string;
  nurse: string;
  nurse2: string;
  doctor: string;
  beds: string[];
  melati: string;
}
let A: Ctx;
let B: Ctx;
let seq = 0;

async function freshTenant(): Promise<Ctx> {
  const tenantId = newId();
  await withTenant(owner, tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, code: `KC${tenantId.slice(-6).toUpperCase()}`, name: 'RS Fiktif Uji ADT' },
    });
    await ensureSystemRoles(tx, tenantId);
    await seedHospitalStructure(tx, tenantId);
  });
  return withTenant(app, tenantId, async (tx) => {
    await seedClinicalMasters(tx, tenantId);
    const user = async (name: string) => {
      const id = newId();
      await tx.user.create({ data: { id, tenantId, username: `u.${id.slice(-10)}`, displayName: name } });
      return id;
    };
    const melati = (await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } })).id;
    const beds = (
      await tx.location.findMany({ where: { kind: 'bed', unitId: melati }, orderBy: { code: 'asc' } })
    ).map((l) => l.id);
    return {
      tenantId,
      nurse: await user('Ns. Satu'),
      nurse2: await user('Ns. Dua'),
      doctor: await user('dr. DPJP'),
      beds,
      melati,
    };
  });
}

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 3 });
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

/** Pasien + kunjungan rawat inap aktif di Melati. */
async function admitted(c: Ctx) {
  return inT(c, async (tx) => {
    const p = await insertPatient(tx, new PatientCrypto(keys, c.tenantId), {
      name: 'Tn. Uji Bed',
      sex: 'male',
      unidentified: true,
    });
    seq += 1;
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        number: `RI-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: c.melati,
        plannedAt: new Date(),
      },
    });
    return { patientId: p.id, encounterId: enc.id };
  });
}

const assign = (c: Ctx, e: { patientId: string; encounterId: string }, locationId: string, over = {}) =>
  inT(c, (tx) =>
    tx.bedAssignment.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        encounterId: e.encounterId,
        patientId: e.patientId,
        locationId,
        ...over,
      },
    }),
  );

describe('ADT dan bed', () => {
  it('EXCLUDE: satu bed tidak dihuni dua kunjungan; satu kunjungan tidak di dua bed sekaligus', async () => {
    const e1 = await admitted(A);
    const e2 = await admitted(A);
    await assign(A, e1, A.beds[0] as string);
    await expect(assign(A, e2, A.beds[0] as string)).rejects.toThrow(/bed_assignments_no_double_occupancy/);
    await expect(assign(A, e1, A.beds[1] as string)).rejects.toThrow(/bed_assignments_one_bed_per_encounter/);
  });

  it('transfer: periode lama ditutup sekali, lalu bed baru; bed lama bisa dihuni pasien lain', async () => {
    const e1 = await admitted(A);
    const e2 = await admitted(A);
    const first = await assign(A, e1, A.beds[2] as string, { startedAt: new Date(Date.now() - 3_600_000) });
    const end = new Date(Date.now() - 60_000);
    await inT(A, (tx) =>
      tx.bedAssignment.update({
        where: { id: first.id },
        data: { endedAt: end, endReason: 'transfer', endedBy: A.nurse },
      }),
    );
    await expect(
      inT(A, (tx) => tx.bedAssignment.update({ where: { id: first.id }, data: { endReason: 'pulang' } })),
    ).rejects.toThrow(/BED_ASSIGNMENT_CLOSED/);
    await assign(A, e1, A.beds[3] as string, { startedAt: end });
    await assign(A, e2, A.beds[2] as string);
    const loc = await inT(
      A,
      (tx) => tx.$queryRaw<Array<{ location_id: string; unit_id: string }>>`
        SELECT location_id, unit_id FROM app_patient_location(${e1.patientId}::uuid)`,
    );
    expect(loc).toEqual([{ location_id: A.beds[3], unit_id: A.melati }]);
    // Bukan bed → ditolak.
    await expect(assign(A, await admitted(A), A.melati)).rejects.toThrow(/foreign key|BED_LOCATION/);
  });

  it('status bed: versi + 1 wajib (konkurensi optimistis), jejak append-only otomatis', async () => {
    const bed = await inT(A, (tx) => tx.bedStatus.findFirstOrThrow({ where: { locationId: A.beds[4] } }));
    expect(bed).toMatchObject({ status: 'siap', version: 1 });
    await expect(
      inT(A, (tx) => tx.bedStatus.update({ where: { id: bed.id }, data: { status: 'kotor', version: 1 } })),
    ).rejects.toThrow(/BED_VERSION_CONFLICT/);
    await inT(A, (tx) =>
      tx.bedStatus.update({
        where: { id: bed.id },
        data: { status: 'kotor', version: 2, changedBy: A.nurse },
      }),
    );
    const events = await inT(A, (tx) =>
      tx.bedStatusEvent.findMany({ where: { bedStatusId: bed.id }, orderBy: { version: 'asc' } }),
    );
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.version])).toEqual([
      [null, 'siap', 1],
      ['siap', 'kotor', 2],
    ]);
    await expect(
      inT(
        A,
        (tx) => tx.$executeRaw`DELETE FROM bed_status_events WHERE bed_status_id = ${bed.id}::uuid`,
        owner,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
    // Terisi tanpa kunjungan ditolak.
    await expect(
      inT(A, (tx) => tx.bedStatus.update({ where: { id: bed.id }, data: { status: 'terisi', version: 3 } })),
    ).rejects.toThrow(/bed_status_values_valid/);
  });

  it('permintaan bed: satu terbuka per kunjungan; batal wajib alasan; tertutup beku', async () => {
    const e = await admitted(A);
    const req = (over = {}) => ({
      id: newId(),
      tenantId: A.tenantId,
      patientId: e.patientId,
      encounterId: e.encounterId,
      origin: 'igd',
      careClass: 'kelas_2',
      ...over,
    });
    const r = req();
    await inT(A, (tx) => tx.bedRequest.create({ data: r }));
    await expect(inT(A, (tx) => tx.bedRequest.create({ data: req() }))).rejects.toThrow(/Unique|one_open/);
    await expect(
      inT(A, (tx) =>
        tx.bedRequest.update({
          where: { id: r.id },
          data: { status: 'batal', closedAt: new Date(), closeReason: 'x' },
        }),
      ),
    ).rejects.toThrow(/bed_requests_values_valid/);
    await inT(A, (tx) =>
      tx.bedRequest.update({
        where: { id: r.id },
        data: {
          status: 'batal',
          closedAt: new Date(),
          closedBy: A.nurse,
          closeReason: 'Pasien pulang paksa',
        },
      }),
    );
    await expect(
      inT(A, (tx) =>
        tx.bedRequest.update({ where: { id: r.id }, data: { status: 'menunggu', closedAt: null } }),
      ),
    ).rejects.toThrow(/BED_REQUEST_CLOSED|bed_requests_values_valid/);
  });

  it('triase: turun dari saran tanpa alasan ditolak; di bawah batas protokol ditolak', async () => {
    const e = await admitted(A);
    const tri = (over: { chosenLevel: number; overrideReason?: string }) => {
      const id = newId();
      return {
        id,
        rootId: id,
        tenantId: A.tenantId,
        patientId: e.patientId,
        encounterId: e.encounterId,
        occurredAt: new Date(),
        authorUserId: A.nurse,
        authorRole: 'perawat',
        vitals: { sbp: 158, hr: 112, rr: 24, spo2: 94 },
        discriminators: ['nyeri_dada_kardiak'],
        suggestedLevel: 2,
        maxLevel: 3,
        reasons: ['Level 2: Nyeri dada khas jantung'],
        ...over,
      };
    };
    await expect(
      inT(A, (tx) => tx.triageAssessment.create({ data: tri({ chosenLevel: 3 }) })),
    ).rejects.toThrow(/triage_assessments_values_valid/);
    await expect(
      inT(A, (tx) =>
        tx.triageAssessment.create({
          data: tri({ chosenLevel: 4, overrideReason: 'Nyeri hilang, EKG normal' }),
        }),
      ),
    ).rejects.toThrow(/triage_assessments_values_valid/);
    await inT(A, (tx) =>
      tx.triageAssessment.create({
        data: tri({ chosenLevel: 3, overrideReason: 'Nyeri hilang, EKG normal' }),
      }),
    );
    await inT(A, (tx) => tx.triageAssessment.create({ data: tri({ chosenLevel: 1 }) }));
  });
});

/** Order obat aktif + jadwal + gelang + pindaian cocok milik `nurse`. */
async function medicationSetup(c: Ctx, opts: { highAlert?: boolean; scheduledAt?: Date } = {}) {
  const e = await admitted(c);
  return inT(c, async (tx) => {
    const drug = await tx.drug.findFirstOrThrow({
      where: { name: opts.highAlert ? 'Enoksaparin 60 mg/0,6 mL injeksi' : 'Seftriakson 2 g injeksi' },
    });
    const group = await tx.orderGroup.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        encounterId: e.encounterId,
        patientId: e.patientId,
        idempotencyKey: `uji-${newId()}`,
        requestHash: 'a'.repeat(64),
        orderedBy: c.doctor,
        orderedRole: 'dokter',
      },
    });
    const med = await tx.medicationRequest.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        orderGroupId: group.id,
        encounterId: e.encounterId,
        patientId: e.patientId,
        drugId: drug.id,
        name: drug.name,
        dose: '1 ampul',
        route: 'IV',
        frequency: '1x1_pagi',
        highAlert: drug.highAlert,
      },
    });
    const schedule = await tx.medicationSchedule.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        medicationRequestId: med.id,
        encounterId: e.encounterId,
        scheduledAt: opts.scheduledAt ?? new Date(),
      },
    });
    const band = await tx.patientWristband.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        encounterId: e.encounterId,
        patientId: e.patientId,
        code: `GL${newId().replace(/-/g, '').slice(-10).toUpperCase()}`,
        issuedBy: c.nurse,
      },
    });
    return { ...e, med, schedule, band };
  });
}

const scan = (c: Ctx, s: Awaited<ReturnType<typeof medicationSetup>>, userId: string, code = s.band.code) =>
  inT(c, (tx) =>
    tx.wristbandScan.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        encounterId: s.encounterId,
        patientId: s.patientId,
        wristbandId: code === s.band.code ? s.band.id : null,
        matched: code === s.band.code,
        scannedCode: code,
        userId,
      },
    }),
  );

const administer = (
  c: Ctx,
  s: Awaited<ReturnType<typeof medicationSetup>>,
  scanId: string,
  over: Record<string, unknown> = {},
) =>
  inT(c, (tx) =>
    tx.medicationAdministration.create({
      data: {
        id: newId(),
        tenantId: c.tenantId,
        medicationRequestId: s.med.id,
        scheduleId: s.schedule.id,
        encounterId: s.encounterId,
        patientId: s.patientId,
        wristbandScanId: scanId,
        status: 'given',
        occurredAt: new Date(Date.now() + 100),
        userId: c.nurse,
        userRole: 'perawat',
        labelCode: s.med.id,
        ...over,
      },
    }),
  );

describe('eMAR: gerbang gelang', () => {
  it('gelang: satu aktif per kunjungan; pindaian "cocok" palsu ditolak database', async () => {
    const s = await medicationSetup(A);
    await expect(
      inT(A, (tx) =>
        tx.patientWristband.create({
          data: {
            id: newId(),
            tenantId: A.tenantId,
            encounterId: s.encounterId,
            patientId: s.patientId,
            code: 'GLDUPLIKAT01',
          },
        }),
      ),
    ).rejects.toThrow(/Unique|one_active/);
    await expect(
      inT(A, (tx) =>
        tx.wristbandScan.create({
          data: {
            id: newId(),
            tenantId: A.tenantId,
            encounterId: s.encounterId,
            patientId: s.patientId,
            wristbandId: s.band.id,
            matched: true,
            scannedCode: 'KODE-LAIN',
            userId: A.nurse,
          },
        }),
      ),
    ).rejects.toThrow(/WRISTBAND_MISMATCH/);
  });

  it('pindaian tidak cocok / milik perawat lain ditolak; pindaian cocok → diberikan; dosis ganda ditolak', async () => {
    const s = await medicationSetup(A);
    const wrong = await scan(A, s, A.nurse, 'SALAH-0001');
    await expect(administer(A, s, wrong.id)).rejects.toThrow(/WRISTBAND_MISMATCH/);
    const other = await scan(A, s, A.nurse2);
    await expect(administer(A, s, other.id)).rejects.toThrow(/WRISTBAND_SCAN_REQUIRED/);
    const ok = await scan(A, s, A.nurse);
    await administer(A, s, ok.id);
    await expect(administer(A, s, ok.id)).rejects.toThrow(/one_given|Unique/);
    // Tanpa pindaian sama sekali tidak bisa dicatat (FK + NOT NULL).
    await expect(administer(A, s, newId())).rejects.toThrow(/WRISTBAND_MISMATCH|foreign key/);
    await expect(
      inT(
        A,
        (tx) =>
          tx.$executeRaw`DELETE FROM medication_administrations WHERE schedule_id = ${s.schedule.id}::uuid`,
        owner,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('ditunda/ditolak/terlambat wajib alasan; high-alert wajib cek ganda perawat lain', async () => {
    const s = await medicationSetup(A, { highAlert: true });
    const ok = await scan(A, s, A.nurse);
    await expect(administer(A, s, ok.id, { status: 'held' })).rejects.toThrow(
      /medication_administrations_values_valid/,
    );
    const delayed = await medicationSetup(A, { scheduledAt: new Date(Date.now() - 7_200_000) });
    const delayedScan = await scan(A, delayed, A.nurse);
    await expect(administer(A, delayed, delayedScan.id, { late: false })).rejects.toThrow(
      /medication_administrations_values_valid/,
    );
    await expect(administer(A, s, ok.id)).rejects.toThrow(/DOUBLE_CHECK_REQUIRED/);
    await expect(administer(A, s, ok.id, { doubleCheckUserId: A.nurse })).rejects.toThrow(
      /DOUBLE_CHECK_REQUIRED/,
    );
    await expect(administer(A, s, ok.id, { doubleCheckUserId: A.nurse2 })).rejects.toThrow(
      /DOUBLE_CHECK_REQUIRED/,
    );
    const occurredAt = new Date(Date.now() + 100);
    const check = await inT(A, (tx) =>
      tx.medicationDoubleCheck.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          medicationRequestId: s.med.id,
          wristbandScanId: ok.id,
          userId: A.nurse2,
          userRole: 'perawat',
          content: {
            medicationRequestId: s.med.id,
            scheduleId: s.schedule.id,
            scanId: ok.id,
            labelCode: s.med.id,
            status: 'given',
            occurredAt: occurredAt.toISOString(),
            reason: null,
          },
        },
      }),
    );
    await administer(A, s, ok.id, { doubleCheckUserId: A.nurse2, doubleCheckId: check.id, occurredAt });
    await expect(
      inT(
        A,
        (tx) => tx.$executeRaw`DELETE FROM medication_double_checks WHERE id = ${check.id}::uuid`,
        owner,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('pindaian kedaluwarsa (lewat emar.scan_valid_minutes) ditolak', async () => {
    const c = await freshTenant();
    await inT(c, (tx) =>
      tx.tenantSetting.create({ data: { tenantId: c.tenantId, key: 'emar.scan_valid_minutes', value: 0 } }),
    );
    const s = await medicationSetup(c);
    const old = await scan(c, s, c.nurse);
    await new Promise((r) => setTimeout(r, 20));
    await expect(administer(c, s, old.id)).rejects.toThrow(/WRISTBAND_SCAN_REQUIRED/);
  });
});

describe('order dan CDS', () => {
  it('override blok tanpa alasan ditolak; blok tidak bisa sekadar "diterima"; peringatan diterima', async () => {
    const s = await medicationSetup(A);
    const alert = (over: { decision: string; level?: string; rule?: string; overrideReason?: string }) => ({
      id: newId(),
      tenantId: A.tenantId,
      encounterId: s.encounterId,
      patientId: s.patientId,
      orderGroupId: s.med.orderGroupId,
      medicationRequestId: s.med.id,
      lineIndex: 0,
      ruleCode: 'alergi-silang-penisilin-sefalosporin-1',
      level: 'block',
      rule: 'alergi-silang',
      message: 'Diblokir: reaksi silang.',
      decidedBy: A.doctor,
      decidedRole: 'dokter',
      ...over,
    });
    await expect(
      inT(A, (tx) => tx.cdsAlert.create({ data: alert({ decision: 'override' }) })),
    ).rejects.toThrow(/cds_alerts_values_valid/);
    await expect(
      inT(A, (tx) =>
        tx.cdsAlert.create({ data: alert({ decision: 'override', overrideReason: 'singkat' }) }),
      ),
    ).rejects.toThrow(/cds_alerts_values_valid/);
    await expect(
      inT(A, (tx) => tx.cdsAlert.create({ data: alert({ decision: 'diterima' }) })),
    ).rejects.toThrow(/cds_alerts_values_valid/);
    await inT(A, (tx) =>
      tx.cdsAlert.create({
        data: alert({ decision: 'override', overrideReason: 'Riwayat sefalosporin aman tahun lalu' }),
      }),
    );
    await inT(A, (tx) =>
      tx.cdsAlert.create({ data: alert({ level: 'warn', rule: 'interaksi', decision: 'diterima' }) }),
    );
  });

  it('Idempotency-Key unik per RS; order beda kunjungan dari kirimannya ditolak; batal wajib alasan', async () => {
    const s = await medicationSetup(A);
    const group = await inT(A, (tx) => tx.orderGroup.findFirstOrThrow({ where: { id: s.med.orderGroupId } }));
    await expect(
      inT(A, (tx) => tx.orderGroup.create({ data: { ...group, id: newId(), orderedAt: undefined } })),
    ).rejects.toThrow(/Unique/);
    const other = await admitted(A);
    await expect(
      inT(A, (tx) =>
        tx.medicationRequest.create({
          data: {
            ...s.med,
            id: newId(),
            encounterId: other.encounterId,
            patientId: other.patientId,
            createdAt: undefined,
            compound: undefined,
          },
        }),
      ),
    ).rejects.toThrow(/ORDER_GROUP_MISMATCH/);
    await expect(
      inT(A, (tx) =>
        tx.orderStatusEvent.create({
          data: {
            id: newId(),
            tenantId: A.tenantId,
            medicationRequestId: s.med.id,
            status: 'dibatalkan',
            reason: 'x',
          },
        }),
      ),
    ).rejects.toThrow(/order_status_events_values_valid/);
    await expect(
      inT(
        A,
        (tx) => tx.$executeRaw`UPDATE medication_requests SET dose = '2 ampul' WHERE id = ${s.med.id}::uuid`,
        owner,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
  });
});

describe('staging, isolasi, seed', () => {
  it('outbox held tidak diklaim dispatcher; biaya unik per sumber × jenis', async () => {
    const msg = await inT(A, (tx) =>
      enqueueOutbox(
        tx,
        A.tenantId,
        {
          target: 'satusehat',
          operation: 'satusehat.encounter.upsert',
          idempotencyKey: `satusehat.encounter.upsert:${newId()}:1`,
          payload: { sourceId: newId(), revision: 1 },
        },
        { held: true },
      ),
    );
    expect(msg.status).toBe('held');
    const claimed = await inT(A, (tx) => claimDueOutbox(tx, 500, new Date(Date.now() + 86_400_000)));
    expect(claimed.map((m) => m.id)).not.toContain(msg.id);
    const e = await admitted(A);
    const ev = {
      tenantId: A.tenantId,
      encounterId: e.encounterId,
      patientId: e.patientId,
      sourceType: 'bed_assignments',
      sourceId: newId(),
      kind: 'admisi',
      occurredAt: new Date(),
    };
    await inT(A, (tx) => tx.billableEvent.create({ data: { id: newId(), ...ev } }));
    await expect(inT(A, (tx) => tx.billableEvent.create({ data: { id: newId(), ...ev } }))).rejects.toThrow(
      /Unique/,
    );
  });

  it('RLS: data ADT/order/eMAR RS lain tidak terlihat', async () => {
    const s = await medicationSetup(A);
    const reads: Array<(tx: TenantTx) => Promise<unknown[]>> = [
      (tx: TenantTx) => tx.medicationRequest.findMany({ where: { id: s.med.id } }),
      (tx: TenantTx) => tx.patientWristband.findMany({ where: { id: s.band.id } }),
      (tx: TenantTx) => tx.medicationSchedule.findMany({ where: { id: s.schedule.id } }),
    ];
    for (const read of reads) {
      expect(await inT(B, read)).toEqual([]);
    }
  });

  it('seed master klinis: idempoten, order set lengkap, KB CDS valid, kode hanya dari ref', async () => {
    const again = await inT(A, (tx) => seedClinicalMasters(tx, A.tenantId));
    expect(again).toEqual({ beds: 0, drugs: 0, orderables: 0, orderSets: 0, cdsRules: 0 });
    const sets = await inT(A, (tx) => tx.orderSet.findMany({ include: { items: true } }));
    expect(sets.map((s) => s.code).sort()).toEqual(SEED_ORDER_SETS.map(([code]) => code).sort());
    for (const [code, , items] of SEED_ORDER_SETS) {
      expect(sets.find((s) => s.code === code)?.items).toHaveLength(items.length);
    }
    const rules = await inT(A, (tx) => tx.cdsRule.findMany());
    expect(rules.length).toBeGreaterThanOrEqual(8);
    for (const r of rules)
      expect(cdsRuleSchema.safeParse({ code: r.code, definition: r.definition }).success).toBe(true);
    const melatiKelas2 = await inT(A, (tx) =>
      tx.location.count({ where: { kind: 'bed', careClass: 'kelas_2', unit: { code: 'MELATI' } } }),
    );
    expect(melatiKelas2).toBe(12);
    const bedsWithoutStatus = await inT(A, (tx) =>
      tx.location.count({ where: { kind: 'bed', bedStatus: null } }),
    );
    expect(bedsWithoutStatus).toBe(0);
    await expect(
      inT(A, (tx) =>
        tx.drug.create({
          data: {
            id: newId(),
            tenantId: A.tenantId,
            name: 'Obat kode karangan',
            dosageForm: 'tablet',
            codeSystem: 'kfa',
            code: '99999999',
          },
        }),
      ),
    ).rejects.toThrow(/REF_CODE_UNKNOWN/);
  });
});
