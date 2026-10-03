import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService, type Readiness } from './health.service';

@ApiTags('sistem')
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: proses hidup. Tidak menyentuh dependensi. */
  @Get('health')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Proses API hidup' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: DB, Redis, MinIO. 503 bila salah satu gagal. */
  @Get('ready')
  @ApiOkResponse({ description: 'Semua dependensi siap' })
  @ApiServiceUnavailableResponse({ description: 'Minimal satu dependensi gagal' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<Readiness> {
    const result = await this.health.readiness();
    res.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
