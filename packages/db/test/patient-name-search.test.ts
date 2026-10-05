/**
 * P05 · Pencarian nama pasien lewat indeks trigram di bawah RLS (ADR-0015, pembaruan 5 Okt 2026):
 * `search.patient_names` (tanpa FORCE, tanpa hak simrs_app) + `app_search_patient_names()` (SECURITY DEFINER,
 * tenant dari konteks). Diuji: bentuk fungsi yang sempit, hasil sama dengan kueri lama, isolasi tenant, sinkron
 * lewat trigger, dan rencana kueri yang benar-benar memakai indeks trigram.
 */
import { newId, normalizePersonName } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, insertPatient, type PrismaClient, Prisma, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

const keys = {
  encKeyB64: Buffer.alloc(32, 21).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 23).toString('base64'),
};
let app: PrismaClient;
let owner: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const tag = () => newId().slice(-6).toUpperCase();

/** Tenant fiktif baru (hasil pencarian pasti; pasien uji tidak pernah dibuat di tenant seed bersama). */
async function freshTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({ data: { id, code: `NM${tag()}`, name: 'RS Fiktif Uji Nama' } }),
  );
  return id;
}

async function addPatients(tenantId: string, names: string[]): Promise<Map<string, string>> {
  const crypto = new PatientCrypto(keys, tenantId);
  const ids = new Map<string, string>();
  await withTenant(app, tenantId, async (tx) => {
    for (const name of names) {
      const p = await insertPatient(tx, crypto, { name, sex: 'female', birthDate: '1980-01-01' });
      ids.set(name, p.id);
    }
  });
  return ids;
}

/** Kueri lama di API (sebelum 5 Okt 2026): langsung ke `patients`, operator trigram di bawah RLS. */
const legacySearch = (tenantId: string, q: string) =>
  withTenant(app, tenantId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p.id::text AS id FROM patients p
      WHERE (p.name_search % ${q} OR ${q} <% p.name_search OR p.name_search LIKE ${`%${q}%`})
      ORDER BY greatest(similarity(p.name_search, ${q}), word_similarity(${q}, p.name_search)) DESC, p.mrn`;
    return rows.map((r) => r.id);
  });

/** Kueri baru (sama dengan MpiRepository.idsByName tanpa filter tambahan). */
const newSearch = (tenantId: string, q: string, before?: Prisma.Sql) =>
  withTenant(app, tenantId, async (tx) => {
    if (before) await tx.$executeRaw(before);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p.id::text AS id FROM app_search_patient_names(${q}) m JOIN patients p ON p.id = m.patient_id
      ORDER BY m.score DESC, p.mrn`;
    return rows.map((r) => r.id);
  });

const NAMES = [
  'Siti Nurhaliza',
  'Sitti Nurhalisa',
  'Siti Rahmawati',
  'Ny. Nur Aini',
  'Ahmad Nurhadi',
  'Budi Santoso',
  'Budi Santosa',
  'Rina Wulandari',
  'Muhammad Rizky Pratama',
  'Dewi Kartika Sari',
  'Kartini',
  'An. Bayu Aji',
];

