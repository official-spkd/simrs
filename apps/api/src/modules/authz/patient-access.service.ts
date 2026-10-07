import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import { AuditedDenial } from '../../common/audited-denial';
import { TenantDb } from '../../infra/tenant-db';

export type AccessBasis = 'role' | 'relationship' | 'unit' | 'support_order' | 'break_glass';

/** Order penunjang selesai/batal tetap membuka pasien bagi unit pelaksana selama ini (keputusan fase 4 no. 3). */
export const SUPPORT_ACCESS_AFTER_DAYS = 7;
/** Order CPOE yang belum diterima unit pelaksana membuka pasien selama ini (sama dengan jendela worklist). */
export const SUPPORT_PENDING_DAYS = 14;

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
 * - lingkup `unit` (ADR-0031): lokasi kini pasien (`app_patient_location`: unit bed yang ditempati, atau unit kunjungan
 *   aktif bila belum/tanpa bed) = unit penugasan. Transfer bed ke unit lain memindah akses.
 * Alias tabel pasien wajib `p`.
 */
export function patientAccessSql(actor: ScopedActor, at: Date): Prisma.Sql {
  const unit = actor.unitId
    ? Prisma.sql`
  OR EXISTS (SELECT 1 FROM app_patient_location(p.id) l WHERE l.unit_id = ${actor.unitId}::uuid)`
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
 * - `unit`         → kunjungan aktif pasien di unit penugasan (ADR-0031: IGD, bangsal, poli), ATAU order penunjang
 *                    yang ditujukan ke unit itu (lab/radiologi: aktif + 7 hari, fase 4 keputusan no. 3), ATAU semua
 *                    dasar lingkup `relationship` di bawah (unit ⊃ relationship);
 * - `relationship` → hanya relasi aktif (DPJP, perawat penanggung jawab, rawat bersama, konsultan, petugas unit)
 *                    ATAU akses darurat (break-the-glass) yang belum kedaluwarsa.
 * Lokasi tingkat bed lewat `app_patient_location` (ADR-0031 pembaruan fase 3).
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
      // ADR-0031 fase 3: tingkat bed. Pasien di bed unit lain (transfer) tidak lagi terbuka lewat unit asal.
      const here = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT 1 AS n FROM app_patient_location(${patientId}::uuid) l WHERE l.unit_id = ${unitId}::uuid LIMIT 1`;
      if (here.length > 0) return 'unit';
      // Fase 4 · F3-8 / keputusan no. 3: unit PELAKSANA order penunjang (lab, radiologi) melihat pasien yang order-nya
      // ditujukan ke unitnya, selama order aktif + 7 hari setelah selesai/batal (data minimal di layar penunjang).
      if (await this.supportOrderInUnit(patientIds, unitId, at)) return 'support_order';
    }
    const bg = await tx.breakGlassGrant.findFirst({
      where: { userId, patientId: { in: patientIds }, grantedAt: { lte: at }, expiresAt: { gt: at } },
      select: { id: true },
    });
    return bg ? 'break_glass' : null;
  }

  private async supportOrderInUnit(patientIds: string[], unitId: string, at: Date): Promise<boolean> {
    const after = new Date(at.getTime() - SUPPORT_ACCESS_AFTER_DAYS * 86_400_000);
    const pendingFrom = new Date(at.getTime() - SUPPORT_PENDING_DAYS * 86_400_000);
    const rows = await this.db.tx().$queryRaw<Array<{ n: number }>>`
      SELECT 1 AS n FROM lab_orders o
      WHERE o.patient_id = ANY(${patientIds}::uuid[]) AND o.unit_id = ${unitId}::uuid
        AND (o.status NOT IN ('selesai', 'batal') OR o.updated_at > ${after})
      UNION ALL
      SELECT 1 FROM imaging_studies s
      WHERE s.patient_id = ANY(${patientIds}::uuid[]) AND s.unit_id = ${unitId}::uuid
        AND (s.status NOT IN ('ditandatangani', 'batal') OR s.updated_at > ${after})
      UNION ALL
      SELECT 1 FROM service_requests r JOIN orderables ob ON ob.tenant_id = r.tenant_id AND ob.id = r.orderable_id
      WHERE r.patient_id = ANY(${patientIds}::uuid[]) AND ob.unit_id = ${unitId}::uuid
        AND r.created_at > ${pendingFrom}
      LIMIT 1`;
    return rows.length > 0;
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
