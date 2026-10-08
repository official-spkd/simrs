'use client';

import {
  type ChecklistPhaseId,
  COUNT_KIND_LABEL,
  COUNT_KINDS,
  formatJam,
  SAFETY_REASON_MIN,
  type SurgeryCandidate,
  type SurgeryCaseView,
  SURGERY_OVERRIDE_REASON_MIN,
} from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId, useState, useTransition } from 'react';
import { PHASE_LABEL, PHASE_WHEN } from '@/lib/penunjang-ok';
import {
  activePhase,
  confirmed,
  EVENT_LABEL,
  eventBlock,
  manualRemaining,
  nextEvent,
  signInBlockers,
  wibInstant,
} from '@/lib/penunjang-ok-api';
import {
  cancelCaseAction,
  checkItemAction,
  confirmPhaseAction,
  countAction,
  discrepancyAction,
  recordEventAction,
  scheduleCaseAction,
  searchCandidatesAction,
  suppliesAction,
} from './actions-api';

export type Msg = { ok: boolean; text: string; reasons?: string[] } | null;
type Done = (m: Msg) => void;
type Result = { ok: true; data: SurgeryCaseView } | { ok: false; message: string; reasons?: string[] };

const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-body';
const CARD = 'flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 p-4 shadow-card';
const PHASE_NEXT: Record<ChecklistPhaseId, string> = {
  'sign-in': 'induksi dapat dimulai',
  'time-out': 'insisi dapat dicatat',
  'sign-out': 'pasien boleh dipindahkan ke ruang pemulihan',
};

function useAct(onDone: Done) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, ok: string) =>
    start(async () => {
      const r = await fn();
      onDone(r.ok ? { ok: true, text: ok } : { ok: false, text: r.message, reasons: r.reasons });
    });
  return { pending, run };
}

const nowIso = () => new Date(Date.now() - 30_000).toISOString();

