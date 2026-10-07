import { formatTanggalWaktu } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import Link from 'next/link';
import { WorklistBoard } from '@/components/rme/worklist-board';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { WORKLIST_PATIENTS, WORKLIST_TASKS } from '@/lib/demo/fixtures/rme-worklist';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { openRoute } from '@/lib/rme';
import { WORKLIST_ROLE_TITLE, worklistRole } from '@/lib/rme-worklist';
import { criticalFor, criticalStatusText, worklistDone } from '@/lib/rme-worklist-toko';
import { screenById } from '@/lib/screens';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { worklistExtras, worklistSources } from '@/lib/server/data/klinis/worklist';

/** Layar tindak lanjut tugas worklist. */
const TARGETS = ['ringkasan', 'cppt', 'asesmen', 'askep', 'edukasi', 'konsul', 'paket', 'order', 'resume'];

/**
 * K01 · Worklist klinis per posisi (DPJP, residen, perawat, bidan): pasien saya dan tugas tertunda (nilai kritis,
 * co-sign, verifikasi CPPT, tinjau order residen, hasil baru, konsul, obat jatuh tempo, serah terima). Mode
 * presentasi: tugas fiktif hari demo (ADR-0023) yang statusnya dihitung dari toko demo (ADR-0085): rekam
 * `rekam-medis` dan laporan nilai kritis `hasil-kritis`; backend `GET /api/v1/worklist` menyusul (rencana fase 3).
 */
export async function DemoWorklist({
  access,
}: {
  access: DemoScreenAccess;
  pasien?: string | string[] | undefined;
}) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const roleCode = session.role?.code ?? null;
  const role = worklistRole(roleCode);
  const routes = Object.fromEntries(TARGETS.map((id) => [id, openRoute(id, roleCode)]));
  const labels = Object.fromEntries(TARGETS.map((id) => [id, screenById(id)?.label ?? id]));
  const tasks = role ? WORKLIST_TASKS[role] : [];
  const { extra, rev } = await worklistExtras(tasks);
  const src = await worklistSources(session, tasks, extra);
  const done = worklistDone(tasks, src);
  const notes = Object.fromEntries(
    tasks.flatMap((t) => {
      const c = criticalFor(t, src);
      return c ? [[t.id, criticalStatusText(c)]] : [];
    }),
  );
  const patients = (role ? WORKLIST_PATIENTS[role] : []).flatMap((x) => {
    const p = patientById(x.patientId);
    return p ? [{ ...x, name: p.nama, rm: p.rm, allergies: p.alergi }] : [];
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Klinis / Worklist · {session.tenant.name} · data per {formatTanggalWaktu(DEMO_NOW)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">
          Worklist klinis · {session.user.displayName}
        </h1>
        <span className="text-small text-ink-500">
          {role ? WORKLIST_ROLE_TITLE[role] : 'Posisi non-klinis'} · tugas tertunda diurutkan dari yang paling
          mendesak
        </span>
      </header>
      {!role ? (
        <Alert level="info" title="Worklist untuk posisi klinis">
          Worklist berisi pasien dan tugas DPJP, residen, perawat, dan bidan.{' '}
          <Link href="/akun/posisi">Ganti posisi</Link> untuk melihatnya.
        </Alert>
      ) : (
        <WorklistBoard
          role={role}
          now={DEMO_NOW}
          tasks={tasks}
          done={done}
          notes={notes}
          rev={rev}
          patients={patients}
          routes={routes}
          screenLabels={labels}
        />
      )}
    </div>
  );
}
