import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensurePublishedForm,
  insertPatient,
  type PrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  type TenantTx,
  upgradePublishedForm,
  withTenant,
} from '@simrs/db';
import {
  CONSENT_TEMPLATE_SAMPLE,
  EDUCATION_FORM_SAMPLE,
  educationFormSupportsConsent,
  MORSE_FALL_SCALE,
  newId,
} from '@simrs/shared';
import { encryptField, generateTotpSecret, hashPassword, PatientCrypto } from '@simrs/shared/node';
import type { Account } from './accounts';
import { e2eFieldKeys } from './field-keys';

/**
 * Fase 3 · fixture E2E klinis (potongan 3.1): struktur RS + master klinis RSFA (bed, obat, order set, KB CDS, templat
 * persetujuan tindakan), akun
 * DPJP (Melati), residen (IGD), perawat (Melati), admisi (pendaftaran), dan satu pasien beralergi amoksisilin
 * (alergi terkode, dicatat DPJP). Akun baru setiap run (nama pengguna unik); kredensial di berkas folder sementara E2E
 * (mode 0600), tidak pernah di repo. Dibaca spesifikasi klinis lewat `clinicalFixtures()`.
 */

export const CLINICAL_FIXTURES_FILE = 'clinical-fixtures.json';

export interface ClinicalFixtures {
  format: 1;
  tenantCode: 'RSFA';
  accounts: { dpjp: Account; residen: Account; perawat: Account; admisi: Account };
  allergicPatient: { id: string; mrn: string; allergy: string };
}

export async function account(
  tx: TenantTx,
  tenantId: string,
  role: string,
  unitCode: string | null,
  displayName: string,
): Promise<Account> {
  const id = newId();
  const acc: Account = {
    id,
    tenantCode: 'RSFA',
    username: `e2e.${id.slice(-12)}`,
    password: `frasa uji e2e panjang ${id.slice(-6)}`,
    displayName,
    totpSecret: generateTotpSecret(),
  };
  await tx.user.create({
    data: { id, tenantId, username: acc.username, displayName, mustChangePassword: false },
  });
  await tx.userCredential.create({
    data: { userId: id, tenantId, passwordHash: await hashPassword(acc.password) },
  });
  const roleRow = await tx.role.findFirstOrThrow({ where: { code: role } });
  const unitId = unitCode ? (await tx.unit.findFirstOrThrow({ where: { code: unitCode } })).id : null;
  await tx.staffAssignment.create({
    data: { id: newId(), tenantId, userId: id, roleId: roleRow.id, unitId },
  });
  await tx.mfaFactor.create({
    data: {
      id: newId(),
      tenantId,
      userId: id,
      secretEnc: encryptField(acc.totpSecret as string, {
        ring: e2eFieldKeys().enc,
        tenantId,
        purpose: 'mfa_secret',
      }),
      confirmedAt: new Date(),
    },
  });
  return acc;
}

/** Dipanggil global setup (role migrator; idempoten untuk master, akun + pasien baru tiap run). */
export async function ensureClinicalFixtures(prisma: PrismaClient, tenantId: string, tmpDir: string) {
  const fixtures = await withTenant(prisma, tenantId, async (tx) => {
    await seedHospitalStructure(tx, tenantId);
    await seedClinicalMasters(tx, tenantId);
    // S07/S08 (4.9): jenis diet + komponen darah untuk layar Gizi dan Bank darah mode api.
    await seedSupportMasters(tx, tenantId);
    // K11: templat persetujuan tindakan (tujuh butir) untuk tablet persetujuan mode api, dan edukasi terintegrasi
    // bertopik tindakan (syarat final persetujuan; versi lama tanpa topik itu dinaikkan seperti seed).
    await ensurePublishedForm(tx, tenantId, CONSENT_TEMPLATE_SAMPLE);
    await upgradePublishedForm(tx, tenantId, EDUCATION_FORM_SAMPLE, educationFormSupportsConsent);
    // K06/K15: asesmen Morse wajib di paket rawat inap; pastikan ada versi berlaku (tes Formulir bisa meninggalkan
    // hanya draf/arsip).
    await upgradePublishedForm(tx, tenantId, MORSE_FALL_SCALE, () => true);
    const accounts = {
      dpjp: await account(tx, tenantId, 'dokter', 'MELATI', 'dr. DPJP E2E Fiktif, Sp.PD'),
      residen: await account(tx, tenantId, 'dokter_residen', 'IGD', 'dr. Residen E2E Fiktif'),
      perawat: await account(tx, tenantId, 'perawat', 'MELATI', 'Ns. Perawat E2E Fiktif'),
      admisi: await account(tx, tenantId, 'petugas_pendaftaran', null, 'Admisi E2E Fiktif'),
    };
    const patient = await insertPatient(tx, new PatientCrypto(e2eFieldKeys(), tenantId), {
      name: 'Ny. Alergi Amoksisilin Fiktif',
      sex: 'female',
      birthDate: '1966-03-14',
    });
    const substance = await tx.drugSubstance.findUniqueOrThrow({
      where: { tenantId_code: { tenantId, code: 'amoksisilin' } },
    });
    const allergyId = newId();
    await tx.allergyIntolerance.create({
      data: {
        id: allergyId,
        rootId: allergyId,
        tenantId,
        patientId: patient.id,
        occurredAt: new Date(),
        authorUserId: accounts.dpjp.id,
        authorRole: 'dokter',
        kind: 'alergi',
        substanceId: substance.id,
        text: 'Amoksisilin',
        category: 'obat',
        criticality: 'tinggi',
        reaction: 'Urtikaria dan sesak',
      },
    });
    return { accounts, patient };
  });
  const data: ClinicalFixtures = {
    format: 1,
    tenantCode: 'RSFA',
    accounts: fixtures.accounts,
    allergicPatient: { id: fixtures.patient.id, mrn: fixtures.patient.mrn, allergy: 'amoksisilin' },
  };
  writeFileSync(join(tmpDir, CLINICAL_FIXTURES_FILE), JSON.stringify(data), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return data;
}

/** Fixture klinis run ini (ditulis global setup). */
export function clinicalFixtures(tmpDir: string): ClinicalFixtures {
  return JSON.parse(readFileSync(join(tmpDir, CLINICAL_FIXTURES_FILE), 'utf8')) as ClinicalFixtures;
}
