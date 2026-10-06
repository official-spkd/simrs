'use client';

import { formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  attributeList,
  comparisonBanner,
  defaultPicks,
  MATCH_ROW_BG,
  MATCH_TONE,
  type PickSide,
  takenFromB,
} from '@/lib/mpi';
import type { Comparison } from '@/lib/server/mpi';
import { type DecisionResult, distinctAction, mergeAction, undoAction } from './actions';

const REASON_MIN = 10;

function SubmitButtons({
  ready,
  mrnA,
  onMerge,
  onDistinct,
}: {
  ready: boolean;
  mrnA: string;
  onMerge: (fd: FormData) => void;
  onDistinct: (fd: FormData) => void;
}) {
  const { pending } = useFormStatus();
  const disabled = !ready || pending;
  return (
    <div className="flex flex-wrap gap-2.5">
      <Button
        type="submit"
        formAction={onDistinct}
        disabled={disabled}
        aria-describedby={ready ? undefined : 'alasanHint'}
      >
        Bukan orang yang sama
      </Button>
      <Button
        type="submit"
        variant="primary"
        formAction={onMerge}
        disabled={disabled}
        aria-describedby={ready ? undefined : 'alasanHint'}
      >
        Gabungkan ke {mrnA}
      </Button>
    </div>
  );
}

function UndoButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={!ready || pending}>
      Batalkan keputusan
    </Button>
  );
}

/**
 * Banding atribut dua rekam medis + keputusan (design/mockups/MPI.dc.html). Klik nilai di kolom A/B untuk
 * memilih sumber per atribut; alasan wajib sebelum tombol keputusan aktif. Setelah diputuskan, panel
 * menampilkan status dan pembatalan (penggabungan ≤ 30 hari).
 */
