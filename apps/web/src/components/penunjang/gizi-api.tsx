'use client';

import {
  DIET_TEXTURES,
  type DietTypeOption,
  LEFTOVER_LABEL,
  MEAL_LEFTOVERS,
  type MealListRow,
  type MEALS,
  MST_WEIGHT_LOSS,
  MST_WEIGHT_LOSS_LABEL,
  mstScore,
  TEXTURE_LABEL,
} from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import {
  endDietAction,
  liftNpoAction,
  orderDietAction,
  type PenunjangActionResult,
  recordMealAction,
  screenNutritionAction,
  startNpoAction,
  verifyDietAction,
} from '@/lib/server/data/penunjang/penunjang-api-actions';

const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const FIELD =
  'min-h-11 rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small';

function useAction() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const run = (fn: () => Promise<PenunjangActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { busy, msg, run };
}

/** S07 · Satu baris daftar makan: catat antar, lalu sisa makanan (append-only; baris terbaru berlaku). */
export function MealRowActions({
  row,
  meal,
  canWrite,
}: {
  row: MealListRow;
  meal: (typeof MEALS)[number];
  canWrite: boolean;
}) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [leftover, setLeftover] = useState<string>('');
  if (!canWrite) return null;
  if (row.npo || !row.verified) {
    return (
      <p className="m-0 max-w-xs text-small font-semibold text-warning">
        {row.npo
          ? `Puasa: ${row.npo.reason}. Makanan tidak diantar sampai puasa dicabut.`
          : 'Order diet belum diverifikasi ahli gizi; makanan belum boleh diantar.'}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {!row.service && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(() => recordMealAction({ dietOrderId: row.dietOrderId, meal, leftover: null }))
            }
          >
            Catat diantar
          </Button>
        )}
        <label htmlFor={`${id}-l`} className="sr-only">
          Sisa makanan {row.patient.name}
        </label>
        <select
          id={`${id}-l`}
          value={leftover}
          onChange={(e) => setLeftover(e.target.value)}
          className={SELECT}
        >
          <option value="">Sisa makanan…</option>
          {MEAL_LEFTOVERS.map((l) => (
            <option key={l} value={l}>
              {LEFTOVER_LABEL[l]}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={busy || !leftover}
          onClick={() =>
            run(() => recordMealAction({ dietOrderId: row.dietOrderId, meal, leftover: leftover || null }))
          }
        >
          Catat sisa
        </Button>
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

/** S07 · Order diet baru untuk satu kunjungan (menutup order aktif sebelumnya). */
export function DietOrderForm({
  encounterId,
  types,
  today,
}: {
  encounterId: string;
  types: readonly DietTypeOption[];
  today: string;
}) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [dietTypeId, setDietTypeId] = useState('');
  const [texture, setTexture] = useState<(typeof DIET_TEXTURES)[number]>('biasa');
  const [notes, setNotes] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  return (
    <form
      aria-label="Order diet"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => orderDietAction({ encounterId, dietTypeId, texture, notes, startsOn }));
      }}
    >
      <Feedback msg={msg} />
      <div className="grid gap-3 sm:grid-cols-2">
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-t`} className="text-small font-semibold">
            Jenis diet
          </label>
          <select
            id={`${id}-t`}
            value={dietTypeId}
            onChange={(e) => setDietTypeId(e.target.value)}
            className={SELECT}
          >
            <option value="">Pilih jenis diet…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-x`} className="text-small font-semibold">
            Tekstur
          </label>
          <select
            id={`${id}-x`}
            value={texture}
            onChange={(e) => setTexture(e.target.value as (typeof DIET_TEXTURES)[number])}
            className={SELECT}
          >
            {DIET_TEXTURES.map((t) => (
              <option key={t} value={t}>
                {TEXTURE_LABEL[t]}
              </option>
            ))}
          </select>
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-s`} className="text-small font-semibold">
            Mulai berlaku
          </label>
          <input
            id={`${id}-s`}
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className={FIELD}
          />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-n`} className="text-small font-semibold">
            Catatan untuk dapur (pantangan, alergi makanan)
          </label>
          <input id={`${id}-n`} value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD} />
        </span>
      </div>
      <Button type="submit" variant="primary" disabled={busy || !dietTypeId} className="self-start">
        Simpan order diet
      </Button>
    </form>
  );
}

