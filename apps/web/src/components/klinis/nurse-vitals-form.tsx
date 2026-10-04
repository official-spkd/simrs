'use client';

import type { PoliVital } from '@simrs/shared';
import { Alert, Button, Field } from '@simrs/ui';
import { type ChangeEvent, useState, useTransition } from 'react';
import { recordVitalsAction } from '@/app/(staf)/klinis/poli/actions';
import { bloodPressureFlag, parseBloodPressure } from '@/lib/klinis';

type FormKey = 'td' | 'nadi' | 'suhu' | 'spo2';

function initial(vitals: readonly PoliVital[]): Record<FormKey, string> {
  const get = (id: FormKey) => {
    const v = vitals.find((x) => x.id === id)?.value ?? '';
    return v === '—' ? '' : v;
  };
  return { td: get('td'), nadi: get('nadi'), suhu: get('suhu'), spo2: get('spo2') };
}

/** Tanda vital baru dari isian (flag ditentukan aturan yang sama dengan tampilan). */
function updated(vitals: readonly PoliVital[], f: Record<FormKey, string>, at: string): PoliVital[] {
  const bp = parseBloodPressure(f.td);
  const nadi = Number(f.nadi);
  const suhu = Number(f.suhu.replace(',', '.'));
  const spo2 = Number(f.spo2);
  const flag: Record<FormKey, PoliVital['flag']> = {
    td: bp ? bloodPressureFlag(bp.sys, bp.dia) : 'normal',
    nadi: nadi > 100 ? 'tinggi' : nadi < 60 ? 'rendah' : 'normal',
    suhu: suhu >= 37.5 ? 'tinggi' : suhu < 35.5 ? 'rendah' : 'normal',
    spo2: spo2 < 95 ? 'rendah' : 'normal',
  };
  return vitals.map((v) =>
    v.id in flag
      ? { ...v, value: f[v.id as FormKey], flag: flag[v.id as FormKey], note: `diukur ulang ${at}` }
      : v,
  );
}

/** Asesmen ulang tanda vital oleh perawat (pasien non-skenario). Simulasi: tidak disimpan. */
export function NurseVitalsForm({
  encounterId,
  vitals,
  onSaved,
}: {
  encounterId: string;
  vitals: readonly PoliVital[];
  onSaved: (vitals: PoliVital[], at: string) => void;
}) {
  const [form, setForm] = useState(() => initial(vitals));
  const [result, setResult] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: FormKey) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const err = (k: FormKey) => (result && !result.ok && result.field === k ? result.text : null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await recordVitalsAction({ encounterId, ...form });
          if (r.ok && r.at) {
            onSaved(updated(vitals, form, r.at), r.at);
            setResult({ ok: true, text: r.message ?? 'Tersimpan (simulasi, tidak disimpan)' });
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
