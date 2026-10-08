'use client';

import {
  ABO_GROUPS,
  ABO_RH_LABEL,
  BLOOD_ISSUE_CHECK_ITEMS,
  BLOOD_URGENCIES,
  type BloodComponentOption,
  type BloodIssueRecord,
  type BloodRequestRecord,
  type BloodUnitRecord,
  RH_FACTORS,
  TRANSFUSION_REACTION_SIGNS,
  TRANSFUSION_VITAL_LABEL,
  type TransfusionRecord,
} from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useId, useState, useTransition } from 'react';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import { formatTglJam } from '@/lib/rawat-inap';
import {
  cancelBloodRequestAction,
  confirmDisposalAction,
  confirmIssueAction,
  crossmatchAction,
  finishTransfusionAction,
  issueCheckAction,
  type PenunjangActionResult,
  receiveBloodRequestAction,
  registerBloodUnitAction,
  reportReactionAction,
  requestDisposalAction,
  requestBloodAction,
  setBloodGroupAction,
  startTransfusionAction,
  transfusionVitalsAction,
  verifyTransfusionAction,
} from '@/lib/server/data/penunjang/penunjang-api-actions';

const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const FIELD =
  'min-h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small';
const BOX = 'flex flex-col gap-2 rounded-control border border-line-soft bg-white px-3 py-2.5';

const STATUS_LABEL: Record<BloodRequestRecord['status'], string> = {
  diminta: 'Diminta',
  diproses: 'Diproses bank darah',
  selesai: 'Kantong lengkap keluar',
  batal: 'Batal',
};
const TRANSFUSION_LABEL: Record<TransfusionRecord['status'], string> = {
  menunggu_verifikasi: 'Menunggu verifikasi petugas kedua',
  berjalan: 'Transfusi berjalan',
  selesai: 'Selesai',
  dihentikan: 'Dihentikan',
};
const groupOf = (abo: string | null, rh: string | null) =>
  abo && rh ? ABO_RH_LABEL(abo as 'A', rh as 'pos') : 'belum diperiksa';

function useAction() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const run = (fn: () => Promise<PenunjangActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok && !r.reaction, text: r.message });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { busy, msg, run };
}

function Field({ label, children, id }: { label: string; children: ReactNode; id: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-small font-semibold">
        {label}
      </label>
      {children}
    </span>
  );
}

export interface BloodPerms {
  me: string;
  /** Batal: DPJP peminta (`request`) atau bank darah (`crossmatch`). */
  cancel: boolean;
  crossmatch: boolean;
  issue: boolean;
  transfuse: boolean;
}

