import { createHash } from 'node:crypto';
import type { PrismaClient } from './generated/prisma/client';

/**
 * P02 · Daftar kata sandi bocor offline (docs/05 §1; ADR-0011, pembaruan 5 Okt 2026). Disimpan sebagai SHA-1
 * (format Have I Been Pwned) di `ref.breached_passwords`, global dan read-only bagi aplikasi. Pemeriksaan bergaya
 * k-anonymity: kueri hanya membawa rentang awalan 20 bit (5 heks, seperti API rentang HIBP), pencocokan hash utuh
 * dilakukan di aplikasi, sehingga log/kueri database tidak pernah memuat hash utuh kata sandi yang sedang dipilih.
 * Isi tabel = daftar N teratas yang diimpor operator lewat `pnpm db:import-breached` (role migrator).
 */
type SqlClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

/** Bawaan jumlah entri teratas yang diimpor (≈100 ribu: ±2 MB di database, pencarian lewat indeks PK). */
export const BREACHED_TOP_DEFAULT = 100_000;
export const BREACHED_TOP_MAX = 2_000_000;
/** Panjang baris maksimum daftar teks (kata sandi lebih panjang dari ini tidak bermakna untuk kebijakan). */
const MAX_LINE = 1000;
const MAX_ERRORS = 20;
const CHUNK = 5000;
const HIBP_LINE = /^([0-9A-Fa-f]{40}):(\d{1,15})$/;
const PREFIX_HEX = 5;

/** SHA-1 kata sandi (UTF-8) dalam heks besar, sama dengan format daftar HIBP. */
export function passwordSha1(password: string): string {
  return createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
}

/**
 * Rentang hash yang berawalan sama 20 bit dengan `sha1Hex` (batas bawah inklusif, atas eksklusif; null = tanpa batas
 * atas untuk awalan FFFFF). Hanya rentang ini yang dikirim ke database.
 */
export function sha1PrefixRange(sha1Hex: string): { from: string; to: string | null } {
  const prefix = sha1Hex.slice(0, PREFIX_HEX).toUpperCase();
  const pad = '0'.repeat(40 - PREFIX_HEX);
  const next = Number.parseInt(prefix, 16) + 1;
  return {
    from: prefix + pad,
    to: next > 0xfffff ? null : next.toString(16).toUpperCase().padStart(PREFIX_HEX, '0') + pad,
  };
}

/** True bila kata sandi ada di daftar bocor yang diimpor (tabel kosong → selalu false). */
export async function isBreachedPassword(db: SqlClient, password: string): Promise<boolean> {
  const hex = passwordSha1(password);
  const { from, to } = sha1PrefixRange(hex);
  const rows =
    to === null
      ? await db.$queryRaw<Array<{ hex: string }>>`
          SELECT encode(sha1, 'hex') AS hex FROM ref.breached_passwords WHERE sha1 >= decode(${from}, 'hex')`
      : await db.$queryRaw<Array<{ hex: string }>>`
          SELECT encode(sha1, 'hex') AS hex FROM ref.breached_passwords
          WHERE sha1 >= decode(${from}, 'hex') AND sha1 < decode(${to}, 'hex')`;
  return rows.some((r) => r.hex.toUpperCase() === hex);
}

export interface BreachedListStatus {
  entries: number;
  source: string | null;
  version: string | null;
  importedAt: Date | null;
}

