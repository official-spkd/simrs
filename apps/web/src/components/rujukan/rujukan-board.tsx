'use client';

import { type BpjsSyncStatus, formatJam, formatTanggal, type ReferralStatus } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx, FilterChip, KpiCard } from '@simrs/ui';
import { useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import type { ReferralStoreState } from '@/lib/rujukan-toko';
import {
  ActivityLog,
  type ConfirmRequest,
  ConfirmDialog,
  FlowSteps,
  Panel,
  Stamp,
} from '@/components/platform/parts';
import { DEMO_TODAY, demoNow } from '@/lib/demo/fixtures/waktu';
import {
  canCancel,
  canResend,
  DIRECTION_LABEL,
  DIRECTION_OF,
  type DemoReferral,
  type Direction,
  daysLeft,
  kindLabel,
  processSync,
  referralCounts,
  STATUS_LABEL,
  SYNC_LABEL,
} from '@/lib/rujukan';

const STATUS_TONE: Record<ReferralStatus, ChipTone> = {
  pending: 'warning',
  active: 'success',
  used: 'info',
  expired: 'neutral',
  cancelled: 'neutral',
};
const SYNC_TONE: Record<BpjsSyncStatus, ChipTone> = {
  not_required: 'neutral',
  pending: 'warning',
  sent: 'success',
  rejected: 'danger',
  dead: 'danger',
};
const BPJS_STEPS = [
  { label: 'Dibuat', note: 'di SIM RS' },
  { label: 'Dikirim ke BPJS', note: 'antrean kirim' },
  { label: 'Nomor terbit', note: 'VClaim' },
  { label: 'Dipakai', note: 'SEP / kunjungan' },
];
const tgl = (iso: string | null) => (iso ? formatTanggal(`${iso}T12:00:00+07:00`) : '–');

type Filter = 'semua' | Direction | 'masalah';

/**
 * F07 · Rujukan masuk/keluar/internal, surat kontrol, dan SPRI: daftar kiri + detail kanan, status kirim BPJS
 * tertulis (menunggu/terbit/ditolak + alasan berkode), proses antrean kirim (mock BPJS), perbaiki tanggal lalu
 * kirim ulang, kirim ulang dari DLQ, cetak, dan batal beralasan. Tersimpan di toko demo bersama (domain `rujukan`)
 * atas nama pengguna sesi.
 */
export function RujukanBoard({
  state,
  rev,
  planDates,
}: {
  state: ReferralStoreState;
  rev: number;
  planDates: string[];
}) {
  const list = state.referrals;
  const log = [...state.log];
  const { dispatch, pending, error } = useDemoDispatch('rujukan', rev);
  const [filter, setFilter] = useState<Filter>('semua');
  const [selected, setSelected] = useState(list[0]?.id ?? '');
  const [newDate, setNewDate] = useState<string>('');
  const [flash, setFlash] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<DemoReferral | null>(null);

  const shown = list.filter((r) =>
    filter === 'semua'
      ? true
      : filter === 'masalah'
        ? r.sync.status === 'rejected' || r.sync.status === 'dead'
        : DIRECTION_OF[r.kind] === filter,
  );
  const r = list.find((x) => x.id === selected) ?? shown[0];
  const counts = referralCounts(list);

  /** Kirim aksi ke toko; umpan balik berjam bila tersimpan. */
  const send = (build: (t: string) => Parameters<typeof dispatch>[0], text: string) => {
    const t = formatJam(demoNow());
    dispatch(build(t), (ok) => ok && setFlash(`${text} · ${t}`));
  };
  const pick = (id: string) => {
    setSelected(id);
    setFlash(null);
    setNewDate('');
  };

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'semua', label: 'Semua' },
    ...(Object.keys(DIRECTION_LABEL) as Direction[]).map((d) => ({ id: d, label: DIRECTION_LABEL[d] })),
    { id: 'masalah', label: `Bermasalah (${counts.rejected})` },
  ];

  const resendCheck = r ? canResend(r, newDate || null, DEMO_TODAY) : null;
  const left = r ? daysLeft(r, DEMO_TODAY) : null;
  const needsDate =
    r &&
    ['BPJS_TANGGAL_TIDAK_VALID', 'BPJS_JADWAL_LIBUR', 'BPJS_KUOTA_PENUH'].includes(r.sync.error?.code ?? '');

  const cancelRequest: ConfirmRequest | null = cancelling
    ? {
        title: `Batalkan ${kindLabel(cancelling.kind).toLowerCase()} ${cancelling.number ?? '(belum bernomor)'}?`,
        body:
          cancelling.number && cancelling.sync.status === 'sent'
            ? 'Nomor yang sudah terbit dihapus di BPJS lewat antrean kirim; surat tidak bisa dipakai untuk SEP.'
            : 'Surat belum bernomor dibatalkan lokal; tidak ada yang dikirim ke BPJS.',
        confirmLabel: 'Ya, batalkan',
        danger: true,
        reasonLabel: 'Alasan pembatalan',
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Ringkasan rujukan" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Menunggu BPJS"
          value={String(counts.pending)}
          detail="di antrean kirim"
          tone={counts.pending > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard
          label="Ditolak / gagal kirim"
          value={String(counts.rejected)}
          hint={counts.rejected > 0 ? 'perlu diperbaiki' : 'tidak ada'}
          tone={counts.rejected > 0 ? 'danger' : 'success'}
          tinted
        />
        <KpiCard label="Berlaku" value={String(counts.active)} detail="siap dipakai SEP/kunjungan" />
        <KpiCard label="Rujukan masuk dipakai" value={String(counts.incomingToday)} detail="hari ini" />
      </div>

      <span role="group" aria-label="Saring rujukan" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <FilterChip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </FilterChip>
        ))}
      </span>

      <div className="flex flex-wrap items-start gap-4">
        <Panel
          className="flex-[1_1_320px]"
          title={`Daftar · ${shown.length}`}
          sub="Hari ini, Sen, 5 Okt 2026"
        >
          {shown.length === 0 ? (
            <p className="m-0 text-small text-ink-500">Tidak ada rujukan pada saringan ini.</p>
          ) : (
            <ul aria-label="Daftar rujukan" className="m-0 flex list-none flex-col gap-1.5 p-0">
              {shown.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    aria-current={x.id === r?.id ? 'true' : undefined}
                    onClick={() => pick(x.id)}
                    className={cx(
                      'flex min-h-11 w-full cursor-pointer flex-col items-start gap-1 rounded-control border px-3 py-2 text-left font-[inherit]',
                      x.id === r?.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-white',
                    )}
                  >
                    <span className="text-small font-semibold">
                      {kindLabel(x.kind)} · {x.patientName}
                    </span>
                    <span className="font-mono text-caption text-ink-500">
                      {x.number ?? 'belum bernomor'}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Chip tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Chip>
                      {x.sync.status !== 'not_required' && (
                        <Chip tone={SYNC_TONE[x.sync.status]}>{SYNC_LABEL[x.sync.status]}</Chip>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {r && (
          <div className="flex min-w-0 flex-[2_1_440px] flex-col gap-4">
            <Panel
              title={`${kindLabel(r.kind)} · ${r.patientName}`}
              sub={`RM ${r.rm} · ${DIRECTION_LABEL[DIRECTION_OF[r.kind]]}`}
              tone={r.sync.status === 'rejected' || r.sync.status === 'dead' ? 'danger' : undefined}
            >
              {r.sync.status !== 'not_required' && r.status !== 'cancelled' && (
                <FlowSteps
                  label="Tahap kirim BPJS"
                  steps={BPJS_STEPS}
                  current={r.sync.status === 'sent' ? 3 : 1}
                />
              )}
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-small">
                <dt className="text-ink-500">Nomor</dt>
                <dd className="m-0 font-mono">{r.number ?? 'belum ada (menunggu BPJS)'}</dd>
                <dt className="text-ink-500">
                  {DIRECTION_OF[r.kind] === 'masuk' ? 'Perujuk' : 'Asal / tujuan'}
                </dt>
                <dd className="m-0">
                  {r.facility}
                  {r.target ? ` → ${r.target}` : ''}
                </dd>
                <dt className="text-ink-500">Diagnosis</dt>
                <dd className="m-0">
                  <span className="font-mono">{r.diagnosis.code}</span> {r.diagnosis.display}
                </dd>
                <dt className="text-ink-500">Terbit</dt>
                <dd className="m-0">{tgl(r.issuedOn)}</dd>
                {r.validUntil && (
                  <>
                    <dt className="text-ink-500">Berlaku sampai</dt>
                    <dd className="m-0">
                      {tgl(r.validUntil)}
                      {left !== null && left >= 0 && left <= 7 && (
                        <Chip tone="warning" className="ml-2">
                          sisa {left} hari
                        </Chip>
                      )}
                    </dd>
                  </>
                )}
                {r.plannedDate && (
                  <>
                    <dt className="text-ink-500">Rencana</dt>
                    <dd className="m-0">{tgl(r.plannedDate)}</dd>
                  </>
                )}
                {r.practitioner && (
                  <>
                    <dt className="text-ink-500">DPJP</dt>
                    <dd className="m-0">{r.practitioner}</dd>
                  </>
                )}
                <dt className="text-ink-500">Status</dt>
                <dd className="m-0 flex flex-wrap gap-1.5">
                  <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                  <Chip tone={SYNC_TONE[r.sync.status]}>
                    {SYNC_LABEL[r.sync.status]}
                    {r.sync.sentAt ? ` · ${formatJam(r.sync.sentAt)}` : ''}
                  </Chip>
                </dd>
                {r.note && (
                  <>
                    <dt className="text-ink-500">Catatan</dt>
                    <dd className="m-0">{r.note}</dd>
                  </>
                )}
                {r.cancelReason && (
                  <>
                    <dt className="text-ink-500">Alasan batal</dt>
                    <dd className="m-0">{r.cancelReason}</dd>
                  </>
                )}
              </dl>

              {(r.sync.status === 'rejected' || r.sync.status === 'dead') && r.sync.error && (
                <Alert level="critical" title={r.sync.status === 'rejected' ? 'Ditolak BPJS' : 'Gagal kirim'}>
                  <span className="font-mono">{r.sync.error.code}</span> · {r.sync.error.message}
                  {r.sync.error.code === 'BPJS_TANGGAL_TIDAK_VALID' &&
                    ` (rencana ${tgl(r.plannedDate)} sudah lewat).`}
                </Alert>
              )}

              {needsDate && r.status !== 'cancelled' && (
                <label className="flex max-w-[320px] flex-col gap-1.5">
                  <span className="text-small font-semibold text-ink-700">Tanggal rencana baru</span>
                  <select
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900"
                  >
                    <option value="">Pilih tanggal praktik…</option>
                    {planDates.map((d) => (
                      <option key={d} value={d}>
                        {tgl(d)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <span className="flex flex-wrap items-center gap-2">
                {r.sync.status === 'pending' && (
                  <Button
                    variant="primary"
                    disabled={pending}
                    onClick={() => {
                      const at = demoNow().toISOString();
                      const next = processSync(r, at);
                      send(
                        (jam) => ({ type: 'antrean.diproses', id: r.id, at, jam }),
                        next.sync.status === 'sent'
                          ? `Nomor BPJS terbit ${next.number}`
                          : `Ditolak BPJS: ${next.sync.error?.message ?? ''}`,
                      );
                    }}
                  >
                    Proses antrean kirim (mock BPJS)
                  </Button>
                )}
                {(r.sync.status === 'rejected' || r.sync.status === 'dead') && r.status !== 'cancelled' && (
                  <Button
                    variant="primary"
                    disabled={!resendCheck?.ok || pending}
                    aria-describedby={resendCheck && !resendCheck.ok ? 'rujukan-alasan' : undefined}
                    onClick={() =>
                      send(
                        (jam) => ({
                          type: 'kirim.ulang',
                          id: r.id,
                          newPlannedDate: needsDate ? newDate : null,
                          jam,
                        }),
                        'Dikirim ulang ke antrean BPJS',
                      )
                    }
                  >
                    {needsDate ? 'Perbaiki & kirim ulang' : 'Kirim ulang'}
                  </Button>
                )}
                {(r.status === 'active' || r.status === 'used') && (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      send(
                        (jam) => ({ type: 'surat.dicetak', id: r.id, jam }),
                        `Surat ${r.number} dicetak · tercatat audit`,
                      )
                    }
                  >
                    Cetak
                  </Button>
                )}
                {canCancel(r).ok && (
                  <Button variant="danger" onClick={() => setCancelling(r)}>
                    Batalkan
                  </Button>
                )}
                {resendCheck &&
                  !resendCheck.ok &&
                  (r.sync.status === 'rejected' || r.sync.status === 'dead') && (
                    <span id="rujukan-alasan" className="text-caption font-medium text-warning">
                      {resendCheck.reason}
                    </span>
                  )}
              </span>
              {(flash || error) && (
                <span role="status">
                  <Stamp tone={error || flash?.startsWith('Ditolak') ? 'danger' : 'success'}>
                    {error ?? flash}
                  </Stamp>
                </span>
              )}
            </Panel>
            <Panel title="Aktivitas sesi ini" sub="Kiriman BPJS lewat antrean (outbox) · tercatat audit">
              {log.length === 0 ? (
                <p className="m-0 text-small text-ink-500">Belum ada aktivitas.</p>
              ) : (
                <ActivityLog label="Aktivitas rujukan" items={log} />
              )}
            </Panel>
          </div>
        )}
      </div>
      <ConfirmDialog
        request={cancelRequest}
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => {
          if (!cancelling) return;
          const c = cancelling;
          send(
            (jam) => ({ type: 'rujukan.dibatalkan', id: c.id, reason, jam }),
            `${kindLabel(c.kind)} dibatalkan`,
          );
        }}
      />
    </div>
  );
}
