import { Card } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GUIDE_PAGES, type GuidePage, guideSourcePath } from '@/lib/guide';
import { requireGuideReader } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Panduan sistem' };

const GROUPS: ReadonlyArray<{ id: GuidePage['group']; title: string; lead: string }> = [
  {
    id: 'sistem',
    title: 'Cara kerja dan operasional',
    lead: 'Untuk pengembang dan operator: arsitektur, kode, tutorial, runbook, dan peta kode.',
  },
  {
    id: 'fitur',
    title: 'Panduan fitur per layar',
    lead: 'Tujuan, pemakai, alur bernomor, gerbang keselamatan, dan gambar setiap layar, per kelompok.',
  },
];

/** Nomor urut dari nama berkas (`10-fitur-platform.md` → `10`), sama dengan urutan di repo. */
const pageNumber = (page: GuidePage) => page.file.slice(0, 2);

export default async function GuideIndexPage() {
  await requireGuideReader();
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold tracking-[0.08em] text-brand-700">
          SUPERADMIN · PANDUAN
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Panduan sistem SIM RS</h1>
        <p className="m-0 max-w-3xl text-ink-700">
          Cara sistem dan kode bekerja, tutorial, serta penjelasan fitur setiap layar lengkap dengan gambar.
          Isi halaman ini sama dengan berkas Markdown di folder{' '}
          <code className="font-mono">docs/panduan/</code> repo, jadi menyunting berkas itu langsung
          memperbarui panduan di sini.
        </p>
      </div>
      {GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`grup-${group.id}`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id={`grup-${group.id}`} className="m-0 text-h2 font-semibold">
              {group.title}
            </h2>
            <p className="m-0 text-small text-ink-700">{group.lead}</p>
          </div>
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {GUIDE_PAGES.filter((page) => page.group === group.id).map((page) => (
              <li key={page.slug}>
                <Link href={`/superadmin/panduan/${page.slug}`} className="block h-full no-underline">
                  <Card className="flex h-full flex-col gap-2 p-5 transition-colors hover:border-brand-200 hover:bg-selected">
                    <span className="font-mono text-caption text-ink-500">{pageNumber(page)}</span>
                    <span className="text-h2 font-semibold text-ink-900">{page.title}</span>
                    <span className="text-small text-ink-700">{page.summary}</span>
                    <span className="mt-auto pt-2 font-mono text-caption text-ink-500">
                      {guideSourcePath(page)}
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
