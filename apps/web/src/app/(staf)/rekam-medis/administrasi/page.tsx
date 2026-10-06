import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { RecordsAdminBoard } from '@/components/rekam-medis-adm/records-admin-board';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { deadlineTone, hoursLeft, loanStatus, retentionCandidates, roiDeadline } from '@/lib/rekam-medis-adm';
import { getRecordsAdmin } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'RM administratif' };

const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n);

/**
 * B09 · Rekam medis administratif (rencana fase 8 §8.6c, tanpa mockup; isi dari prototipe alur): pelepasan
 * informasi/hak subjek data, peminjaman berkas, retensi dan pemusnahan. Mode presentasi: data dummy (ADR-0023),
 * aksi tersimpan di toko demo (domain `rekam-medis-adm`, ADR-0085).
 */
export default async function RekamMedisAdministrasiPage() {
  const { session, screen, allowed } = await requireDemoScreen('rm-adm');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getRecordsAdmin();

  const st = d.store.state;
  const active = st.loans.filter((l) => loanStatus(l, DEMO_TODAY) !== 'kembali');
  const overdue = active.filter((l) => loanStatus(l, DEMO_TODAY) === 'terlambat').length;
  const open = d.requests.filter((r) => {
    const p = st.roi[r.id];
    return !p || (p.stage < 3 && !p.rejected);
  });
  const tones = open.map((r) => deadlineTone(hoursLeft(roiDeadline(r.receivedAt), DEMO_NOW)));
  const late = tones.filter((t) => t === 'lewat').length;
  const near = tones.filter((t) => t === 'mendekati').length;
  const candidates = retentionCandidates(d.batches, DEMO_TODAY);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Rekam medis / Administrasi · B09 · data per ${formatJam(DEMO_NOW)}`}
        title="Rekam medis administratif"
      />
      <div
        role="region"
        aria-label="Ringkasan rekam medis administratif"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Permintaan informasi terbuka"
          value={String(open.length)}
          hint={late > 0 ? `${late} lewat tenggat` : `${near} mendekati tenggat`}
          detail="dijawab ≤ 3×24 jam (UU PDP)"
          tone={late > 0 ? 'danger' : near > 0 ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label="Berkas fisik dipinjam"
          value={String(active.length)}
          hint={overdue > 0 ? `${overdue} terlambat kembali` : 'semua dalam jatuh tempo'}
          detail="jatuh tempo 3 hari"
          tone={overdue > 0 ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Kandidat pemusnahan"
          value={`${fmt(candidates.reduce((n, c) => n + c.eligibleFiles, 0))} berkas`}
          detail={`${candidates.length} kelompok rak · menunggu usulan komite RM`}
        />
        <KpiCard
          label="Hak subjek data"
          value={String(open.filter((r) => r.kind !== 'pihak-ketiga').length)}
          hint={`${open.filter((r) => r.kind === 'koreksi').length} permintaan perbaikan data`}
          detail="akses, salinan, dan koreksi oleh pasien"
        />
      </div>
      {st.clinical.length > 0 && (
        <section
          aria-label="Masuk dari layar klinis"
          className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <h2 className="m-0 text-base font-semibold">Masuk dari layar klinis</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {st.clinical.map((c) => (
              <li key={`${c.kind}-${c.encounterId}`}>
                {c.patientName}
                {c.rm ? ` · RM ${c.rm}` : ''} · {c.detail} · {formatJam(c.at)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <RecordsAdminBoard
        data={d}
        today={DEMO_TODAY}
        now={DEMO_NOW}
        operator={session.user.displayName}
        viewerId={session.user.id}
        viewerRole={session.role?.code ?? null}
        counts={{ overdue, openRequests: open.length }}
      />
    </div>
  );
}
