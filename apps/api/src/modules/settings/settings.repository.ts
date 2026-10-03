import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import { TenantDb } from '../../infra/tenant-db';

@Injectable()
export class SettingsRepository {
  constructor(private readonly db: TenantDb) {}

  listSettings() {
    return this.db.tx().tenantSetting.findMany({ select: { key: true, value: true, updatedAt: true } });
  }

  findSetting(key: string) {
    return this.db.tx().tenantSetting.findFirst({ where: { key }, select: { value: true } });
  }

  upsertSetting(key: string, value: Prisma.InputJsonValue) {
    const tenantId = this.db.tenantId();
    const updatedBy = this.db.actorUserId();
    return this.db.tx().tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value, updatedBy },
      update: { value, updatedBy },
      select: { key: true, value: true, updatedAt: true },
    });
  }

  listModules() {
    return this.db
      .tx()
      .tenantModule.findMany({ select: { moduleCode: true, enabled: true, updatedAt: true } });
  }

  upsertModule(moduleCode: string, enabled: boolean) {
    const tenantId = this.db.tenantId();
    const updatedBy = this.db.actorUserId();
    return this.db.tx().tenantModule.upsert({
      where: { tenantId_moduleCode: { tenantId, moduleCode } },
      create: { tenantId, moduleCode, enabled, updatedBy },
      update: { enabled, updatedBy },
      select: { moduleCode: true, enabled: true, updatedAt: true },
    });
  }
}
