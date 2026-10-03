import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../infra/tenant-db';

/** Akses data tenant. Satu-satunya lapisan yang menyentuh Prisma; selalu lewat transaksi permintaan (RLS). */
@Injectable()
export class TenancyRepository {
  constructor(private readonly db: TenantDb) {}

  findCurrent() {
    return this.db.tx().tenant.findUnique({
      where: { id: this.db.tenantId() },
      select: {
        id: true,
        code: true,
        name: true,
        kemenkesCode: true,
        bpjsPpkCode: true,
        satusehatOrgId: true,
        hospitalClass: true,
        status: true,
      },
    });
  }
}
