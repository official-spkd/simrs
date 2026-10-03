import { z } from 'zod';

/** Kode galat stabil. Klien boleh bergantung pada kode ini; pesan boleh berubah. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'TENANT_REQUIRED',
  'TENANT_MISMATCH',
  'MODULE_DISABLED',
  'CDS_BLOCKED',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_TIMESTAMP_EXPIRED',
  'INTEGRATION_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
