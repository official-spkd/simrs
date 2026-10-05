/**
 * Fase 3 · potongan 3.0b · Skema I klinis (migrasi `20261006000000_clinical_records`, ADR-0028): pola entri klinis
 * berversi (append-only juga bagi pemilik, rantai versi, satu pengganti per versi, alasan koreksi, kunci TTE, waktu
 * catat dari server), view `_current`, kode baku dari `ref`, atestasi co-sign sekali, tim perawatan tutup-sekali,
 * RLS/isolasi tenant, dan sinkron izin klinis ke peran RS yang sudah ada.
 */
import { newId, PERMISSION_CATALOG_BASELINE, PERMISSION_CATALOG_RECORD_KEY } from '@simrs/shared';
import { newVerifyCode, PatientCrypto, sha256Hex } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  ensureSystemRoles,
  insertPatient,
  type PrismaClient,
  seedHospitalStructure,
  syncRolePermissions,
  type TenantTx,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

const keys = {
  encKeyB64: Buffer.alloc(32, 51).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 53).toString('base64'),
};

let app: PrismaClient;
let owner: PrismaClient;

interface Ctx {
  tenantId: string;
  patientId: string;
  encounterId: string;
  doctor: string;
  resident: string;
  nurse: string;
}
let A: Ctx;
let B: Ctx;

