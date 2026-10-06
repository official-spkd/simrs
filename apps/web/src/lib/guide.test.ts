import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractToc,
  findGuidePage,
  GUIDE_PAGES,
  guideImageType,
  headingPlainText,
  loadGuideImage,
  loadGuideMarkdown,
  rewriteGuideHref,
  rewriteGuideImageSrc,
  slugify,
} from './guide';

/** Folder gambar panduan di repo (tes berjalan dari apps/web). */
const IMAGE_DIR = resolve(process.cwd(), '..', '..', 'docs', 'panduan', 'gambar');

/** Markdown tanpa blok kode berpagar dan kode sebaris (contoh sintaks di sana bukan gambar/tautan sungguhan). */
const withoutCode = (md: string) => md.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');

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
      // Tautan saja; gambar `![alt](./gambar/…)` diperiksa tes gambar di bawah.
      for (const [, href] of withoutCode(loadGuideMarkdown(page)).matchAll(
        /(?<!!\[[^\]]*)\]\((\.\/[^)]+)\)/g,
      )) {
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

describe('gambar panduan', () => {
  it('hanya nama sederhana .png/.svg yang diterima (tanpa path traversal)', () => {
    expect(guideImageType('poli.png')).toBe('image/png');
    expect(guideImageType('order--cds-blokir.png')).toBe('image/png');
    expect(guideImageType('diagram-outbox.svg')).toBe('image/svg+xml');
    for (const evil of [
      '../.env',
      '..%2F.env',
      'gambar/poli.png',
      'poli.PNG',
      'Poli.png',
      'poli.png.svg.html',
      'poli.html',
      '.poli.png',
      'poli',
      'a\\b.png',
      'poli.png%00',
      '',
    ]) {
      expect(guideImageType(evil), evil).toBeNull();
    }
  });

  it('src Markdown hanya gambar lokal di gambar/ → rute superadmin', () => {
    expect(rewriteGuideImageSrc('./gambar/poli.png')).toBe('/superadmin/panduan/gambar/poli.png');
    expect(rewriteGuideImageSrc('gambar/diagram-outbox.svg')).toBe(
      '/superadmin/panduan/gambar/diagram-outbox.svg',
    );
    for (const evil of [
      'https://contoh.id/x.png',
      '//contoh.id/x.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      './gambar/../../../.env',
      './gambar/sub/x.png',
      '/etc/passwd',
      './poli.png',
    ]) {
      expect(rewriteGuideImageSrc(evil), evil).toBeNull();
    }
  });

  it('loadGuideImage membaca berkas yang ada dan menolak nama tidak sah atau berkas tidak ada', () => {
    const svg = loadGuideImage('diagram-arsitektur.svg');
    expect(svg?.contentType).toBe('image/svg+xml');
    expect(svg?.body.toString('utf8').startsWith('<svg')).toBe(true);
    expect(loadGuideImage('tidak-ada.png')).toBeNull();
    expect(loadGuideImage('../02-cara-kerja-kode.md')).toBeNull();
    expect(loadGuideImage('..')).toBeNull();
  });

  it('setiap gambar yang dirujuk panduan ada, ber-alt, dan berbentuk ./gambar/<nama>', () => {
    for (const page of GUIDE_PAGES) {
      for (const [, alt, src] of withoutCode(loadGuideMarkdown(page)).matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
        expect(alt?.trim().length, `${page.file}: alt kosong untuk ${src}`).toBeGreaterThan(10);
        const url = rewriteGuideImageSrc(src ?? '');
        expect(url, `${page.file}: gambar ${src} bukan ./gambar/<nama>.png|svg`).not.toBeNull();
        expect(
          loadGuideImage((src ?? '').split('/').pop() ?? ''),
          `${page.file}: ${src} tidak ada`,
        ).not.toBeNull();
      }
    }
  });

  it('SVG tanpa skrip, handler, atau sumber luar; PNG ≤ 400 KB', () => {
    for (const name of readdirSync(IMAGE_DIR)) {
      expect(guideImageType(name), `nama berkas tidak sah: ${name}`).not.toBeNull();
      const path = join(IMAGE_DIR, name);
      if (name.endsWith('.svg')) {
        const svg = loadGuideImage(name)?.body.toString('utf8') ?? '';
        expect(svg, name).not.toMatch(
          /<script|<foreignObject|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)/i,
        );
        expect(svg, `${name}: wajib <title> untuk pembaca layar`).toMatch(/<title[^>]*>[^<]+<\/title>/);
        expect(svg, `${name}: wajib terbaca di mode gelap`).toContain('prefers-color-scheme: dark');
      } else {
        expect(statSync(path).size, `${name} terlalu besar`).toBeLessThanOrEqual(400 * 1024);
      }
    }
  });
});