export function ComparePanel({ c, auditHref }: { c: Comparison; auditHref: string | null }) {
  const open = c.status === 'open';
  const [picks, setPicks] = useState<Record<string, PickSide>>(() => defaultPicks(c.rows));
  const [reason, setReason] = useState('');
  const [mergeState, merge] = useActionState<DecisionResult, FormData>(mergeAction, {});
  const [distinctState, distinct] = useActionState<DecisionResult, FormData>(distinctAction, {});
  const taken = takenFromB(c.rows, picks);
  const ready = reason.trim().length >= REASON_MIN;
  const error = mergeState.error ?? distinctState.error;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-warning-border bg-gradient-to-r from-[#FFF8EB] to-white px-4 py-3">
        <span className="font-bold text-warning">
          {open ? `Skor kecocokan ${c.score}%` : `Skor kecocokan saat terdeteksi ${c.score}%`}
        </span>
        {/* Setelah diputuskan, tabel berisi data terkini (A bisa sudah memakai nilai dari B): penjelasan memakai
            alasan saat terdeteksi, bukan hasil banding ulang. */}
        <span className="text-small text-ink-700">{open ? comparisonBanner(c.rows) : `${c.summary}.`}</span>
      </div>
      {c.status === 'merged' && (
        <p className="m-0 text-small text-ink-500">
          Tabel berisi data terkini: rekam medis A sudah memakai atribut yang diambil dari B.
        </p>
      )}

      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <caption className="sr-only">Perbandingan atribut rekam medis A dan B</caption>
          <thead className="bg-subtle text-caption font-semibold text-ink-700">
            <tr>
              <th scope="col" className="w-[18%] px-4 py-3">
                Atribut
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="flex flex-col">
                  <span>Rekam medis A · dipertahankan</span>
                  <span className="font-mono text-small text-brand-700">{c.a.mrn}</span>
                </span>
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="flex flex-col">
                  <span>Rekam medis B · digabungkan</span>
                  <span className="font-mono text-small text-warning">{c.b.mrn}</span>
                </span>
              </th>
              <th scope="col" className="w-[11%] px-4 py-3">
                Cocok
              </th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => {
              const side = picks[r.attribute] ?? 'a';
              const useB = side === 'b' && r.b !== null && r.match !== 'sama';
              const cell = (which: PickSide, value: string | null) => {
                const chosen = which === 'b' ? useB : !useB;
                const crossed = which === 'a' && useB && r.a !== null;
                // Hanya ada pilihan bila A dan B sama-sama berisi dan berbeda; A kosong → nilai B otomatis dipakai.
                const selectable = open && r.a !== null && r.b !== null && r.match !== 'sama';
                const label = `${r.label} dari ${which.toUpperCase()}: ${value ?? 'kosong'}${chosen && value ? ' (dipakai)' : ''}`;
                if (!selectable) {
                  return (
                    <span
                      className={cx(
                        'block px-4 py-2.5',
                        which === 'b' && useB && open && 'bg-[#E6F4F1] font-semibold text-brand-700',
                        crossed && 'text-ink-400 line-through',
                      )}
                    >
                      {value ?? '—'}
                    </span>
                  );
                }
                return (
                  <button
                    type="button"
                    aria-pressed={chosen}
                    aria-label={label}
                    onClick={() => setPicks((p) => ({ ...p, [r.attribute]: which }))}
                    className={cx(
                      'block min-h-11 w-full cursor-pointer border-0 px-4 py-2.5 text-left font-[inherit]',
                      which === 'b' && chosen
                        ? 'bg-[#E6F4F1] font-semibold text-brand-700'
                        : 'bg-transparent text-ink-900',
                      crossed && 'text-ink-400 line-through',
                    )}
                  >
                    {value}
                  </button>
                );
              };
              return (
                <tr key={r.attribute} className={cx('border-t border-line-soft', MATCH_ROW_BG[r.match])}>
                  <th scope="row" className="px-4 py-2.5 font-normal text-ink-700">
                    {r.label}
                  </th>
                  <td className="p-0">{cell('a', r.a)}</td>
                  <td className="p-0">{cell('b', r.b)}</td>
                  <td className={cx('px-4 py-2.5 font-bold', MATCH_TONE[r.match])}>{r.match}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-card px-[18px] py-4">
        <h2 className="m-0 text-body font-semibold">
          {c.status === 'merged' ? 'Yang terjadi setelah digabung' : 'Yang akan terjadi saat digabung'}
        </h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 text-small sm:grid-cols-3">
          {c.impact.map((m) => (
            <li key={m.label} className="rounded-control bg-subtle p-3">
              <span className="block text-[18px] font-bold">{m.n}</span>
              {m.label}
            </li>
          ))}
        </ul>

        {open && (
          <form className="flex flex-col gap-3">
            <input type="hidden" name="id" value={c.id} />
            {taken.map((t) => (
              <input key={t} type="hidden" name="takeFromB" value={t} />
            ))}
            {taken.length > 0 && (
              <p className="m-0 text-small font-medium text-brand-700">
                Diambil dari B: {attributeList(taken)}. Klik nilai di tabel untuk memilih sumber per atribut.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alasanKeputusan" className="text-small font-semibold">
                Alasan keputusan <span className="text-danger">*</span>
              </label>
              <textarea
                id="alasanKeputusan"
                name="reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby={ready ? undefined : 'alasanHint'}
                className="resize-y rounded-control border border-line-strong px-3 py-2.5 font-[inherit]"
              />
              {/* Mockup MPI: petunjuk hanya selama alasan belum cukup; tombol tetap terlihat nonaktif. */}
              {!ready && (
                <span id="alasanHint" className="text-caption font-semibold text-warning">
                  Isi alasan dan dasar verifikasi (mis. KTP, wawancara) minimal 10 karakter untuk mengaktifkan
                  tombol keputusan.
                </span>
              )}
            </div>
            {error && (
              <p role="alert" className="m-0 text-small text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <span className="max-w-[420px] flex-[1_1_260px] text-caption text-ink-500">
                Penggabungan berjejak dan dapat dibatalkan dalam 30 hari. Nomor RM B dialihkan ke A (pencarian
                diarahkan ke A); tidak ada data yang dihapus.
              </span>
              <SubmitButtons ready={ready} mrnA={c.a.mrn} onMerge={merge} onDistinct={distinct} />
            </div>
          </form>
        )}

        {!open && <DecisionStatus c={c} auditHref={auditHref} />}
        {open && c.link?.undoneAt && (
          <p className="m-0 text-caption text-ink-500">
            Penggabungan sebelumnya dibatalkan {formatTanggalWaktu(c.link.undoneAt)}
            {c.link.undoneBy ? ` oleh ${c.link.undoneBy}` : ''}. Alasan: {c.link.undoReason}
          </p>
        )}
      </section>
    </div>
  );
}

function DecisionStatus({ c, auditHref }: { c: Comparison; auditHref: string | null }) {
  const [undoState, undo] = useActionState<DecisionResult, FormData>(undoAction, {});
  const [reason, setReason] = useState('');
  const merged = c.status === 'merged';
  const at = merged ? (c.link?.mergedAt ?? c.decision?.at) : c.decision?.at;
  const canUndo = merged ? Boolean(c.link?.undoable) : c.status === 'distinct';
  const ready = reason.trim().length >= REASON_MIN;

  return (
    <div
      role="status"
      className={cx(
        'flex flex-col gap-2 rounded-[12px] border px-4 py-3',
        merged
          ? 'border-success-border bg-gradient-to-r from-success-bg to-white'
          : 'border-line-strong bg-gradient-to-r from-muted to-white',
      )}
    >
      <span className={cx('font-bold', merged ? 'text-success' : 'text-ink-700')}>
        {merged ? 'Berhasil digabung' : 'Ditandai bukan orang yang sama'}
        {at ? ` ${formatTanggalWaktu(at)}` : ''}
        {c.decision?.by ? ` oleh ${c.decision.by}` : ''}
      </span>
      <span className="text-small text-ink-700">
        {merged
          ? `RM ${c.b.mrn} kini dialihkan ke ${c.a.mrn}. ${c.link?.taken.length ? `Diambil dari B: ${attributeList(c.link.taken)}. ` : ''}Penggabungan tercatat di jejak audit${c.link?.undoable ? ` dan dapat dibatalkan sampai ${formatTanggal(c.link.undoUntil)}` : ''}.`
          : 'Kedua rekam medis tetap terpisah dan pasangan ini tidak diusulkan lagi. Keputusan tercatat di jejak audit.'}
      </span>
      {c.decision?.reason && <span className="text-small text-ink-700">Alasan: {c.decision.reason}</span>}
      {auditHref && (
        <a href={auditHref} className="text-small font-semibold">
          Lihat di jejak audit
        </a>
      )}
      {undoState.message ? (
        <p className="m-0 text-small font-semibold text-success">{undoState.message}</p>
      ) : canUndo ? (
        <form action={undo} className="flex flex-col gap-2 border-t border-line-soft pt-2">
          <input type="hidden" name="id" value={merged ? (c.link?.id ?? '') : c.id} />
          <input type="hidden" name="kind" value={merged ? 'merge' : 'distinct'} />
          <label htmlFor="alasanBatal" className="text-small font-semibold">
            Alasan pembatalan <span className="text-danger">*</span>
          </label>
          <textarea
            id="alasanBatal"
            name="reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="resize-y rounded-control border border-line-strong px-3 py-2 font-[inherit]"
          />
          {undoState.error && (
            <p role="alert" className="m-0 text-small text-danger">
              {undoState.error}
            </p>
          )}
          <span>
            <UndoButton ready={ready} />
          </span>
        </form>
      ) : (
        merged && (
          <span className="text-caption text-ink-500">
            Batas pembatalan {formatTanggal(c.link?.undoUntil ?? c.detectedAt)} sudah lewat.
          </span>
        )
      )}
    </div>
  );
}
