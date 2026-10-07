import { Injectable } from '@nestjs/common';
import { DISPOSITION_LABEL, type DischargeDisposition } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import type { DischargeGate, DischargeGateInput, DischargeGateResult } from '../adt/discharge-gate';
import { DischargeAuthority } from './discharge-authority';

/**
 * K13 · Gerbang tutup kunjungan penuh (EP 5c, rencana §3.6, keputusan fase 3 no. 19 + K-1). Menggantikan
 * `BasicDischargeGate` di provider `DISCHARGE_GATE` (ADT) dan dipakai tutup kunjungan rawat jalan:
 * - rawat inap: resume medis final dengan TTE diminta (pending/signed, bukan gagal) dan disposisinya sama;
 * - rawat jalan: resume RJ ringkas final ber-TTE (penutupan poli);
 * - meninggal: hanya dokter `clinical.sign` yang berelasi dengan pasien (admisi ditolak, 403) + surat keterangan
 *   kematian (jam + sebab ICD-10) dengan TTE dokter;
 * - rujuk: surat rujukan keluar F07 yang tidak dibatalkan.
 * IGD tanpa resume (resume IGD bukan bagian fase 3), tetapi syarat meninggal/rujuk tetap berlaku.
 */
@Injectable()
export class FullDischargeGate implements DischargeGate {
  constructor(
    private readonly db: TenantDb,
    private readonly authority: DischargeAuthority,
  ) {}

  async check(input: DischargeGateInput): Promise<DischargeGateResult> {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUnique({
      where: { id: input.encounterId },
      select: { patientId: true },
    });
    if (!enc) return { ok: false, reasons: ['Kunjungan tidak ditemukan'] };
    const reasons: string[] = [];

    if (input.disposition === 'meninggal') {
      if (!(await this.authority.mayCertifyDeath(input.encounterId, enc.patientId))) {
        return {
          ok: false,
          forbidden: true,
          reasons: [
            'Disposisi meninggal hanya diselesaikan dokter yang merawat pasien (DPJP, rawat bersama, atau dokter jaga yang punya akses)',
          ],
        };
      }
      if (!(await this.signedSource('death_certificates', input.encounterId))) {
        reasons.push(
          'Surat keterangan kematian (jam dan sebab kematian ICD-10) dengan TTE dokter belum terbit',
        );
      }
    }

    if (input.disposition === 'rujuk') {
      const letter = await tx.referral.findFirst({
        where: { encounterId: input.encounterId, kind: 'rujukan-keluar', status: { not: 'cancelled' } },
        select: { id: true },
      });
      if (!letter) reasons.push('Surat rujukan keluar (F07) belum dibuat');
    }

    if (input.encounterClass === 'IMP' || input.encounterClass === 'AMB') {
      const resume = await this.finalResume(input.encounterId);
      const label = input.encounterClass === 'IMP' ? 'Resume medis' : 'Resume rawat jalan';
      if (!resume) {
        reasons.push(`${label} final dengan TTE DPJP belum ada`);
      } else if (resume.disposition !== input.disposition) {
        reasons.push(
          `Cara pulang berbeda dengan resume final (${DISPOSITION_LABEL[resume.disposition as DischargeDisposition] ?? resume.disposition}); buat koreksi resume`,
        );
      }
    }
    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
  }

  /** Resume final terkini (bukan addendum) yang TTE-nya diminta atau sudah sah. */
  private async finalResume(encounterId: string): Promise<{ id: string; disposition: string } | null> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string; disposition: string }>>`
      SELECT s.id::text, s.disposition FROM discharge_summaries_current s
      WHERE s.encounter_id = ${encounterId}::uuid AND s.status = 'final' AND s.addendum_of IS NULL
        AND EXISTS (
          SELECT 1 FROM documents d
          JOIN document_signatures g ON g.tenant_id = d.tenant_id AND g.document_id = d.id
          WHERE d.source_type = 'discharge_summaries' AND d.source_id = s.id AND d.voided_at IS NULL
            AND g.status <> 'failed')
      ORDER BY s.recorded_at DESC LIMIT 1`;
    return rows[0] ?? null;
  }

  /** Dokumen sumber kunjungan ini (mis. surat kematian) dengan TTE diminta/sah. */
  private async signedSource(table: 'death_certificates', encounterId: string): Promise<boolean> {
    const rows = await this.db.tx().$queryRaw<Array<{ n: number }>>`
      SELECT 1 AS n FROM death_certificates_current c
      JOIN documents d ON d.tenant_id = c.tenant_id AND d.source_type = ${table} AND d.source_id = c.id
      JOIN document_signatures g ON g.tenant_id = d.tenant_id AND g.document_id = d.id
      WHERE c.encounter_id = ${encounterId}::uuid AND c.status = 'final' AND d.voided_at IS NULL AND g.status <> 'failed'
      LIMIT 1`;
    return rows.length > 0;
  }
}
