import { Inject, Injectable } from '@nestjs/common';
import { type ClinicalPdfContent, type ClinicalPdfInput, renderClinicalPdf } from '@simrs/pdf';
import { AppError, type DocumentKind, newId, sanitizeFileName } from '@simrs/shared';
import { newVerifyCode, sha256Hex } from '@simrs/shared/node';
import { documentStorageKey, OBJECT_STORAGE, type ObjectStorage } from '../../infra/object-storage';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { DocumentsRepository } from './documents.repository';
import { type DocumentView, DocumentsService } from './documents.service';

export interface IssueClinicalPdfInput {
  patientId: string;
  kind: DocumentKind;
  title: string;
  /** Nama berkas tampilan tanpa ekstensi (disaring; ekstensi `.pdf`). */
  fileName: string;
  /** Nomor dokumen dari layanan penomoran, bila ada. */
  number?: string | null;
  /**
   * Entri klinis asal (nama tabel + id versi, mis. `discharge_summaries`). Dokumen ber-TTE mengunci versi itu: trigger
   * `app_clinical_guard` menolak menggantikannya (`RECORD_LOCKED`), perubahan lewat addendum.
   */
  source?: { table: string; id: string } | null;
  /** Waktu terbit = waktu final rekaman klinisnya (bukan jam render), agar PDF bisa dibangun ulang sama persis. */
  issuedAt: Date;
  /** Baris identitas tambahan (kunjungan, ruang, penjamin, DPJP). */
  patientExtra?: ClinicalPdfContent['patient']['extra'];
  sections: ClinicalPdfInput['sections'];
  /**
   * TTE tersertifikasi oleh pengguna sesi (mis. DPJP saat finalisasi resume). Null = dokumen tanpa TTE. Izin tanda
   * tangan (`clinical.sign`, `consent.sign`) diperiksa endpoint pemanggil.
   */
  tte?: { role: string; caption?: string | null } | null;
  /**
   * Pemanggil sudah memeriksa akses pasien dengan aturannya sendiri (tampilan layanan penunjang: order yang ditujukan ke
   * unitnya, ADR-0120). Selain itu ABAC pasien diperiksa di sini.
   */
  accessChecked?: boolean;
  /** Penanda tangan tanpa TTE (pasien, wali, saksi), dicetak dengan garis tanda tangan. */
  otherSigners?: Array<{ role: string; name: string; caption?: string | null }>;
}

export interface IssuedClinicalPdf {
  document: DocumentView;
  /** ID permintaan TTE (`document_signatures`), null bila tanpa TTE. */
  signatureId: string | null;
}

/**
 * P12 minimal (ADR-0029) · Terbitkan dokumen klinis sebagai PDF deterministik (`@simrs/pdf`) di atas alur dokumen P08
 * (ADR-0020): render → simpan berkas (hash SHA-256) → baris `documents` → bila diminta, `document_signatures`
 * `pending` + outbox `tte.sign` yang dikirim worker ke penyelenggara TTE; kegagalan permanen ditandai `failed` oleh
 * `onDead`. Dipanggil modul klinis (resume, persetujuan, resep) di transaksi permintaannya; identitas pasien dan kop
 * dibaca dari basis data, bukan dari klien.
 */
@Injectable()
export class ClinicalPdfService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: DocumentsRepository,
    private readonly docs: DocumentsService,
    private readonly access: PatientAccessService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async issue(input: IssueClinicalPdfInput): Promise<IssuedClinicalPdf> {
    if (this.db.permissionScope() !== 'all' && !input.accessChecked)
      await this.access.assert(input.patientId);
    const patient = await this.repo.patientIdentity(input.patientId);
    if (!patient) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (patient.status === 'merged') {
      throw new AppError(
        'CONFLICT',
        `Rekam medis ini sudah digabung ke RM ${patient.mergedInto?.mrn ?? '-'}; terbitkan di rekam medis tersebut`,
        409,
      );
    }
    const signerId = input.tte ? this.db.actorUserId() : null;
    if (input.tte && !signerId) throw new AppError('FORBIDDEN', 'TTE wajib oleh pengguna yang login', 403);

    const [head, signerName] = await Promise.all([
      this.repo.letterhead(),
      signerId ? this.repo.userNames([signerId]).then((m) => m.get(signerId) ?? null) : null,
    ]);
    // Kode verifikasi dibuat sebelum render: QR-nya ikut ditandatangani (hash mencakup QR).
    const verifyCode = input.tte ? newVerifyCode(this.db.tenantId()) : null;
    const bytes = Buffer.from(
      await renderClinicalPdf({
        hospital: {
          name: head.name,
          unit: head.facility && head.facility.name !== head.name ? head.facility.name : null,
          address: head.facility?.address ?? null,
        },
        document: {
          title: input.title,
          number: input.number ?? null,
          issuedAt: input.issuedAt.toISOString(),
        },
        patient: {
          name: patient.name,
          mrn: patient.mrn,
          birthDate: patient.birthDate ? patient.birthDate.toISOString().slice(0, 10) : null,
          sex: patient.sex === 'male' || patient.sex === 'female' ? patient.sex : 'unknown',
          extra: input.patientExtra ?? [],
        },
        sections: input.sections,
        signatures: [
          ...(input.tte && verifyCode
            ? [
                {
                  role: input.tte.role,
                  name: signerName ?? 'Penanda tangan',
                  caption: input.tte.caption ?? null,
                  verifyUrl: this.docs.verifyUrl(verifyCode),
                },
              ]
            : []),
          ...(input.otherSigners ?? []),
        ],
      }),
    );

    const id = newId();
    const storageKey = documentStorageKey(this.db.tenantId(), id);
    const sha256 = sha256Hex(bytes);
    // Berkas sebelum metadata (ADR-0020 butir 4).
    await this.storage.put(storageKey, bytes, sha256);
    const row = await this.repo.create({
      id,
      patientId: input.patientId,
      kind: input.kind,
      title: input.title,
      fileName: sanitizeFileName(input.fileName, 'application/pdf'),
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256,
      storageKey,
      sourceType: input.source?.table ?? null,
      sourceId: input.source?.id ?? null,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'document',
      resourceId: id,
      patientId: input.patientId,
      details: { kind: input.kind, generated: 'clinical_pdf' },
    });
    const signatureId = verifyCode ? await this.docs.recordSignatureRequest(row, verifyCode) : null;
    const fresh = await this.repo.find(id);
    return { document: await this.docs.view(fresh ?? row), signatureId };
  }
}
