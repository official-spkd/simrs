'use client';

import { formatJam } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import {
  type BloodRequest,
  type BloodUnit,
  ISSUE_CHECKS,
  REACTION_SIGNS,
  VITALS_PLAN,
} from '@/lib/penunjang-bank-darah';
import type { BloodCheck, BloodRun } from './bank-darah-workspace';

import type { BloodBankData } from '@/lib/server/data/penunjang-lanjut';

const inputCls = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';
const labelCls = 'flex flex-col gap-1 text-small font-semibold text-ink-700';

/** Pengeluaran kantong: cek ganda dua petugas (pengeluar + penerima dari ruangan) dengan lima butir wajib. */
export function IssuePanel({
  r,
  units,
  busy,
  run,
  userName,
  userId,
  check,
  checks,
}: {
  r: BloodRequest;
  units: readonly BloodUnit[];
  busy: boolean;
  run: BloodRun;
  userName: string;
  userId: string;
  check: BloodCheck;
  checks: BloodBankData['checks'];
}) {
  const ready = r.crossmatches
    .filter((c) => c.result === 'kompatibel' && !r.issued.some((i) => i.unitId === c.unitId))
    .map((c) => units.find((u) => u.id === c.unitId))
    .filter((u): u is BloodUnit => !!u);
  const [unitId, setUnitId] = useState(ready[0]?.id ?? '');
  const [items, setItems] = useState<Record<string, boolean>>({});
  const current = ready.some((u) => u.id === unitId) ? unitId : (ready[0]?.id ?? '');
  const complete = ISSUE_CHECKS.every((c) => items[c.id]);
  const recorded = checks[`${r.id}:${current}`] ?? [];
  const checkedHere = recorded.some((c) => c.userId === userId);
  if (ready.length === 0) return null;
  return (
    <form
      aria-label="Cek ganda pengeluaran kantong"
      className="flex flex-col gap-3 rounded-[12px] border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          { type: 'keluarkan', requestId: r.id, unitId: current, first: userName, second: '', items },
          () => {
            setItems({});
          },
        );
      }}
    >
      <span className="font-semibold">Cek ganda dan pengeluaran kantong</span>
      <label className={labelCls}>
        Kantong (sudah crossmatch kompatibel)
        <select value={current} onChange={(e) => setUnitId(e.target.value)} className={inputCls}>
          {ready.map((u) => (
            <option key={u.id} value={u.id}>
              {u.bagNo} · {u.abo} Rh{u.rh === '+' ? '+' : '−'} · {u.volumeMl} mL
            </option>
          ))}
        </select>
      </label>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-small font-semibold text-ink-700">
          Butir cek ganda (dibacakan bersama)
        </legend>
        {ISSUE_CHECKS.map((c) => (
          <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={!!items[c.id]}
              onChange={(e) => setItems((s) => ({ ...s, [c.id]: e.target.checked }))}
              className="size-4 flex-none accent-brand-600"
            />
            {c.label}
          </label>
        ))}
      </fieldset>
      <p className="m-0 text-small text-ink-700">
        Pemeriksaan tercatat: {recorded.map((c) => c.name).join(' + ') || 'belum ada'}. Setiap petugas masuk
        dan mencatat pemeriksaan dari sesinya sendiri.
      </p>
      <Button
        disabled={busy || !complete || checkedHere || recorded.length >= 2}
        onClick={() => check({ requestId: r.id, unitId: current, stage: 'issue', items })}
      >
        {checkedHere ? 'Pemeriksaan Anda tercatat' : 'Catat pemeriksaan saya'}
      </Button>
      <span className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy || !current || recorded.length < 2}>
          Keluarkan kantong
        </Button>
        {!complete && (
          <span className="text-caption text-ink-500">
            Centang kelima butir, lalu dua petugas mencatat pemeriksaan dari sesi masing-masing.
          </span>
        )}
      </span>
    </form>
  );
}

