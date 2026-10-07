'use client';

import type { PoliVital } from '@simrs/shared';
import { Alert, Button, Field } from '@simrs/ui';
import { type ChangeEvent, useState } from 'react';
import type { PoliOps } from './poli-ops';

type FormKey = 'td' | 'nadi' | 'suhu' | 'spo2' | 'napas' | 'berat' | 'kesadaran';

function initial(vitals: readonly PoliVital[]): Record<FormKey, string> {
  const get = (id: FormKey) => {
    const v = vitals.find((x) => x.id === id)?.value ?? '';
    return v === '—' ? '' : v;
  };
  return {
    td: get('td'),
    nadi: get('nadi'),
    suhu: get('suhu'),
    spo2: get('spo2'),
    napas: get('napas'),
    berat: get('berat'),
    kesadaran: '',
  };
}

/**
 * Asesmen ulang tanda vital oleh perawat (pasien non-skenario). Tersimpan lewat `ops` (toko demo `klinis-poli` atau
 * API observasi) atas nama pengguna sesi; tanda vital baru datang dari server.
 */
export function NurseVitalsForm({
  encounterId,
  vitals,
  ops,
  onSaved,
}: {
  encounterId: string;
  vitals: readonly PoliVital[];
  ops: PoliOps;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState(() => initial(vitals));
  const [result, setResult] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const { pending } = ops;
  const full = ops.vitalsMode === 'lengkap';
  const [oksigen, setOksigen] = useState(false);
  const set = (k: FormKey) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const err = (k: FormKey) => (result && !result.ok && result.field === k ? result.text : null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const { napas, berat, kesadaran, ...core } = form;
        const input = full
          ? { encounterId, ...core, napas, berat, kesadaran, oksigen }
          : { encounterId, ...core };
        ops.recordVitals(input, (r) => {
          if (r.ok && r.at) {
            onSaved(r.message ?? `Tanda vital tersimpan ${r.at}`);
            setResult({ ok: true, text: r.message ?? 'Tersimpan' });
          } else {
            setResult({ ok: false, text: r.error ?? 'Gagal menyimpan.', field: r.field });
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field
          label="Tekanan darah (mmHg)"
          value={form.td}
          onChange={set('td')}
          placeholder="120/80"
          error={err('td')}
          required
        />
        <Field
          label="Nadi (x/mnt)"
          value={form.nadi}
          onChange={set('nadi')}
          inputMode="numeric"
          error={err('nadi')}
          required
        />
        <Field
          label="Suhu (°C)"
          value={form.suhu}
          onChange={set('suhu')}
          inputMode="decimal"
          error={err('suhu')}
          required
        />
        <Field
          label="SpO2 (%)"
          value={form.spo2}
          onChange={set('spo2')}
          inputMode="numeric"
          error={err('spo2')}
          required
        />
        {full && (
          <>
            <Field
              label="Napas (x/mnt)"
              value={form.napas}
              onChange={set('napas')}
              inputMode="numeric"
              error={err('napas')}
              required
            />
            <Field
              label="Berat badan (kg)"
              value={form.berat}
              onChange={set('berat')}
              inputMode="decimal"
              error={err('berat')}
            />
            <label className="flex flex-col gap-1.5 text-small font-semibold">
              Kesadaran (ACVPU)
              <select
                value={form.kesadaran}
                required
                onChange={(e) => setForm((f) => ({ ...f, kesadaran: e.target.value }))}
                aria-invalid={err('kesadaran') ? true : undefined}
                className="h-11 rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-small font-normal"
              >
                <option value="">Pilih…</option>
                <option value="A">A · sadar penuh</option>
                <option value="C">C · bingung baru</option>
                <option value="V">V · respons suara</option>
                <option value="P">P · respons nyeri</option>
                <option value="U">U · tidak respons</option>
              </select>
              {err('kesadaran') && <span className="text-caption text-danger">{err('kesadaran')}</span>}
            </label>
            <label className="flex min-h-11 items-center gap-2 self-end text-small">
              <input
                type="checkbox"
                checked={oksigen}
                onChange={(e) => setOksigen(e.target.checked)}
                className="size-[18px] accent-brand-600"
              />
              Dengan oksigen tambahan
            </label>
          </>
        )}
      </div>
      <span className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Menyimpan…' : 'Simpan tanda vital'}
        </Button>
        {result?.ok && (
          <span role="status" className="text-small font-semibold text-success">
            {result.text}
          </span>
        )}
      </span>
      {result && !result.ok && !result.field && <Alert level="warning">{result.text}</Alert>}
    </form>
  );
}