async function freshTenant(): Promise<Ctx> {
  const tenantId = newId();
  await withTenant(owner, tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, code: `KL${tenantId.slice(-6).toUpperCase()}`, name: 'RS Fiktif Uji Klinis' },
    });
    await ensureSystemRoles(tx, tenantId);
    await seedHospitalStructure(tx, tenantId);
  });
  return withTenant(app, tenantId, async (tx) => {
    const p = await insertPatient(tx, new PatientCrypto(keys, tenantId), {
      name: 'Tn. Uji Klinis',
      sex: 'male',
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
      doctor: await user('dr. DPJP Uji'),
      resident: await user('dr. Residen Uji'),
      nurse: await user('Ns. Perawat Uji'),
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

/** Kolom bersama entri berversi versi 1. */
function base(c: Ctx, author: string, role = 'dokter') {
  const id = newId();
  return {
    id,
    tenantId: c.tenantId,
    patientId: c.patientId,
    encounterId: c.encounterId,
    rootId: id,
    version: 1,
    occurredAt: new Date(Date.now() - 60_000),
    authorUserId: author,
    authorRole: role,
  };
}

/** Versi koreksi berikut dari `prev`. */
function correction(
  prev: { id: string; rootId: string; version: number },
  reason = 'Koreksi salah tulis dosis',
) {
  return {
    id: newId(),
    rootId: prev.rootId,
    version: prev.version + 1,
    supersedesId: prev.id,
    correctionReason: reason,
  };
}

const soap = (s: string) => ({ s, o: '', a: 'Pneumonia membaik', p: '' });

function cppt(c: Ctx, author = c.doctor, over: Record<string, unknown> = {}) {
  return { ...base(c, author), ppa: 'dpjp', format: 'soap', content: soap('Sesak berkurang'), ...over };
}

describe('pola entri klinis berversi', () => {
  it('append-only: UPDATE/DELETE ditolak bagi aplikasi (hak) dan pemilik tabel (trigger)', async () => {
    const e = cppt(A);
    await inA((tx) => tx.cpptEntry.create({ data: e }));
    await expect(
      inA((tx) => tx.cpptEntry.update({ where: { id: e.id }, data: { instruction: 'x' } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inA((tx) => tx.$executeRaw`DELETE FROM cppt_entries WHERE id = ${e.id}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inA((tx) => tx.$executeRaw`UPDATE cppt_entries SET instruction = 'x' WHERE id = ${e.id}::uuid`, owner),
    ).rejects.toThrow(/APPEND_ONLY/);
    await expect(
      inA((tx) => tx.$executeRaw`DELETE FROM cppt_entries WHERE id = ${e.id}::uuid`, owner),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('setiap tabel klinis berversi dan anak append-only: trigger penolak, hanya SELECT/INSERT bagi aplikasi', async () => {
    const tables = [
      'observations',
      'diagnostic_reports',
      'conditions',
      'procedures',
      'allergy_intolerances',
      'cppt_entries',
      'handovers',
      'consult_requests',
      'consult_responses',
      'consents',
      'discharge_summaries',
      'consent_signatures',
      'discharge_medications',
      'discharge_summary_sources',
      'clinical_attestations',
    ];
    const rows = await owner.$queryRaw<
      Array<{ t: string; upd: boolean; del: boolean; ins: boolean; reject: boolean; guard: boolean }>
    >`
      SELECT t,
             has_table_privilege('simrs_app', 'public.' || t, 'UPDATE') AS upd,
             has_table_privilege('simrs_app', 'public.' || t, 'DELETE') AS del,
             has_table_privilege('simrs_app', 'public.' || t, 'INSERT') AS ins,
             EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid
                     WHERE g.tgrelid = ('public.' || t)::regclass AND p.proname = 'app_reject_mutation') AS reject,
             EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid
                     WHERE g.tgrelid = ('public.' || t)::regclass AND p.proname = 'app_clinical_guard') AS guard
      FROM unnest(${tables}::text[]) AS t`;
    for (const r of rows) {
      expect({ t: r.t, upd: r.upd, del: r.del, ins: r.ins, reject: r.reject }).toEqual({
        t: r.t,
        upd: false,
        del: false,
        ins: true,
        reject: true,
      });
    }
    expect(
      rows
        .filter((r) => r.guard)
        .map((r) => r.t)
        .sort(),
    ).toEqual(tables.slice(0, 11).sort());
  });

  it('koreksi: versi + 1 beralasan; dua koreksi serentak atas versi sama → tepat satu lolos (unik)', async () => {
    const v1 = cppt(A);
    await inA((tx) => tx.cpptEntry.create({ data: v1 }));
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        inA((tx) =>
          tx.cpptEntry.create({ data: { ...cppt(A), ...correction(v1), content: soap('Revisi') } }),
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/supersedes_once|root_id_version|Unique constraint/);
    const current = await inA(
      (tx) => tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT id, version FROM cppt_entries_current WHERE root_id = ${v1.rootId}::uuid`,
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.version).toBe(2);
  });

  it('CHECK: koreksi tanpa alasan atau alasan < 10 karakter ditolak; salah entri wajib versi baru beralasan', async () => {
    const v1 = cppt(A);
    await inA((tx) => tx.cpptEntry.create({ data: v1 }));
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A), ...correction(v1, 'typo') } })),
    ).rejects.toThrow(/cppt_entries_version_chain/);
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A), ...correction(v1), correctionReason: null } })),
    ).rejects.toThrow(/cppt_entries_version_chain/);
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A), status: 'entered_in_error' } })),
    ).rejects.toThrow(/cppt_entries_version_chain/);
    await inA((tx) =>
      tx.cpptEntry.create({
        data: { ...cppt(A), ...correction(v1, 'Salah pasien, dicatat ulang'), status: 'entered_in_error' },
      }),
    );
  });

  it('rantai: versi melompat, akar lain, atau kunjungan lain ditolak (CLINICAL_CHAIN)', async () => {
    const v1 = cppt(A);
    await inA((tx) => tx.cpptEntry.create({ data: v1 }));
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A), ...correction(v1), version: 3 } })),
    ).rejects.toThrow(/CLINICAL_CHAIN/);
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A), ...correction(v1), rootId: newId() } })),
    ).rejects.toThrow(/CLINICAL_CHAIN/);
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A), ...correction({ ...v1, id: newId() }) } })),
    ).rejects.toThrow(/CLINICAL_CHAIN|foreign key/);
  });

  it('waktu catat dari server, waktu kejadian tidak boleh di masa depan', async () => {
    const e = { ...cppt(A), recordedAt: new Date('2001-01-01T00:00:00Z') };
    await inA((tx) => tx.cpptEntry.create({ data: e }));
    const stored = await inA((tx) => tx.cpptEntry.findUniqueOrThrow({ where: { id: e.id } }));
    expect(Math.abs(stored.recordedAt.getTime() - Date.now())).toBeLessThan(60_000);
    await expect(
      inA((tx) =>
        tx.cpptEntry.create({ data: { ...cppt(A), occurredAt: new Date(Date.now() + 3_600_000) } }),
      ),
    ).rejects.toThrow(/cppt_entries_author_time/);
  });

  it('versi ber-TTE tidak bisa digantikan (RECORD_LOCKED); addendum boleh; addendum atas versi lama ditolak', async () => {
    const v1 = {
      ...base(A, A.doctor),
      kind: 'rawat_inap',
      sections: { diagnosis: 'Pneumonia' },
      disposition: 'pulang',
      dischargeCondition: 'Membaik',
    };
    await inA((tx) => tx.dischargeSummary.create({ data: v1 }));
    const docId = newId();
    await inA(async (tx) => {
      await tx.document.create({
        data: {
          id: docId,
          tenantId: A.tenantId,
          patientId: A.patientId,
          kind: 'resume',
          title: 'Resume medis',
          fileName: 'resume.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          sha256: sha256Hex(docId),
          storageKey: `${A.tenantId}/2026/10/${newId()}`,
          sourceType: 'discharge_summaries',
          sourceId: v1.id,
        },
      });
      await tx.documentSignature.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          documentId: docId,
          signerUserId: A.doctor,
          documentSha256: sha256Hex(docId),
          verifyCode: newVerifyCode(A.tenantId),
        },
      });
    });
    await expect(
      inA((tx) => tx.dischargeSummary.create({ data: { ...v1, ...correction(v1) } })),
    ).rejects.toThrow(/RECORD_LOCKED/);
    const add = { ...v1, ...base(A, A.nurse, 'perawat'), addendumOf: v1.id };
    await inA((tx) => tx.dischargeSummary.create({ data: add }));
    // Dokumen sumber wajib berpasangan tipe + id.
    await expect(
      inA((tx) =>
        tx.document.create({
          data: {
            id: newId(),
            tenantId: A.tenantId,
            patientId: A.patientId,
            kind: 'resume',
            title: 'x',
            fileName: 'x.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1,
            sha256: sha256Hex('x'),
            storageKey: `${A.tenantId}/2026/10/${newId()}`,
            sourceType: 'discharge_summaries',
          },
        }),
      ),
    ).rejects.toThrow(/documents_source_valid/);

    const c1 = cppt(A);
    await inA((tx) => tx.cpptEntry.create({ data: c1 }));
    await inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A), ...correction(c1) } }));
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: { ...cppt(A, A.nurse), addendumOf: c1.id } })),
    ).rejects.toThrow(/RECORD_NOT_FINAL/);
  });

  it('RLS: tenant lain tidak melihat entri; FK komposit menolak pasien/kunjungan RS lain', async () => {
    const e = cppt(A);
    await inA((tx) => tx.cpptEntry.create({ data: e }));
    const seen = await withTenant(app, B.tenantId, (tx) => tx.cpptEntry.findMany({ where: { id: e.id } }));
    expect(seen).toEqual([]);
    const viaView = await withTenant(
      app,
      B.tenantId,
      (tx) => tx.$queryRaw<unknown[]>`SELECT id FROM cppt_entries_current WHERE id = ${e.id}::uuid`,
    );
    expect(viaView).toEqual([]);
    await expect(
      withTenant(app, B.tenantId, (tx) =>
        tx.cpptEntry.create({ data: { ...cppt(B), patientId: A.patientId, encounterId: A.encounterId } }),
      ),
    ).rejects.toThrow(/foreign key|Foreign key/);
    await expect(
      withTenant(app, B.tenantId, (tx) => tx.cpptEntry.create({ data: { ...cppt(A) } })),
    ).rejects.toThrow(/row-level security|foreign key|Foreign key/);
  });
});

