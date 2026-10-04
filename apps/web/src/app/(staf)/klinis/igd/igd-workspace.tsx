'use client';

import type { EdBoard, EdTrackingItem, EdZone, TriageLevel } from '@simrs/shared';
import { Button, KpiCard } from '@simrs/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { edKpis, filterEdItems, newWalkIn } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { EdBoardTable } from './ed-board-table';
import { type SavedTriage, TriagePanel } from './triage-panel';

const WALK_IN_EVENT = 'simrs:igd-pasien-baru';
type WalkInKind = 'tanpa-identitas' | 'baru';

/** Tombol header IGD: tambah pasien ke area triase (simulasi, di layar ini saja). */
export function WalkInButtons() {
  const add = (kind: WalkInKind) => window.dispatchEvent(new CustomEvent(WALK_IN_EVENT, { detail: kind }));
  return (
    <>
      <Button variant="danger" onClick={() => add('tanpa-identitas')}>
        Pasien tanpa identitas
      </Button>
      <Button variant="primary" onClick={() => add('baru')}>
        + Triase pasien baru
      </Button>
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

/** K03 · Ruang kerja IGD: KPI, papan pelacakan, dan panel triase pasien terpilih (`?pilih=`). */
export function IgdWorkspace({
  board,
  initialSelected,
  kd,
  tr,
  rev,
  history,
  links,
}: {
  board: EdBoard;
  initialSelected: string;
  kd: ScenarioStepState | undefined;
  tr: ScenarioStepState | undefined;
  rev: number;
  history: string;
  links: { bed: string | null; ranap: string | null };
}) {
  const pathname = usePathname();
  const sec = useElapsedSeconds();
  const [zone, setZone] = useState<EdZone | 'semua'>('semua');
  const [level, setLevel] = useState<TriageLevel | 0>(0);
  const [selected, setSelected] = useState(initialSelected);
  const [saved, setSaved] = useState<Record<string, SavedTriage>>({});
  const [extra, setExtra] = useState<EdTrackingItem[]>([]);
  const seq = useRef(1);
  /** Detik saat pasien baru ditambahkan (lama tinggalnya dihitung sejak itu). */
  const [born, setBorn] = useState<Record<string, number>>({});
  const secRef = useRef(0);
  useEffect(() => {
    secRef.current = sec;
  }, [sec]);
  const elapsed = (id: string) => sec - (born[id] ?? 0);

  // Tombol header "Pasien tanpa identitas" / "+ Triase pasien baru" (komponen terpisah di header halaman).
  useEffect(() => {
    const onNew = (e: Event) => {
      const kind = (e as CustomEvent<WalkInKind>).detail;
      seq.current += 1;
      const item = newWalkIn(kind, seq.current, new Date().toISOString());
      const at = secRef.current;
      setBorn((b) => ({ ...b, [item.encounterId]: at }));
      setExtra((cur) => [...cur, item]);
      setSelected(item.encounterId);
      setZone('semua');
      setLevel(0);
    };
    window.addEventListener(WALK_IN_EVENT, onNew);
    return () => window.removeEventListener(WALK_IN_EVENT, onNew);
  }, []);

  const items = [...board.items, ...extra].map((p) => {
    const s = saved[p.encounterId];
    return s ? { ...p, triageLevel: s.level } : p;
  });
  const shown = filterEdItems(items, zone, level);
  const k = edKpis(items);
  const current = items.find((p) => p.encounterId === selected) ?? items[0];
  const select = (id: string) => {
    setSelected(id);
    // URL ikut berubah (tautan bisa dibagikan) tanpa memuat ulang data server.
    window.history.replaceState(null, '', `${pathname}?pilih=${encodeURIComponent(id)}`);
  };

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
          addMinutes={(id) => Math.floor(elapsed(id) / 60)}
          onZone={setZone}
          onLevel={setLevel}
          onSelect={select}
        />
        {current && (
          <TriagePanel
            key={current.encounterId}
            item={current}
            addSeconds={elapsed(current.encounterId)}
            saved={saved[current.encounterId]}
            onSaved={(id, s) => setSaved((cur) => ({ ...cur, [id]: s }))}
            kd={current.scenario ? kd : undefined}
            tr={current.scenario ? tr : undefined}
            rev={rev}
            history={history}
            links={links}
          />
        )}
      </div>
    </>
  );
}
