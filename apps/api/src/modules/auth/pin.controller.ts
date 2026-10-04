import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  pinAccountsSchema,
  pinLoginSchema,
  type PinLoginInput,
  pinRegisterSchema,
  type PinRegisterInput,
} from '@simrs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { Audited, paramId, resultId } from '../../common/audited.decorator';
import { AuthRateLimited } from '../../common/auth-rate-limited.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { meta } from './auth.controller';
import { PinService } from './pin.service';

/** P02 · Masuk cepat dengan PIN di perangkat terdaftar (publik; batas laju kredensial). ADR-0024. */
@ApiTags('auth (P02)')
@AuthRateLimited()
@Controller('auth/pin')
export class PinLoginController {
  constructor(private readonly pin: PinService) {}

  /** Token perangkat dari cookie httpOnly web + PIN 6 digit → sesi pendek di posisi pendaftaran PIN. */
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(pinLoginSchema)) body: PinLoginInput, @Req() req: Request) {
    return this.pin.login(body, meta(req));
  }

  /** Akun ber-PIN yang diingat peramban ini (nama + posisi), untuk pilihan di layar masuk. */
  @Post('accounts')
  @HttpCode(200)
  accounts(
    @Body(new ZodValidationPipe(pinAccountsSchema)) body: z.infer<typeof pinAccountsSchema>,
    @Req() req: Request,
  ) {
    return this.pin.accounts(body.deviceTokens, meta(req));
  }
}

/** P02 · Perangkat ber-PIN milik akun yang sedang login (sesi lengkap). ADR-0024. */
@ApiTags('auth (P02)')
@TenantScoped()
@Controller('auth/pin/devices')
export class PinDeviceController {
  constructor(private readonly pin: PinService) {}

  @Get()
  list() {
    return this.pin.list();
  }

  /** Daftarkan perangkat ini untuk posisi sesi saat ini; wajib sandi saat ini. Token hanya di respons ini. */
  @Post()
  @AuthRateLimited()
  @Audited({
    action: 'create',
    resource: 'registered_device',
    resourceId: resultId,
    details: ({ result }) => {
      const r = result as { roleCode: string; unitId: string; expiresAt: string };
      return { method: 'pin', role: r.roleCode, unitId: r.unitId, expiresAt: r.expiresAt };
    },
  })
  register(@Body(new ZodValidationPipe(pinRegisterSchema)) body: PinRegisterInput) {
    return this.pin.register(body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Audited({
    action: 'deactivate',
    resource: 'registered_device',
    resourceId: paramId,
    details: () => ({ reason: 'user_removed' }),
  })
  revoke(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.pin.revoke(id);
  }
}
