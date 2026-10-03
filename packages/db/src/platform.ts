import {
  type ComponentCode,
  defaultModuleEnabled,
  formatDocumentNumber,
  type NumberKind,
  numberPeriod,
  TENANT_SETTINGS,
  type TenantSettingKey,
  type TenantSettingValue,
} from '@simrs/shared';
import type { TenantTx } from './client';

export interface AllocatedNumber {
  kind: NumberKind;
  period: string;
  value: bigint;
  /** Nomor dokumen terformat, mis. `00-41-27-88`, `RJ-2610-000123`. */
  number: string;
}

/**
 * P08 · Alokasi nomor berikutnya secara atomik (INSERT … ON CONFLICT DO UPDATE mengunci baris urutan
 * sampai transaksi selesai). Bila transaksi batal, nomor ikut batal dan belum pernah dipakai siapa pun,
 * sehingga nomor yang sudah tersimpan tidak pernah dipakai ulang.
 */
export async function allocateNumber(
  tx: TenantTx,
  tenantId: string,
  kind: NumberKind,
  at: Date = new Date(),
): Promise<AllocatedNumber> {
  const period = numberPeriod(kind, at);
  const rows = await tx.$queryRaw<Array<{ last_value: bigint }>>`
    INSERT INTO number_sequences (tenant_id, kind, period, last_value, updated_at)
    VALUES (${tenantId}::uuid, ${kind}, ${period}, 1, now())
    ON CONFLICT (tenant_id, kind, period)
    DO UPDATE SET last_value = number_sequences.last_value + 1, updated_at = now()
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (value === undefined) throw new Error('Alokasi nomor tidak mengembalikan nilai');
  return { kind, period, value, number: formatDocumentNumber(kind, value, period) };
}

/** P10 · Modul aktif untuk tenant ini: baris tenant_modules, atau bawaan katalog bila belum diatur. */
export async function isModuleEnabled(tx: TenantTx, code: ComponentCode): Promise<boolean> {
  const row = await tx.tenantModule.findFirst({ where: { moduleCode: code }, select: { enabled: true } });
  return row?.enabled ?? defaultModuleEnabled(code);
}

/**
 * P12 · Nilai pengaturan efektif di transaksi bertenant: tersimpan bila ada dan masih lolos skema saat ini,
 * selain itu bawaan registri. Dipakai juga di luar permintaan (alur login, worker).
 */
export async function readTenantSetting<K extends TenantSettingKey>(
  tx: TenantTx,
  key: K,
): Promise<TenantSettingValue<K>> {
  const row = await tx.tenantSetting.findFirst({ where: { key }, select: { value: true } });
  const parsed = row ? TENANT_SETTINGS[key].schema.safeParse(row.value) : undefined;
  return (parsed?.success ? parsed.data : TENANT_SETTINGS[key].default) as TenantSettingValue<K>;
}
