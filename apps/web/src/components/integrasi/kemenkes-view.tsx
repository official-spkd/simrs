'use client';

import { formatJam } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useState } from 'react';
import { kemenkesAction } from '@/app/(staf)/sistem/integrasi/kemenkes/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { type KemenkesReport, SEND_BLOCK_TEXT, sendGate, validateReport } from '@/lib/integrasi-kemenkes';
import { formatNumber } from '@/lib/manajemen';

const STATUS = {
  draf: { label: 'Draf · perlu perbaikan', tone: 'warning' },
  siap: { label: 'Siap kirim', tone: 'brand' },
  terkirim: { label: 'Terkirim', tone: 'success' },
  'belum-tersedia': { label: 'Belum tersedia', tone: 'neutral' },
} as const;

/**
 * I04 · Kemenkes: RS Online (real-time) dan laporan SIRS bulanan. Alur susun → validasi bentuk → kirim berkonfirmasi →
 * tanda terima; laporan tanpa sumber data ditandai belum tersedia.
 */
export function KemenkesView({ reports, rev }: { reports: KemenkesReport[]; rev: number }) {
  const [selId, setSelId] = useState(reports.find((r) => r.status === 'siap')?.id ?? reports[0]?.id ?? '');
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(rev);
  const sel = reports.find((r) => r.id === selId);

  const act = (payload: Parameters<typeof kemenkesAction>[0]) =>
    save(
      (rev) => kemenkesAction(payload, rev),
      (result) => {
        setMsg({ ok: result.ok, text: result.message });
        if (result.ok) setConfirming(false);
      },
    );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]">
      <section
        aria-label="Daftar laporan"
        className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={r.id === selId}
                onClick={() => {
                  setSelId(r.id);
                  setConfirming(false);
                  setMsg(null);
                }}
                className={cx(
                  'flex w-full cursor-pointer flex-col gap-1 rounded-[12px] border p-3 text-left font-[inherit]',
                  r.id === selId
                    ? 'border-brand-300 bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                    : 'border-line bg-white hover:bg-brand-50/60',
                )}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{r.name}</span>
                  <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Chip>
                </span>
                <span className="text-small text-ink-700">
                  {r.frequency} · {r.period}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {sel && (
        <section
          aria-label="Detail laporan"
          className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <span className="flex flex-col">
            <h2 className="m-0 text-[15px] font-semibold">{sel.name}</h2>
            <span className="text-small text-ink-700">
              Periode {sel.period} · sumber: {sel.source}
            </span>
          </span>
          {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}
          {sel.status === 'belum-tersedia' ? (
            <Alert level="info" title="Belum tersedia">
              {SEND_BLOCK_TEXT.NOT_AVAILABLE} {sel.source}.
            </Alert>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[360px] border-collapse text-small">
                  <caption className="sr-only">Isi laporan (agregat)</caption>
                  <tbody>
                    {sel.rows.map((row) => (
                      <tr key={row.label} className="border-b border-line">
                        <td className="px-2 py-1.5">{row.label}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatNumber(row.value)}</td>
                      </tr>
                    ))}
                    {sel.declaredTotal !== null && (
                      <tr>
                        <td className="px-2 py-1.5 font-semibold">Total</td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold">
                          {formatNumber(sel.declaredTotal)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <ul aria-label="Validasi bentuk" className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
                {validateReport(sel).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <span className={cx('font-semibold', c.ok ? 'text-success' : 'text-danger')}>
                      {c.ok ? '✓ Lolos' : '✗ Gagal'}
                    </span>
                    <span>{c.label}</span>
                    {!c.ok && c.fix && sel.checks.some((x) => x.id === c.id) && (
                      <>
                        <span className="text-caption text-ink-500">{c.fix}</span>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => act({ kind: 'perbaiki', reportId: sel.id, checkId: c.id })}
                        >
                          Lengkapi dari rekam medis
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {sel.sent ? (
                <span role="status" className="text-small font-semibold text-success">
                  ✓ Terkirim {formatJam(sel.sent.at)} · tanda terima{' '}
                  <span className="font-mono">{sel.sent.receipt}</span>
                  {sel.frequency === 'real-time' ? ' · dikirim otomatis tiap perubahan' : ''}
                </span>
              ) : confirming ? (
                <div
                  role="group"
                  aria-label="Konfirmasi kirim laporan"
                  className="flex flex-col gap-2 rounded-control border border-brand-600 p-3 text-small"
                >
                  Kirim {sel.name} periode {sel.period} ke Kemenkes? Satu periode hanya dikirim sekali;
                  koreksi lewat kirim ulang dari hub.
                  <span className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={pending}
                      onClick={() =>
                        act({
                          kind: 'kirim',
                          reportId: sel.id,
                          confirmed: true,
                          fixedChecks: [],
                        })
                      }
                    >
                      Ya, kirim
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      Batal
                    </Button>
                  </span>
                </div>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={pending || sendGate(sel) !== null}
                    onClick={() => setConfirming(true)}
                  >
                    Kirim ke Kemenkes
                  </Button>
                  {sendGate(sel) && (
                    <span className="text-caption text-ink-500">
                      {SEND_BLOCK_TEXT[sendGate(sel) ?? 'VALIDATION']}
                    </span>
                  )}
                </span>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
