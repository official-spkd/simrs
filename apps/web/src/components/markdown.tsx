import Link from 'next/link';
import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rewriteGuideHref, rewriteGuideImageSrc, slugify } from '@/lib/guide';
import { withBasePath } from '@/lib/base-path';

/** Teks polos dari children React (untuk id anchor heading; harus sama dengan `extractToc`). */
function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

function headingId(children: ReactNode): string {
  return slugify(Children.toArray(children).map(nodeText).join('').trim());
}

const components: Components = {
  h1: ({ children }) => <h1 className="m-0 mb-4 text-[26px] font-bold leading-tight">{children}</h1>,
  h2: ({ children }) => (
    <h2
      id={headingId(children)}
      className="mt-10 mb-3 scroll-mt-6 border-b border-line pb-2 text-h2 font-semibold"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={headingId(children)} className="mt-6 mb-2 scroll-mt-6 text-body font-semibold text-ink-900">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="my-3 leading-relaxed text-ink-700">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6 text-ink-700">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6 text-ink-700">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-ink-900">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-control border border-info-border bg-info-bg px-4 py-1 text-ink-700">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-line" />,
  a: ({ href = '', children }) => {
    const target = rewriteGuideHref(href);
    if (target.startsWith('/') || target.startsWith('#')) {
      return <Link href={target}>{children}</Link>;
    }
    return (
      <a href={target} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  /**
   * Gambar hanya dari `docs/panduan/gambar/` (lewat rute superadmin) dan wajib ber-`alt`. Selain itu tidak ada
   * permintaan ke luar: yang tampil hanya keterangan bahwa gambar ditolak. Teks alt juga tampil sebagai keterangan
   * (disembunyikan dari pembaca layar agar tidak terbaca dua kali). Klik membuka ukuran penuh.
   */
  img: ({ src, alt }) => {
    const rewritten = typeof src === 'string' ? rewriteGuideImageSrc(src) : null;
    const url = rewritten ? withBasePath(rewritten) : null;
    const text = (alt ?? '').trim();
    if (!url || !text) {
      return (
        <span className="my-3 block rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-small text-danger">
          Gambar tidak ditampilkan: hanya berkas di docs/panduan/gambar/ dengan teks alt yang diizinkan.
        </span>
      );
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="my-4 block rounded-card border border-line bg-subtle p-2 no-underline hover:border-brand-200"
      >
        {/* Bukan next/image: berkas datang dari rute ber-sesi, bukan aset statis yang bisa dioptimasi. */}
        <img
          src={url}
          alt={text}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full rounded-control border border-line-soft bg-white"
        />
        <span aria-hidden="true" className="mt-2 block px-1 text-caption text-ink-500">
          {text}
        </span>
      </a>
    );
  },
  code: ({ children, className }) => (
    <code
      className={`rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px] text-ink-900 ${className ?? ''}`}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-control border border-line bg-[#0F1A22] p-4 text-[12.5px] leading-relaxed text-[#E6EDF3] [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-control border border-line">
      <table className="w-full border-collapse text-left text-small">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-subtle text-caption text-ink-500">{children}</thead>,
  th: ({ children }) => <th className="border-b border-line px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => (
    <td className="border-b border-line-soft px-3 py-2 align-top text-ink-700">{children}</td>
  ),
};

/**
 * Render Markdown tepercaya dari repo sebagai elemen React. HTML mentah TIDAK dirender (default react-markdown),
 * sehingga konten tidak bisa menyisipkan skrip. Komponen server: tidak menambah JavaScript di browser.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  );
}
