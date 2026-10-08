import type { LabOrderDetail, LabQcRun, LabTestDefinition } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import Link from 'next/link';
import { LabApiWorkspace } from '@/components/penunjang/lab-api-workspace';
import { ApiError } from '@/lib/server/api-core';
import {
  getLabInboundIssuesApi,
  getLabOrderApi,
  getLabQcApi,
  getLabTestsApi,
  getLabWorklistApi,
} from '@/lib/server/data/penunjang/lab';
import { can, type SessionView } from '@/lib/session-view';

/**
 * S01 · Laboratorium mode api (potongan 4.2): worklist unit lab dari `/api/v1/lab/worklist` (order CPOE baru + order
 * lab berjalan), detail order terpilih (`?order=`), kiriman CPOE terpilih yang belum diterima (`?kiriman=`), pesan
 * analyzer bermasalah, dan QC hari ini. Semua aturan (status spesimen, flag, gerbang nilai kritis/QC, urutan
 * validasi) ditegakkan API; layar hanya menampilkan dan memanggil Server Action (`actions.ts`).
 */
export async function ApiLab({
  session,
  view,
  order,
  kiriman,
}: {
  session: SessionView;
  view: 'aktif' | 'selesai';
  order: string | null;
  kiriman: string | null;
}) {
  const canQc = can(session, 'lab.qc', 'read');
  let data;
  try {
    const [worklist, issues, tests, qc] = await Promise.all([
      getLabWorklistApi(view),
      getLabInboundIssuesApi(),
      canQc ? getLabTestsApi() : Promise.resolve([] as LabTestDefinition[]),
      canQc ? getLabQcApi() : Promise.resolve([] as LabQcRun[]),
    ]);
    const pending = kiriman
      ? (worklist.find((w) => !w.labOrderId && w.orders[0]?.orderGroupId === kiriman) ?? null)
      : null;
    const pick = order ?? (pending ? null : (worklist.find((w) => w.labOrderId)?.labOrderId ?? null));
    let detail: LabOrderDetail | null = null;
    if (pick) {
      try {
        detail = await getLabOrderApi(pick);
      } catch (err) {
        if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 403)) throw err;
      }
    }
    data = { worklist, issues, tests, qc, pending, detail } as const;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Laboratorium</h1>
          <Alert level="warning" title="Akses ditolak">
            {err.message}
          </Alert>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Penunjang / Laboratorium · S01 · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Laboratorium</h1>
        </div>
        <nav aria-label="Tampilan worklist" className="flex gap-2">
          {(['aktif', 'selesai'] as const).map((v) => (
            <Link
              key={v}
              href={`/penunjang/lab?view=${v}`}
              aria-current={v === view ? 'page' : undefined}
              className={
                v === view
                  ? 'inline-flex h-11 items-center rounded-full bg-nav-active px-3.5 text-small font-semibold text-white no-underline'
                  : 'inline-flex h-11 items-center rounded-full border border-line-strong bg-white/90 px-3.5 text-small text-ink-900 no-underline hover:bg-brand-50/60'
              }
            >
              {v === 'aktif' ? 'Berjalan' : 'Selesai 7 hari'}
            </Link>
          ))}
        </nav>
      </header>
      {!session.unit && (
        <Alert level="info" title="Belum ada unit penugasan">
          Worklist laboratorium mengikuti unit penugasan. Masuk dengan posisi di unit laboratorium.
        </Alert>
      )}
      <LabApiWorkspace
        view={view}
        worklist={data.worklist}
        pending={data.pending}
        detail={data.detail}
        issues={data.issues}
        tests={data.tests}
        qc={data.qc}
        can={{
          accept: can(session, 'lab.specimen', 'receive'),
          collect: can(session, 'lab.specimen', 'collect'),
          receive: can(session, 'lab.specimen', 'receive'),
          reject: can(session, 'lab.specimen', 'reject'),
          write: can(session, 'lab.result', 'write'),
          verify: can(session, 'lab.result', 'verify'),
          release: can(session, 'lab.result', 'release'),
          correct: can(session, 'lab.result', 'correct'),
          qcWrite: can(session, 'lab.qc', 'write'),
          qcRead: canQc,
          critical: can(session, 'critical_result', 'read'),
        }}
      />
    </div>
  );
}
