import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Fon IBM Plex (SIL Open Font License 1.1, paket npm `@ibm/plex-sans` dan `@ibm/plex-mono` dengan versi terkunci di
 * lockfile): sama dengan tipografi layar (docs/08). Berkas WOFF dibaca dari paket, lalu disubset dan ditanam ke PDF oleh
 * pdf-lib + fontkit. Versi fon ikut menentukan hash PDF, jadi pembaruan paket fon = perubahan yang disengaja.
 */

export const PDF_FONT_FILES = {
  regular: '@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-Regular.woff',
  semibold: '@ibm/plex-sans/fonts/complete/woff/IBMPlexSans-SemiBold.woff',
  mono: '@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff',
} as const;
export type PdfFontName = keyof typeof PDF_FONT_FILES;

/** Nama tetap fon di PDF (tanpa akhiran acak), agar keluaran deterministik dan mudah diperiksa. */
export const PDF_FONT_NAMES: Readonly<Record<PdfFontName, string>> = {
  regular: 'IBMPlexSans-Regular',
  semibold: 'IBMPlexSans-SemiBold',
  mono: 'IBMPlexMono-Regular',
};

const cache = new Map<PdfFontName, Uint8Array>();

/** Isi berkas fon (di-cache per proses). */
export function pdfFontBytes(name: PdfFontName): Uint8Array {
  const hit = cache.get(name);
  if (hit) return hit;
  const require = createRequire(import.meta.url);
  const bytes = new Uint8Array(readFileSync(require.resolve(PDF_FONT_FILES[name])));
  cache.set(name, bytes);
  return bytes;
}
