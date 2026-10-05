import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  type ChangePasswordInput,
  loginSchema,
  type LoginInput,
  mfaBackupCodeSchema,
  mfaChallengeSchema,
  mfaConfirmSchema,
  mfaVerifySchema,
  type MfaVerifyInput,
  refreshSchema,
  selectAssignmentSchema,
} from '@simrs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuthRateLimited } from '../../common/auth-rate-limited.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AllowIncompleteSession } from '../../infra/auth/allow-incomplete-session.decorator';
import { AccountService } from './account.service';
import { AuthService, type RequestMeta } from './auth.service';

export function meta(req: Request & { id?: unknown }): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
    host: req.hostname ?? null,
  };
}

/** P02 · Endpoint publik: login, verifikasi MFA, perpanjang sesi. */
@ApiTags('auth (P02)')
@AuthRateLimited()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Req() req: Request) {
    return this.auth.login(body, meta(req));
  }

  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body(new ZodValidationPipe(mfaVerifySchema)) body: MfaVerifyInput, @Req() req: Request) {
    return this.auth.verifyMfa(body, meta(req));
  }

  /** Kode cadangan lewat WhatsApp/email saat tidak punya akses aplikasi autentikator. */
  @Post('mfa/backup-code')
  @HttpCode(200)
  sendBackupCode(
    @Body(new ZodValidationPipe(mfaBackupCodeSchema)) body: z.infer<typeof mfaBackupCodeSchema>,
    @Req() req: Request,
  ) {
    return this.auth.sendBackupCode(body, meta(req));
  }

  /** Kanal kode cadangan yang boleh dipakai akun ini menurut pengaturan RS (kosong = hanya aplikasi). */
  @Post('mfa/backup-options')
  @HttpCode(200)
  backupCodeOptions(
    @Body(new ZodValidationPipe(mfaChallengeSchema)) body: z.infer<typeof mfaChallengeSchema>,
  ) {
    return this.auth.backupCodeOptions(body.challengeToken);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: Request,
  ) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }
}

/**
 * P02 · Akun yang sedang login. Boleh dipakai sesi yang belum lengkap (belum MFA / wajib ganti sandi),
 * karena justru di sinilah akun dilengkapi.
 */
@ApiTags('auth (P02)')
@TenantScoped()
@AllowIncompleteSession()
@Controller('auth')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('me')
  me() {
    return this.account.me();
  }

  @Post('logout')
  @HttpCode(200)
  logout() {
    return this.account.logout();
  }

  @Post('password')
  @HttpCode(200)
  @AuthRateLimited()
  changePassword(@Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput) {
    return this.account.changePassword(body);
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  startMfa() {
    return this.account.startMfaEnrollment();
  }

  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  @AuthRateLimited()
  confirmMfa(@Body(new ZodValidationPipe(mfaConfirmSchema)) body: z.infer<typeof mfaConfirmSchema>) {
    return this.account.confirmMfaEnrollment(body.code);
  }
}

/** P03 · Pemilihan unit kerja/peran untuk sesi (setelah MFA). */
@ApiTags('auth (P02)')
@TenantScoped()
@Controller('auth')
export class SessionAssignmentController {
  constructor(private readonly account: AccountService) {}

  @Get('assignments')
  listAssignments() {
    return this.account.listAssignments();
  }

  @Post('assignment')
  @HttpCode(200)
  selectAssignment(
    @Body(new ZodValidationPipe(selectAssignmentSchema)) body: z.infer<typeof selectAssignmentSchema>,
  ) {
    return this.account.selectAssignment(body.assignmentId);
  }
}
