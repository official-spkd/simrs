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

/** Chip status 100/800 (koral/kunyit/zamrud/batu; brand = rona domain). Status tetap tertulis. */
const TONE: Record<RowTone, string> = {
  ok: 'bg-zamrud-100 text-zamrud-800',
  warn: 'bg-kunyit-100 text-kunyit-800',
  bad: 'bg-koral-100 text-koral-800',
  muted: 'bg-batu-200 text-batu-800',
  brand: 'bg-brand-100 text-brand-800',
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
          className="flex h-11 w-fit cursor-pointer items-center gap-1 rounded-control border border-[rgba(23,32,46,0.12)] bg-white/95 pr-3.5 pl-2 font-[inherit] font-semibold text-brand-700 hover:shadow-[0_6px_16px_rgba(23,32,46,0.12)]"
        >
          <Icon name="chevronLeft" size={20} />
          {backLabel}
        </button>
      )}
      <span className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">{page.title}</h2>
        <span className="text-[13px] text-ink-700">{page.intro}</span>
      </span>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 p-0 shadow-card">
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
                      <span
                        className={cx(
                          'rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
                          TONE[r.tone ?? 'muted'],
                        )}
                      >
                        {r.status}
                      </span>
                    )}
                  </span>
                )
              )}
            </>
          );
          return (
            <li key={r.id} className="border-b border-line-soft last:border-0">
              {r.link && onOpen ? (
                <button
                  type="button"
                  onClick={() => r.link && onOpen(r.link)}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3.5 py-2.5 text-left font-[inherit] transition-colors hover:bg-brand-50/60"
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