describe('fungsi app_search_patient_names', () => {
  it('sempit: SECURITY DEFINER, search_path dipatok, satu parameter teks (tanpa tenant), hanya simrs_app', async () => {
    const [fn] = await owner.$queryRaw<
      Array<{
        secdef: boolean;
        args: string;
        config: string[];
        rows: number;
        public_exec: boolean;
        app_exec: boolean;
      }>
    >`
      SELECT p.prosecdef AS secdef, pg_get_function_identity_arguments(p.oid) AS args, p.proconfig AS config,
             p.prorows::int AS rows,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
               AS public_exec,
             has_function_privilege('simrs_app', p.oid, 'EXECUTE') AS app_exec
      FROM pg_proc p WHERE p.proname = 'app_search_patient_names'`;
    expect(fn).toMatchObject({ secdef: true, args: 'p_query text', public_exec: false, app_exec: true });
    // Perkiraan baris kecil: API menggabungkan ke `patients` lewat indeks PK, bukan memindai seluruh pasien RS.
    expect(fn?.rows).toBe(100);
    expect(fn?.config).toEqual(
      expect.arrayContaining([
        'search_path=pg_catalog, pg_temp',
        'pg_trgm.similarity_threshold=0.3',
        'pg_trgm.word_similarity_threshold=0.6',
      ]),
    );
    const [priv] = await owner.$queryRaw<Array<{ schema: boolean; sel: boolean; ins: boolean }>>`
      SELECT has_schema_privilege('simrs_app', 'search', 'USAGE') AS schema,
             has_table_privilege('simrs_app', 'search.patient_names', 'SELECT') AS sel,
             has_table_privilege('simrs_app', 'search.patient_names', 'INSERT') AS ins`;
    expect(priv).toEqual({ schema: false, sel: false, ins: false });
    const T = await freshTenant();
    await expect(
      withTenant(app, T, (tx) => tx.$queryRaw`SELECT count(*) FROM search.patient_names`),
    ).rejects.toThrow(/permission denied/);
  });

  it('tanpa konteks tenant → TENANT_REQUIRED (tenant tidak pernah dari parameter)', async () => {
    await expect(app.$queryRaw`SELECT * FROM app_search_patient_names(${'siti'})`).rejects.toThrow(
      /TENANT_REQUIRED/,
    );
  });

  it('hasil sama dengan kueri lama: ambang bawaan, salah ketik, sebagian nama, memuat teks', async () => {
    const T = await freshTenant();
    const ids = await addPatients(T, NAMES);
    const queries = [
      'siti nurhaliza',
      'siti nurhalisa', // salah ketik
      'nurhaliza',
      'siti',
      'nur', // memuat teks / kata pendek
      'budi santosa',
      'rizky',
      'kartika',
      'artin', // potongan di tengah kata (LIKE)
      'wulan',
      'bayu',
      'xyzq', // tidak ada
    ].map(normalizePersonName);
    let nonEmpty = 0;
    for (const q of queries) {
      const legacy = await legacySearch(T, q);
      expect(await newSearch(T, q), q).toEqual(legacy);
      if (legacy.length > 0) nonEmpty += 1;
    }
    expect(nonEmpty).toBeGreaterThanOrEqual(queries.length - 1);
    expect(await newSearch(T, 'siti nurhalisa')).toEqual(
      expect.arrayContaining([ids.get('Siti Nurhaliza'), ids.get('Sitti Nurhalisa')]),
    );
    // Ambang dipatok di fungsi: SET di sesi/transaksi tidak mengubah hasil.
    expect(
      await newSearch(T, 'siti nurhalisa', Prisma.sql`SET LOCAL pg_trgm.similarity_threshold = 0.95`),
    ).toEqual(await legacySearch(T, 'siti nurhalisa'));
  });

  it('karakter wildcard LIKE di teks pencarian tidak memperluas hasil', async () => {
    const T = await freshTenant();
    await addPatients(T, ['Siti Nurhaliza', 'Budi Santoso']);
    expect(await newSearch(T, '%%')).toEqual([]);
    expect(await newSearch(T, '__')).toEqual([]);
  });

  it('isolasi tenant: tenant B tidak pernah mendapat ID pasien tenant A, walau namanya sama persis', async () => {
    const A = await freshTenant();
    const B = await freshTenant();
    const idsA = [...(await addPatients(A, NAMES)).values()];
    const idsB = [...(await addPatients(B, ['Siti Nurhaliza', 'Budi Santoso'])).values()];
    for (const q of ['siti nurhaliza', 'siti', 'budi santoso', 'nur', 'rizky', 'kartini']) {
      const raw = await withTenant(
        app,
        B,
        (tx) =>
          tx.$queryRaw<
            Array<{ patient_id: string }>
          >`SELECT patient_id::text FROM app_search_patient_names(${q})`,
      );
      for (const r of raw) {
        expect(idsA).not.toContain(r.patient_id);
        expect(idsB).toContain(r.patient_id);
      }
    }
    expect(await newSearch(B, 'rizky')).toEqual([]);
  });

  it('trigger menjaga indeks: pasien baru langsung bisa dicari, ganti nama memperbarui indeks', async () => {
    const T = await freshTenant();
    const ids = await addPatients(T, ['Rahmat Hidayat']);
    const id = ids.get('Rahmat Hidayat') as string;
    expect(await newSearch(T, 'rahmat hidayat')).toEqual([id]);
    await withTenant(app, T, (tx) =>
      tx.patient.update({
        where: { id },
        data: { name: 'Rahmad Hidayatullah', nameSearch: normalizePersonName('Rahmad Hidayatullah') },
      }),
    );
    expect(await newSearch(T, 'hidayatullah')).toEqual([id]);
    const [row] = await owner.$queryRaw<Array<{ name_search: string }>>`
      SELECT name_search FROM search.patient_names WHERE patient_id = ${id}::uuid`;
    expect(row?.name_search).toBe('rahmad hidayatullah');
  });
});

/** Cari node rencana (EXPLAIN FORMAT JSON) secara rekursif. */
type PlanNode = { 'Node Type': string; 'Index Name'?: string; 'Index Cond'?: string; Plans?: PlanNode[] };
function nodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}

class Rollback extends Error {}

