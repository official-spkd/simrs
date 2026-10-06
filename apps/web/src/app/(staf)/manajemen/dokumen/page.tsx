import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DocumentBoard } from '@/components/dokumen/document-board';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { pct, reviewStatus } from '@/lib/dokumen';
import { getRegDocs } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Dokumen & akreditasi' };

/**
 * B12 · Dokumen regulasi dan akreditasi (rencana fase 8 §8.7, tanpa mockup): DMS berversi, distribusi + tanda terima
 * baca, paket bukti akreditasi. Mode presentasi: data dummy (ADR-0023).
 */
export default async function DokumenPage() {
  const { screen, allowed } = await requireDemoScreen('regdok');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getRegDocs();
  const published = d.docs.filter((x) => x.status === 'terbit');
  const review = published.filter((x) => reviewStatus(x.reviewDue, DEMO_TODAY).status !== 'aman');
  const process = d.docs.filter((x) => ['draf', 'telaah', 'disetujui'].includes(x.status)).length;
  const ev = d.chapters.reduce((t, c) => ({ n: t.n + c.withEvidence, total: t.total + c.elements }), {
    n: 0,
    total: 0,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Dokumen regulasi dan akreditasi · B12 · data per ${formatJam(DEMO_NOW)}`}
        title="Dokumen regulasi dan akreditasi"
      />
      <div role="region" aria-label="Ringkasan dokumen" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Dokumen berlaku"
          value={String(published.length)}
          detail="kebijakan, pedoman, panduan, SPO"
        />
        <KpiCard
          label="Perlu tinjau ulang"
          value={String(review.length)}
          hint={review.map((x) => x.code).join(', ') || 'tidak ada'}
          detail="≤ 60 hari atau lewat"
          tone={review.length ? 'warning' : 'success'}
          tinted
        />
        <KpiCard label="Dalam proses" value={String(process)} detail="draf, telaah, menunggu terbit" />
        <KpiCard
          label="Bukti akreditasi"
          value={`${pct(ev.n, ev.total)}%`}
          hint={`${ev.total - ev.n} elemen belum berbukti`}
          detail={`${d.chapters.length} bab dipantau`}
          tone="warning"
          tinted
        />
      </div>
      <DocumentBoard
        initialDocs={d.docs}
        approvers={d.approvers}
        units={d.units}
        receipts={d.receipts}
        chapters={d.chapters}
        today={DEMO_TODAY}
      />
    </div>
  );
}
