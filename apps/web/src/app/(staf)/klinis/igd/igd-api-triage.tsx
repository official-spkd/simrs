'use client';

import {
  type EdBoardItem,
  SAFETY_REASON_MIN,
  TRIAGE_DISCRIMINATOR_CODES,
  TRIAGE_DISCRIMINATORS,
  type TriageDiscriminator,
  type TriageLevel,
  type TriageSuggestionApi,
  type TriageVitals,
  formatJam,
} from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { VALUE_FLAG_STYLE } from '@/components/klinis/status-flag';
import { TriageLevelPicker } from '@/components/rawat-inap/triage-level-picker';
import { parseVitals, vitalsForm, vitalTiles } from '@/lib/igd-api';
import { TRIAGE_META, TRIAGE_SAVE_DISABLED } from '@/lib/rawat-inap';
import { saveTriageAction, suggestTriageAction } from './actions-api';

const VITAL_FIELDS: Array<{ key: keyof TriageVitals; label: string; unit: string }> = [
  { key: 'sbp', label: 'TD sistolik', unit: 'mmHg' },
  { key: 'dbp', label: 'TD diastolik', unit: 'mmHg' },
  { key: 'hr', label: 'Nadi', unit: '×/mnt' },
  { key: 'rr', label: 'Napas', unit: '×/mnt' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'temp', label: 'Suhu', unit: '°C' },
  { key: 'gcs', label: 'GCS', unit: '3–15' },
];
const MAX_DISCRIMINATORS = 6;