describe('rencana kueri (EXPLAIN)', () => {
  it('di dalam fungsi, kondisi nama menjadi Index Cond indeks trigram dan indeks benar-benar dipindai', async () => {
    const fakeTenant = newId();
    const checks: Record<string, unknown> = {};
    // Data sintetis 30 ribu nama satu RS dalam transaksi pemilik yang dibatalkan (FK ditunda, tidak ada yang
    // tersimpan). Perencanaan dengan biaya bawaan: tanpa SET apa pun yang memaksa indeks.
    await owner
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SET CONSTRAINTS search.patient_names_patient_fkey DEFERRED`;
          await tx.$executeRaw`
            INSERT INTO search.patient_names (patient_id, tenant_id, name_search)
            SELECT gen_random_uuid(), ${fakeTenant}::uuid,
                   (ARRAY['siti','budi','rina','agus','dewi','eko','sri','joko','wati','yanto'])[1 + (g % 10)]
                     || ' ' || substr(md5(g::text), 1, 6) || ' ' || substr(md5((g * 7)::text), 1, 5)
            FROM generate_series(1, 30000) g`;
          await tx.$executeRaw`
            INSERT INTO search.patient_names (patient_id, tenant_id, name_search)
            VALUES (gen_random_uuid(), ${fakeTenant}::uuid, 'siti nurhaliza')`;
          await tx.$executeRaw`ANALYZE search.patient_names`;
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${fakeTenant}, true)`;

          // Kueri yang dijalankan fungsi, dengan pengaturan fungsi (proconfig), direncanakan dengan nilai sebenarnya.
          const [fn] = await tx.$queryRaw<Array<{ src: string; config: string[] }>>`
            SELECT prosrc AS src, proconfig AS config FROM pg_proc WHERE proname = 'app_search_patient_names'`;
          const sql = /EXECUTE\s+'([\s\S]+?)'\s+USING/.exec(fn?.src ?? '')?.[1]?.replace(/''/g, "'");
          expect(sql).toBeTruthy();
          for (const setting of fn?.config ?? []) {
            const [name, ...rest] = setting.split('=');
            await tx.$executeRaw`SELECT set_config(${name}, ${rest.join('=')}, true)`;
          }
          const q = 'siti nurhalisa';
          const [explained] = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>>(
            `EXPLAIN (FORMAT JSON) ${sql}`,
            fakeTenant,
            q,
            `%${q}%`,
          );
          const plan = explained?.['QUERY PLAN'][0]?.Plan as PlanNode;
          checks.trgmConds = nodes(plan)
            .filter((n) => n['Index Name'] === 'patient_names_trgm')
            .map((n) => n['Index Cond'] ?? '');

          // Fungsi itu sendiri (search_path transaksi kini dipatok seperti fungsi, jadi nama ditulis lengkap):
          // hasil benar dan indeks benar-benar dipindai di transaksi ini.
          const found = await tx.$queryRaw<Array<{ score: number }>>`
            SELECT score FROM public.app_search_patient_names(${q})`;
          checks.found = found.length;
          const [stat] = await tx.$queryRaw<Array<{ scans: bigint }>>`
            SELECT pg_stat_get_xact_numscans('search.patient_names_trgm'::regclass) AS scans`;
          checks.scans = Number(stat?.scans ?? 0);
          throw new Rollback();
        },
        { timeout: 60_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });

    const conds = checks.trgmConds as string[];
    expect(conds.some((c) => c.includes('OPERATOR(public.%)'))).toBe(true);
    expect(conds.some((c) => c.includes('~~'))).toBe(true);
    expect(conds.every((c) => c.includes('tenant_id'))).toBe(true);
    expect(checks.found).toBe(1);
    // BitmapOr: satu pindaian indeks per kriteria (%, <%, LIKE).
    expect(checks.scans).toBeGreaterThanOrEqual(3);
    const [left] = await owner.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM search.patient_names WHERE tenant_id = ${fakeTenant}::uuid`;
    expect(Number(left?.n)).toBe(0);
  });

  it('pembanding: kueri lama di bawah RLS tidak bisa memakai operator trigram sebagai Index Cond', async () => {
    const T = await freshTenant();
    await addPatients(T, ['Siti Nurhaliza']);
    const plan = await withTenant(app, T, async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      const q = 'siti nurhalisa';
      const [row] = await tx.$queryRaw<Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>>`
        EXPLAIN (FORMAT JSON) SELECT p.id FROM patients p
        WHERE (p.name_search % ${q} OR ${q} <% p.name_search OR p.name_search LIKE ${`%${q}%`})`;
      return row?.['QUERY PLAN'][0]?.Plan as PlanNode;
    });
    const conds = nodes(plan).map((n) => n['Index Cond'] ?? '');
    expect(conds.join(' ')).not.toMatch(/name_search/);
  });
});