describe('batasan per tabel klinis', () => {
  it('diagnosis: ICD-10 hanya dari ref; kunjungan wajib peran; problem list tanpa peran', async () => {
    const dx = (over: Record<string, unknown>) => ({
      ...base(A, A.doctor),
      kind: 'encounter',
      role: 'utama',
      code: 'J18.9',
      display: 'Pneumonia, tidak spesifik',
      clinicalStatus: 'active',
      ...over,
    });
    await inA((tx) => tx.condition.create({ data: dx({}) }));
    await expect(inA((tx) => tx.condition.create({ data: dx({ code: 'X99.9' }) }))).rejects.toThrow(
      /REF_CODE_UNKNOWN/,
    );
    await expect(inA((tx) => tx.condition.create({ data: dx({ role: null }) }))).rejects.toThrow(
      /conditions_values_valid/,
    );
    await inA((tx) => tx.condition.create({ data: dx({ kind: 'problem_list', role: null, code: 'E11.9' }) }));
    await expect(
      inA((tx) =>
        tx.procedure.create({ data: { ...base(A, A.doctor), code: '99.99', display: 'Tidak ada di ref' } }),
      ),
    ).rejects.toThrow(/REF_CODE_UNKNOWN/);
    await inA((tx) => tx.procedure.create({ data: { ...base(A, A.doctor), code: '89.52', display: 'EKG' } }));
  });

  it('observasi tanda vital dengan NEWS2; LOINC tak dikenal ditolak; skor hanya untuk kategori vital', async () => {
    const vital = {
      ...base(A, A.nurse, 'perawat'),
      category: 'vital',
      display: 'Tanda vital',
      components: {
        rr: 22,
        spo2: 95,
        onOxygen: false,
        sbp: 128,
        dbp: 80,
        hr: 92,
        consciousness: 'A',
        temp: 37.6,
      },
      ewsScore: 4,
      ewsMaxParam: 2,
    };
    await inA((tx) => tx.observation.create({ data: vital }));
    await expect(
      inA((tx) =>
        tx.observation.create({
          data: { ...base(A, A.nurse), category: 'lab', codeSystem: 'loinc', code: '9999-9', display: 'x' },
        }),
      ),
    ).rejects.toThrow(/REF_CODE_UNKNOWN/);
    await expect(
      inA((tx) =>
        tx.observation.create({
          data: {
            ...base(A, A.nurse),
            category: 'lab',
            codeSystem: 'loinc',
            code: '718-7',
            display: 'Hb',
            ewsScore: 2,
            ewsMaxParam: 1,
          },
        }),
      ),
    ).rejects.toThrow(/observations_values_valid/);
  });

  it('alergi: NKDA eksplisit tanpa isi; alergi wajib zat atau teks + kategori + kritikalitas', async () => {
    const al = (over: {
      kind: string;
      text?: string;
      category?: string;
      criticality?: string;
      reaction?: string;
    }) => ({
      ...base(A, A.nurse, 'perawat'),
      ...over,
    });
    await inA((tx) => tx.allergyIntolerance.create({ data: al({ kind: 'nkda' }) }));
    await expect(
      inA((tx) => tx.allergyIntolerance.create({ data: al({ kind: 'nkda', text: 'Amoksisilin' }) })),
    ).rejects.toThrow(/allergy_intolerances_values_valid/);
    await expect(
      inA((tx) =>
        tx.allergyIntolerance.create({
          data: al({ kind: 'alergi', category: 'obat', criticality: 'tinggi' }),
        }),
      ),
    ).rejects.toThrow(/allergy_intolerances_values_valid/);
    await inA((tx) =>
      tx.allergyIntolerance.create({
        data: al({
          kind: 'alergi',
          text: 'Amoksisilin',
          category: 'obat',
          criticality: 'tinggi',
          reaction: 'Urtikaria',
        }),
      }),
    );
  });

  it('CPPT: hanya catatan residen yang menunggu co-sign; persetujuan: tolak wajib alasan, tujuh butir', async () => {
    await expect(
      inA((tx) => tx.cpptEntry.create({ data: cppt(A, A.doctor, { cosignRequired: true }) })),
    ).rejects.toThrow(/cppt_entries_values_valid/);
    await inA((tx) =>
      tx.cpptEntry.create({
        data: cppt(A, A.resident, { ppa: 'residen', authorRole: 'dokter_residen', cosignRequired: true }),
      }),
    );
    const consent = (over: Record<string, unknown>) => ({
      ...base(A, A.doctor),
      procedure: 'Kolesistektomi laparoskopik',
      decision: 'setuju',
      information: Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, title: `Butir ${i}` })),
      informerUserId: A.doctor,
      explainedAt: new Date(Date.now() - 120_000),
      ...over,
    });
    await expect(inA((tx) => tx.consent.create({ data: consent({ decision: 'tolak' }) }))).rejects.toThrow(
      /consents_values_valid/,
    );
    await expect(inA((tx) => tx.consent.create({ data: consent({ information: [] }) }))).rejects.toThrow(
      /consents_values_valid/,
    );
    const c = consent({});
    await inA((tx) => tx.consent.create({ data: c }));
    await inA((tx) =>
      tx.consentSignature.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          consentId: c.id,
          signerKind: 'saksi_petugas',
          signerName: 'Ns. Perawat Uji',
          method: 'nama',
          staffUserId: A.nurse,
        },
      }),
    );
    await expect(
      inA((tx) =>
        tx.consentSignature.create({
          data: {
            id: newId(),
            tenantId: A.tenantId,
            consentId: c.id,
            signerKind: 'pasien',
            signerName: 'Tn. Uji',
            method: 'goresan',
          },
        }),
      ),
    ).rejects.toThrow(/consent_signatures_values_valid/);
  });
});

