import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { enqueueOutbox } from '@simrs/db';
import {
  AppError,
  type DocumentKind,
  detectDocumentType,
  newId,
  sanitizeFileName,
  TTE_SIGN_OPERATION,
  type UploadDocumentInput,
  verifyPath,
} from '@simrs/shared';
import { newVerifyCode, sha256Hex } from '@simrs/shared/node';
import { API_ENV, type ApiEnv } from '../../config/env';
import {
  documentStorageKey,
  OBJECT_STORAGE,
  type ObjectStorage,
  StorageIntegrityError,
  type StoredObject,
  verifiedContent,
} from '../../infra/object-storage';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { type DocumentRow, DocumentsRepository } from './documents.repository';

export interface DocumentView {
  id: string;
  patientId: string;
  kind: DocumentKind;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  createdBy: string | null;
  voided: { at: string; by: string | null; reason: string | null } | null;
  signatures: Array<{
    id: string;
    signer: string | null;
    status: string;
    requestedAt: string;
    signedAt: string | null;
    certificate: string | null;
    verifyUrl: string;
  }>;
}

/**
 * P08 · Dokumen pasien. Berkas dikenali dari isinya (PDF/PNG/JPEG), disimpan dengan kunci acak, hash SHA-256
 * dicatat dan dicocokkan lagi setiap kali dibuka. Akses mengikuti ABAC pasien (kelompok rekam medis gabungan),
 * semua baca/ubah diaudit. Tanda tangan dimintakan ke penyelenggara TTE lewat outbox (ADR-0020).
 */
