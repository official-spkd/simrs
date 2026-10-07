'use client';

import { type CpptRecord, formatJam, formatTanggal, type HandoverRecord } from '@simrs/shared';
import { Button, cx, FilterChip } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { CPPT_ROLE_META, type CpptFilter, cpptMatches, formatTglJam, type SoapText } from '@/lib/rawat-inap';
import { attestCpptAction, handoverAction, saveCpptAction } from './actions-api';
import type { Me, Perms } from './api-workspace';
import { CpptForm } from './cppt-form';

const FILTERS: Array<[CpptFilter, string]> = [
  ['semua', 'Semua PPA'],
  ['dokter', 'Dokter'],
  ['perawat', 'Perawat & bidan'],
  ['lainnya', 'Farmasi & gizi'],
];

type FormState =
  { mode: 'baru' } | { mode: 'koreksi'; target: CpptRecord } | { mode: 'addendum'; target: CpptRecord };

type Msg = { ok: boolean; text: string } | null;

function soapOf(e: CpptRecord): SoapText {
  if (e.content.format === 'soap') return { s: e.content.s, o: e.content.o, a: e.content.a, p: e.content.p };
  return {
    s: e.content.assessment,
    o: e.content.monitoring,
    a: e.content.diagnosis,
    p: e.content.intervention,
  };
}

/**
 * CPPT terintegrasi multi-PPA mode api (K07): PPA dan penulis dari sesi (server), catatan residen menunggu co-sign
 * DPJP, verifikasi DPJP atas catatan PPA lain, koreksi oleh penulis (versi baru beralasan), addendum oleh PPA lain,
 * dan serah terima SBAR. Semua aksi lewat Server Action; daftar dimuat ulang dari server sesudahnya.
 */