/** S08 · Satu permintaan darah: tahap bank darah (terima, golongan, crossmatch, cek ganda, keluar) + di samping pasien. */
export function BloodRequestCard({
  request: r,
  units,
  perms,
}: {
  request: BloodRequestRecord;
  units: readonly BloodUnitRecord[];
  perms: BloodPerms;
}) {
  const active = r.status === 'diminta' || r.status === 'diproses';
  const reserved = new Set(r.crossmatches.filter((c) => c.result === 'cocok').map((c) => c.bloodUnitId));
  const issuedIds = new Set(r.issues.map((i) => i.bloodUnitId));
  const candidates = units.filter(
    (u) =>
      u.component.code === r.component.code && !u.expired && (u.status === 'tersedia' || reserved.has(u.id)),
  );
  const pending = r.issueChecks.filter((c) => !c.used && !c.expired && !issuedIds.has(c.bloodUnitId));
  return (
    <article
      aria-label={`Permintaan darah ${r.requestNo}`}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">
            {r.patient.name} · <span className="font-mono">{r.requestNo}</span>
          </span>
          <span className="text-caption text-ink-500">
            RM <span className="font-mono">{r.patient.mrn}</span> · {r.patient.unitName ?? '–'}
            {r.patient.bed ? ` · ${r.patient.bed}` : ''} · diminta {r.requestedBy.name},{' '}
            {formatTglJam(r.requestedAt)}
          </span>
          <span className="text-small">
            {r.component.name} × {r.units} · {r.indication} · golongan pasien{' '}
            <strong>{groupOf(r.patientAbo, r.patientRh)}</strong>
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {r.urgency !== 'rutin' && (
            <Chip tone={r.urgency === 'darurat' ? 'danger' : 'warning'}>{r.urgency}</Chip>
          )}
          <Chip tone={active ? 'info' : 'neutral'}>{STATUS_LABEL[r.status]}</Chip>
        </span>
      </header>

      {r.status === 'batal' && r.cancelReason && (
        <p className="m-0 text-small">
          Dibatalkan {r.cancelledBy?.name ?? '–'}: {r.cancelReason}
        </p>
      )}

      {perms.crossmatch && active && <BankSteps r={r} candidates={candidates} />}

      {(r.crossmatches.length > 0 || r.issueChecks.length > 0) && (
        <ul
          aria-label="Crossmatch dan cek ganda"
          className="m-0 flex list-none flex-col gap-1 p-0 text-small"
        >
          {r.crossmatches.map((c) => (
            <li key={c.id}>
              Crossmatch <span className="font-mono">{c.bagNo}</span>:{' '}
              <strong>{c.result === 'cocok' ? 'cocok' : 'tidak cocok'}</strong> ({c.method}) ·{' '}
              {c.testedBy.name}, {formatTglJam(c.testedAt)}
            </li>
          ))}
          {r.issueChecks.map((c) => (
            <li key={c.id}>
              Cek ganda pertama <span className="font-mono">{c.bagNo}</span> · {c.checkedBy.name},{' '}
              {formatTglJam(c.checkedAt)}
              {c.emergencyReason ? ` · DARURAT: ${c.emergencyReason}` : ''} ·{' '}
              {c.used ? 'kantong keluar' : c.expired ? 'kedaluwarsa (ulangi)' : 'menunggu petugas kedua'}
            </li>
          ))}
        </ul>
      )}

      {perms.issue && active && (
        <IssueSteps
          r={r}
          candidates={candidates.filter((u) => !issuedIds.has(u.id))}
          pending={pending}
          me={perms.me}
        />
      )}

      {r.issues.map((i) => (
        <IssuedBag key={i.id} issue={i} perms={perms} />
      ))}

      {perms.cancel && active && <CancelRequest requestId={r.id} requestNo={r.requestNo} />}
    </article>
  );
}

