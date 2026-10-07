import { Injectable } from '@nestjs/common';
import { DEV_ROLE } from '../../common/request-context';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';

/** Peran tim perawatan yang boleh menandatangani resume dan mengonfirmasi rekonsiliasi (DPJP/rawat bersama). */
export const SIGNING_TEAM_ROLES = ['dpjp_utama', 'rawat_bersama'] as const;

/**
 * K13 · Siapa yang boleh menandatangani dokumen pulang. Dipakai layanan resume, surat kematian, dan `DischargeGate`
 * (gerbang dipanggil juga dari endpoint ADT ber-izin `bed.write`, jadi tidak bisa mengandalkan lingkup endpoint).
 */
@Injectable()
export class DischargeAuthority {
  constructor(
    private readonly db: TenantDb,
    private readonly matrix: PermissionMatrix,
  ) {}

  /** Peran sesi punya izin `clinical.sign` (TTE dokumen klinis legal). */
  async canSign(): Promise<boolean> {
    const actor = this.db.actor();
    if (!actor.userId || !actor.role || actor.devicePrincipal) return false;
    if (actor.role === DEV_ROLE) return true;
    return (await this.matrix.scope(this.db.tenantId(), actor.role, 'clinical', 'sign')) !== null;
  }

  /**
   * DPJP utama/rawat bersama kunjungan atau dokter kunjungan (rawat jalan). Setelah kunjungan selesai, keanggotaan tim
   * yang sudah diakhiri tetap dihitung (resume/addendum susulan oleh DPJP yang sama).
   */
  async isAttendingTeam(encounterId: string): Promise<boolean> {
    const me = this.db.actorUserId();
    if (!me) return false;
    const tx = this.db.tx();
    const enc = await tx.encounter.findUnique({
      where: { id: encounterId },
      select: { status: true, practitioner: { select: { userId: true } } },
    });
    if (!enc) return false;
    if (enc.practitioner?.userId === me) return true;
    const member = await tx.encounterParticipant.findFirst({
      where: {
        encounterId,
        userId: me,
        role: { in: [...SIGNING_TEAM_ROLES] },
        ...(enc.status === 'finished' ? {} : { endedAt: null }),
      },
      select: { id: true },
    });
    return !!member;
  }

  /**
   * Keputusan K-1 (7 Okt 2026): surat kematian dan disposisi `meninggal` hanya oleh dokter (`clinical.sign`) yang
   * berelasi dengan pasien: tim DPJP/rawat bersama, dokter kunjungan, relasi akses aktif, atau dokter jaga dengan akses
   * darurat yang masih berlaku. Petugas admisi (tanpa `clinical.sign`) selalu ditolak.
   */
  async mayCertifyDeath(encounterId: string, patientId: string): Promise<boolean> {
    if (!(await this.canSign())) return false;
    if (await this.isAttendingTeam(encounterId)) return true;
    const me = this.db.actorUserId() as string;
    const at = new Date();
    const tx = this.db.tx();
    const group = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT app_patient_group(${patientId}::uuid)::text AS id`;
    const ids = group.length > 0 ? group.map((g) => g.id) : [patientId];
    const [rel, bg] = await Promise.all([
      tx.accessRelationship.findFirst({
        where: {
          userId: me,
          patientId: { in: ids },
          validFrom: { lte: at },
          OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        },
        select: { id: true },
      }),
      tx.breakGlassGrant.findFirst({
        where: { userId: me, patientId: { in: ids }, grantedAt: { lte: at }, expiresAt: { gt: at } },
        select: { id: true },
      }),
    ]);
    return !!rel || !!bg;
  }
}
