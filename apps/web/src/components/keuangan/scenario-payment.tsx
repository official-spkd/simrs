'use client';

import { PAYMENT_METHODS, type PaymentMethod } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type FlowTask, flowReason, type ScenarioFlow } from '@/lib/keuangan-flow';
import { PAYMENT_METHOD_LABEL } from '@/lib/keuangan';
import { CicilanBox } from './cicilan-box';
import { QrisBox } from './payment-methods';

/** Metode yang dibawakan skenario elektif (tugas `cara`): cicilan BTN atau QRIS. */
const SCENARIO_METHOD: Partial<Record<PaymentMethod, string>> = { cicilan: 'cicil', qris: 'qris' };

/**
 * Pelunasan sisa selisih naik kelas pasien skenario elektif: setiap tombol menjalankan tugas skenario langkah
 * Kasir (cara → tenor → ajukan → setuju → cair, atau QRIS) hanya saat tugas itu gilirannya.
 */
export function ScenarioPayment({
  flow,
  due,
  pending,
  onTask,
}: {
  flow: ScenarioFlow;
  due: bigint;
  pending: boolean;
  onTask: (task: string, value: true | string) => void;
}) {
  const t = (id: string): FlowTask | undefined => flow.tasks[id];
  const cara = t('cara');
  const chosen = cara?.value ?? null;
  const caraReason = cara?.done ? '' : flowReason(flow, 'cara');
  const act = (id: string, label: string) => {
    const task = t(id);
    return {
      label,
      enabled: !!task?.enabled && !pending,
      reason: flowReason(flow, id),
      onClick: () => onTask(id, true),
    };
  };
  const ajukan = t('ajukan');
  const setuju = t('setuju');
  const cair = t('cair');
  const done = cair?.done ? 6 : setuju?.done ? 4 : ajukan?.done ? 1 : 0;
  const times = [ajukan?.at, setuju?.at, setuju?.at, setuju?.at, cair?.at, cair?.at].map((x) => x ?? '');

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Metode pembayaran" className="grid grid-cols-2 gap-2">
        {PAYMENT_METHODS.map((m) => {
          const value = SCENARIO_METHOD[m];
          const on = !!value && chosen === value;
          const can = !!value && !!cara?.enabled && !pending;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!can && !on}
              onClick={() => value && can && onTask('cara', value)}
              className={cx(
                'flex min-h-11 flex-col gap-0.5 rounded-control border-[1.5px] px-3 py-2 text-left font-[inherit] text-ink-900 disabled:cursor-not-allowed disabled:opacity-55',
                m === 'cicilan' && 'col-span-2',
                on ? 'border-brand-600 bg-[#F2FAF8]' : 'border-line bg-white',
                can && 'cursor-pointer',
              )}
            >
              <span className="font-semibold">{PAYMENT_METHOD_LABEL[m].name}</span>
              <span className="text-[11.5px] text-ink-500">{PAYMENT_METHOD_LABEL[m].sub}</span>
            </button>
          );
        })}
      </div>
      <span className="text-caption text-ink-500">
        Skenario elektif: pasien memilih Cicilan BTN atau QRIS untuk sisa selisih naik kelas.
        {caraReason ? ` ${caraReason}` : ''}
      </span>
      {chosen === 'cicil' && (
        <CicilanBox
          due={due}
          tenors={t('tenor')?.options ?? []}
          tenor={t('tenor')?.value ?? null}
          onTenor={t('tenor')?.enabled && !pending ? (id) => onTask('tenor', id) : undefined}
          submit={ajukan?.done ? null : act('ajukan', 'Ajukan pembiayaan ke BTN')}
          done={done}
          times={times}
          next={
            !ajukan?.done
              ? null
              : !setuju?.done
                ? act('setuju', 'Simulasikan: BTN menyetujui, pasien tanda tangan akad (TTE)')
                : !cair?.done
                  ? act('cair', 'Simulasikan: BTN mencairkan dana ke RS')
                  : null
          }
        />
      )}
      {chosen === 'qris' && (
        <QrisBox
          due={due}
          paidAt={t('qrisbayar')?.done ? (t('qrisbayar')?.at ?? 'tercatat') : null}
          onSimulate={() => t('qrisbayar')?.enabled && !pending && onTask('qrisbayar', true)}
        />
      )}
    </div>
  );
}
