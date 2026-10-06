'use client';

import { formatJam, formatTanggalWaktu, type OrCase } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { recordAnesthesiaAction } from '@/app/(staf)/penunjang/kamar-operasi/anestesi-actions';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  AIRWAY_OPTIONS,
  ASA_CLASSES,
  ASA_LABEL,
  type AnesthesiaRecord,
  asaText,
  INDUCTION_BLOCK_TEXT,
  inductionGate,
  type PreAnesthesia,
  preAnesthesiaMissing,
  vitalsWarnings,
} from '@/lib/penunjang-anestesi';

const inputCls = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] font-normal';
const labelCls = 'flex flex-col gap-1 text-small font-semibold text-ink-700';

/**
 * S06 · Panel anestesi di layar Kamar operasi: asesmen pra-anestesi (ASA, puasa, jalan napas, rencana, persetujuan)
 * ber-TTE, gerbang induksi (asesmen + sign in WHO), dan monitoring intraoperasi. Tidak mengubah urutan daftar tilik.
 */
export function OkAnesthesia({
  c,
  record,
  rev,
}: {
  c: OrCase;
  record: AnesthesiaRecord | undefined;
  rev: number;
}) {
  const id = useId();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(rev);
  const [v, setV] = useState({ systolic: '118', diastolic: '72', pulse: '80', spo2: '99', etco2: '35' });
  const [draft, setDraft] = useState<PreAnesthesia>(
    record?.pre ?? {
      asa: null,
      emergency: false,
      fastingSince: '',
      airway: '',
      plan: '',
      consent: false,
      signed: null,
    },
  );
  const rec: AnesthesiaRecord = record?.pre.signed
    ? record
    : { ...(record ?? { inductionAt: null, vitals: [] }), pre: draft };
  const signIn = !!c.checklist[0]?.confirmedAt;
  const block = inductionGate(rec, signIn);
  const finished = c.status === 'selesai';
  const setPre = (p: Partial<PreAnesthesia>) => setDraft((cur) => ({ ...cur, ...p }));
  const call = (payload: Parameters<typeof recordAnesthesiaAction>[0]) =>
    save(
      (rev) => recordAnesthesiaAction(payload, rev),
      (result) => setMsg({ ok: result.ok, text: result.message }),
    );

  const missing = preAnesthesiaMissing(rec.pre);
  const vitals = {
    systolic: Number(v.systolic),
    diastolic: Number(v.diastolic),
    pulse: Number(v.pulse),
    spo2: Number(v.spo2),
    etco2: Number(v.etco2),
  };

  return (
    <section
      aria-label="Anestesi"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">Anestesi · {c.anesthesia}</span>
        <Chip tone={rec.pre.signed ? 'success' : 'warning'}>{asaText(rec.pre)}</Chip>
      </span>
      {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}

      {rec.pre.signed ? (
        <span className="text-small text-ink-700">
          Asesmen pra-anestesi ditandatangani {rec.pre.signed.by} · {formatTanggalWaktu(rec.pre.signed.at)} ·{' '}
          {rec.pre.emergency ? 'darurat (risiko aspirasi)' : `puasa sejak ${rec.pre.fastingSince}`} ·{' '}
          {rec.pre.airway} · {rec.pre.plan}
        </span>
      ) : (
        <form
          aria-label="Asesmen pra-anestesi"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const { asa, emergency, fastingSince, airway, plan, consent } = rec.pre;
            call({ kind: 'tte', caseId: c.id, pre: { asa, emergency, fastingSince, airway, plan, consent } });
          }}
        >
          <span className="text-small font-semibold">Asesmen pra-anestesi</span>
          <label className={labelCls}>
            Kelas ASA
            <select
              value={rec.pre.asa ?? ''}
              onChange={(e) => setPre({ asa: (e.target.value || null) as PreAnesthesia['asa'] })}
              className={inputCls}
            >
              <option value="">Pilih kelas ASA</option>
              {ASA_CLASSES.map((a) => (
                <option key={a} value={a}>
                  ASA {a} · {ASA_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={rec.pre.emergency}
              onChange={(e) => setPre({ emergency: e.target.checked })}
              className="size-4 accent-brand-600"
            />
            Operasi darurat (ASA E)
          </label>
          <span className="flex flex-wrap gap-3">
            <label htmlFor={`${id}-puasa`} className={cx(labelCls, 'min-w-[140px] flex-1')}>
              Puasa sejak (jam)
              <input
                id={`${id}-puasa`}
                value={rec.pre.fastingSince}
                maxLength={10}
                placeholder="mis. 22.00"
                onChange={(e) => setPre({ fastingSince: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className={cx(labelCls, 'min-w-[160px] flex-1')}>
              Jalan napas
              <select
                value={rec.pre.airway}
                onChange={(e) => setPre({ airway: e.target.value })}
                className={inputCls}
              >
                <option value="">Pilih</option>
                {AIRWAY_OPTIONS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </span>
          <label className={labelCls}>
            Rencana anestesi
            <input
              value={rec.pre.plan}
              maxLength={500}
              placeholder={c.anesthesia}
              onChange={(e) => setPre({ plan: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={rec.pre.consent}
              onChange={(e) => setPre({ consent: e.target.checked })}
              className="size-4 accent-brand-600"
            />
            Persetujuan tindakan anestesi sudah ditandatangani pasien/keluarga
          </label>
          <span className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={pending || missing.length > 0}>
              Tandatangani asesmen (TTE pengguna aktif)
            </Button>
            {missing.length > 0 && (
              <span className="text-caption text-ink-500">Belum lengkap: {missing.join(', ')}.</span>
            )}
          </span>
        </form>
      )}

      {!rec.inductionAt && !finished && (
        <span className="flex flex-wrap items-center gap-2">
          <Button
            disabled={pending || block !== null}
            onClick={() =>
              call({ kind: 'induksi', caseId: c.id, preSigned: !!rec.pre.signed, signInConfirmed: signIn })
            }
          >
            Catat induksi
          </Button>
          <span className="text-small text-ink-700">
            {block && block !== 'ALREADY' ? INDUCTION_BLOCK_TEXT[block] : 'Siap induksi.'}
          </span>
        </span>
      )}
      {rec.inductionAt && (
        <div className="flex flex-col gap-2">
          <span className="text-small font-semibold">
            Monitoring intraoperasi · induksi {formatJam(rec.inductionAt)}
          </span>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-small">
              <thead>
                <tr className="border-b border-line text-left text-caption font-semibold text-ink-500">
                  <th className="px-2 py-1">Jam</th>
                  <th className="px-2 py-1 text-right">TD</th>
                  <th className="px-2 py-1 text-right">Nadi</th>
                  <th className="px-2 py-1 text-right">SpO₂</th>
                  <th className="px-2 py-1 text-right">EtCO₂</th>
                </tr>
              </thead>
              <tbody>
                {rec.vitals.map((x) => {
                  const w = vitalsWarnings(x);
                  return (
                    <tr
                      key={x.at}
                      className={cx('border-b border-line-soft', w.length > 0 && 'bg-kunyit-50')}
                    >
                      <td className="px-2 py-1 font-mono">{formatJam(x.at)}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {x.systolic}/{x.diastolic}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{x.pulse}</td>
                      <td className="px-2 py-1 text-right font-mono">{x.spo2}%</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {x.etco2}
                        {w.length > 0 && <span className="sr-only"> · perhatian: {w.join(', ')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!finished && (
            <form
              aria-label="Catat tanda vital intraoperasi"
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                call({ kind: 'ttv', caseId: c.id, vitals });
              }}
            >
              {(
                [
                  ['systolic', 'Sistolik'],
                  ['diastolic', 'Diastolik'],
                  ['pulse', 'Nadi'],
                  ['spo2', 'SpO₂'],
                  ['etco2', 'EtCO₂'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className={cx(labelCls, 'w-[72px]')}>
                  {label}
                  <input
                    value={v[k]}
                    inputMode="numeric"
                    onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value.replace(/\D/g, '') }))}
                    className={cx(inputCls, 'px-2 font-mono')}
                  />
                </label>
              ))}
              <Button type="submit" size="sm" disabled={pending}>
                Catat TTV
              </Button>
            </form>
          )}
          {vitalsWarnings(vitals).length > 0 && !finished && (
            <span className="text-small font-semibold text-warning">
              Perhatian: {vitalsWarnings(vitals).join(', ')}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
