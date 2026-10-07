import type { NextFunction, Request, Response } from 'express';
import { sizeLabel } from './raw-upload.middleware';

/**
 * Pembaca body teks mentah untuk ingest perangkat (HL7 v2 dari analyzer lab, fase 4 §4.1a). Byte body dibutuhkan
 * persis apa adanya untuk memeriksa HMAC `timestamp.body`, jadi tidak lewat parser JSON. Dibaca utuh SEBELUM guard
 * membuka transaksi; di atas batas → 413 tanpa menyimpan isi di memori; tipe konten lain → 415. Tanpa token sama
 * sekali → 401 (validasi penuh tetap di `DeviceGuard`). Hasil: `req.body` berupa `Buffer`.
 */
export function rawText(limitBytes: number, contentTypes: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const anonymous = !req.headers.authorization?.startsWith('Bearer ');
    const allowed = contentTypes.includes(type);
    const declared = Number(req.headers['content-length']);
    let tooLarge = Number.isFinite(declared) && declared > limitBytes;
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) tooLarge = true;
      if (tooLarge || anonymous || !allowed) chunks.length = 0;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (anonymous) {
        res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Perangkat belum terdaftar' });
      } else if (tooLarge) {
        res
          .status(413)
          .json({ code: 'PAYLOAD_TOO_LARGE', message: `Pesan maksimal ${sizeLabel(limitBytes)}` });
      } else if (!allowed) {
        res.status(415).json({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Tipe konten harus salah satu dari: ${contentTypes.join(', ')}`,
        });
      } else {
        req.body = Buffer.concat(chunks, size);
        next();
      }
    });
    req.on('error', next);
  };
}
