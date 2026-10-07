import { type CreateFormDefinitionInput, type FormSchema, formSchemaSchema, newId } from '@simrs/shared';
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

/**
 * P07 · Naikkan versi formulir pustaka yang sudah terpasang bila versi berlakunya belum memenuhi `isCurrent` (mis.
 * opsi baru yang dibutuhkan aturan klinis). Versi lama diarsipkan, versi baru = isi pustaka (riwayat versi tetap).
 * Formulir yang sudah memenuhi `isCurrent` tidak disentuh. Versi berlaku buatan RS (lewat API P07: `created_by` terisi,
 * melewati alur komite) juga TIDAK pernah diarsipkan seed; hasilnya `{ upgraded: false, skippedLocal: true }` agar
 * pemanggil bisa memberi tahu operator. Untuk seed lokal/demo.
 */
export async function upgradePublishedForm(
  tx: TenantTx,
  tenantId: string,
  def: CreateFormDefinitionInput,
  isCurrent: (schema: FormSchema) => boolean,
): Promise<{ upgraded: boolean; skippedLocal?: true }> {
  const installed = await ensurePublishedForm(tx, tenantId, def);
  if (installed.created) return { upgraded: false };
  const published = await tx.formDefinition.findFirst({
    where: { code: def.code, status: 'published' },
    select: { id: true, schema: true, createdBy: true },
  });
  const current = published ? formSchemaSchema.safeParse(published.schema) : null;
  if (current?.success && isCurrent(current.data)) return { upgraded: false };
  // Versi buatan RS (komite rekam medis) tidak ditimpa seed walau belum memenuhi `isCurrent`.
  if (published?.createdBy) return { upgraded: false, skippedLocal: true };
  const last = await tx.formDefinition.findFirst({
    where: { code: def.code },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const now = new Date();
  if (published) {
    await tx.formDefinition.update({
      where: { id: published.id },
      data: { status: 'archived', archivedAt: now },
    });
  }
  await tx.formDefinition.create({
    data: {
      id: newId(),
      tenantId,
      code: def.code,
      version: (last?.version ?? 0) + 1,
      title: def.title,
      category: def.category,
      status: 'published',
      schema: formSchemaSchema.parse(def.schema),
      writeRoles: def.writeRoles,
      changeNote: def.changeNote,
      submittedAt: now,
      publishedAt: now,
    },
  });
  return { upgraded: true };
}
