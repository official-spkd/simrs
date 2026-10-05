import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type BpjsParticipantLookupInput,
  bpjsParticipantLookupSchema,
  type CancelSepInput,
  cancelSepSchema,
  type ReviseSepInput,
  reviseSepSchema,
  type Sep,
} from '@simrs/shared';
import { z } from 'zod';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SepService } from './sep.service';

const uuid = new ParseUUIDPipe();

const patientQuerySchema = z.strictObject({ patientId: z.uuid() });
const optionalPatientQuerySchema = z.strictObject({ patientId: z.uuid().optional() });

/**
 * F06 · SEP dan lookup kepesertaan/rujukan (`/api/v1/sep`, kontrak `@simrs/shared` `schemas/registration`).
 * Penerbitan, revisi, batal, dan kirim ulang selalu lewat outbox; lookup sinkron di luar transaksi (ADR-0025).
 * Audit tiap aksi membawa pasien: lookup lewat `LookupGateway`, endpoint SEP dicatat service (pasien diturunkan dari
 * kunjungan SEP) di transaksi yang sama.
 */
@ApiTags('sep (F06)')
@TenantScoped()
@RequireModule('F06')
@Controller('sep')
export class SepController {
  constructor(private readonly sep: SepService) {}

  /** Cek kepesertaan JKN (data pribadi di body). `?patientId=` mengaitkan audit ke pasien. */
  @RequirePermission('coverage', 'read')
  @Post('eligibility-checks')
  @HttpCode(200)
  @NoRequestTransaction()
  eligibility(
    @Body(new ZodValidationPipe(bpjsParticipantLookupSchema)) body: BpjsParticipantLookupInput,
    @Query(new ZodValidationPipe(optionalPatientQuerySchema)) q: { patientId?: string },
  ) {
    return this.sep.eligibility(body, q.patientId);
  }

  /** Rujukan FKTP (VClaim, no. kartu pasien dibaca server) + surat kontrol aktif RS. */
  @RequirePermission('coverage', 'read')
  @Get('referrals')
  @NoRequestTransaction()
  referrals(@Query(new ZodValidationPipe(patientQuerySchema)) q: { patientId: string }) {
    return this.sep.referrals(q.patientId);
  }

  @RequirePermission('coverage', 'read')
  @Get(':id')
  get(@Param('id', uuid) id: string): Promise<Sep> {
    return this.sep.get(id);
  }

  /** Revisi SEP terbit → versi baru (alasan wajib). */
  @RequirePermission('coverage', 'write')
  @Patch(':id')
  revise(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(reviseSepSchema)) body: ReviseSepInput,
  ): Promise<Sep> {
    return this.sep.revise(id, body);
  }

  /** Kirim ulang setelah ditolak BPJS / DLQ. */
  @RequirePermission('coverage', 'write')
  @Post(':id/retry')
  @HttpCode(200)
  retry(@Param('id', uuid) id: string): Promise<Sep> {
    return this.sep.retry(id);
  }

  @RequirePermission('coverage', 'write')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(cancelSepSchema)) body: CancelSepInput,
  ): Promise<Sep> {
    return this.sep.cancel(id, body);
  }
}
