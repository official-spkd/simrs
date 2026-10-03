import { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validasi body/query dengan skema zod dari @simrs/shared. ZodError dipetakan ke VALIDATION_FAILED oleh filter. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}
