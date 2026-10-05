import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  type ContactRelation,
  maskPhone,
  type PatientContact,
  type PatientContactInput,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { API_ENV, type ApiEnv } from '../../config/env';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { RegistrationRepository } from './registration.repository';

type ContactRow = {
  id: string;
  relation: string;
  nameEnc: string;
  phoneEnc: string | null;
  isGuarantor: boolean;
  status: string;
};

/**
 * Kontak/penanggung jawab pasien (`patient_contacts`, append-only; nama, no. HP, alamat terenkripsi). Respons hanya
 * memuat no. HP tersamar. Tiap baca/tambah diaudit dengan pasiennya (oleh controller).
 */
@Injectable()
export class ContactsService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly repo: RegistrationRepository,
    private readonly access: PatientAccessService,
  ) {}

  private crypto(): PatientCrypto {
    return new PatientCrypto(this.env.fieldKeys, this.db.tenantId());
  }

  async list(patientId: string): Promise<PatientContact[]> {
    await this.assertPatient(patientId);
    return (await this.repo.activeContacts(patientId)).map((c) => this.present(c));
  }

  async create(patientId: string, input: PatientContactInput): Promise<PatientContact> {
    await this.assertPatient(patientId, { active: true });
    return this.present(await this.insert(patientId, input));
  }

  /** Penanggung jawab saat registrasi: kontak aktif milik pasien atau kontak baru. */
  async resolveGuarantor(
    patientId: string,
    input: { contactId: string } | PatientContactInput,
  ): Promise<string> {
    if ('contactId' in input) {
      const c = await this.repo.findContact(input.contactId);
      if (!c || c.patientId !== patientId || c.status !== 'active' || c._count.supersededBy > 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Kontak penanggung jawab tidak ditemukan pada pasien ini',
          422,
        );
      }
      return c.id;
    }
    return (await this.insert(patientId, input)).id;
  }

  private insert(patientId: string, input: PatientContactInput) {
    const crypto = this.crypto();
    return this.repo.createContact({
      patientId,
      relation: input.relation,
      nameEnc: crypto.encryptContact(input.name),
      phoneEnc: input.phone ? crypto.encryptContact(input.phone) : null,
      addressEnc: input.address ? crypto.encryptContact(input.address) : null,
      isGuarantor: input.isGuarantor,
    });
  }

  private async assertPatient(patientId: string, opts: { active?: boolean } = {}): Promise<void> {
    const p = await this.repo.findPatient(patientId);
    if (!p) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (opts.active && p.status !== 'active') {
      throw new AppError('CONFLICT', 'Rekam medis ini sudah digabung; pakai rekam medis tujuan', 409, {
        mergedInto: p.mergedIntoId,
      });
    }
    if (this.db.permissionScope() !== 'all') await this.access.assert(patientId);
  }

  private present(c: ContactRow): PatientContact {
    const crypto = this.crypto();
    return {
      id: c.id,
      name: crypto.decryptContact(c.nameEnc),
      relation: c.relation as ContactRelation,
      phoneMasked: c.phoneEnc ? maskPhone(crypto.decryptContact(c.phoneEnc)) : null,
      isGuarantor: c.isGuarantor,
      active: c.status === 'active',
    };
  }
}