@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly repo: DocumentsRepository,
    private readonly access: PatientAccessService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private async assertAccess(patientId: string): Promise<void> {
    if (this.db.permissionScope() !== 'all') await this.access.assert(patientId);
  }

  private async load(id: string): Promise<DocumentRow> {
    const row = await this.repo.find(id);
    if (!row) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan', 404);
    return row;
  }

  async upload(
    patientId: string,
    meta: UploadDocumentInput & { fileName: string },
    bytes: Buffer,
  ): Promise<DocumentView> {
    await this.assertAccess(patientId);
    const patient = await this.repo.findPatient(patientId);
    if (!patient) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (patient.status === 'merged') {
      throw new AppError(
        'CONFLICT',
        `Rekam medis ini sudah digabung ke RM ${patient.mergedInto?.mrn ?? '-'}; unggah di rekam medis tersebut`,
        409,
      );
    }
    if (bytes.length === 0) throw new AppError('VALIDATION_FAILED', 'Berkas kosong', 400);
    const mime = detectDocumentType(bytes);
    if (!mime) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Hanya berkas PDF, PNG, atau JPEG yang diterima', 415);
    }
    const id = newId();
    const storageKey = documentStorageKey(this.db.tenantId(), id);
    const sha256 = sha256Hex(bytes);
    // Berkas ditulis lebih dulu: bila transaksi batal, yang tersisa hanya berkas yatim tanpa metadata (aman,
    // dibersihkan job terjadwal), tidak pernah metadata tanpa berkas. Driver s3 memverifikasi hash di server.
    await this.storage.put(storageKey, bytes, sha256);
    const row = await this.repo.create({
      id,
      patientId,
      kind: meta.kind,
      title: meta.title,
      fileName: sanitizeFileName(meta.fileName, mime),
      mimeType: mime,
      sizeBytes: bytes.length,
      sha256,
      storageKey,
    });
    return (await this.presentWithNames([row]))[0] as DocumentView;
  }

  async listForPatient(patientId: string): Promise<DocumentView[]> {
    await this.assertAccess(patientId);
    return this.presentWithNames(await this.repo.listForPatients(await this.repo.patientGroup(patientId)));
  }

  async get(id: string): Promise<DocumentView> {
    const row = await this.load(id);
    await this.assertAccess(row.patientId);
    return (await this.presentWithNames([row]))[0] as DocumentView;
  }

  /**
   * Isi berkas sebagai stream; hash dan ukuran dicocokkan dengan DB (berkas yang berubah di penyimpanan tidak
   * pernah diserahkan, lihat `verifiedContent`).
   */
  async content(id: string): Promise<{ doc: DocumentRow; body: Readable }> {
    const doc = await this.load(id);
    await this.assertAccess(doc.patientId);
    let stored: StoredObject;
    try {
      stored = await this.storage.open(doc.storageKey);
    } catch {
      this.log.error({ documentId: doc.id }, 'Berkas dokumen tidak ada di penyimpanan');
      throw new AppError('DOCUMENT_INTEGRITY', 'Berkas dokumen tidak ditemukan di penyimpanan', 500);
    }
    let body: Readable;
    try {
      body = await verifiedContent(stored, { sha256: doc.sha256, size: doc.sizeBytes });
    } catch (err) {
      if (!(err instanceof StorageIntegrityError)) throw err;
      this.log.error({ documentId: doc.id }, 'Hash berkas dokumen tidak cocok');
      throw new AppError(
        'DOCUMENT_INTEGRITY',
        'Isi berkas tidak cocok dengan hash tersimpan; dokumen ditahan untuk diperiksa',
        500,
      );
    }
    this.db.audit({
      action: 'read',
      resourceType: 'document',
      resourceId: doc.id,
      patientId: doc.patientId,
      details: { content: true, kind: doc.kind },
    });
    return { doc, body };
  }

  async void(id: string, reason: string): Promise<DocumentView> {
    await this.repo.lock(id);
    const doc = await this.load(id);
    await this.assertAccess(doc.patientId);
    if (doc.voidedAt) throw new AppError('CONFLICT', 'Dokumen sudah dibatalkan', 409);
    if (doc.signatures.length > 0) {
      throw new AppError('CONFLICT', 'Dokumen yang ditandatangani tidak bisa dibatalkan; buat addendum', 409);
    }
    const row = await this.repo.void(id, reason);
    this.db.audit({
      action: 'deactivate',
      resourceType: 'document',
      resourceId: id,
      patientId: row.patientId,
      reason,
      details: { kind: row.kind },
    });
    return (await this.presentWithNames([row]))[0] as DocumentView;
  }

  /** Minta TTE atas hash dokumen: dicatat `pending`, dikirim worker ke penyelenggara TTE setelah commit. */
  async requestSignature(id: string): Promise<DocumentView> {
    await this.repo.lock(id);
    const doc = await this.load(id);
    await this.assertAccess(doc.patientId);
    if (doc.voidedAt) throw new AppError('CONFLICT', 'Dokumen batal tidak bisa ditandatangani', 409);
    const me = this.db.actorUserId();
    if (doc.signatures.some((s) => s.signerUserId === me)) {
      throw new AppError(
        'CONFLICT',
        'Anda sudah menandatangani (atau sedang menandatangani) dokumen ini',
        409,
      );
    }
    await this.recordSignatureRequest(doc, newVerifyCode(this.db.tenantId()));
    return this.get(doc.id);
  }

  /**
   * Catat permintaan TTE pengguna sesi atas hash dokumen (`pending`) + pesan outbox `tte.sign` (ID saja) + audit, di
   * transaksi permintaan. Pemanggil sudah memeriksa akses, status dokumen, dan izin tanda tangan. `verifyCode` dibuat
   * pemanggil: PDF klinis mencetak QR-nya sebelum hash dihitung (ADR-0029).
   */
  async recordSignatureRequest(
    doc: Pick<DocumentRow, 'id' | 'sha256' | 'patientId'>,
    verifyCode: string,
  ): Promise<string> {
    const signatureId = newId();
    await this.repo.createSignature({
      id: signatureId,
      documentId: doc.id,
      documentSha256: doc.sha256,
      verifyCode,
    });
    await enqueueOutbox(this.db.tx(), this.db.tenantId(), {
      target: 'tte',
      operation: TTE_SIGN_OPERATION,
      idempotencyKey: `tte-sign:${signatureId}`,
      payload: { signatureId },
    });
    this.db.audit({
      action: 'sign',
      resourceType: 'document',
      resourceId: doc.id,
      patientId: doc.patientId,
      details: { status: 'requested', signatureId },
    });
    return signatureId;
  }

  /** URL verifikasi publik untuk kode QR (`/verifikasi/<kode>` di web). */
  verifyUrl(verifyCode: string): string {
    return new URL(verifyPath(verifyCode), this.env.WEB_BASE_URL).toString();
  }

  /** Tampilan satu dokumen (dengan nama pengguna) untuk pemanggil di modul lain. */
  async view(row: DocumentRow): Promise<DocumentView> {
    return (await this.presentWithNames([row]))[0] as DocumentView;
  }

  private async presentWithNames(rows: DocumentRow[]): Promise<DocumentView[]> {
    const names = await this.repo.userNames(
      rows.flatMap((r) => [r.createdBy, r.voidedBy, ...r.signatures.map((s) => s.signerUserId)]),
    );
    return this.present(rows, names);
  }

  private present(rows: DocumentRow[], names: Map<string, string> = new Map()): DocumentView[] {
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      kind: r.kind as DocumentKind,
      title: r.title,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      createdAt: r.createdAt.toISOString(),
      createdBy: name(r.createdBy),
      voided: r.voidedAt
        ? { at: r.voidedAt.toISOString(), by: name(r.voidedBy), reason: r.voidReason }
        : null,
      signatures: r.signatures.map((s) => ({
        id: s.id,
        signer: name(s.signerUserId),
        status: s.status,
        requestedAt: s.requestedAt.toISOString(),
        signedAt: s.signedAt?.toISOString() ?? null,
        certificate: s.certificate,
        verifyUrl: this.verifyUrl(s.verifyCode),
      })),
    }));
  }
}
