import { STATIC_FILE_CSP } from '@/lib/csp';
import { loadGuideImage } from '@/lib/guide';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { canReadGuide, nextLoginStep } from '@/lib/session-view';

type Params = Promise<{ file: string }>;

const notFound = () =>
  new Response('Tidak ditemukan.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * Gambar panduan superadmin (`docs/panduan/gambar/*.png|svg`). Gerbangnya sama dengan halaman panduan (`canReadGuide`:
 * operator platform, atau Superadmin demo hanya di mode presentasi); selain itu → 404 (tidak membocorkan rute). Nama berkas dicocokkan pola ketat di
 * `loadGuideImage` sebelum menyentuh sistem berkas (tanpa path traversal, tanpa symlink).
 *
 * SVG dikirim dengan jenis konten yang benar + `nosniff`, dan CSP `sandbox` tanpa skrip: dipakai sebagai `<img>`
 * skrip SVG memang tidak pernah jalan, dan bila berkasnya dibuka langsung pun tetap tidak jalan.
 */
export async function GET(_req: Request, { params }: { params: Params }): Promise<Response> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai' || !canReadGuide(s, webEnv().dataSource)) return notFound();
  const image = loadGuideImage((await params).file);
  if (!image) return notFound();
  return new Response(new Uint8Array(image.body), {
    headers: {
      'content-type': image.contentType,
      'x-content-type-options': 'nosniff',
      'content-security-policy': STATIC_FILE_CSP,
      'cache-control': 'private, max-age=300',
      'content-disposition': 'inline',
    },
  });
}
