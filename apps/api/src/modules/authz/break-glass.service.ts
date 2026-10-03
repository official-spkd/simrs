import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import { AppError, type BreakGlassInput, type BreakGlassReviewInput, newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/**
 * P03 · Akses darurat (break-the-glass): alasan klinis wajib, berlaku `break_glass.duration_minutes` (bawaan 60),
 * notifikasi ke semua petugas privasi aktif, tercatat di audit (dengan id pasien dan alasan), lalu ditinjau.
 * Alasan dan waktu tidak bisa diubah (hak kolom database); hanya kolom tinjauan yang bisa diisi.
 */
@Injectable()
export class BreakGlassService {
  constructor(private readonly db: TenantDb) {}

  async grant(input: BreakGlassInput) {
    const userId = this.db.actorUserId();
    if (!userId) throw new AppError('UNAUTHENTICATED', 'Akses darurat membutuhkan login', 401);
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const minutes = await readTenantSetting(tx, 'break_glass.duration_minutes');
    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + minutes * 60_000);
    const id = newId();
    await tx.breakGlassGrant.create({
      data: { id, tenantId, userId, patientId: input.patientId, reason: input.reason, grantedAt, expiresAt },
    });

    const officers = await tx.staffAssignment.findMany({
      where: {
        validFrom: { lte: grantedAt },
        OR: [{ validUntil: null }, { validUntil: { gt: grantedAt } }],
        role: { code: 'petugas_privasi', active: true },
        user: { status: 'active' },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (officers.length > 0) {
      // Tanpa PHI di notifikasi: identitas pasien dan alasan hanya bisa dilihat di layar tinjauan yang berizin.
      await tx.notification.createMany({
        data: officers.map((o) => ({
          id: newId(),
          tenantId,
          recipientUserId: o.userId,
          kind: 'break_glass',
          title: 'Akses darurat digunakan',
          body: 'Seorang staf membuka rekam medis lewat akses darurat. Tinjau alasannya.',
          link: `/sistem/audit?tinjau=${id}`,
        })),
      });
    }
    this.db.audit({
      action: 'break_glass',
      resourceType: 'patient',
      resourceId: id,
      patientId: input.patientId,
      reason: input.reason,
      details: { expiresAt: expiresAt.toISOString(), notified: officers.length },
    });
    return { id, patientId: input.patientId, expiresAt: expiresAt.toISOString(), notified: officers.length };
  }

  async list(q: { pendingOnly: boolean; limit: number }) {
    const rows = await this.db.tx().breakGlassGrant.findMany({
      where: q.pendingOnly ? { reviewOutcome: null } : {},
      orderBy: { grantedAt: 'desc' },
      take: q.limit,
      select: {
        id: true,
        userId: true,
        patientId: true,
        reason: true,
        grantedAt: true,
        expiresAt: true,
        reviewOutcome: true,
        reviewNote: true,
        reviewedBy: true,
        reviewedAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      grantedAt: r.grantedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    }));
  }

  async review(id: string, input: BreakGlassReviewInput) {
    const reviewer = this.db.actorUserId();
    const tx = this.db.tx();
    const g = await tx.breakGlassGrant.findUnique({
      where: { id },
      select: { id: true, userId: true, patientId: true },
    });
    if (!g) throw new AppError('NOT_FOUND', 'Akses darurat tidak ditemukan', 404);
    if (reviewer && g.userId === reviewer)
      throw new AppError('CONFLICT', 'Tidak bisa meninjau akses darurat sendiri', 409);
    await tx.breakGlassGrant.update({
      where: { id },
      data: {
        reviewOutcome: input.outcome,
        reviewNote: input.note ?? null,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
      },
    });
    this.db.audit({
      action: 'review',
      resourceType: 'break_glass',
      resourceId: id,
      patientId: g.patientId,
      details: { outcome: input.outcome },
    });
    return { id, outcome: input.outcome };
  }
}
