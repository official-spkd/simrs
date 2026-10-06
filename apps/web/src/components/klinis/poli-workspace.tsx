'use client';

import { POLI_VISIT_STAGES, type PoliEncounter, type PoliQueueItem, type PoliWorklist } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callNextAction } from '@/app/(staf)/klinis/poli/actions-demo';
import { useStoreAction } from '@/lib/demo/store/client';
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
 * Tiga kolom pemeriksaan poli (mockup Main): antrean | rekam medis kunjungan | konteks pasien. Panggil pasien,
 * tanda vital, dan CPPT tersimpan di toko demo (`klinis-poli`, ADR-0085); status antrean dan tahapan kunjungan datang
 * dari server. Setelah tanda tangan tahapan kunjungan maju ke Kasir dan surat kontrol/keterangan tercatat dibuat
 * (mockup: `activeIdx = signed ? 5`).
 */
export function PoliWorkspace({
  worklist,
  encounter,
  role,
  binding,
  cpoeHref,
  kasirHref,
  rujukHref,
  rev,
  pendingCosign,
}: {
  worklist: PoliWorklist;
  encounter: PoliEncounter;
  role: string | null;
  binding: ScenarioBinding | null;
  cpoeHref: string;
  kasirHref: string | null;
  /** Layar rujukan (tombol "Rujuk" di banner pasien), null bila layar belum tersedia. */
  rujukHref: string | null;
  /** Revisi toko `klinis-poli`. */
  rev: number;
  /** CPPT residen kunjungan ini yang menunggu co-sign DPJP (server). */
  pendingCosign: { at: string; author: string } | null;
}) {
  const router = useRouter();
  const tasks = useScenarioTasks(binding);
  const { run, pending } = useStoreAction(rev);
  const [called, setCalled] = useState<string | null>(null);
  const statusOf = (i: PoliQueueItem) => i.status;
  const waitOf = (i: PoliQueueItem) => i.waitNote;
  const isDoctor = canWriteDoctorNote(role);
  const canOrder = canWriteOrders(role);
  const isNurse = canRecordVitals(role);
  const current = worklist.items.find((i) => i.encounterId === encounter.encounterId);
  const scenarioPatient = Boolean(current?.scenario);
  const next = nextWaiting(worklist.items, statusOf);
  const signedNow = encounter.soap.signedAt;
  // Mockup: catatan dibuat saat pasien dipanggil ("mulai 08.53") bila belum ada draf.
  const wait = current ? waitOf(current) : '';
  const createdFallback = wait.startsWith('mulai ') ? wait.slice('mulai '.length) : null;

  const callNext = () => {
    if (!next || pending) return;
    if (next.scenario) {
      setCalled(`${next.queueNo} · ${next.name} adalah pasien skenario: buka lalu tekan "Panggil pasien".`);
      router.push(`/klinis/poli?pasien=${next.patientId}`, { scroll: false });
      return;
    }
    run(
      (r) => callNextAction(r),
      (res) => {
        setCalled(res.ok ? (res.message ?? null) : (res.error ?? 'Pasien belum dipanggil.'));
        if (res.patientId) router.push(`/klinis/poli?pasien=${res.patientId}`, { scroll: false });
      },
    );
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
          key={`tanda-vital-${encounter.encounterId}${scenarioPatient ? `-${encounter.vitalsAt ?? ''}` : ''}`}
          rev={rev}
          encounterId={encounter.encounterId}
          vitals={encounter.vitals}
          vitalsAt={encounter.vitalsAt}
          isNurse={isNurse}
          scenarioPatient={scenarioPatient}
          tasks={tasks}
          cdsNote={encounter.cdsNote}
        />
        <SoapForm
          // Pasien skenario: catatan dimuat ulang saat tugas skenario mengubahnya; pasien lain: isian dokter tetap
          // selama aksi tersimpan (status catatan datang dari server lewat props).
          key={
            scenarioPatient
              ? `soap-${encounter.encounterId}-${encounter.diagnoses.map((d) => d.code).join()}-${encounter.soap.savedAt ?? ''}-${encounter.soap.signedAt ?? ''}`
              : `soap-${encounter.encounterId}`
          }
          rev={rev}
          pendingCosign={pendingCosign}
          canCosign={role === 'dokter'}
          encounter={encounter}
          canWrite={isDoctor}
          canOrder={canOrder}
          resident={cpptNeedsCosign(role)}
          scenarioPatient={scenarioPatient}
          tasks={tasks}
          cpoeHref={cpoeHref}
          kasirHref={kasirHref}
          createdFallback={createdFallback}
        />
      </section>
      <div className="min-w-0 lg:col-span-2 min-[1400px]:col-span-1">
        <PoliContext encounter={encounter} signed={Boolean(signedNow)} />
      </div>
    </div>
  );
}
