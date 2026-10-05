/**
 * P05 · Cincin kunci (key ring) enkripsi kolom dan blind index (ADR-0015, pembaruan 5 Okt 2026).
 *
 * Satu cincin = beberapa kunci 32 byte ber-ID (`v1`, `v2`, …). Kunci PERTAMA adalah kunci aktif: semua tulisan
 * baru memakainya. Kunci lain hanya untuk membaca data lama (ciphertext berawalan ID kuncinya, hash berawalan
 * `<id>:`) sampai job enkripsi ulang selesai dan kuncinya dipensiunkan.
 *
 * Env:
 * - `FIELD_ENCRYPTION_KEYS=v2:<base64>,v1:<base64>` dan `FIELD_HASH_KEYS=v2:<base64>,v1:<base64>`;
 * - `FIELD_ENCRYPTION_KEY` / `FIELD_HASH_KEY` (format lama) = kunci `v1`. Bila cincin juga memuat `v1`, keduanya
 *   wajib sama; bila tidak, `v1` ditambahkan di akhir cincin (hanya baca).
 *
 * Pesan galat tidak pernah memuat isi kunci maupun data.
 */

/** ID kunci: `v1`…`v999`, tanpa nol di depan (juga awalan ciphertext dan hash). */
export const FIELD_KEY_ID = /^v[1-9][0-9]{0,2}$/;

/** ID kunci format lama (`FIELD_ENCRYPTION_KEY`/`FIELD_HASH_KEY`); hash-nya tanpa awalan. */
export const LEGACY_KEY_ID = 'v1';

const BASE64_32 = /^[A-Za-z0-9+/_-]{43}=?$/;

export type FieldKeyErrorCode =
  /** Konfigurasi cincin tidak valid (format, panjang, ID ganda, kunci dipakai ulang). */
  | 'FIELD_KEY_CONFIG'
  /** Data memakai ID kunci yang tidak ada di cincin (kunci sudah dipensiunkan atau belum dipasang). */
  | 'FIELD_KEY_UNKNOWN'
  /** Tag GCM gagal: kunci salah, data rusak, atau dipindah ke tenant/tujuan lain. */
  | 'FIELD_DECRYPT_FAILED'
  /** Format tersimpan tidak dikenal. */
  | 'FIELD_FORMAT'
  /** Blind index tersimpan tidak cocok dengan nilainya untuk kunci hash yang sama (kunci hash salah). */
  | 'BLIND_INDEX_MISMATCH';

/** Galat kunci kolom yang aman dicatat: hanya kode, nama variabel env, dan ID kunci. */
export class FieldKeyError extends Error {
  constructor(
    readonly code: FieldKeyErrorCode,
    message: string,
    readonly keyId?: string,
  ) {
    super(message);
    this.name = 'FieldKeyError';
  }
}

export class KeyRing {
  private readonly keys: ReadonlyMap<string, Buffer>;

  /** `entries[0]` = kunci aktif. */
  constructor(
    /** Nama variabel env sumber (untuk pesan galat). */
    readonly source: string,
    entries: ReadonlyArray<readonly [string, Buffer]>,
  ) {
    if (entries.length === 0) throw new FieldKeyError('FIELD_KEY_CONFIG', `${source}: cincin kunci kosong`);
    const map = new Map<string, Buffer>();
    for (const [id, key] of entries) {
      if (!FIELD_KEY_ID.test(id)) {
        throw new FieldKeyError('FIELD_KEY_CONFIG', `${source}: ID kunci "${id}" harus v1…v999`);
      }
      if (key.length !== 32) {
        throw new FieldKeyError('FIELD_KEY_CONFIG', `${source}: kunci ${id} harus 32 byte (base64)`, id);
      }
      if (map.has(id)) throw new FieldKeyError('FIELD_KEY_CONFIG', `${source}: ID kunci ${id} ganda`, id);
      for (const [other, k] of map) {
        if (k.equals(key)) {
          throw new FieldKeyError(
            'FIELD_KEY_CONFIG',
            `${source}: kunci ${id} sama dengan ${other}; kunci baru harus dibangkitkan acak`,
            id,
          );
        }
      }
      map.set(id, key);
    }
    this.keys = map;
  }

  /** ID kunci aktif (dipakai semua tulisan baru). */
  get currentId(): string {
    return this.ids[0] as string;
  }

  /** Semua ID, kunci aktif lebih dulu. */
  get ids(): string[] {
    return [...this.keys.keys()];
  }

  has(id: string): boolean {
    return this.keys.has(id);
  }

  /** Kunci untuk ID ini; gagal tertutup bila tidak ada. */
  key(id: string): Buffer {
    const key = this.keys.get(id);
    if (!key) {
      throw new FieldKeyError(
        'FIELD_KEY_UNKNOWN',
        `Kunci "${id}" tidak ada di ${this.source}; data ini tidak bisa dibaca sampai kunci itu dipasang lagi`,
        id,
      );
    }
    return key;
  }

  /** Kunci yang juga ada di cincin lain (enkripsi dan hash wajib berbeda). */
  sharesKeyWith(other: KeyRing): boolean {
    return [...this.keys.values()].some((k) => [...other.keys.values()].some((o) => o.equals(k)));
  }
}

/** Cincin satu kunci `v1` dari variabel format lama (dipakai tes, seed lama, dan `keyB64`). */
export function legacyKeyRing(keyB64: string, source: string): KeyRing {
  return new KeyRing(source, [[LEGACY_KEY_ID, Buffer.from(keyB64, 'base64')]]);
}

