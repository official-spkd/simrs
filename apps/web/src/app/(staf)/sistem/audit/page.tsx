import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_LABEL,
  formatJam,
  formatTanggal,
  formatTanggalWaktu,
  PLATFORM_ROLES,
  SYSTEM_ROLES,
} from '@simrs/shared';
import { Alert, Card, Chip, cx } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import {
  actionLabelOf,
  actionTone,
  type AuditParams,
  auditHref,
  chainCheckSummary,
  deviceLabel,
  FINDING_KIND_LABEL,
  formatWaktuServer,
  formatWaktuSingkat,
  objectLabel,
  RENTANG,
  type Rentang,
  rangeDays,
  rangeStart,
  REVIEW_LABEL,
  type ReviewHistoryItem,
  reviewHistoryRows,
  roleLabel,
  tanggalWib,
} from '@/lib/audit';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import {
  anomaliesSchema,
  type AuditEventDetail,
  type AuditEventRow,
  auditDetailSchema,
  auditPageSchema,
  type Finding,
  type FormChange,
  type Grant,
  grantListSchema,
  grantSchema,
  type ReviewHistory,
  reviewHistorySchema,
  verifySchema,
} from '@/lib/server/audit';
import { requireSession } from '@/lib/server/session';
import { can, type SessionView } from '@/lib/session-view';
import { ReopenReview, ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'Jejak audit' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const groupKeys = Object.keys(AUDIT_ACTION_GROUPS) as [keyof typeof AUDIT_ACTION_GROUPS];
const paramsSchema = z.object({
  rentang: z.enum(Object.keys(RENTANG) as [Rentang]).catch('7-hari'),
  jenis: z.enum(groupKeys).optional().catch(undefined),
  peran: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,40}$/)
    .optional()
    .catch(undefined),
  pasien: z.uuid().optional().catch(undefined),
  pengguna: z.uuid().optional().catch(undefined),
  kursor: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional()
    .catch(undefined),
  kejadian: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional()
    .catch(undefined),
  tinjau: z.uuid().optional().catch(undefined),
  temuan: z.string().max(120).optional().catch(undefined),
  laporan: z.iso.date().optional().catch(undefined),
  /** `1` = dari titik periksa jangkar terakhir (cepat), `penuh` = hitung ulang seluruh rantai (ADR-0072). */
  verifikasi: z.enum(['1', 'penuh']).optional().catch(undefined),
  semua: z.literal('1').optional().catch(undefined),
});

/** Kartu temuan yang tampil sebelum "Tampilkan semua". */
const FINDINGS_SHOWN = 5;

const notFoundAsNull = (err: unknown) => {
  if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
  throw err;
};

/**
 * P04 · Jejak audit (design/mockups/Audit.dc.html). Baca = `audit.read`; tinjau temuan = `audit.review`; tinjau
 * akses darurat = `break_glass.review`; unduh paket bukti = `audit.export`. Membuka layar ini juga diaudit.
 */