/** Di samping pasien: pindai gelang + kantong. Salah pasien/kantong memblokir; manual hanya bila tak terbaca. */
export function BedsidePanel({
  r,
  units,
  busy,
  run,
  check,
  checks,
}: {
  r: BloodRequest;
  units: readonly BloodUnit[];
  busy: boolean;
  run: BloodRun;
  check: BloodCheck;
  checks: BloodBankData['checks'];
}) {
  const id = useId();
  const completed = new Set(
    (r.transfusions ?? [])
      .map((t) => t.unitId)
      .concat(r.transfusion?.finishedAt ? [r.transfusion.unitId] : []),
  );
  const issued = r.issued
    .filter((i) => !completed.has(i.unitId))
    .map((i) => units.find((u) => u.id === i.unitId))
    .filter((u): u is BloodUnit => !!u);
  const [wristband, setWristband] = useState('');
  const [bag, setBag] = useState('');
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState('');
  const [identity, setIdentity] = useState(false);
  const selectedUnit = issued.find((u) => u.bagNo === bag) ?? issued[0];
  const attestations = checks[`bedside:${r.id}:${selectedUnit?.id}:${reason.trim()}`] ?? [];
  const [v, setV] = useState({ tempC: '36,7', systolic: '118', diastolic: '74', pulse: '96' });
  const baseline = {
    tempC: Number(v.tempC.replace(',', '.')),
    systolic: Number(v.systolic),
    diastolic: Number(v.diastolic),
    pulse: Number(v.pulse),
  };
  return (
    <form
      aria-label="Verifikasi di samping pasien"
      className="flex flex-col gap-3 rounded-[12px] border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run({
          type: 'pasang',
          requestId: r.id,
          wristband,
          bag: manual ? (selectedUnit?.bagNo ?? '') : bag,
          baseline,
          ...(manual ? { manual: { reason, secondVerifier: '', identityConfirmed: identity } } : {}),
        });
      }}
    >
      <span className="font-semibold">Verifikasi di samping pasien (sebelum kantong dipasang)</span>
      <span className="text-small text-ink-700">
        Dikeluarkan: {issued.map((u) => `${u.bagNo}`).join(', ')} pukul{' '}
        {r.issued.map((i) => formatJam(i.at)).join(', ')} · cek ganda {r.issued[0]?.checkers.join(' + ')}
      </span>
      {!manual && (
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <label htmlFor={`${id}-gelang`} className="text-small font-semibold text-ink-700">
              Pindai gelang pasien (No. RM)
            </label>
            <span className="flex gap-2">
              <input
                id={`${id}-gelang`}
                value={wristband}
                onChange={(e) => setWristband(e.target.value)}
                className={cx(inputCls, 'min-w-0 flex-1 font-mono')}
              />
              <Button size="sm" onClick={() => setWristband(r.patient.rm)}>
                Pindai
              </Button>
            </span>
          </div>
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <label htmlFor={`${id}-kantong`} className="text-small font-semibold text-ink-700">
              Pindai label kantong
            </label>
            <span className="flex gap-2">
              <input
                id={`${id}-kantong`}
                value={bag}
                onChange={(e) => setBag(e.target.value)}
                className={cx(inputCls, 'min-w-0 flex-1 font-mono')}
              />
              <Button size="sm" onClick={() => setBag(issued[0]?.bagNo ?? '')}>
                Pindai
              </Button>
            </span>
          </div>
        </div>
      )}
      <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
        <legend className="mb-1 text-small font-semibold text-ink-700">TTV sebelum mulai</legend>
        {(
          [
            ['tempC', 'Suhu °C'],
            ['systolic', 'Sistolik'],
            ['diastolic', 'Diastolik'],
            ['pulse', 'Nadi'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className={cx(labelCls, 'w-28')}>
            {label}
            <input
              value={v[k]}
              inputMode="decimal"
              onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
              className={cx(inputCls, 'font-mono')}
            />
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => setManual(e.target.checked)}
          className="size-4 accent-brand-600"
        />
        Barcode tidak terbaca: verifikasi manual dua petugas (alasan tercatat)
      </label>
      {manual && (
        <div className="flex flex-col gap-2 rounded-control border border-warning-border bg-warning-bg p-3">
          <label className={labelCls}>
            Alasan (minimal 10 karakter)
            <textarea
              value={reason}
              rows={2}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
            />
          </label>
          <label className={labelCls}>
            Kantong yang diverifikasi
            <select
              className={inputCls}
              value={selectedUnit?.bagNo ?? ''}
              onChange={(e) => setBag(e.target.value)}
            >
              {issued.map((u) => (
                <option key={u.id} value={u.bagNo}>
                  {u.bagNo}
                </option>
              ))}
            </select>
          </label>
          <p className="m-0 text-small">
            Pemeriksaan manual tercatat: {attestations.map((c) => c.name).join(' + ') || 'belum ada'}. Gunakan
            alasan yang sama dari dua sesi petugas.
          </p>
          <Button
            disabled={
              busy || !identity || reason.trim().length < 10 || !selectedUnit || attestations.length >= 2
            }
            onClick={() =>
              selectedUnit &&
              check({
                requestId: r.id,
                unitId: selectedUnit.id,
                stage: 'bedside',
                items: { identitas: identity },
                reason: reason.trim(),
              })
            }
          >
            Catat verifikasi manual saya
          </Button>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={identity}
              onChange={(e) => setIdentity(e.target.checked)}
              className="size-4 accent-brand-600"
            />
            Kami berdua sudah mencocokkan nama, tanggal lahir, dan No. RM di gelang dengan label kantong
          </label>
        </div>
      )}
      <Button
        type="submit"
        variant="primary"
        className="self-start"
        disabled={busy || (manual && attestations.length < 2)}
      >
        Cocokkan dan mulai transfusi
      </Button>
    </form>
  );
}

/** Pemantauan transfusi: TTV terjadwal + gejala; tanda reaksi menghentikan transfusi. */
export function MonitorPanel({
  r,
  units,
  busy,
  run,
}: {
  r: BloodRequest;
  units: readonly BloodUnit[];
  busy: boolean;
  run: BloodRun;
}) {
  const t = r.transfusion;
  const id = useId();
  const nextLabel = VITALS_PLAN.find((l) => !t?.vitals.some((x) => x.label === l)) ?? 'Tambahan';
  const [signs, setSigns] = useState<string[]>([]);
  const [v, setV] = useState({ tempC: '36,8', systolic: '114', diastolic: '72', pulse: '90' });
  if (!t) return null;
  const unit = units.find((u) => u.id === t.unitId);
  const running = !t.finishedAt && !t.reaction;
  return (
    <section
      aria-label="Pemantauan transfusi"
      className="flex flex-col gap-3 rounded-[12px] border border-line p-3"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          Transfusi {unit?.bagNo} · mulai {formatJam(t.startedAt)}
        </span>
        <Chip tone={t.reaction ? 'danger' : t.finishedAt ? 'success' : 'info'}>
          {t.reaction
            ? 'Dihentikan · reaksi'
            : t.finishedAt
              ? `Selesai ${formatJam(t.finishedAt)}`
              : 'Berjalan'}
        </Chip>
      </span>
      <span className="text-caption text-ink-500">
        Diverifikasi {t.verifiedBy}
        {t.manualReason ? ` · verifikasi manual: “${t.manualReason}”` : ' · gelang + kantong terpindai cocok'}
      </span>
      {t.reaction && (
        <Alert level="critical" title="Dugaan reaksi transfusi">
          {t.reaction.signs.join(', ')} ({formatJam(t.reaction.at)}). Transfusi dihentikan; pertahankan jalur
          infus dengan NaCl 0,9%, laporkan ke DPJP dan bank darah, kirim kantong + sampel darah dan urine ke
          bank darah.
        </Alert>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] border-collapse text-small">
          <thead>
            <tr className="border-b border-line text-left text-caption text-ink-500">
              <th className="px-2 py-1.5">Waktu</th>
              <th className="px-2 py-1.5">Jadwal</th>
              <th className="px-2 py-1.5 text-right">Suhu</th>
              <th className="px-2 py-1.5 text-right">TD</th>
              <th className="px-2 py-1.5 text-right">Nadi</th>
            </tr>
          </thead>
          <tbody>
            {t.vitals.map((x) => (
              <tr key={`${x.label}-${x.at}`} className="border-b border-line">
                <td className="px-2 py-1.5 font-mono">{formatJam(x.at)}</td>
                <td className="px-2 py-1.5">{x.label}</td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {x.tempC.toFixed(1).replace('.', ',')} °C
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {x.systolic}/{x.diastolic}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{x.pulse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {running && (
        <form
          aria-label="Catat TTV transfusi"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              {
                type: 'ttv',
                requestId: r.id,
                label: nextLabel,
                vitals: {
                  tempC: Number(v.tempC.replace(',', '.')),
                  systolic: Number(v.systolic),
                  diastolic: Number(v.diastolic),
                  pulse: Number(v.pulse),
                },
                signs,
              },
              () => setSigns([]),
            );
          }}
        >
          <span className="text-small font-semibold text-ink-700">TTV {nextLabel}</span>
          <span className="flex flex-wrap gap-3">
            {(
              [
                ['tempC', 'Suhu °C'],
                ['systolic', 'Sistolik'],
                ['diastolic', 'Diastolik'],
                ['pulse', 'Nadi'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={cx(labelCls, 'w-28')}>
                {label}
                <input
                  value={v[k]}
                  inputMode="decimal"
                  onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
                  className={cx(inputCls, 'font-mono')}
                />
              </label>
            ))}
          </span>
          <fieldset className="m-0 flex flex-wrap gap-x-4 border-0 p-0">
            <legend className="mb-1 text-small font-semibold text-ink-700">Gejala (centang bila ada)</legend>
            {REACTION_SIGNS.map((s) => (
              <label
                key={s}
                htmlFor={`${id}-${s}`}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-small"
              >
                <input
                  id={`${id}-${s}`}
                  type="checkbox"
                  checked={signs.includes(s)}
                  onChange={(e) =>
                    setSigns((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))
                  }
                  className="size-4 accent-brand-600"
                />
                {s}
              </label>
            ))}
          </fieldset>
          <span className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Catat TTV
            </Button>
            <Button
              variant="primary"
              disabled={busy || t.vitals.length < 2}
              onClick={() => run({ type: 'selesai', requestId: r.id })}
            >
              Transfusi selesai
            </Button>
          </span>
          {t.vitals.length < 2 && (
            <span className="text-caption text-ink-500">Catat TTV 15 menit sebelum menutup transfusi.</span>
          )}
        </form>
      )}
    </section>
  );
}
