import { Injectable } from '@nestjs/common';
import { AuditedDenial } from '../../common/audited-denial';
import { TenantDb } from '../../infra/tenant-db';

export type AccessBasis = 'role' | 'relationship' | 'break_glass';

/**
 * P03 · ABAC akses pasien. Dipanggil service yang menampilkan data pasien SETELAH `@RequirePermission`
 * memberi lingkup:
 * - `all`          → boleh (peran berizin seluruh pasien, mis. pendaftaran, RM);
 * - `unit` / `relationship` → hanya bila ada relasi aktif (DPJP, perawat penanggung jawab, rawat bersama,
 *                    konsultan, petugas unit) ATAU akses darurat (break-the-glass) yang belum kedaluwarsa.
 * Lingkup `unit` berbasis lokasi pasien (ADT) disempurnakan saat encounter tersedia (fase 2–3).
 */
@Injectable()
export class PatientAccessService {
  constructor(private readonly db: TenantDb) {}

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
      throw new AuditedDenial(
        'Anda tidak terdaftar merawat pasien ini. Gunakan akses darurat bila ada alasan klinis (tercatat dan ditinjau).',
        {
          resourceType: 'patient',
          resourceId: patientId,
          patientId,
          details: { scope: this.db.permissionScope() },
        },
        { breakGlassAvailable: true },
      );
    }
    return b;
  }
}
