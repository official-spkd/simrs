import {
  ACCESS_ADMIN_GRANTS,
  formatTanggal,
  formatTanggalWaktu,
  permissionAllowedFor,
  PROTECTED_ROLES,
} from '@simrs/shared';
import { Alert, Button, Card, Chip, cx, Icon, KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import {
  type AccountStatus,
  accountStatus,
  type AksesParams,
  aksesHref,
  deviceLabel,
  formatLastLogin,
  NOT_ACTIVATED_HINT,
  STATUS_FILTERS,
  statusFilterParam,
} from '@/lib/akses';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import {
  type AccessSummary,
  rolesSchema,
  summarySchema,
  type UserDetail,
  userDetailSchema,
  userPageSchema,
  type UserRow,
  unitsSchema,
} from '@/lib/server/iam';
import { requireSession } from '@/lib/server/session';
import { can, initials, type SessionView } from '@/lib/session-view';
import { AddAssignment, EndAssignment } from './assignment-forms';
import { InviteUser } from './invite-user';
import { RevokeDevice } from './device-revoke';
import { inputClass, selectClass } from './styles';
import { RoleMatrix } from './role-matrix';
import { UserActions } from './user-actions';
import { ContactForm } from './contact-form';

export const metadata: Metadata = { title: 'Pengguna dan akses' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const paramsSchema = z.object({
  q: z.string().trim().min(2).max(60).optional().catch(undefined),
  peran: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,40}$/)
    .optional()
    .catch(undefined),
  status: z
    .enum(STATUS_FILTERS.map((f) => f.value) as [string, ...string[]])
    .optional()
    .catch(undefined),
  kursor: z.uuid().optional().catch(undefined),
  pengguna: z.uuid().optional().catch(undefined),
});

const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/**
 * P03 · Pengguna dan akses (design/mockups/Akses.dc.html). Hak baca daftar = `iam.users.read`; tombol ubah hanya
 * tampil dengan `iam.users.write`/`iam.roles.write`, dan setiap perubahan tetap ditegakkan + diaudit API.
 */
