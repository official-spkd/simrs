'use client';

import { formatJam, formatTanggalLahir, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx, FilterChip, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { recordDiagAction } from '@/app/(staf)/penunjang/diagnostik/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  applyDiag,
  codeLabel,
  DIAG_GATE_TEXT,
  DIAG_STEPS,
  type DiagAction,
  type DiagKind,
  type DiagOrder,
  diagStage,
  TEMPLATES,
} from '@/lib/penunjang-diagnostik';
import { StageSteps } from './stage-steps';

type Msg = { ok: boolean; text: string; critical?: boolean } | null;

/**
 * S10 · Penunjang diagnostik lain (EKG, ekokardiografi, endoskopi, rehabilitasi medik): worklist per jenis, order →
 * jadwal → pelaksanaan dengan cek identitas → ekspertise terstruktur ber-TTE. Keadaan tersimpan di toko demo bersama.
 */
export function DiagnosticWorkspace({
  orders,
  rev,
  userName,
}: {
  orders: DiagOrder[];
  rev: number;
  userName: string;
}) {
  const [kind, setKind] = useState<DiagKind | 'semua'>('semua');
  const [selectedId, setSelectedId] = useState(orders[0]?.id ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  const { run: save, pending } = useStoreAction(rev);
  const shown = orders.filter((o) => kind === 'semua' || o.kind === kind);
  const sel = orders.find((o) => o.id === selectedId);

  const run = (o: DiagOrder, action: DiagAction) => {
    const local = applyDiag(o, action, { at: demoNow().toISOString(), by: userName });
    if (!local.ok) return setMsg({ ok: false, text: DIAG_GATE_TEXT[local.code] });
    const payload =
      action.type === 'jadwal'
        ? { kind: 'jadwal', orderId: o.id, slot: action.slot }
        : action.type === 'laksana'
          ? { kind: 'laksana', orderId: o.id, identityConfirmed: action.identityConfirmed }
          : { kind: 'tte', orderId: o.id, findings: action.findings, critical: action.critical };
    save(
      (rev) => recordDiagAction(payload, rev),
      (result) =>
        setMsg({
          ok: result.ok,
          text: result.message,
          critical: result.ok && action.type === 'tte' && action.critical,
        }),
    );
  };

  const kinds: Array<[DiagKind | 'semua', string]> = [
    ['semua', `Semua (${orders.length})`],
    ...(Object.keys(TEMPLATES) as DiagKind[]).map(
      (k) =>
        [k, `${TEMPLATES[k].label.split(' ')[0]} (${orders.filter((o) => o.kind === k).length})`] as [
          DiagKind,
          string,
        ],
    ),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Saring jenis pemeriksaan" className="flex flex-wrap gap-2">
        {kinds.map(([k, label]) => (
          <FilterChip key={k} selected={kind === k} onClick={() => setKind(k)}>
            {label}
          </FilterChip>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]">
        <section
          aria-label="Worklist diagnostik"
          className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          {shown.length === 0 ? (
            <p className="m-0 text-small text-ink-700">Tidak ada order untuk jenis ini.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {shown.map((o) => {
                const st = diagStage(o);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      aria-pressed={o.id === selectedId}
                      onClick={() => {
                        setSelectedId(o.id);
                        setMsg(null);
                      }}
                      className={cx(
                        'flex w-full cursor-pointer flex-col gap-1 rounded-[12px] border p-3 text-left font-[inherit]',
                        o.id === selectedId
                          ? 'border-brand-300 bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                          : 'border-line bg-white hover:bg-brand-50/60',
                      )}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{o.patient.name}</span>
                        <Chip
                          tone={
                            st === 'ditandatangani' ? 'success' : o.priority === 'cito' ? 'danger' : 'warning'
                          }
                        >
                          {o.priority === 'cito' && st !== 'ditandatangani' ? 'CITO · ' : ''}
                          {DIAG_STEPS.find((s) => s.id === st)?.label}
                        </Chip>
                      </span>
                      <span className="text-small text-ink-700">{TEMPLATES[o.kind].label}</span>
                      <span className="text-caption text-ink-500">
                        {o.location} · order {formatJam(o.orderedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section
          aria-label="Detail pemeriksaan"
          className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          {sel && <DiagDetail key={sel.id} o={sel} busy={pending} msg={msg} run={(a) => run(sel, a)} />}
        </section>
      </div>
    </div>
  );
}

function DiagDetail({
  o,
  busy,
  msg,
  run,
}: {
  o: DiagOrder;
  busy: boolean;
  msg: Msg;
  run: (a: DiagAction) => void;
}) {
  const t = TEMPLATES[o.kind];
  const st = diagStage(o);
  const [slot, setSlot] = useState(t.slots[0] ?? '');
  const [identity, setIdentity] = useState(false);
  const [findings, setFindings] = useState<Record<string, string>>({});
  const [critical, setCritical] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <h2 className="m-0 text-[15px] font-semibold">{t.label}</h2>
          <span className="text-small text-ink-700">
            {o.indication} · order {o.orderedBy} · {formatTanggalWaktu(o.orderedAt)}
          </span>
        </span>
        <Chip tone="info" mono>
          {codeLabel(o.kind)}
        </Chip>
      </div>
      <PatientBanner
        name={o.patient.name}
        sex={o.patient.sex}
        ageYears={o.patient.ageYears}
        birthDate={formatTanggalLahir(o.patient.birthDate)}
        mrn={o.patient.rm}
        allergies={o.patient.allergies}
        guarantor={o.patient.guarantor}
        attending={o.orderedBy}
      />
      <StageSteps steps={DIAG_STEPS} current={st} label="Tahap pemeriksaan" />
      {msg && (
        <Alert level={msg.ok ? 'success' : 'critical'}>
          {msg.text}
          {msg.critical && (
            <>
              {' '}
              Lanjutkan pelaporan di <Link href="/penunjang/hasil-kritis">Pusat hasil kritis</Link>.
            </>
          )}
        </Alert>
      )}
      {t.preparation && <span className="text-small text-warning">Persiapan: {t.preparation}</span>}
      {o.slot && <span className="text-small">Jadwal: {o.slot}</span>}

      {st === 'order' && (
        <form
          aria-label="Jadwalkan pemeriksaan"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: 'jadwal', slot });
          }}
        >
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Slot jadwal
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            >
              {t.slots.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            Jadwalkan
          </Button>
        </form>
      )}
      {st === 'terjadwal' && (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={identity}
              onChange={(e) => setIdentity(e.target.checked)}
              className="size-4 accent-brand-600"
            />
            Identitas pasien dicocokkan (nama + tanggal lahir / RM di gelang)
          </label>
          <Button
            variant="primary"
            className="self-start"
            disabled={busy}
            onClick={() => run({ type: 'laksana', identityConfirmed: identity })}
          >
            Mulai dan catat pelaksanaan
          </Button>
        </div>
      )}
      {o.performedAt && (
        <span className="text-small text-ink-700">
          Dilaksanakan {formatTanggalWaktu(o.performedAt)} oleh {o.performedBy}
        </span>
      )}
      {(st === 'dilaksanakan' || st === 'ditandatangani') && (
        <form
          aria-label={`Ekspertise ${t.label}`}
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: 'tte', findings, critical });
          }}
        >
          {t.fields.map((f) => (
            <label key={f} className="flex flex-col gap-1 text-small font-semibold text-ink-700">
              {f}
              <input
                value={st === 'ditandatangani' ? (o.findings[f] ?? '') : (findings[f] ?? '')}
                readOnly={st === 'ditandatangani'}
                maxLength={1000}
                onChange={(e) => setFindings((s) => ({ ...s, [f]: e.target.value }))}
                className={cx(
                  'h-11 rounded-control border px-3 font-[inherit] font-normal',
                  st === 'ditandatangani' ? 'border-line bg-subtle' : 'border-line-strong bg-white',
                )}
              />
            </label>
          ))}
          {st === 'dilaksanakan' && (
            <>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
                <input
                  type="checkbox"
                  checked={critical}
                  onChange={(e) => setCritical(e.target.checked)}
                  className="size-4 accent-brand-600"
                />
                Temuan kritis (mis. STEMI, aritmia mengancam) → laporkan dengan read-back
              </label>
              <Button type="submit" variant="primary" className="self-start" disabled={busy}>
                Simpan dan tandatangani (TTE {t.reader})
              </Button>
            </>
          )}
        </form>
      )}
      {o.signed && (
        <span role="status" className="text-small font-semibold text-success">
          ✓ Ekspertise ditandatangani {o.signed.by} · {formatTanggalWaktu(o.signed.at)}
          {o.critical ? ' · temuan kritis' : ''}
        </span>
      )}
    </>
  );
}
