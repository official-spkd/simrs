import type { NextFunction, Request, Response } from 'express';

/**
 * Pembaca body biner (`application/octet-stream`) untuk rute unggahan, dipasang sebagai middleware sehingga
 * berkas sudah terbaca utuh SEBELUM guard/interceptor membuka transaksi database: klien yang mengunggah pelan
 * tidak menahan koneksi pool. Berkas di atas batas tidak disimpan di memori: sisanya dibaca lalu dibuang dan
 * 413 dijawab setelah klien selesai mengirim (menjawab lebih awal membuat klien menerima reset koneksi sebelum
 * sempat membaca jawabannya). Unggahan yang terlalu lama tetap diputus `server.requestTimeout`.
 */
export function rawUpload(limitBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const type = req.headers['content-type'] ?? '';
    if (req.method !== 'POST' || !type.toLowerCase().startsWith('application/octet-stream')) {
      next();
      return;
    }
    // Tanpa token sama sekali: berkas tidak disimpan (validasi sesi penuh tetap di AuthGuard).
    const anonymous = !req.headers.authorization?.startsWith('Bearer ');
    const declared = Number(req.headers['content-length']);
    let tooLarge = Number.isFinite(declared) && declared > limitBytes;
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) tooLarge = true;
      if (tooLarge || anonymous) chunks.length = 0;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (anonymous) {
        res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Belum login' });
      } else if (tooLarge) {
        res.status(413).json({
          code: 'PAYLOAD_TOO_LARGE',
          message: `Berkas maksimal ${Math.floor(limitBytes / 1048576)} MB`,
        });
      } else {
        req.body = Buffer.concat(chunks, size);
        next();
      }
    });
    req.on('error', next);
  };
}
