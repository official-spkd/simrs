/**
 * P05 · Job enkripsi ulang kolom bertahap (rotasi kunci v2, ADR-0015 pembaruan 5 Okt 2026).
 *
 * Menulis ulang ciphertext dan blind index ke kunci AKTIF cincin (`FIELD_ENCRYPTION_KEYS`/`FIELD_HASH_KEYS`):
 * - per tenant (`app_key_rotation_tenant_ids()`, juga tenant nonaktif) di dalam `withTenant` (RLS aktif);
 * - per tabel dalam batch pendek (satu transaksi per batch, `lock_timeout` 5 detik), dengan jeda antar-batch;
 * - kursor ID per tenant × tabel di `field_key_rotations`: terputus di tengah = lanjut dari batch terakhir yang
 *   di-commit; baris status dikunci per batch sehingga beberapa pelari (worker + CLI) tidak saling dobel;
 * - compare-and-swap per baris: perubahan aplikasi yang terjadi bersamaan tidak pernah ditimpa;
 * - idempoten: baris yang sudah memakai kunci aktif dilewati;
 * - gagal tertutup: sebelum menulis, setiap versi kunci di data diperiksa (ID ada di cincin, contoh baris bisa
 *   didekripsi, blind index cocok). Tidak ada nilai, plaintext, atau kunci di log, status, maupun audit.
 */
import { type IdentifierSystem, newId } from '@simrs/shared';
import {
  blindIndexKeyId,
  decryptField,
  encryptField,
  FieldKeyError,
  type FieldKeys,
  type FieldPurpose,
  fieldKeyId,
  PatientCrypto,
} from '@simrs/shared/node';
import { Prisma, type PrismaClient, type TenantTx, withTenant } from './client';
import { rekeySurvivorSnapshot, type SurvivorSnapshot } from './patient-snapshot';

export const KEY_ROTATION_TARGETS = [
  'users',
  'mfa_factors',
  'login_challenges',
  'patients',
  'patient_identifiers',
  'patient_links',
  'patient_contacts',
] as const;
export type KeyRotationTarget = (typeof KEY_ROTATION_TARGETS)[number];

/** Semua tenant (juga nonaktif) untuk rotasi kunci: fungsi SECURITY DEFINER sempit, hanya ID (pola ADR-0008). */
export async function listKeyRotationTenantIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string }>
  >`SELECT app_key_rotation_tenant_ids()::text AS id`;
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Definisi per tabel
// ---------------------------------------------------------------------------------------------------------------

interface Ctx {
  tenantId: string;
  keys: FieldKeys;
  crypto: PatientCrypto;
  /** ID kunci enkripsi/hash aktif. */
  enc: string;
  hash: string;
}

type Outcome = 'rewritten' | 'unchanged' | 'conflict';

/** Pemakaian versi kunci per kolom: ID kunci → jumlah baris (`invalid` = format tidak dikenal). */
export interface ColumnKeyUsage {
  column: string;
  kind: 'enc' | 'hash';
  counts: Record<string, number>;
}

interface Row {
  id: string;
}

interface TargetSpec<R extends Row> {
  target: KeyRotationTarget;
  select(tx: TenantTx, ctx: Ctx, cursor: string | null, limit: number): Promise<R[]>;
  rewrite(tx: TenantTx, ctx: Ctx, row: R): Promise<Outcome>;
  /** Baris yang masih perlu ditulis ulang; null = tidak bisa dihitung di SQL (snapshot bersarang). */
  pending(tx: TenantTx, ctx: Ctx): Promise<number | null>;
  /** Versi kunci per kolom + satu contoh ID baris per versi (untuk pemeriksaan awal). */
  usage(tx: TenantTx): Promise<Array<ColumnKeyUsage & { samples: Record<string, string> }>>;
  /** Dekripsi + cocokkan blind index satu baris; melempar `FieldKeyError` bila gagal. */
  inspect(tx: TenantTx, ctx: Ctx, id: string): Promise<void>;
}

const cursorFilter = (cursor: string | null) =>
  cursor === null ? Prisma.empty : Prisma.sql`AND id > ${cursor}::uuid`;

/** `GROUP BY` versi kunci satu kolom; NULL (format salah) dilaporkan sebagai `invalid`. */
async function columnUsage(
  tx: TenantTx,
  table: string,
  column: string,
  kind: 'enc' | 'hash',
): Promise<ColumnKeyUsage & { samples: Record<string, string> }> {
  const fn = Prisma.raw(kind === 'enc' ? 'app_field_key_id' : 'app_blind_index_key_id');
  const col = Prisma.raw(column);
  const rows = await tx.$queryRaw<Array<{ key: string | null; n: number; sample: string }>>`
    SELECT ${fn}(${col}) AS key, count(*)::int AS n, min(id::text) AS sample
    FROM ${Prisma.raw(table)} WHERE ${col} IS NOT NULL GROUP BY 1`;
  const counts: Record<string, number> = {};
  const samples: Record<string, string> = {};
  for (const r of rows) {
    counts[r.key ?? 'invalid'] = r.n;
    samples[r.key ?? 'invalid'] = r.sample;
  }
  return { column, kind, counts, samples };
}

