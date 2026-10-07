'use client';

import {
  CLINICAL_SSE_EVENTS,
  type EdBoardApi,
  type EdZone,
  formatJam,
  PAYER_KIND_LABEL,
  type TriageLevel,
} from '@simrs/shared';
import { Button, KpiCard } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LiveIndicator, useLiveBoard } from '@/components/klinis/live-board';
import { StatusFlag } from '@/components/klinis/status-flag';
import { TriageBadge } from '@/components/rawat-inap/triage-badge';
import { ageLabel, arrivalLabel, edRowFromApi } from '@/lib/igd-api';
import { edKpis, edLosAlert, filterEdItems, formatTimer } from '@/lib/rawat-inap';
import { EdBoardTable } from './ed-board-table';
import { DispositionPanel, EdStatusForm, IgdBedsPanel, SepPanel } from './igd-api-panels';
import { IgdRegisterForm } from './igd-api-register';
import { TriageApiForm } from './igd-api-triage';

export interface IgdPermissions {
  /** Pendaftaran IGD (`encounter.write` + `patient.read`). */
  register: boolean;
  /** Triase + status alur (`triage.write`). */
  triage: boolean;
  /** Permintaan bed + status bed IGD (`bed.write`). */
  bed: boolean;
  /** SEP IGD menyusul (`coverage.write`). */
  sep: boolean;
}

const CHANGE_EVENTS = [CLINICAL_SSE_EVENTS.edStatus, CLINICAL_SSE_EVENTS.edChanged] as const;

/** Detik sejak data papan terakhir tiba (lama tinggal berjalan maju tanpa memuat ulang). */
function useSecondsSince(asOf: string): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    setSec(0);
    const iv = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [asOf]);
  return sec;
}

/**
 * K03 · Ruang kerja IGD mode api (layar W3): KPI, papan pelacakan (komponen sama dengan mode presentasi), panel pasien
 * terpilih (triase dengan saran server, status alur + bed IGD, keputusan rawat inap, SEP IGD), pendaftaran IGD, dan bed
 * IGD. Papan real-time: event SSE → muat ulang data server (dua jendela saling memperbarui tanpa muat ulang manual).
 */
