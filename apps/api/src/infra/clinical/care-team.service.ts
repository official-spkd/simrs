import { Injectable } from '@nestjs/common';
import { uniqueViolationTarget } from '@simrs/db';
import { AppError, clinicalError, isoDateJakarta, newId } from '@simrs/shared';
import { TenantDb } from '../tenant-db';

/** Peran tim perawatan (`encounter_participants.role`). */
export const CARE_TEAM_ROLES = ['dpjp_utama', 'rawat_bersama', 'konsultan', 'perawat_pj'] as const;
export type CareTeamRole = (typeof CARE_TEAM_ROLES)[number];

/** Peran tim → jenis relasi akses (`access_relationships.kind`, ABAC lingkup `relationship`). */
const RELATIONSHIP_KIND: Readonly<Record<CareTeamRole, string>> = {
  dpjp_utama: 'dpjp',
  rawat_bersama: 'rawat_bersama',
  konsultan: 'konsultan',
  perawat_pj: 'perawat_penanggung_jawab',
};

export const CARE_TEAM_SOURCE = 'encounter_participant';

/**
 * Akhir relasi akses setelah keluar dari tim: akhir hari BERIKUTNYA (WIB), sesuai ADR-0031 butir 3 (dokumentasi susulan
 * lewat relasi, bukan akses unit).
 */
export function relationshipGraceEnd(endedAt: Date): Date {
  const nextDay = new Date(`${isoDateJakarta(endedAt)}T00:00:00+07:00`);
  return new Date(nextDay.getTime() + 2 * 86_400_000);
}

/**
 * ADR-0031 (fase 3) · Tim perawatan kunjungan adalah sumber relasi akses: setiap anggota `encounter_participants`
 * mendapat baris `access_relationships` (sumber `encounter_participant` + id) di transaksi yang sama; mengakhiri
 * keanggotaan menutup relasinya (berlaku sampai akhir hari berikutnya). Ganti DPJP utama = akhiri yang lama + tambah
 * yang baru (indeks `encounter_participants_one_primary`).
 */
@Injectable()
export class CareTeamService {
  constructor(private readonly db: TenantDb) {}

  async add(input: {
    encounterId: string;
    userId: string;
    role: CareTeamRole;
    at?: Date;
  }): Promise<{ id: string }> {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUnique({
      where: { id: input.encounterId },
      select: { id: true, patientId: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const at = input.at ?? new Date();
    const id = newId();
    try {
      await tx.encounterParticipant.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          encounterId: enc.id,
          userId: input.userId,
          role: input.role,
          startedAt: at,
          createdBy: this.db.actorUserId(),
        },
      });
    } catch (err) {
      // Indeks unik `encounter_participants_one_primary` (satu DPJP utama aktif): kode galat stabil, bukan CONFLICT
      // generik. Bentrok `one_active_role` (orang + peran yang sama) tetap 409 umum.
      const target = uniqueViolationTarget(err);
      if (input.role === 'dpjp_utama' && target && (/one_primary/.test(target) || !/user_id/.test(target))) {
        throw clinicalError('PRIMARY_DPJP_EXISTS');
      }
      throw err;
    }
    await tx.accessRelationship.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        userId: input.userId,
        patientId: enc.patientId,
        kind: RELATIONSHIP_KIND[input.role],
        validFrom: at,
        sourceType: CARE_TEAM_SOURCE,
        sourceId: id,
      },
    });
    return { id };
  }

  async end(participantId: string, reason: string, at: Date = new Date()): Promise<void> {
    const tx = this.db.tx();
    const p = await tx.encounterParticipant.findUnique({ where: { id: participantId } });
    if (!p) throw new AppError('NOT_FOUND', 'Anggota tim perawatan tidak ditemukan', 404);
    if (p.endedAt) throw new AppError('CONFLICT', 'Keanggotaan tim sudah diakhiri', 409);
    await tx.encounterParticipant.update({
      where: { id: participantId },
      data: { endedAt: at, endedBy: this.db.actorUserId() ?? p.userId, endReason: reason },
    });
    const until = relationshipGraceEnd(at);
    await tx.accessRelationship.updateMany({
      where: {
        sourceType: CARE_TEAM_SOURCE,
        sourceId: participantId,
        OR: [{ validUntil: null }, { validUntil: { gt: until } }],
      },
      data: { validUntil: until },
    });
  }
}