export function EndDietButton({ dietOrderId }: { dietOrderId: string }) {
  const { busy, msg, run } = useAction();
  return (
    <span className="flex flex-col gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => endDietAction(dietOrderId))}>
        Hentikan diet
      </Button>
      <Feedback msg={msg} />
    </span>
  );
}

/** S07 · Verifikasi order diet oleh ahli gizi (butuh skrining MST). */
export function VerifyDietButton({ dietOrderId }: { dietOrderId: string }) {
  const { busy, msg, run } = useAction();
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() => run(() => verifyDietAction(dietOrderId))}
      >
        Verifikasi order diet
      </Button>
      <Feedback msg={msg} />
    </span>
  );
}

/** S07 · Skrining gizi MST: penurunan BB 6 bulan + nafsu makan turun; skor ≥ 2 berisiko. */
export function ScreeningForm({ encounterId }: { encounterId: string }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [weightLoss, setWeightLoss] = useState<(typeof MST_WEIGHT_LOSS)[number] | ''>('');
  const [poorAppetite, setPoorAppetite] = useState(false);
  const preview = weightLoss ? mstScore(weightLoss, poorAppetite) : null;
  return (
    <form
      aria-label="Skrining gizi MST"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => screenNutritionAction({ encounterId, weightLoss, poorAppetite }));
      }}
    >
      <Feedback msg={msg} />
      <span className="flex flex-col gap-1">
        <label htmlFor={`${id}-w`} className="text-small font-semibold">
          Penurunan berat badan tanpa disengaja (6 bulan)
        </label>
        <select
          id={`${id}-w`}
          value={weightLoss}
          onChange={(e) => setWeightLoss(e.target.value as (typeof MST_WEIGHT_LOSS)[number] | '')}
          className={SELECT}
        >
          <option value="">Pilih…</option>
          {MST_WEIGHT_LOSS.map((w) => (
            <option key={w} value={w}>
              {MST_WEIGHT_LOSS_LABEL[w]}
            </option>
          ))}
        </select>
      </span>
      <label className="flex min-h-11 items-center gap-2 text-small">
        <input type="checkbox" checked={poorAppetite} onChange={(e) => setPoorAppetite(e.target.checked)} />
        Asupan makan berkurang karena nafsu makan turun
      </label>
      {preview && (
        <p className="m-0 text-small">
          Skor MST {preview.score} · {preview.atRisk ? 'berisiko malnutrisi' : 'tidak berisiko'}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={busy || !weightLoss}>
        Simpan skrining
      </Button>
    </form>
  );
}

/** S07 · Puasa (NPO): mulai beralasan atau cabut. */
export function NpoControl({
  encounterId,
  active,
}: {
  encounterId: string;
  active: { id: string; reason: string } | null;
}) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  if (active) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Feedback msg={msg} />
        <span className="text-small font-semibold text-warning">Puasa: {active.reason}</span>
        <Button size="sm" disabled={busy} onClick={() => run(() => liftNpoAction(active.id))}>
          Cabut puasa
        </Button>
      </div>
    );
  }
  return (
    <form
      aria-label="Mulai puasa"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => startNpoAction({ encounterId, reason, plannedUntil: until }),
          () => setReason(''),
        );
      }}
    >
      <Feedback msg={msg} />
      <div className="grid gap-2 sm:grid-cols-2">
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-r`} className="text-small font-semibold">
            Alasan puasa
          </label>
          <input
            id={`${id}-r`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={FIELD}
          />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-u`} className="text-small font-semibold">
            Rencana sampai (opsional)
          </label>
          <input
            id={`${id}-u`}
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className={FIELD}
          />
        </span>
      </div>
      <Button type="submit" className="self-start" disabled={busy}>
        Mulai puasa
      </Button>
    </form>
  );
}
