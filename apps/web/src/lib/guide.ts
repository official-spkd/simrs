import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Panduan superadmin: konten Markdown di `docs/panduan/` (sumber yang sama dengan README pengembang).
 * Berkas hanya dipilih dari daftar tetap di bawah; slug dari URL tidak pernah dipakai sebagai path.
 */
export interface GuidePage {
  slug: string;
  file: string;
  title: string;
  summary: string;
  /** `sistem` = cara kerja dan operasional untuk pengembang/operator; `fitur` = penjelasan layar per kelompok. */
  group: 'sistem' | 'fitur';
}

export const GUIDE_PAGES = [
  {
    slug: 'cara-kerja-sistem',
    file: '01-cara-kerja-sistem.md',
    title: 'Cara sistem bekerja',
    summary: 'Gambaran besar: lapisan, multi-tenant, alur data, integrasi lewat outbox, keamanan berlapis.',
    group: 'sistem',
  },
  {
    slug: 'cara-kerja-kode',
    file: '02-cara-kerja-kode.md',
    title: 'Cara kode bekerja',
    summary: 'Struktur repo, siklus hidup permintaan API, database dan RLS, worker, mock, web, dan pola tes.',
    group: 'sistem',
  },
  {
    slug: 'tutorial',
    file: '03-tutorial.md',
    title: 'Tutorial',
    summary: 'Menyiapkan mesin, menjalankan layanan, membuat modul API, layar web, endpoint mock, dan tes.',
    group: 'sistem',
  },
  {
    slug: 'backup-restore',
    file: '04-backup-restore.md',
    title: 'Backup dan restore',
    summary:
      'Backup terenkripsi tiga lokasi, jadwal, retensi, uji restore di kontainer bersih, dan pemulihan bencana.',
    group: 'sistem',
  },
  {
    slug: 'rotasi-kunci',
    file: '05-rotasi-kunci.md',
    title: 'Rotasi kunci enkripsi kolom',
    summary: 'Runbook operator: cincin kunci v2, job enkripsi ulang bertahap, verifikasi, PIN, dan rollback.',
    group: 'sistem',
  },
  {
    slug: 'fitur-platform',
    file: '10-fitur-platform.md',
    title: 'Fitur platform',
    summary: 'Masuk + MFA, pengguna dan akses, audit, MPI, formulir klinis, notifikasi, PIN, verifikasi QR.',
    group: 'fitur',
  },
  {
    slug: 'fitur-front-office',
    file: '11-fitur-front-office.md',
    title: 'Fitur front office',
    summary: 'Pendaftaran + SEP, jadwal dokter, anjungan mandiri, display dan kendali antrean.',
    group: 'fitur',
  },
  {
    slug: 'fitur-klinis',
    file: '12-fitur-klinis.md',
    title: 'Fitur klinis (RME)',
    summary:
      'Pemeriksaan poli, CPOE + CDS, IGD, tempat tidur, rawat inap + eMAR, resume, persetujuan tindakan.',
    group: 'fitur',
  },
  {
    slug: 'fitur-penunjang',
    file: '13-fitur-penunjang.md',
    title: 'Fitur penunjang',
    summary: 'Laboratorium + nilai kritis, radiologi, farmasi, kamar operasi.',
    group: 'fitur',
  },
  {
    slug: 'fitur-keuangan',
    file: '14-fitur-keuangan.md',
    title: 'Fitur keuangan',
    summary: 'Kasir, klaim dan koding, akuntansi, pembayaran digital TPDI × BTN, pembiayaan BTN.',
    group: 'fitur',
  },
  {
    slug: 'fitur-integrasi',
    file: '15-fitur-integrasi.md',
    title: 'Fitur integrasi',
    summary: 'Integration hub, outbox + retry + DLQ, webhook masuk, mock sistem luar.',
    group: 'fitur',
  },
  {
    slug: 'fitur-back-office',
    file: '16-fitur-back-office.md',
    title: 'Fitur back office',
    summary: 'Logistik dan mutu + keselamatan pasien.',
    group: 'fitur',
  },
  {
    slug: 'fitur-kanal-dasbor',
    file: '17-fitur-kanal-dasbor.md',
    title: 'Fitur kanal dan dasbor',
    summary: 'Dasbor eksekutif, pratinjau aplikasi pasien dan aplikasi dokter.',
    group: 'fitur',
  },
  {
    slug: 'simulasi-dan-operasional',
    file: '18-simulasi-dan-operasional.md',
    title: 'Simulasi dan operasional',
    summary:
      'Mode presentasi, simulasi pasien, akun presentasi, menjalankan demo, dan tangkap layar dokumentasi.',
    group: 'fitur',
  },
  {
    slug: 'peta-kode',
    file: '19-peta-kode.md',
    title: 'Peta kode',
    summary:
      'Web mode demo vs api, registri 80 layar, pola menambah layar, peta modul API, dan utang mode front end dulu.',
    group: 'sistem',
  },
  {
    slug: 'peta-alur-semua-fase',
    file: '20-peta-alur-semua-fase.md',
    title: 'Peta alur semua fase',
    summary: 'Fase 0–10 → layar → rute → sumber data (demo, hibrida, api), dengan tautan ke panduan fitur.',
    group: 'fitur',
  },
] as const satisfies readonly GuidePage[];