export function IgdLive({
  tenantName,
  board,
  initialSelected,
  perms,
  bedHref,
}: {
  tenantName: string;
  board: EdBoardApi;
  initialSelected: string | null;
  perms: IgdPermissions;
  bedHref: string | null;
}) {
  const router = useRouter();
  const live = useLiveBoard('/klinis/igd/events', CLINICAL_SSE_EVENTS.edBoard, CHANGE_EVENTS);
  const sec = useSecondsSince(board.asOf);
  const rows = useMemo(() => board.items.map(edRowFromApi), [board.items]);
  const [zone, setZone] = useState<EdZone | 'semua'>('semua');
  const [level, setLevel] = useState<TriageLevel | 0>(0);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const shown = filterEdItems(rows, zone, level);
  const k = edKpis(rows);
  const current = board.items.find((i) => i.encounterId === selected) ?? board.items[0] ?? null;
  // Pilihan pasien tidak ditulis ke URL: `?pilih=` yang berubah membuat muat ulang SSE berikutnya memasang ulang segmen
  // halaman (isian triase yang sedang diketik hilang). `?pilih=` tetap dibaca untuk tautan langsung.
  const select = (id: string) => setSelected(id);
  const bedsReady = board.beds.filter((b) => b.status === 'siap').length;
  const allocated = board.items.filter((i) => i.bedRequest?.status === 'dialokasi').length;
  const boarding = board.items.filter((i) => i.bedRequest?.boarding).length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Klinis / IGD / Papan pelacakan · {tenantName} · {board.unitName}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Instalasi Gawat Darurat</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <LiveIndicator status={live.status} asOf={formatJam(board.asOf)} />
          {perms.register && (
            <Button variant="primary" onClick={() => setRegistering(true)} disabled={registering}>
              + Daftarkan pasien IGD
            </Button>
          )}
        </div>
      </header>
      {registering && (
        <IgdRegisterForm
          unitId={board.unitId}
          onCancel={() => setRegistering(false)}
          onDone={(encounterId, number) => {
            setRegistering(false);
            setNotice(`Pasien terdaftar di IGD (${number}). Lanjutkan triase.`);
            select(encounterId);
            router.refresh();
          }}
        />
      )}
      {notice && (
        <p role="status" className="m-0 text-small font-semibold text-success">
          {notice}
        </p>
      )}
      <div
        role="region"
        aria-label="Ringkasan IGD"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      >
        <KpiCard label="Pasien di IGD" value={k.total} detail={`${board.beds.length} bed IGD`} />
        <KpiCard
          label="Triase 1–2"
          value={k.high}
          hint={k.untriaged ? `${k.untriaged} belum ditriase` : 'semua sudah ditriase'}
          tone="danger"
          tinted
        />
        <KpiCard label="Bed IGD siap" value={bedsReady} detail={`dari ${board.beds.length} bed`} />
        <KpiCard
          label="Menunggu bed rawat inap"
          value={board.items.filter((i) => i.bedRequest).length}
          hint={allocated ? `${allocated} sudah dialokasikan` : 'belum ada alokasi'}
          tone="warning"
          tinted
        />
        <KpiCard
          label="Boarding lewat batas"
          value={boarding}
          hint={boarding ? 'permintaan bed menunggu terlalu lama' : 'tidak ada'}
          tone="warning"
        />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        {rows.length === 0 ? (
          <section
            aria-label="Papan pasien IGD"
            className="flex-[999_1_560px] rounded-card border border-dashed border-line-strong bg-white/70 p-4 text-small text-ink-500"
          >
            Belum ada pasien di IGD. Pasien yang didaftarkan tampil di sini tanpa memuat ulang halaman.
          </section>
        ) : (
          <EdBoardTable
            all={rows}
            shown={shown}
            zone={zone}
            level={level}
            selected={current?.encounterId ?? ''}
            addMinutes={() => Math.floor(sec / 60)}
            onZone={setZone}
            onLevel={setLevel}
            onSelect={select}
          />
        )}
        {current && (
          <aside
            key={current.encounterId}
            aria-label="Pasien IGD terpilih"
            className="flex flex-[1_1_340px] flex-col gap-3 overflow-hidden rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card lg:max-w-[460px]"
          >
            <PatientHead item={current} addSeconds={sec} />
            <TriageApiForm item={current} canWrite={perms.triage} />
            <div className="border-t border-line-soft pt-2.5">
              <EdStatusForm item={current} beds={board.beds} canWrite={perms.triage} />
            </div>
            <DispositionPanel item={current} canRequest={perms.bed} bedHref={bedHref} />
            <SepPanel item={current} canWrite={perms.sep} />
          </aside>
        )}
      </div>
      <IgdBedsPanel beds={board.beds} items={board.items} canWrite={perms.bed} />
    </div>
  );
}

function PatientHead({ item, addSeconds }: { item: EdBoardApi['items'][number]; addSeconds: number }) {
  const row = edRowFromApi(item);
  const secs = item.losMinutes * 60 + addSeconds;
  const alert = edLosAlert(row, Math.floor(secs / 60));
  return (
    <div className="flex items-start justify-between gap-2.5 border-b border-line pb-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          {item.number} · tiba {item.arrivedAt ? formatJam(item.arrivedAt) : '—'} ·{' '}
          {arrivalLabel(item.arrivalMode)}
        </span>
        <h2 className="m-0 text-[17px] leading-snug font-bold">{item.patientName}</h2>
        <span className="text-caption text-ink-700">
          {row.sex} · {ageLabel(item.ageYears)} · <span className="font-mono">RM {item.rm}</span>
          {item.unidentified ? ' · identitas menyusul' : ''}
        </span>
        <span className="text-caption text-ink-700">
          Penjamin:{' '}
          {item.payer
            ? item.payer.name === PAYER_KIND_LABEL[item.payer.kind]
              ? item.payer.name
              : `${PAYER_KIND_LABEL[item.payer.kind]} · ${item.payer.name}`
            : 'belum ada'}{' '}
          · Dokter: {item.doctor ?? 'belum ditetapkan'}
        </span>
      </div>
      <span className="flex flex-none flex-col items-end gap-1">
        <TriageBadge level={item.triage?.level ?? null} />
        <span role="timer" aria-label="Lama di IGD" className="font-mono font-semibold">
          {formatTimer(secs)}
        </span>
        {alert && <StatusFlag icon="clock">{alert}</StatusFlag>}
      </span>
    </div>
  );
}
