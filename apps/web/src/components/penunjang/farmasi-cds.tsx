'use client';

import { formatJam, type PharmacyCdsAlert, type PharmacyPrescription } from '@simrs/shared';
import { Button, cx, SafetyGate } from '@simrs/ui';
import type { ReactNode } from 'react';
import { alertBlocks, type RxLocal } from '@/lib/penunjang-farmasi';

export type CdsFollowUp = 'usul' | 'setuju' | 'konfirmasi' | 'override';

function Note({ tone, mark, children }: { tone: 'success' | 'warning'; mark: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'flex items-start gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-small',
        tone === 'success'
          ? 'border-zamrud-200 bg-alert-success text-zamrud-700'
          : 'border-kunyit-200 bg-alert-warning text-kunyit-800',
      )}
    >
      <span aria-hidden="true" className="font-bold">
        {mark}
      </span>
      <span>{children}</span>
    </div>
  );
}

/**
 * Peringatan CDS di telaah (mockup Farmasi): interaksi mayor dan dosis ginjal menahan resep sampai diikuti
 * (usulan ke dokter / konfirmasi dosis) atau di-override dengan alasan tertulis (SafetyGate). Peringatan yang sudah
 * ditindaklanjuti di CPOE dan obat high alert tampil sebagai catatan.
 */
export function FarmasiCds({
  role,
  rx,
  local,
  busy,
  onAction,
}: {
  role: string | null;
  rx: PharmacyPrescription;
  local: RxLocal | undefined;
  busy: boolean;
  onAction: (alert: PharmacyCdsAlert, action: CdsFollowUp, reason?: string) => void;
}) {
  const highAlert = rx.items.filter((i) => i.highAlert);
  if (rx.alerts.length === 0 && highAlert.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {rx.alerts.map((a) => {
        const l = local?.alerts?.[a.id];
        if (!alertBlocks(a)) {
          return (
            <Note key={a.id} tone="success" mark={a.level === 'info' ? 'i' : '✓'}>
              <strong>{a.title}.</strong> {a.detail} {a.resolution}
            </Note>
          );
        }
        if (l?.state === 'diusulkan') {
          return (
            <div
              key={a.id}
              role="status"
              className="flex flex-wrap items-center gap-3 rounded-[12px] border border-kunyit-200 bg-alert-warning p-3.5"
            >
              <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                <span className="font-bold text-kunyit-800">{a.title}</span>
                <span className="text-small text-ink-700">
                  Usulan terkirim {formatJam(l.at)} ke {rx.prescriber}: {a.recommendation}. Resep tertahan
                  sampai dokter merespons.
                </span>
              </span>
              <span className="flex flex-col items-end gap-1.5">
                <span className="rounded-full bg-kunyit-100 px-2.5 py-0.5 text-caption font-semibold text-kunyit-800">
                  Menunggu dokter · {formatJam(l.at)}
                </span>
                <Button disabled={busy || role !== 'dokter'} onClick={() => onAction(a, 'setuju')}>
                  Setujui sebagai dokter
                </Button>
                {role !== 'dokter' && (
                  <span className="text-caption text-warning">Persetujuan wajib dari posisi Dokter.</span>
                )}
              </span>
            </div>
          );
        }
        const resolved = l
          ? { kind: l.state === 'override' ? ('override' as const) : ('ikuti' as const), text: l.text }
          : null;
        return (
          <SafetyGate
            key={a.id}
            title={a.status === 'override' ? `${a.title} (override dokter)` : a.title}
            tone={a.level === 'mayor' ? 'danger' : 'warning'}
            recommendation={a.recommendation ?? 'Tinjau dan setujui'}
            onFollow={() => onAction(a, a.kind === 'interaksi' ? 'usul' : 'konfirmasi')}
            onOverride={(reason) => onAction(a, 'override', reason)}
            resolved={resolved}
            disabled={busy || role !== 'apoteker'}
          >
            {a.detail}
            {a.status === 'override' && a.resolution ? ` Catatan CPOE: ${a.resolution}` : ''}
          </SafetyGate>
        );
      })}
      {highAlert.map((i) => (
        <Note key={i.id} tone="warning" mark="!">
          High alert: {i.name}. Penyiapan wajib cek ganda oleh apoteker kedua.
        </Note>
      ))}
    </div>
  );
}
