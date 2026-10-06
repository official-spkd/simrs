'use client';

import { type CpptEntry, type CpptRole, formatJam } from '@simrs/shared';
import { Button, Chip, cx, FilterChip } from '@simrs/ui';
import { useId, useState } from 'react';
import { saveChartCpptAction, signChartCpptAction } from '@/app/(staf)/klinis/cppt/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  canCorrectCppt,
  CPPT_ROLE_META,
  type CpptFilter,
  cpptMatches,
  cpptNotePayload,
  formatTglJam,
  type SoapText,
  supersededIds,
} from '@/lib/rawat-inap';
import { hasReason } from '@/lib/rme';
import {
  cosignBlocker,
  type CpptSign,
  cpptStatus,
  latestEntries,
  needsVerification,
  RESIDENT_GATE,
  soapAbbreviations,
  submitLabel,
  verifyBlocker,
  versionChain,
} from '@/lib/rme-cppt';
import { Feedback, type FeedbackMsg, ReasonField } from './feedback';

const FILTERS: Array<[CpptFilter, string]> = [
  ['semua', 'Semua PPA'],
  ['dokter', 'Dokter'],
  ['perawat', 'Perawat & bidan'],
  ['lainnya', 'Farmasi & gizi'],
];

const TONE = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-ink-500',
  info: 'text-info',
} as const;

const SOAP_FIELDS: Array<{ k: keyof SoapText; label: string; required: boolean }> = [
  { k: 's', label: 'S · Subjektif', required: true },
  { k: 'o', label: 'O · Objektif', required: false },
  { k: 'a', label: 'A · Asesmen', required: true },
  { k: 'p', label: 'P · Rencana', required: false },
];

type FormState =
  { mode: 'baru' } | { mode: 'koreksi'; target: CpptEntry } | { mode: 'addendum'; target: CpptEntry };

/**
 * K07 · CPPT terintegrasi lintas PPA: tulis SOAP (residen → belum final sampai co-sign DPJP), co-sign dan verifikasi
 * DPJP, koreksi berversi oleh penulis (alasan wajib, versi lama tetap tampil di riwayat), addendum PPA lain. Semua aksi
 * tersimpan di toko demo (`rekam-medis`, ADR-0085) atas nama pengguna sesi; catatan, co-sign, dan verifikasi datang
 * dari server (tampil juga di Rawat inap, Worklist, dan Kelengkapan).
 */
