import { formatJam, type InpatientCensusItem } from '@simrs/shared';
import { Chip, cx, KpiCard } from '@simrs/ui';
import Link from 'next/link';
import { ewsLevel } from '@/lib/rawat-inap';
import { getInpatientCensus } from '@/lib/server/data/klinis/ranap-api';
import type { SessionView } from '@/lib/session-view';
import { EwsLive } from './ews-live';

const COLS = 'lg:grid-cols-[120px_1.6fr_1.5fr_1.3fr_64px_110px_1.4fr]';
const SEX: Record<InpatientCensusItem['sex'], string> = { male: 'L', female: 'P', unknown: '–' };

/** Label pasien di peringatan EWS langsung (hanya pasien yang sudah lolos ABAC di daftar ini). */
export function patientLabel(x: InpatientCensusItem): string {
  return `${x.name}${x.bed ? ` · bed ${x.bed.code}` : ''}`;
}

/**
 * K04 · Daftar pasien rawat inap mode api (fase 3 layar W4): pasien per unit/bed dari `/api/v1/inpatients`, disaring
 * ABAC di API (lingkup unit tingkat bed, relasi tim perawatan, akses darurat) dan diaudit per pasien. Eskalasi EWS
 * langsung lewat SSE `ews`. `unit` = saringan unit (id dari daftar unit yang terlihat).
 */
export async function ApiRawatInap({ session, unit }: { session: SessionView; unit: string | null }) {
  const census = await getInpatientCensus(null);
  const selected = census.units.find((u) => u.id === unit) ?? null;
  const list = selected ? census.items.filter((x) => x.unit.id === selected.id) : census.items;
  const all = census.items;
  const labels = Object.fromEntries(all.map((x) => [x.encounterId, patientLabel(x)]));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Klinis / Rawat inap · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Pasien rawat inap</h1>
      </header>
      <EwsLive patients={labels} />
      <div role="region" aria-label="Ringkasan rawat inap" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Pasien di daftar ini" value={all.length} detail="pasien yang boleh Anda buka" />
        <KpiCard
          label="Menunggu co-sign DPJP"
          value={all.filter((x) => x.pendingCosign > 0).length}
          hint="catatan residen"
          tone="warning"
          tinted
        />
        <KpiCard
          label="Obat terlambat"
          value={all.filter((x) => x.lateDoses > 0).length}
          hint="perlu alasan"
          tone="danger"
          tinted
        />
        <KpiCard
          label="EWS perlu eskalasi"
          value={all.filter((x) => x.ews?.escalated).length}
          hint="tinjau segera"
          tone="danger"
        />
      </div>
      {census.units.length > 1 && (
        <nav aria-label="Filter bangsal" className="flex flex-wrap gap-1.5">
          {[{ id: null, name: 'Semua bangsal', count: all.length }, ...census.units].map((w) => {
            const on = (w.id ?? null) === (selected?.id ?? null);
            return (
              <Link
                key={w.id ?? 'semua'}
                href={w.id ? `?unit=${w.id}` : '?'}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'inline-flex h-11 items-center rounded-full border px-3.5 text-small no-underline',
                  on
                    ? 'border-transparent bg-nav-active font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
                    : 'border-line-strong bg-white/90 text-ink-700 hover:bg-brand-50/60',
                )}
              >
                {w.name} · {w.count}
              </Link>
            );
          })}
        </nav>
      )}
      <section
        aria-label="Daftar pasien rawat inap"
        className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <div
          aria-hidden="true"
          className={cx('hidden border-b border-line text-caption font-semibold text-ink-500 lg:grid', COLS)}
        >
          {['Bed', 'Pasien', 'Diagnosis', 'DPJP', 'Hari', 'EWS', 'Penanda'].map((h) => (
            <span key={h} className="px-3 py-2.5">
              {h}
            </span>
          ))}
        </div>
        <ul className="m-0 list-none p-0">
          {list.map((x) => {
            const lv = x.ews ? ewsLevel(x.ews.score, x.ews.maxParam) : null;
            return (
              <li key={x.encounterId} className="border-t border-line-soft">
                <Link
                  href={`/klinis/rawat-inap/${x.encounterId}`}
                  className={cx(
                    'grid grid-cols-[1fr_auto] gap-x-2 px-0 py-1 text-ink-900 no-underline hover:bg-brand-50/60 lg:py-0',
                    COLS,
                  )}
                >
                  <span className="px-3 py-1.5 lg:py-2.5">
                    <span className="block font-mono font-semibold">{x.bed?.code ?? 'Belum ber-bed'}</span>
                    <span className="block text-caption text-ink-500">{x.unit.name}</span>
                  </span>
                  <span className="order-first col-span-2 flex flex-col px-3 pt-2 lg:order-none lg:col-span-1 lg:py-2.5">
                    <span className="font-semibold text-brand-700 underline-offset-2 hover:underline">
                      {x.name}
                    </span>
                    <span className="text-caption text-ink-500">
                      RM <span className="font-mono">{x.mrn}</span> · {SEX[x.sex]}
                      {x.ageYears !== null ? ` · ${x.ageYears} th` : ''}
                    </span>
                  </span>
                  <span className="px-3 py-1.5 text-small lg:py-2.5">
                    {x.primaryDiagnosis ? (
                      <>
                        <span className="font-mono font-semibold">{x.primaryDiagnosis.code}</span>{' '}
                        {x.primaryDiagnosis.display}
                      </>
                    ) : (
                      <span className="text-ink-500">Diagnosis utama belum dicatat</span>
                    )}
                  </span>
                  <span className="hidden px-3 py-2.5 text-small text-ink-700 lg:block">{x.dpjp ?? '–'}</span>
                  <span className="px-3 py-1.5 text-small lg:py-2.5">H{x.day}</span>
                  <span className="px-3 py-1.5 lg:py-2.5">
                    {x.ews && lv ? (
                      <span
                        className={cx('rounded-full px-2 py-[3px] text-caption font-bold', lv.tone)}
                        title={`Observasi terakhir ${formatJam(x.ews.at)}`}
                      >
                        <span className="sr-only">EWS </span>
                        {x.ews.score} · {lv.level}
                      </span>
                    ) : (
                      <span className="text-caption text-ink-500">Belum ada TTV</span>
                    )}
                  </span>
                  <span className="col-span-2 flex flex-wrap gap-1 px-3 pb-2 lg:col-span-1 lg:py-2.5">
                    {x.ews?.escalated && <Chip tone="danger">Eskalasi EWS</Chip>}
                    {x.pendingCosign > 0 && <Chip tone="warning">Co-sign DPJP ({x.pendingCosign})</Chip>}
                    {x.lateDoses > 0 && <Chip tone="danger">Obat terlambat ({x.lateDoses})</Chip>}
                    {x.allergy.status === 'ada' && <Chip tone="danger">Alergi</Chip>}
                    {x.allergy.status === 'belum_dikaji' && <Chip tone="neutral">Alergi belum dikaji</Chip>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {list.length === 0 && (
          <p className="m-0 px-4 py-3.5 text-small text-ink-500">
            Tidak ada pasien rawat inap yang boleh Anda buka di sini. Daftar mengikuti unit penugasan sesi dan
            relasi Anda dengan pasien.
          </p>
        )}
      </section>
    </div>
  );
}
