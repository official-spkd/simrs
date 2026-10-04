import { type CreateFormDefinitionInput, formSchemaSchema, newId } from '@simrs/shared';
import { lockTenantScope } from './authz';
import type { TenantTx } from './client';

/**
 * P07 · Pasang formulir pustaka sebagai versi 1 yang langsung berlaku (seed lokal/tes) bila kodenya belum ada
 * di tenant ini. Tidak menyentuh formulir yang sudah ada (versi buatan RS tidak ditimpa). Memakai kunci siklus
 * formulir yang sama dengan API, jadi aman dijalankan paralel (dua seeder tidak sama-sama menyisipkan v1).
 */
export async function ensurePublishedForm(
  tx: TenantTx,
  tenantId: string,
  def: CreateFormDefinitionInput,
): Promise<{ id: string; created: boolean }> {
  await lockTenantScope(tx, `form:${def.code}`);
  const existing = await tx.formDefinition.findFirst({
    where: { code: def.code },
    orderBy: { version: 'asc' },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  const schema = formSchemaSchema.parse(def.schema);
  const now = new Date();
  const id = newId();
  await tx.formDefinition.create({
    data: {
      id,
      tenantId,
      code: def.code,
      version: 1,
      title: def.title,
      category: def.category,
      status: 'published',
      schema,
      writeRoles: def.writeRoles,
      changeNote: def.changeNote,
      submittedAt: now,
      publishedAt: now,
    },
  });
  return { id, created: true };
}
