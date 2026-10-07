import { Controller, Header, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '@simrs/shared';
import { LIS_SIGNATURE_HEADER, LIS_TIMESTAMP_HEADER } from '@simrs/shared/node';
import type { Request, Response } from 'express';
import { DeviceScoped } from '../../common/device-scoped.decorator';
import { LisIngestService } from './lis-ingest.service';

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : undefined;
};

/**
 * S01 · `POST /api/v1/devices/lis/hl7` (rencana fase 4 §4.1a): analyzer/gateway lab terdaftar mengirim ORU^R01
 * (HL7 v2, body mentah maks. 256 KB, `rawText` di bootstrap) bertanda tangan HMAC perangkat. Jawaban = ACK HL7.
 * Hanya token perangkat `dv1` jenis `lab_analyzer` (izin tetap `lab.analyzer.ingest`); token staf → 403.
 */
@ApiTags('laboratorium · ingest analyzer')
@DeviceScoped('lab.analyzer.ingest')
@Controller('devices/lis')
export class LisIngestController {
  constructor(private readonly ingest: LisIngestService) {}

  @Post('hl7')
  @Header('Content-Type', 'application/hl7-v2; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async hl7(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<string> {
    if (!Buffer.isBuffer(req.body)) {
      throw new AppError('VALIDATION_FAILED', 'Body HL7 kosong atau tipe konten tidak didukung', 400);
    }
    const reply = await this.ingest.ingest(req.body, {
      timestamp: header(req, LIS_TIMESTAMP_HEADER),
      signature: header(req, LIS_SIGNATURE_HEADER),
      contentType: header(req, 'content-type'),
    });
    res.status(reply.status);
    return reply.ack;
  }
}
