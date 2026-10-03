import { describe, expect, it } from 'vitest';
import {
  extractToc,
  findGuidePage,
  GUIDE_PAGES,
  headingPlainText,
  loadGuideMarkdown,
  rewriteGuideHref,
  slugify,
} from './guide';

describe('daftar halaman panduan', () => {
  it('setiap halaman punya berkas yang ada, diawali H1, dan id daftar isi unik', () => {
    for (const page of GUIDE_PAGES) {
      const md = loadGuideMarkdown(page);
      expect(md.startsWith('# '), page.file).toBe(true);
      const ids = extractToc(md).map((t) => t.id);
      expect(ids.length, page.file).toBeGreaterThan(3);
      expect(new Set(ids).size, `${page.file}: id heading ganda`).toBe(ids.length);
    }
  });

  it('slug dari URL hanya dicocokkan dengan daftar tetap (tanpa path traversal)', () => {
    expect(findGuidePage('tutorial')?.file).toBe('03-tutorial.md');
    for (const evil of ['../../.env', '..%2F..%2F.env', '03-tutorial.md', 'TUTORIAL', '', 'constructor']) {
      expect(findGuidePage(evil)).toBeNull();
    }
  });

  it('semua tautan antar-panduan menunjuk halaman dan heading yang ada', () => {
    const anchors = new Map<string, Set<string>>(
      GUIDE_PAGES.map((p) => [p.slug, new Set(extractToc(loadGuideMarkdown(p)).map((t) => t.id))]),
    );
    for (const page of GUIDE_PAGES) {
      for (const [, href] of loadGuideMarkdown(page).matchAll(/\]\((\.\/[^)]+)\)/g)) {
        const target = rewriteGuideHref(href ?? '');
        const m = /^\/superadmin\/panduan\/([\w-]+)(?:#([\w-]+))?$/.exec(target);
        expect(m, `${page.file}: tautan ${href} tidak dikenali`).not.toBeNull();
        const ids = anchors.get(m?.[1] ?? '');
        expect(ids, `${page.file}: halaman ${m?.[1]} tidak ada`).toBeDefined();
        if (m?.[2]) expect(ids?.has(m[2]), `${page.file}: anchor #${m[2]} tidak ada`).toBe(true);
      }
    }
  });
});

describe('slugify dan heading', () => {
  it('membuat id stabil tanpa diakritik dan simbol', () => {
    expect(slugify('4. Membuat modul API baru')).toBe('4-membuat-modul-api-baru');
    expect(slugify('Lingkungan dan APP_ENV')).toBe('lingkungan-dan-app-env');
    expect(slugify('Crème brûlée & kopi')).toBe('creme-brulee-kopi');
  });

  it('teks heading polos tanpa markup Markdown', () => {
    expect(headingPlainText('Paket `shared` dan **db**')).toBe('Paket shared dan db');
    expect(headingPlainText('[Tautan](https://contoh.id) _miring_')).toBe('Tautan miring');
  });

  it('daftar isi mengabaikan heading di dalam blok kode', () => {
    const toc = extractToc('# Judul\n\n## A\n\n```md\n## Bukan heading\n```\n\n### B\n');
    expect(toc).toEqual([
      { depth: 2, text: 'A', id: 'a' },
      { depth: 3, text: 'B', id: 'b' },
    ]);
  });
});

describe('rewriteGuideHref', () => {
  it('mengubah tautan berkas panduan ke rute aplikasi, sisanya apa adanya', () => {
    expect(rewriteGuideHref('./02-cara-kerja-kode.md#database')).toBe(
      '/superadmin/panduan/cara-kerja-kode#database',
    );
    expect(rewriteGuideHref('./03-tutorial.md')).toBe('/superadmin/panduan/tutorial');
    expect(rewriteGuideHref('./tidak-ada.md')).toBe('./tidak-ada.md');
    expect(rewriteGuideHref('https://contoh.id')).toBe('https://contoh.id');
  });
});