/** Kolom terenkripsi tunggal tanpa blind index (no. HP staf, rahasia MFA, kode cadangan login). */
function simpleTarget(
  target: 'users' | 'mfa_factors' | 'login_challenges',
  column: string,
  purpose: FieldPurpose,
): TargetSpec<Row & { value: string }> {
  const table = Prisma.raw(target);
  const col = Prisma.raw(column);
  const field = (ctx: Ctx) => ({ ring: ctx.keys.enc, tenantId: ctx.tenantId, purpose });
  return {
    target,
    select: (tx, ctx, cursor, limit) => tx.$queryRaw`
      SELECT id::text AS id, ${col} AS value FROM ${table}
      WHERE ${col} IS NOT NULL AND app_field_key_id(${col}) IS DISTINCT FROM ${ctx.enc} ${cursorFilter(cursor)}
      ORDER BY id LIMIT ${limit}`,
    async rewrite(tx, ctx, row) {
      const next = encryptField(decryptField(row.value, field(ctx)), field(ctx));
      const n = await tx.$executeRaw`
        UPDATE ${table} SET ${col} = ${next} WHERE id = ${row.id}::uuid AND ${col} = ${row.value}`;
      return n === 1 ? 'rewritten' : 'conflict';
    },
    async pending(tx, ctx) {
      const [r] = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM ${table}
        WHERE ${col} IS NOT NULL AND app_field_key_id(${col}) IS DISTINCT FROM ${ctx.enc}`;
      return r?.n ?? 0;
    },
    usage: async (tx) => [await columnUsage(tx, target, column, 'enc')],
    async inspect(tx, ctx, id) {
      const [r] = await tx.$queryRaw<Array<{ value: string | null }>>`
        SELECT ${col} AS value FROM ${table} WHERE id = ${id}::uuid`;
      if (r?.value) decryptField(r.value, field(ctx));
    },
  };
}

/** Blind index tersimpan harus sama dengan hash nilainya untuk salah satu kunci di cincin (versi yang sama). */
function assertHash(stored: string, candidates: string[]): void {
  if (!candidates.includes(stored)) {
    const keyId = blindIndexKeyId(stored) ?? undefined;
    throw new FieldKeyError(
      'BLIND_INDEX_MISMATCH',
      `Blind index tidak cocok dengan kunci hash ${keyId ?? '?'} (kunci hash salah atau data tidak konsisten)`,
      keyId,
    );
  }
}

interface PatientRow extends Row {
  address_enc: string | null;
  phone_enc: string | null;
  phone_hash: string | null;
}

const patientsTarget: TargetSpec<PatientRow> = {
  target: 'patients',
  select: (tx, ctx, cursor, limit) => tx.$queryRaw`
    SELECT id::text AS id, address_enc, phone_enc, phone_hash FROM patients
    WHERE ((address_enc IS NOT NULL AND app_field_key_id(address_enc) IS DISTINCT FROM ${ctx.enc})
        OR (phone_enc IS NOT NULL AND app_field_key_id(phone_enc) IS DISTINCT FROM ${ctx.enc})
        OR (phone_hash IS NOT NULL AND app_blind_index_key_id(phone_hash) IS DISTINCT FROM ${ctx.hash}))
      ${cursorFilter(cursor)}
    ORDER BY id LIMIT ${limit}`,
  async rewrite(tx, ctx, r) {
    const { crypto } = ctx;
    const address =
      r.address_enc && !crypto.isCurrentCipher(r.address_enc)
        ? crypto.encryptContact(crypto.decryptContact(r.address_enc))
        : r.address_enc;
    let phoneEnc = r.phone_enc;
    let phoneHash = r.phone_hash;
    if (
      r.phone_enc &&
      (!crypto.isCurrentCipher(r.phone_enc) || (r.phone_hash && !crypto.isCurrentHash(r.phone_hash)))
    ) {
      const phone = crypto.decryptContact(r.phone_enc);
      if (!crypto.isCurrentCipher(r.phone_enc)) phoneEnc = crypto.encryptContact(phone);
      if (r.phone_hash && !crypto.isCurrentHash(r.phone_hash)) phoneHash = crypto.phoneHash(phone);
    }
    if (address === r.address_enc && phoneEnc === r.phone_enc && phoneHash === r.phone_hash)
      return 'unchanged';
    // SQL langsung (bukan Prisma `update`): `updated_at` tidak disentuh, enkripsi ulang bukan perubahan data pasien.
    const n = await tx.$executeRaw`
      UPDATE patients SET address_enc = ${address}, phone_enc = ${phoneEnc}, phone_hash = ${phoneHash}
      WHERE id = ${r.id}::uuid AND address_enc IS NOT DISTINCT FROM ${r.address_enc}
        AND phone_enc IS NOT DISTINCT FROM ${r.phone_enc} AND phone_hash IS NOT DISTINCT FROM ${r.phone_hash}`;
    return n === 1 ? 'rewritten' : 'conflict';
  },
  async pending(tx, ctx) {
    const [r] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM patients
      WHERE (address_enc IS NOT NULL AND app_field_key_id(address_enc) IS DISTINCT FROM ${ctx.enc})
         OR (phone_enc IS NOT NULL AND app_field_key_id(phone_enc) IS DISTINCT FROM ${ctx.enc})
         OR (phone_hash IS NOT NULL AND app_blind_index_key_id(phone_hash) IS DISTINCT FROM ${ctx.hash})`;
    return r?.n ?? 0;
  },
  usage: async (tx) => [
    await columnUsage(tx, 'patients', 'address_enc', 'enc'),
    await columnUsage(tx, 'patients', 'phone_enc', 'enc'),
    await columnUsage(tx, 'patients', 'phone_hash', 'hash'),
  ],
  async inspect(tx, ctx, id) {
    const [r] = await tx.$queryRaw<PatientRow[]>`
      SELECT id::text AS id, address_enc, phone_enc, phone_hash FROM patients WHERE id = ${id}::uuid`;
    if (!r) return;
    if (r.address_enc) ctx.crypto.decryptContact(r.address_enc);
    if (r.phone_enc) {
      const phone = ctx.crypto.decryptContact(r.phone_enc);
      if (r.phone_hash) assertHash(r.phone_hash, ctx.crypto.phoneHashes(phone));
    }
  },
};

interface IdentifierRow extends Row {
  system: IdentifierSystem;
  value_enc: string;
  value_hash: string;
}

const identifiersTarget: TargetSpec<IdentifierRow> = {
  target: 'patient_identifiers',
  select: (tx, ctx, cursor, limit) => tx.$queryRaw`
    SELECT id::text AS id, system, value_enc, value_hash FROM patient_identifiers
    WHERE (app_field_key_id(value_enc) IS DISTINCT FROM ${ctx.enc}
        OR app_blind_index_key_id(value_hash) IS DISTINCT FROM ${ctx.hash})
      ${cursorFilter(cursor)}
    ORDER BY id LIMIT ${limit}`,
  async rewrite(tx, ctx, r) {
    const { crypto } = ctx;
    const value = crypto.decryptIdentifier(r.value_enc);
    const enc = crypto.isCurrentCipher(r.value_enc)
      ? r.value_enc
      : crypto.encryptIdentifier(r.system, value).valueEnc;
    const hash = crypto.isCurrentHash(r.value_hash) ? r.value_hash : crypto.identifierHash(r.system, value);
    if (enc === r.value_enc && hash === r.value_hash) return 'unchanged';
    // Role aplikasi tidak punya hak UPDATE nilai identifier; fungsi sempit ini hanya mengganti versi kunci (CAS).
    const [res] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT app_rekey_patient_identifier(${r.id}::uuid, ${r.value_enc}, ${r.value_hash}, ${enc}, ${hash}) AS ok`;
    return res?.ok ? 'rewritten' : 'conflict';
  },
  async pending(tx, ctx) {
    const [r] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM patient_identifiers
      WHERE app_field_key_id(value_enc) IS DISTINCT FROM ${ctx.enc}
         OR app_blind_index_key_id(value_hash) IS DISTINCT FROM ${ctx.hash}`;
    return r?.n ?? 0;
  },
  usage: async (tx) => [
    await columnUsage(tx, 'patient_identifiers', 'value_enc', 'enc'),
    await columnUsage(tx, 'patient_identifiers', 'value_hash', 'hash'),
  ],
  async inspect(tx, ctx, id) {
    const [r] = await tx.$queryRaw<IdentifierRow[]>`
      SELECT id::text AS id, system, value_enc, value_hash FROM patient_identifiers WHERE id = ${id}::uuid`;
    if (!r) return;
    const value = ctx.crypto.decryptIdentifier(r.value_enc);
    assertHash(r.value_hash, ctx.crypto.identifierHashes(r.system, value));
  },
};

interface LinkRow extends Row {
  value: string;
}

/** Snapshot penggabungan: kunci luar + ciphertext/hash bersarang. */
function rekeyLink(ctx: Ctx, stored: string): string | null {
  const snapshot = ctx.crypto.decryptSnapshot<SurvivorSnapshot>(stored);
  const next = rekeySurvivorSnapshot(snapshot, ctx.crypto);
  if (!next.changed && ctx.crypto.isCurrentCipher(stored)) return null;
  return ctx.crypto.encryptSnapshot(next.snapshot);
}

const linksTarget: TargetSpec<LinkRow> = {
  target: 'patient_links',
  // Isi bersarang tidak terlihat di SQL: setiap snapshot diperiksa (tabel kecil; penggabungan jarang).
  select: (tx, _ctx, cursor, limit) => tx.$queryRaw`
    SELECT id::text AS id, survivor_snapshot_enc AS value FROM patient_links
    WHERE survivor_snapshot_enc IS NOT NULL ${cursorFilter(cursor)}
    ORDER BY id LIMIT ${limit}`,
  async rewrite(tx, ctx, r) {
    const next = rekeyLink(ctx, r.value);
    if (next === null) return 'unchanged';
    const [res] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT app_rekey_patient_link(${r.id}::uuid, ${r.value}, ${next}) AS ok`;
    return res?.ok ? 'rewritten' : 'conflict';
  },
  pending: () => Promise.resolve(null),
  usage: async (tx) => [await columnUsage(tx, 'patient_links', 'survivor_snapshot_enc', 'enc')],
  async inspect(tx, ctx, id) {
    const [r] = await tx.$queryRaw<Array<{ value: string | null }>>`
      SELECT survivor_snapshot_enc AS value FROM patient_links WHERE id = ${id}::uuid`;
    if (!r?.value) return;
    const s = ctx.crypto.decryptSnapshot<SurvivorSnapshot>(r.value);
    if (s.address) ctx.crypto.decryptContact(s.address);
    if (s.phone?.enc) {
      const phone = ctx.crypto.decryptContact(s.phone.enc);
      if (s.phone.hash) assertHash(s.phone.hash, ctx.crypto.phoneHashes(phone));
    }
    for (const [system, v] of Object.entries(s.identifiers ?? {})) {
      if (!v) continue;
      const value = ctx.crypto.decryptIdentifier(v.valueEnc);
      assertHash(v.valueHash, ctx.crypto.identifierHashes(system as IdentifierSystem, value));
    }
  },
};

interface ContactRow extends Row {
  name_enc: string;
  phone_enc: string | null;
  address_enc: string | null;
}

/** Keluarga/penanggung jawab pasien (F03, append-only): nama, HP, alamat tujuan `contact`, tanpa blind index. */
const contactsTarget: TargetSpec<ContactRow> = {
  target: 'patient_contacts',
  select: (tx, ctx, cursor, limit) => tx.$queryRaw`
    SELECT id::text AS id, name_enc, phone_enc, address_enc FROM patient_contacts
    WHERE (app_field_key_id(name_enc) IS DISTINCT FROM ${ctx.enc}
        OR (phone_enc IS NOT NULL AND app_field_key_id(phone_enc) IS DISTINCT FROM ${ctx.enc})
        OR (address_enc IS NOT NULL AND app_field_key_id(address_enc) IS DISTINCT FROM ${ctx.enc}))
      ${cursorFilter(cursor)}
    ORDER BY id LIMIT ${limit}`,
  async rewrite(tx, ctx, r) {
    const { crypto } = ctx;
    const re = (v: string | null) =>
      v === null || crypto.isCurrentCipher(v) ? v : crypto.encryptContact(crypto.decryptContact(v));
    const name = re(r.name_enc) as string;
    const phone = re(r.phone_enc);
    const address = re(r.address_enc);
    if (name === r.name_enc && phone === r.phone_enc && address === r.address_enc) return 'unchanged';
    // Tabel append-only: fungsi sempit hanya mengganti versi kunci kolom terenkripsi (CAS, penjaga trigger).
    const [res] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT app_rekey_patient_contact(${r.id}::uuid, ${r.name_enc}, ${r.phone_enc}, ${r.address_enc},
        ${name}, ${phone}, ${address}) AS ok`;
    return res?.ok ? 'rewritten' : 'conflict';
  },
  async pending(tx, ctx) {
    const [r] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM patient_contacts
      WHERE app_field_key_id(name_enc) IS DISTINCT FROM ${ctx.enc}
         OR (phone_enc IS NOT NULL AND app_field_key_id(phone_enc) IS DISTINCT FROM ${ctx.enc})
         OR (address_enc IS NOT NULL AND app_field_key_id(address_enc) IS DISTINCT FROM ${ctx.enc})`;
    return r?.n ?? 0;
  },
  usage: async (tx) => [
    await columnUsage(tx, 'patient_contacts', 'name_enc', 'enc'),
    await columnUsage(tx, 'patient_contacts', 'phone_enc', 'enc'),
    await columnUsage(tx, 'patient_contacts', 'address_enc', 'enc'),
  ],
  async inspect(tx, ctx, id) {
    const [r] = await tx.$queryRaw<ContactRow[]>`
      SELECT id::text AS id, name_enc, phone_enc, address_enc FROM patient_contacts WHERE id = ${id}::uuid`;
    if (!r) return;
    for (const v of [r.name_enc, r.phone_enc, r.address_enc]) if (v) ctx.crypto.decryptContact(v);
  },
};

const SPECS: Record<KeyRotationTarget, TargetSpec<Row>> = {
  users: simpleTarget('users', 'phone_enc', 'staff_phone') as unknown as TargetSpec<Row>,
  mfa_factors: simpleTarget('mfa_factors', 'secret_enc', 'mfa_secret') as unknown as TargetSpec<Row>,
  login_challenges: simpleTarget('login_challenges', 'otp_enc', 'login_otp') as unknown as TargetSpec<Row>,
  patients: patientsTarget as unknown as TargetSpec<Row>,
  patient_identifiers: identifiersTarget as unknown as TargetSpec<Row>,
  patient_links: linksTarget as unknown as TargetSpec<Row>,
  patient_contacts: contactsTarget as unknown as TargetSpec<Row>,
};

const context = (tenantId: string, keys: FieldKeys): Ctx => ({
  tenantId,
  keys,
  crypto: new PatientCrypto(keys, tenantId),
  enc: keys.enc.currentId,
  hash: keys.hash.currentId,
});

const errorCode = (err: FieldKeyError) => (err.keyId ? `${err.code}:${err.keyId}` : err.code);

// ---------------------------------------------------------------------------------------------------------------
// Rencana (dry-run) + pemeriksaan awal
// ---------------------------------------------------------------------------------------------------------------

export interface KeyRotationProblem {
  target: KeyRotationTarget | 'registered_devices';
  /** Kode stabil + ID kunci bila ada, mis. `FIELD_KEY_UNKNOWN:v0`, `FIELD_DECRYPT_FAILED:v1`. */
  code: string;
  column?: string;
  rows?: number;
}

export interface TargetPlan {
  target: KeyRotationTarget;
  columns: ColumnKeyUsage[];
  /** Baris yang akan ditulis ulang ke kunci aktif. */
  pending: number;
}

export interface TenantKeyPlan {
  tenantId: string;
  encKeyId: string;
  hashKeyId: string;
  targets: TargetPlan[];
  /** PIN aktif per ID kunci lada (`pin_key_id`). */
  pins: Record<string, number>;
  /** Masalah yang menghentikan `--run` (gagal tertutup). */
  problems: KeyRotationProblem[];
  /** Tidak ada lagi data maupun PIN aktif yang memakai kunci lama: kunci lama boleh dipensiunkan. */
  retireReady: boolean;
}

const PLAN_CHUNK = 500;

/** Snapshot penggabungan dibaca per potongan (transaksi pendek): hitung yang perlu ditulis ulang + masalah. */
async function planLinks(
  prisma: PrismaClient,
  ctx: Ctx,
  problems: KeyRotationProblem[],
): Promise<{ pending: number; nested: ColumnKeyUsage }> {
  const nested: ColumnKeyUsage = { column: 'survivor_snapshot_enc (isi)', kind: 'enc', counts: {} };
  const failures = new Map<string, number>();
  let pending = 0;
  let cursor: string | null = null;
  for (;;) {
    const rows: LinkRow[] = await withTenant(prisma, ctx.tenantId, (tx) =>
      linksTarget.select(tx, ctx, cursor, PLAN_CHUNK),
    );
    for (const r of rows) {
      try {
        const s = ctx.crypto.decryptSnapshot<SurvivorSnapshot>(r.value);
        const values = [
          s.address,
          s.phone?.enc,
          ...Object.values(s.identifiers ?? {}).map((v) => v?.valueEnc),
        ].filter((v): v is string => typeof v === 'string');
        for (const v of values) {
          const k = fieldKeyId(v) ?? 'invalid';
          nested.counts[k] = (nested.counts[k] ?? 0) + 1;
        }
        const hashes = [s.phone?.hash, ...Object.values(s.identifiers ?? {}).map((v) => v?.valueHash)].filter(
          (v): v is string => typeof v === 'string',
        );
        for (const h of hashes) {
          const k = `hash:${blindIndexKeyId(h) ?? 'invalid'}`;
          nested.counts[k] = (nested.counts[k] ?? 0) + 1;
        }
        if (rekeyLink(ctx, r.value) !== null) pending += 1;
      } catch (err) {
        if (!(err instanceof FieldKeyError)) throw err;
        failures.set(errorCode(err), (failures.get(errorCode(err)) ?? 0) + 1);
        pending += 1;
      }
    }
    if (rows.length < PLAN_CHUNK) break;
    cursor = rows.at(-1)?.id ?? null;
  }
  for (const [code, rows] of failures) {
    problems.push({ target: 'patient_links', code, column: 'survivor_snapshot_enc', rows });
  }
  return { pending, nested };
}

/**
 * Rencana rotasi satu tenant (dry-run, hanya baca): versi kunci per kolom, baris yang akan ditulis ulang, PIN per
 * kunci lada, dan pemeriksaan awal gagal-tertutup (ID kunci di data ada di cincin, contoh baris per versi bisa
 * didekripsi dan blind index-nya cocok).
 */
export async function planTenantKeyRotation(
  prisma: PrismaClient,
  tenantId: string,
  keys: FieldKeys,
  targets: readonly KeyRotationTarget[] = KEY_ROTATION_TARGETS,
): Promise<TenantKeyPlan> {
  const ctx = context(tenantId, keys);
  const problems: KeyRotationProblem[] = [];
  const plans: TargetPlan[] = [];
  for (const target of targets) {
    const spec = SPECS[target];
    const result = await withTenant(
      prisma,
      tenantId,
      async (tx) => {
        const usage = await spec.usage(tx);
        for (const col of usage) {
          const ring = col.kind === 'enc' ? keys.enc : keys.hash;
          for (const [keyId, rows] of Object.entries(col.counts)) {
            if (keyId === 'invalid') {
              problems.push({ target, code: 'FIELD_FORMAT', column: col.column, rows });
              continue;
            }
            if (!ring.has(keyId)) {
              problems.push({ target, code: `FIELD_KEY_UNKNOWN:${keyId}`, column: col.column, rows });
              continue;
            }
            const sample = col.samples[keyId];
            if (!sample) continue;
            try {
              await spec.inspect(tx, ctx, sample);
            } catch (err) {
              if (!(err instanceof FieldKeyError)) throw err;
              problems.push({ target, code: errorCode(err), column: col.column });
            }
          }
        }
        return {
          columns: usage.map(({ samples: _s, ...c }) => c),
          pending: await spec.pending(tx, ctx),
        };
      },
      { timeoutMs: 120_000, maxWaitMs: 10_000 },
    );
    let { pending } = result;
    const columns = result.columns;
    if (pending === null) {
      const links = await planLinks(prisma, ctx, problems);
      pending = links.pending;
      columns.push(links.nested);
    }
    plans.push({ target, columns, pending });
  }
  const pins = await withTenant(prisma, tenantId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ key: string | null; n: number }>>`
      SELECT pin_key_id AS key, count(*)::int AS n FROM registered_devices
      WHERE kind = 'staff_pin' AND revoked_at IS NULL AND expires_at > now() GROUP BY 1`;
    return Object.fromEntries(rows.map((r) => [r.key ?? 'invalid', r.n]));
  });
  const onlyCurrent = (c: ColumnKeyUsage) =>
    Object.keys(c.counts).every((k) =>
      c.kind === 'hash'
        ? k === ctx.hash
        : k === ctx.enc || (k.startsWith('hash:') && k.slice(5) === ctx.hash),
    );
  const retireReady =
    problems.length === 0 &&
    plans.every((p) => p.pending === 0 && p.columns.every(onlyCurrent)) &&
    Object.keys(pins).every((k) => k === ctx.hash);
  return { tenantId, encKeyId: ctx.enc, hashKeyId: ctx.hash, targets: plans, pins, problems, retireReady };
}

// ---------------------------------------------------------------------------------------------------------------
// Jalankan (batch + kursor + status)
// ---------------------------------------------------------------------------------------------------------------

export interface KeyRotationOptions {
  /** Baris per batch (satu transaksi pendek). Bawaan 200. */
  batchSize?: number;
  /** Jeda antar-batch (ms) agar beban database tetap rendah. Bawaan 100. */
  pauseMs?: number;
  targets?: readonly KeyRotationTarget[];
  /** Hentikan dengan rapi di antara batch (worker berhenti, operator Ctrl+C, tes interupsi). */
  signal?: AbortSignal;
  /** Kemajuan per batch (tanpa nilai). */
  onBatch?: (p: KeyRotationBatch) => void;
}

export interface KeyRotationBatch {
  tenantId: string;
  target: KeyRotationTarget;
  scanned: number;
  rewritten: number;
  failed: number;
  done: boolean;
}

export interface TargetRunReport {
  target: KeyRotationTarget;
  scanned: number;
  rewritten: number;
  failed: number;
  /** Baris yang masih memakai kunci lama di akhir putaran; null bila putaran belum selesai. */
  remaining: number | null;
  lastError: string | null;
}

export interface TenantKeyRotationReport {
  tenantId: string;
  encKeyId: string;
  hashKeyId: string;
  targets: TargetRunReport[];
  /** Berhenti di tengah (sinyal); jalankan lagi untuk melanjutkan dari kursor. */
  interrupted: boolean;
}

/** Pemeriksaan awal menemukan masalah: tidak ada yang ditulis (gagal tertutup). */
export class KeyRotationBlockedError extends Error {
  constructor(
    readonly tenantId: string,
    readonly problems: KeyRotationProblem[],
  ) {
    super(
      `Rotasi kunci tenant ${tenantId} dihentikan sebelum menulis: ${problems
        .map(
          (p) =>
            `${p.target}${p.column ? `.${p.column}` : ''} ${p.code}${p.rows ? ` (${p.rows} baris)` : ''}`,
        )
        .join('; ')}`,
    );
    this.name = 'KeyRotationBlockedError';
  }
}

interface StatusRow {
  id: string;
  cursor_id: string | null;
}

/**
 * Kunci baris status tenant × tabel (FOR UPDATE: pelari lain menunggu batch ini selesai). Putaran baru dimulai bila
 * kunci aktif berubah, atau di batch pertama sebuah jalan bila putaran sebelumnya sudah selesai. Null = putaran ini
 * sudah diselesaikan pelari lain.
 */
async function lockStatus(
  tx: TenantTx,
  ctx: Ctx,
  target: KeyRotationTarget,
  fresh: boolean,
): Promise<StatusRow | null> {
  await tx.$executeRaw`
    INSERT INTO field_key_rotations (id, tenant_id, target, enc_key_id, hash_key_id)
    VALUES (${newId()}::uuid, ${ctx.tenantId}::uuid, ${target}, ${ctx.enc}, ${ctx.hash})
    ON CONFLICT (tenant_id, target) DO NOTHING`;
  const [row] = await tx.$queryRaw<
    Array<StatusRow & { enc_key_id: string; hash_key_id: string; finished: boolean }>
  >`
    SELECT id::text AS id, cursor_id::text AS cursor_id, enc_key_id, hash_key_id, finished_at IS NOT NULL AS finished
    FROM field_key_rotations WHERE tenant_id = ${ctx.tenantId}::uuid AND target = ${target} FOR UPDATE`;
  if (!row) throw new Error('Status rotasi kunci tidak ditemukan');
  const newKeys = row.enc_key_id !== ctx.enc || row.hash_key_id !== ctx.hash;
  if (newKeys || (fresh && row.finished)) {
    await tx.$executeRaw`
      UPDATE field_key_rotations SET enc_key_id = ${ctx.enc}, hash_key_id = ${ctx.hash}, cursor_id = NULL,
        scanned = 0, rewritten = 0, failed = 0, remaining = NULL, last_error = NULL, last_failed_id = NULL,
        started_at = now(), updated_at = now(), finished_at = NULL
      WHERE id = ${row.id}::uuid`;
    return { id: row.id, cursor_id: null };
  }
  return row.finished ? null : { id: row.id, cursor_id: row.cursor_id };
}

async function runBatch(
  prisma: PrismaClient,
  ctx: Ctx,
  spec: TargetSpec<Row>,
  batchSize: number,
  fresh: boolean,
): Promise<KeyRotationBatch & { remaining: number | null; lastError: string | null }> {
  return withTenant(
    prisma,
    ctx.tenantId,
    async (tx) => {
      // Batch pendek: tunggu kunci baris maksimal 5 detik, jangan menahan transaksi aplikasi lama.
      await tx.$executeRaw`SELECT set_config('lock_timeout', '5s', true)`;
      const status = await lockStatus(tx, ctx, spec.target, fresh);
      const base = { tenantId: ctx.tenantId, target: spec.target, scanned: 0, rewritten: 0, failed: 0 };
      if (!status) return { ...base, done: true, remaining: null, lastError: null };
      const rows = await spec.select(tx, ctx, status.cursor_id, batchSize);
      let rewritten = 0;
      let failed = 0;
      let lastError: string | null = null;
      let lastFailedId: string | null = null;
      for (const row of rows) {
        try {
          if ((await spec.rewrite(tx, ctx, row)) === 'rewritten') rewritten += 1;
        } catch (err) {
          // Hanya galat kunci/dekripsi yang dilewati per baris (dicatat kodenya); galat lain menggagalkan batch.
          if (!(err instanceof FieldKeyError)) throw err;
          failed += 1;
          lastError = errorCode(err);
          lastFailedId = row.id;
        }
      }
      const done = rows.length < batchSize;
      const remaining = done ? await spec.pending(tx, ctx) : null;
      const cursor = rows.at(-1)?.id ?? status.cursor_id;
      const [after] = await tx.$queryRaw<Array<{ remaining: number | null; last_error: string | null }>>`
        UPDATE field_key_rotations SET
          cursor_id = ${cursor}::uuid,
          scanned = scanned + ${rows.length}, rewritten = rewritten + ${rewritten}, failed = failed + ${failed},
          last_error = COALESCE(${lastError}, last_error),
          last_failed_id = COALESCE(${lastFailedId}::uuid, last_failed_id),
          remaining = CASE WHEN ${done}::boolean THEN COALESCE(${remaining}::int, failed + ${failed}) END,
          finished_at = CASE WHEN ${done}::boolean THEN now() END,
          updated_at = now()
        WHERE id = ${status.id}::uuid
        RETURNING remaining, last_error`;
      return {
        ...base,
        scanned: rows.length,
        rewritten,
        failed,
        done,
        remaining: after?.remaining ?? null,
        lastError: after?.last_error ?? null,
      };
    },
    { timeoutMs: 60_000, maxWaitMs: 10_000 },
  );
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

/** Batch idempoten: galat sementara (kunci baris, koneksi) dicoba ulang dua kali dengan jeda. */
async function runBatchWithRetry(...args: Parameters<typeof runBatch>): ReturnType<typeof runBatch> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runBatch(...args);
    } catch (err) {
      if (attempt >= 3 || err instanceof FieldKeyError) throw err;
      await sleep(1000 * attempt);
    }
  }
}

/**
 * Enkripsi ulang satu tenant ke kunci aktif. Pemeriksaan awal (`planTenantKeyRotation`) harus bersih; bila tidak,
 * `KeyRotationBlockedError` dan tidak ada yang ditulis. Bisa dihentikan (`signal`) dan dilanjutkan kapan saja.
 * Satu entri audit per tenant bila ada baris yang ditulis ulang atau gagal (tanpa nilai).
 */
export async function rotateTenantKeys(
  prisma: PrismaClient,
  tenantId: string,
  keys: FieldKeys,
  opts: KeyRotationOptions = {},
): Promise<TenantKeyRotationReport> {
  const targets = opts.targets ?? KEY_ROTATION_TARGETS;
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 2000);
  const pauseMs = Math.max(opts.pauseMs ?? 100, 0);
  const plan = await planTenantKeyRotation(prisma, tenantId, keys, targets);
  if (plan.problems.length > 0) throw new KeyRotationBlockedError(tenantId, plan.problems);
  const ctx = context(tenantId, keys);
  const report: TenantKeyRotationReport = {
    tenantId,
    encKeyId: ctx.enc,
    hashKeyId: ctx.hash,
    targets: [],
    interrupted: false,
  };
  for (const target of targets) {
    const spec = SPECS[target];
    const t: TargetRunReport = {
      target,
      scanned: 0,
      rewritten: 0,
      failed: 0,
      remaining: null,
      lastError: null,
    };
    report.targets.push(t);
    for (let fresh = true; ; fresh = false) {
      if (opts.signal?.aborted) {
        report.interrupted = true;
        break;
      }
      const b = await runBatchWithRetry(prisma, ctx, spec, batchSize, fresh);
      t.scanned += b.scanned;
      t.rewritten += b.rewritten;
      t.failed += b.failed;
      t.lastError = b.lastError ?? t.lastError;
      opts.onBatch?.(b);
      if (b.done) {
        t.remaining = b.remaining;
        break;
      }
      await sleep(pauseMs, opts.signal);
    }
    if (report.interrupted) break;
  }
  const rewritten = report.targets.reduce((n, t) => n + t.rewritten, 0);
  const failed = report.targets.reduce((n, t) => n + t.failed, 0);
  if (rewritten + failed > 0) {
    await withTenant(prisma, tenantId, (tx) =>
      tx.auditEvent.create({
        data: {
          id: newId(),
          tenantId,
          resourceType: 'field_key_rotation',
          action: 'update',
          outcome: 'success',
          reason: 'Enkripsi ulang kolom ke kunci aktif (rotasi kunci)',
          details: {
            encKeyId: ctx.enc,
            hashKeyId: ctx.hash,
            interrupted: report.interrupted,
            targets: report.targets.map(({ target, rewritten: w, failed: f, remaining }) => ({
              target,
              rewritten: w,
              failed: f,
              remaining,
            })),
          },
        },
      }),
    );
  }
  return report;
}

/**
 * Cabut PIN aktif yang ladanya memakai kunci hash selain kunci aktif (`key_rotated`), beserta sesi PIN-nya.
 * Dipakai saat kunci hash lama harus segera dipensiunkan (mis. dugaan bocor) sebelum PIN lama kedaluwarsa sendiri
 * (≤ 30 hari). Satu entri audit per tenant. Mengembalikan jumlah PIN yang dicabut.
 */
export async function revokePinsOnRetiredKeys(
  prisma: PrismaClient,
  tenantId: string,
  keys: FieldKeys,
): Promise<number> {
  const current = keys.hash.currentId;
  return withTenant(prisma, tenantId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; key: string }>>`
      UPDATE registered_devices SET revoked_at = now(), revoked_reason = 'key_rotated'
      WHERE kind = 'staff_pin' AND revoked_at IS NULL AND pin_key_id IS DISTINCT FROM ${current}
      RETURNING id::text AS id, pin_key_id AS key`;
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await tx.$executeRaw`
      UPDATE auth_sessions SET status = 'revoked', revoked_at = now(), revoked_reason = 'pin_revoked'
      WHERE device_id = ANY(${ids}::uuid[]) AND status = 'active'`;
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId,
        resourceType: 'registered_device',
        action: 'deactivate',
        outcome: 'success',
        reason: 'key_rotated',
        details: { revoked: rows.length, keyIds: [...new Set(rows.map((r) => r.key))].sort(), current },
      },
    });
    return rows.length;
  });
}
