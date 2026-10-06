'use client';

import type { CpoeCatalogItem, CpoeOrderSet } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useId, useState } from 'react';

/** Cari item katalog (nama + kata kunci), maksimal 6 hasil. */
export function searchCatalog(catalog: readonly CpoeCatalogItem[], query: string): CpoeCatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return catalog
    .filter((c) => `${c.name} ${c.keywords} ${c.code?.code ?? ''}`.toLowerCase().includes(q))
    .slice(0, 6);
}

/** Order set yang cocok dengan pencarian (mockup: hasil "paket" menambahkan beberapa item sekaligus). */
export function searchOrderSets(sets: readonly CpoeOrderSet[], query: string): CpoeOrderSet[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return sets.filter((s) => s.name.toLowerCase().includes(q));
}

/**
 * Kolom kiri CPOE (mockup): pencarian katalog dan order set institusi. `lockedNote` = katalog dan order set
 * nonaktif (pasien skenario: order mengikuti langkah skenario) dengan catatan tertulis.
 */
export function CpoeCatalog({
  catalog,
  orderSets,
  disabled,
  lockedNote = null,
  onAdd,
  onApplySet,
}: {
  catalog: readonly CpoeCatalogItem[];
  orderSets: readonly CpoeOrderSet[];
  disabled: boolean;
  lockedNote?: string | null;
  onAdd: (ids: readonly string[], label: string | null) => void;
  onApplySet: (set: CpoeOrderSet) => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const locked = lockedNote !== null;
  const off = disabled || locked;
  const results = locked ? [] : searchCatalog(catalog, q);
  const packages = locked ? [] : searchOrderSets(orderSets, q).slice(0, Math.max(0, 6 - results.length));
  const apply = (s: CpoeOrderSet) => {
    setApplied(s.id);
    onApplySet(s);
  };
  return (
    <aside aria-label="Katalog dan order set" className="flex min-w-0 flex-col gap-4">
      {locked && (
        <p
          role="note"
          className="m-0 rounded-card border border-brand-100 bg-selected px-3.5 py-3 text-small font-semibold text-brand-700"
        >
          {lockedNote}
        </p>
      )}
      <div className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card p-3.5">
        <label htmlFor={id} className="text-small font-semibold">
          Cari pemeriksaan, obat, tindakan
        </label>
        <input
          id={id}
          type="search"
          value={q}
          disabled={locked}
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          placeholder="mis. hba1c, lipid, klindamisin"
          aria-describedby={`${id}-hint`}
          className="h-11 rounded-control border border-brand-600 bg-white px-3 font-[inherit] disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-subtle"
        />
        {results.length + packages.length > 0 && (
          <ul
            aria-label="Hasil pencarian katalog"
            className="m-0 flex list-none flex-col overflow-hidden rounded-control border border-line p-0 text-small"
          >
            {results.map((r, i) => (
              <li key={r.id} className="border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  disabled={off}
                  onClick={() => onAdd([r.id], null)}
                  className={cx(
                    'flex min-h-11 w-full cursor-pointer flex-col items-start border-0 px-2.5 py-2 text-left font-[inherit] disabled:cursor-not-allowed',
                    i === 0 ? 'bg-selected' : 'bg-white hover:bg-subtle',
                  )}
                >
                  <span className="font-semibold">Tambah {r.name}</span>
                  <span className="text-caption text-ink-500">{r.meta}</span>
                </button>
              </li>
            ))}
            {packages.map((s) => (
              <li key={`paket-${s.id}`} className="border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  disabled={off}
                  onClick={() => apply(s)}
                  className="flex min-h-11 w-full cursor-pointer flex-col items-start border-0 bg-white px-2.5 py-2 text-left font-[inherit] hover:bg-subtle disabled:cursor-not-allowed"
                >
                  <span className="font-semibold">Tambah paket {s.name}</span>
                  <span className="text-caption text-ink-500">Paket · {s.meta}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <span id={`${id}-hint`} className="text-caption text-ink-500">
          {locked
            ? 'Katalog tidak dipakai untuk pasien ini; daftar order di tengah berasal dari langkah skenario.'
            : q.trim() && results.length + packages.length === 0
              ? 'Tidak ada item katalog yang cocok. Coba kata lain, mis. "lipid", "EKG", "klindamisin".'
              : 'Item ditambahkan sebagai draf; CDS memeriksa setiap item terhadap alergi, obat rutin, dan riwayat.'}
        </span>
      </div>
      <section
        aria-labelledby={`${id}-sets`}
        className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-3.5"
      >
        <h2 id={`${id}-sets`} className="m-0 text-small font-semibold">
          Order set institusi
        </h2>
        {orderSets.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={applied === s.id}
            disabled={off}
            onClick={() => apply(s)}
            className={cx(
              'flex min-h-11 cursor-pointer flex-col items-start gap-0.5 rounded-control px-3 py-2.5 text-left font-[inherit] disabled:cursor-not-allowed disabled:opacity-60',
              applied === s.id ? 'border-2 border-brand-600 bg-selected' : 'border border-line bg-white',
            )}
          >
            <span className="text-small font-semibold">{s.name}</span>
            <span className="text-caption text-ink-500">{s.meta}</span>
          </button>
        ))}
        <span className="text-caption text-ink-500">
          Order set ditetapkan Komite Medik dan terhubung ke clinical pathway.
        </span>
      </section>
    </aside>
  );
}
