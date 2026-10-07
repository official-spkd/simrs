import type { NextFunction, Request, Response } from 'express';

/**
 * Pemeriksa sesi untuk rute unggahan: `true` bila header `Authorization` membawa sesi staf yang sah (aktif, MFA,
 * tanpa wajib ganti sandi). Dipanggil SEBELUM body dibaca (ADR-0109).
 */
export type UploadAuthenticator = (authorization: string | undefined) => Promise<boolean>;

/**
 * Pembaca body biner (`application/octet-stream`) untuk rute unggahan, dipasang sebagai middleware sehingga
 * berkas sudah terbaca utuh SEBELUM guard/interceptor membuka transaksi database: klien yang mengunggah pelan
 * tidak menahan koneksi pool. Sesi diperiksa lebih dulu (`authenticate`, ADR-0109): tanpa sesi sah berkas tidak
 * pernah ditampung di memori, sisanya dibaca lalu dibuang dan 401 dijawab. Berkas di atas batas juga tidak disimpan:
 * dibuang lalu 413 dijawab setelah klien selesai mengirim (menjawab lebih awal membuat klien menerima reset koneksi
 * sebelum sempat membaca jawabannya). Unggahan yang terlalu lama tetap diputus `server.requestTimeout`. Validasi sesi
 * penuh + izin tetap di AuthGuard/interceptor.
 */
export function rawUpload(limitBytes: number, authenticate?: UploadAuthenticator) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const type = req.headers['content-type'] ?? '';
    if (req.method !== 'POST' || !type.toLowerCase().startsWith('application/octet-stream')) {
      next();
      return;
    }
    const bearer = !!req.headers.authorization?.startsWith('Bearer ');
    const check = bearer && authenticate ? authenticate(req.headers.authorization) : Promise.resolve(bearer);
    check.then(
      (allowed) => read(req, res, next, limitBytes, !allowed),
      (err: unknown) => {
        // Pemeriksaan sesi gagal (mis. database): buang body, teruskan galat ke penanganan galat Express.
        req.resume();
        next(err);
      },
    );
  };
}

function read(req: Request, res: Response, next: NextFunction, limitBytes: number, anonymous: boolean): void {
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
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sesi tidak valid atau sudah berakhir' });
    } else if (tooLarge) {
      res.status(413).json({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Berkas maksimal ${sizeLabel(limitBytes)}`,
      });
    } else {
      req.body = Buffer.concat(chunks, size);
      next();
    }
  });
  req.on('error', next);
}

/** Batas ukuran untuk pesan pengguna: MB bila ≥ 1 MB, selain itu KB (mis. tanda tangan 512 KB, bukan "0 MB"). */
export function sizeLabel(bytes: number): string {
  return bytes >= 1048576 ? `${Math.floor(bytes / 1048576)} MB` : `${Math.floor(bytes / 1024)} KB`;
}
