'use client';

import type { BedBoard, BedRequest } from '@simrs/shared';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { TabList, TabPanel } from '@simrs/ui';
import { taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import { bedCounts, type BedFilter, filterBeds } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { allocateBedAction } from './actions';
import { BedDetail, type BedPatch } from './bed-detail';
import { BedFilters, BedStatusTiles } from './bed-filters';
import { BedList, WardGrid, WardOverview } from './bed-grid';
import { BedRequests } from './bed-requests';

type Steps = Partial<Record<'igd-ranap' | 'elektif-btn', ScenarioStepState>>;

/** K05 · Ruang kerja papan bed: ubin status, filter, peta/daftar, bed terpilih, antrean permintaan. */
export function BedWorkspace({
  board,
  initialWard,
  reserved,
  steps,
  rev,
  ranapRoute,
}: {
  board: BedBoard;
  initialWard: string;
  reserved: string[];
  steps: Steps;
  rev: number;
  ranapRoute: string | null;
}) {
  const { runTask, pending } = useScenarioTask(rev);
  const [view, setView] = useState('peta');
  const viewTabsId = useId();
  const [filter, setFilter] = useState<BedFilter>({ ward: initialWard, kelas: 'semua', status: 'semua' });
  const [selected, setSelected] = useState('');
  const [patches, setPatches] = useState<Record<string, BedPatch>>({});
  const [allocated, setAllocated] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const beds = board.beds.map((b) => (patches[b.code] ? { ...b, ...patches[b.code] } : b));
  const requests = board.requests.filter((r) => !allocated.includes(r.id));
  const shown = filterBeds(beds, board.wards, filter);
  const counts = bedCounts(beds);
  const selBed = beds.find((b) => b.code === selected) ?? null;
  const wardOf = (code: string) => board.wards.find((w) => w.code === code);
  const filtered = filter.ward !== 'semua' || filter.kelas !== 'semua' || filter.status !== 'semua';
  const visibleWards = board.wards.filter((w) => filter.kelas === 'semua' || w.kelas === filter.kelas);

  const pickBed = (code: string) => {
    const b = beds.find((x) => x.code === code);
    if (!b) return;
    setSelected(code);
    setFilter((f) => ({ ...f, ward: b.wardCode, status: 'semua' }));
    setView('peta');
  };

  const allocate = (r: BedRequest) => {
    const short = r.patientName.split(' ').slice(0, 2).join(' ');
    if (!selBed || selBed.status !== 'siap') {
      setMessage({
        ok: false,
        text: 'Pilih dulu bed berstatus Siap di peta, lalu tekan Alokasikan pada permintaan.',
      });
      return;
    }
    if (reserved.includes(selBed.code)) {
      setMessage({ ok: false, text: `${selBed.code} disiapkan untuk pasien simulasi; pilih bed Siap lain.` });
      return;
    }
    const code = selBed.code;
    startTransition(async () => {
      const res = await allocateBedAction({ requestId: r.id, bedCode: code });
      if (!res.ok) {
        setMessage({ ok: false, text: res.error ?? 'Alokasi gagal.' });
        return;
      }
      const at = res.ok.at;
      setPatches((p) => ({
        ...p,
        [code]: { status: 'dipesan', patientLabel: r.patientName, note: `dari ${r.from} · ${at}` },
      }));
      setAllocated((a) => [...a, r.id]);
      setMessage({
        ok: true,
        text: `${short} dialokasikan ke ${code} · dipesan ${at} · notifikasi ke ${r.from} (simulasi, tidak disimpan)`,
      });
    });
  };

  // Bed terpilih adalah kandidat pasien skenario yang tugas alokasinya sedang giliran → tombol alokasi asli.
  const scenarioAlloc = (() => {
    if (!selBed) return null;
    for (const r of requests) {
      if (!r.scenario) continue;
      const st = steps[r.scenario];
      const task = r.scenario === 'igd-ranap' ? 'alok' : 'kelas';
      const i = r.candidates.findIndex((c) => c.bedCode === selBed.code);
      const opt = st?.tasks[task]?.options[i];
      if (i < 0 || !opt || st?.tasks[task]?.done) continue;
      return {
        label: `Alokasikan ${r.patientName.split(' ').slice(0, 2).join(' ')} ke ${selBed.code}`,
        enabled: taskEnabled(st, task) && !pending,
        run: () => runTask(st, task, opt.id),
      };
    }
    return null;
  })();

  const ward = filter.ward === 'semua' ? null : wardOf(filter.ward);
  const wardBeds = ward ? shown.filter((b) => b.wardCode === ward.code) : [];

  return (
    <>
      <BedStatusTiles counts={counts} />
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Peta tempat tidur" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabList
              label="Tampilan"
              idBase={viewTabsId}
              value={view}
              onChange={setView}
              items={[
                { id: 'peta', label: 'Peta bed' },
                { id: 'daftar', label: 'Daftar' },
              ]}
            />
          </div>
          <BedFilters
            wards={board.wards}
            filter={filter}
            onChange={setFilter}
            shownLabel={
              filtered
                ? `${shown.length} dari ${beds.length} bed ditampilkan`
                : `${beds.length} bed ditampilkan`
            }
          />
          <TabPanel idBase={viewTabsId} value={view}>
            {shown.length === 0 ? (
              <p className="m-0 rounded-card border border-dashed border-line-strong bg-white p-4 text-small text-ink-500">
                Tidak ada bed yang cocok dengan filter bangsal, kelas, dan status ini.
              </p>
            ) : view === 'daftar' ? (
              <BedList
                beds={shown}
                wardName={(c) => wardOf(c)?.name ?? c}
                selected={selected}
                onSelect={setSelected}
              />
            ) : ward ? (
              <WardGrid
                ward={ward}
                beds={wardBeds}
                allBeds={beds}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <WardOverview
                wards={visibleWards}
                beds={beds}
                onOpen={(code) => setFilter((f) => ({ ...f, ward: code }))}
              />
            )}
          </TabPanel>
        </section>
        <aside aria-label="Alokasi bed" className="flex flex-[1_1_300px] flex-col gap-4 lg:max-w-[380px]">
          {selBed && (
            <BedDetail
              bed={selBed}
              ward={wardOf(selBed.wardCode)}
              ranapHref={
                ranapRoute && selBed.encounterId && selBed.status !== 'dipesan'
                  ? `${ranapRoute}/${selBed.encounterId}`
                  : null
              }
              scenarioOwned={selBed.encounterId === 'kj-hartono' || selBed.encounterId === 'kj-ratna'}
              scenarioAlloc={scenarioAlloc}
              onChange={(code, patch, msg) => {
                setPatches((p) => ({ ...p, [code]: patch }));
                setMessage({ ok: true, text: msg });
              }}
              onClose={() => setSelected('')}
            />
          )}
          <BedRequests
            requests={requests}
            selectedBed={selBed}
            message={message}
            steps={steps}
            pending={pending || busy}
            runTask={runTask}
            onAllocate={allocate}
            onPickBed={pickBed}
          />
          <section
            aria-label="Perkiraan pulang"
            className="flex flex-col gap-1.5 rounded-card border border-brand-100 bg-[linear-gradient(180deg,#F2FAF8,#FFFFFF)] px-4 py-3.5"
          >
            <span className="font-semibold text-brand-700">Perkiraan sore ini</span>
            <span className="text-small text-ink-700">
              {counts.pulang} pasien rencana pulang hari ini. Bila resume final sebelum 13.00, permintaan IGD
              terpenuhi tanpa boarding.
            </span>
            {ranapRoute && (
              <Link href={ranapRoute} className="inline-flex min-h-11 items-center text-small font-semibold">
                Lihat pasien rawat inap
              </Link>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