export function CpptWorkspace({
  encounterId,
  entries,
  verified,
  rev,
  user,
  role,
  dpjp,
  actor,
  writerRole,
  canWrite,
  now,
}: {
  encounterId: string;
  entries: readonly CpptEntry[];
  /** Verifikasi DPJP per entri (rekam awal + toko). */
  verified: Readonly<Record<string, CpptSign>>;
  /** Revisi toko `rekam-medis` yang dilihat layar. */
  rev: number;
  user: string;
  /** Kode peran sesi (mis. `dokter`). */
  role: string | null;
  /** DPJP pasien ini: satu-satunya dokter yang co-sign/verifikasi CPPT-nya. */
  dpjp: string;
  /** Dokter yang diperankan posisi aktif (posisi dokter = DPJP persona demo). */
  actor: string;
  /** Profesi penulis CPPT dari peran sesi. */
  writerRole: CpptRole;
  canWrite: boolean;
  now: string;
}) {
  const { run, pending } = useStoreAction(rev);
  const [filter, setFilter] = useState<CpptFilter>('semua');
  const [form, setForm] = useState<FormState | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const old = supersededIds(entries);
  const shown = latestEntries(entries)
    .filter((e) => cpptMatches(e, filter))
    .sort((a, b) => b.writtenAt.localeCompare(a.writtenAt));
  const pendingCosign = latestEntries(entries).filter((e) => e.cosignRequired && !e.cosignedBy).length;
  const pendingVerify = latestEntries(entries).filter((e) => needsVerification(e) && !verified[e.id]).length;

  const save = (soap: SoapText, reason: string | null) => {
    if (!form) return;
    const cur = form;
    const payload = cpptNotePayload(
      encounterId,
      soap,
      cur.mode === 'koreksi'
        ? { kind: 'koreksi', targetId: cur.target.id, reason: reason ?? '' }
        : cur.mode === 'addendum'
          ? { kind: 'addendum', targetId: cur.target.id }
          : { kind: 'baru' },
    );
    run(
      (r) => saveChartCpptAction(payload, r),
      (res) => {
        if (!res.ok || !res.at) return setMsg({ ok: false, text: res.message || 'CPPT belum tersimpan.' });
        const at = res.at;
        setFilter('semua');
        setForm(null);
        setMsg({
          ok: true,
          text:
            cur.mode === 'koreksi'
              ? `Koreksi tersimpan sebagai versi ${res.version ?? cur.target.version + 1} · ${formatJam(at)}; versi lama tetap tersimpan.`
              : cur.mode === 'addendum'
                ? `Addendum tersimpan · ${formatJam(at)}; catatan ${cur.target.author} tidak berubah.`
                : res.role === 'residen'
                  ? `Tersimpan · ${formatJam(at)} · belum final, menunggu co-sign DPJP.`
                  : `Final · ditandatangani ${formatJam(at)}.`,
        });
      },
    );
  };

  const sign = (e: CpptEntry, kind: 'cosign' | 'verify') =>
    run(
      (r) =>
        signChartCpptAction(
          { encounterId, entryId: e.id, kind: kind === 'cosign' ? 'cosign' : 'verifikasi' },
          r,
        ),
      (res) => {
        if (!res.ok || !res.at) return setMsg({ ok: false, text: res.message || 'Tanda tangan gagal.' });
        setMsg({
          ok: true,
          text:
            kind === 'cosign'
              ? `Co-sign DPJP · ${formatJam(res.at)}: CPPT residen ${formatTglJam(e.writtenAt)} kini final.`
              : `Diverifikasi DPJP · ${formatJam(res.at)}: CPPT ${e.author} ${formatTglJam(e.writtenAt)}.`,
        });
      },
    );

  return (
    <section
      aria-label="CPPT terintegrasi"
      className="min-w-0 flex-[1_1_520px] overflow-hidden rounded-card border border-line bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3">
        <div className="flex flex-col">
          <h2 className="m-0 text-body font-semibold">CPPT terintegrasi</h2>
          <span className="text-caption text-ink-500">
            Tulis → tanda tangan → co-sign/verifikasi DPJP · {pendingCosign} menunggu co-sign ·{' '}
            {pendingVerify} menunggu verifikasi
          </span>
        </div>
        <div role="group" aria-label="Filter profesi" className="flex flex-wrap gap-1.5">
          {FILTERS.map(([id, label]) => (
            <FilterChip key={id} selected={filter === id} onClick={() => setFilter(id)}>
              {label}
            </FilterChip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!canWrite}
            aria-expanded={form?.mode === 'baru'}
            aria-describedby={canWrite ? undefined : 'cppt-tulis-why'}
            onClick={() => {
              setForm({ mode: 'baru' });
              setMsg(null);
            }}
          >
            + Tulis CPPT (SOAP)
          </Button>
          <Chip tone="neutral">Sebagai {CPPT_ROLE_META[writerRole].label}</Chip>
          {!canWrite && (
            <span id="cppt-tulis-why" className="text-caption text-ink-500">
              Posisi ini tidak menulis CPPT.
            </span>
          )}
        </div>
        <Feedback msg={msg} />
      </div>
      {form && (
        <SoapForm
          key={form.mode === 'baru' ? 'baru' : `${form.mode}-${form.target.id}`}
          mode={form.mode}
          writerRole={writerRole}
          target={form.mode === 'baru' ? null : form.target}
          busy={pending}
          onSubmit={save}
          onCancel={() => setForm(null)}
        />
      )}
      <ol className="m-0 list-none p-0" aria-label="Catatan CPPT">
        {shown.map((e) => {
          const chain = versionChain(entries, e.id);
          const ver = verified[e.id] ?? null;
          const st = cpptStatus(e, { superseded: false, cosign: null, verified: ver, nowIso: now });
          const who = { role, user, actor, dpjp, superseded: false };
          const cb = cosignBlocker(e, { ...who, cosigned: false });
          const vb = verifyBlocker(e, { ...who, verified: !!ver });
          const addendumTo = e.addendumOf ? entries.find((x) => x.id === e.addendumOf) : undefined;
          const waitingCosign = e.cosignRequired && !e.cosignedBy;
          return (
            <li key={e.id} className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3">
              <EntryBody e={e} />
              {e.version > 1 && (
                <span className="text-caption font-semibold text-info">
                  Versi {e.version} · koreksi: {e.correctionReason}
                </span>
              )}
              {addendumTo && (
                <span className="text-caption font-semibold text-info">
                  Addendum atas catatan {addendumTo.author} · {formatTglJam(addendumTo.writtenAt)}
                </span>
              )}
              <span className={cx('text-caption font-semibold', TONE[st.tone])}>{st.label}</span>
              <span className="flex flex-wrap items-center gap-2">
                {waitingCosign && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!!cb || pending}
                    aria-describedby={cb ? `${e.id}-cb` : undefined}
                    onClick={() => sign(e, 'cosign')}
                  >
                    Co-sign DPJP
                  </Button>
                )}
                {waitingCosign && cb && (
                  <span id={`${e.id}-cb`} className="text-caption text-ink-500">
                    {cb}
                  </span>
                )}
                {needsVerification(e) && !ver && (
                  <Button
                    size="sm"
                    disabled={!!vb || pending}
                    aria-describedby={vb ? `${e.id}-vb` : undefined}
                    onClick={() => sign(e, 'verify')}
                  >
                    Verifikasi DPJP
                  </Button>
                )}
                {needsVerification(e) && !ver && vb && (
                  <span id={`${e.id}-vb`} className="text-caption text-ink-500">
                    {vb}
                  </span>
                )}
                {canWrite &&
                  (canCorrectCppt(e, user) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Koreksi CPPT ${formatTglJam(e.writtenAt)}`}
                      onClick={() => {
                        setForm({ mode: 'koreksi', target: e });
                        setMsg(null);
                      }}
                    >
                      Koreksi
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Addendum atas CPPT ${e.author} ${formatTglJam(e.writtenAt)}`}
                      onClick={() => {
                        setForm({ mode: 'addendum', target: e });
                        setMsg(null);
                      }}
                    >
                      Addendum
                    </Button>
                  ))}
                {chain.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={history === e.id}
                    onClick={() => setHistory(history === e.id ? null : e.id)}
                  >
                    Riwayat versi ({chain.length})
                  </Button>
                )}
              </span>
              {history === e.id && (
                <ol
                  aria-label="Riwayat versi"
                  className="m-0 flex list-none flex-col gap-1.5 rounded-control bg-subtle p-2.5"
                >
                  {chain.map((v) => (
                    <li key={v.id} className="flex flex-col gap-0.5 text-small">
                      <span className="font-semibold">
                        Versi {v.version} · {v.author} · {formatTglJam(v.writtenAt)}
                        {old.has(v.id) ? ' · digantikan' : ' · berlaku'}
                      </span>
                      <span
                        className={cx('whitespace-pre-line', old.has(v.id) && 'text-ink-500 line-through')}
                      >
                        {soapText(v)}
                      </span>
                      {v.correctionReason && (
                        <span className="text-caption text-info">Alasan: {v.correctionReason}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
      {shown.length === 0 && (
        <p className="m-0 px-4 py-3.5 text-small text-ink-500">
          {entries.length === 0
            ? 'Belum ada CPPT pada kunjungan ini. Tulis catatan pertama dengan tombol di atas.'
            : 'Belum ada catatan dari profesi ini.'}
        </p>
      )}
    </section>
  );
}

function soapText(e: Pick<CpptEntry, 's' | 'o' | 'a' | 'p'>): string {
  return (['s', 'o', 'a', 'p'] as const)
    .filter((k) => e[k].trim())
    .map((k) => `${k.toUpperCase()}: ${e[k]}`)
    .join('\n');
}

function EntryBody({ e }: { e: CpptEntry }) {
  const m = CPPT_ROLE_META[e.role];
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className={cx(
          'flex size-9 flex-none items-center justify-center rounded-full text-caption font-bold',
          m.tone,
        )}
      >
        {m.tag}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="font-semibold">
            {e.author} <span className="font-normal text-ink-500">· {m.label}</span>
          </span>
          <span className="text-caption text-ink-500">{formatTglJam(e.writtenAt)}</span>
        </div>
        <p className="m-0 whitespace-pre-line text-small text-ink-900">{soapText(e)}</p>
      </div>
    </div>
  );
}

function SoapForm({
  mode,
  writerRole,
  target,
  busy,
  onSubmit,
  onCancel,
}: {
  mode: FormState['mode'];
  writerRole: CpptRole;
  target: CpptEntry | null;
  busy: boolean;
  onSubmit: (soap: SoapText, reason: string | null) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [f, setF] = useState<SoapText>(
    mode === 'koreksi' && target
      ? { s: target.s, o: target.o, a: target.a, p: target.p }
      : { s: '', o: '', a: '', p: '' },
  );
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const abbr = soapAbbreviations(f);
  const missing = SOAP_FIELDS.filter((x) => x.required && !f[x.k].trim());
  const title =
    mode === 'koreksi' && target
      ? `Koreksi CPPT ${formatTglJam(target.writtenAt)} · menjadi versi ${target.version + 1}`
      : mode === 'addendum' && target
        ? `Addendum atas CPPT ${target.author} · ${formatTglJam(target.writtenAt)} (catatan asli tidak berubah)`
        : `CPPT baru · ${CPPT_ROLE_META[writerRole].label}`;
  return (
    <form
      aria-label={
        mode === 'koreksi' ? 'Koreksi CPPT' : mode === 'addendum' ? 'Addendum CPPT' : 'Tulis CPPT baru'
      }
      className="flex flex-col gap-2.5 border-b border-line bg-brand-50 px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (missing.length === 0 && (mode !== 'koreksi' || hasReason(reason))) {
          onSubmit(f, mode === 'koreksi' ? reason.trim() : null);
        }
      }}
    >
      <span className="text-caption font-semibold text-brand-700">{title}</span>
      {mode === 'baru' && writerRole === 'residen' && (
        <p
          role="note"
          className="m-0 rounded-control border border-warning-border bg-warning-bg px-3 py-2 text-small text-warning"
        >
          <span className="font-semibold">Gerbang co-sign: </span>
          {RESIDENT_GATE}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {SOAP_FIELDS.map((x) => {
          const err = tried && x.required && !f[x.k].trim();
          return (
            <div key={x.k} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${x.k}`} className="text-small font-semibold">
                {x.label}
                {x.required && <span className="text-danger"> *</span>}
              </label>
              <textarea
                id={`${id}-${x.k}`}
                rows={2}
                value={f[x.k]}
                maxLength={1000}
                aria-invalid={err ? true : undefined}
                onChange={(e) => setF((cur) => ({ ...cur, [x.k]: e.target.value }))}
                className={cx(
                  'rounded-control border bg-white px-3 py-2 font-[inherit]',
                  err ? 'border-danger' : 'border-line-strong',
                )}
              />
              {err && <span className="text-caption text-danger">{x.k.toUpperCase()} wajib diisi.</span>}
            </div>
          );
        })}
      </div>
      {abbr.length > 0 && (
        <div
          role="status"
          className="rounded-control border border-warning-border bg-white px-3 py-2 text-small"
        >
          <span className="font-semibold text-warning">
            Singkatan terlarang (peringatan, tidak memblokir):
          </span>
          <ul className="m-0 pl-5">
            {abbr.map((m, i) => (
              <li key={`${m.field}-${m.found}-${i}`}>
                {m.field.toUpperCase()}: “{m.found}” · {m.suggestion}
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'koreksi' && (
        <ReasonField
          label="Alasan koreksi"
          value={reason}
          onChange={setReason}
          showError={tried}
          hint="Entri lama tidak diubah; koreksi disimpan sebagai versi baru dan tercatat di jejak audit."
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {mode === 'koreksi'
            ? 'Simpan koreksi (versi baru)'
            : mode === 'addendum'
              ? 'Simpan addendum'
              : submitLabel(writerRole)}
        </Button>
        <Button onClick={onCancel}>Batal</Button>
      </div>
    </form>
  );
}