export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const s = await requireSession();
  if (!can(s, 'audit', 'read')) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="m-0 text-h1 font-semibold">Jejak audit</h1>
        <Alert level="warning" title="Akses ditolak">
          Peran Anda tidak berizin membaca jejak audit. Hubungi admin SIM RS bila perlu.
        </Alert>
      </div>
    );
  }
  const raw = await searchParams;
  const p = paramsSchema.parse(
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v : undefined])),
  );
  // `verifikasi` berlaku sekali (pemeriksaan rantai membebani server), tidak ikut terbawa ke tautan lain.
  const { verifikasi: _verifikasi, ...sticky } = p;
  const current: AuditParams = sticky;
  const canReviewGrants = can(s, 'break_glass', 'review');

  const list = new URLSearchParams({ limit: '50', from: rangeStart(p.rentang).toISOString() });
  if (p.jenis) list.set('group', p.jenis);
  if (p.peran) list.set('actorRole', p.peran);
  if (p.pasien) list.set('patientId', p.pasien);
  if (p.pengguna) list.set('actorUserId', p.pengguna);
  if (p.kursor) list.set('cursor', p.kursor);
  const reportDate = p.laporan ?? tanggalWib();
  const isFinding = (f: Finding) => f.key === p.temuan && f.grantId === null;

  const anomaliesReq = api(`/api/v1/audit/anomalies?days=${rangeDays(p.rentang)}`, {
    schema: anomaliesSchema,
  });
  // Riwayat tinjauan hanya untuk temuan yang benar-benar tampil; pembukaannya diaudit per temuan oleh API.
  const historyReq = anomaliesReq.then((a) =>
    p.temuan && a.findings.some(isFinding)
      ? api(`/api/v1/audit/anomalies/reviews?key=${encodeURIComponent(p.temuan)}`, {
          schema: reviewHistorySchema,
        })
      : null,
  );
  const [page, anomalies, detail, grant, report, chain, history] = await Promise.all([
    api(`/api/v1/audit/events?${list.toString()}`, { schema: auditPageSchema }),
    anomaliesReq,
    p.kejadian
      ? api(`/api/v1/audit/events/${p.kejadian}`, { schema: auditDetailSchema }).catch(notFoundAsNull)
      : Promise.resolve(null),
    p.tinjau && canReviewGrants
      ? api(`/api/v1/authz/break-glass/${p.tinjau}`, { schema: grantSchema }).catch(notFoundAsNull)
      : Promise.resolve(null),
    canReviewGrants
      ? api(`/api/v1/authz/break-glass?pending=false&limit=200&date=${reportDate}`, {
          schema: grantListSchema,
        })
      : Promise.resolve(null),
    p.verifikasi
      ? api(`/api/v1/audit/verify${p.verifikasi === 'penuh' ? '?mode=full' : ''}`, { schema: verifySchema })
      : Promise.resolve(null),
    historyReq,
  ]);
  // Akses darurat ditinjau lewat `tinjau` (panel izin), bukan sebagai temuan biasa.
  const finding = anomalies.findings.find(isFinding) ?? null;
  const roleOptions = Object.entries(s.tenant.kind === 'platform' ? PLATFORM_ROLES : SYSTEM_ROLES);
  const pending = anomalies.findings.filter((f) => f.review === null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Sistem / Jejak audit</span>
          <h1 className="m-0 text-h1 font-semibold">Jejak audit rekam medis</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-caption text-ink-500">Log bersifat append-only dan tidak dapat diubah</span>
          <Link
            href={auditHref(current, { verifikasi: '1' })}
            className="inline-flex h-11 items-center rounded-control border border-line-strong bg-white px-3.5 font-medium text-ink-900 no-underline"
          >
            Periksa keutuhan rantai
          </Link>
          {can(s, 'audit', 'export') && (
            <a
              href={exportHref(p)}
              className="inline-flex h-11 items-center rounded-control border border-line-strong bg-white px-3.5 font-semibold text-ink-900 no-underline"
            >
              Unduh paket bukti akreditasi
            </a>
          )}
        </div>
      </header>

      {chain && (
        <ChainAlert
          summary={chainCheckSummary(chain, formatJam)}
          full={chain.mode === 'full'}
          current={current}
        />
      )}

      <Filters p={p} current={current} roles={roleOptions} />

      {p.pasien && <PatientAccessSummary rows={page.items} more={Boolean(page.nextCursor)} />}

      {anomalies.findings.length > 0 ? (
        <Findings
          findings={anomalies.findings}
          pendingCount={pending.length}
          current={current}
          days={anomalies.days}
          showAll={p.semua === '1'}
        />
      ) : (
        <p className="m-0 text-small text-ink-500">
          Tidak ada temuan anomali dalam {rangeDays(p.rentang)} hari terakhir.
        </p>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label="Log aktivitas"
          className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-card border border-line bg-card"
        >
          <EventTable rows={page.items} current={current} selected={p.kejadian} />
          <nav aria-label="Halaman log" className="flex justify-between gap-3 px-4 py-3 text-small">
            {p.kursor ? <Link href={auditHref(current, { kursor: undefined })}>← Terbaru</Link> : <span />}
            {page.nextCursor ? (
              <Link href={auditHref(current, { kursor: page.nextCursor, kejadian: undefined })}>
                Lebih lama →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </section>
        <aside aria-label="Detail" className="flex max-w-[440px] flex-[1_1_360px] flex-col gap-4">
          {grant ? (
            <GrantPanel grant={grant} session={s} />
          ) : finding ? (
            <FindingPanel finding={finding} history={history} session={s} current={current} />
          ) : detail ? (
            <EventPanel event={detail} />
          ) : (
            <Card className="p-4 text-small text-ink-500">
              Pilih baris log atau temuan untuk melihat detailnya.
            </Card>
          )}
        </aside>
      </div>

      {report && <BreakGlassReport grants={report} date={reportDate} current={current} />}
    </div>
  );
}

function exportHref(p: z.infer<typeof paramsSchema>): string {
  const q = new URLSearchParams({ rentang: p.rentang });
  if (p.jenis) q.set('jenis', p.jenis);
  if (p.peran) q.set('peran', p.peran);
  if (p.pasien) q.set('pasien', p.pasien);
  if (p.pengguna) q.set('pengguna', p.pengguna);
  return `/sistem/audit/ekspor?${q.toString()}`;
}

/** Hasil pemeriksaan keutuhan (ADR-0072): temuan per baris, dan tautan pemeriksaan penuh bila belum penuh. */
function ChainAlert({
  summary,
  full,
  current,
}: {
  summary: ReturnType<typeof chainCheckSummary>;
  full: boolean;
  current: AuditParams;
}) {
  return (
    <Alert level={summary.level} title={summary.title}>
      {/* Alert membungkus isi dengan <span>: pakai span blok, bukan <p>/<div>. */}
      <span className="flex flex-col gap-1.5">
        <span>{summary.text}</span>
        {summary.lines.length > 0 && (
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {summary.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {!full && (
          <span>
            <Link href={auditHref(current, { verifikasi: 'penuh' })} className="font-semibold">
              Periksa penuh (hitung ulang seluruh rantai)
            </Link>
          </span>
        )}
      </span>
    </Alert>
  );
}

const controlClass =
  'h-11 rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-ink-900';

function Filters({
  p,
  current,
  roles,
}: {
  p: z.infer<typeof paramsSchema>;
  current: AuditParams;
  roles: Array<[string, string]>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <form method="get" action="/sistem/audit" className="flex flex-wrap items-center gap-2.5">
        {p.jenis && <input type="hidden" name="jenis" value={p.jenis} />}
        {p.pengguna && <input type="hidden" name="pengguna" value={p.pengguna} />}
        <label htmlFor="audit-pasien" className="sr-only">
          ID pasien
        </label>
        <input
          id="audit-pasien"
          name="pasien"
          defaultValue={p.pasien}
          placeholder="ID pasien (pencarian nama hadir bersama MPI)"
          className={cx(controlClass, 'min-w-0 flex-[1_1_240px] px-3')}
        />
        <label htmlFor="audit-rentang" className="sr-only">
          Rentang waktu
        </label>
        <select id="audit-rentang" name="rentang" defaultValue={p.rentang} className={controlClass}>
          {Object.entries(RENTANG).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="audit-peran" className="sr-only">
          Peran pengguna
        </label>
        <select id="audit-peran" name="peran" defaultValue={p.peran ?? ''} className={controlClass}>
          <option value="">Semua peran</option>
          {roles.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-11 cursor-pointer rounded-control border border-line-strong bg-white px-3.5 font-medium"
        >
          Terapkan
        </button>
      </form>
      <nav aria-label="Jenis aksi" className="flex flex-wrap gap-1.5">
        {[
          ['', 'Semua'] as const,
          ...Object.entries(AUDIT_ACTION_GROUPS).map(([k, v]) => [k, v.label] as const),
        ].map(([key, label]) => {
          const on = (p.jenis ?? '') === key;
          return (
            <Link
              key={key || 'semua'}
              href={auditHref(current, { jenis: key || undefined, kursor: undefined, kejadian: undefined })}
              aria-current={on ? 'true' : undefined}
              className={cx(
                'inline-flex h-11 items-center rounded-full border px-3 text-small no-underline',
                on
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                  : 'border-line bg-white text-ink-900',
              )}
            >
              {label}
            </Link>
          );
        })}
        {p.pengguna && (
          <Link
            href={auditHref(current, { pengguna: undefined, kursor: undefined })}
            className="inline-flex h-11 items-center rounded-full border border-brand-600 bg-brand-50 px-3 text-small font-semibold text-brand-700 no-underline"
          >
            Satu pengguna × hapus
          </Link>
        )}
      </nav>
    </div>
  );
}

function Findings({
  findings,
  pendingCount,
  current,
  days,
  showAll,
}: {
  findings: Finding[];
  pendingCount: number;
  current: AuditParams;
  days: number;
  showAll: boolean;
}) {
  const shown = showAll ? findings : findings.slice(0, FINDINGS_SHOWN);
  return (
    <section aria-label="Temuan anomali" className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      {shown.map((f) => {
        const open = f.review === null;
        const href = f.grantId
          ? auditHref(current, { tinjau: f.grantId, temuan: undefined, kejadian: undefined })
          : auditHref(current, { temuan: f.key, tinjau: undefined, kejadian: undefined });
        return (
          <div
            key={f.key}
            className={cx(
              'flex flex-col gap-1 rounded-card border px-4 py-3.5',
              !open
                ? 'border-success-border bg-white'
                : f.severity === 'tinggi'
                  ? 'border-danger-border bg-[linear-gradient(180deg,var(--color-koral-50),#FFFFFF)]'
                  : 'border-warning-border bg-[linear-gradient(180deg,var(--color-kunyit-50),#FFFFFF)]',
            )}
          >
            <span
              className={cx(
                'text-caption font-bold',
                !open ? 'text-success' : f.severity === 'tinggi' ? 'text-danger' : 'text-warning',
              )}
            >
              {FINDING_KIND_LABEL[f.kind] ?? f.kind}
              {open ? '' : ' · DITINJAU'}
            </span>
            <span className="font-semibold">{f.title}</span>
            <span className="text-small text-ink-700">{f.description}</span>
            <Link href={href} className="mt-1 self-start text-small font-semibold">
              {open ? 'Tinjau dan beri keputusan' : 'Lihat detail'}
            </Link>
          </div>
        );
      })}
      <div className="flex flex-col gap-1 rounded-card border border-line bg-white px-4 py-3.5">
        <span className="text-caption font-bold text-brand-700">RINGKASAN {days} HARI</span>
        <span className="font-semibold">
          {findings.length} temuan · {pendingCount} belum ditinjau
        </span>
        <span className="text-small text-ink-700">
          Temuan dihitung dari jejak audit: akses darurat, gagal masuk berulang, akses ditolak berulang, akses
          data pasien di luar jam dinas, dan volume tak wajar.
        </span>
        {findings.length > FINDINGS_SHOWN && (
          <Link
            href={auditHref(current, { semua: showAll ? undefined : '1' })}
            className="mt-1 self-start text-small font-semibold"
          >
            {showAll ? 'Ringkas daftar temuan' : `Tampilkan semua ${findings.length} temuan`}
          </Link>
        )}
      </div>
    </section>
  );
}

/**
 * Ringkasan pengakses saat log disaring per pasien (mockup Audit "N pengguna mengakses RM pasien ini"). Dihitung dari
 * entri yang sudah dimuat; bila masih ada halaman berikutnya, angkanya ditandai sebagai batas bawah.
 */
function PatientAccessSummary({ rows, more }: { rows: AuditEventRow[]; more: boolean }) {
  const users = new Set(rows.filter((e) => e.actorUserId).map((e) => e.actorUserId));
  const flagged = rows.filter((e) => e.outcome === 'denied' || e.action === 'break_glass').length;
  return (
    <section
      aria-label="Ringkasan pengakses pasien"
      className="flex flex-col gap-1 rounded-card border border-line bg-white px-4 py-3.5"
    >
      <span className="text-caption font-bold text-brand-700">PENGAKSES REKAM MEDIS PASIEN INI</span>
      <span className="font-semibold">
        {more ? 'Sedikitnya ' : ''}
        {users.size} pengguna mengakses RM pasien ini dalam rentang terpilih
      </span>
      <span className="text-small text-ink-700">
        {flagged > 0
          ? `${flagged} entri ditolak atau akses darurat (berlatar merah di log); tinjau temuan terkait di atas.`
          : 'Tidak ada entri ditolak atau akses darurat pada entri yang dimuat.'}
        {more ? ' Muat halaman berikutnya untuk menghitung seluruh entri.' : ''}
      </span>
    </section>
  );
}

function EventTable({
  rows,
  current,
  selected,
}: {
  rows: AuditEventRow[];
  current: AuditParams;
  selected?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="m-0 px-4 py-4 text-small text-ink-500">
        Tidak ada aktivitas yang cocok dengan filter jenis, peran, dan rentang waktu.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-small">
        <thead className="bg-subtle text-caption font-semibold text-ink-700">
          <tr>
            <th scope="col" className="px-4 py-2.5">
              Waktu
            </th>
            <th scope="col" className="px-4 py-2.5">
              Pengguna
            </th>
            <th scope="col" className="px-4 py-2.5">
              Aksi
            </th>
            <th scope="col" className="px-4 py-2.5">
              Objek
            </th>
            <th scope="col" className="px-4 py-2.5">
              Perangkat
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const on = e.seq === selected;
            return (
              <tr
                key={e.seq}
                className={cx(
                  'border-t border-line-soft',
                  on
                    ? 'bg-selected shadow-[inset_3px_0_0_var(--color-brand-600)]'
                    : // Mockup Audit: entri yang patut ditinjau (ditolak, akses darurat) berlatar merah sangat tipis.
                      (e.outcome === 'denied' || e.action === 'break_glass') && 'bg-koral-50',
                )}
              >
                <td className="px-4 py-2.5 whitespace-nowrap font-mono text-[12.5px]">
                  <Link
                    href={auditHref(current, { kejadian: e.seq, tinjau: undefined, temuan: undefined })}
                    aria-current={on ? 'true' : undefined}
                    className="text-ink-900"
                  >
                    {formatWaktuSingkat(e.occurredAt)}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold">
                      {e.actor?.displayName ?? (e.actorUserId ? 'Pengguna' : 'Sistem')}
                    </span>
                    <span className="text-caption text-ink-500">{roleLabel(e.actorRole)}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Chip tone={actionTone(e.action, e.outcome)}>
                    {actionLabelOf(AUDIT_ACTION_LABEL, e.action)}
                  </Chip>
                </td>
                <td className="px-4 py-2.5">{objectLabel(e)}</td>
                <td className="px-4 py-2.5 text-caption text-ink-500">{deviceLabel(e.ip, e.userAgent)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <span className="flex flex-col">
      <span className="text-caption text-ink-500">{label}</span>
      <span className={cx('break-all', mono ? 'font-mono text-caption' : 'font-semibold')}>{children}</span>
    </span>
  );
}

function PanelHead({ sub, title }: { sub: string; title: string }) {
  return (
    <div className="border-b border-line bg-[linear-gradient(100deg,color-mix(in_srgb,_var(--color-brand-600)_8%,_transparent),#FFFFFF_60%)] px-4 py-3.5">
      <span className="text-caption text-ink-500">{sub}</span>
      <h2 className="m-0 mt-0.5 text-[17px] font-bold">{title}</h2>
    </div>
  );
}

function HashInfo({ event }: { event: AuditEventDetail }) {
  return (
    <div className="flex flex-col gap-1 text-caption text-ink-500">
      <span>
        Hash: <span className="font-mono break-all">{event.hash}</span>
      </span>
      <span>
        Hash sebelumnya: <span className="font-mono break-all">{event.prevHash ?? '—'}</span>
      </span>
      <span>Waktu, nomor urut, dan hash diisi server; entri tidak bisa diubah atau dihapus.</span>
    </div>
  );
}

/**
 * Koreksi isian formulir (mockup Audit "Detail koreksi · Versi 1 → versi 2"): alasan wajib, nilai lama/baru per
 * field, penulis asli, dan pengoreksi. Diff dihitung server dari dua versi isian yang tersimpan (append-only).
 */
function CorrectionPanel({ event, change: c }: { event: AuditEventDetail; change: FormChange }) {
  const voided = c.status === 'entered_in_error';
  return (
    <Card className="overflow-hidden">
      <PanelHead
        sub={`Detail koreksi · ${c.formTitle}${c.originalAt ? ` ${formatWaktuSingkat(c.originalAt)}` : ''}`}
        title={`Versi ${c.fromVersion} → versi ${c.toVersion}`}
      />
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-ink-500">
            {voided ? 'ALASAN SALAH ENTRI (WAJIB)' : 'ALASAN KOREKSI (WAJIB)'}
          </span>
          <span>{c.reason ?? '—'}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold text-ink-500">PERUBAHAN</span>
          {voided ? (
            <p className="m-0 rounded-[10px] border border-warning-border bg-warning-bg px-3 py-2.5 text-small">
              Isian ditandai <span className="font-bold">salah entri</span>. Nilai versi {c.fromVersion} tetap
              tersimpan, tetapi tidak dipakai lagi untuk perawatan pasien.
            </p>
          ) : c.rows.length === 0 ? (
            <p className="m-0 text-small text-ink-700">Tidak ada nilai yang berubah.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {c.rows.map((r) => (
                <li key={r.key} className="flex flex-col gap-1.5 text-small">
                  <span className="rounded-[10px] border border-danger-border bg-koral-50 px-3 py-2.5">
                    <span className="font-bold text-danger">− v{c.fromVersion}</span> {r.label}:{' '}
                    <s>{r.before}</s>
                  </span>
                  <span className="rounded-[10px] border border-success-border bg-zamrud-50 px-3 py-2.5">
                    <span className="font-bold text-success">+ v{c.toVersion}</span> {r.label}:{' '}
                    <span className="font-bold">{r.after}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5 text-small">
          <Field label="Penulis asli">{c.originalAuthor ?? '—'}</Field>
          <Field label="Dikoreksi oleh">{c.correctedBy ?? '—'}</Field>
          <Field label="Waktu catat server" mono>
            {formatWaktuSingkat(event.occurredAt)}.{event.occurredAt.slice(17, 19)}
          </Field>
          <Field label="Versi formulir">
            {c.formCode} · v{c.formVersion}
          </Field>
        </div>
        <span className="text-caption text-ink-500">
          Versi {c.fromVersion} tetap tersimpan dan dapat dibuka. Entri final tidak pernah dihapus atau
          ditimpa (MRMIK 8c).
        </span>
        <HashInfo event={event} />
      </div>
    </Card>
  );
}

function EventPanel({ event }: { event: AuditEventDetail }) {
  if (event.change) return <CorrectionPanel event={event} change={event.change} />;
  const details =
    event.details && typeof event.details === 'object' ? JSON.stringify(event.details, null, 2) : null;
  return (
    <Card className="overflow-hidden">
      <PanelHead
        sub={`Detail aktivitas · entri #${event.seq}`}
        title={`${actionLabelOf(AUDIT_ACTION_LABEL, event.action)} · ${objectLabel(event)}`}
      />
      <div className="flex flex-col gap-3.5 px-4 py-4">
        {event.reason && (
          <div className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-ink-500">ALASAN</span>
            <span>{event.reason}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5 text-small">
          <Field label="Pengguna">
            {event.actor?.displayName ?? (event.actorUserId ? 'Pengguna' : 'Sistem')}
          </Field>
          <Field label="Peran">{roleLabel(event.actorRole)}</Field>
          <Field label="Waktu catat server" mono>
            {formatWaktuServer(event.occurredAt)}
          </Field>
          <Field label="Hasil">{event.outcome === 'denied' ? 'Ditolak' : 'Berhasil'}</Field>
          <Field label="Perangkat">{deviceLabel(event.ip, event.userAgent)}</Field>
          <Field label="Request id" mono>
            {event.requestId ?? '—'}
          </Field>
        </div>
        {details && (
          <div className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-ink-500">RINCIAN (TANPA PHI)</span>
            <pre className="m-0 max-h-48 overflow-auto rounded-control bg-subtle px-3 py-2 font-mono text-caption">
              {details}
            </pre>
          </div>
        )}
        <HashInfo event={event} />
      </div>
    </Card>
  );
}

function GrantPanel({ grant, session }: { grant: Grant; session: SessionView }) {
  const own = grant.userId === session.user.id;
  return (
    <Card className="overflow-hidden">
      <PanelHead
        sub={`Akses darurat · ${formatTanggalWaktu(grant.grantedAt)}`}
        title={`Break-the-glass · ${grant.user.displayName}`}
      />
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-ink-500">ALASAN AKSES DARURAT (WAJIB)</span>
          <span>{grant.reason}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 text-small">
          <Field label="Pengguna">{grant.user.displayName}</Field>
          <Field label="Pasien" mono>
            {grant.patientId}
          </Field>
          <Field label="Dibuka" mono>
            {formatWaktuServer(grant.grantedAt)}
          </Field>
          <Field label="Berlaku sampai" mono>
            {formatWaktuServer(grant.expiresAt)}
          </Field>
        </div>
        <ReviewBox
          reviewed={
            grant.reviewOutcome
              ? {
                  outcome: grant.reviewOutcome,
                  note: grant.reviewNote,
                  at: grant.reviewedAt,
                  by: grant.reviewer?.displayName ?? null,
                }
              : null
          }
        >
          {own ? (
            <span className="text-small text-ink-700">
              Akses darurat Anda sendiri ditinjau petugas privasi lain.
            </span>
          ) : (
            <ReviewForm target="break_glass" id={grant.id} />
          )}
        </ReviewBox>
      </div>
    </Card>
  );
}

function FindingPanel({
  finding,
  history,
  session,
  current,
}: {
  finding: Finding;
  history: ReviewHistory | null;
  session: SessionView;
  current: AuditParams;
}) {
  const own = finding.actor?.id === session.user.id;
  const canReview = can(session, 'audit', 'review') && !own;
  return (
    <Card className="overflow-hidden">
      <PanelHead sub={`Temuan · ${FINDING_KIND_LABEL[finding.kind] ?? finding.kind}`} title={finding.title} />
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <span>{finding.description}</span>
        <div className="grid grid-cols-2 gap-2.5 text-small">
          <Field label="Pengguna">{finding.actor?.displayName ?? 'Tidak dikenal'}</Field>
          <Field label="Terakhir" mono>
            {formatWaktuServer(finding.lastAt)}
          </Field>
        </div>
        {finding.actor && (
          <Link
            href={auditHref(current, { pengguna: finding.actor.id, temuan: undefined, kursor: undefined })}
            className="self-start text-small font-semibold"
          >
            Lihat aktivitas pengguna ini
          </Link>
        )}
        <ReviewBox
          reviewed={
            finding.review
              ? {
                  outcome: finding.review.outcome,
                  note: finding.review.note,
                  at: finding.review.reviewedAt,
                  by: finding.review.reviewer?.displayName ?? null,
                }
              : null
          }
          reopen={
            finding.review && canReview ? (
              <ReopenReview key={finding.review.reviewedAt} id={finding.key} />
            ) : null
          }
        >
          {!can(session, 'audit', 'review') ? (
            <span className="text-small text-ink-700">Tinjauan dilakukan oleh petugas privasi.</span>
          ) : own ? (
            <span className="text-small text-ink-700">
              Temuan tentang akun Anda sendiri ditinjau petugas lain.
            </span>
          ) : (
            <ReviewForm target="finding" id={finding.key} />
          )}
        </ReviewBox>
        {history && history.items.length > 0 && <ReviewHistoryList items={history.items} />}
      </div>
    </Card>
  );
}

/** Riwayat tinjauan temuan (terbaru dulu): keputusan yang berlaku ditandai; yang digantikan tetap tampil. */
function ReviewHistoryList({ items }: { items: ReviewHistoryItem[] }) {
  const rows = reviewHistoryRows(items);
  return (
    <section aria-label="Riwayat tinjauan" className="flex flex-col gap-2">
      <span className="text-caption font-semibold text-ink-500">RIWAYAT TINJAUAN ({rows.length})</span>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r) => (
          <li
            key={r.seq}
            className={cx(
              'flex flex-col gap-1 rounded-control border px-3 py-2.5 text-small',
              r.effective ? 'border-success-border bg-zamrud-50' : 'border-line bg-white',
            )}
          >
            <span className="flex flex-wrap items-center gap-2">
              <Chip tone={r.effective ? 'success' : 'neutral'}>{r.status}</Chip>
              <span className="font-semibold">{r.decision}</span>
            </span>
            <span className="text-caption text-ink-500">
              <span className="font-mono">{r.when}</span> · {r.who}
            </span>
            {r.note && <span className="text-ink-700">“{r.note}”</span>}
          </li>
        ))}
      </ol>
      <span className="text-caption text-ink-500">
        Keputusan terbaru yang berlaku. Keputusan sebelumnya tetap tersimpan di jejak audit dan tidak dapat
        dihapus.
      </span>
    </section>
  );
}

function ReviewBox({
  reviewed,
  reopen,
  children,
}: {
  reviewed: { outcome: string; note: string | null; at: string | null; by: string | null } | null;
  /** Untuk yang sudah ditinjau: kontrol "Buka kembali tinjauan" (hanya temuan; akses darurat final). */
  reopen?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex flex-col gap-2 rounded-control border p-3',
        reviewed ? 'border-success-border bg-zamrud-50' : 'border-danger-border bg-koral-50',
      )}
    >
      <span className="text-caption font-semibold text-ink-500">TINJAUAN</span>
      {reviewed ? (
        <>
          <span className="font-semibold text-success">
            Ditinjau{reviewed.at ? ` pukul ${formatJam(reviewed.at)}, ${formatTanggal(reviewed.at)}` : ''}
            {reviewed.by ? ` oleh ${reviewed.by}` : ''} · {REVIEW_LABEL[reviewed.outcome] ?? reviewed.outcome}
          </span>
          {reviewed.note && <span className="text-small text-ink-700">Catatan: {reviewed.note}</span>}
          {reopen}
        </>
      ) : (
        <>
          <span className="font-semibold text-danger">Belum ditinjau</span>
          {children}
        </>
      )}
    </div>
  );
}

function BreakGlassReport({
  grants,
  date,
  current,
}: {
  grants: Grant[];
  date: string;
  current: AuditParams;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-h2 font-semibold">Laporan harian akses darurat</h2>
          <span className="text-caption text-ink-500">
            {formatTanggal(`${date}T12:00:00+07:00`)} · {grants.length} akses · semua wajib ditinjau
          </span>
        </div>
        <form method="get" action="/sistem/audit" className="flex items-center gap-2">
          {Object.entries(current)
            .filter(([k, v]) => v && !['laporan', 'kejadian', 'tinjau', 'temuan', 'kursor'].includes(k))
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <label htmlFor="laporan-tanggal" className="text-small font-semibold text-ink-700">
            Tanggal
          </label>
          <input
            id="laporan-tanggal"
            type="date"
            name="laporan"
            defaultValue={date}
            className={controlClass}
          />
          <button
            type="submit"
            className="h-11 cursor-pointer rounded-control border border-line-strong bg-white px-3.5"
          >
            Tampilkan
          </button>
        </form>
      </div>
      {grants.length === 0 ? (
        <p className="m-0 text-small text-ink-500">Tidak ada akses darurat pada tanggal ini.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-small">
            <thead className="bg-subtle text-caption font-semibold text-ink-700">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Waktu
                </th>
                <th scope="col" className="px-3 py-2">
                  Pengguna
                </th>
                <th scope="col" className="px-3 py-2">
                  Pasien
                </th>
                <th scope="col" className="px-3 py-2">
                  Alasan
                </th>
                <th scope="col" className="px-3 py-2">
                  Tinjauan
                </th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="border-t border-line-soft align-top">
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-caption">
                    {formatJam(g.grantedAt)}
                  </td>
                  <td className="px-3 py-2">{g.user.displayName}</td>
                  <td className="px-3 py-2 font-mono text-caption">{g.patientId.slice(0, 8)}</td>
                  <td className="px-3 py-2">{g.reason}</td>
                  <td className="px-3 py-2">
                    {g.reviewOutcome ? (
                      <Chip tone="success">{REVIEW_LABEL[g.reviewOutcome] ?? g.reviewOutcome}</Chip>
                    ) : (
                      <Link
                        href={auditHref(current, { tinjau: g.id, temuan: undefined, kejadian: undefined })}
                      >
                        Tinjau
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
