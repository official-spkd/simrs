import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { isTenantRequiredError, type KnownDbError, knownDbError } from '@simrs/db';
import { AppError, type ErrorBody, type ErrorCode } from '@simrs/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Galat dari body-parser Express (JSON rusak, body terlalu besar) membawa `type` dan `status`. */
function isBodyParserError(e: unknown): e is { type: string; status: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { type?: unknown }).type === 'string' &&
    (e as { type: string }).type.startsWith('entity.') &&
    typeof (e as { status?: unknown }).status === 'number'
  );
}

/**
 * Galat Prisma yang punya makna untuk klien. Hanya nama field (bukan nilai) yang dikembalikan.
 * Kode lain jatuh ke INTERNAL_ERROR (dan tercatat di log tanpa pesan).
 */
export function mapDbError(e: KnownDbError): [number, ErrorBody] | null {
  switch (e.code) {
    case 'P2002':
      return [
        409,
        {
          code: 'CONFLICT',
          message: 'Data dengan kunci yang sama sudah ada',
          details: e.fields ? { fields: e.fields } : undefined,
        },
      ];
    case 'P2003':
      return [400, { code: 'VALIDATION_FAILED', message: 'Referensi ke data lain tidak valid' }];
    case 'P2004':
    case 'P2011':
      return [400, { code: 'VALIDATION_FAILED', message: 'Data melanggar aturan validasi' }];
    case 'P2025':
      return [404, { code: 'NOT_FOUND', message: 'Data tidak ditemukan' }];
    case 'P2034':
      // Deadlock / konflik tulis serentak (Postgres 40P01/40001): transaksi sudah dibatalkan utuh, aman diulang.
      return [
        409,
        { code: 'CONFLICT', message: 'Data sedang diubah oleh transaksi lain; muat ulang lalu ulangi aksi' },
      ];
    case 'P2028':
      // Transaksi tidak bisa dimulai dalam batas tunggu (pool penuh di bawah beban): bukan galat program.
      return [503, { code: 'SERVICE_BUSY', message: 'Layanan sedang sibuk; ulangi beberapa saat lagi' }];
    default:
      return null;
  }
}

/**
 * Ringkasan galat untuk log tanpa PHI. Pesan galat dibuang karena bisa memuat nilai data
 * (mis. galat validasi Prisma mencetak argumen query); yang disimpan hanya nama, kode, dan frame stack.
 */
export function sanitizeForLog(e: unknown): { name: string; code?: string; stack?: string } {
  if (!(e instanceof Error)) return { name: typeof e };
  const code = (e as { code?: unknown }).code;
  return {
    name: e.name,
    code: typeof code === 'string' ? code : undefined,
    stack: e.stack
      ?.split('\n')
      .filter((line) => line.trimStart().startsWith('at '))
      .slice(0, 15)
      .join('\n'),
  };
}

/**
 * Format galat standar `{ code, message, details, requestId }` dengan kode stabil.
 * Pesan galat internal tidak diteruskan ke klien maupun log (bisa memuat PHI); cukup request id untuk menelusuri.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('AppErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    const [status, body] = this.toBody(exception);
    if (status >= 500 || res.headersSent) {
      this.logger.error({ err: sanitizeForLog(exception), requestId }, 'Galat tidak tertangani');
    }
    if (res.headersSent) {
      // Respons sudah mulai dikirim (mis. aliran SSE, ADR-0026): status tidak bisa diubah lagi, cukup tutup.
      if (!res.writableEnded) res.end();
      return;
    }
    res.status(status).json({ ...body, requestId });
  }

  private toBody(e: unknown): [number, ErrorBody] {
    if (e instanceof AppError) return [e.status, { code: e.code, message: e.message, details: e.details }];
    if (e instanceof ZodError) {
      return [
        400,
        {
          code: 'VALIDATION_FAILED',
          message: 'Data tidak valid',
          details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      ];
    }
    if (isTenantRequiredError(e)) {
      return [400, { code: 'TENANT_REQUIRED', message: 'Konteks tenant wajib untuk permintaan ini' }];
    }
    const dbError = knownDbError(e);
    if (dbError) {
      const mapped = mapDbError(dbError);
      if (mapped) return mapped;
    }
    if (e instanceof Error && /row-level security/i.test(e.message)) {
      // Menulis baris atas nama tenant lain: bug program atau upaya manipulasi.
      return [403, { code: 'TENANT_MISMATCH', message: 'Data bukan milik tenant ini' }];
    }
    if (isBodyParserError(e)) {
      return e.type === 'entity.too.large'
        ? [413, { code: 'PAYLOAD_TOO_LARGE', message: 'Ukuran data melebihi batas' }]
        : [400, { code: 'VALIDATION_FAILED', message: 'Body permintaan tidak bisa dibaca' }];
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code = STATUS_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
      return [status, { code, message: status >= 500 ? 'Terjadi galat pada server' : e.message }];
    }
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: 'INTERNAL_ERROR', message: 'Terjadi galat pada server' },
    ];
  }
}
