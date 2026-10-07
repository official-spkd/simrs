'use client';

import type { PoliVital } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import { useState } from 'react';
import { NurseScenarioForm } from './nurse-scenario-form';
import { NurseVitalsForm } from './nurse-vitals-form';
import type { PoliOps } from './poli-ops';
import type { ScenarioTasks } from './use-scenario-tasks';
import { VitalTiles } from './visit-panels';

/**
 * Tanda vital + asesmen awal keperawatan (perawat/bidan mengisi; dokter melihat) + catatan CDS. Nilai dari server
 * (fixture + toko demo `klinis-poli`).
 */
export function VitalsCard({
  encounterId,
  vitals,
  vitalsAt,
  isNurse,
  scenarioPatient,
  tasks,
  cdsNote,
  ops,
}: {
  encounterId: string;
  vitals: readonly PoliVital[];
  vitalsAt: string | null;
  isNurse: boolean;
  scenarioPatient: boolean;
  tasks: ScenarioTasks;
  cdsNote: string;
  /** Aksi simpan tanda vital (mode presentasi atau api). */
  ops: PoliOps;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const shown = vitals;
  const at = vitalsAt;
  const nurseTasks = scenarioPatient && Boolean(tasks.task('td'));
  const pendingNurse = scenarioPatient && !vitalsAt;

  return (
    <>
      <section
        aria-label="Tanda vital"
        className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4 md:px-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-small font-semibold tracking-[0.04em] text-ink-700">
            TANDA VITAL · {at ? `diukur perawat ${at}` : 'belum diukur hari ini'}
          </h3>
          {isNurse && !scenarioPatient && !editing && (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Ukur ulang tanda vital
            </Button>
          )}
        </div>
        <VitalTiles vitals={shown} />
        {isNurse && nurseTasks && <NurseScenarioForm tasks={tasks} />}
        {isNurse && !scenarioPatient && editing && (
          <NurseVitalsForm
            encounterId={encounterId}
            vitals={shown}
            ops={ops}
            onSaved={(message) => {
              setSaved(message);
              setEditing(false);
            }}
          />
        )}
        {saved && !editing && (
          <p role="status" className="m-0 text-small font-semibold text-success">
            {saved}
          </p>
        )}
        {!isNurse && pendingNurse && (
          <p className="m-0 text-small text-ink-700">
            Menunggu asesmen awal keperawatan. Tanda vital tampil di sini begitu perawat menyimpannya.
          </p>
        )}
        {isNurse && scenarioPatient && !nurseTasks && pendingNurse && (
          <p className="m-0 text-small text-ink-700">
            Asesmen keperawatan pasien ini dibuka saat gilirannya di Simulasi.
          </p>
        )}
      </section>
      <div
        role="note"
        className="flex items-start gap-3 rounded-[14px] border border-kunyit-200 bg-alert-warning px-4 py-3"
      >
        <Icon name="info" size={18} className="mt-0.5 flex-none text-warning" />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-warning-strong">Cek klinis sebelum tanda tangan</span>
          <span className="text-small text-ink-700">{cdsNote}</span>
        </span>
      </div>
    </>
  );
}
