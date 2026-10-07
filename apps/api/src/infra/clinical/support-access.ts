import { Prisma, raisedDbCode, type TenantTx } from '@simrs/db';
import {
  AppError,
  clinicalError,
  SUPPORT_ERRORS,
  supportError,
  type SupportErrorCode,
  type SupportPatientLite,
  type SupportView,
} from '@simrs/shared';
import { patientAccessSql, type PatientAccessService } from '../../modules/authz/patient-access.service';
import type { TenantDb } from '../tenant-db';

/** Jendela akses unit pelaksana: order aktif + 7 hari setelah selesai (keputusan fase 4 no. 3, ADR-0034). */
export const SUPPORT_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/** Jenis unit perawatan: lingkup `unit` di sini = lokasi pasien (ADR-0031), bukan unit pelaksana penunjang. */
const CARE_UNIT_KINDS = new Set(['poli', 'igd', 'rawat_inap', 'kamar_operasi']);

export type SupportScope =
  | { view: 'layanan' }
  | { view: 'ruangan'; filter: Prisma.Sql }
  | { view: 'ruangan'; filter: null; none: true };

/**
 * S07/S08 · Tampilan penunjang (ADR-0105, melengkapi ADR-0034):
 * - `layanan`: lingkup `all`, atau lingkup `unit` dengan penugasan di unit non-perawatan (bank darah/lab, instalasi
 *   gizi) atau tanpa unit. Melihat semua order aktif + 7 hari, karena semua permintaan darah/order diet ditujukan
 *   ke layanan itu;
 * - `ruangan`: klinisi (lingkup `relationship`, atau `unit` di unit perawatan) hanya melihat pasien yang boleh
 *   dibukanya menurut ABAC fase 3 (`patientAccessSql`, alias tabel pasien `p`).
 */
export async function supportScope(db: TenantDb, access: PatientAccessService): Promise<SupportScope> {
  const scope = db.permissionScope();
  if (scope === 'all') return { view: 'layanan' };
  const actor = access.scopedActor();
  if (!actor) return { view: 'ruangan', filter: null, none: true };
  if (scope === 'unit') {
    const unit = actor.unitId
      ? await db.tx().unit.findUnique({ where: { id: actor.unitId }, select: { kind: true } })
      : null;
    if (!unit || !CARE_UNIT_KINDS.has(unit.kind)) return { view: 'layanan' };
  }
  return { view: 'ruangan', filter: patientAccessSql(actor, new Date()) };
}

/** Masih di jendela akses layanan: aktif, atau selesai ≤ 7 hari. */
export function inSupportWindow(active: boolean, closedAt: Date | null, now = new Date()): boolean {
  return active || (closedAt !== null && now.getTime() - closedAt.getTime() <= SUPPORT_WINDOW_DAYS * DAY_MS);
}

/**
 * Akses satu order penunjang: tampilan layanan → order harus di jendela (selain itu 404 agar tidak membocorkan
 * keberadaan); tampilan ruangan → ABAC pasien (403 diaudit, `PatientAccessService.assert`).
 */
export async function assertSupportItem(
  scope: SupportScope,
  access: PatientAccessService,
  patientId: string,
  inWindow: boolean,
): Promise<void> {
  if (scope.view === 'layanan') {
    if (!inWindow) throw new AppError('NOT_FOUND', 'Order tidak ditemukan di daftar kerja layanan ini', 404);
    return;
  }
  await access.assert(patientId);
}

/** Kode `RAISE` database → galat API stabil (pesan database tidak pernah diteruskan). Null bila tidak dikenal. */
export function supportDbError(err: unknown): AppError | null {
  const raised = raisedDbCode(err);
  if (!raised) return null;
  if (raised in SUPPORT_ERRORS) return supportError(raised as SupportErrorCode);
  if (raised === 'WRISTBAND_SCAN_REQUIRED') return clinicalError('WRISTBAND_SCAN_REQUIRED');
  if (raised === 'APPEND_ONLY')
    return new AppError('CONFLICT', 'Catatan ini tidak bisa diubah atau dihapus', 409);
  if (raised === 'VALIDATION_FAILED')
    return new AppError('VALIDATION_FAILED', 'Data tidak saling cocok', 422);
  return null;
}

/** Jalankan penulisan; galat trigger dipetakan ke galat penunjang. */
export async function supportWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw supportDbError(e) ?? e;
  }
}

interface PatientLiteRow {
  encounter_id: string;
  id: string;
  name: string;
  mrn: string;
  sex: string;
  birth_date: Date | null;
  unit_id: string | null;
  unit_name: string | null;
  bed: string | null;
}

/** Pasien ringkas per kunjungan + unit/bed kini (tanpa ABAC; pemanggil sudah menyaring). */
export async function patientsLite(
  tx: TenantTx,
  encounterIds: readonly string[],
): Promise<Map<string, SupportPatientLite & { unitId: string | null }>> {
  const out = new Map<string, SupportPatientLite & { unitId: string | null }>();
  if (encounterIds.length === 0) return out;
  const rows = await tx.$queryRaw<PatientLiteRow[]>`
    SELECT e.id::text AS encounter_id, p.id::text AS id, p.name, p.mrn, p.sex, p.birth_date,
           u.id::text AS unit_id, u.name AS unit_name, l.name AS bed
    FROM encounters e
    JOIN patients p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
    LEFT JOIN bed_assignments ba ON ba.tenant_id = e.tenant_id AND ba.encounter_id = e.id AND ba.ended_at IS NULL
    LEFT JOIN locations l ON l.tenant_id = ba.tenant_id AND l.id = ba.location_id
    LEFT JOIN units u ON u.tenant_id = e.tenant_id AND u.id = coalesce(l.unit_id, e.unit_id)
    WHERE e.id = ANY(${[...encounterIds]}::uuid[])`;
  for (const r of rows) {
    out.set(r.encounter_id, {
      id: r.id,
      name: r.name,
      mrn: r.mrn,
      sex: (['male', 'female'].includes(r.sex) ? r.sex : 'unknown') as SupportPatientLite['sex'],
      birthDate: r.birth_date ? r.birth_date.toISOString().slice(0, 10) : null,
      unitName: r.unit_name,
      bed: r.bed,
      unitId: r.unit_id,
    });
  }
  return out;
}

/** Nama tampilan pengguna (penulis/petugas) untuk rekaman jawaban. */
export async function userNames(tx: TenantTx, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const list = [...new Set([...ids].filter((x): x is string => !!x))];
  if (list.length === 0) return new Map();
  const rows = await tx.user.findMany({
    where: { id: { in: list } },
    select: { id: true, displayName: true },
  });
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

export const supportView = (s: SupportScope): SupportView => s.view;