export default async function AksesPage({ searchParams }: { searchParams: SearchParams }) {
  const s = await requireSession();
  if (!can(s, 'iam.users', 'read')) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="m-0 text-h1 font-semibold">Pengguna dan peran</h1>
        <Alert level="warning" title="Akses ditolak">
          Peran Anda tidak berizin melihat daftar pengguna. Hubungi admin SIM RS bila perlu.
        </Alert>
      </div>
    );
  }
  const sp = await searchParams;
  const params = paramsSchema.parse(
    Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, typeof v === 'string' ? v : undefined])),
  );
  const current: AksesParams = params;
  const canWriteUsers = can(s, 'iam.users', 'write');
  const canReadRoles = can(s, 'iam.roles', 'read');

  const list = new URLSearchParams({ limit: '50' });
  if (params.q) list.set('search', params.q);
  if (params.peran) list.set('role', params.peran);
  const status = statusFilterParam(params.status);
  if (status) list.set('status', status);
  if (params.kursor) list.set('cursor', params.kursor);

  const [summary, page, rolesData, units, detail] = await Promise.all([
    api('/api/v1/iam/summary', { schema: summarySchema }),
    api(`/api/v1/iam/users?${list.toString()}`, { schema: userPageSchema }),
    canReadRoles ? api('/api/v1/iam/roles', { schema: rolesSchema }) : Promise.resolve(null),
    canWriteUsers && can(s, 'facility', 'read')
      ? api('/api/v1/facility/units?limit=200', { schema: unitsSchema })
      : Promise.resolve(null),
    params.pengguna
      ? api(`/api/v1/iam/users/${params.pengguna}`, { schema: userDetailSchema }).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        })
      : Promise.resolve(null),
  ]);

  const roleOptions = (rolesData?.roles ?? [])
    .filter((r) => r.active)
    .map((r) => ({ value: r.code, label: r.name }));
  const unitOptions = (units?.items ?? []).map((u) => ({ value: u.id, label: u.name }));
  // Izin platform hanya di tenant PLATFORM; izin khusus perangkat (anjungan, display) tidak pernah untuk peran.
  const catalog = (rolesData?.catalog ?? []).filter((c) => permissionAllowedFor(s.tenant.kind, c.resource));
  const lockedKeys = ACCESS_ADMIN_GRANTS.map(([r, a]) => `${r}|${a}`);
  const lockedByRole = Object.fromEntries(PROTECTED_ROLES.map((code) => [code, lockedKeys]));
  const matrixInitial = detail?.assignments[0]?.roleCode ?? params.peran ?? rolesData?.roles[0]?.code ?? '';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Sistem / Pengguna dan akses</span>
          <h1 className="m-0 text-h1 font-semibold">Pengguna dan peran</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/sistem/akses/perangkat" className="text-small font-semibold">
            Perangkat anjungan dan display
          </Link>
          {canWriteUsers && <InviteUser roles={roleOptions} units={unitOptions} />}
        </div>
      </header>

      <Kpis summary={summary} />

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label="Daftar pengguna"
          className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-card border border-line bg-card"
        >
          <form
            method="get"
            action="/sistem/akses"
            className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3.5"
          >
            <label htmlFor="cari-pengguna" className="sr-only">
              Cari pengguna
            </label>
            <input
              id="cari-pengguna"
              type="search"
              name="q"
              defaultValue={params.q}
              placeholder="Cari nama, NIP, email"
              className={cx(inputClass, 'min-w-0 flex-[1_1_160px]')}
            />
            {roleOptions.length > 0 && (
              <>
                <label htmlFor="filter-peran" className="sr-only">
                  Peran
                </label>
                <select
                  id="filter-peran"
                  name="peran"
                  defaultValue={params.peran ?? ''}
                  className={selectClass}
                >
                  <option value="">Semua peran</option>
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="filter-status" className="sr-only">
              Status
            </label>
            <select
              id="filter-status"
              name="status"
              defaultValue={params.status ?? ''}
              className={selectClass}
            >
              <option value="">Semua status</option>
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm">
              Terapkan
            </Button>
          </form>
          <UserTable rows={page.items} current={current} selected={params.pengguna} />
          <nav
            aria-label="Halaman daftar pengguna"
            className="flex justify-between gap-3 px-4 py-3 text-small"
          >
            {params.kursor ? (
              <Link href={aksesHref(current, { kursor: undefined })}>← Ke awal</Link>
            ) : (
              <span />
            )}
            {page.nextCursor ? (
              <Link href={aksesHref(current, { kursor: page.nextCursor, pengguna: undefined })}>
                Berikutnya →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </section>

        <aside
          aria-label="Detail pengguna dan peran"
          className="flex max-w-[460px] flex-[1_1_380px] flex-col gap-4"
        >
          {detail && (
            <UserPanel
              user={detail}
              session={s}
              canWrite={canWriteUsers}
              roles={roleOptions}
              units={unitOptions}
            />
          )}
          {rolesData && catalog.length > 0 && (
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="m-0 text-h2 font-semibold">Matriks izin per peran</h2>
                <span className="text-caption text-ink-500">
                  Klik sel untuk mengganti lingkup. Berlaku di permintaan berikutnya untuk semua pemegang
                  peran.
                </span>
              </div>
              <RoleMatrix
                roles={rolesData.roles
                  .filter((r) => r.active)
                  .map(({ code, name, isSystem, permissions }) => ({ code, name, isSystem, permissions }))}
                catalog={catalog}
                initialCode={matrixInitial}
                canWrite={can(s, 'iam.roles', 'write')}
                lockedByRole={lockedByRole}
              />
            </Card>
          )}
          {(summary.mfaMissing > 0 || summary.dormant > 0) && (
            <Alert level="warning">
              {summary.mfaMissing} akun belum aktif MFA dan {summary.dormant} akun tidak dipakai lebih dari{' '}
              {summary.dormantDays} hari. Tinjau sebelum reviu akses bulanan (MRMIK 2.1c).
            </Alert>
          )}
          {summary.notActivated > 0 && (
            <Alert level="info">
              {summary.notActivated} akun belum diaktifkan (belum punya kata sandi). Pilih akunnya lalu{' '}
              &ldquo;Reset kata sandi&rdquo; untuk mengaktifkan.{' '}
              <Link href={aksesHref(current, { status: 'belum-diaktifkan', kursor: undefined })}>
                Tampilkan daftarnya
              </Link>
            </Alert>
          )}
        </aside>
      </div>
    </div>
  );
}

function Kpis({ summary }: { summary: AccessSummary }) {
  const mfaPct = summary.active > 0 ? ((summary.active - summary.mfaMissing) / summary.active) * 100 : 100;
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <KpiCard label="Pengguna aktif" value={summary.active} hint={`dari ${summary.total} akun`} />
      <KpiCard
        label="MFA aktif"
        value={`${percent.format(mfaPct)}%`}
        hint={summary.mfaMissing > 0 ? `${summary.mfaMissing} akun belum` : 'semua akun aktif'}
        tone={summary.mfaMissing > 0 ? 'warning' : 'success'}
      />
      <KpiCard
        label="Break-the-glass 7 hari"
        value={summary.breakGlass7d}
        hint={`${summary.breakGlassPending} belum ditinjau`}
        tone={summary.breakGlassPending > 0 ? 'warning' : 'neutral'}
      />
      <KpiCard
        label="Akun dikunci"
        value={summary.locked}
        hint="gagal login berulang"
        tone={summary.locked > 0 ? 'danger' : 'neutral'}
      />
    </div>
  );
}

/** Status akun: teks + ikon (tidak hanya warna). */
function StatusChip({ status }: { status: AccountStatus }) {
  return (
    <Chip tone={status.tone} icon={<Icon name={status.icon} size={13} strokeWidth={2} />}>
      {status.label}
    </Chip>
  );
}

function roleSummary(u: UserRow): { roles: string; units: string } {
  if (u.assignments.length === 0) return { roles: '—', units: '—' };
  return {
    roles: [...new Set(u.assignments.map((a) => a.roleName))].join(', '),
    units: [...new Set(u.assignments.map((a) => a.unitName ?? 'Semua unit'))].join(', '),
  };
}

function UserTable({
  rows,
  current,
  selected,
}: {
  rows: UserRow[];
  current: AksesParams;
  selected?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="m-0 border-t border-line-soft px-4 py-4 text-small text-ink-500">
        Tidak ada pengguna yang cocok dengan pencarian atau filter.
      </p>
    );
  }
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-small">
        <thead className="bg-subtle text-caption font-semibold text-ink-700">
          <tr>
            <th scope="col" className="px-4 py-2.5">
              Pengguna
            </th>
            <th scope="col" className="px-4 py-2.5">
              Peran
            </th>
            <th scope="col" className="px-4 py-2.5">
              Unit
            </th>
            <th scope="col" className="px-4 py-2.5">
              MFA
            </th>
            <th scope="col" className="px-4 py-2.5">
              Login terakhir
            </th>
            <th scope="col" className="px-4 py-2.5">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const on = u.id === selected;
            const st = accountStatus(u);
            const { roles, units } = roleSummary(u);
            return (
              <tr key={u.id} className={cx('border-t border-line-soft', on && 'bg-selected')}>
                <td className="px-4 py-2.5">
                  <Link
                    href={aksesHref(current, { pengguna: u.id })}
                    aria-current={on ? 'true' : undefined}
                    className="flex items-center gap-2.5 text-ink-900 no-underline hover:text-brand-700"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-bold text-ink-700"
                    >
                      {initials(u.displayName)}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="font-semibold">{u.displayName}</span>
                      <span className="font-mono text-caption text-ink-500">{u.username}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-2.5">{roles}</td>
                <td className="px-4 py-2.5 text-ink-700">{units}</td>
                <td
                  className={cx('px-4 py-2.5 font-semibold', u.mfaEnrolled ? 'text-success' : 'text-danger')}
                >
                  {u.mfaEnrolled ? 'Aktif' : 'Belum'}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-ink-700">
                  {formatLastLogin(u.lastLoginAt, now)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <StatusChip status={st} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface Option {
  value: string;
  label: string;
}

function UserPanel({
  user,
  session,
  canWrite,
  roles,
  units,
}: {
  user: UserDetail;
  session: SessionView;
  canWrite: boolean;
  roles: Option[];
  units: Option[];
}) {
  const st = accountStatus(user);
  const self = user.id === session.user.id;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-small font-bold text-brand-700"
        >
          {initials(user.displayName)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="m-0 text-h2 font-semibold">{user.displayName}</h2>
          <span className="font-mono text-caption text-ink-500">{user.username}</span>
          <span className="flex flex-wrap gap-1.5">
            <StatusChip status={st} />
            <Chip tone={user.mfaEnrolled ? 'success' : 'danger'}>
              MFA {user.mfaEnrolled ? 'aktif' : 'belum'}
            </Chip>
            {user.mustChangePassword && <Chip tone="warning">Wajib ganti sandi</Chip>}
          </span>
          <span className="text-caption text-ink-500">
            Login terakhir: {formatLastLogin(user.lastLoginAt)}
            {user.email ? ` · ${user.email}` : ''}
            {user.phone ? ` · HP ${user.phone}` : ''}
          </span>
        </div>
      </div>

      {user.status === 'active' && !user.activated && (
        <Alert level="info" title="Belum diaktifkan">
          {canWrite && !self
            ? NOT_ACTIVATED_HINT
            : 'Akun ini belum punya kata sandi, jadi belum bisa masuk. Admin SIM RS mengaktifkannya lewat "Reset kata sandi".'}
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-small font-semibold">Penugasan</h3>
        {user.assignments.length === 0 ? (
          <span className="text-small text-ink-500">
            Belum ada penugasan aktif; akun ini belum bisa membuka modul apa pun.
          </span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {user.assignments.map((a) => {
              const label = `${a.roleName} · ${a.unitName ?? 'Semua unit'}`;
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line-soft px-3 py-2"
                >
                  <span className="flex flex-col">
                    <span className="text-small font-semibold">{label}</span>
                    <span className="text-caption text-ink-500">
                      {a.pending ? `Mulai ${formatTanggal(a.validFrom)}` : 'Berlaku'}
                      {a.validUntil ? ` · sampai ${formatTanggal(a.validUntil)}` : ''}
                    </span>
                  </span>
                  {canWrite && !self && <EndAssignment assignmentId={a.id} label={label} />}
                </li>
              );
            })}
          </ul>
        )}
        {canWrite && !self && roles.length > 0 && (
          <AddAssignment userId={user.id} roles={roles} units={units} />
        )}
      </div>

      {(user.pinDevices.length > 0 || user.trustedDevices.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <h3 className="m-0 text-small font-semibold">Perangkat</h3>
          <ul aria-label="Perangkat akun" className="m-0 flex list-none flex-col gap-2 p-0">
            {user.pinDevices.map((d) => {
              const label = `${d.name} (${d.roleName}${d.unitName ? ` · ${d.unitName}` : ''})`;
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line-soft px-3 py-2"
                >
                  <span className="flex flex-col">
                    <span className="text-small font-semibold">PIN masuk cepat · {label}</span>
                    <span className="text-caption text-ink-500">
                      Terakhir dipakai {formatLastLogin(d.lastUsedAt)} · berlaku sampai{' '}
                      {formatTanggal(d.expiresAt)}
                    </span>
                  </span>
                  {canWrite && !self && <RevokeDevice kind="pin" deviceId={d.id} label={label} />}
                </li>
              );
            })}
            {user.trustedDevices.map((d) => {
              const label = deviceLabel(d.userAgent);
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line-soft px-3 py-2"
                >
                  <span className="flex flex-col">
                    <span className="text-small font-semibold">Perangkat tepercaya · {label}</span>
                    <span className="text-caption text-ink-500">
                      Terakhir dipakai {formatLastLogin(d.lastUsedAt ?? d.createdAt)} · berlaku sampai{' '}
                      {formatTanggalWaktu(d.expiresAt)}
                    </span>
                  </span>
                  {canWrite && !self && <RevokeDevice kind="trusted" deviceId={d.id} label={label} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <h3 className="m-0 text-small font-semibold">Kontak notifikasi</h3>
          <ContactForm key={user.id} userId={user.id} email={user.email} maskedPhone={user.phone} />
        </div>
      )}

      {canWrite && !self && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <h3 className="m-0 text-small font-semibold">Tindakan akun</h3>
          <UserActions
            userId={user.id}
            username={user.username}
            displayName={user.displayName}
            active={user.status === 'active'}
            activated={user.activated}
          />
        </div>
      )}
      {self && (
        <span className="text-caption text-ink-500">
          Ini akun Anda sendiri. Penugasan dan keamanannya diubah oleh admin lain, bukan lewat layar ini.
        </span>
      )}
    </Card>
  );
}
