'use client';

import { formatJam } from '@simrs/shared';
import { Alert, Button, Chip, cx, KpiCard } from '@simrs/ui';
import { useState } from 'react';
import { satusehatAction } from '@/app/(staf)/sistem/integrasi/satusehat/actions';
import {
  type AuditEntry,
  complianceByType,
  effectiveStatus,
  type FhirResource,
  type FixState,
  holdText,
  maskId,
  maskPayload,
  resendGate,
  STATUS_VIEW,
  type Visit,
  visitSummary,
} from '@/lib/integrasi-satusehat';

import { useStoreAction } from '@/lib/demo/store/client';

const NO_FIX: FixState = { ihs: false, loinc: false, kfa: false };

/**
 * I02 · Pengiriman SATUSEHAT per kunjungan: urutan Encounter → anak → Encounter selesai, resource ditahan/terkirim/
 * gagal, payload tersamar, perbaikan data (IHS, pemetaan LOINC) lalu kirim ulang berkonfirmasi yang diaudit.
 */
export function SatusehatView({
  visits,
  fixed,
  audit,
  rev,
}: {
  visits: Visit[];
  fixed: Record<string, FixState>;
  audit: AuditEntry[];
  rev: number;
  userName: string;
}) {
  const [visitId, setVisitId] = useState(
    visits.find((v) => visitSummary(v).failed > 0)?.id ?? visits[0]?.id ?? '',
  );
  const [resId, setResId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(rev);
  const v = visits.find((x) => x.id === visitId);
  const st = v ? effectiveStatus(v) : {};
  const sel = v?.resources.find((r) => r.id === (resId ?? v.resources.find((x) => !x.sent)?.id));
  const fix = fixed[visitId] ?? { ...NO_FIX, ihs: !!v?.patient.ihs };
  const totals = visits.map(visitSummary).reduce(
    (a, s) => ({
      total: a.total + s.total,
      sent: a.sent + s.sent,
      failed: a.failed + s.failed,
      held: a.held + s.held,
    }),
    { total: 0, sent: 0, failed: 0, held: 0 },
  );

  const act = (payload: Parameters<typeof satusehatAction>[0]) =>
    save(
      (rev) => satusehatAction(payload, rev),
      (result) => {
        setMsg({ ok: result.ok, text: result.message });
        if (result.ok) setConfirming(false);
      },
    );

  if (!v) return <p className="m-0">Belum ada kunjungan.</p>;

  const lookupIhs = () => act({ kind: 'ihs', visitId: v.id });

  const doResend = (r: FhirResource) =>
    act({ kind: 'kirim-ulang', visitId: v.id, resourceId: r.id, confirmed: true, fixed: fix });

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Ringkasan SATUSEHAT" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Resource terkirim"
          value={`${totals.sent}/${totals.total}`}
          detail={`${visits.length} kunjungan hari ini (contoh)`}
          tinted
        />
        <KpiCard
          label="Gagal · DLQ"
          value={String(totals.failed)}
          tone={totals.failed ? 'danger' : 'success'}
          hint="galat 4xx permanen → DLQ tanpa retry"
          tinted
        />
        <KpiCard
          label="Ditahan"
          value={String(totals.held)}
          tone={totals.held ? 'warning' : 'neutral'}
          hint="menunggu urutan atau dokumen"
          tinted
        />
        <KpiCard
          label="Kirim ulang tercatat"
          value={String(audit.filter((a) => a.action.startsWith('Kirim ulang')).length)}
          detail="setiap kirim ulang diaudit"
          tinted
        />
      </section>
      {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.7fr)]">
        <section
          aria-label="Kunjungan"
          className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <h2 className="m-0 text-[15px] font-semibold">Kunjungan</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {visits.map((x) => {
              const s = visitSummary(x);
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    aria-pressed={x.id === visitId}
                    onClick={() => {
                      setVisitId(x.id);
                      setResId(null);
                      setConfirming(false);
                      setMsg(null);
                    }}
                    className={cx(
                      'flex w-full cursor-pointer flex-col gap-1 rounded-[12px] border p-3 text-left font-[inherit] transition-colors',
                      x.id === visitId
                        ? 'border-brand-300 bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                        : 'border-line bg-white/80 hover:bg-brand-50/60',
                    )}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{x.patient.name}</span>
                      <Chip tone={s.failed ? 'danger' : s.held ? 'warning' : 'success'}>
                        {s.sent}/{s.total} terkirim
                      </Chip>
                    </span>
                    <span className="text-small text-ink-700">
                      {x.encounterNo} · {x.kind} · {x.unit}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          aria-label="Detail kunjungan SATUSEHAT"
          className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="flex flex-col">
              <h2 className="m-0 text-[15px] font-semibold">
                {v.encounterNo} · {v.patient.name}
              </h2>
              <span className="text-small text-ink-700">
                RM <span className="font-mono">{v.patient.rm}</span> · NIK{' '}
                <span className="font-mono">{v.patient.nikMasked}</span> · {v.unit}
              </span>
            </span>
            {v.patient.ihs ? (
              <Chip tone="success" mono>
                IHS {maskId(v.patient.ihs)} · terverifikasi
              </Chip>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <Chip tone="danger">IHS belum ada</Chip>
                <Button size="sm" disabled={pending} onClick={lookupIhs}>
                  Cari IHS lewat NIK
                </Button>
              </span>
            )}
          </div>
          <span className="text-caption text-ink-500">
            Urutan kirim: Encounter → resource anak → Encounter selesai dengan diagnosis. Klik baris untuk
            melihat payload tersamar.
          </span>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-small">
              <caption className="sr-only">Resource SATUSEHAT kunjungan {v.encounterNo}</caption>
              <thead>
                <tr className="border-b border-line text-left text-caption font-semibold text-ink-500">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Resource</th>
                  <th className="px-2 py-1.5">Isi</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {v.resources.map((r, i) => {
                  const s = st[r.id] ?? 'antre';
                  const hold = holdText(v, r);
                  return (
                    <tr
                      key={r.id}
                      className={cx(
                        'border-b border-line-soft align-top transition-colors',
                        r.id === sel?.id
                          ? 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                          : 'hover:bg-brand-50/60',
                      )}
                    >
                      <td className="px-2 py-1.5 font-mono">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setResId(r.id);
                            setConfirming(false);
                          }}
                          aria-pressed={r.id === sel?.id}
                          className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] font-semibold text-brand-700 underline"
                        >
                          {r.type}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">
                        {r.label}
                        {r.code && (
                          <span className="block font-mono text-caption text-ink-500">{r.code}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Chip tone={STATUS_VIEW[s].tone}>{STATUS_VIEW[s].label}</Chip>
                        {r.at && s === 'terkirim' && (
                          <span className="block text-caption text-ink-500">{formatJam(r.at)}</span>
                        )}
                        {hold && <span className="block text-caption text-warning">{hold}</span>}
                        {r.error && s === 'gagal' && (
                          <span className="block text-caption text-danger">
                            HTTP {r.error.httpStatus} · {r.error.message}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sel && (
            <section
              aria-label={`Payload ${sel.type}`}
              className="flex flex-col gap-2 rounded-[12px] border border-brand-100 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-batu-50))] p-3"
            >
              <span className="font-semibold">
                {sel.type} · {sel.label}
              </span>
              {!sel.sent && !sel.error && (
                <>
                  <Button
                    variant="primary"
                    disabled={pending || st[sel.id] !== 'antre' || !v.patient.ihs}
                    onClick={() => act({ kind: 'kirim', visitId: v.id, resourceId: sel.id, confirmed: true })}
                  >
                    Kirim antrean demo
                  </Button>
                  {!v.patient.ihs && (
                    <span className="text-small text-warning">Verifikasi IHS pasien sebelum pengiriman.</span>
                  )}
                </>
              )}
              <pre className="m-0 max-h-56 overflow-auto rounded-control bg-ink-900 p-3 font-mono text-caption text-white">
                {`${sel.error ? `POST /fhir/${sel.type.split(' ')[0]} → ${sel.error.httpStatus} (galat permanen, langsung DLQ ${sel.error.dlqId})\n` : sel.resourceId ? `← 201 Created · ${maskId(sel.resourceId)}\n` : ''}${JSON.stringify(maskPayload(Object.keys(sel.payload).length ? sel.payload : { resourceType: sel.type.split(' ')[0], subject: { reference: v.patient.ihs ? `Patient/${v.patient.ihs}` : null } }), null, 2)}${sel.error ? `\n\nOperationOutcome: ${sel.error.code} · ${sel.error.message}` : ''}`}
              </pre>
              {sel.error && st[sel.id] === 'gagal' && (
                <FixPanel
                  r={sel}
                  fix={fix}
                  busy={pending}
                  confirming={confirming}
                  onMap={() => act({ kind: 'petakan', visitId: v.id, resourceId: sel.id })}
                  onLookupIhs={lookupIhs}
                  onAsk={() => setConfirming(true)}
                  onCancel={() => setConfirming(false)}
                  onConfirm={() => doResend(sel)}
                />
              )}
            </section>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section
          aria-label="Jejak audit integrasi"
          className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <h2 className="m-0 text-[15px] font-semibold">Jejak audit demo</h2>
          {audit.length === 0 ? (
            <p className="m-0 text-small text-ink-700">
              Belum ada tindakan. Kirim ulang dan lookup IHS tercatat di sini dan di jejak audit.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
              {audit.map((a) => (
                <li key={`${a.at}-${a.action}`}>
                  <span className="font-mono">{a.at}</span> · {a.by} · {a.action}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          aria-label="Kepatuhan per resource"
          className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <h2 className="m-0 text-[15px] font-semibold">Kepatuhan per resource (kunjungan contoh)</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
            {complianceByType(visits).map((c) => (
              <li key={c.type} className="flex justify-between gap-2">
                <span>{c.type}</span>
                <span className="font-mono font-semibold">
                  {c.sent}/{c.total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function FixPanel({
  r,
  fix,
  busy,
  confirming,
  onMap,
  onLookupIhs,
  onAsk,
  onCancel,
  onConfirm,
}: {
  r: FhirResource;
  fix: FixState;
  busy: boolean;
  confirming: boolean;
  onMap: () => void;
  onLookupIhs: () => void;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const gate = resendGate(r, fix);
  const err = r.error;
  if (!err) return null;
  return (
    <div className="flex flex-col gap-2">
      {gate === 'FIX_BLOCKED' ? (
        <Alert level="warning" title="Belum bisa dikirim ulang">
          {err.blockedReason}
        </Alert>
      ) : gate === 'FIX_REQUIRED' ? (
        <Alert level="warning" title="Perbaiki data dulu">
          {err.fixLabel}. Kirim ulang tanpa perbaikan akan gagal lagi.
        </Alert>
      ) : (
        <Alert level="success" title="Data sudah diperbaiki">
          {err.fixLabel} · siap dikirim ulang.
        </Alert>
      )}
      {gate === 'FIX_REQUIRED' && err.fix === 'loinc' && (
        <Button className="self-start" disabled={busy} onClick={onMap}>
          Petakan lokal-HbA1c → LOINC 4548-4
        </Button>
      )}
      {gate === 'FIX_REQUIRED' && err.fix === 'ihs' && (
        <Button className="self-start" disabled={busy} onClick={onLookupIhs}>
          Cari IHS lewat NIK
        </Button>
      )}
      {!confirming ? (
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || gate !== null} onClick={onAsk}>
            Kirim ulang
          </Button>
          {gate !== null && (
            <span className="text-caption text-ink-500">Tersedia setelah data diperbaiki.</span>
          )}
        </span>
      ) : (
        <div
          role="group"
          aria-label="Konfirmasi kirim ulang"
          className="flex flex-col gap-2 rounded-[12px] border border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-batu-50))] p-3 text-small"
        >
          <span>
            Kirim ulang {r.type} ({err.dlqId}) ke SATUSEHAT dengan kunci idempotensi yang sama? Tindakan ini
            tercatat di jejak audit; resource yang menunggu ikut dilepas berurutan.
          </span>
          <span className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={onConfirm}>
              Ya, kirim ulang
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Batal
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
