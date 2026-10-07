'use client';

import {
  type ActiveWristbandScan,
  type DoubleCheckView,
  type EmarBoard,
  type EmarOrder,
  type EmarScheduleSlot,
  formatJam,
  formatTanggalLahir,
  SAFETY_REASON_MIN,
  type WristbandPrint,
} from '@simrs/shared';
import { Button, Chip, cx, SafetyGate } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { EMAR_STATE_META } from '@/lib/rawat-inap';
import {
  administerAction,
  doubleCheckAction,
  emarAttestationsAction,
  replaceWristbandAction,
  scanWristbandAction,
} from './actions-api';
import type { Me, Perms } from './api-workspace';

type Scan = { scanId: string; scannedAt: string };
type Status = 'given' | 'held' | 'refused';
type Pick = { order: EmarOrder; slot: EmarScheduleSlot | null };

const STATUS_LABEL: Record<Status, string> = {
  given: 'Diberikan',
  held: 'Ditunda',
  refused: 'Ditolak pasien',
};
const FREQ_LABEL: Record<string, string> = { prn: 'Bila perlu (PRN)', stat: 'Stat (sekali)' };

/** Slot yang boleh dicatat: jadwal, terlambat, atau ditunda (dosis tertunda boleh diberikan kemudian). */
const doable = (s: EmarScheduleSlot) =>
  s.state === 'jadwal' || s.state === 'terlambat' || s.state === 'ditunda';
const unscheduled = (o: EmarOrder) => o.frequency === 'prn' || o.frequency === 'stat';

function slotLabel(s: EmarScheduleSlot): string {
  const a = s.administration;
  if (!a) return s.state === 'rencana' ? s.time : EMAR_STATE_META[s.state].label;
  if (a.status === 'given') return `✓ ${formatJam(a.at)}`;
  return a.status === 'held' ? 'Ditunda' : 'Ditolak';
}

/**
 * eMAR mode api (K12, layar W4; mockup Ranap): pemberian obat terkunci sampai gelang pasien cocok (pindai kode
 * gelang, diperiksa server; tidak cocok tercatat + diaudit). Gelang tidak terbaca → verifikasi manual dua identitas
 * beralasan → gelang lama batal, gelang baru terbit dan WAJIB dipindai (tidak ada jalur melewati pindai, keputusan
 * fase 3 no. 8). Dosis dicatat satu per satu: pindai label obat, status diberikan/ditunda/ditolak (alasan wajib bila
 * ditunda/ditolak/terlambat), obat kewaspadaan tinggi wajib cek ganda dari sesi perawat kedua (ADR-0077).
 */
