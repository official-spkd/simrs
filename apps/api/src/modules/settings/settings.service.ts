import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import {
  AppError,
  COMPONENTS,
  CORE_MODULES,
  defaultModuleEnabled,
  isComponentCode,
  isTenantSettingKey,
  parseTenantSetting,
  TENANT_SETTINGS,
  type TenantSettingKey,
  type TenantSettingValue,
} from '@simrs/shared';
import { SettingsRepository } from './settings.repository';

export interface SettingView {
  key: TenantSettingKey;
  label: string;
  value: unknown;
  isDefault: boolean;
  updatedAt: string | null;
}

/** P12 · Pengaturan per RS dan P10 · modul aktif. */
@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  /** Nilai efektif: tersimpan bila ada dan masih valid terhadap skema saat ini, selain itu bawaan. */
  async get<K extends TenantSettingKey>(key: K): Promise<TenantSettingValue<K>> {
    const row = await this.repo.findSetting(key);
    const parsed = row ? TENANT_SETTINGS[key].schema.safeParse(row.value) : undefined;
    return (parsed?.success ? parsed.data : TENANT_SETTINGS[key].default) as TenantSettingValue<K>;
  }

  async list(): Promise<SettingView[]> {
    const stored = new Map((await this.repo.listSettings()).map((r) => [r.key, r]));
    return (Object.keys(TENANT_SETTINGS) as TenantSettingKey[]).map((key) => {
      const row = stored.get(key);
      const parsed = row ? TENANT_SETTINGS[key].schema.safeParse(row.value) : undefined;
      return {
        key,
        label: TENANT_SETTINGS[key].label,
        value: parsed?.success ? parsed.data : TENANT_SETTINGS[key].default,
        isDefault: !parsed?.success,
        updatedAt: parsed?.success && row ? row.updatedAt.toISOString() : null,
      };
    });
  }

  async set(key: string, value: unknown): Promise<SettingView> {
    if (!isTenantSettingKey(key)) throw new AppError('NOT_FOUND', 'Pengaturan tidak dikenal', 404);
    const parsed = parseTenantSetting(key, value);
    const row = await this.repo.upsertSetting(key, parsed as Prisma.InputJsonValue);
    return {
      key,
      label: TENANT_SETTINGS[key].label,
      value: row.value,
      isDefault: false,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listModules() {
    const stored = new Map((await this.repo.listModules()).map((r) => [r.moduleCode, r]));
    return Object.entries(COMPONENTS).map(([code, c]) => {
      const row = stored.get(code);
      return {
        code,
        name: c.name,
        layer: c.layer,
        stage: c.stage,
        enabled: row?.enabled ?? defaultModuleEnabled(code as keyof typeof COMPONENTS),
        isDefault: !row,
        locked: (CORE_MODULES as readonly string[]).includes(code),
      };
    });
  }

  async setModule(code: string, enabled: boolean) {
    if (!isComponentCode(code)) throw new AppError('NOT_FOUND', 'Kode modul tidak dikenal', 404);
    if (!enabled && (CORE_MODULES as readonly string[]).includes(code)) {
      throw new AppError('CONFLICT', `Modul inti ${code} tidak bisa dimatikan`, 409);
    }
    const row = await this.repo.upsertModule(code, enabled);
    return { code: row.moduleCode, enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
  }
}
