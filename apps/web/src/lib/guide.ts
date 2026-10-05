import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Panduan superadmin: konten Markdown di `docs/panduan/` (sumber yang sama dengan README pengembang).
 * Berkas hanya dipilih dari daftar tetap di bawah; slug dari URL tidak pernah dipakai sebagai path.
 */
export interface GuidePage {
  slug: string;
  file: string;
  title: string;
  summary: string;
}

export const GUIDE_PAGES = [
  {
    slug: 'cara-kerja-sistem',
    file: '01-cara-kerja-sistem.md',
    title: 'Cara sistem bekerja',
    summary: 'Gambaran besar: lapisan, multi-tenant, alur data, integrasi lewat outbox, keamanan berlapis.',
  },
  {
    slug: 'cara-kerja-kode',
    file: '02-cara-kerja-kode.md',
    title: 'Cara kode bekerja',
    summary: 'Struktur repo, siklus hidup permintaan API, database dan RLS, worker, mock, web, dan pola tes.',
  },
  {
    slug: 'tutorial',
    file: '03-tutorial.md',
    title: 'Tutorial',
    summary: 'Menyiapkan mesin, menjalankan layanan, membuat modul API, layar web, endpoint mock, dan tes.',
  },
  {
    slug: 'backup-restore',
    file: '04-backup-restore.md',
    title: 'Backup dan restore',
    summary:
      'Backup terenkripsi tiga lokasi, jadwal, retensi, uji restore di kontainer bersih, dan pemulihan bencana.',
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
