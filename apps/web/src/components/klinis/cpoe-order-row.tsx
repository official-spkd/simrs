'use client';

import { Chip, cx, SafetyGate } from '@simrs/ui';
import type { CdsFix, EvaluatedLine } from '@/lib/klinis-cds';

const COVERAGE_LABEL = {
  ditanggung: 'Ditanggung',
  fornas: 'Fornas',
  'tidak-ditanggung': 'Tidak ditanggung',
} as const;
const CDS_TONE = { info: 'text-success', warn: 'text-warning', block: 'text-danger' } as const;
const CDS_MARK = { info: '✓', warn: '!', block: '✕' } as const;
const CDS_SR = { info: 'CDS aman: ', warn: 'Peringatan CDS: ', block: 'Diblokir CDS: ' } as const;

function codeText(line: EvaluatedLine): string {
  const c = line.item.code;
  if (c) return `${c.system} ${c.code}`;
  return line.item.kind === 'obat' ? 'KFA belum dipetakan' : 'Kode belum dipetakan';
}

/** Satu baris order CPOE: penjaminan, prioritas, baris CDS, dan gerbang keselamatan bila diblokir. */
export function CpoeOrderRow({
  line,
  fixes,
  payer,
  disabled,
  removable = true,
  onFix,
  onOverride,
  onRemove,
}: {
  line: EvaluatedLine;
  fixes: readonly CdsFix[];
  payer: 'BPJS' | 'Umum' | 'Asuransi';
  disabled: boolean;
  /** Baris yang dikendalikan skenario tidak bisa dihapus lokal. */
  removable?: boolean;
  onFix: (fix: CdsFix) => void;
  onOverride: (reason: string) => void;
  onRemove: () => void;
}) {
  const { item, cds } = line;
  const draft = line.status === 'draf';
  const gate = line.blocked && draft;
  const [primary, ...others] = fixes;
  return (
    <li
      className={cx(
        'flex flex-col gap-2 border-b border-line-soft px-4 py-3 last:border-b-0',
        gate ? 'bg-[#FFFBFA]' : 'bg-white',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="font-semibold">{item.name}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Chip
            tone={
              payer !== 'Umum' && item.coverage === 'tidak-ditanggung'
                ? 'warning'
                : payer === 'Umum'
                  ? 'neutral'
                  : 'success'
            }
          >
            {payer === 'Umum' ? 'Bayar mandiri' : COVERAGE_LABEL[item.coverage]}
          </Chip>
          <Chip tone={item.priority === 'cito' ? 'danger' : 'neutral'}>
            {item.priority === 'cito' ? 'Cito' : 'Rutin'}
          </Chip>
          {draft && removable ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Hapus ${item.name}`}
              className="min-h-11 cursor-pointer rounded-full border border-line bg-white px-3 font-[inherit] text-caption font-semibold text-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Hapus
            </button>
          ) : draft ? (
            <Chip tone="warning">Menunggu CDS</Chip>
          ) : (
            <Chip tone="info">Terkirim</Chip>
          )}
        </span>
      </div>
      <span className="text-small text-ink-700">
        {item.detail} <span className="font-mono text-caption text-ink-500">· {codeText(line)}</span>
      </span>
      {!gate && (
        <span className={cx('text-[12.5px] font-semibold', CDS_TONE[cds.level])}>
          <span aria-hidden="true">{CDS_MARK[cds.level]} </span>
          <span className="sr-only">{CDS_SR[cds.level]}</span>
          {cds.message}
        </span>
      )}
      {gate && primary && (
        <div className="flex flex-col gap-2">
          <SafetyGate
            title={`CDS memblokir ${item.name}`}
            recommendation={primary.label}
            overrideLabel="Override dengan alasan"
            disabled={disabled}
            onFollow={() => onFix(primary)}
            onOverride={onOverride}
          >
            {cds.message}
          </SafetyGate>
          {others.length > 0 && (
            <span className="flex flex-wrap items-center gap-2 text-caption text-ink-700">
              Pilihan lain:
              {others.map((f) => (
                <button
                  key={`${f.kind}-${f.label}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onFix(f)}
                  className="min-h-11 cursor-pointer rounded-control border border-brand-800 bg-white px-3 font-[inherit] text-small font-semibold text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {f.label}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
