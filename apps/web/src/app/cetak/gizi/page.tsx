import {
  formatTanggal,
  isoDateJakarta,
  MEAL_LABEL,
  MEALS,
  type MealList,
  TEXTURE_LABEL,
} from '@simrs/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/server/api-core';
import { mealList } from '@/lib/server/data/penunjang/penunjang-api';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can } from '@/lib/session-view';
import { PrintActions } from './print-actions';

export const metadata: Metadata = { title: 'Cetak daftar makan' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Meal = (typeof MEALS)[number];

/** A4: daftar per bangsal di halaman pertama, lalu label 70 × 35 mm (3 kolom). Hanya berlaku di halaman ini. */
const PRINT_CSS = `
@page { size: A4; margin: 10mm; }
@media print {
  .print-actions { display: none !important; }
  body { background: #fff !important; }
  .labels { page-break-before: always; }
}
`;

/**
 * S07 · Cetak HTML daftar makan per bangsal × jam makan + label makanan (rencana fase 4 §4.9, keputusan no. 1). Label
 * memuat dua pengenal (nama + No. RM), bangsal/bed, diet + tekstur, catatan dapur, dan alergi. Mode api saja;
 * `nutrition.read`; data dari API yang sama dengan layar Gizi (ABAC + audit `read` per pasien di API). Di luar
 * kerangka staf.
 */
export default async function CetakGiziPage({ searchParams }: { searchParams: SearchParams }) {
  if (webEnv().dataSource === 'demo') notFound();
  const session = await requireSession();
  if (!can(session, 'nutrition', 'read')) {
    return <p className="p-6 text-small">Peran Anda tidak berizin mencetak daftar makan.</p>;
  }
  const sp = await searchParams;
  const tanggal =
    typeof sp.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal) ? sp.tanggal : isoDateJakarta();
  const jam = (MEALS as readonly string[]).includes(String(sp.jam)) ? (sp.jam as Meal) : 'siang';
  const unit = typeof sp.unit === 'string' && /^[0-9a-f-]{36}$/i.test(sp.unit) ? sp.unit : undefined;
  let list: MealList;
  try {
    list = await mealList({ date: tanggal, meal: jam, unitId: unit });
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) {
      return <p className="p-6 text-small">Daftar makan tidak bisa dimuat: {err.message}</p>;
    }
    throw err;
  }
  const byUnit = new Map<string, MealList['rows']>();
  for (const r of list.rows) {
    const k = r.patient.unitName ?? 'Tanpa bangsal';
    byUnit.set(k, [...(byUnit.get(k) ?? []), r]);
  }
  return (
    <main className="flex min-h-screen flex-col gap-4 bg-white p-4 text-black">
      <style>{PRINT_CSS}</style>
      <PrintActions />
      <header>
        <h1 className="m-0 text-[18px] font-bold">
          Daftar makan · {MEAL_LABEL[jam]} · {formatTanggal(tanggal)}
        </h1>
        <p className="m-0 text-[12px]">
          {session.tenant.name} · {list.rows.length} porsi · dicetak {session.user.displayName}
        </p>
      </header>
      {[...byUnit.entries()].map(([unitName, rows]) => (
        <section key={unitName} aria-label={`Daftar makan ${unitName}`}>
          <h2 className="m-0 mb-1 text-[14px] font-bold">
            {unitName} ({rows.length})
          </h2>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {['Bed', 'Pasien', 'No. RM', 'Diet', 'Tekstur', 'Catatan / alergi'].map((h) => (
                  <th key={h} className="border border-black px-1.5 py-1 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dietOrderId}>
                  <td className="border border-black px-1.5 py-1">{r.patient.bed ?? '–'}</td>
                  <td className="border border-black px-1.5 py-1">{r.patient.name}</td>
                  <td className="border border-black px-1.5 py-1 font-mono">{r.patient.mrn}</td>
                  <td className="border border-black px-1.5 py-1">{r.dietType.name}</td>
                  <td className="border border-black px-1.5 py-1">{TEXTURE_LABEL[r.texture]}</td>
                  <td className="border border-black px-1.5 py-1">
                    {[r.notes, r.allergies.length ? `Alergi: ${r.allergies.join('; ')}` : null]
                      .filter(Boolean)
                      .join(' · ') || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {list.rows.length === 0 && (
        <p className="text-[12px]">Belum ada order diet aktif untuk jam makan ini.</p>
      )}
      <section aria-label="Label makanan" className="labels grid grid-cols-3 gap-[3mm]">
        {list.rows.map((r) => (
          <article
            key={r.dietOrderId}
            aria-label={`Label ${r.patient.name}`}
            className="flex h-[35mm] flex-col justify-between overflow-hidden rounded-[2mm] border border-black p-[2mm] text-[10px] leading-tight"
          >
            <span className="truncate text-[12px] font-bold">{r.patient.name}</span>
            <span>
              RM <span className="font-mono font-semibold">{r.patient.mrn}</span>
              {r.patient.birthDate ? ` · lahir ${formatTanggal(r.patient.birthDate)}` : ''}
            </span>
            <span className="truncate">
              {r.patient.unitName ?? '–'}
              {r.patient.bed ? ` · ${r.patient.bed}` : ''}
            </span>
            <span className="truncate font-semibold">
              {r.dietType.name} · {TEXTURE_LABEL[r.texture]}
            </span>
            <span className="truncate">
              {MEAL_LABEL[jam]}
              {r.notes ? ` · ${r.notes}` : ''}
            </span>
            {r.allergies.length > 0 && (
              <span className="truncate font-bold">ALERGI: {r.allergies.join('; ')}</span>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
