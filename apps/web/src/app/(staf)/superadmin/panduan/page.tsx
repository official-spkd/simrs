import { Card } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GUIDE_PAGES, guideSourcePath } from '@/lib/guide';

export const metadata: Metadata = { title: 'Panduan sistem' };

export default function GuideIndexPage() {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold tracking-[0.08em] text-brand-700">
          SUPERADMIN · PANDUAN
        </span>
        <h1 className="m-0 text-h1 font-bold">Panduan sistem SIM RS</h1>
        <p className="m-0 max-w-3xl text-ink-700">
          Cara sistem bekerja, cara kode bekerja, dan tutorial untuk pengembang berikutnya. Isi halaman ini
          sama dengan berkas Markdown di repo, jadi menyunting berkas itu langsung memperbarui panduan di
          sini.
        </p>
      </div>
      <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        {GUIDE_PAGES.map((page, i) => (
          <li key={page.slug}>
            <Link href={`/superadmin/panduan/${page.slug}`} className="block h-full no-underline">
              <Card className="flex h-full flex-col gap-2 p-5 transition-colors hover:border-brand-200 hover:bg-selected">
                <span className="font-mono text-caption text-ink-500">0{i + 1}</span>
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
    </div>
  );
}
