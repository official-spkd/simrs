import { cx } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Markdown } from '@/components/markdown';
import { extractToc, findGuidePage, GUIDE_PAGES, guideSourcePath, loadGuideMarkdown } from '@/lib/guide';
import { requireGuideReader } from '@/lib/server/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = findGuidePage((await params).slug);
  return { title: page ? `${page.title} · Panduan` : 'Panduan' };
}

export default async function GuidePageView({ params }: { params: Params }) {
  await requireGuideReader();
  const page = findGuidePage((await params).slug);
  if (!page) notFound();
  const markdown = loadGuideMarkdown(page);
  const toc = extractToc(markdown);
  const index = GUIDE_PAGES.findIndex((p) => p.slug === page.slug);
  const prev = GUIDE_PAGES[index - 1];
  const next = GUIDE_PAGES[index + 1];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Jejak" className="text-small text-ink-500">
        <Link href="/superadmin/panduan">Panduan sistem</Link> <span aria-hidden="true">/</span>{' '}
        <span aria-current="page">{page.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
        <article className="min-w-0 rounded-card border border-line bg-card px-5 py-6 shadow-card md:px-8">
          <Markdown source={markdown} />
          <p className="mt-10 border-t border-line pt-4 font-mono text-caption text-ink-500">
            Sumber: {guideSourcePath(page)}
          </p>
        </article>

        <aside className="order-first lg:order-none">
          <nav
            aria-label="Daftar isi"
            className="flex flex-col gap-1 lg:sticky lg:top-[calc(var(--app-sticky-top,0px)_+_1.5rem)]"
          >
            <span className="text-caption font-semibold tracking-[0.08em] text-ink-500">DAFTAR ISI</span>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-small">
              {toc.map((item) => (
                <li key={item.id} className={cx(item.depth === 3 && 'pl-3')}>
                  <a
                    href={`#${item.id}`}
                    className="block rounded px-2 py-1 text-ink-700 no-underline hover:bg-subtle"
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>

      <nav aria-label="Halaman panduan lain" className="flex flex-wrap justify-between gap-3 text-small">
        {prev ? <Link href={`/superadmin/panduan/${prev.slug}`}>← {prev.title}</Link> : <span />}
        {next ? <Link href={`/superadmin/panduan/${next.slug}`}>{next.title} →</Link> : <span />}
      </nav>
    </div>
  );
}
