/**
 * S01 · Migrasi `20261008900000_lis_hl7_segment_allowlist` (audit agen BUG, 4.1a): pesan analyzer `lis-hl7` di
 * `inbound_events` hanya boleh berisi segmen daftar izin (MSH/SFT/ORC/OBR/OBX/NTE/SPM/TQ1) atau segmen lain dalam
 * bentuk teredaksi `SEG|1`. PV1/GT1/segmen Z mentah ditolak; PID/NK1 berisi tetap ditolak; sumber lain tidak terkena.
 * Constraint sudah VALID di DB tes (tanpa baris lama yang melanggar). Data fiktif.
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  ensureSystemRoles,
  type PrismaClient,
  seedHospitalStructure,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
let tenantId: string;
let deviceId: string;

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  tenantId = newId();
  await withTenant(owner, tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, code: `HL${tenantId.slice(-6).toUpperCase()}`, name: 'RS Fiktif Uji HL7' },
    });
    await ensureSystemRoles(tx, tenantId);
    await seedHospitalStructure(tx, tenantId);
  });
  deviceId = newId();
  await withTenant(app, tenantId, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'LAB' } });
    const now = Date.now();
    // Analyzer belum mendaftar (cukup sebagai pengirim untuk constraint `inbound_events_lis_device`).
    await tx.registeredDevice.create({
      data: {
        id: deviceId,
        tenantId,
        kind: 'lab_analyzer',
        name: 'Analyzer uji HL7',
        unitId: unit.id,
        enrolCodeHash: 'a'.repeat(64),
        enrolExpiresAt: new Date(now + 3_600_000),
        expiresAt: new Date(now + 30 * 86_400_000),
      },
    });
  });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const insert = (rawBody: string, source = 'lis-hl7') =>
  withTenant(app, tenantId, (tx) =>
    tx.inboundEvent.create({
      data: {
        id: newId(),
        tenantId,
        source,
        idempotencyKey: newId(),
        headers: {},
        rawBody,
        deviceId: source === 'lis-hl7' ? deviceId : null,
      },
    }),
  );
const failure = (p: Promise<unknown>) => p.then(() => null).catch((e: Error) => e.message);

describe('inbound_events · daftar izin segmen HL7 analyzer', () => {
  it('constraint VALID (bukan NOT VALID) di DB tes', async () => {
    const rows = await owner.$queryRaw<Array<{ convalidated: boolean }>>`
      SELECT convalidated FROM pg_constraint WHERE conname = 'inbound_events_hl7_segment_allowlist'`;
    expect(rows).toEqual([{ convalidated: true }]);
  });

  it('PV1, GT1, dan segmen Z mentah ditolak; PID/NK1 berisi tetap ditolak', async () => {
    for (const seg of [
      'PV1|1|I|MELATI^M-205||||9999^dr. Fiktif',
      'GT1|1||WULANDARI^BUDI||Jl. Kenanga 12',
      'ZPI|1|WULANDARI',
      'PID|1||RM-777||WULANDARI^RINA',
      'NK1|1|WULANDARI^BUDI',
    ]) {
      expect(await failure(insert(`MSH|^~\\&|ALAT|LAB\r${seg}\rOBR|1||L1`)), seg).toMatch(
        /inbound_events_hl7_segment_allowlist|inbound_events_hl7_redacted/,
      );
    }
  });

  it('bentuk teredaksi `SEG|1` dan segmen daftar izin diterima; sumber lain tidak terkena', async () => {
    const ok = await insert(
      [
        'MSH|^~\\&|ALAT|LAB|SIMRS|RS|20261007100000||ORU^R01|C1|P|2.5',
        'PID|1',
        'NK1|1',
        'PV1|1',
        'GT1|1',
        'ZPI|1',
        'ORC|RE|PL1|L1',
        'OBR|1||L1|ELEK',
        'OBX|1|NM|2823-3^Kalium^LN||4,1|mmol/L',
        'NTE|1||Hemolisis ringan',
        'SPM|1|L1',
      ].join('\r'),
    );
    expect(ok.status).toBe('received');
    const other = await insert('MSH|^~\\&|X\rPV1|1|I|bebas', 'uji');
    expect(other.status).toBe('received');
  });
});
