import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';

/** Akses data tenant. Satu-satunya lapisan yang menyentuh Prisma; selalu lewat `forTenant` (RLS). */
@Injectable()
export class TenancyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCurrent(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
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
      }),
    );
  }
}
