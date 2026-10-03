import {
  type IdentifierSystem,
  IDENTIFIER_SYSTEM_CODES,
  newId,
  normalizePersonName,
  type PatientSex,
} from '@simrs/shared';
import type { PatientCrypto } from '@simrs/shared/node';
import type { TenantTx } from './client';
import { allocateNumber } from './platform';

export interface NewPatientRecord {
  /** Opsional: seed memakai ID tetap agar idempoten. */
  id?: string;
  name: string;
  sex: PatientSex;
  /** `YYYY-MM-DD`. */
  birthDate?: string | null;
  birthDateEstimated?: boolean;
  motherName?: string | null;
  address?: string | null;
  /** No. HP baku `62…` (`normalizePhone`). */
  phone?: string | null;
  unidentified?: boolean;
  /** Nilai baku (`normalizeIdentifier`) dan sudah tervalidasi. */
  identifiers?: Partial<Record<IdentifierSystem, string>>;
  createdBy?: string | null;
}

/** `YYYY-MM-DD` → Date untuk kolom `date` (sesi database UTC, ADR-0014). */
export const toDbDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

/**
 * P05 · Simpan rekam medis baru: nomor RM dari layanan penomoran (P08), nama ternormalisasi untuk pencarian,
 * kontak dan identifier terenkripsi + blind index. Tanpa aturan bisnis (izin, cek NIK ganda): itu tugas
 * pemanggil (modul MPI di API, seed, tes).
 */
export async function insertPatient(
  tx: TenantTx,
  crypto: PatientCrypto,
  rec: NewPatientRecord,
): Promise<{ id: string; mrn: string }> {
  const tenantId = crypto.tenantId;
  const { number: mrn } = await allocateNumber(tx, tenantId, 'mrn');
  const id = rec.id ?? newId();
  const createdBy = rec.createdBy ?? null;
  await tx.patient.create({
    data: {
      id,
      tenantId,
      mrn,
      name: rec.name,
      nameSearch: normalizePersonName(rec.name),
      sex: rec.sex,
      birthDate: rec.birthDate ? toDbDate(rec.birthDate) : null,
      birthDateEstimated: rec.birthDateEstimated ?? false,
      motherName: rec.motherName ?? null,
      addressEnc: rec.address ? crypto.encryptContact(rec.address) : null,
      phoneEnc: rec.phone ? crypto.encryptContact(rec.phone) : null,
      phoneHash: rec.phone ? crypto.phoneHash(rec.phone) : null,
      unidentified: rec.unidentified ?? false,
      createdBy,
      updatedBy: createdBy,
    },
  });
  const identifiers = IDENTIFIER_SYSTEM_CODES.flatMap((system) => {
    const value = rec.identifiers?.[system];
    return value ? [{ system, value }] : [];
  });
  if (identifiers.length > 0) {
    await tx.patientIdentifier.createMany({
      data: identifiers.map(({ system, value }) => ({
        id: newId(),
        tenantId,
        patientId: id,
        system,
        ...crypto.encryptIdentifier(system, value),
        createdBy,
      })),
    });
  }
  return { id, mrn };
}
