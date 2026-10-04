'use client';

import type { OrCase } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useId } from 'react';
import { formatWhen } from '@/lib/btn';
import {
  canConfirmPhase,
  checkCounts,
  COUNT_ITEM,
  currentPhase,
  itemChecked,
  PHASE_LABEL,
  PHASE_WHEN,
  phaseRemaining,
} from '@/lib/btn-ok';

function footText(c: OrCase, cur: number): { text: string; tone: 'muted' | 'danger' | 'success' } {
  if (cur >= 3) return { text: 'Ketiga fase lengkap. Laporan operasi dapat ditutup.', tone: 'success' };
  const phase = c.checklist[cur];
  const left = phase ? phaseRemaining(phase, c.counts) : 0;
  if (cur === 0) {
    return left
      ? {
          text: `Induksi tidak dapat dimulai sebelum sign in lengkap (${left} butir tersisa).`,
          tone: 'muted',
        }
      : { text: 'Sign in lengkap. Konfirmasi untuk membuka time out.', tone: 'muted' };
  }
  if (cur === 1) {
    return left
      ? {
          text: `Insisi tidak dapat dicatat sebelum time out lengkap (${left} butir tersisa).`,
          tone: 'muted',
        }
      : {
          text: 'Time out lengkap. Konfirmasi untuk membuka insisi; centang tercatat dengan nama dan jam.',
          tone: 'muted',
        };
  }
  const counts = checkCounts(c.counts);
  if (counts.mismatches.length)
    return { text: 'Hitung akhir tidak cocok. Hitung ulang sebelum sign out.', tone: 'danger' };
  if (!counts.ok)
    return { text: 'Sign out butuh hitung akhir kasa, jarum, dan instrumen yang cocok.', tone: 'muted' };
  return left
    ? { text: `Lengkapi ${left} butir sign out.`, tone: 'muted' }
    : { text: 'Sign out lengkap dan hitungan cocok. Konfirmasi sebelum pasien keluar kamar.', tone: 'muted' };
}

/** Daftar tilik keselamatan operasi WHO: Sign in → Time out → Sign out, masing-masing 5 butir dan konfirmasi. */
export function OkChecklist({
  c,
  busy,
  onToggle,
  onConfirm,
}: {
  c: OrCase;
  busy: boolean;
  onToggle: (itemId: string) => void;
  onConfirm: (phaseIndex: number) => void;
}) {
  const id = useId();
  const cur = currentPhase(c.checklist);
  const foot = footText(c, cur);
  const canConfirm = cur < 3 && canConfirmPhase(c, cur);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-3">
        {c.checklist.map((p, pi) => {
          const isCur = pi === cur;
          const confirmed = !!p.confirmedAt;
          return (
            <fieldset
              key={p.phase}
              className={cx(
                'm-0 flex min-w-0 flex-col gap-1 rounded-[12px] border p-3',
                isCur ? 'border-[#9FCFC8] bg-[#F7FBFA]' : 'border-line bg-white',
              )}
            >
              <legend className="sr-only">{PHASE_LABEL[p.phase]}</legend>
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{PHASE_LABEL[p.phase]}</span>
                <Chip tone={confirmed ? 'success' : isCur ? 'brand' : 'neutral'}>
                  {confirmed ? 'Lengkap' : isCur ? 'Berjalan' : 'Belum'}
                </Chip>
              </span>
              <span className="text-caption text-ink-500">
                {PHASE_WHEN[p.phase]}
                {p.confirmedAt ? ` · ${formatWhen(p.confirmedAt)} · ${p.confirmedBy ?? ''}` : ''}
              </span>
              {p.items.map((item) => {
                const auto = p.phase === 'sign-out' && item.id === COUNT_ITEM;
                const disabled = !isCur || confirmed || auto || busy;
                const checked = itemChecked(p, item.id, c.counts);
                return (
                  <label
                    key={item.id}
                    className={cx(
                      'flex min-h-11 items-center gap-2.5 text-small',
                      disabled ? 'cursor-default text-ink-700' : 'cursor-pointer text-ink-900',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-5 flex-none accent-brand-600"
                      checked={checked}
                      disabled={disabled}
                      data-phase={p.phase}
                      onChange={() => onToggle(item.id)}
                    />
                    <span>
                      {item.label}
                      {auto && isCur && !checked ? ' (isi hitung akhir)' : ''}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span
          id={`${id}-alasan`}
          aria-live="polite"
          className={cx(
            'min-w-0 flex-1 text-small',
            foot.tone === 'danger' && 'font-semibold text-danger',
            foot.tone === 'success' && 'font-semibold text-success',
            foot.tone === 'muted' && 'text-ink-700',
          )}
        >
          {foot.text}
        </span>
        <Button
          variant="primary"
          disabled={!canConfirm || busy}
          aria-describedby={`${id}-alasan`}
          onClick={() => onConfirm(cur)}
        >
          {cur < 3
            ? `Konfirmasi ${PHASE_LABEL[c.checklist[cur]?.phase ?? 'sign-in'].toLowerCase()}`
            : 'Daftar tilik lengkap'}
        </Button>
      </div>
    </div>
  );
}
