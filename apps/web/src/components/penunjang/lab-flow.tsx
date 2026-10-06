import { cx } from '@simrs/ui';
import { CARD } from './pelangi';

/** Alur validasi berurutan (mockup Lab) dan konsekuensi setelah rilis. Status ditulis, tidak hanya warna. */
export function LabFlow({ stage, pending }: { stage: number; pending: number }) {
  const steps = [
    'Sampel diterima dan diverifikasi barcode',
    pending > 0
      ? `Hasil dari analyzer (${pending} parameter masih diproses)`
      : 'Hasil dari analyzer, QC lolos',
    'Validasi teknis oleh analis',
    'Validasi klinis oleh dokter Sp.PK (TTE)',
  ];
  return (
    <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
      <section aria-label="Alur validasi" className={cx('flex flex-col gap-2 px-4 py-3.5', CARD)}>
        <h3 className="m-0 text-[15px] font-semibold">Alur validasi</h3>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {steps.map((t, i) => {
            const done = i < stage;
            const cur = i === stage;
            return (
              <li
                key={t}
                aria-current={cur ? 'step' : undefined}
                className="flex items-center gap-2.5 text-small"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'flex size-[22px] flex-none items-center justify-center rounded-full text-caption font-bold',
                    done
                      ? 'bg-zamrud-100 text-zamrud-700'
                      : cur
                        ? 'bg-nav-active text-white shadow-[0_4px_10px_rgba(23,32,46,0.18)]'
                        : 'bg-[rgba(23,32,46,0.06)] text-ink-500',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className="text-ink-700">
                  {t}
                  <span className="sr-only">
                    {done ? ' (selesai)' : cur ? ' (tahap saat ini)' : ' (belum)'}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
      <section aria-label="Setelah validasi klinis" className={cx('flex flex-col gap-2 px-4 py-3.5', CARD)}>
        <h3 className="m-0 text-[15px] font-semibold">Setelah validasi klinis</h3>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-small text-ink-700">
          <li>Hasil tampil di CPPT dan notifikasi ke DPJP</li>
          <li>Observation + DiagnosticReport ke SATUSEHAT</li>
          <li>Tarif masuk billing otomatis (charge capture)</li>
          <li>Koreksi setelah rilis hanya lewat hasil revisi berversi</li>
        </ul>
      </section>
    </div>
  );
}
