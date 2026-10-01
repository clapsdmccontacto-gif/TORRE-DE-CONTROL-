import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Valida y tipa el body con un esquema Zod; responde 400 con el detalle por campo. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'SOLICITUD_INVALIDA',
        message: 'La solicitud no cumple el formato esperado.',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
