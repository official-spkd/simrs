'use client';

import { formatTanggalLahir } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { diagnosisAction } from '@/app/(staf)/klinis/diagnosis/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { formatTglJam } from '@/lib/rawat-inap';
import { hasReason } from '@/lib/rme';
import {
  activeAllergies,
  addAllergyBlocker,
  addDxBlocker,
  type AllergyEntry,
  type AllergySeverity,
  canAddToProblems,
  canEditAllergy,
  canEditDiagnosis,
  current,
  DX_RANK_LABEL,
  type DxCertainty,
  type DxRank,
  type EncounterDx,
  finalizeBlocker,
  nkdaBlocker,
  type Problem,
  type ProcedureEntry,
} from '@/lib/rme-diagnosis';
import type { DiagnosisOp } from '@/lib/rme-diagnosis-toko';
import { Feedback, type FeedbackMsg, ReasonField } from './feedback';

type Code = { code: string; display: string };

const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  ringan: 'Ringan',
  sedang: 'Sedang',
  berat: 'Berat',
};
const SELECT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';
const CARD = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5';

/**
 * K08 · Diagnosis kunjungan (ICD-10, tepat satu utama, kerja → akhir), prosedur ICD-9-CM, problem list lintas
 * kunjungan, dan alergi/NKDA. Setiap perubahan = versi baru; pembatalan = "salah entri" beralasan (tetap tampil
 * dicoret). Semua perubahan diperiksa dan disimpan server (toko demo `rekam-medis`) atas nama pengguna sesi; daftar
 * datang dari server (tampil juga di Ringkasan dan Kelengkapan).
 */
