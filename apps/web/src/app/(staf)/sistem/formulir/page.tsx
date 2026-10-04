import { FORM_CATEGORIES } from '@simrs/shared';
import { Alert, Chip } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FORM_STATUS_VIEW, tanggalPendek, writeRoleOptions } from '@/lib/forms';
import { api } from '@/lib/server/api';
import { formListSchema } from '@/lib/server/forms';
import { requireSession } from '@/lib/server/session';
import { can } from '@/lib/session-view';
import { NewFormCard } from './new-form';

export const metadata: Metadata = { title: 'Formulir klinis' };

/**
 * P07 · Pustaka formulir klinis berversi. Formulir adalah data: komite rekam medis membuat draf, mengajukan,
 * lalu menerbitkan versi baru tanpa rilis aplikasi; isian lama tetap memakai versi saat diisi (MRMIK 6c).
 */
export default async function FormulirPage() {
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
  const forms = (await api('/api/v1/forms', { schema: formListSchema })).sort((a, b) =>
    a.title.localeCompare(b.title, 'id'),
  );
  const canWrite = can(s, 'forms.definition', 'write');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Sistem / Formulir klinis</span>
        <h1 className="m-0 text-h1 font-semibold">Formulir klinis</h1>
        <p className="m-0 max-w-3xl text-small text-ink-700">
          Perubahan formulir dibuat sebagai draf, diajukan ke Komite RM, lalu diterbitkan sebagai versi baru.
          Entri lama tetap ditampilkan dengan versi formulir saat diisi.
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby="pustaka-judul"
          className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-card border border-line bg-card"
        >
          <h2 id="pustaka-judul" className="m-0 border-b border-line px-4 py-3.5 text-body font-semibold">
            Pustaka formulir · {forms.length}
          </h2>
          {forms.length === 0 ? (
            <p className="m-0 px-4 py-4 text-small text-ink-500">Belum ada formulir.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <caption className="sr-only">Daftar formulir klinis</caption>
                <thead className="bg-subtle text-caption font-semibold text-ink-700">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">
                      Formulir
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Kategori
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Versi berlaku
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Draf
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Diperbarui
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.code} className="border-t border-line-soft text-small">
                      <td className="px-4 py-2.5">
                        <Link href={`/sistem/formulir/${f.code}`} className="font-semibold">
                          {f.title}
                        </Link>
                        <span className="block font-mono text-caption text-ink-500">{f.code}</span>
                      </td>
                      <td className="px-4 py-2.5">{FORM_CATEGORIES[f.category]}</td>
                      <td className="px-4 py-2.5">
                        {f.published ? (
                          <span className="flex flex-col">
                            <span className="font-semibold">v{f.published.version}</span>
                            {f.published.publishedAt && (
                              <span className="text-caption text-ink-500">
                                sejak {tanggalPendek(f.published.publishedAt)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-500">Belum terbit</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {f.draft ? (
                          <Chip tone={FORM_STATUS_VIEW[f.draft.status].tone}>
                            {FORM_STATUS_VIEW[f.draft.status].label} v{f.draft.version}
                          </Chip>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-700">{tanggalPendek(f.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canWrite && (
          <aside aria-label="Formulir baru" className="w-full flex-[1_1_300px] lg:max-w-[360px]">
            <NewFormCard roles={writeRoleOptions()} />
          </aside>
        )}
      </div>
    </div>
  );
}
