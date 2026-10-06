'use client';

import { formatTanggal } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useState } from 'react';
import { STALE_TEXT } from '@/components/backoffice/use-toko';
import {
  FAMILY_REQUEST as REQUEST,
  type PatientAppEvent,
  type PatientAppStoreState,
} from '@/lib/aplikasi-pasien-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { useStoreAction } from '@/lib/demo/store/client';
import { patientAppAction } from './actions';
import {
  accessUntil,
  DURATIONS,
  FAMILY_SCOPES,
  type FamilyScope,
  grantBlock,
  includesMedical,
} from '@/lib/akses-keluarga';

const BTN =
  'min-h-11 cursor-pointer rounded-[12px] px-4 font-[inherit] text-[14px] font-semibold disabled:cursor-not-allowed';

/**
 * I07 · Akses keluarga: permintaan masuk → pasien memilih lingkup data dan masa berlaku → setuju dengan pernyataan
 * (data medis disebut eksplisit) → akses aktif yang bisa dicabut. Tersimpan di toko demo (domain
 * `aplikasi-pasien`).
 */
export function FamilyAccess({
  onBack,
  family,
  rev,
}: {
  onBack: () => void;
  family: PatientAppStoreState['family'];
  rev: number;
}) {
  const grants = family.grants;
  const pending = family.pending;
  const [scopes, setScopes] = useState<FamilyScope[]>(['jadwal']);
  const [duration, setDuration] = useState('');
  const [agreed, setAgreed] = useState(false);
  const { run, pending: saving } = useStoreAction(rev);
  const [error, setError] = useState<string | null>(null);
  const notice = error ?? family.notice;
  const send = (event: PatientAppEvent) =>
    run(
      (r) => patientAppAction({ event, rev: r }),
      (res) => setError(res.ok ? null : res.stale ? STALE_TEXT : res.message),
    );
  const block = saving ? 'Menyimpan…' : grantBlock(scopes, duration, agreed);
  const toggle = (s: FamilyScope) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <section aria-label="Akses keluarga" className="flex flex-col gap-3">
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="h-11 cursor-pointer border-0 bg-transparent px-1 font-[inherit] font-semibold text-brand-700"
        >
          ‹ Kembali
        </button>
        <h2 className="m-0 text-[17px] font-semibold">Keluarga</h2>
      </span>
      {notice && (
        <p
          role="status"
          className="m-0 rounded-[12px] bg-[#EAF5EC] px-3 py-2 text-[13px] font-medium text-success"
        >
          {notice}
        </p>
      )}
      {pending && (
        <div className="flex flex-col gap-2 rounded-[16px] border border-warning-border bg-[#FFF8EB] p-3">
          <span className="text-[14px] font-semibold">Permintaan akses baru</span>
          <span className="text-[13px] text-ink-700">
            {REQUEST.name} ({REQUEST.relation}) meminta akses ke data Anda · {REQUEST.via}
          </span>
          <fieldset className="m-0 flex flex-col border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold">Data yang boleh dilihat</legend>
            {FAMILY_SCOPES.map((s) => (
              <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={scopes.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  className="h-5 w-5 accent-brand-600"
                />
                {s.label}
                {s.medical && (
                  <span className="text-[11.5px] font-semibold text-warning">data kesehatan</span>
                )}
              </label>
            ))}
          </fieldset>
          <fieldset className="m-0 flex flex-col border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold">Berlaku</legend>
            <span className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <label
                  key={d.id}
                  className={cx(
                    'relative flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600',
                    duration === d.id
                      ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                      : 'border-line-strong bg-white',
                  )}
                >
                  <input
                    type="radio"
                    name="durasi-akses"
                    value={d.id}
                    checked={duration === d.id}
                    onChange={() => setDuration(d.id)}
                    className="sr-only"
                  />
                  {d.label}
                </label>
              ))}
            </span>
          </fieldset>
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-[12.5px] text-ink-700">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
            />
            Saya menyetujui {REQUEST.name} melihat data yang saya pilih
            {includesMedical(scopes) ? ', termasuk data kesehatan saya' : ''}. Persetujuan bisa saya cabut
            kapan saja dan setiap akses tercatat.
          </label>
          <span id="akses-alasan" className="text-[12px] text-ink-500">
            {block ?? 'Siap disetujui.'}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={block !== null}
              aria-describedby="akses-alasan"
              onClick={() =>
                send({
                  type: 'keluarga.disetujui',
                  scopes,
                  duration,
                  until: accessUntil(DEMO_TODAY, duration),
                  jam: demoStamp().jam,
                })
              }
              className={cx(
                BTN,
                'border border-brand-800 bg-brand-600 text-white disabled:border-line disabled:bg-muted disabled:text-ink-400',
              )}
            >
              Setujui akses
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => send({ type: 'keluarga.ditolak', jam: demoStamp().jam })}
              className={cx(BTN, 'border border-line-strong bg-white text-ink-900')}
            >
              Tolak
            </button>
          </span>
        </div>
      )}
      <ul aria-label="Keluarga dengan akses" className="m-0 flex list-none flex-col gap-2 p-0">
        {grants.map((g) => (
          <li key={g.name} className="flex flex-col gap-1 rounded-[16px] border border-line bg-white p-3">
            <span className="text-[14px] font-semibold">
              {g.name} · {g.relation}
            </span>
            <span className="text-[12.5px] text-ink-700">
              {FAMILY_SCOPES.filter((s) => g.scopes.includes(s.id))
                .map((s) => s.label)
                .join(', ')}
            </span>
            <span className="text-[12px] text-ink-500">
              Sejak {g.at} · {g.until ? `berakhir ${formatTanggal(g.until)}` : 'sampai dicabut'}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => send({ type: 'keluarga.dicabut', name: g.name, jam: demoStamp().jam })}
              className={cx(BTN, 'self-start border border-line-strong bg-white text-danger')}
            >
              Cabut akses<span className="sr-only"> {g.name}</span>
            </button>
          </li>
        ))}
        {grants.length === 0 && (
          <li className="text-[13px] text-ink-500">Belum ada keluarga yang punya akses.</li>
        )}
      </ul>
    </section>
  );
}
