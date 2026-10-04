/**
 * Penjaga struktural skema: berlaku otomatis untuk SETIAP tabel baru, sehingga lupa menambah blok RLS
 * di migrasi langsung ketahuan di tes, bukan di produksi.
 */
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../src/index';
import { testDbUrls } from '../src/testing';

let owner: PrismaClient;

beforeAll(() => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
});

afterAll(async () => {
  await owner.$disconnect();
});

/** Indeks yang ditulis manual di migrasi (unik parsial, trigram) sehingga tidak terlihat di schema.prisma. */
const MANUAL_INDEXES = [
  'mfa_factors_one_active_per_user',
  'tenants_single_platform',
  'patient_identifiers_one_active_per_system',
  'patients_name_search_trgm',
  'patient_match_candidates_pair',
  'patient_links_one_active_per_merged',
  'privacy_consents_one_active',
];

/** Registri tanpa FORCE (dibaca fungsi SECURITY DEFINER; ADR-0008/0011). */
const REGISTRY_TABLES = new Set(['tenants', 'tenant_domains']);

describe('penjaga skema', () => {
  it('setiap tabel ber-tenant_id: RLS ENABLE + FORCE + kebijakan tenant_isolation', async () => {
    const rows = await owner.$queryRaw<
      Array<{ table: string; rls: boolean; forced: boolean; policies: bigint }>
    >`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')
      ORDER BY 1`;
    expect(rows.length).toBeGreaterThan(15);
    const bad = rows
      .filter((r) => !REGISTRY_TABLES.has(r.table))
      .filter((r) => !r.rls || !r.forced || Number(r.policies) !== 1)
      .map((r) => `${r.table} (rls=${r.rls}, force=${r.forced}, policy=${r.policies})`);
    expect(bad, 'tabel tanpa isolasi tenant lengkap').toEqual([]);
  });

  it('role aplikasi tidak punya BYPASSRLS dan bukan superuser', async () => {
    const [role] = await owner.$queryRaw<Array<{ bypass: boolean; superuser: boolean }>>`
      SELECT rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname = 'simrs_app'`;
    expect(role).toEqual({ bypass: false, superuser: false });
  });

  it('role aplikasi tidak bisa menghapus data master, identitas, pasien, audit, atau jejak akses darurat', async () => {
    const tables = [
      'audit_events',
      'facilities',
      'units',
      'locations',
      'users',
      'user_credentials',
      'mfa_factors',
      'auth_sessions',
      'roles',
      'staff_assignments',
      'break_glass_grants',
      'notifications',
      'patients',
      'patient_identifiers',
      'patient_match_candidates',
      'patient_links',
      'privacy_consents',
    ];
    const rows = await owner.$queryRaw<Array<{ table: string; can_delete: boolean }>>`
      SELECT t AS table, has_table_privilege('simrs_app', 'public.' || t, 'DELETE') AS can_delete
      FROM unnest(${tables}::text[]) AS t`;
    expect(rows.filter((r) => r.can_delete).map((r) => r.table)).toEqual([]);
  });

  it('indeks unik parsial manual (tidak dimodelkan Prisma) tetap ada', async () => {
    const rows = await owner.$queryRaw<Array<{ name: string }>>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY(${MANUAL_INDEXES})
      ORDER BY 1`;
    expect(rows.map((r) => r.name)).toEqual([...MANUAL_INDEXES].sort());
  });

  it('hanya satu tenant platform, dan jenis tenant dibatasi', async () => {
    const code = () => `PX${newId().slice(-8).toUpperCase()}`;
    await expect(
      owner.tenant.create({ data: { id: newId(), code: code(), name: 'Platform kedua', kind: 'platform' } }),
    ).rejects.toThrow();
    await expect(
      owner.tenant.create({ data: { id: newId(), code: code(), name: 'Jenis tak dikenal', kind: 'klinik' } }),
    ).rejects.toThrow();
  });

  it('nomor RM dan nilai identifier pasien tidak bisa diubah role aplikasi', async () => {
    const [p] = await owner.$queryRaw<
      Array<{ mrn: boolean; name: boolean; value: boolean; active: boolean }>
    >`
      SELECT has_column_privilege('simrs_app', 'public.patients', 'mrn', 'UPDATE') AS mrn,
             has_column_privilege('simrs_app', 'public.patients', 'name', 'UPDATE') AS name,
             has_column_privilege('simrs_app', 'public.patient_identifiers', 'value_enc', 'UPDATE') AS value,
             has_column_privilege('simrs_app', 'public.patient_identifiers', 'active', 'UPDATE') AS active`;
    expect(p).toEqual({ mrn: false, name: true, value: false, active: true });
  });

  it('alasan akses darurat tidak bisa diubah setelah dicatat (hanya kolom tinjauan)', async () => {
    const [p] = await owner.$queryRaw<Array<{ reason: boolean; review: boolean }>>`
      SELECT has_column_privilege('simrs_app', 'public.break_glass_grants', 'reason', 'UPDATE') AS reason,
             has_column_privilege('simrs_app', 'public.break_glass_grants', 'review_outcome', 'UPDATE') AS review`;
    expect(p).toEqual({ reason: false, review: true });
  });
});
