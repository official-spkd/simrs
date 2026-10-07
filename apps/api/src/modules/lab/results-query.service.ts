import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import { egfrCkdEpi2021 } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/** LOINC kreatinin serum (mg/dL) untuk eGFR terhitung. */
export const CREATININE_LOINC = '2160-0';

export interface LatestLabResult {
  labResultId: string;
  labOrderId: string;
  loinc: string;
  name: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string;
  flag: string;
  occurredAt: string;
}

export interface ComputedEgfr {
  /** mL/menit/1,73 m² (CKD-EPI 2021, tanpa koefisien ras). */
  value: number;
  creatinineResultId: string;
  creatinineMgDl: number;
  occurredAt: string;
}

type Row = {
  id: string;
  lab_order_id: string;
  loinc: string;
  name: string;
  value_numeric: Prisma.Decimal | null;
  value_text: string | null;
  unit: string;
  flag: string;
  occurred_at: Date;
};

const MS_PER_YEAR = 365.2425 * 86_400_000;

/**
 * F3-9 · Satu pintu baca hasil penunjang untuk modul lain (panel hasil CPOE, ringkasan pasien K14, resume K13,
 * farmasi/radiologi untuk eGFR): versi terkini hasil lab yang SUDAH dirilis (validasi klinis), lintas kelompok rekam
 * medis (`app_patient_group`, ADR-0016). Kerangka 4.1a; 4.2 menambah bentuk lain bila perlu. Akses pasien diperiksa
 * pemanggil (service ini tidak mengaudit).
 */
@Injectable()
export class ResultsQueryService {
  constructor(private readonly db: TenantDb) {}

  /** Hasil rilis terbaru per LOINC (versi terkini; yang dibatalkan `entered_in_error` diabaikan). */
  async latest(patientId: string, loincCodes: readonly string[]): Promise<LatestLabResult[]> {
    if (loincCodes.length === 0) return [];
    const rows = await this.db.tx().$queryRaw<Row[]>`
      SELECT DISTINCT ON (r.loinc) r.id::text AS id, r.lab_order_id::text AS lab_order_id, r.loinc, r.name,
             r.value_numeric, r.value_text, r.unit, r.flag, r.occurred_at
      FROM lab_results_current r
      JOIN lab_orders o ON o.tenant_id = r.tenant_id AND o.id = r.lab_order_id
      WHERE r.patient_id IN (SELECT app_patient_group(${patientId}::uuid))
        AND r.loinc = ANY(${[...loincCodes]}::text[])
        AND r.status = 'final'
        AND o.released_at IS NOT NULL
      ORDER BY r.loinc, r.occurred_at DESC, r.id DESC`;
    return rows.map((r) => ({
      labResultId: r.id,
      labOrderId: r.lab_order_id,
      loinc: r.loinc,
      name: r.name,
      valueNumeric: r.value_numeric === null ? null : Number(r.value_numeric),
      valueText: r.value_text,
      unit: r.unit,
      flag: r.flag,
      occurredAt: r.occurred_at.toISOString(),
    }));
  }

  /**
   * eGFR terhitung dari kreatinin rilis terbaru + umur/jenis kelamin pasien saat sampel. null bila belum ada
   * kreatinin, jenis kelamin bukan laki-laki/perempuan, atau tanggal lahir kosong.
   */
  async egfr(patientId: string): Promise<ComputedEgfr | null> {
    const [creat] = await this.latest(patientId, [CREATININE_LOINC]);
    if (!creat || creat.valueNumeric === null || creat.valueNumeric <= 0) return null;
    const p = await this.db.tx().patient.findUnique({
      where: { id: patientId },
      select: { sex: true, birthDate: true },
    });
    if (!p?.birthDate || (p.sex !== 'male' && p.sex !== 'female')) return null;
    const age = Math.floor((Date.parse(creat.occurredAt) - p.birthDate.getTime()) / MS_PER_YEAR);
    if (age < 18) return null; // CKD-EPI hanya untuk dewasa; anak memakai rumus lain (di luar fase 4).
    return {
      value: egfrCkdEpi2021(creat.valueNumeric, age, p.sex),
      creatinineResultId: creat.labResultId,
      creatinineMgDl: creat.valueNumeric,
      occurredAt: creat.occurredAt,
    };
  }
}
