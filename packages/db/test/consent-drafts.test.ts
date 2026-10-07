/**
 * Fase 3 · potongan 3.7 · draf persetujuan tablet (migrasi `20261007200000_consent_drafts`, ADR-0058): bukan rekam
 * medis tetapi tutup-sekali (juga bagi pemilik tabel), tidak dihapus, final wajib tanda tangan + atestasi saksi petugas,
 * batal wajib alasan ≥ 10, waktu tanda tangan/atestasi dari server, RLS/isolasi tenant. Data fiktif.
 */
import {
  CONSENT_TEMPLATE_SAMPLE,
  EDUCATION_FORM_SAMPLE,
  educationFormSupportsConsent,
  newId,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  ensurePublishedForm,
  ensureSystemRoles,
  insertPatient,
  type PrismaClient,
  seedHospitalStructure,
  upgradePublishedForm,
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
  patientId: string;
  encounterId: string;
  formId: string;
  doctor: string;
  nurse: string;
}
let A: Ctx;
let B: Ctx;

async function freshTenant(): Promise<Ctx> {
  const tenantId = newId();
  const formId = await withTenant(owner, tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        code: `CD${tenantId.slice(-6).toUpperCase()}`,
        name: 'RS Fiktif Uji Persetujuan',
      },
    });
    await ensureSystemRoles(tx, tenantId);
    await seedHospitalStructure(tx, tenantId);
    await ensurePublishedForm(tx, tenantId, CONSENT_TEMPLATE_SAMPLE);
    return (await tx.formDefinition.findFirstOrThrow({ where: { code: CONSENT_TEMPLATE_SAMPLE.code } })).id;
  });
  return withTenant(app, tenantId, async (tx) => {
    const p = await insertPatient(tx, new PatientCrypto(keys, tenantId), {
      name: 'Ny. Uji Persetujuan',
      sex: 'female',
      unidentified: true,
    });
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId,
        number: `RI-2610-${tenantId.slice(-6)}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        plannedAt: new Date(),
      },
    });
    const user = async (name: string) => {
      const id = newId();
      await tx.user.create({ data: { id, tenantId, username: `u.${id.slice(-10)}`, displayName: name } });
      return id;
    };
    return {
      tenantId,
      patientId: p.id,
      encounterId: enc.id,
      formId,
      doctor: await user('dr. Uji Persetujuan'),
      nurse: await user('Ns. Uji Saksi'),
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

const inA = <T>(fn: (tx: TenantTx) => Promise<T>, client: PrismaClient = app) =>
  withTenant(client, A.tenantId, fn);

const information = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, title: `Butir ${i}`, body: 'Isi' }));
const signer = { name: 'Ny. Uji Persetujuan', relation: null, method: 'nama', imageDocumentId: null };

async function draft(c: Ctx = A): Promise<string> {
  const id = newId();
  await withTenant(app, c.tenantId, (tx) =>
    tx.consentDraft.create({
      data: {
        id,
        tenantId: c.tenantId,
        patientId: c.patientId,
        encounterId: c.encounterId,
        formDefinitionId: c.formId,
        procedure: 'Pungsi lumbal',
        signerKind: 'pasien',
        information,
        createdBy: c.nurse,
      },
    }),
  );
  return id;
}

describe('consent_drafts (K11)', () => {
  it('draf baru harus `draf` tanpa tanda tangan; waktu tanda tangan dan atestasi dari server', async () => {
    await expect(
      inA((tx) =>
        tx.consentDraft.create({
          data: {
            id: newId(),
            tenantId: A.tenantId,
            patientId: A.patientId,
            encounterId: A.encounterId,
            formDefinitionId: A.formId,
            procedure: 'Pungsi lumbal',
            signerKind: 'pasien',
            information,
            signer,
            signedAt: new Date(),
            createdBy: A.nurse,
          },
        }),
      ),
    ).rejects.toThrow(/CONSENT_CLOSED/);
    const id = await draft();
    const past = new Date('2020-01-01T00:00:00Z');
    const row = await inA((tx) =>
      tx.consentDraft.update({
        where: { id },
        data: { signer, signedAt: past, staffWitnessUserId: A.nurse, staffWitnessedAt: past },
      }),
    );
    expect(row.signedAt?.getTime()).toBeGreaterThan(past.getTime());
    expect(row.staffWitnessedAt?.getTime()).toBeGreaterThan(past.getTime());
  });

  it('final tanpa tanda tangan/saksi ditolak CHECK; batal wajib alasan ≥ 10', async () => {
    const id = await draft();
    const consentId = newId();
    await expect(
      inA((tx) =>
        tx.consentDraft.update({
          where: { id },
          data: { status: 'final', consentId, closedAt: new Date(), closedBy: A.doctor },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      inA((tx) =>
        tx.consentDraft.update({
          where: { id },
          data: { status: 'batal', cancelReason: 'pendek', closedAt: new Date(), closedBy: A.nurse },
        }),
      ),
    ).rejects.toThrow();
  });

  it('tutup-sekali (juga pemilik tabel) dan tidak bisa dihapus', async () => {
    const id = await draft();
    await inA((tx) =>
      tx.consentDraft.update({
        where: { id },
        data: {
          status: 'batal',
          cancelReason: 'Dijadwal ulang DPJP',
          closedAt: new Date(),
          closedBy: A.nurse,
        },
      }),
    );
    await expect(
      inA((tx) => tx.consentDraft.update({ where: { id }, data: { procedure: 'Diubah' } })),
    ).rejects.toThrow(/CONSENT_CLOSED/);
    await expect(
      inA((tx) => tx.consentDraft.update({ where: { id }, data: { procedure: 'Diubah' } }), owner),
    ).rejects.toThrow(/CONSENT_CLOSED/);
    await expect(inA((tx) => tx.consentDraft.delete({ where: { id } }))).rejects.toThrow();
    await expect(inA((tx) => tx.consentDraft.delete({ where: { id } }), owner)).rejects.toThrow(
      /APPEND_ONLY/,
    );
    // Kolom pembuat/identitas beku bagi role aplikasi.
    const open = await draft();
    await expect(
      inA((tx) => tx.consentDraft.update({ where: { id: open }, data: { createdBy: A.doctor } })),
    ).rejects.toThrow();
  });

  it('RLS: draf tenant lain tidak terlihat dan tidak bisa ditulis', async () => {
    const id = await draft(B);
    expect(await inA((tx) => tx.consentDraft.count({ where: { id } }))).toBe(0);
    const updated = await inA((tx) =>
      tx.consentDraft.updateMany({ where: { id }, data: { procedure: 'Lintas tenant' } }),
    );
    expect(updated.count).toBe(0);
    await expect(
      inA((tx) =>
        tx.consentDraft.create({
          data: {
            id: newId(),
            tenantId: B.tenantId,
            patientId: B.patientId,
            encounterId: B.encounterId,
            formDefinitionId: B.formId,
            procedure: 'Pungsi lumbal',
            signerKind: 'pasien',
            information,
            createdBy: B.nurse,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('seed: formulir edukasi lama tanpa topik tindakan dinaikkan versinya sekali (syarat final persetujuan)', async () => {
    const old = {
      ...EDUCATION_FORM_SAMPLE,
      schema: {
        sections: EDUCATION_FORM_SAMPLE.schema.sections.map((sec) => ({
          ...sec,
          fields: sec.fields.map((f) =>
            f.key === 'topik' ? { ...f, options: f.options?.filter((o) => o.value !== 'tindakan') } : f,
          ),
        })),
      },
    };
    const versions = await inA(async (tx) => {
      await ensurePublishedForm(tx, A.tenantId, old);
      const first = await upgradePublishedForm(
        tx,
        A.tenantId,
        EDUCATION_FORM_SAMPLE,
        educationFormSupportsConsent,
      );
      const again = await upgradePublishedForm(
        tx,
        A.tenantId,
        EDUCATION_FORM_SAMPLE,
        educationFormSupportsConsent,
      );
      const rows = await tx.formDefinition.findMany({
        where: { code: EDUCATION_FORM_SAMPLE.code },
        orderBy: { version: 'asc' },
        select: { version: true, status: true },
      });
      return { first: first.upgraded, again: again.upgraded, rows };
    }, owner);
    expect(versions).toEqual({
      first: true,
      again: false,
      rows: [
        { version: 1, status: 'archived' },
        { version: 2, status: 'published' },
      ],
    });
  });
});
