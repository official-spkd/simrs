import type { TenantTx } from '@simrs/db';
import { AppError, type ClinicalRevision } from '@simrs/shared';
import { DEV_ROLE } from '../../common/request-context';
import type { PermissionMatrix } from '../permission-matrix';
import type { TenantDb } from '../tenant-db';

/**
 * Bantuan bersama modul klinis potongan 3.2a/3.2b (diagnosis, hasil, observasi, ringkasan, CPPT, asesmen, worklist).
 * Fungsi murni atas `TenantDb` + layanan yang diberikan pemanggil, supaya aturan "kunjungan mana yang boleh ditulis",
 * "kelompok rekam medis", dan "koreksi butuh `clinical.correct`" tidak ditulis ulang di tiap modul.
 */

/** Pemeriksa akses pasien (ABAC), dipenuhi `PatientAccessService`. */
export interface PatientAccessChecker {
  assert(patientId: string): Promise<unknown>;
}

export interface ClinicalEncounter {
  id: string;
  patientId: string;
  status: string;
  encounterClass: string;
  unitId: string;
  practitionerId: string | null;
}

/**
 * Kunjungan untuk entri klinis: ada (RLS = tenant ini; tenant lain → 404), pasiennya boleh dibuka pelaku (ABAC, 403
 * diaudit), dan untuk penulisan tidak batal. Kunjungan selesai tetap boleh ditulisi (dokumentasi susulan ditandai
 * "entri terlambat").
 */
export async function clinicalEncounter(
  db: TenantDb,
  access: PatientAccessChecker,
  encounterId: string,
  mode: 'read' | 'write',
): Promise<ClinicalEncounter> {
  const enc = await db.tx().encounter.findUnique({
    where: { id: encounterId },
    select: {
      id: true,
      patientId: true,
      status: true,
      encounterClass: true,
      unitId: true,
      practitionerId: true,
    },
  });
  if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
  await access.assert(enc.patientId);
  if (mode === 'write' && enc.status === 'cancelled') {
    throw new AppError('CONFLICT', 'Kunjungan sudah dibatalkan; entri klinis tidak bisa ditambahkan', 409);
  }
  return enc;
}

/** Pasien ada (tenant ini) dan boleh dibuka pelaku. */
export async function clinicalPatient(
  db: TenantDb,
  access: PatientAccessChecker,
  patientId: string,
): Promise<void> {
  const p = await db.tx().patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!p) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
  await access.assert(patientId);
}

/** Semua rekam medis milik orang yang sama (ADR-0016, `app_patient_group`): riwayat selalu dibaca lewat ini. */
export async function patientGroupIds(tx: TenantTx, patientId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT app_patient_group(${patientId}::uuid)::text AS id`;
  return rows.length > 0 ? rows.map((r) => r.id) : [patientId];
}

/**
 * Koreksi entri (revisi `koreksi`) memakai izin `clinical.correct` di samping izin endpoint (`clinical.write` /
 * `result.write`), karena satu endpoint POST menerima entri baru, koreksi, dan addendum (rencana §3.2a).
 */
export async function assertRevisionAllowed(
  db: TenantDb,
  matrix: PermissionMatrix,
  revision: ClinicalRevision,
): Promise<void> {
  if (revision.kind !== 'koreksi') return;
  const actor = db.actor();
  if (actor.role === DEV_ROLE) return;
  const scope = actor.role ? await matrix.scope(db.tenantId(), actor.role, 'clinical', 'correct') : null;
  if (!scope) throw new AppError('FORBIDDEN', 'Peran Anda tidak berizin mengoreksi entri klinis', 403);
}

/** Kunci advisory transaksi untuk aturan per kunjungan/pasien yang tidak bisa dijadikan indeks unik. */
export async function lockClinicalKey(db: TenantDb, key: string): Promise<void> {
  await db.tx().$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clinical-rule:${key}`}, 0))`;
}

/** Umur dalam tahun pada tanggal WIB `today` (`YYYY-MM-DD`). */
export function ageYears(birthDate: Date | null, today: string): number | null {
  if (!birthDate) return null;
  const b = birthDate.toISOString().slice(0, 10);
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return Math.max(0, age);
}
