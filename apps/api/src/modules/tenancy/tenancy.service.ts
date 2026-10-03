import { Injectable } from '@nestjs/common';
import { AppError } from '@simrs/shared';
import { TenancyRepository } from './tenancy.repository';

export interface TenantView {
  id: string;
  code: string;
  name: string;
  kemenkesCode: string | null;
  bpjsPpkCode: string | null;
  satusehatOrgId: string | null;
  hospitalClass: string | null;
  status: string;
}

@Injectable()
export class TenancyService {
  constructor(private readonly repo: TenancyRepository) {}

  /** Tenant aktif sesuai konteks. RLS menjamin hanya baris tenant itu sendiri yang terlihat. */
  async current(tenantId: string): Promise<TenantView> {
    const tenant = await this.repo.findCurrent(tenantId);
    if (!tenant) throw new AppError('NOT_FOUND', 'Tenant tidak ditemukan', 404);
    return tenant;
  }
}
