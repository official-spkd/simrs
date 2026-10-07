'use client';

import type { OrderLineEvaluation } from '@simrs/shared';
import { Chip, cx, SafetyGate } from '@simrs/ui';
import { useId } from 'react';
import { type DraftLine, FREQUENCY_OPTIONS, lineProblems, ROUTE_OPTIONS } from '@/lib/cpoe-api';

const CDS_TONE = { info: 'text-success', warn: 'text-warning', block: 'text-danger' } as const;
const CDS_MARK = { info: '✓', warn: '!', block: '✕' } as const;
const CDS_SR = { info: 'CDS: ', warn: 'Peringatan CDS: ', block: 'Diblokir CDS: ' } as const;

const FIELD = 'min-h-11 rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-small';

/**
 * Satu baris order yang sedang disusun (mode api): isian obat (dosis, rute, aturan pakai, lama, keterangan) atau
 * prioritas penunjang, temuan CDS server, dan gerbang keselamatan bila diblokir (hapus, atau override beralasan ≥ 10
 * karakter yang ikut dikirim dan tercatat di `cds_alerts`).
 */
export function CpoeApiDraftRow({
  line,
  evaluation,
  disabled,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  /** Hasil CDS server untuk baris ini; null selama menunggu pratinjau. */
  evaluation: OrderLineEvaluation | null;
  disabled: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const drug = line.item.kind === 'obat';
  const problems = lineProblems(line);
  const blocked = evaluation?.blocked ?? false;
  const warnings = (evaluation?.findings ?? []).filter((f) => f.level !== 'block');
  return (
    <li
      className={cx(
        'flex flex-col gap-2.5 border-b border-line-soft px-4 py-3 last:border-b-0',
        blocked && 'bg-[#FFFBFA]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="font-semibold">{line.item.name}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {line.item.highAlert && <Chip tone="warning">Kewaspadaan tinggi</Chip>}
          {line.override && <Chip tone="warning">Override tercatat</Chip>}
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Hapus ${line.item.name}`}
            className="min-h-11 cursor-pointer rounded-full border border-line bg-white px-3 font-[inherit] text-caption font-semibold text-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Hapus
          </button>
        </span>
      </div>

      {drug ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_1.4fr_0.8fr]">
          <label
            className="flex flex-col gap-1 text-caption font-semibold text-ink-700"
            htmlFor={`${id}-dosis`}
          >
            Dosis
            <input
              id={`${id}-dosis`}
              value={line.dose}
              maxLength={40}
              disabled={disabled}
              placeholder="mis. 500 mg"
              onChange={(e) => onChange({ dose: e.target.value })}
              className={FIELD}
            />
          </label>
          <label
            className="flex flex-col gap-1 text-caption font-semibold text-ink-700"
            htmlFor={`${id}-rute`}
          >
            Rute
            <select
              id={`${id}-rute`}
              value={line.route}
              disabled={disabled}
              onChange={(e) => onChange({ route: e.target.value })}
              className={FIELD}
            >
              {line.route === '' && <option value="">Pilih rute…</option>}
              {ROUTE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex flex-col gap-1 text-caption font-semibold text-ink-700"
            htmlFor={`${id}-aturan`}
          >
            Aturan pakai
            <select
              id={`${id}-aturan`}
              value={line.frequency}
              disabled={disabled}
              onChange={(e) => onChange({ frequency: e.target.value as DraftLine['frequency'] })}
              className={FIELD}
            >
              <option value="">Pilih…</option>
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex flex-col gap-1 text-caption font-semibold text-ink-700"
            htmlFor={`${id}-lama`}
          >
            Lama (hari)
            <input
              id={`${id}-lama`}
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              value={line.durationDays ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange({
                  durationDays: e.target.value && Number.isInteger(n) && n >= 1 && n <= 90 ? n : null,
                });
              }}
              className={FIELD}
            />
          </label>
        </div>
      ) : (
        <label
          className="flex flex-wrap items-center gap-2 text-caption font-semibold text-ink-700"
          htmlFor={`${id}-prioritas`}
        >
          Prioritas
          <select
            id={`${id}-prioritas`}
            value={line.priority}
            disabled={disabled}
            onChange={(e) => onChange({ priority: e.target.value as DraftLine['priority'] })}
            className={FIELD}
          >
            <option value="rutin">Rutin</option>
            <option value="cito">Cito</option>
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700" htmlFor={`${id}-ket`}>
        {drug ? 'Keterangan aturan pakai (opsional)' : 'Instruksi (opsional)'}
        <input
          id={`${id}-ket`}
          value={line.instructions}
          maxLength={300}
          disabled={disabled}
          onChange={(e) => onChange({ instructions: e.target.value })}
          className={FIELD}
        />
      </label>
      {problems.length > 0 && (
        <span className="text-caption text-ink-500">Lengkapi: {problems.join(', ')}.</span>
      )}

      {!evaluation ? (
        <span role="status" className="text-caption text-ink-500">
          Memeriksa CDS…
        </span>
      ) : blocked ? (
        <SafetyGate
          title={`CDS memblokir ${line.item.name}`}
          recommendation={`Hapus ${line.item.name}`}
          overrideLabel="Override dengan alasan"
          disabled={disabled}
          onFollow={onRemove}
          onOverride={(reason) => onChange({ override: reason })}
        >
          {evaluation.findings
            .filter((f) => f.level === 'block')
            .map((f) => f.message)
            .join(' ')}
        </SafetyGate>
      ) : (
        <span className={cx('text-[12.5px] font-semibold', CDS_TONE[evaluation.top.level])}>
          <span aria-hidden="true">{CDS_MARK[evaluation.top.level]} </span>
          <span className="sr-only">{CDS_SR[evaluation.top.level]}</span>
          {evaluation.overridden
            ? `Override tercatat saat dikirim · alasan: ${line.override ?? ''}`
            : evaluation.top.message}
        </span>
      )}
      {evaluation && !blocked && warnings.some((w) => w.message !== evaluation.top.message) && (
        <ul className="m-0 list-disc pl-5 text-caption text-warning">
          {warnings
            .filter((w) => w.message !== evaluation.top.message)
            .map((w) => (
              <li key={`${w.ruleCode}-${w.message}`}>{w.message}</li>
            ))}
        </ul>
      )}
    </li>
  );
}
