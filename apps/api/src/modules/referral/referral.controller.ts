import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CancelReferralInput,
  cancelReferralSchema,
  type CreateControlLetterInput,
  createControlLetterSchema,
  type CreateInternalReferralInput,
  createInternalReferralSchema,
  type CreateOutgoingReferralInput,
  createOutgoingReferralSchema,
  type ReferralList,
  referralListQuerySchema,
  type ReferralRecord,
} from '@simrs/shared';
import type { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ReferralService } from './referral.service';

const uuid = new ParseUUIDPipe();

/**
 * F07 · Rujukan (`/api/v1/referrals`, kontrak `@simrs/shared` `schemas/referral`): rujukan keluar dan internal, plus
 * surat kontrol dan SPRI (F06, modul F06). Kiriman ke BPJS selalu lewat outbox; tidak ada panggilan BPJS di sini.
 * Audit per pasien ditulis service di transaksi yang sama. Izin `referral.read|write`.
 */
@ApiTags('referral (F07)')
@TenantScoped()
@RequireModule('F07')
@Controller('referrals')
export class ReferralController {
  constructor(private readonly referrals: ReferralService) {}

  @RequirePermission('referral', 'read')
  @Get()
  list(
    @Query(new ZodValidationPipe(referralListQuerySchema)) q: z.infer<typeof referralListQuerySchema>,
  ): Promise<ReferralList> {
    return this.referrals.list(q);
  }

  /** Surat kontrol (rencana kontrol) atau SPRI dari sebuah kunjungan BPJS; nomor dari VClaim lewat outbox. */
  @RequireModule('F06')
  @RequirePermission('referral', 'write')
  @Post('control-letters')
  controlLetter(
    @Body(new ZodValidationPipe(createControlLetterSchema)) body: CreateControlLetterInput,
  ): Promise<ReferralRecord> {
    return this.referrals.createControlLetter(body);
  }

  @RequirePermission('referral', 'write')
  @Post('outgoing')
  outgoing(
    @Body(new ZodValidationPipe(createOutgoingReferralSchema)) body: CreateOutgoingReferralInput,
  ): Promise<ReferralRecord> {
    return this.referrals.createOutgoing(body);
  }

  @RequirePermission('referral', 'write')
  @Post('internal')
  internal(
    @Body(new ZodValidationPipe(createInternalReferralSchema)) body: CreateInternalReferralInput,
  ): Promise<ReferralRecord> {
    return this.referrals.createInternal(body);
  }

  @RequirePermission('referral', 'read')
  @Get(':id')
  get(@Param('id', uuid) id: string): Promise<ReferralRecord> {
    return this.referrals.get(id);
  }

  @RequirePermission('referral', 'write')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(cancelReferralSchema)) body: CancelReferralInput,
  ): Promise<ReferralRecord> {
    return this.referrals.cancel(id, body);
  }

  /** Kirim ulang setelah ditolak BPJS / DLQ. */
  @RequirePermission('referral', 'write')
  @Post(':id/retry')
  @HttpCode(200)
  retry(@Param('id', uuid) id: string): Promise<ReferralRecord> {
    return this.referrals.retry(id);
  }
}
