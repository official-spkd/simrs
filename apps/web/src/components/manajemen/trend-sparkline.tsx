/**
 * Garis tren kecil (mis. capaian indikator 6 bulan) dengan garis sasaran putus-putus. Titik terakhir diberi warna
 * status; makna lengkap ada di `label` (role="img"), jadi status tidak hanya lewat warna.
 */
export function TrendSparkline({
  values,
  target,
  ok,
  label,
  width = 120,
  height = 32,
}: {
  values: readonly number[];
  /** Nilai sasaran (garis putus-putus), bila ada. */
  target?: number;
  ok: boolean;
  label: string;
  width?: number;
  height?: number;
}) {
  const all = target === undefined ? [...values] : [...values, target];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = 4;
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(values.length - 1, 1);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="block shrink-0"
    >
      {target !== undefined && (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(target)}
          y2={y(target)}
          stroke="#8A4B00"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      <path
        d={d}
        fill="none"
        stroke="#0F766E"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {last >= 0 && (
        <circle cx={x(last)} cy={y(values[last] ?? 0)} r={3.2} fill={ok ? '#1E6B34' : '#B42318'} />
      )}
    </svg>
  );
}
