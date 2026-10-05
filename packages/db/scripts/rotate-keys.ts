/**
 * P05 · Rotasi kunci enkripsi kolom (ADR-0015, pembaruan 5 Okt 2026; panduan operator: docs/panduan/05-rotasi-kunci.md).
 *
 *   pnpm db:rotate-keys                          # = --dry-run: rencana + pemeriksaan kunci, tanpa menulis
 *   pnpm db:rotate-keys --dry-run --tenant RSFA
 *   pnpm db:rotate-keys --run                    # enkripsi ulang semua tenant ke kunci aktif (bisa dilanjutkan)
 *   pnpm db:rotate-keys --run --batch 200 --pause-ms 100
 *   pnpm db:rotate-keys --run --revoke-old-pins  # + cabut PIN yang ladanya memakai kunci hash lama
 *
 * Kunci dari env yang sama dengan API/worker (`FIELD_ENCRYPTION_KEYS`/`FIELD_HASH_KEYS`, atau format lama
 * `FIELD_*_KEY` = v1). Koneksi `DATABASE_URL` (role aplikasi, tunduk RLS) per tenant lewat `withTenant`. Ctrl+C
 * berhenti dengan rapi di antara batch; jalankan lagi untuk melanjutkan dari kursor. Tidak pernah mencetak nilai.
 */
import { parseArgs } from 'node:util';
import { isUuid } from '@simrs/shared';
import { type FieldKeys, loadFieldKeys } from '@simrs/shared/node';
import { createPrismaClient, resolveTenantByCode, withTenant } from '../src/client';
import {
  KeyRotationBlockedError,
  listKeyRotationTenantIds,
  planTenantKeyRotation,
  revokePinsOnRetiredKeys,
  rotateTenantKeys,
  type TenantKeyPlan,
} from '../src/key-rotation';

const USAGE =
  'Contoh: pnpm db:rotate-keys [--dry-run | --run] [--tenant RSFA|<uuid>] [--batch 200] [--pause-ms 100] [--revoke-old-pins]';

/** Keluaran laporan (stdout); galat lewat console.error. */
const out = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

function fail(message: string): never {
  console.error(`Gagal: ${message}`);
  process.exit(1);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        'dry-run': { type: 'boolean', default: false },
        run: { type: 'boolean', default: false },
        tenant: { type: 'string' },
        batch: { type: 'string' },
        'pause-ms': { type: 'string' },
        'revoke-old-pins': { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  }
})();
if (values.run && values['dry-run']) fail(`pilih salah satu: --dry-run atau --run\n${USAGE}`);
if (values['revoke-old-pins'] && !values.run) fail('--revoke-old-pins hanya bersama --run');
const run = values.run ?? false;
const intArg = (name: string, raw: string | undefined, min: number, max: number) => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) fail(`--${name} harus bilangan bulat ${min}–${max}`);
  return n;
};
const batchSize =
  intArg('batch', values.batch, 1, 2000) ?? Number(process.env.FIELD_KEY_ROTATION_BATCH ?? 200);
const pauseMs =
  intArg('pause-ms', values['pause-ms'], 0, 60_000) ?? Number(process.env.FIELD_KEY_ROTATION_PAUSE_MS ?? 100);

const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL belum disetel (lihat .env.example)');
let keys: FieldKeys;
try {
  keys = loadFieldKeys(process.env);
} catch (err) {
  fail(err instanceof Error ? err.message : 'kunci kolom tidak valid');
}

function printPlan(code: string, p: TenantKeyPlan): void {
  out(`${code} · kunci aktif enkripsi ${p.encKeyId}, hash ${p.hashKeyId}`);
  for (const t of p.targets) {
    const cols = t.columns
      .map((c) => {
        const counts = Object.entries(c.counts)
          .map(([k, n]) => `${k}=${n}`)
          .join(' ');
        return `${c.column}[${counts || 'kosong'}]`;
      })
      .join(' · ');
    out(`  ${t.target.padEnd(20)} perlu ditulis ulang ${String(t.pending).padStart(7)}   ${cols}`);
  }
  const pins = Object.entries(p.pins)
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  out(`  PIN aktif per kunci lada: ${pins || '-'}`);
  for (const pr of p.problems) {
    out(
      `  ! ${pr.target}${pr.column ? `.${pr.column}` : ''}: ${pr.code}${pr.rows ? ` (${pr.rows} baris)` : ''}`,
    );
  }
  out(`  kunci lama boleh dipensiunkan: ${p.retireReady ? 'ya' : 'belum'}`);
}

