import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import { AppError, type BreakGlassInput, type BreakGlassReviewInput, newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';

const GRANT_SELECT = {
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
  user: { select: { displayName: true, username: true } },
  reviewer: { select: { displayName: true } },
} as const;

type GrantRow = {
  id: string;
  userId: string;
  patientId: string;
  reason: string;
  grantedAt: Date;
  expiresAt: Date;
  reviewOutcome: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  user: { displayName: string; username: string };
  reviewer: { displayName: string } | null;
};

function present({ user, reviewer, ...r }: GrantRow) {
  return {
    ...r,
    grantedAt: r.grantedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    user: { id: r.userId, displayName: user.displayName, username: user.username },
    reviewer: r.reviewedBy && reviewer ? { id: r.reviewedBy, displayName: reviewer.displayName } : null,
  };
}

/**
 * P03 · Akses darurat (break-the-glass): alasan klinis wajib, berlaku `break_glass.duration_minutes` (bawaan 60),
 * notifikasi ke semua petugas privasi aktif, tercatat di audit (dengan id pasien dan alasan), lalu ditinjau.
 * Alasan dan waktu tidak bisa diubah (hak kolom database); hanya kolom tinjauan yang bisa diisi.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    private readonly db: TenantDb,
    private readonly notifications: NotificationsService,
  ) {}

  async grant(input: BreakGlassInput) {
    const userId = this.db.actorUserId();
    if (!userId) throw new AppError('UNAUTHENTICATED', 'Akses darurat membutuhkan login', 401);
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
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
    // Tanpa PHI di notifikasi: identitas pasien dan alasan hanya bisa dilihat di layar tinjauan yang berizin.
    // Mendesak: selain in-app, salinan dikirim ke email dan WhatsApp petugas privasi (lewat outbox).
    const notified = await this.notifications.notify(
      officers.map((o) => o.userId),
      {
        kind: 'break_glass',
        title: 'Akses darurat digunakan',
        body: 'Seorang staf membuka rekam medis lewat akses darurat. Tinjau alasannya.',
        link: `/sistem/audit?tinjau=${id}`,
      },
      ['in_app', 'email', 'whatsapp'],
    );
    this.db.audit({
      action: 'break_glass',
      resourceType: 'patient',
      resourceId: id,
      patientId: input.patientId,
      reason: input.reason,
      details: { expiresAt: expiresAt.toISOString(), notified },
    });
    return { id, patientId: input.patientId, expiresAt: expiresAt.toISOString(), notified };
  }

  /** Daftar untuk tinjauan dan laporan harian (`date` = tanggal WIB YYYY-MM-DD). */
  async list(q: { pendingOnly: boolean; limit: number; date?: string }) {
    const dayStart = q.date ? new Date(`${q.date}T00:00:00+07:00`) : null;
    const rows = await this.db.tx().breakGlassGrant.findMany({
      where: {
        ...(q.pendingOnly ? { reviewOutcome: null } : {}),
        ...(dayStart ? { grantedAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } } : {}),
      },
      orderBy: { grantedAt: 'desc' },
      take: q.limit,
      select: GRANT_SELECT,
    });
    return rows.map(present);
  }

  async get(id: string) {
    const g = await this.db.tx().breakGlassGrant.findUnique({ where: { id }, select: GRANT_SELECT });
    if (!g) throw new AppError('NOT_FOUND', 'Akses darurat tidak ditemukan', 404);
    return present(g);
  }

  async review(id: string, input: BreakGlassReviewInput) {
    const reviewer = this.db.actorUserId();
    const tx = this.db.tx();
    const g = await tx.breakGlassGrant.findUnique({
      where: { id },
      select: { id: true, userId: true, patientId: true, reviewOutcome: true },
    });
    if (!g) throw new AppError('NOT_FOUND', 'Akses darurat tidak ditemukan', 404);
    if (reviewer && g.userId === reviewer)
      throw new AppError('CONFLICT', 'Tidak bisa meninjau akses darurat sendiri', 409);
    // Keputusan pertama tidak ditimpa (riwayatnya juga ada di jejak audit).
    if (g.reviewOutcome) throw new AppError('CONFLICT', 'Akses darurat ini sudah ditinjau', 409);
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