function decodeKey(source: string, id: string, b64: string): Buffer {
  if (!BASE64_32.test(b64)) {
    throw new FieldKeyError(
      'FIELD_KEY_CONFIG',
      `${source}: kunci ${id} harus 32 byte base64 (openssl rand -base64 32)`,
      id,
    );
  }
  return Buffer.from(b64, 'base64');
}

/**
 * Bangun cincin dari `<ID>:<base64>,…` (`spec`) dan/atau kunci format lama (`legacy` = `v1`).
 * Galat bila keduanya kosong, format salah, ID ganda, atau `v1` di cincin berbeda dengan kunci lama.
 */
export function parseKeyRing(input: {
  spec?: string;
  specName: string;
  legacy?: string;
  legacyName: string;
}): KeyRing {
  const spec = input.spec?.trim() ?? '';
  const legacy = input.legacy?.trim() ?? '';
  if (!spec && !legacy) {
    throw new FieldKeyError(
      'FIELD_KEY_CONFIG',
      `${input.specName} atau ${input.legacyName} wajib diisi (openssl rand -base64 32)`,
    );
  }
  const entries: Array<[string, Buffer]> = [];
  if (spec) {
    for (const raw of spec.split(',')) {
      const part = raw.trim();
      const sep = part.indexOf(':');
      if (sep <= 0) {
        throw new FieldKeyError(
          'FIELD_KEY_CONFIG',
          `${input.specName}: tiap kunci ditulis <ID>:<base64>, dipisah koma (mis. v2:…,v1:…)`,
        );
      }
      const id = part.slice(0, sep).trim();
      if (!FIELD_KEY_ID.test(id)) {
        throw new FieldKeyError('FIELD_KEY_CONFIG', `${input.specName}: ID kunci "${id}" harus v1…v999`);
      }
      entries.push([id, decodeKey(input.specName, id, part.slice(sep + 1).trim())]);
    }
  }
  if (legacy) {
    const key = decodeKey(input.legacyName, LEGACY_KEY_ID, legacy);
    const inRing = entries.find(([id]) => id === LEGACY_KEY_ID);
    if (inRing && !inRing[1].equals(key)) {
      throw new FieldKeyError(
        'FIELD_KEY_CONFIG',
        `${input.legacyName} berbeda dengan v1 di ${input.specName}; hapus salah satunya atau samakan`,
        LEGACY_KEY_ID,
      );
    }
    if (!inRing) entries.push([LEGACY_KEY_ID, key]);
  }
  return new KeyRing(spec ? input.specName : input.legacyName, entries);
}

/** Dua cincin kunci kolom: enkripsi (AES-256-GCM) dan blind index (HMAC-SHA256). */
export interface FieldKeys {
  enc: KeyRing;
  hash: KeyRing;
}

export interface FieldKeyEnv {
  FIELD_ENCRYPTION_KEY?: string;
  FIELD_ENCRYPTION_KEYS?: string;
  FIELD_HASH_KEY?: string;
  FIELD_HASH_KEYS?: string;
}

const envCache = new Map<string, FieldKeys>();

/**
 * Cincin kunci dari env (API, worker, CLI rotasi, seed). Gagal cepat dengan pesan jelas (tanpa nilai kunci);
 * hasil di-cache per isi env.
 */
export function fieldKeysFromEnv(env: FieldKeyEnv): FieldKeys {
  const cacheKey = [
    env.FIELD_ENCRYPTION_KEYS,
    env.FIELD_ENCRYPTION_KEY,
    env.FIELD_HASH_KEYS,
    env.FIELD_HASH_KEY,
  ].join('\n');
  const cached = envCache.get(cacheKey);
  if (cached) return cached;
  const keys: FieldKeys = {
    enc: parseKeyRing({
      spec: env.FIELD_ENCRYPTION_KEYS,
      specName: 'FIELD_ENCRYPTION_KEYS',
      legacy: env.FIELD_ENCRYPTION_KEY,
      legacyName: 'FIELD_ENCRYPTION_KEY',
    }),
    hash: parseKeyRing({
      spec: env.FIELD_HASH_KEYS,
      specName: 'FIELD_HASH_KEYS',
      legacy: env.FIELD_HASH_KEY,
      legacyName: 'FIELD_HASH_KEY',
    }),
  };
  if (keys.enc.sharesKeyWith(keys.hash)) {
    throw new FieldKeyError(
      'FIELD_KEY_CONFIG',
      'Kunci enkripsi kolom dan kunci hash tidak boleh sama; bangkitkan kunci terpisah',
    );
  }
  envCache.set(cacheKey, keys);
  return keys;
}

/**
 * `fieldKeysFromEnv` untuk start aplikasi/CLI: galat konfigurasi dilaporkan seperti galat env lain
 * (`Konfigurasi env tidak valid → …`), tanpa nilai kunci.
 */
export function loadFieldKeys(env: FieldKeyEnv): FieldKeys {
  try {
    return fieldKeysFromEnv(env);
  } catch (err) {
    if (!(err instanceof FieldKeyError)) throw err;
    throw new Error(`Konfigurasi env tidak valid → ${err.message}`, { cause: err });
  }
}

/** Cincin dari pasangan kunci format lama (tes, alat lama). */
export function legacyFieldKeys(encKeyB64: string, hashKeyB64: string): FieldKeys {
  return {
    enc: legacyKeyRing(encKeyB64, 'FIELD_ENCRYPTION_KEY'),
    hash: legacyKeyRing(hashKeyB64, 'FIELD_HASH_KEY'),
  };
}
