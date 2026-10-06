'use client';

import { CARE_CLASSES, type CareClass, formatJam, UNIT_KINDS, type UnitKind } from '@simrs/shared';
import { Alert, Button, Chip, cx, Field } from '@simrs/ui';
import { useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  addChild,
  bedCountUnder,
  bedSummary,
  canDeactivate,
  canReactivate,
  CARE_CLASS_LABEL,
  CHILD_KIND,
  childrenOf,
  KIND_LABEL,
  pathOf,
  type StructNode,
  UNIT_KIND_LABEL,
} from '@/lib/platform-struktur';
import type { StructureStoreState } from '@/lib/platform-struktur-toko';
import { ActivityLog, type ConfirmRequest, ConfirmDialog, Panel, Stamp, TableWrap, TD, TH } from './parts';
import { KpiTile } from '../manajemen/kpi-tile';

const SELECT =
  'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900 disabled:bg-muted';

function StatusChip({ node }: { node: StructNode }) {
  if (!node.active) return <Chip tone="neutral">Nonaktif</Chip>;
  if (node.kind === 'bed')
    return node.occupied ? <Chip tone="info">Terisi</Chip> : <Chip tone="success">Kosong</Chip>;
  return <Chip tone="success">Aktif</Chip>;
}

type Pending = { kind: 'off' | 'on'; node: StructNode } | null;

/**
 * P01 · Struktur RS: daftar faskes + unit di kiri, detail simpul terpilih di kanan (telusur ruang → kamar → bed),
 * tambah simpul anak dengan validasi kode bersama API, nonaktifkan berkonfirmasi + alasan (diblok bila bed masih
 * terisi), rekap bed per kelas rawat untuk Aplicare. Tersimpan di toko demo bersama (domain `struktur`) atas nama
 * pengguna sesi.
 */
