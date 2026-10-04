import { Injectable } from '@nestjs/common';
import { withTenant } from '@simrs/db';
import { AppError, DOCUMENT_KINDS, type DocumentKind, parseVerifyCode } from '@simrs/shared';
import { PrismaService } from '../../infra/prisma.service';

export interface SignatureVerification {
  valid: boolean;
  status: 'pending' | 'signed';
  hospital: string;
  documentKind: string;
  documentSha256: string;
  documentVoided: boolean;
  signer: string;
  signedAt: string | null;
  certificate: string | null;
}

/**
 * P08 · Verifikasi publik tanda tangan dari QR dokumen, tanpa login. Hanya info non-PHI: RS, jenis dokumen,
 * penanda tangan, waktu, sertifikat, dan hash; judul dokumen dan identitas pasien tidak pernah ditampilkan.
 * Tenant dibaca dari kode (`sv1.<tenant>.<acak>`) dan pencarian tetap berjalan di bawah RLS tenant itu.
 */
@Injectable()
export class SignatureVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(code: string): Promise<SignatureVerification> {
    const parsed = parseVerifyCode(code);
    const notFound = new AppError('NOT_FOUND', 'Kode verifikasi tidak dikenal', 404);
    if (!parsed) throw notFound;
    const row = await withTenant(this.prisma.client, parsed.tenantId, (tx) =>
      tx.documentSignature.findUnique({
        where: { verifyCode: code },
        select: {
          status: true,
          documentSha256: true,
          signedAt: true,
          certificate: true,
          tenant: { select: { name: true } },
          signer: { select: { displayName: true } },
          document: { select: { kind: true, sha256: true, voidedAt: true } },
        },
      }),
    );
    if (!row) throw notFound;
    const status = row.status === 'signed' ? 'signed' : 'pending';
    return {
      valid: status === 'signed' && row.document.sha256 === row.documentSha256,
      status,
      hospital: row.tenant.name,
      documentKind: DOCUMENT_KINDS[row.document.kind as DocumentKind] ?? row.document.kind,
      documentSha256: row.documentSha256,
      documentVoided: row.document.voidedAt !== null,
      signer: row.signer.displayName,
      signedAt: row.signedAt?.toISOString() ?? null,
      certificate: row.certificate,
    };
  }
}