export function ApiEmarPanel({
  encounterId,
  board,
  patient,
  scans,
  checks: initialChecks,
  me,
  perms,
  active,
}: {
  encounterId: string;
  board: EmarBoard;
  patient: { name: string; mrn: string };
  scans: ActiveWristbandScan[];
  checks: DoubleCheckView[];
  me: Me;
  perms: Perms;
  active: boolean;
}) {
  const router = useRouter();
  const mine = scans.find((s) => s.by.userId === me.id);
  const [scan, setScan] = useState<Scan | null>(mine ? { scanId: mine.id, scannedAt: mine.scannedAt } : null);
  // Bacaan terbaru dari "Periksa cek ganda" berlaku sampai server mengirim data baru (router.refresh).
  const [fresh, setFresh] = useState<{
    base: DoubleCheckView[];
    checks: DoubleCheckView[];
    scans: ActiveWristbandScan[];
  } | null>(null);
  const latest = fresh && fresh.base === initialChecks ? fresh : null;
  const checks = latest?.checks ?? initialChecks;
  const peerScans = (latest?.scans ?? scans).filter((s) => s.by.userId !== me.id);
  const [pick, setPick] = useState<Pick | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const canGive = perms.administer && active;
  const unlocked = canGive && scan !== null;

  const times = [...new Set(board.orders.flatMap((o) => o.slots.map((s) => s.time)))].sort();
  const hasUnscheduled = board.orders.some(unscheduled);
  const statGiven = (o: EmarOrder) =>
    o.frequency === 'stat' &&
    board.administrations.some(
      (a) => a.medicationRequestId === o.medicationRequestId && a.status === 'given',
    );

  const reloadAttestations = () =>
    start(async () => {
      const r = await emarAttestationsAction(encounterId);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setFresh({ base: initialChecks, checks: r.data.checks, scans: r.data.scans });
      const still = r.data.scans.find((s) => s.by.userId === me.id && s.id === scan?.scanId);
      if (scan && !still) {
        setScan(null);
        setMsg({ ok: false, text: 'Pindaian gelang Anda sudah kedaluwarsa. Pindai ulang gelang pasien.' });
      }
    });

  const nameOf = (id: string) => board.orders.find((o) => o.medicationRequestId === id)?.name ?? 'Obat';
  const log = [...board.administrations].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section aria-label="eMAR" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-body font-semibold">
            eMAR · jadwal pemberian obat {formatTanggalLahir(board.date)}
          </h2>
          <span className="text-caption text-ink-500">Sumber: order obat aktif (CPOE)</span>
        </div>
        {!perms.administer ? (
          <p className="m-0 rounded-control bg-subtle px-3.5 py-2.5 text-small text-ink-700">
            Pemberian obat dicatat posisi perawat atau bidan. Anda melihat jadwal dan riwayat pemberian saja.
          </p>
        ) : !active ? (
          <p className="m-0 rounded-control bg-subtle px-3.5 py-2.5 text-small text-ink-700">
            Kunjungan tidak sedang berjalan: pemberian obat tidak bisa dicatat.
          </p>
        ) : scan ? (
          <div
            role="status"
            className="flex flex-col gap-0.5 rounded-control border border-zamrud-200 bg-alert-success px-3.5 py-2.5 text-small text-success"
          >
            <span className="font-semibold">
              ✓ Pasien benar · gelang terpindai {formatJam(scan.scannedAt)} · RM {patient.mrn}
            </span>
            <span className="text-ink-700">
              Pilih satu slot jadwal, pindai label obatnya, lalu catat dosis itu. Pindaian berlaku terbatas
              untuk Anda saja; bila kedaluwarsa, pindai ulang.
            </span>
          </div>
        ) : (
          <WristbandGate
            encounterId={encounterId}
            patient={patient}
            canReplace={perms.replaceBand}
            onScanned={(s) => {
              setScan(s);
              setMsg(null);
            }}
          />
        )}
        {board.orders.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Belum ada order obat aktif untuk kunjungan ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-small">
              <caption className="sr-only">Jadwal pemberian obat {formatTanggalLahir(board.date)}</caption>
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-500">
                  <th scope="col" className="w-[36%] py-2 pr-2 font-semibold">
                    Obat · dosis · rute
                  </th>
                  {times.map((t) => (
                    <th key={t} scope="col" className="px-1 py-2 text-center font-semibold">
                      {t}
                    </th>
                  ))}
                  {hasUnscheduled && (
                    <th scope="col" className="px-1 py-2 text-center font-semibold">
                      PRN/stat
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {board.orders.map((o) => (
                  <tr key={o.medicationRequestId} className="border-t border-line-soft align-top">
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold">{o.name}</span>
                        <span className="text-caption text-ink-500">{o.sig}</span>
                        <span className="flex flex-wrap gap-1">
                          <span className="font-mono text-[11px] text-ink-500">
                            {o.kfa ? `KFA ${o.kfa}` : 'KFA belum dipetakan'}
                          </span>
                          {o.highAlert && <Chip tone="danger">Kewaspadaan tinggi</Chip>}
                        </span>
                      </span>
                    </th>
                    {times.map((t) => {
                      const s = o.slots.find((x) => x.time === t);
                      if (!s) {
                        return (
                          <td
                            key={t}
                            className="px-1 py-2 text-center text-ink-400"
                            aria-label="Tidak dijadwalkan"
                          >
                            ·
                          </td>
                        );
                      }
                      const can = doable(s);
                      const picked = pick?.slot?.scheduleId === s.scheduleId;
                      const meta = EMAR_STATE_META[s.state];
                      return (
                        <td key={t} className="px-1 py-2">
                          <button
                            type="button"
                            disabled={!can || !unlocked || busy}
                            aria-expanded={can && unlocked ? picked : undefined}
                            onClick={() => {
                              setMsg(null);
                              setPick({ order: o, slot: s });
                            }}
                            aria-label={`${o.name} jam ${s.time} · ${meta.label}${s.administration ? ` · ${slotLabel(s)}` : ''}${can && !unlocked && canGive ? ' · pindai gelang dulu' : ''}`}
                            className={cx(
                              'min-h-11 w-full rounded-[8px] border px-1 font-[inherit] text-[11.5px] font-semibold',
                              meta.cls,
                              can && unlocked ? 'cursor-pointer' : 'cursor-default',
                              can && !unlocked && 'opacity-70',
                              picked && 'ring-2 ring-brand-600',
                            )}
                          >
                            {slotLabel(s)}
                          </button>
                        </td>
                      );
                    })}
                    {hasUnscheduled && (
                      <td className="px-1 py-2">
                        {unscheduled(o) && (
                          <button
                            type="button"
                            disabled={!unlocked || busy || statGiven(o)}
                            onClick={() => {
                              setMsg(null);
                              setPick({ order: o, slot: null });
                            }}
                            aria-label={`${o.name} · ${FREQ_LABEL[o.frequency]}${statGiven(o) ? ' · sudah diberikan' : ''}`}
                            className="min-h-11 w-full rounded-[8px] border border-brand-600 bg-white px-1 font-[inherit] text-[11.5px] font-semibold text-brand-800 disabled:opacity-60"
                          >
                            {statGiven(o) ? '✓ Stat' : o.frequency === 'stat' ? 'Stat' : 'PRN'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pick && scan && (
          <DosePanel
            key={`${pick.order.medicationRequestId}-${pick.slot?.scheduleId ?? 'x'}`}
            pick={pick}
            scan={scan}
            checks={checks}
            busy={busy}
            onReloadChecks={reloadAttestations}
            onCancel={() => setPick(null)}
            onRecord={(input, done) =>
              start(async () => {
                const r = await administerAction({
                  medicationRequestId: pick.order.medicationRequestId,
                  scheduleId: pick.slot?.scheduleId ?? null,
                  scanId: scan.scanId,
                  ...input,
                });
                if (!r.ok) {
                  if (r.code === 'WRISTBAND_SCAN_REQUIRED') setScan(null);
                  return setMsg({ ok: false, text: r.message });
                }
                done();
                setPick(null);
                setMsg({
                  ok: true,
                  text: `${pick.order.name}: ${STATUS_LABEL[r.data.status].toLowerCase()} tercatat ${formatJam(r.data.at)}${r.data.late ? ' · terlambat' : ''}${r.data.doubleCheckedBy ? ` · cek ganda ${r.data.doubleCheckedBy}` : ''}.`,
                });
                router.refresh();
              })
            }
          />
        )}
        {msg && (
          <span
            role={msg.ok ? 'status' : 'alert'}
            className={cx('text-small font-semibold', msg.ok ? 'text-success' : 'text-danger')}
          >
            {msg.text}
          </span>
        )}
        {log.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-line-soft pt-2.5">
            <span className="text-caption font-semibold text-ink-700">Pemberian tercatat hari ini</span>
            <ul aria-label="Pemberian tercatat" className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {log.map((a) => (
                <li key={a.id}>
                  <span className="font-mono font-semibold">{formatJam(a.at)}</span> ·{' '}
                  {nameOf(a.medicationRequestId)} · {STATUS_LABEL[a.status]}
                  <span className="text-ink-500">
                    {' '}
                    · {a.by.nama}
                    {a.late ? ' · terlambat' : ''}
                    {a.reason ? ` · ${a.reason}` : ''}
                    {a.doubleCheckedBy ? ` · cek ganda ${a.doubleCheckedBy.nama}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {canGive && peerScans.length > 0 && board.orders.some((o) => o.highAlert) && (
        <PeerDoubleCheck
          board={board}
          peerScans={peerScans}
          busy={busy}
          onSubmit={(input) =>
            start(async () => {
              const r = await doubleCheckAction(input);
              if (!r.ok) return setMsg({ ok: false, text: r.message });
              setMsg({
                ok: true,
                text: 'Cek ganda tercatat. Rekan Anda kini dapat mencatat pemberian dosis ini.',
              });
              router.refresh();
            })
          }
        />
      )}
    </section>
  );
}

/** Gerbang pindai gelang: kode gelang dari pemindai (atau diketik), dicocokkan server dengan kunjungan ini. */
function WristbandGate({
  encounterId,
  patient,
  canReplace,
  onScanned,
}: {
  encounterId: string;
  patient: { name: string; mrn: string };
  canReplace: boolean;
  onScanned: (s: Scan) => void;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [band, setBand] = useState<WristbandPrint | null>(null);
  const [busy, start] = useTransition();
  const scan = () =>
    start(async () => {
      const r = await scanWristbandAction({ encounterId, code });
      if (!r.ok) {
        setError(
          r.code === 'WRISTBAND_MISMATCH'
            ? `${r.message}. Pemberian obat tetap terkunci; pindaian salah ini tercatat.`
            : r.message,
        );
        return;
      }
      setError(null);
      onScanned(r.data);
    });
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-kunyit-200 bg-alert-warning px-3.5 py-3">
        <span role="alert" className="flex flex-col">
          <span className="font-semibold text-warning-strong">
            Pemberian obat terkunci sampai gelang pasien cocok
          </span>
          <span className="text-small text-ink-700">
            Pindai gelang {patient.name} (RM {patient.mrn}). Pemindai mengetik kodenya ke kotak di bawah.
          </span>
        </span>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) scan();
          }}
        >
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-gelang`} className="text-small font-semibold">
              Kode gelang pasien
            </label>
            <input
              id={`${id}-gelang`}
              value={code}
              autoComplete="off"
              maxLength={64}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-galat` : undefined}
              className="h-11 w-64 rounded-control border border-line-strong bg-white px-3 font-mono"
            />
          </span>
          <Button type="submit" variant="primary" disabled={busy || !code.trim()}>
            Pindai gelang
          </Button>
          {!unreadable && (
            <Button disabled={busy} onClick={() => setUnreadable(true)}>
              Gelang tidak terbaca
            </Button>
          )}
        </form>
        {error && (
          <span id={`${id}-galat`} role="alert" className="text-small font-semibold text-danger">
            {error}
          </span>
        )}
      </div>
      {band && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-control border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-small"
        >
          <span className="font-semibold">
            Gelang baru terbit {formatJam(band.issuedAt)} · kode{' '}
            <span className="font-mono">{band.code}</span>
          </span>
          <span className="text-ink-700">
            Gelang lama sudah dibatalkan. Cetak dan pasang gelang baru ke pasien, lalu pindai gelang baru itu
            untuk membuka pemberian obat.
          </span>
          <span>
            <Button size="sm" onClick={() => window.print()}>
              Cetak gelang
            </Button>
          </span>
        </div>
      )}
      {unreadable &&
        (canReplace ? (
          <SafetyGate
            title="Gelang tidak terbaca: identitas belum terverifikasi"
            recommendation="Pindai ulang gelang"
            overrideLabel="Verifikasi manual dua identitas dan ganti gelang"
            onFollow={() => setUnreadable(false)}
            onOverride={(reason) =>
              start(async () => {
                const r = await replaceWristbandAction({ encounterId, reason });
                if (!r.ok) return setError(r.message);
                setBand(r.data);
                setUnreadable(false);
                setError(null);
              })
            }
            disabled={busy}
          >
            Cocokkan nama ({patient.name}) dan tanggal lahir/RM ({patient.mrn}) dengan pasien, lalu tulis
            alasan. Gelang lama dibatalkan dan gelang baru terbit; pemberian obat tetap menunggu pindaian
            gelang baru. Penggantian tercatat dan ditinjau komite keselamatan pasien.
          </SafetyGate>
        ) : (
          <p className="m-0 text-small text-ink-700">
            Gelang tidak terbaca: minta petugas berizin mengganti gelang setelah verifikasi dua identitas.
          </p>
        ))}
    </div>
  );
}

interface DoseSubmit {
  labelCode: string;
  status: Status;
  reason: string | null;
  doubleCheckId: string | null;
  occurredAt: string | null;
}

/** Pemberian SATU dosis: pindai label obat, status, alasan bila wajib, cek ganda bila kewaspadaan tinggi. */
function DosePanel({
  pick,
  scan,
  checks,
  busy,
  onReloadChecks,
  onCancel,
  onRecord,
}: {
  pick: Pick;
  scan: Scan;
  checks: DoubleCheckView[];
  busy: boolean;
  onReloadChecks: () => void;
  onCancel: () => void;
  onRecord: (input: DoseSubmit, done: () => void) => void;
}) {
  const id = useId();
  const box = useRef<HTMLElement | null>(null);
  const { order, slot } = pick;
  const late = slot?.state === 'terlambat';
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<Status>('given');
  const [reason, setReason] = useState('');
  useEffect(() => box.current?.focus(), []);

  const needsCheck = order.highAlert && status === 'given';
  const check = needsCheck
    ? checks.find(
        (c) =>
          !c.used &&
          c.status === 'given' &&
          c.scanId === scan.scanId &&
          c.medicationRequestId === order.medicationRequestId &&
          c.scheduleId === (slot?.scheduleId ?? null),
      )
    : undefined;
  const reasonRequired = status !== 'given' || late;
  const effectiveReason = check ? (check.reason ?? '') : reason.trim();
  const blocker = !label.trim()
    ? 'Pindai label obat dulu.'
    : needsCheck && !check
      ? 'Menunggu cek ganda perawat kedua.'
      : needsCheck && check && check.labelCode !== label.trim()
        ? 'Label obat berbeda dengan dosis yang diperiksa perawat kedua.'
        : reasonRequired && effectiveReason.length < SAFETY_REASON_MIN
          ? `Isi alasan (minimal ${SAFETY_REASON_MIN} karakter).`
          : null;

  return (
    <section
      ref={box}
      tabIndex={-1}
      aria-labelledby={`${id}-judul`}
      className={cx(
        'flex flex-col gap-2.5 rounded-control border p-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
        late ? 'border-koral-200 bg-alert-critical' : 'border-brand-200 bg-brand-50',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-judul`} className={cx('m-0 text-body font-semibold', late && 'text-danger-strong')}>
          {order.name} ·{' '}
          {slot ? `jadwal ${slot.time}${late ? ' terlambat' : ''}` : FREQ_LABEL[order.frequency]}
        </h3>
        {order.highAlert && <Chip tone="danger">Kewaspadaan tinggi · cek ganda</Chip>}
      </div>
      <span className="text-caption text-ink-700">{order.sig}</span>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-label`} className="text-small font-semibold">
          Kode label obat (pindai label dari farmasi)
        </label>
        <input
          id={`${id}-label`}
          value={label}
          autoComplete="off"
          maxLength={64}
          onChange={(e) => setLabel(e.target.value)}
          className="h-11 rounded-control border border-line-strong bg-white px-3 font-mono"
        />
      </div>
      <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
        <legend className="mb-1 p-0 text-small font-semibold">Hasil pemberian</legend>
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <label key={s} className="flex min-h-11 items-center gap-2 text-small">
            <input
              type="radio"
              name={`${id}-status`}
              checked={status === s}
              onChange={() => setStatus(s)}
              className="size-[18px] accent-brand-600"
            />
            {STATUS_LABEL[s]}
          </label>
        ))}
      </fieldset>
      {needsCheck && (
        <div className="flex flex-col gap-1 rounded-control border border-koral-200 bg-white px-3 py-2 text-small">
          {check ? (
            <span role="status" className="font-semibold text-success">
              ✓ Cek ganda oleh {check.checkedBy.nama} · {formatJam(check.checkedAt)}
              {check.reason ? ` · alasan: ${check.reason}` : ''}
            </span>
          ) : (
            <span className="text-ink-700">
              Minta perawat kedua membuka eMAR pasien ini di sesinya sendiri dan memilih{' '}
              <strong>Cek ganda untuk rekan</strong> atas pindaian gelang Anda ({formatJam(scan.scannedAt)}).
            </span>
          )}
          {!check && (
            <span>
              <Button size="sm" disabled={busy} onClick={onReloadChecks}>
                Periksa cek ganda
              </Button>
            </span>
          )}
        </div>
      )}
      {reasonRequired && !check && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-alasan`} className="text-small font-semibold">
            {status === 'given'
              ? `Alasan keterlambatan (wajib, minimal ${SAFETY_REASON_MIN} karakter)`
              : `Alasan ${status === 'held' ? 'penundaan' : 'penolakan'} (wajib, minimal ${SAFETY_REASON_MIN} karakter)`}
          </label>
          <input
            id={`${id}-alasan`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={late || status !== 'given' ? 'danger' : 'primary'}
          disabled={!!blocker || busy}
          aria-describedby={blocker ? `${id}-syarat` : undefined}
          onClick={() =>
            onRecord(
              {
                labelCode: label.trim(),
                status,
                reason: effectiveReason || null,
                doubleCheckId: check?.id ?? null,
                occurredAt: check?.occurredAt ?? null,
              },
              () => setLabel(''),
            )
          }
        >
          {status === 'given'
            ? late
              ? 'Catat pemberian terlambat'
              : 'Catat pemberian'
            : status === 'held'
              ? 'Catat dosis ditunda'
              : 'Catat penolakan pasien'}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Batal
        </Button>
        {blocker && (
          <span id={`${id}-syarat`} className="text-caption text-ink-700">
            {blocker}
          </span>
        )}
      </div>
    </section>
  );
}

/** Cek ganda dari sesi perawat kedua atas pindaian gelang rekan yang masih berlaku (ADR-0077). */
function PeerDoubleCheck({
  board,
  peerScans,
  busy,
  onSubmit,
}: {
  board: EmarBoard;
  peerScans: ActiveWristbandScan[];
  busy: boolean;
  onSubmit: (input: {
    medicationRequestId: string;
    scheduleId: string | null;
    scanId: string;
    labelCode: string;
    status: 'given';
    reason: string | null;
  }) => void;
}) {
  const id = useId();
  const targets = board.orders
    .filter((o) => o.highAlert)
    .flatMap((o) =>
      unscheduled(o)
        ? [{ key: `${o.medicationRequestId}|`, order: o, slot: null as EmarScheduleSlot | null }]
        : o.slots
            .filter(doable)
            .map((s) => ({ key: `${o.medicationRequestId}|${s.scheduleId}`, order: o, slot: s })),
    );
  const [target, setTarget] = useState(targets[0]?.key ?? '');
  const [scanId, setScanId] = useState(peerScans[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const chosen = targets.find((t) => t.key === target);
  const late = chosen?.slot?.state === 'terlambat';
  if (targets.length === 0) return null;
  const blocker = !chosen
    ? 'Pilih dosis.'
    : !scanId
      ? 'Pilih pindaian gelang rekan.'
      : !label.trim()
        ? 'Pindai label obat.'
        : late && reason.trim().length < SAFETY_REASON_MIN
          ? `Dosis terlambat: isi alasan (minimal ${SAFETY_REASON_MIN} karakter).`
          : null;
  return (
    <form
      aria-label="Cek ganda untuk rekan"
      className="flex flex-col gap-2.5 rounded-card border border-koral-200 bg-white/90 px-4 py-3.5 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (blocker || !chosen) return;
        onSubmit({
          medicationRequestId: chosen.order.medicationRequestId,
          scheduleId: chosen.slot?.scheduleId ?? null,
          scanId,
          labelCode: label.trim(),
          status: 'given',
          reason: reason.trim() || null,
        });
      }}
    >
      <h2 className="m-0 text-body font-semibold">Cek ganda untuk rekan · obat kewaspadaan tinggi</h2>
      <span className="text-caption text-ink-700">
        Periksa dosis yang disiapkan rekan Anda (obat, dosis, rute, pasien) lalu catat atestasi dari sesi Anda
        sendiri. Anda tidak dapat memeriksa pindaian Anda sendiri.
      </span>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-dosis`} className="text-small font-semibold">
            Dosis yang diperiksa
          </label>
          <select
            id={`${id}-dosis`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.order.name} · {t.slot ? `jadwal ${t.slot.time}` : FREQ_LABEL[t.order.frequency]}
              </option>
            ))}
          </select>
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-pindaian`} className="text-small font-semibold">
            Pindaian gelang rekan
          </label>
          <select
            id={`${id}-pindaian`}
            value={scanId}
            onChange={(e) => setScanId(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            {peerScans.map((s) => (
              <option key={s.id} value={s.id}>
                {s.by.nama} · {formatJam(s.scannedAt)}
              </option>
            ))}
          </select>
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-label`} className="text-small font-semibold">
            Kode label obat (pindai)
          </label>
          <input
            id={`${id}-label`}
            value={label}
            autoComplete="off"
            maxLength={64}
            onChange={(e) => setLabel(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-mono"
          />
        </span>
        {late && (
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-alasan`} className="text-small font-semibold">
              Alasan keterlambatan (wajib)
            </label>
            <input
              id={`${id}-alasan`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            />
          </span>
        )}
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={!!blocker || busy}>
          Catat cek ganda
        </Button>
        {blocker && <span className="text-caption text-ink-700">{blocker}</span>}
      </span>
    </form>
  );
}
