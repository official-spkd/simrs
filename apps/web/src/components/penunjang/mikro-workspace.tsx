'use client';

import { formatJam, formatTanggalLahir, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx, PatientBanner, Tabs } from '@simrs/ui';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { recordMicroAction } from '@/app/(staf)/penunjang/mikrobiologi/actions';
import { DOKTER_PA } from '@/lib/demo/fixtures/penunjang-mikro';
import { STAF } from '@/lib/demo/fixtures/staf';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  allergyFlags,
  applyCulture,
  AST_PANELS,
  CULTURE_STEPS,
  type CultureCase,
  cultureStage,
  GRAM_RESULTS,
  type GramResult,
  MICRO_GATE_TEXT,
  type MicroAction,
  ORGANISMS,
  PA_STEPS,
  type PaCase,
  paAddendumGate,
  paSignGate,
  paStage,
  type Sir,
  SIR_LABEL,
} from '@/lib/penunjang-mikro';
import type { MicroData } from '@/lib/server/data/penunjang-lanjut';
import { StageSteps } from './stage-steps';

type Msg = { ok: boolean; text: string; critical?: boolean } | null;
const selectCls = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';

/**
 * S02 · Mikrobiologi dan patologi anatomi: kultur bertahap (inkubasi → Gram → identifikasi → uji kepekaan →
 * validasi TTE) dan laporan PA ber-TTE yang terkunci (koreksi lewat addendum). Keadaan lokal sesi (simulasi).
 */
