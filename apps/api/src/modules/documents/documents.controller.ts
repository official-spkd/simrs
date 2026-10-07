import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError, uploadDocumentSchema, VERIFY_CODE_PATTERN, voidDocumentSchema } from '@simrs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited, type AuditSource, param, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DocumentsService } from './documents.service';
import { SignatureVerificationService } from './signature-verification.service';

const uuid = new ParseUUIDPipe();

/** Pasien dari hasil handler (`patientId` di respons dokumen). */
const resultPatient = ({ result }: AuditSource): string | undefined =>
  typeof result === 'object' &&
  result !== null &&
  typeof (result as { patientId?: unknown }).patientId === 'string'
    ? (result as { patientId: string }).patientId
    : undefined;

/** Header metadata unggahan (UTF-8 di-percent-encode oleh BFF); tidak masuk log (log hanya path). */
function header(req: Request, name: string): string {
  const raw = req.headers[name];
  if (typeof raw !== 'string') return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new AppError('VALIDATION_FAILED', `Header ${name} tidak valid`, 400);
  }
}

/** `Content-Disposition` aman untuk nama non-ASCII (RFC 6266/5987) dan tanpa karakter yang memecah header. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** P08 · Dokumen pasien: unggah, daftar, detail, unduh (hash dicek), batal beralasan, minta TTE. */
@ApiTags('documents (P08)')
@TenantScoped()
@RequireModule('P08')
@Controller()
export class DocumentsController {
  private readonly log = new Logger(DocumentsController.name);

  constructor(private readonly docs: DocumentsService) {}

  /**
   * Body = isi berkas (`application/octet-stream`, dibaca middleware `rawUpload` sebelum transaksi dibuka).
   * Metadata lewat header `X-Document-Kind`, `X-Document-Title`, `X-Document-Filename`.
   */
  @RequirePermission('documents', 'write')
  @Post('patients/:patientId/documents')
  @Audited({
    action: 'create',
    resource: 'document',
    resourceId: resultId,
    patientId: param('patientId'),
    details: ({ result }) => ({ kind: (result as { kind?: string } | undefined)?.kind }),
  })
  upload(@Param('patientId', uuid) patientId: string, @Req() req: Request) {
    if (!Buffer.isBuffer(req.body)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Kirim isi berkas sebagai application/octet-stream', 415);
    }
    const meta = uploadDocumentSchema.safeParse({
      kind: header(req, 'x-document-kind'),
      title: header(req, 'x-document-title'),
    });
    if (!meta.success) {
      throw new AppError('VALIDATION_FAILED', meta.error.issues[0]?.message ?? 'Metadata tidak valid', 400);
    }
    // Resume dan persetujuan hanya terbit dari alur klinis (PDF server + TTE; gambar tanda tangan persetujuan lewat
    // modul consent), tidak lewat unggahan generik yang kemudian bisa dimintakan TTE.
    if (meta.data.kind === 'resume' || meta.data.kind === 'consent') {
      throw new AppError(
        'VALIDATION_FAILED',
        'Resume dan persetujuan tindakan diterbitkan dari layarnya, tidak diunggah',
        422,
      );
    }
    const fileName = header(req, 'x-document-filename') || meta.data.title;
    return this.docs.upload(patientId, { ...meta.data, fileName }, req.body);
  }

  @RequirePermission('documents', 'read')
  @Get('patients/:patientId/documents')
  @Audited({ action: 'read', resource: 'document', patientId: param('patientId') })
  list(@Param('patientId', uuid) patientId: string) {
    return this.docs.listForPatient(patientId);
  }

  @RequirePermission('documents', 'read')
  @Get('documents/:id')
  @Audited({ action: 'read', resource: 'document', resourceId: param('id'), patientId: resultPatient })
  get(@Param('id', uuid) id: string) {
    return this.docs.get(id);
  }

  /**
   * Isi berkas di-stream dari penyimpanan; pembukaan diaudit di service (dengan pasien). Selalu sebagai lampiran,
   * tidak dirender. Galat di tengah stream (mis. hash tidak cocok di akhir) memutus koneksi, sehingga klien tidak
   * pernah menerima berkas yang tampak utuh (`Content-Length` tidak terpenuhi).
   */
  @RequirePermission('documents', 'read')
  @Get('documents/:id/content')
  async content(@Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response) {
    const { doc, body } = await this.docs.content(id);
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': contentDisposition(doc.fileName),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    // Klien memutus di tengah unduhan → lepas koneksi ke penyimpanan segera (tidak menunggu batas waktu soket).
    res.once('close', () => body.destroy());
    return new StreamableFile(body, { type: doc.mimeType, length: doc.sizeBytes })
      .setErrorLogger((err) =>
        this.log.error({ documentId: doc.id, error: err.name }, 'Unduhan berkas dokumen terputus'),
      )
      .setErrorHandler((_err, out) => {
        const r = out as unknown as Response;
        if (r.headersSent) r.destroy();
        else r.status(500).json({ code: 'DOCUMENT_INTEGRITY', message: 'Unduhan berkas dokumen gagal' });
      });
  }

  @RequirePermission('documents', 'write')
  @Post('documents/:id/void')
  @HttpCode(200)
  void(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(voidDocumentSchema)) body: z.infer<typeof voidDocumentSchema>,
  ) {
    return this.docs.void(id, body.reason);
  }

  @RequirePermission('documents', 'write')
  @Post('documents/:id/signatures')
  requestSignature(@Param('id', uuid) id: string) {
    return this.docs.requestSignature(id);
  }
}

/** P08 · Verifikasi publik tanda tangan dari QR (tanpa login, tanpa PHI). */
@ApiTags('documents (P08)')
@Controller('verification')
export class SignatureVerificationController {
  constructor(private readonly verification: SignatureVerificationService) {}

  @Get('signatures/:code')
  verify(
    @Param(
      'code',
      new ZodValidationPipe(z.string().regex(VERIFY_CODE_PATTERN, 'Kode verifikasi tidak dikenal')),
    )
    code: string,
  ) {
    return this.verification.verify(code);
  }
}
