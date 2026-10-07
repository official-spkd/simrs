'use client';

import type { CarePackageItem, CareSetting } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { EmptyNote, TableWrap, TD, TH } from '@/components/backoffice/kit';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import { upsertCarePackageAction } from '@/lib/server/data/klinis/konsul-actions';

const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';

/**
 * K15 · Paket formulir per setting mode api (fase 3 · 3.8, ADR-0059; keputusan fase 3 no. 18: mekanisme paket +
 * kelengkapan). Baca: `forms.definition.read`; ubah (wajib/aktif/urutan, tambah formulir terbit): `forms.definition.write`.
 * Butir paket tidak dihapus, hanya dinonaktifkan (master). Aksi lewat Server Action lalu `router.refresh()`.
 */
export function CarePackagesBoard({
  setting,
  settingLabel,
  items,
  forms,
  canManage,
}: {
  setting: CareSetting;
  settingLabel: string;
  items: readonly CarePackageItem[];
  /** Formulir terbit yang belum ada di paket ini (pilihan tambah). */
  forms: ReadonlyArray<{ code: string; title: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const save = (formCode: string, item: { required: boolean; active: boolean; sortOrder: number }) =>
    start(async () => {
      const res = await upsertCarePackageAction({ setting, formCode, item });
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    });
  return (
    <section
      aria-label={`Paket formulir ${settingLabel}`}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <h2 className="m-0 text-body font-semibold">Paket formulir · {settingLabel}</h2>
      <p className="m-0 text-small text-ink-700">
        Formulir wajib di paket ini menjadi syarat kelengkapan asesmen setiap kunjungan{' '}
        {settingLabel.toLowerCase()} (EP 6b/7a).
      </p>
      <Feedback msg={msg} />
      {items.length === 0 ? (
        <EmptyNote>Paket {settingLabel.toLowerCase()} belum berisi formulir.</EmptyNote>
      ) : (
        <TableWrap label={`Butir paket ${settingLabel}`} minWidth={640}>
          <thead>
            <tr>
              <th className={TH}>Formulir</th>
              <th className={TH}>Status</th>
              {canManage && <th className={TH}>Atur</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <PackageRow key={i.formCode} item={i} canManage={canManage} busy={busy} save={save} />
            ))}
          </tbody>
        </TableWrap>
      )}
      {canManage ? (
        <AddForm forms={forms} busy={busy} next={items.length} save={save} />
      ) : (
        <p className="m-0 text-caption text-ink-500">
          Paket dikelola pengelola formulir (petugas rekam medis); peran Anda hanya membaca.
        </p>
      )}
    </section>
  );
}

type Save = (formCode: string, item: { required: boolean; active: boolean; sortOrder: number }) => void;

function PackageRow({
  item,
  canManage,
  busy,
  save,
}: {
  item: CarePackageItem;
  canManage: boolean;
  busy: boolean;
  save: Save;
}) {
  const id = useId();
  const [required, setRequired] = useState(item.required);
  const [active, setActive] = useState(item.active);
  const [sort, setSort] = useState(String(item.sortOrder));
  const sortOrder = Number(sort);
  const sortOk = Number.isInteger(sortOrder) && sortOrder >= 0 && sortOrder <= 999;
  const changed = required !== item.required || active !== item.active || sortOrder !== item.sortOrder;
  return (
    <tr>
      <td className={TD}>
        <span className="font-semibold">{item.formTitle ?? item.formCode}</span>
        <span className="block text-caption text-ink-500">
          {item.formCode}
          {item.formTitle === null ? ' · belum terbit' : ''}
        </span>
      </td>
      <td className={TD}>
        <span className="flex flex-wrap gap-1.5">
          <Chip tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Aktif' : 'Nonaktif'}</Chip>
          <Chip tone={item.required ? 'brand' : 'neutral'}>{item.required ? 'Wajib' : 'Opsional'}</Chip>
        </span>
      </td>
      {canManage && (
        <td className={TD}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-small">
              <input
                type="checkbox"
                className="size-5"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              Wajib
            </label>
            <label className="flex min-h-11 items-center gap-2 text-small">
              <input
                type="checkbox"
                className="size-5"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Aktif
            </label>
            <span className="flex items-center gap-2">
              <label htmlFor={`${id}-urut`} className="text-small">
                Urutan
              </label>
              <input
                id={`${id}-urut`}
                inputMode="numeric"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="h-11 w-20 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
              />
            </span>
            <Button
              disabled={busy || !changed || !sortOk}
              onClick={() => save(item.formCode, { required, active, sortOrder })}
            >
              Simpan
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

function AddForm({
  forms,
  busy,
  next,
  save,
}: {
  forms: ReadonlyArray<{ code: string; title: string }>;
  busy: boolean;
  next: number;
  save: Save;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const [required, setRequired] = useState(true);
  if (forms.length === 0) {
    return <p className="m-0 text-caption text-ink-500">Semua formulir terbit sudah ada di paket ini.</p>;
  }
  return (
    <form
      aria-label="Tambah formulir ke paket"
      className="flex flex-wrap items-end gap-3 rounded-control bg-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!code) return;
        save(code, { required, active: true, sortOrder: Math.min(next, 999) });
        setCode('');
      }}
    >
      <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <label htmlFor={`${id}-f`} className="text-small font-semibold">
          Formulir terbit
        </label>
        <select id={`${id}-f`} value={code} onChange={(e) => setCode(e.target.value)} className={SELECT}>
          <option value="">Pilih formulir…</option>
          {forms.map((f) => (
            <option key={f.code} value={f.code}>
              {f.title}
            </option>
          ))}
        </select>
      </span>
      <label className="flex min-h-11 items-center gap-2 text-small">
        <input
          type="checkbox"
          className="size-5"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        Wajib
      </label>
      <Button type="submit" variant="primary" disabled={busy || !code}>
        Tambah ke paket
      </Button>
    </form>
  );
}
