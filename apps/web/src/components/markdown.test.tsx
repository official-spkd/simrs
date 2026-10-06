import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

const html = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }));

describe('Markdown panduan · gambar', () => {
  it('gambar lokal dirender lewat rute superadmin dengan alt dan tautan ukuran penuh', () => {
    const out = html('![Layar poli dengan banner pasien](./gambar/poli.png)');
    expect(out).toContain(
      '<img src="/superadmin/panduan/gambar/poli.png" alt="Layar poli dengan banner pasien"',
    );
    expect(out).toContain('href="/superadmin/panduan/gambar/poli.png"');
    expect(out).toContain('loading="lazy"');
  });

  it('SVG tetap sebagai <img>, bukan disisipkan inline', () => {
    const out = html('![Diagram outbox](./gambar/diagram-outbox.svg)');
    expect(out).toContain('<img src="/superadmin/panduan/gambar/diagram-outbox.svg"');
    expect(out).not.toContain('<svg');
  });

  it('gambar luar, traversal, atau tanpa alt tidak dirender (tanpa permintaan keluar)', () => {
    for (const md of [
      '![Gambar luar](https://contoh.id/x.png)',
      '![Traversal](./gambar/../../.env)',
      '![Data](data:image/png;base64,AAAA)',
      '![](./gambar/poli.png)',
    ]) {
      const out = html(md);
      expect(out, md).not.toContain('<img');
      expect(out, md).toContain('Gambar tidak ditampilkan');
    }
  });

  it('HTML mentah di Markdown tetap tidak dirender', () => {
    const out = html('<img src="https://contoh.id/x.png" onerror="alert(1)">');
    expect(out).not.toContain('<img');
  });
});