/** Ubin tanda vital triase tersimpan (bertulisan "tidak normal", bukan hanya warna). */
export function VitalTiles({ vitals }: { vitals: TriageVitals }) {
  const tiles = vitalTiles(vitals);
  if (tiles.length === 0) return <p className="m-0 text-caption text-ink-500">Tanda vital belum diukur.</p>;
  return (
    <ul aria-label="Tanda vital triase" className="m-0 grid list-none grid-cols-3 gap-2 p-0">
      {tiles.map((v) => (
        <li
          key={v.label}
          className={cx(
            'flex min-w-0 flex-col rounded-control border px-2.5 py-2',
            v.abnormal ? VALUE_FLAG_STYLE.abnormal.tile : 'border-line-soft bg-subtle',
          )}
        >
          <span className="text-[11.5px] text-ink-500">
            {v.label}
            {v.abnormal ? ' · tidak normal' : ''}
          </span>
          <span className={cx('font-bold', v.abnormal ? VALUE_FLAG_STYLE.abnormal.text : 'text-ink-900')}>
            {v.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * K03 · Triase mode api: tanda vital + diskriminator → saran ATS DARI SERVER (`POST /triage/suggestions`, dijeda),
 * level dipilih petugas; turun dari saran wajib alasan ≥ 10 (gerbang yang sama ditegakkan ulang server saat simpan,
 * 422 `TRIAGE_REASON_REQUIRED`); level di bawah batas protokol dikunci. Triase ulang = asesmen baru.
 */
export function TriageApiForm({ item, canWrite }: { item: EdBoardItem; canWrite: boolean }) {
  const router = useRouter();
  const id = useId();
  const t = item.triage;
  const [form, setForm] = useState(() => vitalsForm(t?.vitals ?? null));
  const [disc, setDisc] = useState<TriageDiscriminator[]>(() => [...(t?.discriminators ?? [])]);
  const [suggestion, setSuggestion] = useState<TriageSuggestionApi | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [picked, setPicked] = useState<TriageLevel | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSave] = useTransition();
  const [open, setOpen] = useState(!t);

  const vitals = parseVitals(form);
  const key = JSON.stringify([vitals, disc]);
  useEffect(() => {
    if (!canWrite || !open) return;
    if (!vitals) {
      setSuggestion(null);
      setSuggestError('Periksa angka tanda vital (hanya angka, dalam rentang wajar).');
      return;
    }
    setSuggestError(null);
    let live = true;
    const timer = setTimeout(() => {
      void suggestTriageAction({ encounterId: item.encounterId, vitals, discriminators: disc }).then((r) => {
        if (!live) return;
        if (r.ok) setSuggestion(r.data);
        else {
          setSuggestion(null);
          setSuggestError(r.message);
        }
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` merangkum isian (vitals + diskriminator) agar efek tidak berjalan tiap render.
  }, [key, canWrite, open, item.encounterId]);

  const chosen: TriageLevel | null = picked ?? suggestion?.level ?? null;
  const under = !!suggestion && chosen !== null && chosen > suggestion.level;
  const reasonOk = reason.trim().length >= SAFETY_REASON_MIN;
  const blocker = !suggestion
    ? 'Tunggu saran sistem dari server (isi tanda vital atau keluhan).'
    : chosen === null
      ? 'Pilih level triase.'
      : chosen > suggestion.maxLevel
        ? `Level ${chosen} di bawah batas protokol (paling rendah level ${suggestion.maxLevel}).`
        : under && !reasonOk
          ? `Level ${chosen} di bawah saran sistem (triase ${suggestion.level}): isi alasan klinis minimal ${SAFETY_REASON_MIN} karakter.`
          : null;

  const toggle = (d: TriageDiscriminator) =>
    setDisc((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const save = () => {
    if (blocker || chosen === null || !vitals) return;
    startSave(async () => {
      const r = await saveTriageAction({
        encounterId: item.encounterId,
        vitals,
        discriminators: disc,
        chosenLevel: chosen,
        overrideReason: under ? reason.trim() : null,
      });
      if (r.ok) {
        setMsg({ ok: true, text: `Triase ${r.data.level} tersimpan.` });
        setOpen(false);
        setPicked(null);
        setReason('');
        router.refresh();
      } else setMsg({ ok: false, text: r.message });
    });
  };

  return (
    <section aria-label="Triase" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-body font-semibold">Triase ATS</h3>
        {t && (
          <span className="text-caption text-ink-500">
            Triase {t.level} · {formatJam(t.at)}
            {t.overrideReason ? ' · di bawah saran, beralasan' : ''}
          </span>
        )}
      </div>
      {t && !open && (
        <>
          <VitalTiles vitals={t.vitals} />
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-caption text-ink-700">
            {t.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {t.overrideReason && (
            <p className="m-0 text-caption text-ink-700">
              Alasan level di bawah saran (triase {t.suggestedLevel}): {t.overrideReason}
            </p>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setMsg(null);
              }}
              className="inline-flex min-h-11 items-center self-start rounded-control border border-line-strong bg-white px-3 text-small font-semibold"
            >
              Triase ulang
            </button>
          )}
        </>
      )}
      {!t && !canWrite && (
        <p className="m-0 text-caption text-ink-500">
          Belum ditriase. Triase oleh perawat/dokter atau petugas IGD.
        </p>
      )}
      {canWrite && open && (
        <div className="flex flex-col gap-3">
          <fieldset className="m-0 grid grid-cols-2 gap-2 border-0 p-0 sm:grid-cols-4">
            <legend className="mb-1 p-0 text-small font-semibold">Tanda vital (kosong = tidak diukur)</legend>
            {VITAL_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
                {f.label} <span className="font-normal text-ink-500">({f.unit})</span>
                <input
                  inputMode={f.key === 'temp' ? 'decimal' : 'numeric'}
                  value={form[f.key]}
                  maxLength={5}
                  onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))}
                  className="h-11 rounded-control border border-line-strong bg-white px-2.5 font-mono text-body"
                />
              </label>
            ))}
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-small font-semibold">
              Keluhan / diskriminator (maks. {MAX_DISCRIMINATORS})
            </legend>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              {TRIAGE_DISCRIMINATOR_CODES.map((d) => {
                const on = disc.includes(d);
                return (
                  <label key={d} className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && disc.length >= MAX_DISCRIMINATORS}
                      onChange={() => toggle(d)}
                      className="size-[18px] accent-brand-600"
                    />
                    {TRIAGE_DISCRIMINATORS[d].label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {suggestion ? (
            <div
              role="status"
              className={cx(
                'flex flex-col gap-1 rounded-control border px-3 py-2.5 text-small',
                TRIAGE_META[suggestion.level].advice.box,
              )}
            >
              <span className={cx('font-bold', TRIAGE_META[suggestion.level].advice.label)}>
                Saran sistem (server): triase {suggestion.level} · {TRIAGE_META[suggestion.level].label}
              </span>
              <ul className="m-0 list-none p-0 text-ink-700">
                {suggestion.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p role="status" className="m-0 text-caption text-ink-500">
              {suggestError ?? 'Menghitung saran sistem…'}
            </p>
          )}
          {suggestion && chosen !== null && (
            <TriageLevelPicker
              value={chosen}
              suggested={suggestion.level}
              maxLevel={suggestion.maxLevel}
              disabled={saving}
              lockReason={`protokol diskriminator: paling rendah level ${suggestion.maxLevel}`}
              onChange={setPicked}
            />
          )}
          {under && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-alasan`} className="text-small font-semibold text-ink-900">
                Alasan memilih level lebih rendah dari saran (triase {suggestion?.level})
              </label>
              <input
                id={`${id}-alasan`}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={!reasonOk}
                className={cx(
                  'min-h-11 rounded-control border bg-white px-3 text-body',
                  reasonOk ? 'border-line-strong' : 'border-danger',
                )}
              />
              <span className={cx('text-caption', reasonOk ? 'text-ink-500' : 'font-semibold text-danger')}>
                {reasonOk
                  ? 'Alasan tercatat di jejak audit triase.'
                  : `Wajib diisi (minimal ${SAFETY_REASON_MIN} karakter).`}
              </span>
            </div>
          )}
          <button
            type="button"
            disabled={!!blocker || saving}
            onClick={save}
            aria-describedby={blocker ? `${id}-blocker` : undefined}
            className={cx(
              'inline-flex h-12 items-center justify-center rounded-control border px-4 font-bold',
              blocker || saving || chosen === null ? TRIAGE_SAVE_DISABLED : TRIAGE_META[chosen].save,
            )}
          >
            {saving ? 'Menyimpan…' : `Simpan triase${chosen ? ` ${chosen}` : ''}`}
          </button>
          {blocker && (
            <span id={`${id}-blocker`} className="text-caption font-semibold text-warning">
              {blocker}
            </span>
          )}
          {t && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center self-start rounded-control border-0 bg-transparent px-1 text-small font-semibold text-ink-700"
            >
              Batal triase ulang
            </button>
          )}
        </div>
      )}
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={cx('m-0 text-small font-semibold', msg.ok ? 'text-success' : 'text-danger')}
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}
