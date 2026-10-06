'use client';

import { formatJam, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx, KpiCard } from '@simrs/ui';
import { useEffect, useRef, useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import type { BackupStoreState } from '@/lib/operasional-backup-toko';
import {
  ActivityLog,
  type ConfirmRequest,
  ConfirmDialog,
  Panel,
  Stamp,
  TableWrap,
  TD,
  TH,
} from '@/components/platform/parts';
import { DEMO_NOW, demoNow } from '@/lib/demo/fixtures/waktu';
import {
  locationStale,
  RESTORE_STEPS,
  restorePassed,
  restoreTestStale,
  RETENTION_LABEL,
  RETENTION_LIMIT,
  type RetentionClass,
  RTO_TARGET_MINUTES,
  RUN_LABEL,
} from '@/lib/operasional-backup';

const nf = new Intl.NumberFormat('id-ID');
const CLASSES = Object.keys(RETENTION_LIMIT) as RetentionClass[];

/**
 * Fase 10 · Cadangan dan pemulihan (ADR-0071): status tiga lokasi + retensi, riwayat run, backup manual
 * berkonfirmasi + alasan, dan uji restore langkah demi langkah ke database bersih (bisa disimulasikan kunci salah)
 * sampai jumlah baris cocok dengan manifest dan RTO terukur. Tersimpan di toko demo bersama (domain `cadangan`) atas
 * nama pengguna sesi.
 */
export function CadanganBoard({
  state,
  rev,
  manifest,
}: {
  state: BackupStoreState;
  rev: number;
  manifest: Array<readonly [string, number]>;
}) {
  const locs = state.locations;
  const history = state.runs;
  const restore = state.restore;
  const restoreLog = [...state.restoreLog];
  const test = state.lastTest;
  const lastTest = state.lastTest;
  const { dispatch, pending, error } = useDemoDispatch('cadangan', rev);
  const [running, setRunning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [wrongKeyDraft, setWrongKey] = useState(false);
  const wrongKey = restore.next > 0 || restore.failedAt !== null ? state.wrongKey : wrongKeyDraft;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const now = new Date(DEMO_NOW);
  const stale = locs.filter((l) => locationStale(l, now));
  const passed = restorePassed(restore);
  const started = restore.next > 0 || restore.failedAt !== null;

  const runManual = (reason: string) => {
    const t0 = demoNow();
    setRunning(formatJam(t0));
    setFlash(`Backup manual berjalan sejak ${formatJam(t0)} · ${reason}`);
    timers.current.push(
      window.setTimeout(() => {
        const t1 = demoNow();
        dispatch({ type: 'backup.manual', reason, at: t1.toISOString(), jam: formatJam(t1) }, (ok) => {
          setRunning(null);
          setFlash(
            ok
              ? `Backup manual selesai · ${formatJam(t1)} · tersimpan di 3 lokasi, manifest berisi hash + jumlah baris`
              : null,
          );
        });
      }, 1200),
    );
  };

  const nextStep = () => {
    const now = demoNow();
    dispatch({ type: 'restore.langkah', wrongKey, at: now.toISOString(), jam: formatJam(now) });
  };

  const request: ConfirmRequest | null = confirming
    ? {
        title: 'Jalankan backup manual sekarang?',
        body: (
          <>
            Backup lengkap terenkripsi ke tiga lokasi di luar jadwal. Salinan manual disimpan maksimal{' '}
            {RETENTION_LIMIT.manual}; yang tertua dibuang retensi.
          </>
        ),
        confirmLabel: 'Ya, jalankan backup',
        reasonLabel: 'Alasan backup manual',
        reasonPlaceholder: 'mis. sebelum migrasi data tarif',
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Ringkasan cadangan" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="RPO"
          value="≤ 1 jam"
          detail={`backup terakhir ${formatJam(history[0]?.at ?? DEMO_NOW)}`}
          tone="success"
        />
        <KpiCard
          label="RTO uji terakhir"
          value={`${test.rtoMinutes} menit`}
          hint={`target ≤ ${RTO_TARGET_MINUTES / 60} jam`}
          detail={formatTanggalWaktu(test.at)}
          tone={test.rtoMinutes <= RTO_TARGET_MINUTES ? 'success' : 'danger'}
        />
        <KpiCard
          label="Lokasi berhasil"
          value={`${locs.length - stale.length}/${locs.length}`}
          hint={stale.length ? `${stale.length} terlambat` : 'edge · cloud · offsite'}
          tone={stale.length ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Uji restore"
          value={restoreTestStale(test.at, now) ? 'Terlambat' : 'Terjadwal'}
          detail="mingguan Minggu 03.00 + bulanan dari offsite"
        />
      </div>

      <Panel
        title="Cadangan terenkripsi · tiga lokasi"
        sub="Dienkripsi sebelum keluar server; kunci privat dipegang dua orang terpisah"
        actions={
          <Button size="sm" disabled={!!running} onClick={() => setConfirming(true)}>
            Jalankan backup manual
          </Button>
        }
      >
        <TableWrap label="Lokasi cadangan">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                {['Lokasi', 'Jadwal', 'Terakhir berhasil', 'Ukuran', 'Retensi tersimpan', 'Status'].map(
                  (h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {locs.map((l) => {
                const late = locationStale(l, now);
                return (
                  <tr key={l.id}>
                    <td className={TD}>
                      <span className="font-medium">{l.label}</span>
                      <span className="block text-caption text-ink-500">{l.where}</span>
                    </td>
                    <td className={TD}>{l.schedule}</td>
                    <td className={cx(TD, 'font-mono')}>{formatJam(l.lastOkAt)}</td>
                    <td className={TD}>{l.sizeLabel}</td>
                    <td className={cx(TD, 'text-caption')}>
                      {CLASSES.map((c) => (
                        <span key={c} className="block">
                          {RETENTION_LABEL[c]} {l.kept[c]}/{RETENTION_LIMIT[c]}
                        </span>
                      ))}
                    </td>
                    <td className={TD}>
                      <Chip tone={late ? 'danger' : 'success'}>
                        {late ? 'Terlambat' : 'Berhasil · terenkripsi'}
                      </Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        {running && <Chip tone="info">Backup manual berjalan sejak {running}</Chip>}
        {(flash || error) && (
          <span role="status">
            <Stamp tone={error ? 'danger' : running ? 'info' : 'success'}>{error ?? flash}</Stamp>
          </span>
        )}
        <ul aria-label="Riwayat backup" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {history.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-small">
              <span className="w-[150px] font-mono text-ink-700">
                {formatTanggalWaktu(r.at).split(', ')[1]}
              </span>
              <Chip tone={r.status === 'success' ? 'success' : r.status === 'partial' ? 'warning' : 'danger'}>
                {RUN_LABEL[r.status]}
              </Chip>
              <Chip tone="neutral">{RETENTION_LABEL[r.kind]}</Chip>
              <span className="min-w-0 flex-1 text-ink-700">{r.note}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        <Panel
          className="flex-[2_1_440px]"
          title="Uji restore ke database bersih"
          sub={`Terakhir lulus ${formatTanggalWaktu(lastTest.at)} dari ${lastTest.source} · RTO ${lastTest.rtoMinutes} menit`}
          tone={restore.failedAt !== null ? 'danger' : passed ? 'success' : undefined}
          actions={
            started ? (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  setWrongKey(false);
                  dispatch({ type: 'restore.ulang', jam: formatJam(demoNow()) });
                }}
              >
                Ulang uji
              </Button>
            ) : undefined
          }
        >
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              className="size-5 accent-brand-600"
              checked={wrongKey}
              disabled={started}
              onChange={(e) => setWrongKey(e.target.checked)}
            />
            Simulasikan kunci privat yang salah
          </label>
          <ol aria-label="Langkah uji restore" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {RESTORE_STEPS.map((st, i) => {
              const state =
                restore.failedAt === i
                  ? 'gagal'
                  : i < restore.next
                    ? 'lulus'
                    : i === restore.next && restore.failedAt === null
                      ? 'berikutnya'
                      : 'menunggu';
              return (
                <li
                  key={st.id}
                  aria-current={state === 'berikutnya' ? 'step' : undefined}
                  className={cx(
                    'flex flex-wrap items-center gap-2 rounded-control border px-3 py-2',
                    state === 'gagal'
                      ? 'border-koral-200 bg-danger-bg'
                      : state === 'berikutnya'
                        ? 'border-brand-600'
                        : 'border-line',
                  )}
                >
                  <span className="w-6 font-mono text-ink-500">{i + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-small font-semibold">{st.label}</span>
                    <span className="text-caption text-ink-500">{st.detail}</span>
                  </span>
                  <Chip
                    tone={
                      state === 'lulus'
                        ? 'success'
                        : state === 'gagal'
                          ? 'danger'
                          : state === 'berikutnya'
                            ? 'brand'
                            : 'neutral'
                    }
                  >
                    {state === 'lulus'
                      ? 'Lulus'
                      : state === 'gagal'
                        ? 'Gagal'
                        : state === 'berikutnya'
                          ? 'Berikutnya'
                          : 'Menunggu'}
                  </Chip>
                </li>
              );
            })}
          </ol>
          {restore.failedAt !== null && (
            <Alert level="critical" title="Uji restore gagal (gagal aman)">
              {restore.failReason}
            </Alert>
          )}
          {!passed && restore.failedAt === null && (
            <span>
              <Button variant="primary" disabled={pending} onClick={nextStep}>
                {started ? `Jalankan langkah ${restore.next + 1}` : 'Mulai uji restore'}
              </Button>
            </span>
          )}
          {passed && (
            <>
              <TableWrap label="Jumlah baris manifest dan hasil pulih">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Tabel
                      </th>
                      <th scope="col" className={cx(TH, 'text-right')}>
                        Manifest
                      </th>
                      <th scope="col" className={cx(TH, 'text-right')}>
                        Hasil pulih
                      </th>
                      <th scope="col" className={TH}>
                        Cocok
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {manifest.map(([name, n]) => (
                      <tr key={name}>
                        <td className={TD}>{name}</td>
                        <td className={cx(TD, 'text-right font-mono')}>{nf.format(n)}</td>
                        <td className={cx(TD, 'text-right font-mono')}>{nf.format(n)}</td>
                        <td className={TD}>
                          <Chip tone="success">sama</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <Alert level="success" title="Uji restore lulus">
                Data pulih utuh di mesin bersih, rantai audit sama dengan manifest, layanan siap. RTO{' '}
                {restore.minutes} menit (target ≤ {RTO_TARGET_MINUTES / 60} jam).
              </Alert>
            </>
          )}
        </Panel>
        <Panel className="flex-[1_1_280px]" title="Log uji restore" sub="Dicatat ke riwayat uji restore">
          {restoreLog.length === 0 ? (
            <p className="m-0 text-small text-ink-500">Belum ada uji di sesi ini.</p>
          ) : (
            <ActivityLog label="Log uji restore" items={restoreLog} />
          )}
        </Panel>
      </div>
      <ConfirmDialog request={request} onClose={() => setConfirming(false)} onConfirm={runManual} />
    </div>
  );
}