const prisma = createPrismaClient({ connectionString: url, max: 2 });
const abort = new AbortController();
process.on('SIGINT', () => {
  console.warn('\nBerhenti setelah batch ini selesai… (jalankan lagi untuk melanjutkan)');
  abort.abort();
});

let exitCode = 0;
try {
  let tenants: Array<{ id: string; code: string }>;
  if (values.tenant) {
    const raw = values.tenant.trim();
    const id = isUuid(raw) ? raw : await resolveTenantByCode(prisma, raw.toUpperCase());
    if (!id) fail(`tenant ${raw} tidak ditemukan (tenant nonaktif: pakai UUID-nya)`);
    tenants = [{ id, code: isUuid(raw) ? raw : raw.toUpperCase() }];
  } else {
    tenants = [];
    for (const id of await listKeyRotationTenantIds(prisma)) {
      const t = await withTenant(prisma, id, (tx) =>
        tx.tenant.findUnique({ where: { id }, select: { code: true } }),
      );
      tenants.push({ id, code: t?.code ?? id });
    }
  }
  out(
    `Cincin kunci: enkripsi ${keys.enc.ids.join(', ')} (aktif ${keys.enc.currentId}) · hash ${keys.hash.ids.join(', ')} (aktif ${keys.hash.currentId})`,
  );
  out(run ? `Mode: jalankan (batch ${batchSize}, jeda ${pauseMs} ms)\n` : 'Mode: dry-run (tidak menulis)\n');

  let allReady = true;
  for (const t of tenants) {
    if (abort.signal.aborted) break;
    if (run) {
      try {
        const r = await rotateTenantKeys(prisma, t.id, keys, {
          batchSize,
          pauseMs,
          signal: abort.signal,
          onBatch: (b) => {
            if (b.scanned > 0) {
              out(
                `  ${t.code} ${b.target}: +${b.rewritten} ditulis ulang, ${b.failed} gagal${b.done ? ' (selesai)' : ''}`,
              );
            }
          },
        });
        if (r.interrupted) {
          out(`${t.code}: dihentikan; jalankan lagi untuk melanjutkan.`);
          exitCode = 130;
          break;
        }
        if (values['revoke-old-pins']) {
          const n = await revokePinsOnRetiredKeys(prisma, t.id, keys);
          out(`  ${t.code}: ${n} PIN berkunci lada lama dicabut (key_rotated)`);
        }
      } catch (err) {
        if (!(err instanceof KeyRotationBlockedError)) throw err;
        console.error(`  ${err.message}`);
        exitCode = 1;
      }
    }
    // Setelah --run juga: verifikasi ulang dari data (bukan dari status) sebelum kunci lama dipensiunkan.
    const plan = await planTenantKeyRotation(prisma, t.id, keys);
    printPlan(t.code, plan);
    if (plan.problems.length > 0) exitCode = exitCode || 1;
    allReady &&= plan.retireReady;
    const status = await withTenant(prisma, t.id, (tx) =>
      tx.fieldKeyRotation.findMany({ orderBy: { target: 'asc' } }),
    );
    for (const s of status) {
      out(
        `  putaran ${s.target}: ${s.encKeyId}/${s.hashKeyId} mulai ${s.startedAt.toISOString()}${
          s.finishedAt ? ` selesai ${s.finishedAt.toISOString()}` : ' (belum selesai)'
        } · dipindai ${s.scanned}, ditulis ulang ${s.rewritten}, gagal ${s.failed}${
          s.remaining === null ? '' : `, sisa ${s.remaining}`
        }${s.lastError ? ` · galat terakhir ${s.lastError}` : ''}`,
      );
    }
    out('');
  }
  out(
    allReady
      ? 'Semua tenant siap: kunci lama boleh dihapus dari cincin (lihat panduan: simpan cadangannya dulu).'
      : 'Belum semua siap: jangan hapus kunci lama dari cincin.',
  );
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
