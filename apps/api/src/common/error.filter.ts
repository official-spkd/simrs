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
  429: 'RATE_LIMITED',
};

/**
 * Format galat standar `{ code, message, details, requestId }` dengan kode stabil.
 * Pesan galat internal tidak diteruskan ke klien (bisa memuat PHI); detailnya hanya di log dengan request id.
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
      this.logger.error({ err: exception, requestId }, 'Galat tidak tertangani');
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
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return [status, { code: STATUS_CODE[status] ?? 'INTERNAL_ERROR', message: e.message }];
    }
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: 'INTERNAL_ERROR', message: 'Terjadi galat pada server' },
    ];
  }
}