export function StrukturBoard({ state, rev }: { state: StructureStoreState; rev: number }) {
  const nodes = state.nodes;
  const log = [...state.log];
  const { dispatch, pending: saving, error: saveError } = useDemoDispatch('struktur', rev);
  const [selected, setSelected] = useState<string>('u-melati');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ code: string; name: string; unitKind: string; careClass: string }>({
    code: '',
    name: '',
    unitKind: '',
    careClass: '',
  });
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const node = nodes.find((n) => n.id === selected) ?? nodes[0];
  if (!node) return null;
  const childKind = CHILD_KIND[node.kind];
  const kids = childrenOf(nodes, node.id);
  const path = pathOf(nodes, node.id);
  const off = canDeactivate(nodes, node.id);
  const on = canReactivate(nodes, node.id);
  const summary = bedSummary(nodes);
  const units = nodes.filter((n) => n.kind === 'unit');
  const beds = summary.reduce((s, r) => s + r.total, 0);
  const occupied = summary.reduce((s, r) => s + r.occupied, 0);
  const inactiveBeds = summary.reduce((s, r) => s + r.inactive, 0);
  const inUnitRanap = path.some((p) => p.kind === 'unit' && p.unitKind === 'rawat_inap');

  const aplicare = state.aplicare
    ? `Masuk antrean kirim Aplicare · ${state.aplicare.jam} oleh ${state.aplicare.by}`
    : null;
  const select = (id: string) => {
    setSelected(id);
    setAdding(false);
    setError(null);
    setFlash(null);
  };
  const openAdd = () => {
    setForm({ code: '', name: '', unitKind: '', careClass: inUnitRanap ? (node.careClass ?? '') : '' });
    setError(null);
    setFlash(null);
    setAdding(true);
  };
  const submitAdd = () => {
    const r = addChild(nodes, node.id, {
      code: form.code,
      name: form.name,
      unitKind: (form.unitKind || undefined) as UnitKind | undefined,
      careClass: (form.careClass || undefined) as CareClass | undefined,
    });
    if (!r.ok) {
      setError({ field: r.field, message: r.message });
      return;
    }
    const t = formatJam(demoNow());
    const added = r.node;
    dispatch(
      {
        type: 'simpul.ditambah',
        parentId: node.id,
        code: form.code,
        name: form.name,
        ...(form.unitKind ? { unitKind: form.unitKind as UnitKind } : {}),
        ...(form.careClass ? { careClass: form.careClass as CareClass } : {}),
        jam: t,
      },
      (ok) => {
        if (!ok) return;
        setFlash(`${KIND_LABEL[added.kind]} ${added.code} ditambahkan · ${t}`);
        setAdding(false);
        setError(null);
      },
    );
  };

  const request: ConfirmRequest | null = pending
    ? pending.kind === 'off'
      ? {
          title: `Nonaktifkan ${KIND_LABEL[pending.node.kind].toLowerCase()} ${pending.node.name}?`,
          body: (
            <>
              {KIND_LABEL[pending.node.kind]} dan semua turunannya tidak bisa dipilih untuk pendaftaran,
              admisi, atau transfer baru. Data lama tetap tersimpan; bisa diaktifkan kembali.
            </>
          ),
          confirmLabel: 'Ya, nonaktifkan',
          danger: true,
          reasonLabel: 'Alasan menonaktifkan',
          reasonPlaceholder: 'mis. renovasi kamar mandi sampai 20 Okt',
        }
      : {
          title: `Aktifkan kembali ${pending.node.name}?`,
          body: <>Simpul ini kembali bisa dipilih di pendaftaran dan papan tempat tidur.</>,
          confirmLabel: 'Ya, aktifkan',
        }
    : null;
  const confirm = (reason: string) => {
    if (!pending) return;
    const n = pending.node;
    const t = formatJam(demoNow());
    if (pending.kind === 'off') {
      dispatch({ type: 'simpul.dinonaktifkan', id: n.id, reason, jam: t }, (ok) => {
        if (ok) setFlash(`${KIND_LABEL[n.kind]} ${n.code} dinonaktifkan · ${t}`);
      });
    } else {
      dispatch({ type: 'simpul.diaktifkan', id: n.id, jam: t }, (ok) => {
        if (ok) setFlash(`${KIND_LABEL[n.kind]} ${n.code} aktif kembali · ${t}`);
      });
    }
  };

  const faskes = nodes.filter((n) => n.kind === 'faskes');

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Ringkasan struktur" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiTile
          index={0}
          label="Unit aktif"
          value={`${units.filter((u) => u.active).length}/${units.length}`}
          detail={`${faskes.length} faskes`}
        />
        <KpiTile index={3} label="Bed tersedia" value={String(beds)} detail="contoh sebagian bangsal" />
        <KpiTile
          index={1}
          label="Bed terisi"
          value={String(occupied)}
          hint={`${beds - occupied} kosong`}
          tone={beds - occupied < 5 ? 'warning' : 'neutral'}
        />
        <KpiTile
          index={2}
          label="Bed nonaktif"
          value={String(inactiveBeds)}
          detail="renovasi / perbaikan"
          tone={inactiveBeds > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <nav aria-label="Faskes dan unit" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          {faskes.map((f) => (
            <div
              key={f.id}
              className="flex flex-col gap-1.5 rounded-card border border-white/95 bg-white/90 shadow-card p-3"
            >
              <button
                type="button"
                onClick={() => select(f.id)}
                aria-current={selected === f.id ? 'true' : undefined}
                className={cx(
                  'flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-control border px-3 text-left font-[inherit]',
                  selected === f.id ? 'border-brand-600 bg-brand-50' : 'border-transparent bg-transparent',
                )}
              >
                <span className="flex flex-col">
                  <span className="font-semibold">{f.name}</span>
                  <span className="font-mono text-caption text-ink-500">{f.code}</span>
                </span>
                <StatusChip node={f} />
              </button>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-2">
                {childrenOf(nodes, f.id).map((u) => {
                  const inside = selected === u.id || path.some((p) => p.id === u.id);
                  const c = bedCountUnder(nodes, u.id);
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => select(u.id)}
                        aria-current={inside ? 'true' : undefined}
                        className={cx(
                          'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-control border px-2.5 text-left font-[inherit] text-small',
                          inside ? 'border-brand-600 bg-brand-50' : 'border-transparent bg-transparent',
                          !u.active && 'text-ink-500',
                        )}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{u.name}</span>
                          <span className="text-caption text-ink-500">
                            {u.unitKind ? UNIT_KIND_LABEL[u.unitKind] : ''}
                            {c.total > 0 ? ` · ${c.occupied}/${c.total} bed terisi` : ''}
                          </span>
                        </span>
                        {!u.active && <Chip tone="neutral">Nonaktif</Chip>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-[999_1_440px] flex-col gap-4">
          <Panel
            title={`${KIND_LABEL[node.kind]} · ${node.name}`}
            sub={
              <span className="flex flex-wrap items-center gap-1">
                {path.map((p, i) => (
                  <span key={p.id} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden="true">›</span>}
                    {p.id === node.id ? (
                      <span>{p.name}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => select(p.id)}
                        className="min-h-11 cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-brand-600 underline"
                      >
                        {p.name}
                      </button>
                    )}
                  </span>
                ))}
              </span>
            }
            actions={
              <>
                {childKind && (
                  <Button onClick={openAdd} disabled={!node.active || adding}>
                    Tambah {KIND_LABEL[childKind].toLowerCase()}
                  </Button>
                )}
                {node.active ? (
                  <Button
                    variant="danger"
                    disabled={!off.ok}
                    aria-describedby={!off.ok ? 'struktur-alasan-nonaktif' : undefined}
                    onClick={() => setPending({ kind: 'off', node })}
                  >
                    Nonaktifkan
                  </Button>
                ) : (
                  <Button
                    disabled={!on.ok}
                    aria-describedby={!on.ok ? 'struktur-alasan-nonaktif' : undefined}
                    onClick={() => setPending({ kind: 'on', node })}
                  >
                    Aktifkan kembali
                  </Button>
                )}
              </>
            }
          >
            <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-small">
              <dt className="text-ink-500">Kode</dt>
              <dd className="m-0 font-mono">{node.code}</dd>
              {node.unitKind && (
                <>
                  <dt className="text-ink-500">Jenis unit</dt>
                  <dd className="m-0">{UNIT_KIND_LABEL[node.unitKind]}</dd>
                </>
              )}
              {node.careClass && (
                <>
                  <dt className="text-ink-500">Kelas rawat</dt>
                  <dd className="m-0">{CARE_CLASS_LABEL[node.careClass]}</dd>
                </>
              )}
              <dt className="text-ink-500">Status</dt>
              <dd className="m-0">
                <StatusChip node={node} />
              </dd>
            </dl>
            {node.active && !off.ok && node.parentId !== null && (
              <span id="struktur-alasan-nonaktif" className="text-caption font-medium text-warning">
                Tidak bisa dinonaktifkan: {off.reason}
              </span>
            )}
            {node.active && !off.ok && node.parentId === null && (
              <span id="struktur-alasan-nonaktif" className="text-caption text-ink-500">
                {off.reason}
              </span>
            )}
            {!node.active && !on.ok && (
              <span id="struktur-alasan-nonaktif" className="text-caption font-medium text-warning">
                {on.reason}
              </span>
            )}
            {(flash || saveError) && (
              <span role="status">
                <Stamp>{saveError ?? flash}</Stamp>
              </span>
            )}

            {adding && childKind && (
              <form
                aria-label={`Tambah ${KIND_LABEL[childKind].toLowerCase()} di ${node.name}`}
                className="flex flex-col gap-3 rounded-control border border-brand-100 bg-[linear-gradient(135deg,var(--color-brand-50),rgba(255,255,255,0.75))] p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitAdd();
                }}
              >
                <span className="text-small font-semibold">
                  {KIND_LABEL[childKind]} baru di {node.name}
                </span>
                <div className="flex flex-wrap gap-3">
                  <Field
                    label="Kode"
                    required
                    className="flex-[1_1_160px]"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    error={error?.field === 'code' ? error.message : null}
                    hint="Huruf kapital, angka, strip (maks. 30)"
                    hintTone="muted"
                  />
                  <Field
                    label="Nama"
                    required
                    className="flex-[2_1_220px]"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    error={error?.field === 'name' ? error.message : null}
                  />
                  {childKind === 'unit' && (
                    <label className="flex flex-[1_1_180px] flex-col gap-1.5">
                      <span className="text-small font-semibold text-ink-700">Jenis unit</span>
                      <select
                        className={SELECT}
                        value={form.unitKind}
                        onChange={(e) => setForm({ ...form, unitKind: e.target.value })}
                        aria-invalid={error?.field === 'unitKind'}
                      >
                        <option value="">Pilih jenis…</option>
                        {UNIT_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {UNIT_KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      {error?.field === 'unitKind' && (
                        <span className="text-caption text-danger">{error.message}</span>
                      )}
                    </label>
                  )}
                  {childKind === 'kamar' && (
                    <label className="flex flex-[1_1_180px] flex-col gap-1.5">
                      <span className="text-small font-semibold text-ink-700">
                        Kelas rawat{inUnitRanap ? ' *' : ''}
                      </span>
                      <select
                        className={SELECT}
                        value={form.careClass}
                        onChange={(e) => setForm({ ...form, careClass: e.target.value })}
                        aria-invalid={error?.field === 'careClass'}
                      >
                        <option value="">Pilih kelas…</option>
                        {CARE_CLASSES.map((k) => (
                          <option key={k} value={k}>
                            {CARE_CLASS_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      {error?.field === 'careClass' && (
                        <span className="text-caption text-danger">{error.message}</span>
                      )}
                    </label>
                  )}
                </div>
                {error?.field === 'parent' && <Alert level="warning">{error.message}</Alert>}
                {childKind === 'bed' && (
                  <span className="text-caption text-ink-500">
                    Bed mewarisi kelas kamar:{' '}
                    {node.careClass ? CARE_CLASS_LABEL[node.careClass] : 'tanpa kelas'}.
                  </span>
                )}
                <span className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary">
                    Simpan {KIND_LABEL[childKind].toLowerCase()}
                  </Button>
                  <Button onClick={() => setAdding(false)}>Batal</Button>
                </span>
              </form>
            )}

            {childKind ? (
              kids.length > 0 ? (
                <TableWrap label={`Daftar ${KIND_LABEL[childKind].toLowerCase()} di ${node.name}`}>
                  <table className="w-full min-w-[520px] border-collapse [&_tbody_tr]:transition-colors [&_tbody_tr:hover>td]:bg-brand-50/60">
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>
                          Kode
                        </th>
                        <th scope="col" className={TH}>
                          Nama
                        </th>
                        <th scope="col" className={TH}>
                          {childKind === 'unit' ? 'Jenis' : 'Kelas'}
                        </th>
                        <th scope="col" className={TH}>
                          Bed terisi
                        </th>
                        <th scope="col" className={TH}>
                          Status
                        </th>
                        <th scope="col" className={TH}>
                          <span className="sr-only">Aksi</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {kids.map((k) => {
                        const c = bedCountUnder(nodes, k.id);
                        return (
                          <tr key={k.id} className={cx(!k.active && 'text-ink-500')}>
                            <td className={cx(TD, 'font-mono')}>{k.code}</td>
                            <td className={TD}>{k.name}</td>
                            <td className={TD}>
                              {k.unitKind
                                ? UNIT_KIND_LABEL[k.unitKind]
                                : k.careClass
                                  ? CARE_CLASS_LABEL[k.careClass]
                                  : '–'}
                            </td>
                            <td className={cx(TD, 'font-mono')}>
                              {k.kind === 'bed' ? (k.occupied ? '1/1' : '0/1') : `${c.occupied}/${c.total}`}
                            </td>
                            <td className={TD}>
                              <StatusChip node={k} />
                            </td>
                            <td className={cx(TD, 'text-right')}>
                              <Button size="sm" variant="ghost" onClick={() => select(k.id)}>
                                Buka<span className="sr-only"> {k.name}</span>
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <p className="m-0 rounded-control border border-dashed border-line-strong p-3 text-small text-ink-500">
                  Belum ada {KIND_LABEL[childKind].toLowerCase()} di {node.name}. Pakai tombol “Tambah{' '}
                  {KIND_LABEL[childKind].toLowerCase()}”.
                </p>
              )
            ) : (
              <p className="m-0 text-small text-ink-500">
                Bed adalah tingkat terakhir. Status terisi/kosong berasal dari ADT (papan tempat tidur).
              </p>
            )}
          </Panel>

          <div className="flex flex-wrap items-start gap-4">
            <Panel
              className="flex-[1_1_320px]"
              title="Rekap bed per kelas rawat"
              sub="Bahan ketersediaan bed Aplicare/SIRANAP"
              actions={
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() => dispatch({ type: 'aplicare.dikirim', jam: formatJam(demoNow()) })}
                >
                  Kirim ke Aplicare
                </Button>
              }
            >
              <TableWrap label="Rekap bed per kelas rawat">
                <table className="w-full border-collapse [&_tbody_tr]:transition-colors [&_tbody_tr:hover>td]:bg-brand-50/60">
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Kelas
                      </th>
                      <th scope="col" className={cx(TH, 'text-right')}>
                        Tersedia
                      </th>
                      <th scope="col" className={cx(TH, 'text-right')}>
                        Terisi
                      </th>
                      <th scope="col" className={cx(TH, 'text-right')}>
                        Kosong
                      </th>
                      <th scope="col" className={cx(TH, 'text-right')}>
                        Nonaktif
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.careClass}>
                        <th scope="row" className={cx(TD, 'text-left font-medium')}>
                          {CARE_CLASS_LABEL[r.careClass]}
                        </th>
                        <td className={cx(TD, 'text-right font-mono')}>{r.total}</td>
                        <td className={cx(TD, 'text-right font-mono')}>{r.occupied}</td>
                        <td className={cx(TD, 'text-right font-mono')}>{r.total - r.occupied}</td>
                        <td className={cx(TD, 'text-right font-mono')}>{r.inactive}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              {aplicare && (
                <span role="status">
                  <Stamp tone="info">{aplicare}</Stamp>
                </span>
              )}
            </Panel>
            <Panel
              className="flex-[1_1_280px]"
              title="Riwayat perubahan"
              sub="Hari ini · tercatat di jejak audit"
            >
              <ActivityLog label="Riwayat perubahan struktur" items={log} />
            </Panel>
          </div>
        </div>
      </div>
      <ConfirmDialog request={request} onConfirm={confirm} onClose={() => setPending(null)} />
    </div>
  );
}