export function DiagnosisWorkspace({
  encounterId,
  role,
  today,
  icd10,
  icd9,
  dx,
  procs,
  problems,
  allergies,
  nkdaAt,
  rev,
}: {
  encounterId: string;
  role: string | null;
  /** Tanggal hari demo `YYYY-MM-DD`. */
  today: string;
  icd10: readonly Code[];
  icd9: readonly Code[];
  dx: readonly EncounterDx[];
  procs: readonly ProcedureEntry[];
  problems: readonly Problem[];
  allergies: readonly AllergyEntry[];
  nkdaAt: string | null;
  /** Revisi toko `rekam-medis`. */
  rev: number;
}) {
  const id = useId();
  const { run, pending } = useStoreAction(rev);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const [newDx, setNewDx] = useState<{ code: string; rank: DxRank; certainty: DxCertainty }>({
    code: '',
    rank: 'sekunder',
    certainty: 'kerja',
  });
  const [newProc, setNewProc] = useState('');
  const [newAllergy, setNewAllergy] = useState({
    substance: '',
    reaction: '',
    severity: 'sedang' as AllergySeverity,
  });
  const [voiding, setVoiding] = useState<{
    kind: 'dx' | 'alergi';
    id: string;
    reason: string;
    tried: boolean;
  } | null>(null);
  const [resolving, setResolving] = useState<{ id: string; date: string; note: string } | null>(null);
  const [filter, setFilter] = useState<'aktif' | 'teratasi'>('aktif');
  const canDx = canEditDiagnosis(role);
  const canAllergy = canEditAllergy(role);
  const say = (text: string, ok = true) => setMsg({ ok, text });
  /** Kirim operasi ke server; `onOk` dijalankan setelah tersimpan. */
  const send = (op: DiagnosisOp, onOk?: () => void) =>
    run(
      (r) => diagnosisAction({ encounterId, op }, r),
      (res) => {
        say(res.message, res.ok);
        if (res.ok) onOk?.();
      },
    );

  const shownDx = current(dx).sort(
    (a, b) =>
      Number(b.status === 'aktif') - Number(a.status === 'aktif') ||
      (a.rank === 'utama' ? -1 : b.rank === 'utama' ? 1 : 0),
  );
  const dxBlock = addDxBlocker(dx, newDx.code, newDx.rank);
  const finBlock = finalizeBlocker(dx);
  const shownProblems = current(problems).filter((p) => p.status === filter);
  const allergyBlock = addAllergyBlocker(allergies, newAllergy.substance, newAllergy.reaction);
  const nkdaBlock = nkdaBlocker(allergies);

  const addDx = () => {
    if (dxBlock) return say(dxBlock, false);
    send({ op: 'tambah-dx', ...newDx }, () => setNewDx({ code: '', rank: 'sekunder', certainty: 'kerja' }));
  };

  const confirmVoid = () => {
    if (!voiding) return;
    if (!hasReason(voiding.reason)) return setVoiding({ ...voiding, tried: true });
    send(
      voiding.kind === 'dx'
        ? { op: 'salah-dx', dxId: voiding.id, reason: voiding.reason }
        : { op: 'salah-alergi', allergyId: voiding.id, reason: voiding.reason },
      () => setVoiding(null),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Diagnosis kunjungan" className={cx(CARD, 'flex-[2_1_560px]')}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col">
              <h2 className="m-0 text-body font-semibold">Diagnosis kunjungan ini (ICD-10)</h2>
              <span className="text-caption text-ink-500">
                Tepat satu diagnosis utama · kode dari rujukan terminologi RS
              </span>
            </div>
            <Button
              variant="primary"
              disabled={role !== 'dokter' || !!finBlock || pending}
              aria-describedby={`${id}-fin`}
              onClick={() => send({ op: 'akhir' })}
            >
              Tetapkan diagnosis akhir
            </Button>
          </div>
          <span id={`${id}-fin`} className={cx('text-caption', finBlock ? 'text-warning' : 'text-success')}>
            {!canDx
              ? 'Diagnosis ditetapkan dokter (DPJP/residen).'
              : (finBlock ??
                (role !== 'dokter'
                  ? 'Diagnosis akhir ditetapkan DPJP (posisi dokter).'
                  : 'Siap ditetapkan sebagai diagnosis akhir.'))}
          </span>
          {shownDx.length === 0 ? (
            <p className="m-0 rounded-control bg-subtle px-3.5 py-3 text-small text-ink-700">
              Belum ada diagnosis pada kunjungan ini. Tambahkan diagnosis kerja di bawah.
            </p>
          ) : (
            <ul aria-label="Daftar diagnosis" className="m-0 flex list-none flex-col p-0">
              {shownDx.map((d) => {
                const err = d.status === 'salah-entri';
                return (
                  <li key={d.id} className="flex flex-col gap-1.5 border-b border-line-soft py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={err ? 'neutral' : d.rank === 'utama' ? 'brand' : 'neutral'}>
                        {DX_RANK_LABEL[d.rank]}
                      </Chip>
                      <span className={cx('font-mono font-semibold', err && 'line-through')}>{d.code}</span>
                      <span className={cx(err && 'text-ink-500 line-through')}>{d.display}</span>
                      <Chip tone={d.certainty === 'akhir' ? 'success' : 'warning'}>
                        {d.certainty === 'akhir' ? 'Diagnosis akhir' : 'Diagnosis kerja'}
                      </Chip>
                    </div>
                    <span className="text-caption text-ink-500">
                      {err ? `Salah entri · ${d.reason} · ` : ''}
                      {d.by} · {formatTglJam(d.at)}
                      {d.version > 1 ? ` · versi ${d.version}` : ''}
                    </span>
                    {!err && canDx && (
                      <span className="flex flex-wrap gap-2">
                        {d.rank !== 'utama' && (
                          <Button
                            size="sm"
                            aria-label={`Jadikan ${d.code} diagnosis utama`}
                            disabled={pending}
                            onClick={() => send({ op: 'utama', dxId: d.id })}
                          >
                            Jadikan utama
                          </Button>
                        )}
                        {canAddToProblems(problems, d.code) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => send({ op: 'ke-masalah', dxId: d.id }, () => setFilter('aktif'))}
                          >
                            Masukkan ke problem list
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Salah entri ${d.code}`}
                          onClick={() => setVoiding({ kind: 'dx', id: d.id, reason: '', tried: false })}
                        >
                          Salah entri
                        </Button>
                      </span>
                    )}
                    {voiding?.kind === 'dx' && voiding.id === d.id && (
                      <VoidForm
                        v={voiding}
                        onChange={setVoiding}
                        onConfirm={confirmVoid}
                        onCancel={() => setVoiding(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canDx && (
            <form
              aria-label="Tambah diagnosis"
              className="flex flex-wrap items-end gap-2 rounded-control bg-subtle p-3"
              onSubmit={(e) => {
                e.preventDefault();
                addDx();
              }}
            >
              <div className="flex min-w-0 flex-[2_1_240px] flex-col gap-1">
                <label htmlFor={`${id}-icd`} className="text-small font-semibold">
                  Kode ICD-10
                </label>
                <select
                  id={`${id}-icd`}
                  value={newDx.code}
                  onChange={(e) => setNewDx({ ...newDx, code: e.target.value })}
                  className={SELECT}
                >
                  <option value="">Pilih kode…</option>
                  {icd10.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.display}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-[1_1_130px] flex-col gap-1">
                <label htmlFor={`${id}-rank`} className="text-small font-semibold">
                  Jenis
                </label>
                <select
                  id={`${id}-rank`}
                  value={newDx.rank}
                  onChange={(e) => setNewDx({ ...newDx, rank: e.target.value as DxRank })}
                  className={SELECT}
                >
                  {(Object.keys(DX_RANK_LABEL) as DxRank[]).map((r) => (
                    <option key={r} value={r}>
                      {DX_RANK_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="primary" disabled={!newDx.code}>
                Tambahkan
              </Button>
              {newDx.code && dxBlock && (
                <span role="alert" className="basis-full text-caption font-semibold text-warning">
                  {dxBlock}
                </span>
              )}
            </form>
          )}
        </section>

        <section aria-label="Alergi" className={cx(CARD, 'flex-[1_1_320px]')}>
          <h2 className="m-0 text-body font-semibold">Alergi</h2>
          {nkdaAt && activeAllergies(allergies).length === 0 && (
            <p className="m-0 text-small font-semibold text-success">
              Tidak ada alergi yang diketahui (NKDA) · diverifikasi {formatTglJam(nkdaAt)}
            </p>
          )}
          <ul aria-label="Daftar alergi" className="m-0 flex list-none flex-col gap-2 p-0">
            {current(allergies).map((a) => {
              const err = a.status === 'salah-entri';
              return (
                <li
                  key={a.id}
                  className={cx(
                    'flex flex-col gap-1 rounded-control border px-3 py-2',
                    err ? 'border-line bg-subtle' : 'border-danger-border',
                  )}
                >
                  <span className={cx('font-semibold', err ? 'text-ink-500 line-through' : 'text-danger')}>
                    {a.substance} · {SEVERITY_LABEL[a.severity]}
                  </span>
                  <span className={cx('text-small', err && 'line-through')}>{a.reaction}</span>
                  <span className="text-caption text-ink-500">
                    {err ? `Salah entri · ${a.reason} · ` : ''}
                    {a.by} · {formatTglJam(a.at)}
                  </span>
                  {!err && canAllergy && voiding?.id !== a.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="self-start"
                      aria-label={`Salah entri alergi ${a.substance}`}
                      onClick={() => setVoiding({ kind: 'alergi', id: a.id, reason: '', tried: false })}
                    >
                      Salah entri
                    </Button>
                  )}
                  {voiding?.kind === 'alergi' && voiding.id === a.id && (
                    <VoidForm
                      v={voiding}
                      onChange={setVoiding}
                      onConfirm={confirmVoid}
                      onCancel={() => setVoiding(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {canAllergy ? (
            <form
              aria-label="Tambah alergi"
              className="flex flex-col gap-2 rounded-control bg-subtle p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (allergyBlock) return say(allergyBlock, false);
                send({ op: 'tambah-alergi', ...newAllergy }, () =>
                  setNewAllergy({ substance: '', reaction: '', severity: 'sedang' }),
                );
              }}
            >
              <label htmlFor={`${id}-zat`} className="text-small font-semibold">
                Zat/obat penyebab
              </label>
              <input
                id={`${id}-zat`}
                value={newAllergy.substance}
                onChange={(e) => setNewAllergy({ ...newAllergy, substance: e.target.value })}
                className={INPUT}
              />
              <label htmlFor={`${id}-reaksi`} className="text-small font-semibold">
                Reaksi
              </label>
              <input
                id={`${id}-reaksi`}
                value={newAllergy.reaction}
                onChange={(e) => setNewAllergy({ ...newAllergy, reaction: e.target.value })}
                className={INPUT}
              />
              <label htmlFor={`${id}-berat`} className="text-small font-semibold">
                Tingkat keparahan
              </label>
              <select
                id={`${id}-berat`}
                value={newAllergy.severity}
                onChange={(e) =>
                  setNewAllergy({ ...newAllergy, severity: e.target.value as AllergySeverity })
                }
                className={SELECT}
              >
                {(Object.keys(SEVERITY_LABEL) as AllergySeverity[]).map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>
              <span className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary">
                  Catat alergi
                </Button>
                <Button
                  disabled={!!nkdaBlock || !!nkdaAt || pending}
                  aria-describedby={nkdaBlock ? `${id}-nkda` : undefined}
                  onClick={() => send({ op: 'nkda' })}
                >
                  Verifikasi NKDA
                </Button>
              </span>
              {nkdaBlock && (
                <span id={`${id}-nkda`} className="text-caption text-ink-500">
                  {nkdaBlock}
                </span>
              )}
            </form>
          ) : (
            <span className="text-caption text-ink-500">Alergi dicatat dokter, perawat, atau bidan.</span>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Problem list" className={cx(CARD, 'flex-[2_1_560px]')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <h2 className="m-0 text-body font-semibold">Problem list (lintas kunjungan)</h2>
              <span className="text-caption text-ink-500">Masalah aktif terbawa ke kunjungan berikutnya</span>
            </div>
            <div role="group" aria-label="Filter masalah" className="flex gap-1.5">
              {(['aktif', 'teratasi'] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? 'primary' : 'secondary'}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === 'aktif' ? 'Aktif' : 'Teratasi'} (
                  {current(problems).filter((p) => p.status === f).length})
                </Button>
              ))}
            </div>
          </div>
          {shownProblems.length === 0 && (
            <p className="m-0 text-small text-ink-500">
              Tidak ada masalah {filter === 'aktif' ? 'aktif' : 'teratasi'}.
            </p>
          )}
          <ul aria-label="Daftar masalah" className="m-0 flex list-none flex-col p-0">
            {shownProblems.map((p) => (
              <li key={p.id} className="flex flex-col gap-1.5 border-b border-line-soft py-2.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{p.code}</span>
                  <span>{p.display}</span>
                  <Chip tone={p.status === 'aktif' ? 'warning' : 'success'}>
                    {p.status === 'aktif' ? 'Aktif' : 'Teratasi'}
                  </Chip>
                </span>
                <span className="text-caption text-ink-500">
                  Sejak {formatTanggalLahir(p.onset)}
                  {p.resolvedOn ? ` · teratasi ${formatTanggalLahir(p.resolvedOn)}` : ''}
                  {p.note ? ` · ${p.note}` : ''}
                  {p.version > 1 ? ` · versi ${p.version} oleh ${p.by}` : ''}
                </span>
                {p.status === 'aktif' && canDx && resolving?.id !== p.id && (
                  <Button
                    size="sm"
                    className="self-start"
                    aria-label={`Tandai ${p.code} teratasi`}
                    onClick={() => setResolving({ id: p.id, date: today, note: '' })}
                  >
                    Tandai teratasi
                  </Button>
                )}
                {resolving?.id === p.id && (
                  <form
                    aria-label={`Masalah ${p.code} teratasi`}
                    className="flex flex-wrap items-end gap-2 rounded-control bg-subtle p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send(
                        { op: 'teratasi', problemId: p.id, date: resolving.date, note: resolving.note },
                        () => setResolving(null),
                      );
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${id}-tgl`} className="text-small font-semibold">
                        Tanggal teratasi
                      </label>
                      <input
                        id={`${id}-tgl`}
                        type="date"
                        max={today}
                        value={resolving.date}
                        required
                        onChange={(e) => setResolving({ ...resolving, date: e.target.value })}
                        className={INPUT}
                      />
                    </div>
                    <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
                      <label htmlFor={`${id}-cat`} className="text-small font-semibold">
                        Catatan
                      </label>
                      <input
                        id={`${id}-cat`}
                        value={resolving.note}
                        onChange={(e) => setResolving({ ...resolving, note: e.target.value })}
                        className={INPUT}
                      />
                    </div>
                    <Button type="submit" variant="primary">
                      Simpan
                    </Button>
                    <Button onClick={() => setResolving(null)}>Batal</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Prosedur" className={cx(CARD, 'flex-[1_1_320px]')}>
          <h2 className="m-0 text-body font-semibold">Prosedur (ICD-9-CM)</h2>
          {procs.length === 0 && (
            <p className="m-0 text-small text-ink-500">Belum ada prosedur pada kunjungan ini.</p>
          )}
          <ul aria-label="Daftar prosedur" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {procs.map((p) => (
              <li key={p.id} className="flex flex-col text-small">
                <span>
                  <span className="font-mono font-semibold">{p.code}</span> {p.display}
                </span>
                <span className="text-caption text-ink-500">
                  {p.by} · {formatTglJam(p.at)}
                </span>
              </li>
            ))}
          </ul>
          {canDx && (
            <form
              aria-label="Tambah prosedur"
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const c = icd9.find((x) => x.code === newProc);
                if (!c) return;
                send({ op: 'tambah-prosedur', code: c.code }, () => setNewProc(''));
              }}
            >
              <label htmlFor={`${id}-icd9`} className="text-small font-semibold">
                Kode ICD-9-CM
              </label>
              <select
                id={`${id}-icd9`}
                value={newProc}
                onChange={(e) => setNewProc(e.target.value)}
                className={SELECT}
              >
                <option value="">Pilih kode…</option>
                {icd9.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.display}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={!newProc} className="self-start">
                Tambahkan prosedur
              </Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function VoidForm({
  v,
  onChange,
  onConfirm,
  onCancel,
}: {
  v: { kind: 'dx' | 'alergi'; id: string; reason: string; tried: boolean };
  onChange: (v: { kind: 'dx' | 'alergi'; id: string; reason: string; tried: boolean }) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      aria-label="Tandai salah entri"
      className="flex flex-col gap-2 rounded-control border border-warning-border bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <ReasonField
        label="Alasan salah entri"
        value={v.reason}
        onChange={(reason) => onChange({ ...v, reason })}
        showError={v.tried}
        hint="Entri tidak dihapus: tetap tampil dicoret dan tercatat di jejak audit."
      />
      <span className="flex gap-2">
        <Button type="submit" variant="danger">
          Tandai salah entri
        </Button>
        <Button onClick={onCancel}>Batal</Button>
      </span>
    </form>
  );
}
