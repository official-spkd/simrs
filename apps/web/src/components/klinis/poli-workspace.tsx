'use client';

import {
  formatJam,
  POLI_VISIT_STAGES,
  type PoliEncounter,
  type PoliQueueItem,
  type PoliQueueStatus,
  type PoliWorklist,
} from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  canRecordVitals,
  canWriteDoctorNote,
  canWriteOrders,
  cpptNeedsCosign,
  nextWaiting,
} from '@/lib/klinis';
import { KlinisPatientHeader } from './patient-header';
import { PoliContext } from './poli-context';
import { PoliQueue } from './poli-queue';
import { SoapForm } from './soap-form';
import { type ScenarioBinding, useScenarioTasks } from './use-scenario-tasks';
import { VisitStepper } from './visit-panels';
import { VitalsCard } from './vitals-card';

/**
 * Tiga kolom pemeriksaan poli (mockup Main): antrean | rekam medis kunjungan | konteks pasien. Status antrean yang
 * diubah di layar ini (panggil, selesai) disimpan lokal (simulasi, tidak disimpan); setelah tanda tangan tahapan
 * kunjungan maju ke Kasir dan surat kontrol/keterangan tercatat dibuat (mockup: `activeIdx = signed ? 5`).
 */
export function PoliWorkspace({
  worklist,
  encounter,
  role,
  binding,
  cpoeHref,
  kasirHref,
  rujukHref,
}: {
  worklist: PoliWorklist;
  encounter: PoliEncounter;
  role: string | null;
  binding: ScenarioBinding | null;
  cpoeHref: string;
  kasirHref: string | null;
  /** Layar rujukan (tombol "Rujuk" di banner pasien), null bila layar belum tersedia. */
  rujukHref: string | null;
}) {
  const router = useRouter();
  const tasks = useScenarioTasks(binding);
  const [local, setLocal] = useState<Record<string, { status: PoliQueueStatus; wait: string }>>({});
  const [called, setCalled] = useState<string | null>(null);
  /** Jam tanda tangan CPPT per kunjungan yang diselesaikan di layar ini. */
  const [signedHere, setSignedHere] = useState<Record<string, string>>({});
  const statusOf = (i: PoliQueueItem) => (i.scenario ? i.status : (local[i.patientId]?.status ?? i.status));
  const waitOf = (i: PoliQueueItem) => (i.scenario ? i.waitNote : (local[i.patientId]?.wait ?? i.waitNote));
  const isDoctor = canWriteDoctorNote(role);
  const canOrder = canWriteOrders(role);
  const isNurse = canRecordVitals(role);
  const current = worklist.items.find((i) => i.encounterId === encounter.encounterId);
  const scenarioPatient = Boolean(current?.scenario);
  const next = nextWaiting(worklist.items, statusOf);
  const signedNow = signedHere[encounter.encounterId] ?? null;
  // Mockup: catatan dibuat saat pasien dipanggil ("mulai 08.53") bila belum ada draf.
  const wait = current ? waitOf(current) : '';
  const createdFallback = wait.startsWith('mulai ') ? wait.slice('mulai '.length) : null;

  const callNext = () => {
    if (!next) return;
    const t = formatJam(demoNow());
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
        <Button
          type="button"
          variant="primary"
          disabled={!tasks.enabled('panggil')}
          onClick={() => tasks.run('panggil', true)}
        >
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
      {isDoctor && rujukHref && (
        <Link
          href={rujukHref}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-white px-3 text-small font-medium text-ink-900 no-underline"
        >
          <Icon name="arrowRight" size={16} />
          Rujuk
        </Link>
      )}
      {canOrder && (
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
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)] min-[1400px]:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(240px,280px)]">
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
        <VisitStepper stage={signedNow ? POLI_VISIT_STAGES.length - 1 : encounter.stage} />
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
          canOrder={canOrder}
          resident={cpptNeedsCosign(role)}
          scenarioPatient={scenarioPatient}
          tasks={tasks}
          cpoeHref={cpoeHref}
          kasirHref={kasirHref}
          createdFallback={createdFallback}
          onSigned={(at) => {
            setSignedHere((cur) => ({ ...cur, [encounter.encounterId]: at }));
            if (current)
              setLocal((cur) => ({
                ...cur,
                [current.patientId]: { status: 'selesai', wait: `selesai ${at}` },
              }));
          }}
        />
      </section>
      <div className="min-w-0 lg:col-span-2 min-[1400px]:col-span-1">
        <PoliContext encounter={encounter} signed={Boolean(signedNow)} />
      </div>
    </div>
  );
}
