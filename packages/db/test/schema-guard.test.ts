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
  'patient_match_candidates_pair',
  'patient_links_one_active_per_merged',
  'privacy_consents_one_active',
  'form_definitions_one_published',
  'form_definitions_one_open_draft',
  'form_responses_supersedes_once',
  'seps_supersedes_once',
  'seps_one_chain_per_encounter',
  'patient_contacts_supersedes_once',
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

  it('tabel ber-tenant_id di luar public (indeks pencarian): RLS + kebijakan, tanpa hak apa pun bagi role aplikasi', async () => {
    // Pola ADR-0008/0015: dibaca pemilik lewat fungsi SECURITY DEFINER sempit, jadi tanpa FORCE, tetapi role
    // aplikasi sama sekali tidak boleh membacanya langsung.
    const rows = await owner.$queryRaw<
      Array<{ table: string; rls: boolean; policies: bigint; app_access: boolean }>
    >`
      SELECT n.nspname || '.' || c.relname AS table, c.relrowsecurity AS rls,
             (SELECT count(*) FROM pg_policies p
              WHERE p.schemaname = n.nspname AND p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policies,
             has_table_privilege('simrs_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS app_access
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')
        AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
      ORDER BY 1`;
    expect(rows.map((r) => r.table)).toContain('search.patient_names');
    const bad = rows
      .filter((r) => !r.rls || Number(r.policies) !== 1 || r.app_access)
      .map((r) => `${r.table} (rls=${r.rls}, policy=${r.policies}, app=${r.app_access})`);
    expect(bad, 'tabel indeks tanpa isolasi').toEqual([]);
  });

  it('fungsi SECURITY DEFINER menyetel search_path dengan pg_temp di akhir (ADR-0008)', async () => {
    // Tanpa pg_temp eksplisit, skema sementara dicari PERTAMA untuk tabel: sesi dengan hak TEMP bisa membuat
    // tabel sementara bernama sama (mis. `tenants`) yang lalu dibaca fungsi dengan hak pemiliknya.
    const rows = await owner.$queryRaw<Array<{ fn: string; config: string[] | null }>>`
      SELECT p.proname AS fn, p.proconfig AS config FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`;
    expect(rows.map((r) => r.fn)).toContain('app_active_tenant_ids');
    const bad = rows
      .filter((r) => {
        const path = r.config?.find((c) => c.startsWith('search_path='));
        return !path || !/(^|[ ,])pg_temp$/.test(path.replace(/"/g, ''));
      })
      .map((r) => `${r.fn} (${r.config?.join('; ') ?? 'tanpa SET'})`);
    expect(bad, 'SECURITY DEFINER tanpa pg_temp di akhir search_path').toEqual([]);
  });

  it('role aplikasi tidak punya BYPASSRLS dan bukan superuser', async () => {
    const [role] = await owner.$queryRaw<Array<{ bypass: boolean; superuser: boolean }>>`
      SELECT rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname = 'simrs_app'`;
    expect(role).toEqual({ bypass: false, superuser: false });
  });

  it('role aplikasi tidak bisa menghapus data master, identitas, pasien, audit, atau jejak akses darurat', async () => {
    const tables = [
      'audit_events',
      'audit_anchors',
      'audit_daily_summaries',
      'audit_daily_summary_items',
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
      'form_definitions',
      'form_responses',
      'documents',
      'document_signatures',
      'trusted_devices',
      'registered_devices',
      // Fase 2 · front office (potongan 0b): master dinonaktifkan, transaksi tidak dihapus.
      'practitioners',
      'external_ids',
      'payers',
      'queue_services',
      'queue_displays',
      'queue_display_services',
      'practitioner_schedules',
      'schedule_sessions',
      'hfis_schedule_snapshots',
      'appointments',
      'queue_tickets',
      'queue_calls',
      'bpjs_queue_tasks',
      'encounters',
      'encounter_status_history',
      'coverages',
      'referrals',
      'seps',
      'patient_contacts',
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

  it('setiap tabel skema ref (data rujukan global, daftar sandi bocor) hanya bisa dibaca role aplikasi', async () => {
    const rows = await owner.$queryRaw<
      Array<{ table: string; sel: boolean; ins: boolean; upd: boolean; del: boolean }>
    >`
      SELECT t AS table,
             has_table_privilege('simrs_app', 'ref.' || t, 'SELECT') AS sel,
             has_table_privilege('simrs_app', 'ref.' || t, 'INSERT') AS ins,
             has_table_privilege('simrs_app', 'ref.' || t, 'UPDATE') AS upd,
             has_table_privilege('simrs_app', 'ref.' || t, 'DELETE') AS del
      FROM (SELECT tablename AS t FROM pg_tables WHERE schemaname = 'ref') AS ref_tables
      ORDER BY 1`;
    expect(rows.filter((r) => !r.sel || r.ins || r.upd || r.del).map((r) => r.table)).toEqual([]);
    expect(rows.map((r) => r.table)).toEqual(
      expect.arrayContaining([
        'breached_password_imports',
        'breached_passwords',
        'code_systems',
        'concepts',
        'regions',
      ]),
    );
  });

  it('perangkat terdaftar: jenis, hash PIN/token, akun, dan masa berlaku tidak bisa diubah role aplikasi', async () => {
    const columns = [
      'kind',
      'pin_hash',
      'token_hash',
      'user_id',
      'expires_at',
      'failed_attempts',
      'revoked_at',
    ];
    const rows = await owner.$queryRaw<Array<{ column: string; can_update: boolean }>>`
      SELECT c AS column, has_column_privilege('simrs_app', 'public.registered_devices', c, 'UPDATE') AS can_update
      FROM unnest(${columns}::text[]) AS c`;
    expect(rows.filter((r) => r.can_update).map((r) => r.column)).toEqual(['failed_attempts', 'revoked_at']);
  });

  it('alasan akses darurat tidak bisa diubah setelah dicatat (hanya kolom tinjauan)', async () => {
    const [p] = await owner.$queryRaw<Array<{ reason: boolean; review: boolean }>>`
      SELECT has_column_privilege('simrs_app', 'public.break_glass_grants', 'reason', 'UPDATE') AS reason,
             has_column_privilege('simrs_app', 'public.break_glass_grants', 'review_outcome', 'UPDATE') AS review`;
    expect(p).toEqual({ reason: false, review: true });
  });
});
