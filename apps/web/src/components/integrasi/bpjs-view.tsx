'use client';

import { formatJam } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { bpjsAction } from '@/app/(staf)/sistem/integrasi/bpjs/actions';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  aplicareDiffs,
  type BookingTasks,
  type BpjsServiceId,
  downtimeGate,
  hfisMismatch,
  type PendingTx,
  resendInOrder,
  serviceStatus,
  serviceTotals,
  syncOrder,
  TASK_LABEL,
  taskOrderGate,
} from '@/lib/integrasi-bpjs';
import { formatLatency, formatNumber } from '@/lib/manajemen';
import type { BpjsData } from '@/lib/server/data/integrasi-lanjut';

const STATUS = {
  normal: { label: 'Normal', tone: 'success' },
  lambat: { label: 'Lambat', tone: 'warning' },
  gangguan: { label: 'Gangguan', tone: 'danger' },
} as const;

/**
 * I03 · Konektor BPJS: kartu VClaim, Antrean, Aplicare, HFIS (volume, latensi, gangguan), detail per layanan (task ID
 * berurutan, ketersediaan kamar, jadwal dokter), dan mode downtime dengan alasan + sinkron berurutan saat pulih.
 */
export function BpjsView({ data, userName }: { data: BpjsData; userName: string }) {
  const [svc, setSvc] = useState<BpjsServiceId>('antrean');
  const [bookings, setBookings] = useState<BookingTasks[]>(data.bookings);
  const [beds, setBeds] = useState(data.beds);
  const [lastSync, setLastSync] = useState(data.aplicareLastSync);
  const [hfis, setHfis] = useState(data.hfis);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [down, setDown] = useState<{ since: string; reason: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [backlog, setBacklog] = useState<PendingTx[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const service = data.services.find((s) => s.id === svc);

  const act = (payload: Parameters<typeof bpjsAction>[0], apply: () => void) =>
    startTransition(async () => {
      const r = await bpjsAction(payload);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) apply();
    });

  const addPending = (kind: PendingTx['kind'], label: string) =>
    setBacklog((cur) => [...cur, { at: formatJam(demoNow()), kind, label }]);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Mode downtime BPJS"
        className={cx(
          'flex flex-col gap-2 rounded-card border px-4 py-3',
          down ? 'border-warning-border bg-warning-bg' : 'border-line bg-white',
        )}
      >
        {down ? (
          <>
            <span className="font-semibold text-warning">
              Mode downtime BPJS aktif sejak {down.since} · {down.reason}
            </span>
            <span className="text-small text-ink-700">
              Pelayanan tetap jalan: SEP dibuat lokal (nomor menyusul), task ID dan Aplicare diantre dengan
              kunci idempotensi. Tertunda: <span className="font-mono font-semibold">{backlog.length}</span>
            </span>
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => addPending('SEP', `SEP susulan pasien ke-${backlog.length + 1}`)}
              >
                Catat pendaftaran BPJS (SEP ditunda)
              </Button>
              <Button
                size="sm"
                onClick={() => addPending('Task ID', `Task 3 booking ke-${backlog.length + 1}`)}
              >
                Catat task ID tertunda
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  act({ kind: 'downtime-akhiri', backlog: backlog.length }, () => {
                    const order = syncOrder(backlog);
                    setDown(null);
                    setBacklog([]);
                    setMsg((m) => ({
                      ok: true,
                      text: `${m?.text ?? ''}${order.length ? ` Urutan: ${order.map((o) => `${o.at} ${o.label}`).join(' → ')}.` : ''}`,
                    }));
                  })
                }
              >
                Pulihkan & sinkronkan
              </Button>
            </span>
          </>
        ) : asking ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const err = downtimeGate(reason);
              if (err) return setMsg({ ok: false, text: err });
              act({ kind: 'downtime-mulai', reason }, () => {
                setDown({ since: formatJam(demoNow()), reason: reason.trim() });
                setAsking(false);
                setReason('');
              });
            }}
          >
            <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
              Alasan mode downtime (wajib, minimal 10 karakter; tercatat atas nama {userName})
              <input
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] font-normal"
              />
            </label>
            <span className="flex gap-2">
              <Button type="submit" variant="danger" disabled={pending}>
                Aktifkan mode downtime
              </Button>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                Batal
              </Button>
            </span>
          </form>
        ) : (
          <span className="flex flex-wrap items-center justify-between gap-2 text-small text-ink-700">
            Semua layanan BPJS online. Bila BPJS terganggu, aktifkan mode downtime agar pelayanan tidak
            berhenti.
            <Button onClick={() => setAsking(true)}>Mode downtime BPJS</Button>
          </span>
        )}
      </section>

      {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}

      <section aria-label="Layanan BPJS" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.services.map((s) => {
          const st = down ? null : serviceStatus(s);
          const t = serviceTotals(s);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === svc}
              onClick={() => setSvc(s.id)}
              className={cx(
                'flex cursor-pointer flex-col gap-1.5 rounded-card border bg-white p-3.5 text-left font-[inherit]',
                s.id === svc ? 'border-brand-600 shadow-[0_0_0_1px_var(--color-brand-600)]' : 'border-line',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{s.name}</span>
                {st ? (
                  <Chip tone={STATUS[st].tone}>{STATUS[st].label}</Chip>
                ) : (
                  <Chip tone="warning">Antre lokal</Chip>
                )}
              </span>
              <span className="text-caption text-ink-500">{s.protocol}</span>
              <span className="flex flex-wrap gap-x-3 text-small">
                <span>
                  Hari ini <b className="font-mono">{formatNumber(t.volume)}</b>
                </span>
                <span>
                  p95 <b className="font-mono">{formatLatency(t.p95Ms)}</b>
                </span>
                <span className={t.failed ? 'text-danger' : ''}>
                  Gagal <b className="font-mono">{t.failed}</b>
                </span>
              </span>
            </button>
          );
        })}
      </section>

      {service && (
        <section
          aria-label={`Detail ${service.name}`}
          className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
        >
          <span className="flex flex-col">
            <h2 className="m-0 text-h2 font-semibold">{service.name}</h2>
            <span className="text-caption text-ink-500">Kebijakan kirim: {service.retry}</span>
            {service.lastError && (
              <span className="text-small text-danger">Galat terakhir: {service.lastError}</span>
            )}
          </span>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-small">
              <caption className="sr-only">Operasi {service.name} hari ini</caption>
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-500">
                  <th className="px-2 py-1.5">Operasi</th>
                  <th className="px-2 py-1.5 text-right">Volume</th>
                  <th className="px-2 py-1.5 text-right">Gagal</th>
                  <th className="px-2 py-1.5 text-right">Latensi p95</th>
                </tr>
              </thead>
              <tbody>
                {service.ops.map((o) => (
                  <tr key={o.name} className="border-b border-line">
                    <td className="px-2 py-1.5">{o.name}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{formatNumber(o.count)}</td>
                    <td className={cx('px-2 py-1.5 text-right font-mono', o.failed > 0 && 'text-danger')}>
                      {o.failed}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{formatLatency(o.p95Ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {svc === 'antrean' && (
            <div className="flex flex-col gap-2">
              <span className="font-semibold">Task ID per kode booking (urutan 1–7 wajib)</span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {bookings.map((b) => {
                  const failed = Object.entries(b.tasks).find(([, t]) => t.status === 'gagal');
                  const blockedBy = failed ? taskOrderGate(b, Number(failed[0])) : null;
                  return (
                    <li
                      key={b.bookingCode}
                      className="flex flex-col gap-2 rounded-control border border-line p-3 text-small"
                    >
                      <span className="flex flex-wrap justify-between gap-2">
                        <span className="font-semibold">
                          <span className="font-mono">{b.bookingCode}</span> · {b.patient}
                        </span>
                        <span className="text-ink-500">{b.poli}</span>
                      </span>
                      <ol
                        aria-label={`Task ID booking ${b.bookingCode}`}
                        className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                      >
                        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                          const t = b.tasks[n];
                          const tone =
                            t?.status === 'terkirim'
                              ? 'success'
                              : t?.status === 'gagal'
                                ? 'danger'
                                : 'neutral';
                          return (
                            <li key={n}>
                              <Chip tone={tone}>
                                <span title={TASK_LABEL[n]}>
                                  Task {n} ·{' '}
                                  {t?.status === 'terkirim'
                                    ? t.at
                                      ? formatJam(t.at)
                                      : 'terkirim'
                                    : t?.status === 'gagal'
                                      ? 'gagal'
                                      : 'belum'}
                                </span>
                              </Chip>
                            </li>
                          );
                        })}
                      </ol>
                      {failed && (
                        <span className="text-danger">
                          {failed[1].error}
                          {blockedBy ? ` · task ${blockedBy} harus terkirim lebih dulu` : ''}
                        </span>
                      )}
                      {failed &&
                        (confirm === b.bookingCode ? (
                          <span
                            role="group"
                            aria-label="Konfirmasi kirim ulang task"
                            className="flex flex-wrap items-center gap-2 rounded-control border border-brand-600 p-2"
                          >
                            Kirim task {resendInOrder(b, '').sent.join(' lalu ')} berurutan ke BPJS Antrean?
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={pending}
                              onClick={() =>
                                act({ kind: 'task', bookingCode: b.bookingCode, confirmed: true }, () => {
                                  setBookings((cur) =>
                                    cur.map((x) =>
                                      x.bookingCode === b.bookingCode
                                        ? resendInOrder(x, demoNow().toISOString()).next
                                        : x,
                                    ),
                                  );
                                  setConfirm(null);
                                })
                              }
                            >
                              Ya, kirim berurutan
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                              Batal
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            className="self-start"
                            disabled={!!down}
                            onClick={() => setConfirm(b.bookingCode)}
                          >
                            Kirim ulang berurutan
                          </Button>
                        ))}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {svc === 'aplicare' && (
            <div className="flex flex-col gap-2">
              <span className="font-semibold">
                Ketersediaan tempat tidur · kiriman terakhir {formatJam(lastSync)}
              </span>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-small">
                  <thead>
                    <tr className="border-b border-line text-left text-caption text-ink-500">
                      <th className="px-2 py-1.5">Kelas</th>
                      <th className="px-2 py-1.5 text-right">Kapasitas</th>
                      <th className="px-2 py-1.5 text-right">Tersedia (SIM RS)</th>
                      <th className="px-2 py-1.5 text-right">Di Aplicare</th>
                    </tr>
                  </thead>
                  <tbody>
                    {beds.map((r) => (
                      <tr
                        key={r.kelas}
                        className={cx('border-b border-line', r.available !== r.reported && 'bg-warning-bg')}
                      >
                        <td className="px-2 py-1.5">{r.kelas}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.total}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.available}</td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {r.reported}
                          {r.available !== r.reported && (
                            <span className="text-caption font-semibold text-warning"> · beda</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                className="self-start"
                disabled={pending || !!down || aplicareDiffs(beds).length === 0}
                onClick={() =>
                  act({ kind: 'aplicare' }, () => {
                    setBeds((cur) => cur.map((r) => ({ ...r, reported: r.available })));
                    setLastSync(demoNow().toISOString());
                  })
                }
              >
                {aplicareDiffs(beds).length
                  ? `Sinkronkan sekarang (${aplicareDiffs(beds).length} kelas beda)`
                  : 'Sudah sinkron'}
              </Button>
            </div>
          )}

          {svc === 'hfis' && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-small">
              {hfis.map((r) => (
                <li
                  key={r.doctor}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-2.5"
                >
                  <span>
                    <span className="font-semibold">{r.doctor}</span> · {r.poli}
                    <span className="block text-ink-700">
                      SIM RS {r.simrs} · HFIS {r.hfis}
                    </span>
                  </span>
                  {hfisMismatch(r) ? (
                    <Button
                      size="sm"
                      disabled={pending || !!down}
                      onClick={() =>
                        act({ kind: 'hfis', doctor: r.doctor }, () =>
                          setHfis((cur) =>
                            cur.map((x) => (x.doctor === r.doctor ? { ...x, hfis: x.simrs } : x)),
                          ),
                        )
                      }
                    >
                      Kirim jadwal ke HFIS
                    </Button>
                  ) : (
                    <Chip tone="success">Sama</Chip>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
