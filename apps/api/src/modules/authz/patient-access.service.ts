import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import { ACTIVE_ENCOUNTER_STATUSES } from '@simrs/shared';
import { AuditedDenial } from '../../common/audited-denial';
import { TenantDb } from '../../infra/tenant-db';

export type AccessBasis = 'role' | 'relationship' | 'unit' | 'break_glass';

/** Pelaku berlingkup bukan `all`: pengguna + unit penugasan (hanya dipakai bila lingkupnya `unit`). */
export interface ScopedActor {
  userId: string;
  /** Unit penugasan sesi; null bila lingkup `relationship` atau penugasan tanpa unit. */
  unitId: string | null;
}

/**
 * Predikat SQL "pasien `p` boleh dibuka pelaku ini" untuk daftar/pencarian (filter sebelum LIMIT), satu sumber
 * aturan dengan `PatientAccessService.basis`. Rekam medis yang digabung = satu orang (`app_patient_group`):
 * - relasi aktif (DPJP, perawat penanggung jawab, rawat bersama, konsultan, petugas unit);
 * - akses darurat (break-the-glass) yang belum kedaluwarsa;
 * - lingkup `unit` (ADR-0031): kunjungan aktif (`planned`/`arrived`/`in_progress`) di unit penugasan.
 * Alias tabel pasien wajib `p`.
 */
export function patientAccessSql(actor: ScopedActor, at: Date): Prisma.Sql {
  const unit = actor.unitId
    ? Prisma.sql`
  OR EXISTS (SELECT 1 FROM encounters e
             WHERE e.patient_id IN (SELECT app_patient_group(p.id)) AND e.unit_id = ${actor.unitId}::uuid
               AND e.status = ANY(${[...ACTIVE_ENCOUNTER_STATUSES]}::text[]))`
    : Prisma.empty;
  return Prisma.sql`(
  EXISTS (SELECT 1 FROM access_relationships r
          WHERE r.patient_id IN (SELECT app_patient_group(p.id)) AND r.user_id = ${actor.userId}::uuid
            AND r.valid_from <= ${at} AND (r.valid_until IS NULL OR r.valid_until > ${at}))
  OR EXISTS (SELECT 1 FROM break_glass_grants g
             WHERE g.patient_id IN (SELECT app_patient_group(p.id)) AND g.user_id = ${actor.userId}::uuid
               AND g.granted_at <= ${at} AND g.expires_at > ${at})${unit})`;
}

/**
 * P03 · ABAC akses pasien. Dipanggil service yang menampilkan data pasien SETELAH `@RequirePermission`
 * memberi lingkup:
 * - `all`          → boleh (peran berizin seluruh pasien, mis. pendaftaran, RM);
 * - `unit`         → kunjungan aktif pasien di unit penugasan (ADR-0031: IGD, bangsal, poli), ATAU semua dasar
 *                    lingkup `relationship` di bawah (unit ⊃ relationship);
 * - `relationship` → hanya relasi aktif (DPJP, perawat penanggung jawab, rawat bersama, konsultan, petugas unit)
 *                    ATAU akses darurat (break-the-glass) yang belum kedaluwarsa.
 * Lokasi tingkat kamar/bed (ADT) menyusul di fase 3 (ADR-0031).
 */
@Injectable()
export class PatientAccessService {
  constructor(private readonly db: TenantDb) {}

  /** Pelaku untuk `patientAccessSql`; null bila lingkup `all` (tanpa saringan) atau tanpa pengguna. */
  scopedActor(): ScopedActor | null {
    const scope = this.db.permissionScope();
    const userId = this.db.actorUserId();
    if (scope === 'all' || !userId) return null;
    return { userId, unitId: scope === 'unit' ? (this.db.actor().unitId ?? null) : null };
  }

  async basis(patientId: string, at: Date = new Date()): Promise<AccessBasis | null> {
    const scope = this.db.permissionScope();
    if (scope === 'all') return 'role';
    if (!scope) return null;
    const userId = this.db.actorUserId();
    if (!userId) return null;
    const tx = this.db.tx();
    // Rekam medis yang digabung = satu orang: relasi/akses darurat ke salah satunya berlaku untuk semuanya.
    const group = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT app_patient_group(${patientId}::uuid)::text AS id`;
    const patientIds = group.length > 0 ? group.map((g) => g.id) : [patientId];
    const rel = await tx.accessRelationship.findFirst({
      where: {
        userId,
        patientId: { in: patientIds },
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
      },
      select: { id: true },
    });
    if (rel) return 'relationship';
    const unitId = scope === 'unit' ? this.db.actor().unitId : null;
    if (unitId) {
      const here = await tx.encounter.findFirst({
        where: { patientId: { in: patientIds }, unitId, status: { in: [...ACTIVE_ENCOUNTER_STATUSES] } },
        select: { id: true },
      });
      if (here) return 'unit';
    }
    const bg = await tx.breakGlassGrant.findFirst({
      where: { userId, patientId: { in: patientIds }, grantedAt: { lte: at }, expiresAt: { gt: at } },
      select: { id: true },
    });
    return bg ? 'break_glass' : null;
  }

  /**
   * Lempar 403 bila tidak berhak; pesan mengarahkan ke akses darurat (yang tercatat dan ditinjau).
   * Penolakan dicatat `access_denied` (dengan patientId) walau transaksi permintaan batal — bahan temuan
   * "akses ditolak berulang" di layar Audit.
   */
  async assert(patientId: string): Promise<AccessBasis> {
    const b = await this.basis(patientId);
    if (!b) {
      const scope = this.db.permissionScope();
      throw new AuditedDenial(
        scope === 'unit'
          ? 'Pasien ini tidak sedang dirawat di unit Anda dan Anda tidak terdaftar merawatnya. Gunakan akses darurat bila ada alasan klinis (tercatat dan ditinjau).'
          : 'Anda tidak terdaftar merawat pasien ini. Gunakan akses darurat bila ada alasan klinis (tercatat dan ditinjau).',
        {
          resourceType: 'patient',
          resourceId: patientId,
          patientId,
          details: { scope },
        },
        { breakGlassAvailable: true },
      );
    }
    return b;
  }
}
