import { createPrismaClient, insertPatient, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { formatJam, newId } from '@simrs/shared';
import { encryptField, generateTotpSecret, hashPassword, PatientCrypto } from '@simrs/shared/node';
import { type Account, inTenant, TENANTS, totpFor } from './accounts';
import { e2eFieldKeys } from './field-keys';
import { E2E_API_PORT } from './slot';

/**
 * Fase 3 layar W4 · fixture E2E Rawat inap mode api. Setiap tes memakai bangsal fiktif SENDIRI (unit + kamar + satu
 * bed), staf yang ditugaskan ke bangsal itu, dan pasien yang diadmisi lewat API sungguhan (`POST /adt/admissions`:
 * bed terisi, gelang terbit, DPJP masuk tim perawatan). Jadi tes paralel (desktop/tablet) tidak saling melihat
 * pasien. Order obat + jadwal dibuat langsung di DB (seperti tes API 3.5) agar jam dosis pasti "kini".
 */

const RSFA = TENANTS.RSFA;
const API = `http://127.0.0.1:${E2E_API_PORT}/api/v1`;

let owner: PrismaClient | undefined;
/** Role migrator: master struktur RS (unit, lokasi, status bed) seperti seed. */
function migrator(): PrismaClient {
  owner ??= createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  return owner;
}

export interface Ward {
  unitId: string;
  unitName: string;
  bedId: string;
  bedCode: string;
}

export async function createWard(): Promise<Ward> {
  const tag = newId().replaceAll('-', '').slice(-8).toUpperCase();
  return withTenant(migrator(), RSFA, async (tx) => {
    const facility = await tx.facility.findFirstOrThrow({ where: { code: 'UTAMA' } });
    const unitId = newId();
    const unitName = `Bangsal E2E ${tag}`;
    await tx.unit.create({
      data: {
        id: unitId,
        tenantId: RSFA,
        facilityId: facility.id,
        code: `E2E-RI-${tag}`,
        name: unitName,
        kind: 'rawat_inap',
      },
    });
    const roomId = newId();
    await tx.location.create({
      data: {
        id: roomId,
        tenantId: RSFA,
        unitId,
        kind: 'kamar',
        code: `E2E-K-${tag}`,
        name: `Kamar ${tag}`,
        careClass: 'kelas_1',
      },
    });
    const bedId = newId();
    const bedCode = `E2E-${tag}-A`;
    await tx.location.create({
      data: {
        id: bedId,
        tenantId: RSFA,
        unitId,
        parentId: roomId,
        kind: 'bed',
        code: bedCode,
        name: 'Bed A',
        careClass: 'kelas_1',
      },
    });
    await tx.bedStatus.create({ data: { id: newId(), tenantId: RSFA, locationId: bedId, unitId } });
    return { unitId, unitName, bedId, bedCode };
  });
}

/** Akun staf ber-MFA dengan satu penugasan di unit `unitId` (null = semua unit). */
export async function createStaff(
  role: string,
  unitId: string | null,
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
  const passwordHash = await hashPassword(acc.password);
  await inTenant(RSFA, async (tx) => {
    await tx.user.create({
      data: { id, tenantId: RSFA, username: acc.username, displayName, mustChangePassword: false },
    });
    await tx.userCredential.create({ data: { userId: id, tenantId: RSFA, passwordHash } });
    const roleRow = await tx.role.findFirstOrThrow({ where: { code: role } });
    await tx.staffAssignment.create({
      data: { id: newId(), tenantId: RSFA, userId: id, roleId: roleRow.id, unitId },
    });
    await tx.mfaFactor.create({
      data: {
        id: newId(),
        tenantId: RSFA,
        userId: id,
        secretEnc: encryptField(acc.totpSecret as string, {
          ring: e2eFieldKeys().enc,
          tenantId: RSFA,
          purpose: 'mfa_secret',
        }),
        confirmedAt: new Date(),
      },
    });
  });
  return acc;
}

/** Token akses API untuk akun uji (login + MFA), untuk menyiapkan data lewat API sungguhan. */
async function apiToken(acc: Account): Promise<string> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantCode: acc.tenantCode, username: acc.username, password: acc.password }),
  });
  const step1 = (await login.json()) as { status: string; challengeToken: string };
  if (step1.status !== 'mfa_required') throw new Error(`Login API uji gagal: ${login.status}`);
  const verify = await fetch(`${API}/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeToken: step1.challengeToken, code: totpFor(acc.totpSecret as string) }),
  });
  const step2 = (await verify.json()) as { accessToken?: string };
  if (!step2.accessToken) throw new Error(`Verifikasi MFA API uji gagal: ${verify.status}`);
  return step2.accessToken;
}

export interface Inpatient {
  encounterId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  wristbandCode: string;
}

/**
 * Pasien fiktif + rencana admisi rawat inap (DPJP = praktisi akun `dpjp`), lalu diadmisi ke bed bangsal oleh
 * petugas admisi lewat API (`POST /adt/admissions`).
 */
export async function admitPatient(ward: Ward, dpjp: Account, patientName: string): Promise<Inpatient> {
  const crypto = new PatientCrypto(e2eFieldKeys(), RSFA);
  const { patient, encounterId } = await inTenant(RSFA, async (tx) => {
    const patient = await insertPatient(tx, crypto, {
      name: patientName,
      sex: 'male',
      birthDate: '1961-08-17',
    });
    const practitionerId = newId();
    await tx.practitioner.create({
      data: {
        id: practitionerId,
        tenantId: RSFA,
        userId: dpjp.id,
        name: dpjp.displayName,
        profession: 'dokter',
      },
    });
    const encounterId = newId();
    await tx.encounter.create({
      data: {
        id: encounterId,
        tenantId: RSFA,
        number: `RI-E2E-${encounterId.slice(-8)}`,
        patientId: patient.id,
        encounterClass: 'IMP',
        status: 'planned',
        unitId: ward.unitId,
        practitionerId,
        plannedAt: new Date(),
      },
    });
    return { patient, encounterId };
  });
  const admisi = await createStaff('petugas_pendaftaran', null, 'Admisi E2E Fiktif');
  const res = await fetch(`${API}/adt/admissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await apiToken(admisi)}` },
    body: JSON.stringify({ encounterId, locationId: ward.bedId, initialDiagnosis: null }),
  });
  const body = (await res.json()) as { wristbandCode?: string; message?: string };
  if (res.status !== 201 || !body.wristbandCode)
    throw new Error(`Admisi uji gagal ${res.status}: ${body.message}`);
  return {
    encounterId,
    patientId: patient.id,
    patientName,
    mrn: patient.mrn,
    wristbandCode: body.wristbandCode,
  };
}

/** Menit penuh `inMinutes` dari sekarang (jadwal eMAR selalu di menit penuh). */
export function slotAt(inMinutes: number): Date {
  const t = new Date(Date.now() + inMinutes * 60_000);
  t.setSeconds(0, 0);
  return t;
}

/** Order obat aktif (DPJP) dengan satu dosis terjadwal `inMinutes` dari sekarang (atau PRN/stat tanpa jadwal). */
export async function orderMedication(
  inpatient: Inpatient,
  dpjp: Account,
  opts: { drug: string; highAlert?: boolean; frequency?: string; inMinutes?: number },
): Promise<{ medicationRequestId: string; scheduleId: string | null; time: string | null }> {
  return inTenant(RSFA, async (tx) => {
    const group = await tx.orderGroup.create({
      data: {
        id: newId(),
        tenantId: RSFA,
        encounterId: inpatient.encounterId,
        patientId: inpatient.patientId,
        idempotencyKey: newId(),
        requestHash: 'e'.repeat(64),
        orderedBy: dpjp.id,
        orderedRole: 'dokter',
      },
    });
    const drug = await tx.drug.findFirstOrThrow({ where: { name: opts.drug } });
    const frequency = opts.frequency ?? '3x1';
    const scheduled = frequency === 'prn' || frequency === 'stat' ? null : slotAt(opts.inMinutes ?? 1);
    const med = await tx.medicationRequest.create({
      data: {
        id: newId(),
        tenantId: RSFA,
        orderGroupId: group.id,
        encounterId: inpatient.encounterId,
        patientId: inpatient.patientId,
        drugId: drug.id,
        name: drug.name,
        dose: '1 ampul',
        route: 'IV',
        frequency,
        // Jam khusus = jam dosis uji, supaya papan eMAR tidak menambah jadwal bawaan frekuensi (mis. 14.00) hari ini.
        customTimes: scheduled ? [formatJam(scheduled)] : [],
        highAlert: !!opts.highAlert,
      },
    });
    await tx.orderStatusEvent.create({
      data: { id: newId(), tenantId: RSFA, medicationRequestId: med.id, status: 'aktif', changedBy: dpjp.id },
    });
    if (!scheduled) return { medicationRequestId: med.id, scheduleId: null, time: null };
    const slot = await tx.medicationSchedule.create({
      data: {
        id: newId(),
        tenantId: RSFA,
        medicationRequestId: med.id,
        encounterId: inpatient.encounterId,
        scheduledAt: scheduled,
      },
    });
    return { medicationRequestId: med.id, scheduleId: slot.id, time: formatJam(scheduled) };
  });
}

/** Peristiwa biaya pemberian obat (staging fase 5) untuk kunjungan ini. */
export function medicationBillables(encounterId: string) {
  return inTenant(RSFA, (tx) =>
    tx.billableEvent.findMany({
      where: { encounterId, kind: 'obat', sourceType: 'medication_administrations' },
      select: { sourceId: true },
    }),
  );
}

/** Notifikasi eskalasi EWS untuk pengguna (tanpa PHI di judul/isi). */
export function ewsNotifications(userId: string) {
  return inTenant(RSFA, (tx) =>
    tx.notification.findMany({
      where: { recipientUserId: userId, kind: 'ews_escalation' },
      select: { title: true, body: true, link: true },
    }),
  );
}
