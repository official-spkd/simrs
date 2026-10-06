import type { PayInput } from '../../penggajian';
import { employeeByName } from './pegawai';
import { PERSONA, STAF, STAF_LAIN } from './staf';

/**
 * B05 · Run gaji Oktober 2026 (angka simulasi, ADR-0023). Pegawai dari `EMPLOYEES`; jasa pelayanan diimpor dari
 * U08 di layar; PPh 21 diisi manual (dua pegawai sengaja belum diisi).
 */

function pay(
  name: string,
  base: number,
  positionAllowance: number,
  functionalAllowance: number,
  pph21: number | null,
): PayInput {
  const e = employeeByName(name);
  if (!e) throw new Error(`pegawai fixture tidak ada: ${name}`);
  return {
    employeeId: e.id,
    name: e.name,
    position: e.position,
    base: BigInt(base),
    positionAllowance: BigInt(positionAllowance),
    functionalAllowance: BigInt(functionalAllowance),
    serviceFee: 0n,
    pph21: pph21 === null ? null : BigInt(pph21),
  };
}

export const PAYROLL_PERIOD = {
  label: 'Oktober 2026',
  number: 'PAY-2610-001',
  payDate: '2026-10-23',
} as const;

export const PAYROLL_INPUTS: readonly PayInput[] = [
  pay(STAF.dpjpPenyakitDalam, 9_800_000, 2_500_000, 3_500_000, 1_215_000),
  pay(STAF.dpjpBedah, 9_800_000, 0, 3_500_000, 1_540_000),
  pay(STAF.dokterJagaIgd, 6_200_000, 0, 1_800_000, 245_000),
  pay(PERSONA.perawat, 5_400_000, 1_200_000, 900_000, null),
  pay(STAF_LAIN.perawat[0] ?? '', 4_600_000, 0, 750_000, 62_000),
  pay(PERSONA.apoteker, 5_900_000, 1_200_000, 1_100_000, null),
  pay(PERSONA.analisLab, 4_800_000, 0, 750_000, 71_000),
  pay(PERSONA.kasir, 4_200_000, 0, 0, 0),
];

/** Jasa pelayanan Oktober dari modul U08 (per pegawai, rupiah). */
export const SERVICE_FEES: Record<string, number> = {
  [STAF.dpjpPenyakitDalam]: 14_250_000,
  [STAF.dpjpBedah]: 21_600_000,
  [STAF.dokterJagaIgd]: 3_100_000,
  [PERSONA.perawat]: 1_850_000,
  [STAF_LAIN.perawat[0] ?? '']: 1_420_000,
  [PERSONA.apoteker]: 1_600_000,
  [PERSONA.analisLab]: 1_150_000,
  [PERSONA.kasir]: 650_000,
};

export const PAYROLL_PREPARER = PERSONA.akuntan;
export const PAYROLL_APPROVERS = [PERSONA.akuntan, PERSONA.direktur] as const;