function BankSteps({ r, candidates }: { r: BloodRequestRecord; candidates: readonly BloodUnitRecord[] }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [abo, setAbo] = useState('');
  const [rh, setRh] = useState('');
  const [unitId, setUnitId] = useState('');
  const [result, setResult] = useState<'cocok' | 'tidak_cocok'>('cocok');
  const [method, setMethod] = useState('Gel (Coombs)');
  const locked = r.crossmatches.length > 0 || r.issueChecks.length > 0;
  return (
    <section aria-label={`Bank darah ${r.requestNo}`} className={BOX}>
      <Feedback msg={msg} />
      {r.status === 'diminta' && (
        <Button
          className="self-start"
          disabled={busy}
          onClick={() => run(() => receiveBloodRequestAction(r.id))}
        >
          Terima permintaan + sampel (label cocok)
        </Button>
      )}
      {!locked && (
        <div role="group" aria-label="Golongan darah pasien" className="flex flex-wrap items-end gap-2">
          <Field label="ABO pasien" id={`${id}-abo`}>
            <select id={`${id}-abo`} value={abo} onChange={(e) => setAbo(e.target.value)} className={SELECT}>
              <option value="">–</option>
              {ABO_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rh pasien" id={`${id}-rh`}>
            <select id={`${id}-rh`} value={rh} onChange={(e) => setRh(e.target.value)} className={SELECT}>
              <option value="">–</option>
              {RH_FACTORS.map((g) => (
                <option key={g} value={g}>
                  {g === 'pos' ? 'Rh+' : 'Rh−'}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={busy || !abo || !rh}
            onClick={() => run(() => setBloodGroupAction({ requestId: r.id, abo, rh }))}
          >
            Simpan golongan pasien
          </Button>
        </div>
      )}
      <div role="group" aria-label="Crossmatch" className="flex flex-wrap items-end gap-2">
        <Field label="Kantong untuk crossmatch" id={`${id}-u`}>
          <select
            id={`${id}-u`}
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className={SELECT}
          >
            <option value="">Pilih kantong…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.bagNo} · {ABO_RH_LABEL(u.abo, u.rh)} · ED {u.expiresAt.slice(0, 10)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hasil" id={`${id}-r`}>
          <select
            id={`${id}-r`}
            value={result}
            onChange={(e) => setResult(e.target.value as 'cocok' | 'tidak_cocok')}
            className={SELECT}
          >
            <option value="cocok">Cocok (kompatibel)</option>
            <option value="tidak_cocok">Tidak cocok</option>
          </select>
        </Field>
        <Field label="Metode" id={`${id}-m`}>
          <input
            id={`${id}-m`}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Button
          disabled={busy || !unitId}
          onClick={() =>
            run(
              () => crossmatchAction({ bloodRequestId: r.id, bloodUnitId: unitId, result, method }),
              () => setUnitId(''),
            )
          }
        >
          Catat crossmatch
        </Button>
      </div>
    </section>
  );
}

function IssueSteps({
  r,
  candidates,
  pending,
  me,
}: {
  r: BloodRequestRecord;
  candidates: readonly BloodUnitRecord[];
  pending: BloodRequestRecord['issueChecks'];
  me: string;
}) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [unitId, setUnitId] = useState('');
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [emergency, setEmergency] = useState(false);
  const [reason, setReason] = useState('');
  const matched = new Set(r.crossmatches.filter((c) => c.result === 'cocok').map((c) => c.bloodUnitId));
  const options = emergency
    ? candidates.filter((u) => !matched.has(u.id))
    : candidates.filter((u) => matched.has(u.id));
  const all = BLOOD_ISSUE_CHECK_ITEMS.every((c) => items[c.id]);
  return (
    <section aria-label={`Pengeluaran kantong ${r.requestNo}`} className={BOX}>
      <h3 className="m-0 text-small font-semibold">Cek ganda dua petugas sebelum kantong keluar</h3>
      <Feedback msg={msg} />
      {pending.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2 text-small">
          <span>
            Kantong <span className="font-mono">{c.bagNo}</span> sudah dicek {c.checkedBy.name}.
          </span>
          {c.checkedBy.id === me ? (
            <span className="text-ink-500">
              Petugas kedua (bukan Anda) mengeluarkan dari sesinya sendiri.
            </span>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => run(() => confirmIssueAction(c.id))}>
              Keluarkan kantong {c.bagNo} (petugas kedua)
            </Button>
          )}
        </div>
      ))}
      <div role="group" aria-label="Cek ganda pertama" className="flex flex-col gap-2">
        <label className="flex min-h-11 items-center gap-2 text-small">
          <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
          Darurat tanpa crossmatch (hanya PRC golongan O, alasan dokter)
        </label>
        <Field label="Kantong" id={`${id}-u`}>
          <select
            id={`${id}-u`}
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className={SELECT}
          >
            <option value="">{emergency ? 'Pilih kantong O…' : 'Pilih kantong ber-crossmatch cocok…'}</option>
            {options.map((u) => (
              <option key={u.id} value={u.id}>
                {u.bagNo} · {ABO_RH_LABEL(u.abo, u.rh)} · ED {u.expiresAt.slice(0, 10)}
              </option>
            ))}
          </select>
        </Field>
        {BLOOD_ISSUE_CHECK_ITEMS.map((c) => (
          <label key={c.id} className="flex min-h-11 items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={!!items[c.id]}
              onChange={(e) => setItems((s) => ({ ...s, [c.id]: e.target.checked }))}
            />
            {c.label}
          </label>
        ))}
        {emergency && (
          <Field label="Alasan darurat dari dokter (minimal 10 karakter)" id={`${id}-e`}>
            <textarea
              id={`${id}-e`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={FIELD}
            />
          </Field>
        )}
        <Button
          className="self-start"
          disabled={busy || !unitId || !all}
          onClick={() =>
            run(
              () =>
                issueCheckAction({
                  bloodRequestId: r.id,
                  bloodUnitId: unitId,
                  checklist: items,
                  emergencyReason: emergency ? reason : '',
                }),
              () => {
                setUnitId('');
                setItems({});
              },
            )
          }
        >
          Simpan cek ganda pertama
        </Button>
      </div>
    </section>
  );
}

function VitalsInputs({
  id,
  v,
  set,
}: {
  id: string;
  v: Record<'tempC' | 'systolic' | 'diastolic' | 'pulse', string>;
  set: (k: 'tempC' | 'systolic' | 'diastolic' | 'pulse', val: string) => void;
}) {
  const fields = [
    ['tempC', 'Suhu (°C)'],
    ['systolic', 'Sistolik'],
    ['diastolic', 'Diastolik'],
    ['pulse', 'Nadi'],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {fields.map(([k, label]) => (
        <Field key={k} label={label} id={`${id}-${k}`}>
          <input
            id={`${id}-${k}`}
            inputMode="decimal"
            value={v[k]}
            onChange={(e) => set(k, e.target.value)}
            className={FIELD}
          />
        </Field>
      ))}
    </div>
  );
}

const EMPTY_VITALS = { tempC: '', systolic: '', diastolic: '', pulse: '' };

function IssuedBag({ issue: i, perms }: { issue: BloodIssueRecord; perms: BloodPerms }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [band, setBand] = useState('');
  const [bag, setBag] = useState('');
  const [vitals, setVitals] = useState(EMPTY_VITALS);
  const [label, setLabel] = useState<'15_menit' | '1_jam' | 'selesai' | 'lain'>('15_menit');
  const [signs, setSigns] = useState<string[]>([]);
  const [severity, setSeverity] = useState<'ringan' | 'sedang' | 'berat'>('sedang');
  const [desc, setDesc] = useState('');
  const t = i.transfusion;
  const setV = (k: keyof typeof EMPTY_VITALS, val: string) => setVitals((s) => ({ ...s, [k]: val }));
  const clear = () => {
    setBand('');
    setBag('');
    setVitals(EMPTY_VITALS);
    setSigns([]);
  };
  const scanFields = (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Pindai gelang pasien" id={`${id}-band`}>
        <input
          id={`${id}-band`}
          value={band}
          onChange={(e) => setBand(e.target.value)}
          autoComplete="off"
          className={cx(FIELD, 'font-mono')}
        />
      </Field>
      <Field label="Pindai nomor kantong" id={`${id}-bag`}>
        <input
          id={`${id}-bag`}
          value={bag}
          onChange={(e) => setBag(e.target.value)}
          autoComplete="off"
          className={cx(FIELD, 'font-mono')}
        />
      </Field>
    </div>
  );
  return (
    <section aria-label={`Kantong ${i.bagNo}`} className={BOX}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-small">
        <span>
          Kantong <span className="font-mono font-semibold">{i.bagNo}</span> · {ABO_RH_LABEL(i.abo, i.rh)} ·
          keluar {formatTglJam(i.issuedAt)} · cek ganda {i.checkedBy?.name ?? '–'} + {i.issuedBy.name}
          {i.emergencyReason ? ` · DARURAT: ${i.emergencyReason}` : ''}
        </span>
        <Chip tone={t?.status === 'dihentikan' ? 'danger' : t?.status === 'berjalan' ? 'info' : 'neutral'}>
          {t ? TRANSFUSION_LABEL[t.status] : 'Belum dipasang'}
        </Chip>
      </div>
      {t && t.vitals.length > 0 && (
        <ul
          aria-label="TTV transfusi"
          className="m-0 flex list-none flex-col gap-0.5 p-0 text-caption text-ink-700"
        >
          {t.vitals.map((v) => (
            <li key={v.id}>
              {TRANSFUSION_VITAL_LABEL[v.label]}: {String(v.tempC).replace('.', ',')} °C · {v.systolic}/
              {v.diastolic} · nadi {v.pulse}
              {v.signs.length ? ` · ${v.signs.join(', ')}` : ''} · {v.recordedBy.name}
            </li>
          ))}
        </ul>
      )}
      {t?.stopReason && <p className="m-0 text-small font-semibold text-danger">{t.stopReason}</p>}
      {i.reactions.map((x) => (
        <p key={x.id} className="m-0 text-small">
          Reaksi {x.severity}: {x.description} · {x.reportedBy.name}
        </p>
      ))}
      <Feedback msg={msg} />
      {perms.transfuse && !t && (
        <div role="group" aria-label={`Pasang kantong ${i.bagNo}`} className="flex flex-col gap-2">
          <p className="m-0 text-caption text-ink-500">
            Pindai gelang pasien dan label kantong. Salah pasien/kantong menghentikan proses tanpa override;
            gelang tidak terbaca → cetak ulang gelang beralasan.
          </p>
          {scanFields}
          <VitalsInputs id={`${id}-b`} v={vitals} set={setV} />
          <Button
            variant="primary"
            className="self-start"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  startTransfusionAction({
                    bloodIssueId: i.id,
                    wristbandCode: band,
                    bagNo: bag,
                    baseline: vitals,
                  }),
                clear,
              )
            }
          >
            Cocokkan gelang + kantong dan catat TTV awal
          </Button>
        </div>
      )}
      {perms.transfuse && t?.status === 'menunggu_verifikasi' && (
        <div role="group" aria-label={`Verifikasi petugas kedua ${i.bagNo}`} className="flex flex-col gap-2">
          {t.startedBy.id === perms.me ? (
            <p className="m-0 text-small text-ink-500">
              Dipasang oleh Anda. Petugas kedua (bukan Anda) memindai ulang gelang + kantong dari sesinya
              sendiri.
            </p>
          ) : (
            <>
              <p className="m-0 text-small">
                Petugas kedua: pindai ulang gelang dan kantong sebelum transfusi dimulai.
              </p>
              {scanFields}
              <Button
                variant="primary"
                className="self-start"
                disabled={busy}
                onClick={() =>
                  run(
                    () => verifyTransfusionAction({ transfusionId: t.id, wristbandCode: band, bagNo: bag }),
                    clear,
                  )
                }
              >
                Verifikasi petugas kedua
              </Button>
            </>
          )}
        </div>
      )}
      {perms.transfuse && t?.status === 'berjalan' && (
        <div role="group" aria-label={`TTV transfusi ${i.bagNo}`} className="flex flex-col gap-2">
          <Field label="Waktu TTV" id={`${id}-lbl`}>
            <select
              id={`${id}-lbl`}
              value={label}
              onChange={(e) => setLabel(e.target.value as typeof label)}
              className={SELECT}
            >
              {(['15_menit', '1_jam', 'selesai', 'lain'] as const).map((l) => (
                <option key={l} value={l}>
                  {TRANSFUSION_VITAL_LABEL[l]}
                </option>
              ))}
            </select>
          </Field>
          <VitalsInputs id={`${id}-v`} v={vitals} set={setV} />
          <fieldset className="m-0 flex flex-wrap gap-x-4 border-0 p-0">
            <legend className="text-small font-semibold">Gejala reaksi</legend>
            {TRANSFUSION_REACTION_SIGNS.map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2 text-small">
                <input
                  type="checkbox"
                  checked={signs.includes(s)}
                  onChange={(e) => setSigns((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))}
                />
                {s}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                run(() => transfusionVitalsAction({ transfusionId: t.id, label, ...vitals, signs }), clear)
              }
            >
              Catat TTV
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => run(() => finishTransfusionAction(t.id))}
            >
              Transfusi selesai
            </Button>
          </div>
        </div>
      )}
      {perms.transfuse && t && t.status !== 'menunggu_verifikasi' && i.reactions.length === 0 && (
        <details open={t.status === 'dihentikan'}>
          <summary className="cursor-pointer text-small font-semibold">Laporkan reaksi transfusi</summary>
          <div role="group" aria-label={`Laporan reaksi ${i.bagNo}`} className="mt-2 flex flex-col gap-2">
            <Field label="Tingkat" id={`${id}-sev`}>
              <select
                id={`${id}-sev`}
                value={severity}
                onChange={(e) => setSeverity(e.target.value as typeof severity)}
                className={SELECT}
              >
                <option value="ringan">Ringan</option>
                <option value="sedang">Sedang</option>
                <option value="berat">Berat</option>
              </select>
            </Field>
            <Field label="Uraian reaksi dan tindakan" id={`${id}-desc`}>
              <textarea
                id={`${id}-desc`}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className={FIELD}
              />
            </Field>
            <Button
              className="self-start"
              disabled={busy}
              onClick={() =>
                run(() => reportReactionAction({ bloodIssueId: i.id, severity, description: desc }))
              }
            >
              Kirim laporan reaksi
            </Button>
          </div>
        </details>
      )}
    </section>
  );
}

