'use client';

import {
  formatJam,
  type PoliEncounter,
  type PoliQueueItem,
  type PoliQueueStatus,
  type PoliWorklist,
} from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { nextWaiting } from '@/lib/klinis';
import { KlinisPatientHeader } from './patient-header';
import { PoliQueue } from './poli-queue';
import { SoapForm } from './soap-form';
import { type ScenarioBinding, useScenarioTasks } from './use-scenario-tasks';
import { VisitStepper } from './visit-panels';
import { VitalsCard } from './vitals-card';

const DOCTOR_ROLES = ['dokter', 'dokter_residen'];
const NURSE_ROLES = ['perawat', 'bidan'];

/**
 * Tiga kolom pemeriksaan poli (mockup Main): antrean | rekam medis kunjungan | konteks pasien (`aside`, dirender
 * server). Status antrean yang diubah di layar ini (panggil, selesai) disimpan lokal (simulasi, tidak disimpan).
 */
export function PoliWorkspace({
  worklist,
  encounter,
  role,
  binding,
  cpoeHref,
  kasirHref,
  aside,
}: {
  worklist: PoliWorklist;
  encounter: PoliEncounter;
  role: string | null;
  binding: ScenarioBinding | null;
  cpoeHref: string;
  kasirHref: string | null;
  aside: ReactNode;
}) {
  const router = useRouter();
  const tasks = useScenarioTasks(binding);
  const [local, setLocal] = useState<Record<string, { status: PoliQueueStatus; wait: string }>>({});
  const [called, setCalled] = useState<string | null>(null);
  const statusOf = (i: PoliQueueItem) => (i.scenario ? i.status : (local[i.patientId]?.status ?? i.status));
  const waitOf = (i: PoliQueueItem) => (i.scenario ? i.waitNote : (local[i.patientId]?.wait ?? i.waitNote));
  const isDoctor = DOCTOR_ROLES.includes(role ?? '');
  const isNurse = NURSE_ROLES.includes(role ?? '');
  const current = worklist.items.find((i) => i.encounterId === encounter.encounterId);
  const scenarioPatient = Boolean(current?.scenario);
  const next = nextWaiting(worklist.items, statusOf);

  const callNext = () => {
    if (!next) return;
    const t = formatJam(new Date());
    if (next.scenario) {
      setCalled(`${next.queueNo} · ${next.name} adalah pasien skenario: buka lalu tekan "Panggil pasien".`);
    } else {
      setLocal((cur) => {
        const out = { ...cur };
        for (const i of worklist.items) {
          if (!i.scenario && statusOf(i) === 'diperiksa')
            out[i.patientId] = { status: 'dijeda', wait: `dijeda ${t}` };
        }
        out[next.patientId] = { status: 'diperiksa', wait: `mulai ${t}` };
        return out;
      });
      setCalled(`${next.queueNo} · ${next.name} dipanggil ${t} · tampil di layar antrean (simulasi)`);
    }
    router.push(`/klinis/poli?pasien=${next.patientId}`, { scroll: false });
  };

  const panggil = tasks.task('panggil');
  const actions = (
    <>
      {isDoctor && panggil && panggil.status !== 'selesai' && (
        <Button type="button" disabled={!tasks.enabled('panggil')} onClick={() => tasks.run('panggil', true)}>
          <Icon name="bell" size={16} />
          {panggil.btn} · {encounter.queueNo}
        </Button>
      )}
      <a
        href="#riwayat-kunjungan"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-white px-3 text-small font-medium text-ink-900 no-underline"
      >
        <Icon name="history" size={16} />
        Riwayat
      </a>
      {isDoctor && (
        <Link
          href={cpoeHref}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-brand-800 bg-white px-3 text-small font-semibold text-brand-700 no-underline"
        >
          <Icon name="pill" size={16} />
          Buka CPOE
        </Link>
      )}
    </>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_280px]">
      <PoliQueue
        title={worklist.poli.name}
        items={worklist.items}
        selectedId={current?.patientId ?? ''}
        statusOf={statusOf}
        waitOf={waitOf}
        next={next}
        onCallNext={callNext}
        called={called}
        canCall={isDoctor}
      />
      <section aria-label="Rekam medis pasien" className="flex min-w-0 flex-col gap-4">
        <KlinisPatientHeader patient={encounter.patient} attending={encounter.doctor} actions={actions} />
        {tasks.errorFor('panggil') && (
          <p role="alert" className="m-0 text-small text-danger">
            {tasks.errorFor('panggil')}
          </p>
        )}
        <VisitStepper stage={encounter.stage} />
        <VitalsCard
          key={`${encounter.encounterId}-${encounter.vitalsAt ?? ''}`}
          encounterId={encounter.encounterId}
          vitals={encounter.vitals}
          vitalsAt={encounter.vitalsAt}
          isNurse={isNurse}
          scenarioPatient={scenarioPatient}
          tasks={tasks}
          cdsNote={encounter.cdsNote}
        />
        <SoapForm
          key={`${encounter.encounterId}-${encounter.diagnoses.map((d) => d.code).join()}-${encounter.soap.savedAt ?? ''}-${encounter.soap.signedAt ?? ''}`}
          encounter={encounter}
          canWrite={isDoctor}
          scenarioPatient={scenarioPatient}
          tasks={tasks}
          cpoeHref={cpoeHref}
          kasirHref={kasirHref}
          onSigned={(at) => {
            if (current)
              setLocal((cur) => ({
                ...cur,
                [current.patientId]: { status: 'selesai', wait: `selesai ${at}` },
              }));
          }}
        />
      </section>
      <div className="min-w-0 lg:col-span-2 2xl:col-span-1">{aside}</div>
    </div>
  );
}
