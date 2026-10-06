'use client';

import { type EdBoard, type EdZone, formatJam, type TriageLevel } from '@simrs/shared';
import { Button, KpiCard } from '@simrs/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStoreAction } from '@/lib/demo/store/client';
import type { IgdDeath, IgdTriage } from '@/lib/klinis-igd-toko';
import { edKpis, filterEdItems, type WalkInKind } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { addWalkInAction } from './actions-demo';
import { EdBoardTable } from './ed-board-table';
import { IgdDispositionPanel, type IgdDispositionView } from './igd-disposition';
import { TriagePanel } from './triage-panel';

const WALK_IN_EVENT = 'simrs:igd-pasien-baru';

/**
 * Tombol header IGD: tambah pasien ke area triase. Tersimpan di toko demo (`klinis-igd`, id sementara dari server),
 * lalu pasien baru dipilih di papan.
 */
export function WalkInButtons({ rev }: { rev: number }) {
  const { run, pending } = useStoreAction(rev);
  const [error, setError] = useState<string | null>(null);
  const add = (kind: WalkInKind) =>
    run(
      (r) => addWalkInAction({ kind }, r),
      (res) => {
        setError(res.ok ? null : res.message);
        if (res.ok && res.encounterId) {
          window.dispatchEvent(new CustomEvent(WALK_IN_EVENT, { detail: res.encounterId }));
        }
      },
    );
  return (
    <>
      <Button variant="danger" disabled={pending} onClick={() => add('tanpa-identitas')}>
        Pasien tanpa identitas
      </Button>
      <Button variant="primary" disabled={pending} onClick={() => add('baru')}>
        + Triase pasien baru
      </Button>
      {error && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {error}
        </span>
      )}
    </>
  );
}

/** Detik sejak komponen tampil (penghitung lama tinggal berjalan; mulai 0 agar hidrasi cocok). */
function useElapsedSeconds(): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);
  return sec;
}

/**
 * K03 · Ruang kerja IGD: KPI, papan pelacakan, panel triase + disposisi pasien terpilih (`?pilih=`). Triase,
 * pasien baru, dan disposisi tersimpan di toko demo; papan datang dari server sesudah setiap aksi.
 */
export function IgdWorkspace({
  board,
  initialSelected,
  kd,
  tr,
  rev,
  igdRev,
  stored,
  dispositions,
  deaths,
  history,
  links,
  canTriage,
  role,
  user,
}: {
  board: EdBoard;
  initialSelected: string;
  kd: ScenarioStepState | undefined;
  tr: ScenarioStepState | undefined;
  /** Revisi skenario Simulasi (tugas skenario). */
  rev: number;
  /** Revisi toko `klinis-igd`. */
  igdRev: number;
  /** Triase tersimpan per kunjungan. */
  stored: Readonly<Record<string, IgdTriage>>;
  dispositions: Readonly<Record<string, Omit<IgdDispositionView, 'item'>>>;
  deaths: ReadonlyArray<IgdDeath & { encounterId: string }>;
  history: string;
  links: { bed: string | null; ranap: string | null };
  /** Posisi perawat/dokter: boleh menetapkan triase (petugas pendaftaran: identifikasi dan admisi saja). */
  canTriage: boolean;
  role: string | null;
  user: string;
}) {
  const pathname = usePathname();
  const sec = useElapsedSeconds();
  const [zone, setZone] = useState<EdZone | 'semua'>('semua');
  const [level, setLevel] = useState<TriageLevel | 0>(0);
  const [selected, setSelected] = useState(initialSelected);

  // Tombol header "Pasien tanpa identitas" / "+ Triase pasien baru": pilih pasien baru setelah tersimpan.
  useEffect(() => {
    const onNew = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSelected(id);
      setZone('semua');
      setLevel(0);
      window.history.replaceState(null, '', `${window.location.pathname}?pilih=${encodeURIComponent(id)}`);
    };
    window.addEventListener(WALK_IN_EVENT, onNew);
    return () => window.removeEventListener(WALK_IN_EVENT, onNew);
  }, []);

  const items = board.items;
  const shown = filterEdItems(items, zone, level);
  const k = edKpis(items);
  const current = items.find((p) => p.encounterId === selected) ?? items[0];
  const select = (id: string) => {
    setSelected(id);
    // URL ikut berubah (tautan bisa dibagikan) tanpa memuat ulang data server.
    window.history.replaceState(null, '', `${pathname}?pilih=${encodeURIComponent(id)}`);
  };
  const disp = current ? dispositions[current.encounterId] : undefined;

  return (
    <>
      <div
        role="region"
        aria-label="Ringkasan IGD"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      >
        <KpiCard label="Pasien di IGD" value={k.total} detail={`kapasitas ${board.capacity} bed`} />
        <KpiCard
          label="Triase 1–2"
          value={k.high}
          hint={k.untriaged ? `${k.untriaged} belum ditriase` : 'semua ditangani'}
          tone="danger"
          tinted
        />
        <KpiCard
          label="Waktu tunggu dokter"
          value={`${board.doctorWaitMedianMinutes} mnt`}
          detail="median hari ini"
        />
        <KpiCard
          label="Boarding > 4 jam"
          value={k.boarding}
          hint={k.boarding ? 'menunggu bed rawat inap' : 'tidak ada'}
          tone="warning"
          tinted
        />
        <KpiCard
          label="Pulang tanpa diperiksa"
          value={board.leftWithoutBeingSeen24h}
          detail="24 jam terakhir"
          tone="success"
        />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <EdBoardTable
          all={items}
          shown={shown}
          zone={zone}
          level={level}
          selected={current?.encounterId ?? ''}
          addMinutes={() => Math.floor(sec / 60)}
          onZone={setZone}
          onLevel={setLevel}
          onSelect={select}
        />
        {current && (
          <div className="flex flex-[1_1_340px] flex-col gap-4 lg:max-w-[420px]">
            <TriagePanel
              key={current.encounterId}
              item={current}
              addSeconds={sec}
              stored={stored[current.encounterId]}
              igdRev={igdRev}
              kd={current.scenario ? kd : undefined}
              tr={current.scenario ? tr : undefined}
              rev={rev}
              history={history}
              links={links}
              canTriage={canTriage}
            />
            {!current.scenario && disp && (
              <IgdDispositionPanel
                key={`${current.encounterId}-disposisi`}
                view={{ item: current, ...disp }}
                rev={igdRev}
                role={role}
                user={user}
                bedHref={links.bed}
              />
            )}
          </div>
        )}
      </div>
      {deaths.length > 0 && (
        <section
          aria-label="Disposisi meninggal hari ini"
          className="flex flex-col gap-1.5 rounded-card border border-line bg-white px-4 py-3.5"
        >
          <h2 className="m-0 text-body font-semibold">Disposisi meninggal hari ini</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {deaths.map((d) => (
              <li key={d.encounterId}>
                <span className="font-semibold">{d.patientName}</span> · meninggal {formatJam(d.diedAt)} ·{' '}
                <span className="font-mono">{d.causeCode}</span> {d.causeLabel} · surat keterangan kematian{' '}
                {d.certificateNo} ber-TTE {d.by}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