/** S08 · Permintaan darah oleh DPJP untuk satu kunjungan. */
export function BloodRequestForm({
  encounterId,
  components,
}: {
  encounterId: string;
  components: readonly BloodComponentOption[];
}) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [componentCode, setComponent] = useState('PRC');
  const [units, setUnits] = useState('1');
  const [urgency, setUrgency] = useState<(typeof BLOOD_URGENCIES)[number]>('rutin');
  const [indication, setIndication] = useState('');
  const [group, setGroup] = useState('');
  return (
    <form
      aria-label="Permintaan darah"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => requestBloodAction({ encounterId, componentCode, units, urgency, indication, group }),
          () => setIndication(''),
        );
      }}
    >
      <Feedback msg={msg} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Komponen" id={`${id}-c`}>
          <select
            id={`${id}-c`}
            value={componentCode}
            onChange={(e) => setComponent(e.target.value)}
            className={SELECT}
          >
            {components.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Jumlah kantong" id={`${id}-n`}>
          <input
            id={`${id}-n`}
            inputMode="numeric"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="Urgensi" id={`${id}-u`}>
          <select
            id={`${id}-u`}
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as (typeof BLOOD_URGENCIES)[number])}
            className={SELECT}
          >
            {BLOOD_URGENCIES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Golongan pasien bila sudah diketahui" id={`${id}-g`}>
          <select id={`${id}-g`} value={group} onChange={(e) => setGroup(e.target.value)} className={SELECT}>
            <option value="">Belum diketahui (diperiksa bank darah)</option>
            {ABO_GROUPS.flatMap((a) =>
              RH_FACTORS.map((rh) => (
                <option key={`${a}|${rh}`} value={`${a}|${rh}`}>
                  {ABO_RH_LABEL(a, rh)}
                </option>
              )),
            )}
          </select>
        </Field>
      </div>
      <Field label="Indikasi transfusi" id={`${id}-i`}>
        <input
          id={`${id}-i`}
          value={indication}
          onChange={(e) => setIndication(e.target.value)}
          className={FIELD}
        />
      </Field>
      <Button type="submit" variant="primary" className="self-start" disabled={busy}>
        Kirim permintaan darah
      </Button>
    </form>
  );
}

