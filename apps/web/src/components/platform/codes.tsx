import { encode } from 'uqr';

/** QR kode sungguhan (uqr) sebagai `<svg>` rect; `label` = teks alternatif (isi QR tidak dibacakan). */
export function QrCode({ value, size = 96, label }: { value: string; size?: number; label: string }) {
  const qr = encode(value, { border: 1 });
  const n = qr.size;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="flex-none bg-white"
    >
      {qr.data.flatMap((row, y) =>
        row.map((on, x) =>
          on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#14212B" /> : null,
        ),
      )}
    </svg>
  );
}

/**
 * Barcode dekoratif dari teks (lebar batang dari kode karakter, deterministik) untuk pratinjau cetak; bukan
 * simbologi baku. Nomor tertulis di bawahnya sehingga tidak bergantung pada gambar.
 */
export function BarcodePreview({
  value,
  width = 160,
  height = 34,
}: {
  value: string;
  width?: number;
  height?: number;
}) {
  const bars: Array<{ x: number; w: number }> = [];
  let x = 2;
  for (const ch of value.replace(/\W/g, '')) {
    const c = ch.charCodeAt(0);
    for (const w of [1 + (c % 3), 1 + ((c >> 2) % 2), 2 + ((c >> 3) % 2)]) {
      bars.push({ x, w });
      x += w + 1 + ((c >> 1) % 2);
    }
  }
  return (
    <span className="inline-flex flex-col items-center">
      <svg
        aria-hidden="true"
        width={width}
        height={height}
        viewBox={`0 0 ${x + 2} ${height}`}
        preserveAspectRatio="none"
      >
        {bars.map((b) => (
          <rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill="#14212B" />
        ))}
      </svg>
      <span className="font-mono text-[11px] tracking-wider">{value}</span>
    </span>
  );
}
