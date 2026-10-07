import type { EncounterCompleteness } from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
import { formatTglJam } from '@/lib/rawat-inap';

export const SETTING_LABEL: Record<EncounterCompleteness['setting'], string> = {
  rawat_jalan: 'Rawat jalan',
  igd: 'IGD',
  rawat_inap: 'Rawat inap',
};

/**
 * K15 · Kelengkapan asesmen kunjungan menurut paket formulir setting-nya (EP 6b/7a, fase 3 · 3.8). Status selalu
 * bertulisan; formulir wajib yang belum diisi ditandai "Belum diisi".
 */
export function CompletenessCard({ data }: { data: EncounterCompleteness }) {
  return (
    <section
      aria-label="Kelengkapan formulir"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">
          Kelengkapan paket formulir · {SETTING_LABEL[data.setting]}
        </h2>
        <Chip tone={data.complete ? 'success' : 'warning'}>
          {data.complete ? 'Lengkap' : 'Belum lengkap'} · wajib {data.requiredFilled}/{data.requiredTotal}
        </Chip>
      </div>
      {data.items.length === 0 ? (
        <p className="m-0 text-small text-ink-500">Paket setting ini belum berisi formulir.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {data.items.map((i) => (
            <li
              key={i.formCode}
              className={cx(
                'flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2 text-small',
                i.required && !i.filled ? 'border-kunyit-200 bg-alert-warning' : 'border-line',
              )}
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{i.formTitle ?? i.formCode}</span>
                <span className="text-caption text-ink-500">{i.required ? 'Wajib' : 'Opsional'}</span>
              </span>
              <span className="text-caption font-semibold">
                {i.filled && i.filledAt ? `Diisi ${formatTglJam(i.filledAt)}` : 'Belum diisi'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