/** S08 · Kantong masuk dari UTD/PMI. */
export function BloodUnitForm({ components }: { components: readonly BloodComponentOption[] }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [bagNo, setBagNo] = useState('');
  const [componentCode, setComponent] = useState('PRC');
  const [abo, setAbo] = useState('O');
  const [rh, setRh] = useState('pos');
  const [collectedOn, setCollected] = useState('');
  const [expiresOn, setExpires] = useState('');
  return (
    <form
      aria-label="Kantong masuk"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => registerBloodUnitAction({ bagNo, componentCode, abo, rh, collectedOn, expiresOn }),
          () => setBagNo(''),
        );
      }}
    >
      <Feedback msg={msg} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Nomor kantong" id={`${id}-b`}>
          <input id={`${id}-b`} value={bagNo} onChange={(e) => setBagNo(e.target.value)} className={FIELD} />
        </Field>
        <Field label="Komponen" id={`${id}-c`}>
          <select
            id={`${id}-c`}
            value={componentCode}
            onChange={(e) => setComponent(e.target.value)}
            className={SELECT}
          >
            {components.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Golongan" id={`${id}-g`}>
          <select
            id={`${id}-g`}
            value={`${abo}|${rh}`}
            onChange={(e) => {
              const [a, r] = e.target.value.split('|');
              setAbo(a ?? 'O');
              setRh(r ?? 'pos');
            }}
            className={SELECT}
          >
            {ABO_GROUPS.flatMap((a) =>
              RH_FACTORS.map((r) => (
                <option key={`${a}|${r}`} value={`${a}|${r}`}>
                  {ABO_RH_LABEL(a, r)}
                </option>
              )),
            )}
          </select>
        </Field>
        <Field label="Tanggal ambil" id={`${id}-t`}>
          <input
            id={`${id}-t`}
            type="date"
            value={collectedOn}
            onChange={(e) => setCollected(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="Kedaluwarsa" id={`${id}-e`}>
          <input
            id={`${id}-e`}
            type="date"
            value={expiresOn}
            onChange={(e) => setExpires(e.target.value)}
            className={FIELD}
          />
        </Field>
      </div>
      <Button type="submit" className="self-start" disabled={busy}>
        Simpan kantong masuk
      </Button>
    </form>
  );
}

function CancelRequest({ requestId, requestNo }: { requestId: string; requestNo: string }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [reason, setReason] = useState('');
  return (
    <details>
      <summary className="cursor-pointer text-small font-semibold">Batalkan permintaan {requestNo}</summary>
      <div role="group" aria-label={`Batalkan ${requestNo}`} className="mt-2 flex flex-col gap-2">
        <Feedback msg={msg} />
        <Field label="Alasan pembatalan" id={`${id}-r`}>
          <input
            id={`${id}-r`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Button
          variant="danger"
          className="self-start"
          disabled={busy}
          onClick={() => run(() => cancelBloodRequestAction({ requestId, reason }))}
        >
          Batalkan permintaan
        </Button>
      </div>
    </details>
  );
}

/** S08 · Satu kantong di stok: ajukan pemusnahan (petugas pertama) atau konfirmasi (petugas KEDUA). */
export function StockUnitRow({
  unit: u,
  me,
  canDispose,
}: {
  unit: BloodUnitRecord;
  me: string;
  canDispose: boolean;
}) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<'kedaluwarsa' | 'rusak'>(u.expired ? 'kedaluwarsa' : 'rusak');
  const [reason, setReason] = useState('');
  return (
    <li aria-label={`Kantong stok ${u.bagNo}`} className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span>
          <span className="font-mono">{u.bagNo}</span> · {u.component.code} · {ABO_RH_LABEL(u.abo, u.rh)} · ED{' '}
          {u.expiresAt.slice(0, 10)} · {u.status}
        </span>
        {u.expired && <Chip tone="danger">kedaluwarsa</Chip>}
        {u.disposal && <Chip tone="warning">diajukan musnah · {u.disposal.requestedBy.name}</Chip>}
        {canDispose && u.disposal && u.disposal.requestedBy.id !== me && (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => run(() => confirmDisposalAction(u.disposal?.id))}
          >
            Konfirmasi musnah (petugas kedua)
          </Button>
        )}
        {canDispose && !u.disposal && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            Musnahkan…
          </Button>
        )}
      </span>
      <Feedback msg={msg} />
      {open && !u.disposal && (
        <div role="group" aria-label={`Musnahkan ${u.bagNo}`} className="flex flex-wrap items-end gap-2">
          <Field label="Kategori" id={`${id}-c`}>
            <select
              id={`${id}-c`}
              value={category}
              onChange={(e) => setCategory(e.target.value as 'kedaluwarsa' | 'rusak')}
              className={SELECT}
            >
              <option value="kedaluwarsa">Kedaluwarsa</option>
              <option value="rusak">Rusak / hemolisis / bocor</option>
            </select>
          </Field>
          <Field label="Alasan" id={`${id}-r`}>
            <input
              id={`${id}-r`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Button
            disabled={busy}
            onClick={() =>
              run(
                () => requestDisposalAction({ bloodUnitId: u.id, category, reason }),
                () => setOpen(false),
              )
            }
          >
            Ajukan pemusnahan
          </Button>
        </div>
      )}
    </li>
  );
}
