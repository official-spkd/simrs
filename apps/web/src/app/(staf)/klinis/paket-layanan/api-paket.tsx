import { CARE_SETTINGS, type CareSetting } from '@simrs/shared';
import { cx } from '@simrs/ui';
import Link from 'next/link';
import { CarePackagesBoard } from '@/components/klinis/care-packages-board';
import { SETTING_LABEL } from '@/components/klinis/completeness-card';
import { carePackages, publishedForms } from '@/lib/server/data/klinis/konsul';
import { can, type SessionView } from '@/lib/session-view';

const ROUTE = '/klinis/paket-layanan';

/**
 * K15 · Layar Paket layanan mode api (fase 3 · 3.8, ADR-0059): paket formulir per setting (rawat jalan, IGD, rawat
 * inap) yang menjadi dasar kelengkapan asesmen kunjungan (EP 6b/7a). Kelengkapan per kunjungan tampil di tab
 * "Dokumen & konsultasi" Rawat inap. Paket layanan khusus (HD/kemo/ANC) tetap mode presentasi (keputusan fase 3
 * no. 18: hanya mekanisme).
 */
export async function ApiPaket({ session, setting }: { session: SessionView; setting: CareSetting }) {
  const canManage = can(session, 'forms.definition', 'write');
  const [items, forms] = await Promise.all([carePackages(setting), canManage ? publishedForms() : []]);
  const inPackage = new Set(items.map((i) => i.formCode));
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Klinis / Paket layanan · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Paket formulir per setting</h1>
      </header>
      <nav aria-label="Setting layanan" className="flex flex-wrap gap-1.5">
        {CARE_SETTINGS.map((s) => {
          const on = s === setting;
          return (
            <Link
              key={s}
              href={`${ROUTE}?setting=${s}`}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'inline-flex h-11 items-center rounded-full border px-3.5 text-small no-underline',
                on
                  ? 'border-transparent bg-nav-active font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
                  : 'border-line-strong bg-white/90 text-ink-700 hover:bg-brand-50/60',
              )}
            >
              {SETTING_LABEL[s]}
            </Link>
          );
        })}
      </nav>
      <CarePackagesBoard
        key={setting}
        setting={setting}
        settingLabel={SETTING_LABEL[setting]}
        items={items}
        forms={forms.filter((f) => !inPackage.has(f.code))}
        canManage={canManage}
      />
    </div>
  );
}
