import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { AccountingWorkspace } from '@/components/keuangan/accounting-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import type { MappingView } from '@/components/keuangan/accounting-workspace';
import { STATIC_JOURNALS } from '@/lib/demo/fixtures/keuangan';
import { formatRupiahRingkas } from '@/lib/keuangan';
import { needsMapping } from '@/lib/keuangan-akuntansi';
import { closeCheck } from '@/lib/keuangan-akuntansi-toko';
import { getAccountingStore } from '@/lib/server/data/keuangan';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Akuntansi' };

const pct = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1, signDisplay: 'always' });

/**
 * U04/U07/U09 · Akuntansi: jurnal otomatis, umur piutang, rekonsiliasi bank, tutup periode (mockup
 * `Akuntansi.dc.html`). Mode presentasi: data dummy fiktif + jurnal dari tonggak pasien skenario (ADR-0023) + toko
 * demo bersama (domain `akuntansi`, ADR-0085): jurnal otomatis dari Kasir dan layar keuangan lain, pemetaan +
 * persetujuan kedua, pemadanan, ekspor, dan tutup periode.
 */
export default async function AkuntansiPage() {
  const { session, screen, allowed } = await requireDemoScreen('akuntansi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { board, rev, state } = await getAccountingStore(session);
  const k = board.kpis;
  const toMap = STATIC_JOURNALS.find(needsMapping);
  const unmapped = toMap?.lines.find((l) => !l.account);
  const m = toMap ? state.mapped[toMap.id] : undefined;
  const a = toMap ? state.approved[toMap.id] : undefined;
  const mapping: MappingView | null = toMap
    ? {
        journalId: toMap.id,
        number: toMap.number,
        description: toMap.description,
        amount: unmapped ? (BigInt(unmapped.debit) + BigInt(unmapped.credit)).toString() : '0',
        mapped: m
          ? { by: m.by, at: m.at, code: m.code, name: m.name, mine: m.byId === session.user.id }
          : null,
        approved: a ? { by: a.by, at: a.at } : null,
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <AccountingWorkspace
        heading={
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-ink-500">
              Keuangan / Akuntansi / Periode {board.period.label} · {session.tenant.name}
            </span>
            <h1 className="m-0 text-h1 font-semibold">Akuntansi · jurnal dan piutang</h1>
          </div>
        }
        banner={<ScenarioBanner session={session} screen="akuntansi" />}
        board={board}
        rev={rev}
        mapping={mapping}
        matched={Object.fromEntries(
          Object.entries(state.matched).map(([id, v]) => [id, { by: v.by, at: v.at }]),
        )}
        close={closeCheck(state)}
        closed={state.closed ? { by: state.closed.by, at: state.closed.at } : null}
        lastExport={state.lastExport ? { by: state.lastExport.by, at: state.lastExport.at } : null}
        kpis={
          <div
            role="region"
            aria-label="Indikator keuangan"
            className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
          >
            <KpiCard
              label="Pendapatan MTD"
              value={formatRupiahRingkas(BigInt(k.revenueMtd))}
              hint={`${pct.format(k.revenueDeltaPercent)}% vs bulan lalu (hari sama)`}
              tone="success"
            />
            <KpiCard
              label="Piutang BPJS"
              value={formatRupiahRingkas(BigInt(k.bpjsReceivable))}
              detail={`rata-rata cair ${k.avgCollectionDays} hari`}
            />
            <KpiCard
              label="Kas dan bank"
              value={formatRupiahRingkas(BigInt(k.cashAndBank))}
              hint={`cukup ${k.cashDays} hari operasional`}
              tone="success"
              tinted
            />
            <KpiCard
              label="Utang jatuh tempo 7 hari"
              value={formatRupiahRingkas(BigInt(k.payablesDue7d))}
              hint={`${k.suppliersDue} pemasok`}
              tone="warning"
              tinted
            />
          </div>
        }
      />
    </div>
  );
}