/** Isi daftar saat ini (untuk operator/kesiapan): jumlah entri + impor terakhir. */
export async function breachedListStatus(db: SqlClient): Promise<BreachedListStatus> {
  const [row] = await db.$queryRaw<
    Array<{ entries: bigint; source: string | null; version: string | null; importedAt: Date | null }>
  >`
    SELECT (SELECT count(*) FROM ref.breached_passwords) AS entries, i.source, i.version, i.imported_at AS "importedAt"
    FROM (SELECT 1) AS one
    LEFT JOIN LATERAL (SELECT * FROM ref.breached_password_imports ORDER BY id DESC LIMIT 1) AS i ON true`;
  return {
    entries: Number(row?.entries ?? 0),
    source: row?.source ?? null,
    version: row?.version ?? null,
    importedAt: row?.importedAt ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Impor (role migrator). Gagal tertutup: satu baris tidak valid → tidak ada yang ditulis.
// ---------------------------------------------------------------------------------------------------------

export interface BreachedEntry {
  /** SHA-1 40 heks besar. */
  sha1: string;
  occurrences: number | null;
}

export interface BreachedCollectResult {
  /** `hibp` = baris `SHA1:hitungan` (diambil N hitungan terbesar); `text` = satu kata sandi per baris, urut paling umum. */
  format: 'hibp' | 'text' | 'empty';
  entries: BreachedEntry[];
  lines: number;
  errors: Array<{ line: number; message: string }>;
}

/** Min-heap kecil berdasarkan hitungan, untuk memilih N hitungan terbesar dari berkas HIBP yang sangat besar. */
class TopByCount {
  private readonly heap: BreachedEntry[] = [];
  constructor(private readonly limit: number) {}

  private less(i: number, j: number) {
    return (this.heap[i]?.occurrences ?? 0) < (this.heap[j]?.occurrences ?? 0);
  }

  private swap(i: number, j: number) {
    const t = this.heap[i] as BreachedEntry;
    this.heap[i] = this.heap[j] as BreachedEntry;
    this.heap[j] = t;
  }

  add(e: BreachedEntry) {
    if (this.heap.length < this.limit) {
      this.heap.push(e);
      for (let i = this.heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (!this.less(i, p)) break;
        this.swap(i, p);
        i = p;
      }
      return;
    }
    if ((e.occurrences ?? 0) <= (this.heap[0]?.occurrences ?? 0)) return;
    this.heap[0] = e;
    for (let i = 0; ;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.heap.length && this.less(l, m)) m = l;
      if (r < this.heap.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }

  sorted(): BreachedEntry[] {
    return [...this.heap].sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0));
  }
}

/**
 * Baca daftar sumber baris demi baris (berkas HIBP bisa puluhan GB) dan ambil `top` entri: format dikenali dari
 * baris pertama yang tidak kosong. HIBP: semua baris wajib `SHA1:hitungan`; teks: tiap baris satu kata sandi apa
 * adanya (tanpa `\r`), urutan berkas dianggap urutan popularitas, duplikat dilewati.
 */
export async function collectBreachedPasswords(
  lines: AsyncIterable<string> | Iterable<string>,
  opts: { top: number },
): Promise<BreachedCollectResult> {
  const top = Math.max(1, Math.min(opts.top, BREACHED_TOP_MAX));
  const errors: BreachedCollectResult['errors'] = [];
  const fail = (line: number, message: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ line, message });
  };
  let format: BreachedCollectResult['format'] = 'empty';
  let n = 0;
  const heap = new TopByCount(top);
  const textEntries: BreachedEntry[] = [];
  const seen = new Set<string>();
  for await (const raw of lines) {
    n++;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') continue;
    if (format === 'empty') format = HIBP_LINE.test(line) ? 'hibp' : 'text';
    if (format === 'hibp') {
      const m = HIBP_LINE.exec(line);
      if (!m) {
        fail(n, 'bukan baris SHA1:hitungan');
        continue;
      }
      const occurrences = Number(m[2]);
      if (occurrences < 1) {
        fail(n, 'hitungan harus ≥ 1');
        continue;
      }
      heap.add({ sha1: (m[1] as string).toUpperCase(), occurrences });
      continue;
    }
    if (line.length > MAX_LINE) {
      fail(n, `baris lebih dari ${MAX_LINE} karakter`);
      continue;
    }
    if (textEntries.length >= top) continue;
    const sha1 = passwordSha1(line);
    if (seen.has(sha1)) continue;
    seen.add(sha1);
    textEntries.push({ sha1, occurrences: null });
  }
  let entries = format === 'hibp' ? heap.sorted() : textEntries;
  if (format === 'hibp') {
    // Hash ganda di berkas HIBP (seharusnya tidak ada): simpan satu, hitungan terbesar (sudah urut menurun).
    const unique = new Set<string>();
    entries = entries.filter((e) => !unique.has(e.sha1) && unique.add(e.sha1));
  }
  return { format, entries, lines: n, errors };
}

/**
 * Ganti seluruh isi daftar dengan `entries` + catat impornya. Panggil di dalam transaksi (role migrator) agar
 * pembaca tetap melihat daftar lama sampai commit (DELETE, bukan TRUNCATE yang mengunci pembaca).
 */
export async function replaceBreachedPasswords(
  tx: SqlClient,
  entries: BreachedEntry[],
  meta: { source: string; version: string },
): Promise<number> {
  await tx.$executeRaw`DELETE FROM ref.breached_passwords`;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const hashes = chunk.map((e) => e.sha1);
    const counts = chunk.map((e) => (e.occurrences === null ? null : String(e.occurrences)));
    await tx.$executeRaw`
      INSERT INTO ref.breached_passwords (sha1, occurrences)
      SELECT decode(h, 'hex'), c::bigint FROM unnest(${hashes}::text[], ${counts}::text[]) AS t(h, c)
      ON CONFLICT (sha1) DO NOTHING`;
  }
  await tx.$executeRaw`
    INSERT INTO ref.breached_password_imports (source, version, entry_count)
    VALUES (${meta.source}, ${meta.version}, ${entries.length})`;
  return entries.length;
}
