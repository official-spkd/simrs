import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type KioskIdentifyInput,
  type KioskIdentifyResult,
  kioskCheckInSchema,
  kioskIdentifySchema,
  type KioskRegisterInput,
  kioskRegisterSchema,
  type KioskSessionOption,
  type KioskTicketRequest,
  kioskTicketRequestSchema,
  type PrintableTicket,
} from '@simrs/shared';
import type { Response } from 'express';
import { Audited, type AuditSource } from '../../common/audited.decorator';
import { DeviceScoped } from '../../common/device-scoped.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { KioskService } from './kiosk.service';
import { renderTicketHtml, TICKET_HTML_CSP } from './ticket-html';

const uuid = new ParseUUIDPipe();

const ticketId = ({ result }: AuditSource): string | undefined =>
  (result as { ticketId?: string } | undefined)?.ticketId;
const ticketDetails = ({ result }: AuditSource) => {
  const r = result as PrintableTicket | undefined;
  return r ? { queueNo: r.queueNo } : undefined;
};

/**
 * F05 · Anjungan mandiri (`/api/v1/kiosk`, kontrak `@simrs/shared` `schemas/kiosk`). Hanya prinsipal perangkat
 * berizin `kiosk.use` (ADR-0027): token staf → 403; batas laju per perangkat (`UserThrottlerGuard`) ditambah batas
 * pencarian identitas `kiosk.lookup_rate_per_min`. Pelaku audit = perangkat (`details.device`). Respons tanpa ID
 * pasien, RM, atau NIK.
 */
@ApiTags('kiosk (F05)')
@DeviceScoped('kiosk.use')
@RequireModule('F05')
@Controller('kiosk')
export class KioskController {
  constructor(private readonly kiosk: KioskService) {}

  /** Identifikasi (200 ditemukan atau tidak); audit per percobaan ditulis service (dengan pasiennya bila cocok). */
  @Post('identify')
  @HttpCode(200)
  identify(
    @Body(new ZodValidationPipe(kioskIdentifySchema)) body: KioskIdentifyInput,
  ): Promise<KioskIdentifyResult> {
    return this.kiosk.identify(body);
  }

  /** Check-in booking hari ini → tiket loket (header `Idempotency-Key` wajib). */
  @Post('check-in')
  @HttpCode(200)
  checkIn(
    @Body(new ZodValidationPipe(kioskCheckInSchema)) body: { lookupToken: string },
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<PrintableTicket> {
    return this.kiosk.checkIn(body.lookupToken, key);
  }

  /** Ambil tiket loket (tanpa identitas) atau farmasi/kasir (dengan token identifikasi). */
  @Post('tickets')
  @Audited({ action: 'create', resource: 'kiosk_ticket', resourceId: ticketId, details: ticketDetails })
  issueTicket(
    @Body(new ZodValidationPipe(kioskTicketRequestSchema)) body: KioskTicketRequest,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<PrintableTicket> {
    return this.kiosk.issueTicket(body, key);
  }

  /** Sesi dokter hari ini untuk pasien umum (tanpa data pasien). */
  @Get('sessions')
  sessions(): Promise<KioskSessionOption[]> {
    return this.kiosk.sessions();
  }

  /**
   * Registrasi mandiri rawat jalan (alur 5a: kunjungan + penjaminan + SEP `pending` lewat outbox) → tiket poli.
   * Header `Idempotency-Key` (UUID) wajib. Audit kunjungan ditulis `RegistrationService` (pelaku = perangkat).
   */
  @Post('register')
  @HttpCode(201)
  register(
    @Body(new ZodValidationPipe(kioskRegisterSchema)) body: KioskRegisterInput,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<PrintableTicket> {
    return this.kiosk.register(body, key);
  }

  /** Tiket siap cetak 80 mm (HTML mandiri tanpa skrip). */
  @Get('tickets/:id/print')
  async print(@Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response): Promise<string> {
    const { ticket } = await this.kiosk.print(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', TICKET_HTML_CSP);
    res.setHeader('Cache-Control', 'no-store');
    return renderTicketHtml(ticket);
  }

  /** "Panggil petugas": notifikasi in-app tanpa PHI ke petugas pendaftaran (audit di service). */
  @Post('assist')
  @HttpCode(200)
  assist(): Promise<{ requestedAt: string }> {
    return this.kiosk.assist();
  }
}
