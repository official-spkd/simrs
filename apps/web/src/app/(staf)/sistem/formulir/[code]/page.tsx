import { Alert } from '@simrs/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { writeRoleOptions } from '@/lib/forms';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { formDetailSchema } from '@/lib/server/forms';
import { requireSession } from '@/lib/server/session';
import { can } from '@/lib/session-view';
import { FormBuilder } from './form-builder';

export const metadata: Metadata = { title: 'Pembuat formulir klinis' };

const CODE = /^[a-z][a-z0-9_]{2,40}$/;

/**
 * P07 · Pembuat formulir (design/mockups/Formulir.dc.html): palet jenis field, kanvas dengan pratinjau skor,
 * properti field, dan riwayat versi. Hanya draf yang bisa diubah; versi terbit tidak bisa diubah (trigger DB).
 */
export default async function FormEditorPage({ params }: { params: Promise<{ code: string }> }) {
  const s = await requireSession();
  if (!can(s, 'forms.definition', 'read')) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="m-0 text-h1 font-semibold">Formulir klinis</h1>
        <Alert level="warning" title="Akses ditolak">
          Pustaka formulir klinis dikelola komite rekam medis. Hubungi admin SIM RS bila perlu.
        </Alert>
      </div>
    );
  }
  const { code } = await params;
  if (!CODE.test(code)) notFound();
  const detail = await api(`/api/v1/forms/${code}`, { schema: formDetailSchema }).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  });
  if (!detail || !(detail.draft ?? detail.published)) notFound();
  const roles = [...(detail.draft?.writeRoles ?? []), ...(detail.published?.writeRoles ?? [])];

  return (
    <FormBuilder
      detail={detail}
      canWrite={can(s, 'forms.definition', 'write')}
      canPublish={can(s, 'forms.definition', 'publish')}
      roleOptions={writeRoleOptions(roles)}
    />
  );
}
