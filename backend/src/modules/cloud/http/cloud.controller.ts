import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { AccessControl } from '../infrastructure/access-control.js';

const claimSchema = z.object({ key: z.string().max(100) });

/** La interfaz (también desde GitHub Pages) descubre la nube y crea o valida la clave. */
@Controller('cloud')
export class CloudController {
  constructor(private readonly access: AccessControl) {}

  /** Abierto: dice si hay servidor, si ya tiene clave y si todavía se puede crear otra. */
  @Get('status')
  status() {
    return {
      service: 'torre-control',
      claimed: this.access.isClaimed(),
      canClaim: this.access.canClaim(),
    };
  }

  /** Abierto mientras la nube no tenga datos: la crea quien abre la app por primera vez. */
  @Post('claim')
  @HttpCode(200)
  async claim(@Body(new ZodValidationPipe(claimSchema)) body: { key: string }) {
    await this.access.claim(body.key);
    return { claimed: true };
  }

  /** Protegido: confirma que la clave del dispositivo sirve. */
  @Get('session')
  session() {
    return { ok: true };
  }
}
