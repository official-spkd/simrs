import type { IdentifierSystem } from '../patient';
import {
  blindIndex,
  blindIndexes,
  decryptField,
  encryptField,
  isCurrentBlindIndex,
  isCurrentCipher,
} from './field-crypto';
import { type FieldKeys, legacyFieldKeys } from './field-keys';

/** Pasangan kunci format lama (tes dan alat lama): masing-masing menjadi cincin satu kunci `v1`. */
export interface PatientCryptoKeys {
  /** FIELD_ENCRYPTION_KEY (base64, 32 byte). */
  encKeyB64: string;
  /** FIELD_HASH_KEY (base64, 32 byte). */
  hashKeyB64: string;
}

/**
 * P05 · Enkripsi identitas pasien untuk satu tenant (docs/04 §1):
 * - identifier (NIK, BPJS, IHS, paspor): AES-256-GCM tujuan `patient_identifier` + blind index `sistem:nilai`;
 * - kontak (alamat, no. HP): tujuan `contact`; no. HP juga di-hash untuk pencocokan duplikat.
 * Nilai masukan harus sudah baku (`normalizeIdentifier`, `normalizePhone`) agar hash konsisten.
 *
 * Tulisan memakai kunci aktif; pencarian memakai hash untuk semua kunci di cincin (`*Hashes`) agar baris yang belum
 * dienkripsi ulang tetap ditemukan selama rotasi kunci (ADR-0015, pembaruan 5 Okt 2026).
 */
export class PatientCrypto {
  readonly keys: FieldKeys;

  constructor(
    keys: FieldKeys | PatientCryptoKeys,
    readonly tenantId: string,
  ) {
    this.keys = 'enc' in keys ? keys : legacyFieldKeys(keys.encKeyB64, keys.hashKeyB64);
  }

  private ctx(purpose: 'patient_identifier' | 'contact' | 'patient_snapshot') {
    return { ring: this.keys.enc, tenantId: this.tenantId, purpose };
  }

  private hashCtx(purpose: 'patient_identifier' | 'contact') {
    return { ring: this.keys.hash, tenantId: this.tenantId, purpose };
  }

  /** Blind index identifier dengan kunci hash aktif (untuk ditulis). */
  identifierHash(system: IdentifierSystem, normalized: string): string {
    return blindIndex(`${system}:${normalized}`, this.hashCtx('patient_identifier'));
  }

  /** Blind index identifier untuk semua kunci hash di cincin (untuk dicari), kunci aktif lebih dulu. */
  identifierHashes(system: IdentifierSystem, normalized: string): string[] {
    return blindIndexes(`${system}:${normalized}`, this.hashCtx('patient_identifier'));
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
    return blindIndex(`phone:${normalizedPhone}`, this.hashCtx('contact'));
  }

  phoneHashes(normalizedPhone: string): string[] {
    return blindIndexes(`phone:${normalizedPhone}`, this.hashCtx('contact'));
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

  /** Ciphertext sudah memakai kunci enkripsi aktif. */
  isCurrentCipher(stored: string): boolean {
    return isCurrentCipher(stored, this.keys.enc);
  }

  /** Blind index sudah memakai kunci hash aktif. */
  isCurrentHash(stored: string): boolean {
    return isCurrentBlindIndex(stored, this.keys.hash);
  }
}