export function MicroWorkspace({ data, userName }: { data: MicroData; userName: string }) {
  const [cultures, setCultures] = useState(data.cultures);
  const [pa, setPa] = useState(data.pa);
  const [tab, setTab] = useState('kultur');
  const [cultureId, setCultureId] = useState(data.cultures[0]?.id ?? '');
  const [paId, setPaId] = useState(data.pa[0]?.id ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  const runCulture = (c: CultureCase, action: MicroAction) => {
    const by = action.type === 'final' ? STAF.dokterPatologiKlinik : userName;
    const local = applyCulture(c, action, { at: demoNow().toISOString(), by });
    if (!local.ok) return setMsg({ ok: false, text: MICRO_GATE_TEXT[local.code] });
    const gram = c.gram?.result ?? 'Batang Gram negatif';
    const payload =
      action.type === 'pertumbuhan'
        ? { kind: 'pertumbuhan', caseId: c.id, grew: action.grew }
        : action.type === 'gram'
          ? { kind: 'gram', caseId: c.id, result: action.result }
          : action.type === 'identifikasi'
            ? { kind: 'identifikasi', caseId: c.id, gram, organism: action.organism }
            : action.type === 'kepekaan'
              ? { kind: 'kepekaan', caseId: c.id, gram, results: action.results }
              : { kind: 'final', caseId: c.id };
    startTransition(async () => {
      const r = await recordMicroAction(payload);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setCultures((cur) => cur.map((x) => (x.id === c.id ? local.next : x)));
      setMsg({
        ok: true,
        text: `${local.message} · ${r.at} (simulasi, tidak disimpan)`,
        critical: local.critical,
      });
    });
  };

  const runPa = (
    p: PaCase,
    payload: Parameters<typeof recordMicroAction>[0],
    apply: (at: string) => PaCase,
  ) =>
    startTransition(async () => {
      const r = await recordMicroAction(payload);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      const at = demoNow().toISOString();
      setPa((cur) => cur.map((x) => (x.id === p.id ? apply(at) : x)));
      setMsg({ ok: true, text: r.message });
    });

  const selC = cultures.find((c) => c.id === cultureId);
  const selP = pa.find((p) => p.id === paId);

  const list = <T extends { id: string; patient: { name: string } }>(
    items: readonly T[],
    selected: string,
    onPick: (id: string) => void,
    label: string,
    chip: (x: T) => { text: string; tone: 'success' | 'warning' | 'brand' | 'neutral' },
    sub: (x: T) => string,
  ) => (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              aria-pressed={x.id === selected}
              onClick={() => {
                onPick(x.id);
                setMsg(null);
              }}
              className={cx(
                'flex w-full cursor-pointer flex-col gap-1 rounded-[12px] border p-3 text-left font-[inherit]',
                x.id === selected ? 'border-brand-600 bg-selected' : 'border-line bg-white',
              )}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{x.patient.name}</span>
                <Chip tone={chip(x).tone}>{chip(x).text}</Chip>
              </span>
              <span className="text-small text-ink-700">{sub(x)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  const feedback = msg && (
    <Alert level={msg.ok ? 'success' : 'critical'}>
      {msg.text}
      {msg.critical && (
        <>
          {' '}
          Kultur darah positif adalah nilai kritis: laporkan di{' '}
          <Link href="/penunjang/hasil-kritis">Pusat hasil kritis</Link>.
        </>
      )}
    </Alert>
  );

  return (
    <Tabs
      label="Mikrobiologi dan patologi anatomi"
      value={tab}
      onChange={(t) => {
        setTab(t);
        setMsg(null);
      }}
      items={[
        {
          id: 'kultur',
          label: 'Kultur & uji kepekaan',
          content: (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
              {list(
                cultures,
                cultureId,
                setCultureId,
                'Daftar kultur',
                (c) => {
                  const st = cultureStage(c);
                  return {
                    text: CULTURE_STEPS.find((s) => s.id === st)?.label ?? st,
                    tone: st === 'final' ? 'success' : 'warning',
                  };
                },
                (c) => `${c.labNo} · ${c.specimen} · ${c.location}`,
              )}
              <section
                aria-label="Detail kultur"
                className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white p-4"
              >
                {selC && (
                  <CultureDetail
                    key={selC.id}
                    c={selC}
                    busy={pending}
                    run={(a) => runCulture(selC, a)}
                    feedback={feedback}
                  />
                )}
              </section>
            </div>
          ),
        },
        {
          id: 'pa',
          label: 'Patologi anatomi',
          content: (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
              {list(
                pa,
                paId,
                setPaId,
                'Daftar patologi anatomi',
                (p) => ({
                  text: PA_STEPS.find((s) => s.id === paStage(p))?.label ?? '',
                  tone: p.signed ? 'success' : 'warning',
                }),
                (p) => `${p.paNo} · ${p.specimen}`,
              )}
              <section
                aria-label="Detail patologi anatomi"
                className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white p-4"
              >
                {selP && (
                  <PaDetail
                    key={selP.id}
                    p={selP}
                    busy={pending}
                    feedback={feedback}
                    onLocalError={(t) => setMsg({ ok: false, text: t })}
                    onSign={(f) =>
                      runPa(selP, { kind: 'pa-tte', caseId: selP.id, ...f }, (at) => ({
                        ...selP,
                        ...f,
                        signed: { at, by: DOKTER_PA },
                      }))
                    }
                    onAddendum={(text) =>
                      runPa(selP, { kind: 'pa-addendum', caseId: selP.id, text }, (at) => ({
                        ...selP,
                        addenda: [...selP.addenda, { at, by: DOKTER_PA, text: text.trim() }],
                      }))
                    }
                  />
                )}
              </section>
            </div>
          ),
        },
      ]}
    />
  );
}

function Banner({ patient, dpjp }: { patient: CultureCase['patient']; dpjp: string }) {
  return (
    <PatientBanner
      name={patient.name}
      sex={patient.sex}
      ageYears={patient.ageYears}
      birthDate={formatTanggalLahir(patient.birthDate)}
      mrn={patient.rm}
      allergies={patient.allergies}
      guarantor={patient.guarantor}
      attending={dpjp}
    />
  );
}

function CultureDetail({
  c,
  busy,
  run,
  feedback,
}: {
  c: CultureCase;
  busy: boolean;
  run: (a: MicroAction) => void;
  feedback: React.ReactNode;
}) {
  const st = cultureStage(c);
  const [gram, setGram] = useState<GramResult>(GRAM_RESULTS[0]);
  const [organism, setOrganism] = useState('');
  const [ast, setAst] = useState<Record<string, Sir>>({});
  const panel = c.gram ? AST_PANELS[c.gram.result] : [];
  const flagged = allergyFlags(c);
  const shownAst: Readonly<Record<string, Sir>> = c.astAt ? c.ast : ast;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <h2 className="m-0 text-h2 font-semibold">{c.specimen}</h2>
          <span className="text-small text-ink-700">
            {c.labNo} · diambil {formatTanggalWaktu(c.takenAt)} · {c.location}
          </span>
        </span>
        {c.blood && <Chip tone="danger">Kultur darah · positif = nilai kritis</Chip>}
      </div>
      <Banner patient={c.patient} dpjp={c.dpjp} />
      <StageSteps steps={CULTURE_STEPS} current={st} label="Tahap kultur" />
      {feedback}
      {c.preliminary && <span className="text-small text-ink-700">{c.preliminary}</span>}

      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
        <dt className="text-ink-500">Pertumbuhan</dt>
        <dd className="m-0">
          {c.growth
            ? `${c.growth.grew ? 'Tumbuh' : 'Tidak tumbuh'} · ${formatTanggalWaktu(c.growth.at)}`
            : 'Dalam inkubasi'}
        </dd>
        <dt className="text-ink-500">Pewarnaan Gram</dt>
        <dd className="m-0">{c.gram ? `${c.gram.result} · ${formatJam(c.gram.at)} · ${c.gram.by}` : '—'}</dd>
        <dt className="text-ink-500">Organisme</dt>
        <dd className="m-0 italic">{c.organism?.name ?? '—'}</dd>
      </dl>

      {st === 'inkubasi' && (
        <span className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => run({ type: 'pertumbuhan', grew: true })}>
            Catat tumbuh
          </Button>
          <Button disabled={busy} onClick={() => run({ type: 'pertumbuhan', grew: false })}>
            Tidak tumbuh (hari ke-5)
          </Button>
        </span>
      )}
      {st === 'pewarnaan' && (
        <form
          aria-label="Pewarnaan Gram"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: 'gram', result: gram });
          }}
        >
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Hasil pewarnaan Gram
            <select
              value={gram}
              onChange={(e) => setGram(e.target.value as GramResult)}
              className={selectCls}
            >
              {GRAM_RESULTS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            Simpan dan kirim laporan awal
          </Button>
        </form>
      )}
      {st === 'identifikasi' && c.gram && (
        <form
          aria-label="Identifikasi organisme"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: 'identifikasi', organism });
          }}
        >
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Organisme (daftar lokal, {c.gram.result.toLowerCase()})
            <select value={organism} onChange={(e) => setOrganism(e.target.value)} className={selectCls}>
              <option value="">Pilih organisme</option>
              {ORGANISMS[c.gram.result].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={busy || !organism}>
            Simpan identifikasi
          </Button>
        </form>
      )}
      {c.gram && (st === 'kepekaan' || c.astAt) && (
        <form
          aria-label="Uji kepekaan antibiotik"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: 'kepekaan', results: ast });
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-small">
              <caption className="pb-1 text-left font-semibold">Uji kepekaan antibiotik (S/I/R)</caption>
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-500">
                  <th className="px-2 py-1.5">Antibiotik</th>
                  <th className="px-2 py-1.5">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {panel.map((ab) => (
                  <tr key={ab} className="border-b border-line">
                    <td className="px-2 py-1.5">
                      {ab}
                      {flagged.includes(ab) && (
                        <Chip tone="danger" className="ml-2">
                          alergi pasien
                        </Chip>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {c.astAt ? (
                        <span
                          className={cx(
                            'font-semibold',
                            shownAst[ab] === 'R'
                              ? 'text-danger'
                              : shownAst[ab] === 'I'
                                ? 'text-warning'
                                : 'text-success',
                          )}
                        >
                          {shownAst[ab] ? `${shownAst[ab]} · ${SIR_LABEL[shownAst[ab]]}` : '—'}
                        </span>
                      ) : (
                        <select
                          aria-label={`Hasil ${ab}`}
                          value={ast[ab] ?? ''}
                          onChange={(e) => setAst((s) => ({ ...s, [ab]: e.target.value as Sir }))}
                          className={selectCls}
                        >
                          <option value="">—</option>
                          {(['S', 'I', 'R'] as const).map((v) => (
                            <option key={v} value={v}>
                              {v} · {SIR_LABEL[v]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!c.astAt && (
            <Button type="submit" variant="primary" className="self-start" disabled={busy}>
              Simpan uji kepekaan
            </Button>
          )}
        </form>
      )}
      {st === 'validasi' && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy} onClick={() => run({ type: 'final' })}>
            Validasi & TTE ({STAF.dokterPatologiKlinik})
          </Button>
          <span className="text-small text-ink-700">
            Laporan akhir masuk ke hasil pasien dan sumber antibiogram PPRA.
          </span>
        </div>
      )}
      {c.final && (
        <span role="status" className="text-small font-semibold text-success">
          ✓ Laporan akhir ditandatangani {c.final.by} · {formatTanggalWaktu(c.final.at)}
        </span>
      )}
    </>
  );
}

function PaDetail({
  p,
  busy,
  feedback,
  onLocalError,
  onSign,
  onAddendum,
}: {
  p: PaCase;
  busy: boolean;
  feedback: React.ReactNode;
  onLocalError: (text: string) => void;
  onSign: (f: { macro: string; micro: string; diagnosis: string }) => void;
  onAddendum: (text: string) => void;
}) {
  const [f, setF] = useState({ macro: p.macro, micro: p.micro, diagnosis: p.diagnosis });
  const [addendum, setAddendum] = useState('');
  const locked = !!p.signed;
  const stage = paStage(locked ? p : { ...f, signed: null });
  const fields = [
    ['macro', 'Makroskopik'],
    ['micro', 'Mikroskopik'],
    ['diagnosis', 'Diagnosis (kesimpulan)'],
  ] as const;
  return (
    <>
      <div className="flex flex-col">
        <h2 className="m-0 text-h2 font-semibold">
          {p.paNo} · {p.specimen}
        </h2>
        <span className="text-small text-ink-700">
          Klinis: {p.clinical} · diterima {formatTanggalWaktu(p.receivedAt)} · {p.location}
        </span>
      </div>
      <Banner patient={p.patient} dpjp={p.dpjp} />
      <StageSteps steps={PA_STEPS} current={stage} label="Tahap patologi anatomi" />
      {feedback}
      <form
        aria-label="Laporan patologi anatomi"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const gate = paSignGate({ ...f, signed: p.signed });
          if (gate) return onLocalError(MICRO_GATE_TEXT[gate]);
          onSign(f);
        }}
      >
        {fields.map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            {label}
            <textarea
              value={locked ? p[k] : f[k]}
              readOnly={locked}
              rows={k === 'diagnosis' ? 2 : 3}
              maxLength={2000}
              onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))}
              className={cx(
                'rounded-control border px-3 py-2 font-[inherit] font-normal',
                locked ? 'border-line bg-subtle' : 'border-line-strong bg-white',
              )}
            />
          </label>
        ))}
        {!locked && (
          <span className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              Tandatangani (TTE {DOKTER_PA})
            </Button>
            <span className="text-caption text-ink-500">
              Setelah ditandatangani laporan terkunci; koreksi lewat addendum.
            </span>
          </span>
        )}
      </form>
      {p.signed && (
        <span role="status" className="text-small font-semibold text-success">
          ✓ Ditandatangani {p.signed.by} · {formatTanggalWaktu(p.signed.at)} · terkunci
        </span>
      )}
      {p.addenda.map((a) => (
        <div key={a.at} className="rounded-control border border-info-border bg-info-bg p-3 text-small">
          <span className="font-semibold">
            Addendum {formatTanggalWaktu(a.at)} · {a.by}:
          </span>{' '}
          {a.text}
        </div>
      ))}
      {locked && (
        <form
          aria-label="Addendum laporan PA"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const gate = paAddendumGate(p, addendum);
            if (gate) return onLocalError(MICRO_GATE_TEXT[gate]);
            onAddendum(addendum);
            setAddendum('');
          }}
        >
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Addendum (laporan asli tidak diubah)
            <textarea
              value={addendum}
              rows={2}
              maxLength={2000}
              onChange={(e) => setAddendum(e.target.value)}
              className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] font-normal"
            />
          </label>
          <Button type="submit" className="self-start" disabled={busy}>
            Tambah addendum
          </Button>
        </form>
      )}
    </>
  );
}
