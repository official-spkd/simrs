import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { isTenantRequiredError } from '@simrs/db';
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
    if (status >= 500) {
      this.logger.error({ err: sanitizeForLog(exception), requestId }, 'Galat tidak tertangani');
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
