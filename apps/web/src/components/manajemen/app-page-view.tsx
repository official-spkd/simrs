import { cx, Icon } from '@simrs/ui';

export type RowTone = 'ok' | 'warn' | 'bad' | 'muted' | 'brand';

export interface AppRow {
  id: string;
  title: string;
  detail: string;
  value?: string;
  status?: string;
  tone?: RowTone;
  /** Kunci halaman yang dibuka baris ini (baris menjadi tombol). */
  link?: string;
}

export interface AppPage {
  title: string;
  intro: string;
  rows: AppRow[];
  note: string;
  /** Teks bila `rows` kosong. */
  empty?: string;
}

const TONE: Record<RowTone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
  muted: 'text-ink-500',
  brand: 'text-brand-700',
};

/** Halaman daftar sederhana di pratinjau aplikasi ponsel (judul, pengantar, baris, catatan kaki). */
export function AppPageView({
  page,
  onBack,
  backLabel = 'Kembali',
  onOpen,
}: {
  page: AppPage;
  onBack?: () => void;
  backLabel?: string;
  onOpen?: (key: string) => void;
}) {
  return (
    <section aria-label={page.title} className="flex flex-col gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex h-11 w-fit cursor-pointer items-center gap-1 border-0 bg-transparent px-0 font-[inherit] font-semibold text-brand-700"
        >
          <Icon name="chevronLeft" size={20} />
          {backLabel}
        </button>
      )}
      <span className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold">{page.title}</h2>
        <span className="text-[13px] text-ink-700">{page.intro}</span>
      </span>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[16px] border border-line bg-white p-0">
        {page.rows.map((r) => {
          const body = (
            <>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-semibold text-ink-900">{r.title}</span>
                <span className="text-[12.5px] text-ink-500">{r.detail}</span>
              </span>
              {r.link ? (
                <Icon name="chevronRight" size={20} className="shrink-0 text-ink-500" />
              ) : (
                (r.value || r.status) && (
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                    {r.value && <span className="font-mono font-semibold text-ink-900">{r.value}</span>}
                    {r.status && (
                      <span className={cx('text-[12px] font-semibold', TONE[r.tone ?? 'muted'])}>
                        {r.status}
                      </span>
                    )}
                  </span>
                )
              )}
            </>
          );
          return (
            <li key={r.id} className="border-b border-[#EEF1F4] last:border-0">
              {r.link && onOpen ? (
                <button
                  type="button"
                  onClick={() => r.link && onOpen(r.link)}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3.5 py-2.5 text-left font-[inherit]"
                >
                  {body}
                </button>
              ) : (
                <div className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
        {page.rows.length === 0 && (
          <li className="px-3.5 py-4 text-[13px] text-ink-500">{page.empty ?? 'Belum ada data.'}</li>
        )}
      </ul>
      <span className="text-[12.5px] text-ink-500">{page.note}</span>
    </section>
  );
}
