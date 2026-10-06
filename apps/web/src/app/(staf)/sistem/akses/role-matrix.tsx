'use client';

import type { PermissionScope } from '@simrs/shared';
import { Button, cx, Icon } from '@simrs/ui';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState, useTransition } from 'react';
import {
  ACTION_LABEL,
  countChanges,
  fromGrantMap,
  type GrantMap,
  nextScope,
  SCOPE_LABEL,
  toGrantMap,
} from '@/lib/akses';
import { type RoleSaveResult, saveRolePermissionsAction } from './actions';
import { ErrorText } from './parts';
import { selectClass } from './styles';

export interface MatrixRole {
  code: string;
  name: string;
  isSystem: boolean;
  permissions: Array<{ resource: string; action: string; scope: PermissionScope }>;
}

export interface MatrixResource {
  resource: string;
  label: string;
  actions: string[];
}

/** Warna teks lingkup (mockup Akses: ✓ hijau, ◐ teal, — abu); latar kuning = belum disimpan. */
const SCOPE_TEXT: Record<PermissionScope | 'none', string> = {
  all: 'text-success',
  unit: 'text-brand-700',
  relationship: 'text-info',
  none: 'text-ink-400',
};

const SCOPE_CHIP: Record<PermissionScope | 'none', string> = {
  all: 'bg-success-bg text-success',
  unit: 'bg-brand-50 text-brand-700',
  relationship: 'bg-info-bg text-info',
  none: 'bg-white text-ink-400',
};

const SCOPE_MEANING: Record<PermissionScope | 'none', string> = {
  all: 'seluruh data RS',
  unit: 'hanya unit kerja sendiri',
  relationship: 'hanya pasien yang dirawat (relasi) atau akses darurat',
  none: 'ditolak',
};

/** Kolom tetap matriks; aksi lain (ekspor, cetak, tanda tangan, …) tampil sebagai chip di kolom terakhir. */
const MAIN_ACTIONS = ['read', 'write'] as const;

const CHANGED = 'bg-kunyit-50';

