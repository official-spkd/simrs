'use client';

import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import {
  CHANNEL_LABEL,
  type CriticalItem,
  type GateError,
  type ReportChannel,
  type ReportInput,
  reportGate,
} from '@/lib/penunjang-kritis';

/**
 * S09 · Formulir pelaporan hasil kritis: penerima dari daftar (DPJP, dokter jaga, perawat) atau nama manual + peran,
 * saluran, dan read-back wajib. Gerbang yang sama (`reportGate`) dievaluasi di klien untuk umpan balik cepat dan
 * di Server Action sebelum laporan diterima.
 */
export function CriticalReportCenterForm({
  item,
  busy,
  serverError,
  onSubmit,
  onCancel,
}: {
  item: CriticalItem;
  busy: boolean;
  serverError: string | null;
  onSubmit: (input: ReportInput & { channel: ReportChannel }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [pick, setPick] = useState<string>(item.recipients[0]?.name ?? '');
  const [manualName, setManualName] = useState('');
  const [role, setRole] = useState(item.recipients[0]?.role ?? '');
  const [channel, setChannel] = useState<ReportChannel | ''>('telepon');
  const [readBack, setReadBack] = useState(false);
  const [errors, setErrors] = useState<GateError[]>([]);
  const manual = pick === '__lain';
  const recipient = manual ? manualName : pick;
  const err = (f: GateError['field']) => errors.find((e) => e.field === f)?.message;

  const submit = () => {
    const input: ReportInput = { recipient, recipientRole: role, channel, readBack };
    const found = reportGate(item, input);
    setErrors(found);
    if (found.length === 0 && channel !== '') onSubmit({ ...input, channel });
  };

  return (
    <form
      aria-label="Catat pelaporan hasil kritis"
      className="flex flex-col gap-3 rounded-[12px] border border-line bg-white p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1 text-small font-semibold text-ink-700">Penerima laporan</legend>
        {item.recipients.map((r) => (
          <label key={r.name} className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
            <input
              type="radio"
              name={`${id}-penerima`}
              checked={pick === r.name}
              onChange={() => {
                setPick(r.name);
                setRole(r.role);
              }}
              className="size-4 accent-brand-600"
            />
            <span>
              {r.name} <span className="text-ink-500">· {r.role}</span>
            </span>
          </label>
        ))}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
          <input
            type="radio"
            name={`${id}-penerima`}
            checked={manual}
            onChange={() => {
              setPick('__lain');
              setRole('');
            }}
            className="size-4 accent-brand-600"
          />
          Penerima lain (di luar daftar jaga)
        </label>
      </fieldset>
      {manual && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-nama`} className="text-small font-semibold text-ink-700">
            Nama penerima
          </label>
          <input
            id={`${id}-nama`}
            value={manualName}
            maxLength={120}
            onChange={(e) => setManualName(e.target.value)}
            aria-invalid={!!err('recipient')}
            aria-describedby={err('recipient') ? `${id}-nama-err` : undefined}
            className="h-11 rounded-control border border-line-strong px-3 font-[inherit]"
            placeholder="mis. dr. Rina Kusuma"
          />
          {err('recipient') && (
            <span id={`${id}-nama-err`} className="text-small font-medium text-danger">
              {err('recipient')}
            </span>
          )}
        </div>
      )}
      {!manual && err('recipient') && (
        <span className="text-small font-medium text-danger">{err('recipient')}</span>
      )}
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1">
          <label htmlFor={`${id}-peran`} className="text-small font-semibold text-ink-700">
            Peran penerima
          </label>
          <input
            id={`${id}-peran`}
            value={role}
            maxLength={60}
            onChange={(e) => setRole(e.target.value)}
            aria-invalid={!!err('recipientRole')}
            className="h-11 rounded-control border border-line-strong px-3 font-[inherit]"
          />
          {err('recipientRole') && (
            <span className="text-small font-medium text-danger">{err('recipientRole')}</span>
          )}
        </div>
        <div className="flex min-w-[180px] flex-1 flex-col gap-1">
          <label htmlFor={`${id}-saluran`} className="text-small font-semibold text-ink-700">
            Saluran
          </label>
          <select
            id={`${id}-saluran`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as ReportChannel | '')}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            <option value="">Pilih saluran</option>
            {(Object.keys(CHANNEL_LABEL) as ReportChannel[]).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
          {err('channel') && <span className="text-small font-medium text-danger">{err('channel')}</span>}
        </div>
      </div>
      <label
        className={cx(
          'flex min-h-11 cursor-pointer items-start gap-2 rounded-control border p-2.5 text-small',
          err('readBack') ? 'border-danger-border bg-danger-bg' : 'border-line bg-canvas',
        )}
      >
        <input
          type="checkbox"
          checked={readBack}
          onChange={(e) => setReadBack(e.target.checked)}
          className="mt-0.5 size-4 flex-none accent-brand-600"
        />
        <span>
          <span className="font-semibold">Read-back terkonfirmasi:</span> penerima mengulang “
          {item.patient.name}, {item.test.split(' · ')[0]} {item.valueText}” dan isinya benar.
        </span>
      </label>
      {err('readBack') && <span className="text-small font-medium text-danger">{err('readBack')}</span>}
      {serverError && (
        <span role="alert" className="text-small font-medium text-danger">
          {serverError}
        </span>
      )}
      <span className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={busy}>
          Simpan pelaporan
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
      </span>
    </form>
  );
}
