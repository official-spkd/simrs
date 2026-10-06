'use client';

import { formatJam } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx, Field, RadioSegmented } from '@simrs/ui';
import { useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import {
  ActivityLog,
  type ConfirmRequest,
  ConfirmDialog,
  FlowSteps,
  Panel,
  Stamp,
  TableWrap,
  TD,
  TH,
} from '@/components/platform/parts';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import {
  backlogTotal,
  CAUSE_LABEL,
  canDo,
  type DowntimeAction,
  type DowntimeCause,
  incidentSummary,
  MAX_OFFLINE,
  type PaperForm,
  STAGES,
} from '@/lib/operasional-downtime';
import type { DowntimeStoreState } from '@/lib/operasional-downtime-toko';

const BASE = Date.parse(DEMO_NOW);
const jam = (min: number | null) => (min === null ? '–' : formatJam(new Date(BASE + min * 60_000)));

interface Pack {
  ward: string;
  patients: number;
  forms: readonly string[];
  sample: string;
}

/**
 * P13 · Latihan/penanganan downtime: aktifkan (alasan wajib, berkonfirmasi), cetak paket darurat, pendaftaran tetap
 * jalan di server edge, nyatakan pulih, masukkan entri susulan dari formulir kertas, sinkronkan antrean kirim per
 * batch sampai nol, lalu ringkasan insiden (lama gangguan, pemulihan, data hilang). Keadaan dan log insiden tersimpan
 * di toko demo bersama (domain `downtime`) atas nama pengguna sesi; banner downtime tampil di layar lain.
 */
export function DowntimeBoard({
  forms,
  pack,
  operator,
  state,
  rev,
}: {
  forms: PaperForm[];
  pack: Pack;
  operator: string;
  state: DowntimeStoreState;
  rev: number;
}) {
  const s = state.s;
  const [cause, setCause] = useState<DowntimeCause>('bpjs');
  const [reason, setReason] = useState('');
  const [backReason, setBackReason] = useState('Downtime layanan, dicatat di formulir kertas darurat');
  const [confirm, setConfirm] = useState<'activate' | 'recover' | null>(null);
  const { dispatch, pending, error } = useDemoDispatch('downtime', rev);
  const log = state.log.map((l) => ({ t: jam(l.clock), text: `${l.text} · ${l.by}` }));
  const printedBy = state.log.find((l) => l.text.startsWith('Paket cetak darurat'))?.by ?? operator;

  const act = (a: DowntimeAction) => {
    if (pending || !canDo(s, a, forms).ok) return;
    dispatch(a);
  };
  const total = backlogTotal(s.backlog);
  const activateCheck = canDo(s, { type: 'activate', cause, reason }, forms);
  const recoverCheck = canDo(s, { type: 'recover' }, forms);
  const syncCheck = canDo(s, { type: 'sync' }, forms);
  const backCheck = (id: string) => canDo(s, { type: 'back-entry', id, reason: backReason }, forms);
  const summary = incidentSummary(s);
  const down = s.stage === 1;

  const services: Array<[string, string, ChipTone]> = [
    [
      'BPJS VClaim & Antrean',
      down && s.cause === 'bpjs' ? 'Tidak menjawab' : 'Normal',
      down && s.cause === 'bpjs' ? 'danger' : 'success',
    ],
    [
      'Koneksi ke server pusat',
      down && s.cause === 'jaringan' ? 'Putus · edge mengambil alih' : 'Normal',
      down && s.cause === 'jaringan' ? 'danger' : 'success',
    ],
    [
      'Server edge lokal',
      down ? 'Melayani baca + pendaftaran' : 'Siaga · tersinkron',
      down ? 'warning' : 'success',
    ],
    ['SATUSEHAT', down ? 'Kiriman ditahan di antrean' : 'Normal', down ? 'warning' : 'success'],
  ];

  const request: ConfirmRequest | null =
    confirm === 'activate'
      ? {
          title: 'Aktifkan mode downtime?',
          body: (
            <>
              Semua pengguna melihat banner downtime. {CAUSE_LABEL[cause]}: kiriman ke luar ditahan di antrean
              server edge dan dikirim ulang setelah pulih. Tercatat di log insiden.
            </>
          ),
          confirmLabel: 'Ya, aktifkan',
          danger: true,
        }
      : confirm === 'recover'
        ? {
            title: 'Nyatakan layanan pulih?',
            body: (
              <>
                Banner downtime ditutup. Formulir kertas selama gangguan wajib dimasukkan sebagai entri
                susulan.
              </>
            ),
            confirmLabel: 'Ya, layanan pulih',
          }
        : null;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert level="warning" title="Aksi ditolak">
          {error}
        </Alert>
      )}
      <FlowSteps
        label="Tahap downtime"
        steps={STAGES.map((label) => ({ label }))}
        current={s.stage === 4 ? 5 : s.stage}
      />

      <div className="flex flex-wrap items-start gap-4">
        <Panel className="flex-[1_1_360px]" title="Status layanan" sub={`Jam ${jam(s.clock)}`}>
          <TableWrap label="Status layanan">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Layanan
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.map(([name, text, tone]) => (
                  <tr key={name}>
                    <td className={TD}>{name}</td>
                    <td className={TD}>
                      <Chip tone={tone}>{text}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
        <Panel
          className="flex-[1_1_360px]"
          title="Antrean kirim tertunda"
          sub={total ? `${total} pesan · disimpan di server edge, dikirim ulang setelah pulih` : 'Kosong'}
        >
          <div
            role="meter"
            aria-label="Sisa antrean kirim"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, s.peak)}
            aria-valuenow={total}
            className="h-2.5 overflow-hidden rounded-full bg-line-soft"
          >
            <div
              className={cx('h-full rounded-full', total ? 'bg-warning' : 'bg-success')}
              style={{ width: `${s.peak ? (total / s.peak) * 100 : 0}%` }}
            />
          </div>
          <dl className="m-0 grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1 text-small">
            <dt>SEP / jaminan BPJS</dt>
            <dd className="m-0 text-right font-mono">{s.backlog.sep}</dd>
            <dt>Task ID antrean BPJS</dt>
            <dd className="m-0 text-right font-mono">{s.backlog.task}</dd>
            <dt>SATUSEHAT</dt>
            <dd className="m-0 text-right font-mono">{s.backlog.satusehat}</dd>
          </dl>
          {s.syncLog.length > 0 && (
            <ActivityLog
              label="Batch sinkron"
              items={[...s.syncLog]
                .reverse()
                .map((b) => ({ t: jam(b.at), text: `Batch terkirim · ${b.sent} pesan, sisa ${b.left}` }))}
            />
          )}
        </Panel>
      </div>

      {s.stage === 0 && (
        <Panel
          title="Aktifkan mode downtime"
          sub="Saat layanan luar atau jaringan mati; juga untuk latihan di tenant latihan"
        >
          <RadioSegmented
            label="Penyebab"
            items={[
              { id: 'bpjs', label: CAUSE_LABEL.bpjs },
              { id: 'jaringan', label: CAUSE_LABEL.jaringan },
            ]}
            value={cause}
            onChange={(v) => setCause(v as DowntimeCause)}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-small font-semibold text-ink-700">
              Alasan dan dampak (tercatat di log insiden)
            </span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. VClaim timeout sejak 10.40, SEP tidak bisa terbit"
              className="rounded-control border border-line-strong p-2.5 font-[inherit]"
            />
          </label>
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="danger"
              disabled={!activateCheck.ok}
              aria-describedby={!activateCheck.ok ? 'dt-alasan' : undefined}
              onClick={() => setConfirm('activate')}
            >
              Aktifkan mode downtime
            </Button>
            {!activateCheck.ok && (
              <span id="dt-alasan" className="text-caption text-ink-500">
                {activateCheck.reason}
              </span>
            )}
          </span>
        </Panel>
      )}

      {s.stage === 1 && (
        <>
          <Alert level="critical" title={`Mode downtime aktif sejak ${jam(s.startedAt)}`}>
            {s.cause === 'bpjs'
              ? 'Pendaftaran tetap jalan; SEP diganti surat jaminan sementara dan dikirim ulang setelah BPJS pulih.'
              : 'Server edge melayani baca dan pendaftaran; tulis klinis memakai formulir kertas darurat.'}{' '}
            Alasan: {s.reason}
          </Alert>
          <div className="flex flex-wrap items-start gap-4">
            <Panel
              className="flex-[1_1_360px]"
              title={`Paket cetak darurat · ${pack.ward}`}
              sub="Disiapkan otomatis tiap 4 jam di server edge"
            >
              <ul className="m-0 pl-5 text-small">
                {pack.forms.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {s.printedAt !== null ? (
                <>
                  <div className="rounded-control border border-dashed border-line-strong bg-canvas p-2.5 text-small">
                    <b>
                      {pack.ward.toUpperCase()} · {pack.patients} pasien
                    </b>{' '}
                    · {pack.sample}
                    <div className="mt-1.5 font-semibold text-danger">
                      DICETAK {jam(s.printedAt)} OLEH {printedBy.toUpperCase()} · RAHASIA · tercatat audit
                    </div>
                  </div>
                  <span role="status">
                    <Stamp>Paket dicetak · {jam(s.printedAt)}</Stamp>
                  </span>
                </>
              ) : (
                <span>
                  <Button variant="primary" disabled={pending} onClick={() => act({ type: 'print' })}>
                    Cetak paket darurat
                  </Button>
                </span>
              )}
            </Panel>
            <Panel
              className="flex-[1_1_360px]"
              title="Pendaftaran tetap berjalan"
              sub="Nomor kunjungan dari blok nomor yang disewakan ke edge"
            >
              <p className="m-0 text-small">{s.offlineRegistrations} pasien didaftarkan selama downtime.</p>
              <span className="flex flex-wrap gap-2">
                <Button
                  disabled={s.offlineRegistrations >= MAX_OFFLINE || pending}
                  onClick={() => act({ type: 'offline-registration' })}
                >
                  Daftarkan pasien (offline)
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => act({ type: 'tick' })}>
                  Waktu berjalan 15 menit
                </Button>
              </span>
              <hr className="m-0 border-line" />
              <span className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={!recoverCheck.ok || pending}
                  aria-describedby={!recoverCheck.ok ? 'dt-pulih' : undefined}
                  onClick={() => setConfirm('recover')}
                >
                  Layanan pulih · akhiri downtime
                </Button>
                {!recoverCheck.ok && (
                  <span id="dt-pulih" className="text-caption font-medium text-warning">
                    {recoverCheck.reason}
                  </span>
                )}
              </span>
            </Panel>
          </div>
        </>
      )}

      {s.stage === 2 && (
        <Panel
          title="Entri susulan dari formulir kertas"
          sub={`Pulih ${jam(s.recoveredAt)} · ${forms.filter((f) => s.backEntries[f.id] === undefined).length} formulir belum dimasukkan`}
        >
          <Field
            label="Alasan entri susulan (berlaku untuk semua baris)"
            value={backReason}
            onChange={(e) => setBackReason(e.target.value)}
            hint="Minimal 10 huruf · tercatat sebagai entri susulan dengan waktu klinis asli"
            hintTone="muted"
          />
          <TableWrap label="Formulir kertas selama downtime">
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr>
                  {['Formulir', 'Pasien', 'Waktu klinis', 'Pencatat', 'Entri'].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forms.map((f) => {
                  const done = s.backEntries[f.id];
                  const check = backCheck(f.id);
                  return (
                    <tr key={f.id}>
                      <td className={TD}>{f.form}</td>
                      <td className={TD}>{f.patient}</td>
                      <td className={cx(TD, 'font-mono')}>{jam((s.startedAt ?? 0) + f.offset)}</td>
                      <td className={TD}>{f.by}</td>
                      <td className={TD}>
                        {done !== undefined ? (
                          <span className="flex flex-col gap-0.5">
                            <Chip tone="info">Entri susulan</Chip>
                            <span className="text-caption text-ink-500">dicatat {jam(done)}</span>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            disabled={!check.ok || pending}
                            onClick={() => act({ type: 'back-entry', id: f.id, reason: backReason })}
                          >
                            Masukkan
                            <span className="sr-only">
                              {' '}
                              {f.form} {f.patient}
                            </span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!syncCheck.ok || pending}
              aria-describedby={!syncCheck.ok ? 'dt-sync' : undefined}
              onClick={() => act({ type: 'sync' })}
            >
              Mulai sinkronisasi antrean
            </Button>
            {!syncCheck.ok && (
              <span id="dt-sync" className="text-caption font-medium text-warning">
                {syncCheck.reason}
              </span>
            )}
          </span>
        </Panel>
      )}

      {s.stage === 3 && (
        <Panel
          title="Sinkronisasi antrean kirim"
          sub="Dikirim per batch 12 pesan, berurutan, dengan kunci idempoten"
        >
          <span>
            <Button variant="primary" disabled={pending} onClick={() => act({ type: 'sync' })}>
              Kirim batch berikutnya (sisa {total})
            </Button>
          </span>
        </Panel>
      )}

      {s.stage === 4 && summary && (
        <Panel title="Ringkasan insiden" sub="Evaluasi pasca downtime (MRMIK 13.1c)" tone="success">
          <Alert level="success" title="Downtime selesai · antrean kirim kosong">
            Lama gangguan {summary.outageMinutes} menit · pemulihan {summary.recoveryMinutes} menit setelah
            pulih · {summary.messagesSynced} pesan tersinkron · data hilang {summary.dataLost} (RPO 0).
          </Alert>
          <span>
            <Button disabled={pending} onClick={() => act({ type: 'reset' })}>
              Mulai latihan baru
            </Button>
          </span>
        </Panel>
      )}

      <Panel title="Log insiden" sub="Tercatat di jejak audit">
        {log.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Belum ada kejadian. Sistem berjalan normal.</p>
        ) : (
          <ActivityLog label="Log insiden downtime" items={log} />
        )}
      </Panel>

      <ConfirmDialog
        request={request}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === 'activate') act({ type: 'activate', cause, reason });
          if (confirm === 'recover') act({ type: 'recover' });
        }}
      />
    </div>
  );
}
