import { type FieldKeys, loadFieldKeys } from '@simrs/shared/node';

/**
 * Cincin kunci kolom yang sama dengan API/worker E2E (ADR-0015): `FIELD_ENCRYPTION_KEYS`/`FIELD_HASH_KEYS`
 * (`v2:<b64>,v1:<b64>`, kunci pertama aktif) dengan cadangan format lama `FIELD_*_KEY` (= v1). Data uji yang
 * ditulis langsung ke simrs_test memakai kunci aktif, sehingga tetap terbaca API saat `.env` sudah dirotasi.
 */
export function e2eFieldKeys(): FieldKeys {
  const env = process.env;
  return loadFieldKeys({
    FIELD_ENCRYPTION_KEYS: env.FIELD_ENCRYPTION_KEYS,
    FIELD_ENCRYPTION_KEY: env.FIELD_ENCRYPTION_KEY,
    FIELD_HASH_KEYS: env.FIELD_HASH_KEYS,
    FIELD_HASH_KEY: env.FIELD_HASH_KEY,
  });
}
