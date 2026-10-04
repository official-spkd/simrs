import { cx } from './cx';

export interface ChartSeries {
  label: string;
  values: readonly number[];
  tone: 'brand' | 'warning';
  dashed?: boolean;
  /** Isi gradasi di bawah garis. */
  area?: boolean;
}

const STROKE = { brand: '#0F766E', warning: '#8A4B00' } as const;

/**
 * Grafik garis SVG ringan (tanpa pustaka grafik): sumbu Y dengan garis bantu, label X terpilih, satu atau lebih
 * deret. Aksesibel: `role="img"` + label, dan tabel data tersembunyi untuk pembaca layar.
 */
export function LineChart({
  id,
  series,
  xLabels,
  rowLabels,
  ariaLabel,
  yTicks,
  height = 200,
  formatValue = (v) => String(v),
  className,
}: {
  /** Id unik di halaman (untuk gradasi SVG). */
  id: string;
  series: readonly ChartSeries[];
  /** Label sumbu X: indeks titik → teks. */
  xLabels: ReadonlyArray<{ index: number; label: string }>;
  /** Label tiap titik untuk tabel aksesibilitas. */
  rowLabels: readonly string[];
  ariaLabel: string;
  /** Nilai garis bantu Y (menentukan rentang sumbu). */
  yTicks: readonly number[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const W = 620;
  const left = 40;
  const right = 610;
  const top = 20;
  const bottom = height - 30;
  const min = Math.min(...yTicks);
  const max = Math.max(...yTicks);
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const x = (i: number) => left + (i * (right - left)) / (n - 1);
  const y = (v: number) =>
    bottom - ((Math.min(Math.max(v, min), max) - min) / (max - min || 1)) * (bottom - top);
  const line = (values: readonly number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <figure className={cx('m-0', className)}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0F766E" stopOpacity="0.22" />
            <stop offset="1" stopColor="#0F766E" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="#EEF1F4">
          {yTicks.map((t) => (
            <line key={t} x1={left} y1={y(t)} x2={right} y2={y(t)} />
          ))}
        </g>
        <g fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="#5B6B79">
          {yTicks.map((t) => (
            <text key={t} x="4" y={y(t) + 4}>
              {formatValue(t)}
            </text>
          ))}
        </g>
        {series.map((s) => (
          <g key={s.label}>
            {s.area && (
              <path
                d={`${line(s.values)} L${x(s.values.length - 1).toFixed(1)} ${bottom} L${left} ${bottom} Z`}
                fill={`url(#${id}-area)`}
              />
            )}
            <path
              d={line(s.values)}
              fill="none"
              stroke={STROKE[s.tone]}
              strokeWidth={s.dashed ? 1.5 : 2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          </g>
        ))}
        <g fontSize="11" fill="#3F4C58">
          {xLabels.map((l) => (
            <text
              key={l.index}
              x={x(l.index)}
              y={height - 8}
              textAnchor={l.index === 0 ? 'start' : l.index >= n - 1 ? 'end' : 'middle'}
            >
              {l.label}
            </text>
          ))}
        </g>
      </svg>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Titik</th>
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((label, i) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {series.map((s) => (
                <td key={s.label}>{s.values[i] === undefined ? '—' : formatValue(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
