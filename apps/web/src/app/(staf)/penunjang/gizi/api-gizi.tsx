import {
  isoDateJakarta,
  jakartaParts,
  LEFTOVER_LABEL,
  MEAL_LABEL,
  MEALS,
  type MealList,
  TEXTURE_LABEL,
} from '@simrs/shared';
import { Alert, Chip } from '@simrs/ui';
import Link from 'next/link';
import { EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import {
  DietOrderForm,
  EndDietButton,
  MealRowActions,
  NpoControl,
  ScreeningForm,
  VerifyDietButton,
} from '@/components/penunjang/gizi-api';
import { formatTglJam } from '@/lib/rawat-inap';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import { dietTypes, encounterNutrition, mealList } from '@/lib/server/data/penunjang/penunjang-api';
import { can, type SessionView } from '@/lib/session-view';

const ROUTE = '/penunjang/gizi';
const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';
const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
type Meal = (typeof MEALS)[number];

/** Jam makan bawaan menurut jam WIB sekarang. */
function defaultMeal(now = new Date()): Meal {
  const h = Number(jakartaParts(now).hour);
  if (h < 9) return 'pagi';
  if (h < 11) return 'selingan_pagi';
  if (h < 14) return 'siang';
  if (h < 16) return 'selingan_sore';
  return 'malam';
}

export interface GiziQuery {
  tanggal?: string;
  jam?: string;
  unit?: string;
  kunjungan?: string;
  /** `?pilih=1`: pilih kunjungan untuk order diet baru. */
  pilih?: string;
}

/**
 * S07 · Layar Gizi mode api (fase 4 · 4.9, ADR-0105): daftar makan per bangsal × jam makan (= label makanan, cetak di
 * `/cetak/gizi`), catat antar + sisa makanan, dan order diet per kunjungan (`?kunjungan=`). Ahli gizi melihat semua
 * bangsal (tampilan layanan); perawat/dokter hanya pasien yang boleh dibukanya (ABAC di API).
 */
export async function ApiGizi({ session, query }: { session: SessionView; query: GiziQuery }) {
  const today = isoDateJakarta();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.tanggal ?? '') ? (query.tanggal as string) : today;
  const meal = (MEALS as readonly string[]).includes(query.jam ?? '') ? (query.jam as Meal) : defaultMeal();
  const unitId = /^[0-9a-f-]{36}$/i.test(query.unit ?? '') ? query.unit : undefined;
  const canWrite = can(session, 'nutrition', 'write');
  const canVerify = can(session, 'nutrition', 'verify');
  const [list, types] = await Promise.all([mealList({ date, meal, unitId }), dietTypes()]);
  const printHref = `/cetak/gizi?${new URLSearchParams({ tanggal: date, jam: meal, ...(unitId ? { unit: unitId } : {}) })}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Penunjang / Gizi · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Gizi</h1>
      </header>

      {query.kunjungan !== undefined || query.pilih ? (
        <DietSection
          raw={query.kunjungan}
          canWrite={canWrite}
          canVerify={canVerify}
          today={today}
          types={types}
        />
      ) : (
        canWrite && (
          <Link
            href={`${ROUTE}?pilih=1`}
            className="inline-flex min-h-11 items-center self-start rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
          >
            Order diet pasien…
          </Link>
        )
      )}

      <section aria-label="Daftar makan" className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="m-0 text-body font-semibold">
            Daftar makan · {MEAL_LABEL[meal]} · {date}
            <span className="ml-2 align-middle">
              <Chip tone="neutral">
                {list.view === 'layanan' ? 'Semua bangsal' : 'Pasien saya/unit saya'}
              </Chip>
            </span>
          </h2>
          <Link
            href={printHref}
            className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
          >
            Cetak daftar + label makanan
          </Link>
        </div>
        <form
          method="get"
          action={ROUTE}
          aria-label="Pilih jam makan"
          className="flex flex-wrap items-end gap-3"
        >
          <span className="flex flex-col gap-1">
            <label htmlFor="gz-tanggal" className="text-small font-semibold">
              Tanggal
            </label>
            <input id="gz-tanggal" name="tanggal" type="date" defaultValue={date} className={SELECT} />
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor="gz-jam" className="text-small font-semibold">
              Jam makan
            </label>
            <select id="gz-jam" name="jam" defaultValue={meal} className={SELECT}>
              {MEALS.map((m) => (
                <option key={m} value={m}>
                  {MEAL_LABEL[m]}
                </option>
              ))}
            </select>
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor="gz-unit" className="text-small font-semibold">
              Bangsal
            </label>
            <select id="gz-unit" name="unit" defaultValue={unitId ?? ''} className={SELECT}>
              <option value="">Semua ({list.units.reduce((n, u) => n + u.count, 0)})</option>
              {list.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.count})
                </option>
              ))}
            </select>
          </span>
          <button
            type="submit"
            className="h-11 rounded-control border border-line-strong bg-white px-3.5 text-small font-semibold"
          >
            Tampilkan
          </button>
        </form>
        <MealTable list={list} canWrite={canWrite} />
      </section>
    </div>
  );
}

function MealTable({ list, canWrite }: { list: MealList; canWrite: boolean }) {
  if (list.rows.length === 0) {
    return <p className="m-0 text-small text-ink-500">Belum ada order diet aktif untuk jam makan ini.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {list.rows.map((r) => (
        <li
          key={r.dietOrderId}
          aria-label={`Makan ${r.patient.name}`}
          className="flex flex-wrap items-start justify-between gap-3 rounded-control border border-line-soft bg-white px-3 py-2.5"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={`${ROUTE}?kunjungan=${r.encounterId}`}
              className="font-semibold text-ink-900 no-underline hover:underline"
            >
              {r.patient.name}
            </Link>
            <span className="text-caption text-ink-500">
              RM <span className="font-mono">{r.patient.mrn}</span> · {r.patient.unitName ?? '–'}
              {r.patient.bed ? ` · ${r.patient.bed}` : ''}
            </span>
            <span className="text-small">
              {r.dietType.name} · tekstur {TEXTURE_LABEL[r.texture].toLowerCase()}
              {r.notes ? ` · ${r.notes}` : ''}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {r.npo && <Chip tone="warning">Puasa</Chip>}
              {!r.verified && <Chip tone="warning">Belum diverifikasi</Chip>}
              {r.screening?.atRisk && <Chip tone="danger">MST {r.screening.score} · berisiko</Chip>}
              {!r.screening && <Chip tone="neutral">Belum skrining MST</Chip>}
            </span>
            {r.allergies.length > 0 && (
              <span className="text-small font-semibold text-danger">Alergi: {r.allergies.join('; ')}</span>
            )}
            <span className="text-caption text-ink-500">
              {r.service
                ? `${r.service.leftover ? `Sisa: ${LEFTOVER_LABEL[r.service.leftover]}` : 'Diantar'} · ${formatTglJam(r.service.recordedAt)} · ${r.service.recordedBy.name}`
                : 'Belum diantar'}
            </span>
          </span>
          <MealRowActions row={r} meal={list.meal} canWrite={canWrite} />
        </li>
      ))}
    </ul>
  );
}

async function DietSection({
  raw,
  canWrite,
  canVerify,
  today,
  types,
}: {
  raw: string | undefined;
  canWrite: boolean;
  canVerify: boolean;
  today: string;
  types: Awaited<ReturnType<typeof dietTypes>>;
}) {
  const res = await resolveEncounter(raw);
  if (res.kind !== 'ok') return <EncounterGate res={res} route={ROUTE} />;
  const { orders, npo, screenings } = await encounterNutrition(res.context.encounter.id);
  const active = orders.find((o) => o.status === 'aktif');
  const activeNpo = npo.find((n) => n.liftedAt === null) ?? null;
  const lastScreen = screenings[0] ?? null;
  return (
    <>
      <EncounterBanner context={res.context} />
      <section aria-label="Order diet" className={CARD}>
        <h2 className="m-0 text-body font-semibold">Order diet</h2>
        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-small">
              Aktif: <strong>{active.dietType.name}</strong> · tekstur{' '}
              {TEXTURE_LABEL[active.texture].toLowerCase()} · mulai {active.startsOn} · oleh{' '}
              {active.orderedBy.name}
              {active.notes ? ` · ${active.notes}` : ''}
            </p>
            <span className="flex flex-wrap items-center gap-2">
              {active.verifiedBy ? (
                <Chip tone="success">Diverifikasi {active.verifiedBy.name}</Chip>
              ) : canVerify ? (
                <VerifyDietButton dietOrderId={active.id} />
              ) : (
                <Chip tone="warning">Menunggu verifikasi ahli gizi</Chip>
              )}
              {canWrite && <EndDietButton dietOrderId={active.id} />}
            </span>
          </div>
        ) : (
          <Alert level="info" title="Belum ada diet aktif">
            Pasien belum mendapat makanan dari dapur sampai order diet disimpan.
          </Alert>
        )}
        {canWrite && <DietOrderForm encounterId={res.context.encounter.id} types={types} today={today} />}
      </section>
      <section aria-label="Puasa" className={CARD}>
        <h2 className="m-0 text-body font-semibold">Puasa (NPO)</h2>
        {canWrite ? (
          <NpoControl
            encounterId={res.context.encounter.id}
            active={activeNpo ? { id: activeNpo.id, reason: activeNpo.reason } : null}
          />
        ) : (
          <p className="m-0 text-small">{activeNpo ? `Puasa: ${activeNpo.reason}` : 'Tidak puasa.'}</p>
        )}
      </section>
      <section aria-label="Skrining gizi" className={CARD}>
        <h2 className="m-0 text-body font-semibold">Skrining gizi (MST)</h2>
        {lastScreen ? (
          <p className="m-0 text-small">
            Terakhir: skor <strong>{lastScreen.score}</strong> ·{' '}
            {lastScreen.atRisk ? 'berisiko malnutrisi (asuhan ahli gizi ≤ 24 jam)' : 'tidak berisiko'} ·{' '}
            {lastScreen.screenedBy.name}, {formatTglJam(lastScreen.screenedAt)}
          </p>
        ) : (
          <p className="m-0 text-small text-ink-500">
            Belum diskrining. Verifikasi order diet butuh skrining MST.
          </p>
        )}
        {canWrite && <ScreeningForm encounterId={res.context.encounter.id} />}
        {orders.length > 1 && (
          <details>
            <summary className="cursor-pointer text-small font-semibold">
              Riwayat order diet ({orders.length})
            </summary>
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-small">
              {orders.map((o) => (
                <li key={o.id}>
                  {o.dietType.name} · {TEXTURE_LABEL[o.texture].toLowerCase()} · mulai {o.startsOn} ·{' '}
                  {o.status} · {o.orderedBy.name}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
