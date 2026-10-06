import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { PayrollBoard } from '@/components/penggajian/payroll-board';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { formatRupiahShort } from '@/lib/manajemen';
import { computeSlip } from '@/lib/penggajian';
import { getPayroll } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Penggajian' };

/**
 * B05 · Penggajian (struktur, rencana fase 8 §8.3, tanpa mockup): run gaji periode, slip, jurnal gaji berpasangan.
 * Tarif iuran simulasi; mode presentasi data dummy (ADR-0023), run tersimpan di toko demo (domain `penggajian`).
 */
export default async function PenggajianPage() {
  const { session, screen, allowed } = await requireDemoScreen('penggajian');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getPayroll();
  const fixed = d.inputs.map((i) => computeSlip({ ...i, serviceFee: 0n, pph21: i.pph21 ?? 0n }));
  const fees = Object.values(d.serviceFees).reduce((n, v) => n + BigInt(v), 0n);
  const missing = d.store.state.stage > 0 ? 0 : d.inputs.filter((i) => i.pph21 === null).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Penggajian · B05 · data per ${formatJam(DEMO_NOW)}`}
        title={`Penggajian · ${d.period.label}`}
      />
      <div
        role="region"
        aria-label="Ringkasan penggajian"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Pegawai dalam run"
          value={String(d.inputs.length)}
          detail="contoh unit klinis dan administrasi"
        />
        <KpiCard
          label="Gaji tetap bruto"
          value={formatRupiahShort(fixed.reduce((n, s) => n + s.gross, 0n))}
          detail="gaji pokok + tunjangan"
        />
        <KpiCard
          label="Jasa pelayanan siap impor"
          value={formatRupiahShort(fees)}
          detail="dari modul jasa pelayanan"
        />
        <KpiCard
          label="PPh 21 belum diisi"
          value={String(missing)}
          hint={missing ? 'run belum bisa dihitung' : 'lengkap'}
          detail="diisi manual oleh bagian keuangan"
          tone={missing ? 'warning' : 'success'}
          tinted
        />
      </div>
      <PayrollBoard
        period={d.period}
        inputs={d.inputs}
        state={d.store.state}
        rev={d.store.rev}
        viewerId={session.user.id}
        viewerRole={session.role?.code ?? null}
      />
    </div>
  );
}
