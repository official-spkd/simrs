/**
 * Batang volume kecil (mis. pesan per jam, 24 titik). Batang bergalat berwarna merah DAN diberi tanda titik di
 * atasnya; ringkasan lengkap ada di `label` (role="img") sehingga status tidak hanya lewat warna.
 */
export function Sparkbars({
  values,
  errorIndexes = [],
  label,
  height = 30,
}: {
  values: readonly number[];
  errorIndexes?: readonly number[];
  label: string;
  height?: number;
}) {
  const W = 240;
  const gap = 2;
  const max = Math.max(...values, 1);
  const bw = (W - gap * (values.length - 1)) / Math.max(values.length, 1);
  const top = 6;
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block"
    >
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * (height - top));
        const err = errorIndexes.includes(i);
        const x = i * (bw + gap);
        return (
          <g key={i}>
            <rect
              x={x}
              y={height - h}
              width={bw}
              height={h}
              rx={1.5}
              fill={err ? 'var(--color-koral-500)' : 'var(--color-brand-300)'}
            />
            {err && <rect x={x} y={height - h - 4} width={bw} height={2} fill="var(--color-koral-600)" />}
          </g>
        );
      })}
    </svg>
  );
}
