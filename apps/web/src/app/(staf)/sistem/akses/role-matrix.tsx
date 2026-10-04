'use client';

import type { PermissionScope } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useEffect, useMemo, useState, useTransition } from 'react';
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
import { Done, ErrorText } from './parts';
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

const SCOPE_STYLE: Record<PermissionScope | 'none', string> = {
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
  onSaved: (message: string) => void;
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
      if (r.ok)
        onSaved(`Tersimpan pukul ${r.savedAt} · ${r.changes} perubahan izin tercatat di jejak audit.`);
      else setResult(r);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-control border border-line text-small">
        {catalog.map((res) => (
          <div
            key={res.resource}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft px-2.5 py-2 first:border-t-0"
          >
            <span className="min-w-[160px] flex-1 text-ink-900">{res.label}</span>
            <span className="flex flex-wrap gap-1.5">
              {res.actions.map((action) => {
                const key = `${res.resource}|${action}`;
                const scope = grants[key] ?? null;
                const changed = (base[key] ?? null) !== scope;
                const isLocked = locked.has(key);
                const text = `${ACTION_LABEL[action] ?? action}: ${scope ? SCOPE_LABEL[scope] : '—'}`;
                const style = cx(
                  'inline-flex min-h-8 items-center rounded-full border px-2.5 text-caption font-semibold',
                  SCOPE_STYLE[scope ?? 'none'],
                  changed ? 'border-[#F5B450] ring-2 ring-[#F5B450]/40' : 'border-line',
                );
                if (!canWrite || isLocked) {
                  return (
                    <span
                      key={key}
                      className={style}
                      title={
                        isLocked ? 'Tidak bisa dicabut dari peran admin' : SCOPE_MEANING[scope ?? 'none']
                      }
                    >
                      {text}
                    </span>
                  );
                }
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key)}
                    className={cx(style, 'cursor-pointer')}
                    aria-label={`${res.label}, ${ACTION_LABEL[action] ?? action}: ${SCOPE_MEANING[scope ?? 'none']}. Klik untuk mengganti.`}
                  >
                    {text}
                  </button>
                );
              })}
            </span>
          </div>
        ))}
      </div>
      <span className="text-caption text-ink-500">
        Semua = seluruh RS · Unit = unit kerja sendiri · Relasi = pasien yang dirawat atau akses darurat · — =
        ditolak
      </span>
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

/** Matriks izin per peran (mockup Akses, panel kanan). Hanya katalog yang berlaku untuk jenis tenant ini. */
export function RoleMatrix({
  roles,
  catalog,
  initialCode,
  canWrite,
  lockedByRole,
}: {
  roles: MatrixRole[];
  catalog: MatrixResource[];
  initialCode: string;
  canWrite: boolean;
  lockedByRole: Record<string, string[]>;
}) {
  const [code, setCode] = useState(initialCode);
  const [dirty, setDirty] = useState(0);
  const [saved, setSaved] = useState<{ code: string; message: string } | null>(null);
  const role = roles.find((r) => r.code === code) ?? roles[0];
  if (!role) return null;
  // Editor dibuat ulang saat peran atau data tersimpan berubah, sehingga suntingan lama tidak terbawa.
  const signature = role.permissions.map((p) => `${p.resource}.${p.action}:${p.scope}`).join(',');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {/* Label terpisah (htmlFor): nama aksesibel tepat "Peran", tanpa ikut teks opsi terpilih. */}
        <label htmlFor="matriks-peran" className="text-small font-semibold text-ink-700">
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
          aria-describedby={dirty > 0 ? 'matriks-terkunci' : undefined}
          className={selectClass}
        >
          {roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {dirty > 0 && (
        <span id="matriks-terkunci" className="text-caption text-warning">
          Simpan atau batalkan perubahan dulu sebelum berganti peran.
        </span>
      )}
      <Editor
        key={`${role.code}:${signature}`}
        role={role}
        catalog={catalog}
        canWrite={canWrite}
        locked={new Set(lockedByRole[role.code] ?? [])}
        onDirty={setDirty}
        onSaved={(message) => setSaved({ code: role.code, message })}
      />
      {saved?.code === role.code && dirty === 0 && <Done message={saved.message} />}
    </div>
  );
}