/** Daftar tilik WHO tiga fase: butir sistem tidak bisa dicentang; konfirmasi hanya fase aktif yang lengkap. */
export function ChecklistPanel({
  c,
  canWrite,
  onDone,
}: {
  c: SurgeryCaseView;
  canWrite: boolean;
  onDone: Done;
}) {
  const { pending, run } = useAct(onDone);
  const active = activePhase(c);
  const off = !canWrite || c.status === 'batal' || c.status === 'selesai';
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {c.checklist.map((p) => {
        const isActive = p.phase === active;
        const left = manualRemaining(c, p.phase);
        // Sign in tertahan bila persetujuan tindakan atau asesmen pra-anestesi final belum ada (server menegakkan ulang).
        const blockers = p.phase === 'sign-in' && isActive ? signInBlockers(c) : [];
        return (
          <fieldset
            key={p.phase}
            className={cx(
              'm-0 flex flex-col gap-1.5 rounded-control border p-3',
              isActive ? 'border-brand-600 bg-brand-50/40' : 'border-line-soft bg-white',
            )}
          >
            <legend className="px-1 text-small font-semibold">
              {PHASE_LABEL[p.phase]} · {PHASE_WHEN[p.phase]}
            </legend>
            {p.items.map((i) => (
              <label key={i.code} className="flex min-h-11 items-start gap-2 text-small">
                <input
                  type="checkbox"
                  data-phase={p.phase}
                  data-item={i.code}
                  checked={i.checked}
                  disabled={off || i.system || i.checked || !!p.confirmedAt || !isActive || pending}
                  onChange={() =>
                    run(
                      () => checkItemAction(c.id, { phase: p.phase, itemCode: i.code }),
                      `Butir "${i.label}" dicentang.`,
                    )
                  }
                  className="mt-0.5 size-[18px] accent-brand-600"
                />
                <span>
                  {i.label}
                  {i.system && (
                    <span className="block text-caption text-ink-500">
                      diisi sistem{i.checked ? ' · terpenuhi' : ''}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {!p.confirmedAt && blockers.length > 0 && (
              <ul className="m-0 pl-4 text-caption text-warning">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {p.confirmedAt ? (
              <span className="text-caption font-semibold text-success">
                Dikonfirmasi {formatJam(p.confirmedAt)} · {p.confirmedBy}
              </span>
            ) : (
              canWrite && (
                <Button
                  size="sm"
                  variant={isActive && left === 0 ? 'primary' : 'secondary'}
                  disabled={off || !isActive || left > 0 || blockers.length > 0 || pending}
                  onClick={() =>
                    run(
                      () => confirmPhaseAction(c.id, { phase: p.phase }),
                      `${PHASE_LABEL[p.phase]} dikonfirmasi · ${PHASE_NEXT[p.phase]}.`,
                    )
                  }
                >
                  Konfirmasi {PHASE_LABEL[p.phase].toLowerCase()}
                  {isActive && left > 0 ? ` (${left} butir lagi)` : ''}
                </Button>
              )
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

/** Peristiwa intraoperatif berurutan; insisi terkunci sebelum time out kecuali override dokter beralasan. */
export function EventPanel({
  c,
  canWrite,
  canOverride,
  onDone,
}: {
  c: SurgeryCaseView;
  canWrite: boolean;
  canOverride: boolean;
  onDone: Done;
}) {
  const id = useId();
  const { pending, run } = useAct(onDone);
  const [reason, setReason] = useState('');
  const next = nextEvent(c);
  const block = eventBlock(c);
  const overrideOpen =
    next === 'insisi' && !confirmed(c, 'time-out') && canOverride && confirmed(c, 'sign-in');
  return (
    <section aria-label="Peristiwa operasi" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Peristiwa operasi</h2>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-small">
        {c.events.length === 0 && <li className="text-ink-500">Belum ada peristiwa tercatat.</li>}
        {c.events.map((e) => (
          <li key={e.kind}>
            {EVENT_LABEL[e.kind]} · {formatJam(e.at)} · {e.by}
            {e.overrideReason ? ` · override: ${e.overrideReason}` : ''}
          </li>
        ))}
      </ul>
      {next && canWrite && (
        <>
          <Button
            variant="primary"
            disabled={!!block || pending}
            onClick={() =>
              run(
                () => recordEventAction(c.id, { kind: next, occurredAt: nowIso(), overrideReason: null }),
                `${EVENT_LABEL[next]} dicatat.`,
              )
            }
          >
            Catat {EVENT_LABEL[next].toLowerCase()}
          </Button>
          {block && <span className="text-caption font-semibold text-warning">{block}</span>}
        </>
      )}
      {overrideOpen && (
        <form
          aria-label="Override insisi"
          className="flex flex-col gap-1.5 rounded-control border border-koral-200 bg-alert-critical p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                recordEventAction(c.id, {
                  kind: 'insisi',
                  occurredAt: nowIso(),
                  overrideReason: reason.trim(),
                }),
              'Override time out tercatat (ditinjau mutu), insisi dicatat.',
            );
          }}
        >
          <label htmlFor={`${id}-ovr`} className="text-small font-semibold text-danger-strong">
            Override dokter: alasan insisi sebelum time out (minimal {SURGERY_OVERRIDE_REASON_MIN} karakter)
          </label>
          <input
            id={`${id}-ovr`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            className={INPUT}
          />
          <Button
            type="submit"
            variant="danger"
            disabled={pending || reason.trim().length < SURGERY_OVERRIDE_REASON_MIN}
          >
            Catat insisi dengan override
          </Button>
        </form>
      )}
    </section>
  );
}

const DEFAULT_COUNT_ITEMS = [
  { itemCode: 'kasa', label: 'Kasa' },
  { itemCode: 'jarum', label: 'Jarum' },
  { itemCode: 'instrumen', label: 'Instrumen' },
];

/** Hitung kasa/jarum/instrumen: awal, tambahan, akhir; selisih wajib ditindaklanjuti sebelum sign out. */
export function CountPanel({ c, canWrite, onDone }: { c: SurgeryCaseView; canWrite: boolean; onDone: Done }) {
  const id = useId();
  const { pending, run } = useAct(onDone);
  const [kind, setKind] = useState<(typeof COUNT_KINDS)[number]>(c.counts.length ? 'akhir' : 'awal');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [action, setAction] = useState('');
  const items = c.counts.length
    ? c.counts.map((x) => ({ itemCode: x.itemCode, label: x.label }))
    : DEFAULT_COUNT_ITEMS;
  const locked = confirmed(c, 'sign-out') || c.status === 'batal';
  const filled = items.filter((i) => /^\d{1,4}$/.test(qty[i.itemCode] ?? ''));
  const target = c.unreconciled[0];
  return (
    <section aria-label="Hitung kasa" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Hitung kasa, jarum, instrumen</h2>
      {c.counts.length > 0 && (
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-caption text-ink-500">
              <th className="py-1 font-semibold">Butir</th>
              <th className="py-1 font-semibold">Awal + tambahan</th>
              <th className="py-1 font-semibold">Akhir</th>
              <th className="py-1 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {c.counts.map((x) => {
              const open = c.unreconciled.includes(x.itemCode);
              return (
                <tr key={x.itemCode} className="border-t border-line-soft">
                  <td className="py-1">{x.label}</td>
                  <td className="py-1 font-mono">{x.expected}</td>
                  <td className="py-1 font-mono">{x.final ?? '—'}</td>
                  <td className={cx('py-1 font-semibold', open ? 'text-danger' : 'text-success')}>
                    {x.final === null
                      ? 'belum dihitung akhir'
                      : x.final === x.expected
                        ? 'cocok'
                        : x.resolution
                          ? `selisih · ditindaklanjuti`
                          : 'selisih'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {canWrite && !locked && (
        <form
          aria-label="Catat hitung"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                countAction(c.id, {
                  kind,
                  items: filled.map((i) => ({ ...i, quantity: Number(qty[i.itemCode]) })),
                }),
              `${COUNT_KIND_LABEL[kind]} tercatat.`,
            );
            setQty({});
          }}
        >
          <label htmlFor={`${id}-kind`} className="flex flex-col gap-1 text-caption font-semibold">
            Jenis hitung
            <select
              id={`${id}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className={INPUT}
            >
              {COUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {COUNT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {items.map((i) => (
              <label key={i.itemCode} className="flex flex-col gap-1 text-caption font-semibold">
                {i.label}
                <input
                  inputMode="numeric"
                  value={qty[i.itemCode] ?? ''}
                  maxLength={4}
                  onChange={(e) => setQty((cur) => ({ ...cur, [i.itemCode]: e.target.value }))}
                  className={cx(INPUT, 'font-mono')}
                />
              </label>
            ))}
          </div>
          <Button type="submit" disabled={pending || filled.length === 0}>
            Simpan {COUNT_KIND_LABEL[kind].toLowerCase()}
          </Button>
        </form>
      )}
      {canWrite && !locked && target && c.counts.find((x) => x.itemCode === target)?.final !== null && (
        <form
          aria-label="Tindak lanjut selisih"
          className="flex flex-col gap-1.5 rounded-control border border-kunyit-200 bg-alert-warning p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => discrepancyAction(c.id, { itemCode: target, action: action.trim() }),
              'Tindak lanjut selisih tercatat.',
            );
            setAction('');
          }}
        >
          <label htmlFor={`${id}-act`} className="text-small font-semibold">
            Tindak lanjut selisih {c.counts.find((x) => x.itemCode === target)?.label.toLowerCase()} (mis.
            rontgen intraoperatif)
          </label>
          <input
            id={`${id}-act`}
            value={action}
            maxLength={1000}
            onChange={(e) => setAction(e.target.value)}
            className={INPUT}
          />
          <Button type="submit" disabled={pending || action.trim().length < 10}>
            Simpan tindak lanjut
          </Button>
        </form>
      )}
    </section>
  );
}

/** BHP/implan dari depo OK (ledger `usage`; saldo dan ED dijaga server). */
export function SuppliesPanel({
  c,
  options,
  canWrite,
  onDone,
}: {
  c: SurgeryCaseView;
  options: Array<{
    stockBatchId: string;
    name: string;
    batchNo: string;
    expiryDate: string;
    quantity: number;
  }>;
  canWrite: boolean;
  onDone: Done;
}) {
  const id = useId();
  const { pending, run } = useAct(onDone);
  const [batch, setBatch] = useState('');
  const [qty, setQty] = useState('1');
  const [implant, setImplant] = useState(false);
  const off = !canWrite || c.status === 'batal' || c.status === 'selesai';
  return (
    <section aria-label="BHP dan implan" className={CARD}>
      <h2 className="m-0 text-body font-semibold">BHP dan implan</h2>
      {c.supplies.length === 0 ? (
        <p className="m-0 text-small text-ink-500">Belum ada BHP tercatat.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-small">
          {c.supplies.map((s) => (
            <li key={s.id}>
              {s.name} · batch <span className="font-mono">{s.batchNo}</span> · {s.quantity}
              {s.implant ? ' · implan' : ''}
            </li>
          ))}
        </ul>
      )}
      {!off &&
        (options.length === 0 ? (
          <p className="m-0 text-caption text-ink-500">Stok depo kamar operasi kosong.</p>
        ) : (
          <form
            aria-label="Catat BHP"
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  suppliesAction(c.id, { items: [{ stockBatchId: batch, quantity: Number(qty), implant }] }),
                'BHP tercatat; stok depo OK berkurang.',
              );
            }}
          >
            <label
              htmlFor={`${id}-b`}
              className="flex min-w-[200px] flex-1 flex-col gap-1 text-caption font-semibold"
            >
              Barang (batch depo OK)
              <select
                id={`${id}-b`}
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                className={INPUT}
              >
                <option value="">Pilih…</option>
                {options.map((o) => (
                  <option key={o.stockBatchId} value={o.stockBatchId}>
                    {o.name} · {o.batchNo} · sisa {o.quantity}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1 text-caption font-semibold">
              Jumlah
              <input
                inputMode="numeric"
                value={qty}
                maxLength={4}
                onChange={(e) => setQty(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-small">
              <input
                type="checkbox"
                checked={implant}
                onChange={(e) => setImplant(e.target.checked)}
                className="size-[18px] accent-brand-600"
              />
              Implan
            </label>
            <Button type="submit" disabled={pending || !batch || !/^[1-9]\d{0,3}$/.test(qty)}>
              Catat BHP
            </Button>
          </form>
        ))}
    </section>
  );
}

/** Batal operasi (sebelum berjalan) wajib alasan. */
export function CancelPanel({ c, onDone }: { c: SurgeryCaseView; onDone: Done }) {
  const id = useId();
  const { pending, run } = useAct(onDone);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (c.status === 'berjalan' || c.status === 'selesai' || c.status === 'batal') return null;
  return (
    <section aria-label="Batalkan operasi" className={CARD}>
      {!open ? (
        <Button variant="ghost" className="self-start" onClick={() => setOpen(true)}>
          Batalkan operasi…
        </Button>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => cancelCaseAction(c.id, { reason: reason.trim() }), 'Operasi dibatalkan.');
          }}
        >
          <label htmlFor={`${id}-r`} className="text-small font-semibold">
            Alasan batal (minimal {SAFETY_REASON_MIN} karakter)
          </label>
          <input
            id={`${id}-r`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            className={INPUT}
          />
          <span className="flex gap-2">
            <Button
              type="submit"
              variant="danger"
              disabled={pending || reason.trim().length < SAFETY_REASON_MIN}
            >
              Batalkan operasi
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Tutup
            </Button>
          </span>
        </form>
      )}
    </section>
  );
}

/** Jadwalkan operasi: kunjungan aktif (cari RM/nomor), kamar, jam WIB, durasi, prioritas, tindakan, tim. */
export function ScheduleForm({
  date,
  rooms,
  staff,
  onCancel,
  onDone,
}: {
  date: string;
  rooms: Array<{ id: string; name: string }>;
  staff: Array<{ userId: string; name: string; role: string }>;
  onCancel: () => void;
  onDone: (c: SurgeryCaseView) => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<SurgeryCandidate[] | null>(null);
  const [encounterId, setEncounterId] = useState('');
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [day, setDay] = useState(date);
  const [start, setStart] = useState('08.00');
  const [minutes, setMinutes] = useState('90');
  const [priority, setPriority] = useState<'elektif' | 'cito'>('elektif');
  const [procedure, setProcedure] = useState('');
  const [code, setCode] = useState('');
  const [operator, setOperator] = useState('');
  const [anesthetist, setAnesthetist] = useState('');
  const [nurse, setNurse] = useState('');
  const [penata, setPenata] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start_] = useTransition();
  const doctors = staff.filter((s) => s.role === 'dokter' || s.role === 'dokter_residen');
  const nurses = staff.filter((s) => s.role === 'perawat');
  const startsAt = wibInstant(day, start);
  const dur = Number(minutes);
  const ready =
    !!encounterId &&
    !!roomId &&
    !!startsAt &&
    Number.isInteger(dur) &&
    dur >= 15 &&
    dur <= 720 &&
    procedure.trim().length >= 3 &&
    !!operator &&
    (!code.trim() || /^\d{2}(\.\d{1,2})?$/.test(code.trim()));

  const submit = () =>
    start_(async () => {
      if (!startsAt) return;
      setError(null);
      const team = [
        { userId: operator, role: 'operator' as const },
        ...(anesthetist ? [{ userId: anesthetist, role: 'anestesi' as const }] : []),
        ...(nurse ? [{ userId: nurse, role: 'perawat_sirkuler' as const }] : []),
        ...(penata ? [{ userId: penata, role: 'penata_anestesi' as const }] : []),
      ];
      const r = await scheduleCaseAction({
        encounterId,
        roomId,
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + dur * 60_000).toISOString(),
        priority,
        procedureName: procedure.trim(),
        procedureCode: code.trim() || null,
        team,
      });
      if (r.ok) onDone(r.data);
      else setError(r.message);
    });

  return (
    <section aria-label="Jadwalkan operasi" className={cx(CARD, 'border-brand-200')}>
      <h2 className="m-0 text-body font-semibold">Jadwalkan operasi</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start_(async () => {
            const r = await searchCandidatesAction(q);
            if (r.ok) {
              setFound(r.data);
              setError(null);
            } else setError(r.message);
          });
        }}
      >
        <label
          htmlFor={`${id}-q`}
          className="flex min-w-[220px] flex-1 flex-col gap-1 text-caption font-semibold"
        >
          No. RM atau nomor kunjungan aktif
          <input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} className={INPUT} />
        </label>
        <Button type="submit" disabled={pending || q.trim().length < 3}>
          Cari kunjungan
        </Button>
      </form>
      {found && found.length === 0 && (
        <p className="m-0 text-small text-ink-500">Tidak ada kunjungan aktif yang cocok.</p>
      )}
      {found && found.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-caption font-semibold">Pilih kunjungan</legend>
          {found.map((f) => (
            <label key={f.encounterId} className="flex min-h-11 items-center gap-2 text-small">
              <input
                type="radio"
                name={`${id}-enc`}
                checked={encounterId === f.encounterId}
                onChange={() => setEncounterId(f.encounterId)}
                className="accent-brand-600"
              />
              <span className="font-semibold">{f.patientName}</span>
              <span className="text-ink-500">
                RM <span className="font-mono">{f.rm}</span> · {f.number}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Kamar
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className={INPUT}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Tanggal operasi
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Jam mulai (WIB, HH.MM)
          <input value={start} maxLength={5} onChange={(e) => setStart(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Durasi (menit)
          <input
            inputMode="numeric"
            value={minutes}
            maxLength={3}
            onChange={(e) => setMinutes(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Prioritas
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as 'elektif' | 'cito')}
            className={INPUT}
          >
            <option value="elektif">Elektif</option>
            <option value="cito">Cito</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Kode ICD-9-CM (opsional)
          <input value={code} maxLength={5} onChange={(e) => setCode(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold sm:col-span-3">
          Nama tindakan
          <input
            value={procedure}
            maxLength={200}
            onChange={(e) => setProcedure(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Operator
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className={INPUT}>
            <option value="">Pilih dokter…</option>
            {doctors.map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Dokter anestesi (opsional)
          <select value={anesthetist} onChange={(e) => setAnesthetist(e.target.value)} className={INPUT}>
            <option value="">—</option>
            {doctors.map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Penata anestesi (opsional)
          <select value={penata} onChange={(e) => setPenata(e.target.value)} className={INPUT}>
            <option value="">—</option>
            {nurses.map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          Perawat sirkuler (opsional)
          <select value={nurse} onChange={(e) => setNurse(e.target.value)} className={INPUT}>
            <option value="">—</option>
            {nurses.map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending || !ready} onClick={submit}>
          Simpan jadwal
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </span>
      {error && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
