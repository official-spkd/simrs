import type { IdentifierSystem } from '../patient';
import { blindIndex, decryptField, encryptField } from './field-crypto';

export interface PatientCryptoKeys {
  /** FIELD_ENCRYPTION_KEY (base64, 32 byte). */
  encKeyB64: string;
  /** FIELD_HASH_KEY (base64, ≥ 32 byte). */
  hashKeyB64: string;
}

/**
 * P05 · Enkripsi identitas pasien untuk satu tenant (docs/04 §1):
 * - identifier (NIK, BPJS, IHS, paspor): AES-256-GCM tujuan `patient_identifier` + blind index `sistem:nilai`;
 * - kontak (alamat, no. HP): tujuan `contact`; no. HP juga di-hash untuk pencocokan duplikat.
 * Nilai masukan harus sudah baku (`normalizeIdentifier`, `normalizePhone`) agar hash konsisten.
 */
export class PatientCrypto {
  constructor(
    private readonly keys: PatientCryptoKeys,
    readonly tenantId: string,
  ) {}

  private ctx(purpose: 'patient_identifier' | 'contact' | 'patient_snapshot') {
    return { keyB64: this.keys.encKeyB64, tenantId: this.tenantId, purpose };
  }

  identifierHash(system: IdentifierSystem, normalized: string): string {
    return blindIndex(`${system}:${normalized}`, {
      hashKeyB64: this.keys.hashKeyB64,
      tenantId: this.tenantId,
      purpose: 'patient_identifier',
    });
  }

  encryptIdentifier(system: IdentifierSystem, normalized: string): { valueEnc: string; valueHash: string } {
    return {
      valueEnc: encryptField(normalized, this.ctx('patient_identifier')),
      valueHash: this.identifierHash(system, normalized),
    };
  }

  decryptIdentifier(valueEnc: string): string {
    return decryptField(valueEnc, this.ctx('patient_identifier'));
  }

  phoneHash(normalizedPhone: string): string {
    return blindIndex(`phone:${normalizedPhone}`, {
      hashKeyB64: this.keys.hashKeyB64,
      tenantId: this.tenantId,
      purpose: 'contact',
    });
  }

  encryptContact(value: string): string {
    return encryptField(value, this.ctx('contact'));
  }

  decryptContact(valueEnc: string): string {
    return decryptField(valueEnc, this.ctx('contact'));
  }

  /** Nilai rekam medis A sebelum ditimpa saat penggabungan (JSON), untuk pemulihan bila dibatalkan. */
  encryptSnapshot(value: unknown): string {
    return encryptField(JSON.stringify(value), this.ctx('patient_snapshot'));
  }

  decryptSnapshot<T>(valueEnc: string): T {
    return JSON.parse(decryptField(valueEnc, this.ctx('patient_snapshot'))) as T;
  }
}
