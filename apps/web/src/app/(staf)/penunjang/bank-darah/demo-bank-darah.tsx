import { formatTanggalWaktu } from '@simrs/shared';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { BloodBankWorkspace } from '@/components/penunjang/bank-darah-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getBloodBank } from '@/lib/server/data/penunjang/bank-darah';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';

/**
 * S08 · Bank darah: permintaan, golongan dan crossmatch, pengeluaran kantong dengan cek ganda dua petugas, pindai
 * gelang + kantong di samping pasien, dan pemantauan reaksi transfusi. Mode presentasi: data dummy (ADR-0023); dibekukan, jalur api di `page.tsx`.
 */
export async function DemoBankDarah({ access }: { access: DemoScreenAccess }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getBloodBank();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Penunjang / Bank darah RS · S08 · {session.tenant.name} · data per {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Bank darah · permintaan dan transfusi</h1>
      </header>
      <ScenarioBanner session={session} screen="bank-darah" />
      <BloodBankWorkspace userId={session.user.id} data={data} userName={session.user.displayName} />
    </div>
  );
}
