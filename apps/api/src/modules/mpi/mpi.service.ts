import { Inject, Injectable } from '@nestjs/common';
import { insertPatient, lockMpi, lockTenantScope, type Prisma, toDbDate } from '@simrs/db';
import {
  AppError,
  type CreatePatientInput,
  IDENTIFIER_SYSTEM_CODES,
  IDENTIFIER_SYSTEMS,
  type IdentifierSystem,
  type IdentifierVerification,
  isValidIdentifier,
  maskIdentifier,
  maskPhone,
  normalizeIdentifier,
  normalizePersonName,
  parsePatientQuery,
  type PatientSearchQuery,
  type PatientSex,
  type PatientStatus,
  phoneForDisplay,
  type RevealableField,
  type SetIdentifierInput,
  type UpdatePatientInput,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { API_ENV, type ApiEnv } from '../../config/env';
import { TenantDb } from '../../infra/tenant-db';
import { DuplicateDetector } from './duplicate-detector';
import { PatientAccessService } from '../authz/patient-access.service';
import { MpiRepository, type PatientRow } from './mpi.repository';

export interface IdentifierView {
  system: IdentifierSystem;
  /** Selalu tersamar (docs/05 §3); nilai utuh lewat `reveal` yang diaudit. */
  masked: string;
  verification: IdentifierVerification;
  verifiedAt: string | null;
}

export interface PatientSummary {
  id: string;
  mrn: string;
  name: string;
  sex: PatientSex;
  birthDate: string | null;
  birthDateEstimated: boolean;
  unidentified: boolean;
  status: PatientStatus;
  mergedInto: { id: string; mrn: string } | null;
  identifiers: IdentifierView[];
}

export interface PatientDetail extends PatientSummary {
  motherName: string | null;
  address: string | null;
  phoneMasked: string | null;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * P05 · Master Patient Index: cari, baca, daftar, ubah identitas pasien.
 * - Setiap pasien yang tampil (hasil cari maupun detail) tercatat di audit dengan `patientId` (MRMIK, docs/05).
 * - Lingkup izin bukan `all` → hanya pasien berelasi atau dengan akses darurat aktif; penolakan diaudit.
 * - Identifier dan kontak terenkripsi; respons hanya memuat bentuk tersamar kecuali `reveal`.
 */
@Injectable()
export class MpiService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly repo: MpiRepository,
    private readonly access: PatientAccessService,
    private readonly detector: DuplicateDetector,
  ) {}

  private crypto(): PatientCrypto {
    return new PatientCrypto(
      { encKeyB64: this.env.FIELD_ENCRYPTION_KEY, hashKeyB64: this.env.FIELD_HASH_KEY },
      this.db.tenantId(),
    );
  }

  /** Pelaku berlingkup relasi/unit hanya boleh pasien berelasi atau dengan akses darurat (P03). */
  private async assertAccess(patientId: string): Promise<void> {
    if (this.db.permissionScope() !== 'all') await this.access.assert(patientId);
  }

  private async load(id: string): Promise<PatientRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    return row;
  }

  private assertActive(row: PatientRow): void {
    if (row.status === 'merged') {
      throw new AppError(
        'CONFLICT',
        `Rekam medis ini sudah digabung ke RM ${row.mergedInto?.mrn ?? '-'}; ubah data di rekam medis tersebut`,
        409,
        { mergedInto: row.mergedInto },
      );
    }
  }

  async search(q: PatientSearchQuery): Promise<{ by: string; items: PatientSummary[] }> {
    const parsed = parsePatientQuery(q.q);
    if (!parsed) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Ketik nomor RM (8 digit), NIK (16 digit), no. BPJS (13 digit), IHS, atau nama pasien',
        400,
      );
    }
    const crypto = this.crypto();
    const userId = this.db.actorUserId();
    const scopeAll = this.db.permissionScope() === 'all';
    if (!scopeAll && !userId) throw new AppError('UNAUTHENTICATED', 'Belum login', 401);
    const onlyFor = scopeAll ? null : userId;
    const birthDate = q.birthDate ? toDbDate(q.birthDate) : undefined;

    let ids: string[];
    if (parsed.kind === 'name') {
      ids = await this.repo.idsByName(parsed.value, { birthDate, limit: q.limit, onlyFor });
    } else {
      ids =
        parsed.kind === 'mrn'
          ? await this.repo.idsByMrn(parsed.value)
          : await this.repo.idsByIdentifier(
              parsed.kind,
              crypto.identifierHash(parsed.kind, parsed.value),
              q.limit,
            );
      if (onlyFor) ids = await this.repo.accessibleAmong(ids, onlyFor);
    }
    const listed = await this.repo.listByIds(ids, parsed.kind === 'name' ? undefined : birthDate);
    // Rekam medis yang sudah digabung tidak ditampilkan bila rekam medis tujuannya ikut tampil.
    const shown = new Set(listed.map((r) => r.id));
    const rows = listed.filter((r) => !(r.mergedInto && shown.has(r.mergedInto.id)));
    for (const r of rows) {
      // Teks pencarian tidak dicatat (bisa berisi NIK/nama); cukup jenisnya.
      this.db.audit({
        action: 'search',
        resourceType: 'patient',
        resourceId: r.id,
        patientId: r.id,
        details: { by: parsed.kind },
      });
    }
    return { by: parsed.kind, items: rows.map((r) => this.summary(r, crypto)) };
  }

  async get(id: string): Promise<PatientDetail> {
    await this.assertAccess(id);
    return this.detail(await this.load(id), this.crypto());
  }

  async create(input: CreatePatientInput): Promise<PatientDetail> {
    // Kunci MPI dulu (urutan kunci sama di semua alur yang menulis antrean duplikat → tanpa deadlock).
    await lockMpi(this.db.tx());
    const crypto = this.crypto();
    await this.assertIdentifiersFree(crypto, input.identifiers);
    const { id } = await insertPatient(this.db.tx(), crypto, { ...input, createdBy: this.db.actorUserId() });
    await this.detector.run(crypto, id);
    return this.detail(await this.load(id), crypto);
  }

  async update(id: string, input: UpdatePatientInput): Promise<PatientDetail> {
    await this.assertAccess(id);
    await lockMpi(this.db.tx());
    const row = await this.load(id);
    this.assertActive(row);
    const unidentified = input.unidentified ?? row.unidentified;
    const birthDate = input.birthDate === undefined ? row.birthDate : input.birthDate;
    if (!unidentified && !birthDate) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Tanggal lahir wajib diisi (kecuali pasien tanpa identitas)',
        400,
      );
    }
    const crypto = this.crypto();
    const data: Prisma.PatientUpdateInput = {};
    if (input.name !== undefined) {
      data.name = input.name;
      data.nameSearch = normalizePersonName(input.name);
    }
    if (input.sex !== undefined) data.sex = input.sex;
    if (input.birthDate !== undefined) data.birthDate = input.birthDate ? toDbDate(input.birthDate) : null;
    if (input.birthDateEstimated !== undefined) data.birthDateEstimated = input.birthDateEstimated;
    if (input.motherName !== undefined) data.motherName = input.motherName;
    if (input.address !== undefined)
      data.addressEnc = input.address ? crypto.encryptContact(input.address) : null;
    if (input.phone !== undefined) {
      data.phoneEnc = input.phone ? crypto.encryptContact(input.phone) : null;
      data.phoneHash = input.phone ? crypto.phoneHash(input.phone) : null;
    }
    if (input.unidentified !== undefined) data.unidentified = input.unidentified;
    const updated = await this.repo.update(id, data);
    await this.detector.run(crypto, id);
    return this.detail(updated, crypto);
  }

  /** Isi atau ganti satu identifier. Nilai lama tidak dihapus: dinonaktifkan dengan alasan. */
  async setIdentifier(
    id: string,
    system: IdentifierSystem,
    input: SetIdentifierInput,
  ): Promise<PatientDetail> {
    const value = normalizeIdentifier(input.value);
    if (!isValidIdentifier(system, value)) {
      throw new AppError('VALIDATION_FAILED', IDENTIFIER_SYSTEMS[system].hint, 400);
    }
    await this.assertAccess(id);
    await lockMpi(this.db.tx());
    const row = await this.load(id);
    this.assertActive(row);
    const crypto = this.crypto();
    const current = row.identifiers.find((i) => i.system === system);
    if (current?.valueHash === crypto.identifierHash(system, value)) return this.detail(row, crypto);
    if (current && !input.reason) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Alasan wajib diisi saat mengganti ${IDENTIFIER_SYSTEMS[system].label}`,
        400,
      );
    }
    await this.assertIdentifiersFree(crypto, { [system]: value }, id);
    if (current && input.reason) await this.repo.deactivateIdentifier(current.id, input.reason);
    const created = await this.repo.insertIdentifier(id, system, crypto.encryptIdentifier(system, value));
    this.db.audit({
      action: 'update',
      resourceType: 'patient_identifier',
      resourceId: created.id,
      patientId: id,
      reason: input.reason ?? null,
      details: { system, replaced: Boolean(current) },
    });
    await this.detector.run(crypto, id);
    return this.detail(await this.load(id), crypto);
  }

  /** Nilai utuh satu identitas (izin `patient.identity`); setiap pembukaan diaudit. */
  async reveal(id: string, field: RevealableField): Promise<{ field: RevealableField; value: string }> {
    await this.assertAccess(id);
    const row = await this.load(id);
    const crypto = this.crypto();
    const ident = field === 'phone' ? undefined : row.identifiers.find((i) => i.system === field);
    const value =
      field === 'phone'
        ? row.phoneEnc && phoneForDisplay(crypto.decryptContact(row.phoneEnc))
        : ident && crypto.decryptIdentifier(ident.valueEnc);
    if (!value) throw new AppError('NOT_FOUND', 'Data ini belum tercatat untuk pasien tersebut', 404);
    this.db.audit({
      action: 'read',
      resourceType: field === 'phone' ? 'patient_contact' : 'patient_identifier',
      resourceId: id,
      patientId: id,
      details: { field, reveal: true },
    });
    return { field, value };
  }

  /**
   * Cegah rekam medis ganda baru: nilai identifier yang sudah aktif di pasien lain → 409 berisi RM pemiliknya.
   * Dikunci per nilai (advisory lock) agar dua pendaftaran serentak dengan NIK sama tidak sama-sama lolos.
   */
  private async assertIdentifiersFree(
    crypto: PatientCrypto,
    identifiers: Partial<Record<IdentifierSystem, string>>,
    exceptPatientId?: string,
  ): Promise<void> {
    for (const system of IDENTIFIER_SYSTEM_CODES) {
      const value = identifiers[system];
      if (!value) continue;
      const hash = crypto.identifierHash(system, value);
      await lockTenantScope(this.db.tx(), `patient-identifier:${system}:${hash}`);
      const owner = await this.repo.findIdentifierOwner(system, hash, exceptPatientId);
      if (owner) {
        throw new AppError(
          'CONFLICT',
          `${IDENTIFIER_SYSTEMS[system].label} sudah terdaftar pada rekam medis ${owner.mrn}`,
          409,
          { system, patientId: owner.id, mrn: owner.mrn },
        );
      }
    }
  }

  private identifiers(row: PatientRow, crypto: PatientCrypto): IdentifierView[] {
    return row.identifiers.map((i) => {
      const system = i.system as IdentifierSystem;
      return {
        system,
        masked: maskIdentifier(system, crypto.decryptIdentifier(i.valueEnc)),
        verification: i.verificationStatus as IdentifierVerification,
        verifiedAt: i.verifiedAt?.toISOString() ?? null,
      };
    });
  }

  private summary(row: PatientRow, crypto: PatientCrypto): PatientSummary {
    return {
      id: row.id,
      mrn: row.mrn,
      name: row.name,
      sex: row.sex as PatientSex,
      birthDate: row.birthDate ? isoDate(row.birthDate) : null,
      birthDateEstimated: row.birthDateEstimated,
      unidentified: row.unidentified,
      status: row.status as PatientStatus,
      mergedInto: row.mergedInto,
      identifiers: this.identifiers(row, crypto),
    };
  }

  private detail(row: PatientRow, crypto: PatientCrypto): PatientDetail {
    return {
      ...this.summary(row, crypto),
      motherName: row.motherName,
      address: row.addressEnc ? crypto.decryptContact(row.addressEnc) : null,
      phoneMasked: row.phoneEnc ? maskPhone(crypto.decryptContact(row.phoneEnc)) : null,
      mergedAt: row.mergedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
