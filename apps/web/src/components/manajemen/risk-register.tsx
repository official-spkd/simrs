import type { RiskEntry, RiskLevel } from '@simrs/shared';
import { Chip, type ChipTone, cx } from '@simrs/ui';
import { RISK_LEVEL_LABEL, riskLevel, riskMatrix, riskScore } from '@/lib/manajemen';

const LEVEL_TONE: Record<RiskLevel, ChipTone> = {
  rendah: 'success',
  sedang: 'info',
  tinggi: 'warning',
  ekstrem: 'danger',
};
const CELL_BG: Record<RiskLevel, string> = {
  rendah: 'bg-zamrud-50',
  sedang: 'bg-samudra-50',
  tinggi: 'bg-kunyit-50',
  ekstrem: 'bg-koral-50',
};
const TREND = { naik: '▲ naik', tetap: '■ tetap', turun: '▼ turun' } as const;

/**
 * B06 · Register risiko: matriks kemungkinan × dampak (tabel dengan judul baris/kolom, isi sel = id risiko) dan
 * daftar risiko urut skor dengan tingkat tertulis, mitigasi, pemilik, dan tren.
 */
export function RiskRegister({ risks }: { risks: RiskEntry[] }) {
  const cells = riskMatrix(risks);
  const sorted = [...risks].sort((a, b) => riskScore(b) - riskScore(a));
  return (
    <section
      aria-labelledby="risiko-judul"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <span className="flex min-w-0 flex-col">
        <h2 id="risiko-judul" className="m-0 text-base font-semibold">
          Register risiko
        </h2>
        <span className="text-[12.5px] text-ink-500">
          Skor = kemungkinan × dampak (1–5). 1–3 rendah · 4–6 sedang · 8–12 tinggi · 15–25 ekstrem.
        </span>
      </span>
      <div className="flex flex-wrap items-start gap-4">
        <table className="w-full max-w-[380px] flex-[1_1_300px] table-fixed border-separate border-spacing-1 text-center text-caption">
          <caption className="sr-only">Matriks risiko: baris kemungkinan, kolom dampak</caption>
          <thead>
            <tr>
              <th scope="col" className="w-12 text-left font-semibold text-ink-500">
                K \ D
              </th>
              {[1, 2, 3, 4, 5].map((i) => (
                <th key={i} scope="col" className="font-semibold text-ink-500">
                  <span className="sr-only">Dampak </span>
                  {i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[5, 4, 3, 2, 1].map((l) => (
              <tr key={l}>
                <th scope="row" className="text-left font-semibold text-ink-500">
                  <span className="sr-only">Kemungkinan </span>
                  {l}
                </th>
                {cells
                  .filter((c) => c.likelihood === l)
                  .map((c) => (
                    <td
                      key={c.impact}
                      className={cx('h-11 rounded-md align-middle font-mono', CELL_BG[c.level])}
                      title={`${RISK_LEVEL_LABEL[c.level]} · skor ${l * c.impact}`}
                    >
                      {c.ids.length > 0 ? (
                        <span className="font-semibold text-ink-900">{c.ids.join(' ')}</span>
                      ) : (
                        <span className="text-ink-400" aria-label="kosong">
                          ·
                        </span>
                      )}
                      <span className="sr-only">, tingkat {RISK_LEVEL_LABEL[c.level].toLowerCase()}</span>
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="m-0 flex min-w-0 flex-[999_1_340px] list-none flex-col p-0">
          {sorted.map((r) => {
            const level = riskLevel(riskScore(r));
            return (
              <li
                key={r.id}
                className="flex flex-col gap-1 border-b border-line-soft py-2.5 first:pt-0 last:border-0"
              >
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-small font-semibold text-ink-900">{r.id}</span>
                  <span className="min-w-0 flex-[1_1_180px] font-medium text-ink-900">{r.title}</span>
                  <Chip tone={LEVEL_TONE[level]}>
                    {RISK_LEVEL_LABEL[level]} · {riskScore(r)}
                  </Chip>
                </span>
                <span className="text-caption text-ink-700">
                  K{r.likelihood} × D{r.impact} · {r.unit} · mitigasi: {r.mitigation}
                </span>
                <span className="text-caption text-ink-500">
                  Pemilik: {r.owner} · tren {TREND[r.trend]}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