function Editor({
  role,
  catalog,
  canWrite,
  locked,
  onDirty,
  onSaved,
}: {
  role: MatrixRole;
  catalog: MatrixResource[];
  canWrite: boolean;
  /** Sel `sumber|aksi` yang tidak bisa dicabut dari peran ini (izin kelola akses peran pelindung). */
  locked: ReadonlySet<string>;
  onDirty: (changes: number) => void;
  onSaved: (saved: { at: string; changes: number }) => void;
}) {
  const base = useMemo(() => toGrantMap(role.permissions), [role.permissions]);
  const [grants, setGrants] = useState<GrantMap>(base);
  const [saving, startSave] = useTransition();
  const [result, setResult] = useState<RoleSaveResult>({});
  const dirty = countChanges(base, grants);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const toggle = (key: string) =>
    setGrants((prev) => {
      const next = nextScope(prev[key] ?? null);
      const copy = { ...prev };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });

  const save = () =>
    startSave(async () => {
      setResult({});
      const r = await saveRolePermissionsAction(role.code, fromGrantMap(grants));
      if (r.ok) onSaved({ at: r.savedAt ?? '', changes: r.changes ?? dirty });
      else setResult(r);
    });

  /** Satu sel izin: tombol bila boleh diubah, teks bila tidak. Teks lengkap "Aksi: Lingkup" tetap ada untuk pembaca layar. */
  const cell = (res: MatrixResource, action: string, chip: boolean): ReactNode => {
    const key = `${res.resource}|${action}`;
    const scope = grants[key] ?? null;
    const changed = (base[key] ?? null) !== scope;
    const isLocked = locked.has(key);
    const actionLabel = ACTION_LABEL[action] ?? action;
    const value = scope ? SCOPE_LABEL[scope] : '—';
    const tone = scope ?? 'none';
    const text = chip ? (
      `${actionLabel}: ${value}`
    ) : (
      <>
        <span className="sr-only">{actionLabel}: </span>
        {value}
      </>
    );
    const style = chip
      ? cx(
          'inline-flex min-h-11 items-center rounded-full border px-2.5 text-caption font-semibold',
          SCOPE_CHIP[tone],
          changed ? 'border-kunyit-400 ring-2 ring-kunyit-400/40' : 'border-line-strong',
        )
      : cx(
          'flex min-h-11 w-full items-center justify-center px-1.5 font-semibold',
          SCOPE_TEXT[tone],
          changed && CHANGED,
        );
    if (!canWrite || isLocked) {
      return (
        <span
          className={style}
          title={isLocked ? 'Tidak bisa dicabut dari peran admin' : SCOPE_MEANING[tone]}
        >
          {text}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => toggle(key)}
        className={cx(
          style,
          'cursor-pointer font-[inherit]',
          !chip && 'border-0',
          !chip && !changed && 'bg-transparent',
        )}
        aria-label={`${res.label}, ${actionLabel}: ${SCOPE_MEANING[tone]}. Klik untuk mengganti.`}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-control border border-line">
        <table className="w-full min-w-[300px] border-collapse text-small [&_tbody_tr]:transition-colors [&_tbody_tr:hover>td]:bg-brand-50/60">
          <caption className="sr-only">Matriks izin peran {role.name} per modul</caption>
          <thead className="text-caption font-semibold text-ink-500 [&_th]:border-b [&_th]:border-[rgba(23,32,46,0.08)]">
            <tr>
              <th scope="col" className="px-2.5 py-2 text-left">
                Modul <span className="font-normal text-ink-500">· aksi lain di bawahnya</span>
              </th>
              <th scope="col" className="w-[72px] px-1.5 py-2 text-center">
                Lihat
              </th>
              <th scope="col" className="w-[72px] px-1.5 py-2 text-center">
                Tulis
              </th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((res) => {
              const others = res.actions.filter((a) => !(MAIN_ACTIONS as readonly string[]).includes(a));
              return (
                <tr key={res.resource} className="border-t border-line-soft align-middle">
                  <th scope="row" className="px-2.5 py-2 text-left font-normal text-ink-900">
                    <span className="flex flex-col gap-1.5">
                      <span>{res.label}</span>
                      {others.length > 0 && (
                        <span className="flex flex-wrap gap-1.5">
                          {others.map((action) => (
                            <span key={action}>{cell(res, action, true)}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </th>
                  {MAIN_ACTIONS.map((action) => (
                    <td key={action} className="p-0 text-center">
                      {res.actions.includes(action) ? (
                        cell(res, action, false)
                      ) : (
                        <span className="text-ink-400">
                          <span aria-hidden="true">·</span>
                          <span className="sr-only">tidak berlaku</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="text-caption text-ink-500">
        Semua = seluruh RS · Unit = unit kerja sendiri · Relasi = pasien yang dirawat atau akses darurat · — =
        ditolak · · = aksi tidak berlaku untuk modul
      </span>
      {canWrite && dirty > 0 && (
        <span className="text-caption text-warning">
          Klik sel untuk mengganti izin. Sel berlatar kuning belum disimpan.
        </span>
      )}
      {canWrite && dirty > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-warning-border bg-white px-4 py-3">
          <span className="flex flex-col">
            <span className="font-semibold">{dirty} perubahan belum disimpan</span>
            <span className="text-caption text-ink-500">
              Perubahan kebijakan akses dicatat di jejak audit beserta nama Anda.
            </span>
          </span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setGrants(base)} disabled={saving}>
              Batalkan
            </Button>
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Menyimpan…' : 'Simpan perubahan'}
            </Button>
          </span>
        </div>
      )}
      <ErrorText message={result.error} />
    </div>
  );
}

interface Rule {
  title: string;
  desc: string;
  on: boolean;
}

/**
 * Aturan kontekstual (mockup Akses) yang BERLAKU untuk peran ini, diturunkan dari matriksnya. Di mockup berupa
 * sakelar; di sini hanya status, karena ABAC unit/relasi dan break-the-glass beralasan adalah prinsip yang tidak boleh
 * dimatikan (CLAUDE.md §4.4) dan pasien rahasia selalu menjadi temuan audit.
 */
function contextRules(role: MatrixRole): Rule[] {
  const scoped = role.permissions.filter((p) => p.scope !== 'all').length;
  const breakGlass = role.permissions.some((p) => p.resource === 'break_glass' && p.action === 'use');
  const bulk = role.permissions.some((p) => p.action === 'export' || p.action === 'print');
  return [
    {
      title: 'Akses hanya pasien di unit sendiri atau yang dirawat',
      desc:
        scoped > 0
          ? `Relasi pasien–unit dicek saat membuka rekam medis (${scoped} izin berlingkup Unit/Relasi).`
          : 'Peran ini tidak memakai lingkup Unit/Relasi: izinnya seluruh RS atau ditolak.',
      on: scoped > 0,
    },
    {
      title: 'Break-the-glass dengan alasan',
      desc: breakGlass
        ? 'Akses darurat di luar unit: wajib alasan, berbatas waktu, notifikasi ke petugas privasi.'
        : 'Peran ini tidak bisa membuka akses darurat.',
      on: breakGlass,
    },
    {
      title: 'Pasien rahasia (VIP, kasus sensitif)',
      desc: 'Setiap akses ke rekam medis pasien rahasia menjadi temuan di jejak audit untuk ditinjau.',
      on: true,
    },
    {
      title: 'Ekspor dan cetak',
      desc: bulk
        ? 'Diizinkan untuk peran ini; setiap ekspor dan cetak tercatat di audit.'
        : 'Nonaktif untuk peran ini.',
      on: bulk,
    },
  ];
}

function ContextRules({ role }: { role: MatrixRole }) {
  return (
    <section
      aria-labelledby="aturan-kontekstual"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-[18px] py-4"
    >
      <h3 id="aturan-kontekstual" className="m-0 text-body font-semibold">
        Aturan kontekstual
      </h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {contextRules(role).map((r) => (
          <li key={r.title} className="flex items-start justify-between gap-3">
            <span className="flex flex-col">
              <span className="font-medium">{r.title}</span>
              <span className="text-caption text-ink-500">{r.desc}</span>
            </span>
            <span
              className={cx(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-[3px] text-caption font-semibold',
                r.on ? 'bg-brand-50 text-brand-700' : 'bg-muted text-ink-500',
              )}
            >
              <Icon name={r.on ? 'check' : 'x'} size={12} strokeWidth={2.4} />
              {r.on ? 'Berlaku' : 'Tidak berlaku'}
            </span>
          </li>
        ))}
      </ul>
      <span className="text-caption text-ink-500">
        Aturan mengikuti matriks izin peran dan ditegakkan API; tidak bisa dimatikan terpisah.
      </span>
    </section>
  );
}

/**
 * Detail peran (mockup Akses, panel kanan): kepala kartu peran, matriks izin per modul (Lihat · Tulis · aksi lain),
 * bilah simpan, dan aturan kontekstual. Hanya katalog yang berlaku untuk jenis tenant ini.
 */
export function RoleMatrix({
  roles,
  catalog,
  initialCode,
  canWrite,
  lockedByRole,
  selectedUser,
  auditHref,
}: {
  roles: MatrixRole[];
  catalog: MatrixResource[];
  initialCode: string;
  canWrite: boolean;
  lockedByRole: Record<string, string[]>;
  /** "Nama · unit" pengguna terpilih di daftar (peran awal = penugasan pertamanya). */
  selectedUser?: string;
  /** Tautan jejak audit perubahan akses; null bila peran pengguna tidak boleh membaca audit. */
  auditHref: string | null;
}) {
  const [code, setCode] = useState(initialCode);
  const [dirty, setDirty] = useState(0);
  const [saved, setSaved] = useState<{ code: string; at: string; changes: number } | null>(null);
  const role = roles.find((r) => r.code === code) ?? roles[0];
  if (!role) return null;
  // Editor dibuat ulang saat peran atau data tersimpan berubah, sehingga suntingan lama tidak terbawa.
  const signature = role.permissions.map((p) => `${p.resource}.${p.action}:${p.scope}`).join(',');
  const meta = [
    `${role.permissions.length} izin`,
    role.isSystem ? 'peran bawaan' : 'peran khusus RS',
    role.code === initialCode && selectedUser ? `pengguna terpilih: ${selectedUser}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card">
        <div className="flex flex-col gap-1.5 border-b border-[rgba(23,32,46,0.06)] bg-card-header px-[18px] py-4">
          {/* Label terpisah (htmlFor): nama aksesibel tepat "Peran", tanpa ikut teks opsi terpilih. */}
          <label htmlFor="matriks-peran" className="text-caption text-ink-500">
            Peran
          </label>
          <select
            id="matriks-peran"
            value={role.code}
            onChange={(e) => {
              setCode(e.target.value);
              setSaved(null);
            }}
            disabled={dirty > 0}
            aria-describedby={dirty > 0 ? 'matriks-terkunci' : 'matriks-meta'}
            className={cx(selectClass, 'h-11 text-[16px] font-bold')}
          >
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          <span id="matriks-meta" className="text-small text-ink-700">
            {meta}
          </span>
          {dirty > 0 && (
            <span id="matriks-terkunci" className="text-caption text-warning">
              Simpan atau batalkan perubahan dulu sebelum berganti peran.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 px-[18px] py-3.5">
          <h2 className="m-0 text-small font-semibold">Matriks izin per modul</h2>
          <Editor
            key={`${role.code}:${signature}`}
            role={role}
            catalog={catalog}
            canWrite={canWrite}
            locked={new Set(lockedByRole[role.code] ?? [])}
            onDirty={setDirty}
            onSaved={(s) => setSaved({ code: role.code, ...s })}
          />
        </div>
      </div>
      {saved?.code === role.code && dirty === 0 && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-[12px] border border-success-border bg-alert-success px-4 py-3"
        >
          <span className="font-bold text-success">Tersimpan pukul {saved.at}</span>
          <span className="text-small text-ink-700">
            {saved.changes} perubahan izin tercatat di jejak audit.{' '}
            {auditHref && (
              <Link href={auditHref} className="font-semibold">
                Lihat di jejak audit
              </Link>
            )}
          </span>
        </div>
      )}
      <ContextRules role={role} />
    </div>
  );
}