export function ApiCpptPanel({
  encounterId,
  entries,
  handovers,
  me,
  perms,
  sbarDraft,
}: {
  encounterId: string;
  entries: CpptRecord[];
  handovers: HandoverRecord[];
  me: Me;
  perms: Perms;
  sbarDraft: { situation: string; background: string; assessment: string; recommendation: string };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<CpptFilter>('semua');
  const [form, setForm] = useState<FormState | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [showSbar, setShowSbar] = useState(false);
  const [busy, start] = useTransition();
  const shown = entries
    .filter((e) => cpptMatches({ role: e.ppa }, filter))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const byId = new Map(entries.map((e) => [e.id, e]));

  const submit = (soap: SoapText, reason: string | null) => {
    if (!form) return;
    const cur = form;
    const mode =
      cur.mode === 'koreksi'
        ? { kind: 'koreksi' as const, targetId: cur.target.id, reason: reason ?? '' }
        : cur.mode === 'addendum'
          ? { kind: 'addendum' as const, targetId: cur.target.id }
          : { kind: 'baru' as const };
    start(async () => {
      const r = await saveCpptAction({ encounterId, soap, mode });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setForm(null);
      setFilter('semua');
      const warn = r.data.abbreviationWarnings.length
        ? ` Peringatan singkatan terlarang: ${r.data.abbreviationWarnings.join(', ')}.`
        : '';
      setMsg({
        ok: true,
        text:
          (cur.mode === 'koreksi'
            ? `Koreksi tersimpan ${formatJam(r.data.at)} sebagai versi ${r.data.version}; versi lama tetap tercatat.`
            : cur.mode === 'addendum'
              ? `Addendum tersimpan ${formatJam(r.data.at)}; catatan ${cur.target.author.nama} tidak berubah.`
              : r.data.status === 'menunggu_cosign'
                ? `CPPT residen tersimpan ${formatJam(r.data.at)} · belum final, menunggu co-sign DPJP.`
                : `CPPT baru tersimpan ${formatJam(r.data.at)} dan ditandatangani elektronik.`) + warn,
      });
      router.refresh();
    });
  };

  const attest = (e: CpptRecord, kind: 'cosign' | 'verify') =>
    start(async () => {
      const r = await attestCpptAction({ entryId: e.id, kind });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg({
        ok: true,
        text:
          kind === 'cosign'
            ? `CPPT residen ${formatJam(e.occurredAt)} disetujui DPJP ${formatJam(r.data.at)}.`
            : `CPPT ${e.author.nama} ${formatJam(e.occurredAt)} diverifikasi DPJP ${formatJam(r.data.at)}.`,
      });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="CPPT terintegrasi"
        className="min-w-0 overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3">
          <h2 className="m-0 text-body font-semibold">CPPT terintegrasi</h2>
          <div role="group" aria-label="Filter profesi" className="flex flex-wrap gap-1.5">
            {FILTERS.map(([id, label]) => (
              <FilterChip key={id} selected={filter === id} onClick={() => setFilter(id)}>
                {label}
              </FilterChip>
            ))}
          </div>
        </div>
        {form && (
          <CpptForm
            key={form.mode === 'baru' ? 'baru' : `${form.mode}-${form.target.id}`}
            title={
              form.mode === 'koreksi'
                ? `Koreksi CPPT ${formatJam(form.target.occurredAt)} · menjadi versi ${form.target.version + 1}`
                : form.mode === 'addendum'
                  ? `Addendum atas CPPT ${form.target.author.nama} · ${formatTglJam(form.target.occurredAt)} (catatan asli tidak berubah)`
                  : `CPPT baru · ${me.name}${me.role ? ` · ${me.role.toLowerCase()}` : ''}`
            }
            initial={form.mode === 'koreksi' ? soapOf(form.target) : undefined}
            mode={form.mode}
            busy={busy}
            onSubmit={submit}
            onCancel={() => setForm(null)}
          />
        )}
        {msg && (
          <div
            role={msg.ok ? 'status' : 'alert'}
            className={cx(
              'border-b border-line-soft px-4 py-2.5 text-small font-semibold',
              msg.ok ? 'bg-alert-success text-zamrud-800' : 'bg-alert-warning text-kunyit-800',
            )}
          >
            {msg.text}
          </div>
        )}
        <ol className="m-0 list-none p-0" aria-label="Catatan CPPT">
          {shown.map((e) => (
            <CpptItem
              key={e.id}
              e={e}
              own={e.author.userId === me.id}
              addendumTo={e.addendumOf ? byId.get(e.addendumOf) : undefined}
              perms={perms}
              busy={busy}
              onCosign={() => attest(e, 'cosign')}
              onVerify={() => attest(e, 'verify')}
              onCorrect={() => {
                setForm({ mode: 'koreksi', target: e });
                setMsg(null);
              }}
              onAddendum={() => {
                setForm({ mode: 'addendum', target: e });
                setMsg(null);
              }}
            />
          ))}
        </ol>
        {shown.length === 0 && (
          <p className="m-0 px-4 py-3.5 text-small text-ink-500">Belum ada catatan CPPT dari profesi ini.</p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          <Button
            variant="primary"
            disabled={!perms.write}
            aria-expanded={form?.mode === 'baru'}
            onClick={() => {
              setForm({ mode: 'baru' });
              setMsg(null);
            }}
          >
            + Tulis CPPT (SOAP)
          </Button>
          <Button aria-expanded={showSbar} disabled={!perms.write} onClick={() => setShowSbar((v) => !v)}>
            {showSbar ? 'Tutup serah terima SBAR' : 'Serah terima SBAR'}
          </Button>
          <span className="basis-full text-caption text-ink-500">
            {perms.write
              ? 'Koreksi hanya oleh penulis catatan (versi baru, alasan wajib; versi lama tetap tersimpan). PPA lain menambahkan addendum. Catatan residen final setelah co-sign DPJP.'
              : 'Peran Anda hanya dapat membaca CPPT pasien ini.'}
          </span>
        </div>
      </section>
      {showSbar && (
        <SbarForm
          encounterId={encounterId}
          draft={sbarDraft}
          onDone={(text) => {
            setShowSbar(false);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
      <HandoverList handovers={handovers} />
    </div>
  );
}

function CpptItem({
  e,
  own,
  addendumTo,
  perms,
  busy,
  onCosign,
  onVerify,
  onCorrect,
  onAddendum,
}: {
  e: CpptRecord;
  own: boolean;
  addendumTo: CpptRecord | undefined;
  perms: Perms;
  busy: boolean;
  onCosign: () => void;
  onVerify: () => void;
  onCorrect: () => void;
  onAddendum: () => void;
}) {
  const m = CPPT_ROLE_META[e.ppa];
  const soap = soapOf(e);
  const lines = (['s', 'o', 'a', 'p'] as const).filter((k) => soap[k].trim());
  const waiting = e.status === 'menunggu_cosign';
  const needsVerify = !e.cosignRequired && e.ppa !== 'dpjp' && !e.verification;
  return (
    <li className="flex gap-3 border-b border-line-soft px-4 py-3">
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
            {e.author.nama} <span className="font-normal text-ink-500">· {m.label}</span>
          </span>
          <span className="text-caption text-ink-500">
            {formatTanggal(e.occurredAt)} · {formatJam(e.occurredAt)}
            {e.lateEntry ? ` · entri terlambat (dicatat ${formatJam(e.recordedAt)})` : ''}
          </span>
        </div>
        <p className="m-0 whitespace-pre-line text-small text-ink-900">
          {lines.map((k) => `${k.toUpperCase()}: ${soap[k]}`).join('\n')}
        </p>
        {e.version > 1 && (
          <span className="text-caption font-semibold text-info">
            Versi {e.version} · koreksi: {e.correctionReason}
          </span>
        )}
        {e.addendumOf && (
          <span className="text-caption font-semibold text-info">
            Addendum atas catatan{' '}
            {addendumTo ? `${addendumTo.author.nama} · ${formatTglJam(addendumTo.occurredAt)}` : 'sebelumnya'}
          </span>
        )}
        {e.abbreviationWarnings.length > 0 && (
          <span className="text-caption font-semibold text-warning">
            Singkatan terlarang: {e.abbreviationWarnings.join(', ')}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2">
          <span className={cx('text-caption font-semibold', waiting ? 'text-warning' : 'text-success')}>
            {waiting
              ? 'Menunggu co-sign DPJP'
              : e.cosign
                ? `Co-sign DPJP ${e.cosign.by.nama} · ${formatJam(e.cosign.at)}`
                : `Final · atestasi elektronik ${formatJam(e.recordedAt)}`}
            {e.verification
              ? ` · diverifikasi ${e.verification.by.nama} ${formatJam(e.verification.at)}`
              : ''}
          </span>
          {waiting && (
            <Button
              size="sm"
              variant="primary"
              disabled={!perms.cosign || own || busy}
              aria-describedby={perms.cosign && !own ? undefined : `cosign-${e.id}`}
              onClick={onCosign}
            >
              Setujui co-sign DPJP
            </Button>
          )}
          {waiting && (!perms.cosign || own) && (
            <span id={`cosign-${e.id}`} className="text-caption text-ink-500">
              {perms.cosign
                ? 'Bukan atas catatan sendiri.'
                : 'Hanya DPJP (posisi dokter) yang dapat co-sign.'}
            </span>
          )}
          {needsVerify && perms.cosign && !own && (
            <Button size="sm" disabled={busy} onClick={onVerify}>
              Verifikasi DPJP
            </Button>
          )}
          {perms.write &&
            (own ? (
              perms.correct && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Koreksi CPPT ${formatTglJam(e.occurredAt)}`}
                  onClick={onCorrect}
                >
                  Koreksi
                </Button>
              )
            ) : (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Addendum atas CPPT ${e.author.nama} ${formatTglJam(e.occurredAt)}`}
                onClick={onAddendum}
              >
                Addendum
              </Button>
            ))}
        </span>
      </div>
    </li>
  );
}

const SBAR_FIELDS = [
  ['situation', 'S · Situasi', true],
  ['background', 'B · Latar belakang', false],
  ['assessment', 'A · Asesmen', true],
  ['recommendation', 'R · Rekomendasi', true],
] as const;

/** Serah terima SBAR ke shift/unit berikutnya; isian awal dari CPPT, diagnosis, dan EWS terakhir (bisa diubah). */
function SbarForm({
  encounterId,
  draft,
  onDone,
}: {
  encounterId: string;
  draft: { situation: string; background: string; assessment: string; recommendation: string };
  onDone: (text: string) => void;
}) {
  const id = useId();
  const [f, setF] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      aria-label="Serah terima SBAR"
      className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await handoverAction({ encounterId, ...f });
          if (!r.ok) return setError(r.message);
          onDone(`Serah terima SBAR tersimpan ${formatJam(r.data.at)} untuk shift berikutnya.`);
        });
      }}
    >
      <h2 className="m-0 text-body font-semibold">Serah terima SBAR · shift berikutnya</h2>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {SBAR_FIELDS.map(([k, label, required]) => (
          <div key={k} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${k}`} className="text-small font-semibold">
              {label}
              {required && <span className="text-danger"> *</span>}
            </label>
            <textarea
              id={`${id}-${k}`}
              rows={2}
              required={required}
              maxLength={1000}
              value={f[k]}
              onChange={(e) => setF((cur) => ({ ...cur, [k]: e.target.value }))}
              className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
            />
          </div>
        ))}
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Simpan serah terima
        </Button>
        {error && (
          <span role="alert" className="text-small font-semibold text-danger">
            {error}
          </span>
        )}
      </span>
    </form>
  );
}

function HandoverList({ handovers }: { handovers: HandoverRecord[] }) {
  if (handovers.length === 0) return null;
  const recent = [...handovers].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5);
  return (
    <section
      aria-label="Riwayat serah terima"
      className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
    >
      <h2 className="m-0 border-b border-line px-4 py-3 text-body font-semibold">Serah terima terakhir</h2>
      <ul className="m-0 list-none p-0">
        {recent.map((h) => (
          <li key={h.id} className="flex flex-col gap-1 border-b border-line-soft px-4 py-2.5 text-small">
            <span className="text-caption text-ink-500">
              {formatTglJam(h.occurredAt)} · {h.author.nama} → {h.toUser?.nama ?? 'shift berikutnya'}
            </span>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="font-bold">S</dt>
              <dd className="m-0">{h.situation}</dd>
              {h.background && (
                <>
                  <dt className="font-bold">B</dt>
                  <dd className="m-0">{h.background}</dd>
                </>
              )}
              <dt className="font-bold">A</dt>
              <dd className="m-0">{h.assessment}</dd>
              <dt className="font-bold">R</dt>
              <dd className="m-0">{h.recommendation}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