export type GuideSlug = (typeof GUIDE_PAGES)[number]['slug'];

export function findGuidePage(slug: string): GuidePage | null {
  return GUIDE_PAGES.find((p) => p.slug === slug) ?? null;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Root repo (pnpm-workspace.yaml) tidak ditemukan');
    dir = parent;
  }
}

const cache = new Map<string, string>();

/** Baca isi Markdown satu halaman. Di dev selalu dibaca ulang agar suntingan langsung terlihat. */
export function loadGuideMarkdown(page: GuidePage, cwd: string = process.cwd()): string {
  const cacheable = process.env.NODE_ENV === 'production';
  const hit = cacheable ? cache.get(page.slug) : undefined;
  if (hit !== undefined) return hit;
  const content = readFileSync(join(findRepoRoot(cwd), 'docs', 'panduan', page.file), 'utf8');
  if (cacheable) cache.set(page.slug, content);
  return content;
}

/**
 * Gambar panduan: hanya berkas langsung di `docs/panduan/gambar/` bernama huruf kecil/angka/'-' dengan ekstensi
 * `.png` atau `.svg`. Nama lain (titik ganda, garis miring, backslash, `%`, huruf besar) ditolak sebelum menyentuh
 * sistem berkas, jadi tidak ada path traversal. SVG disajikan sebagai `<img>` (skrip di dalamnya tidak pernah jalan).
 */
export const GUIDE_IMAGE_TYPES = { png: 'image/png', svg: 'image/svg+xml' } as const;
export type GuideImageType = (typeof GUIDE_IMAGE_TYPES)[keyof typeof GUIDE_IMAGE_TYPES];
const GUIDE_IMAGE_NAME = /^[a-z0-9][a-z0-9-]{0,99}\.(png|svg)$/;
/** Rute aplikasi yang menyajikan gambar panduan (hanya untuk superadmin, sama dengan halamannya). */
export const GUIDE_IMAGE_ROUTE = '/superadmin/panduan/gambar';

/** Jenis konten untuk nama berkas gambar yang sah, atau null. */
export function guideImageType(name: string): GuideImageType | null {
  const m = GUIDE_IMAGE_NAME.exec(name);
  return m ? GUIDE_IMAGE_TYPES[m[1] as keyof typeof GUIDE_IMAGE_TYPES] : null;
}

/**
 * `src` gambar di Markdown (`./gambar/x.png` atau `gambar/x.png`, sama seperti dibaca di GitHub) → URL rute
 * aplikasi. Selain gambar lokal yang sah (URL luar, data URI, path lain) → null: gambar tidak dirender.
 */
export function rewriteGuideImageSrc(src: string): string | null {
  const m = /^(?:\.\/)?gambar\/([^/]+)$/.exec(src);
  if (!m?.[1] || !guideImageType(m[1])) return null;
  return `${GUIDE_IMAGE_ROUTE}/${m[1]}`;
}

/** Isi berkas gambar panduan, atau null bila nama tidak sah / berkas tidak ada / bukan berkas biasa (symlink). */
export function loadGuideImage(
  name: string,
  cwd: string = process.cwd(),
): { body: Buffer; contentType: GuideImageType } | null {
  const contentType = guideImageType(name);
  if (!contentType) return null;
  const dir = resolve(findRepoRoot(cwd), 'docs', 'panduan', 'gambar');
  const file = resolve(dir, name);
  if (dirname(file) !== dir) return null;
  try {
    if (!lstatSync(file).isFile()) return null;
    return { body: readFileSync(file), contentType };
  } catch {
    return null;
  }
}

/** Path berkas sumber relatif root repo, ditampilkan agar pengembang tahu di mana menyunting. */
export function guideSourcePath(page: GuidePage): string {
  return `docs/panduan/${page.file}`;
}

/** Id anchor heading: huruf kecil, tanpa diakritik, non-alfanumerik → '-'. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Teks polos dari heading Markdown (tanpa `kode`, **tebal**, _miring_, [tautan](url)). */
export function headingPlainText(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();
}

export interface TocItem {
  depth: 2 | 3;
  text: string;
  id: string;
}

/** Daftar isi dari heading level 2–3, mengabaikan blok kode berpagar. */
export function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = headingPlainText(m[2] ?? '');
    items.push({ depth: (m[1]?.length ?? 2) as 2 | 3, text, id: slugify(text) });
  }
  return items;
}

/**
 * Tautan antar-berkas panduan (`./02-cara-kerja-kode.md#bagian`) diubah ke rute aplikasi.
 * Tautan lain dikembalikan apa adanya (react-markdown sudah menyaring skema berbahaya seperti `javascript:`).
 */
export function rewriteGuideHref(href: string): string {
  const m = /^\.\/([\w-]+\.md)(#[\w-]*)?$/.exec(href);
  if (!m) return href;
  const page = GUIDE_PAGES.find((p) => p.file === m[1]);
  return page ? `/superadmin/panduan/${page.slug}${m[2] ?? ''}` : href;
}