describe('atestasi, tim perawatan, draf', () => {
  it('co-sign: satu per entri walau dua DPJP serentak; target wajib ada untuk pasien yang sama', async () => {
    const note = cppt(A, A.resident, { ppa: 'residen', authorRole: 'dokter_residen', cosignRequired: true });
    await inA((tx) => tx.cpptEntry.create({ data: note }));
    const att = (userId: string) => ({
      id: newId(),
      tenantId: A.tenantId,
      patientId: A.patientId,
      encounterId: A.encounterId,
      targetType: 'cppt_entries',
      targetId: note.id,
      kind: 'cosign',
      userId,
      userRole: 'dokter',
    });
    const results = await Promise.allSettled(
      [A.doctor, A.nurse].map((u) => inA((tx) => tx.clinicalAttestation.create({ data: att(u) }))),
    );
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(
      inA((tx) =>
        tx.clinicalAttestation.create({ data: { ...att(A.doctor), kind: 'verify', targetId: newId() } }),
      ),
    ).rejects.toThrow(/CLINICAL_ATTESTATION/);
    await expect(
      inA((tx) =>
        tx.clinicalAttestation.create({ data: { ...att(A.doctor), kind: 'verify', targetType: 'users' } }),
      ),
    ).rejects.toThrow(/CLINICAL_ATTESTATION/);
  });

  it('tim perawatan: satu DPJP utama aktif; periode diakhiri sekali; tidak dihapus', async () => {
    const p = (userId: string, role = 'dpjp_utama') => ({
      id: newId(),
      tenantId: A.tenantId,
      encounterId: A.encounterId,
      userId,
      role,
    });
    const first = p(A.doctor);
    await inA((tx) => tx.encounterParticipant.create({ data: first }));
    await expect(inA((tx) => tx.encounterParticipant.create({ data: p(A.resident) }))).rejects.toThrow(
      /one_primary|Unique constraint/,
    );
    const end = { endedAt: new Date(), endedBy: A.doctor, endReason: 'Alih rawat ke DPJP lain' };
    await inA((tx) => tx.encounterParticipant.update({ where: { id: first.id }, data: end }));
    await expect(
      inA((tx) =>
        tx.encounterParticipant.update({ where: { id: first.id }, data: { ...end, endReason: 'Diganti' } }),
      ),
    ).rejects.toThrow(/PARTICIPANT_CLOSED/);
    await expect(
      inA((tx) => tx.encounterParticipant.update({ where: { id: first.id }, data: { role: 'konsultan' } })),
    ).rejects.toThrow(/permission denied/);
    await inA((tx) => tx.encounterParticipant.create({ data: p(A.resident) }));
    await expect(
      inA((tx) => tx.$executeRaw`DELETE FROM encounter_participants WHERE id = ${first.id}::uuid`, owner),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('draf bukan rekam medis: boleh diubah dan dihapus; satu per penulis × kunjungan × jenis', async () => {
    const d = {
      id: newId(),
      tenantId: A.tenantId,
      encounterId: A.encounterId,
      patientId: A.patientId,
      authorUserId: A.doctor,
      kind: 'cppt',
      content: { s: 'draf' },
    };
    await inA((tx) => tx.clinicalDraft.create({ data: d }));
    await inA((tx) => tx.clinicalDraft.update({ where: { id: d.id }, data: { content: { s: 'draf 2' } } }));
    await expect(inA((tx) => tx.clinicalDraft.create({ data: { ...d, id: newId() } }))).rejects.toThrow(
      /Unique/,
    );
    await inA((tx) => tx.clinicalDraft.delete({ where: { id: d.id } }));
  });
});

describe('perubahan tabel lama dan izin', () => {
  it('pasien rahasia (EP 10c) bisa ditandai aplikasi; isian formulir tertaut kunjungan', async () => {
    await inA((tx) => tx.patient.update({ where: { id: A.patientId }, data: { confidential: true } }));
    const [col] = await owner.$queryRaw<Array<{ enc: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'form_responses' AND column_name = 'encounter_id') AS enc`;
    expect(col?.enc).toBe(true);
  });

  it('izin klinis baru sampai ke peran RS yang sudah ada lewat sinkron (tanpa mengembalikan yang dicabut)', async () => {
    const t = await freshTenant();
    const clinicalResources = ['clinical', 'order', 'medication', 'triage', 'bed', 'consent', 'result'];
    await withTenant(owner, t.tenantId, async (tx) => {
      // Tiru RS yang berjalan sebelum fase 3: peran tanpa izin klinis, catatan katalog = katalog fase 2.
      await tx.rolePermission.deleteMany({ where: { resource: { in: clinicalResources } } });
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: t.tenantId, key: PERMISSION_CATALOG_RECORD_KEY } },
        update: { value: { v: 1, permissions: [...PERMISSION_CATALOG_BASELINE] } },
        create: {
          tenantId: t.tenantId,
          key: PERMISSION_CATALOG_RECORD_KEY,
          value: { v: 1, permissions: [...PERMISSION_CATALOG_BASELINE] },
        },
      });
    });
    const report = await withTenant(owner, t.tenantId, (tx) =>
      syncRolePermissions(tx, t.tenantId, 'hospital', { via: 'test' }),
    );
    expect(report.added).toEqual(
      expect.arrayContaining([
        { role: 'dokter', permission: 'clinical.cosign', scope: 'relationship' },
        { role: 'perawat', permission: 'medication.administer', scope: 'unit' },
        { role: 'petugas_pendaftaran', permission: 'bed.write', scope: 'all' },
      ]),
    );
    const doctor = await withTenant(owner, t.tenantId, (tx) =>
      tx.rolePermission.findMany({ where: { role: { code: 'dokter' }, resource: 'clinical' } }),
    );
    expect(doctor.map((g) => g.action).sort()).toEqual(['correct', 'cosign', 'read', 'sign', 'write']);
  });
});
