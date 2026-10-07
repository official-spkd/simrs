'use client';

import type { OrCase } from '@simrs/shared';
import { Button, SafetyGate } from '@simrs/ui';
import { useId } from 'react';
import { formatWhen } from '@/lib/btn';
import { incisionGate, type OkLocal, OVERRIDE_REASON_MIN } from '@/lib/penunjang-ok';

/**
 * Gerbang time out (CLAUDE.md §4.9): "Mulai insisi" terkunci sampai time out dikonfirmasi. Jalan lain hanya override
 * darurat dengan alasan klinis wajib (tercatat dan ditinjau). Setelah sign out: operasi selesai lalu ke ruang pulih.
 */
export function OkIncision({
  c,
  local,
  busy,
  onIncise,
  onOverride,
  onFinish,
  onMove,
  onFocusTimeOut,
}: {
  c: OrCase;
  local: OkLocal;
  busy: boolean;
  onIncise: () => void;
  onOverride: (reason: string) => void;
  onFinish: () => void;
  onMove: () => void;
  onFocusTimeOut: () => void;
}) {
  const id = useId();
  const gate = incisionGate(c);
  const signInDone = !!c.checklist[0]?.confirmedAt;
  const signOutDone = !!c.checklist[2]?.confirmedAt;
  const finished = c.status === 'selesai';
  const canFinish = !finished && !!c.incisionAt && signOutDone;
  const finishReason = finished
    ? ''
    : !c.incisionAt
      ? 'Operasi dapat ditutup setelah insisi dicatat dan sign out dikonfirmasi.'
      : !signOutDone
        ? 'Konfirmasi sign out (hitung akhir cocok) sebelum operasi dicatat selesai.'
        : 'Siap dicatat selesai.';
  const canMove =
    !local.movedAt && (!!local.finishedAt || (c.scenario && finished && !c.statusNote.includes('kembali')));
  return (
    <section
      aria-label="Insisi dan penutupan operasi"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <span className="text-[15px] font-semibold">Insisi dan penutupan operasi</span>
      {c.incisionAt ? (
        <span role="status" className="animate-pop text-small font-semibold text-zamrud-700">
          ✓ Insisi dicatat {formatWhen(c.incisionAt)}
          {local.overrideReason
            ? ` · override tanpa time out lengkap tercatat: “${local.overrideReason}”`
            : ''}
        </span>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={!gate.allowed || busy}
              aria-describedby={`${id}-insisi`}
              onClick={onIncise}
            >
              Mulai insisi
            </Button>
            <span id={`${id}-insisi`} className="min-w-0 flex-1 text-small text-ink-700">
              {gate.allowed ? 'Time out lengkap · insisi dapat dicatat.' : gate.reason}
            </span>
          </div>
          {!gate.allowed && signInDone && (
            <SafetyGate
              title="Insisi terkunci: time out belum lengkap"
              recommendation="Lengkapi time out"
              overrideLabel="Mulai insisi tanpa time out lengkap (darurat)"
              minReason={OVERRIDE_REASON_MIN}
              disabled={busy}
              onFollow={onFocusTimeOut}
              onOverride={onOverride}
            >
              Identitas, prosedur, lokasi insisi, dan antibiotik profilaksis wajib dikonfirmasi seluruh tim
              sebelum insisi. Override hanya untuk kegawatan, wajib beralasan, tercatat, dan ditinjau komite
              mutu.
            </SafetyGate>
          )}
        </>
      )}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
        {finished ? (
          <span role="status" className="animate-pop text-small font-semibold text-zamrud-700">
            ✓ Operasi {c.statusNote}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canFinish || busy} aria-describedby={`${id}-selesai`} onClick={onFinish}>
              Catat operasi selesai
            </Button>
            <span id={`${id}-selesai`} className="min-w-0 flex-1 text-small text-ink-700">
              {finishReason}
            </span>
          </div>
        )}
        {canMove && (
          <Button disabled={busy} onClick={onMove} className="self-start">
            Pindahkan ke ruang pulih
          </Button>
        )}
        {local.movedAt && (
          <span role="status" className="text-small text-ink-700">
            Pasien di ruang pulih sejak {formatWhen(local.movedAt)} · serah terima ke kamar rawat setelah
            Aldrete ≥ 9.
          </span>
        )}
      </div>
    </section>
  );
}
