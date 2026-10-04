import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Batas server/klien (RSC): nilai yang diekspor modul 'use client' (konstanta, fungsi biasa) hanya berupa referensi
 * klien di komponen server — `.find()` atau `className` dari sana gagal saat runtime (pernah terjadi di rekam rawat
 * inap). Modul server hanya boleh mengimpor komponen (PascalCase) dan tipe dari modul klien.
 */
const SRC = resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const isClient = (source: string) => /^\s*['"]use client['"]/.test(source);

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
    try {
      if (statSync(base + ext).isFile()) return base + ext;
    } catch {
      // coba ekstensi berikutnya
    }
  }
  return null;
}

describe('batas server/klien', () => {
  it('modul server tidak mengimpor nilai non-komponen dari modul "use client"', () => {
    const files = walk(SRC);
    const source = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
    const violations: string[] = [];
    const importRe = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
    for (const file of files) {
      const text = source.get(file) ?? '';
      if (isClient(text)) continue;
      for (const m of text.matchAll(importRe)) {
        if (m[1]) continue;
        const target = resolveImport(file, m[3] ?? '');
        if (!target || !isClient(source.get(target) ?? readFileSync(target, 'utf8'))) continue;
        const values = (m[2] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith('type '))
          .filter((s) => !/^[A-Z][a-z0-9]/.test(s.split(/\s+as\s+/)[0] ?? ''));
        if (values.length > 0) {
          violations.push(`${relative(SRC, file)} ← ${relative(SRC, target)}: ${values.join(', ')}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
