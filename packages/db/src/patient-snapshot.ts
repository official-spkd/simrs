import type { IdentifierSystem } from '@simrs/shared';
import type { PatientCrypto } from '@simrs/shared/node';

/**
 * P05 · Nilai rekam medis A sebelum ditimpa nilai B saat penggabungan; disimpan terenkripsi (tujuan
 * `patient_snapshot`) di `patient_links.survivor_snapshot_enc` untuk pemulihan saat dibatalkan (≤ 30 hari).
 * Kontak dan identifier di dalamnya tetap dalam bentuk tersimpan (ciphertext + blind index), sehingga snapshot ikut
 * dienkripsi ulang saat rotasi kunci (`rekeySurvivorSnapshot`).
 */
export interface SurvivorSnapshot {
  name?: { name: string; nameSearch: string };
  sex?: string;
  birthDate?: { value: string | null; estimated: boolean };
  motherName?: string | null;
  /** Ciphertext alamat A (tujuan `contact`). */
  address?: string | null;
  phone?: { enc: string | null; hash: string | null };
  identifiers?: Partial<Record<IdentifierSystem, { valueEnc: string; valueHash: string } | null>>;
}

/**
 * Tulis ulang ciphertext dan blind index bersarang di snapshot ke kunci aktif. Nilai yang sudah memakai kunci aktif
 * dibiarkan. Mengembalikan `changed = false` bila tidak ada yang perlu ditulis ulang. Gagal dekripsi dilempar
 * (`FieldKeyError`), tanpa nilai di pesannya.
 */
export function rekeySurvivorSnapshot(
  snapshot: SurvivorSnapshot,
  crypto: PatientCrypto,
): { snapshot: SurvivorSnapshot; changed: boolean } {
  let changed = false;
  const next: SurvivorSnapshot = { ...snapshot };
  const contact = (enc: string): string => {
    if (crypto.isCurrentCipher(enc)) return enc;
    changed = true;
    return crypto.encryptContact(crypto.decryptContact(enc));
  };
  if (typeof snapshot.address === 'string') next.address = contact(snapshot.address);
  if (snapshot.phone) {
    const { enc, hash } = snapshot.phone;
    let rehash = hash;
    if (enc && hash && !crypto.isCurrentHash(hash)) {
      rehash = crypto.phoneHash(crypto.decryptContact(enc));
      changed = true;
    }
    next.phone = { enc: enc ? contact(enc) : enc, hash: rehash };
  }
  if (snapshot.identifiers) {
    const ids: SurvivorSnapshot['identifiers'] = {};
    for (const [system, v] of Object.entries(snapshot.identifiers) as Array<
      [IdentifierSystem, { valueEnc: string; valueHash: string } | null]
    >) {
      if (!v || (crypto.isCurrentCipher(v.valueEnc) && crypto.isCurrentHash(v.valueHash))) {
        ids[system] = v;
        continue;
      }
      const plain = crypto.decryptIdentifier(v.valueEnc);
      changed = true;
      ids[system] = {
        valueEnc: crypto.isCurrentCipher(v.valueEnc)
          ? v.valueEnc
          : crypto.encryptIdentifier(system, plain).valueEnc,
        valueHash: crypto.isCurrentHash(v.valueHash) ? v.valueHash : crypto.identifierHash(system, plain),
      };
    }
    next.identifiers = ids;
  }
  return { snapshot: next, changed };
}
