import { Chip } from '@simrs/ui';
import Link from 'next/link';
import { EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import {
  BloodRequestCard,
  BloodRequestForm,
  BloodUnitForm,
  StockUnitRow,
} from '@/components/penunjang/bank-darah-api';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import { bloodBoard } from '@/lib/server/data/penunjang/penunjang-api';
import { can, type SessionView } from '@/lib/session-view';

const ROUTE = '/penunjang/bank-darah';
const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';
const LINK =
  'inline-flex min-h-11 items-center self-start rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60';

/**
 * S08 · Layar Bank darah mode api (fase 4 · 4.9, ADR-0105). Petugas bank darah (tampilan layanan): semua permintaan
 * aktif + stok kantong; terima, golongan, crossmatch, cek ganda dua petugas, keluarkan kantong. Perawat/dokter
 * (tampilan ruangan, ABAC di API): permintaan pasiennya, pasang kantong (gelang ↔ kantong), verifikasi petugas kedua,
 * TTV + reaksi; DPJP mengirim permintaan untuk satu kunjungan (`?kunjungan=`).
 */
export async function ApiBankDarah({
  session,
  kunjungan,
  pilih,
}: {
  session: SessionView;
  kunjungan?: string;
  pilih?: string;
}) {
  const perms = {
    me: session.user.id,
    crossmatch: can(session, 'blood_bank', 'crossmatch'),
    issue: can(session, 'blood_bank', 'issue'),
    transfuse: can(session, 'blood_bank', 'transfuse'),
    cancel: can(session, 'blood_bank', 'request') || can(session, 'blood_bank', 'crossmatch'),
  };
  const canRequest = can(session, 'blood_bank', 'request');
  const res = kunjungan !== undefined || pilih ? await resolveEncounter(kunjungan) : null;
  const encounterId = res?.kind === 'ok' ? res.context.encounter.id : null;
  const board = await bloodBoard(encounterId);
  const active = board.requests.filter((r) => r.status === 'diminta' || r.status === 'diproses');
  const closed = board.requests.filter((r) => !(r.status === 'diminta' || r.status === 'diproses'));
  const stock = board.units;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Penunjang / Bank darah · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Bank darah</h1>
      </header>

      {res && res.kind !== 'ok' && <EncounterGate res={res} route={ROUTE} />}
      {res?.kind === 'ok' && (
        <>
          <EncounterBanner context={res.context} />
          {canRequest && (
            <section aria-label="Permintaan darah baru" className={CARD}>
              <h2 className="m-0 text-body font-semibold">Permintaan darah</h2>
              <BloodRequestForm encounterId={res.context.encounter.id} components={board.components} />
            </section>
          )}
          <Link href={ROUTE} className={LINK}>
            Semua permintaan
          </Link>
        </>
      )}
      {!res && canRequest && (
        <Link href={`${ROUTE}?pilih=1`} className={LINK}>
          Minta darah untuk pasien…
        </Link>
      )}

      <section aria-label="Permintaan aktif" className="flex flex-col gap-3">
        <h2 className="m-0 text-body font-semibold">
          Permintaan aktif ({active.length}){' '}
          <Chip tone="neutral">{board.view === 'layanan' ? 'Semua ruangan' : 'Pasien saya/unit saya'}</Chip>
        </h2>
        {active.length === 0 && (
          <p className="m-0 text-small text-ink-500">Tidak ada permintaan darah aktif.</p>
        )}
        {[...active, ...closed].map((r) => (
          <BloodRequestCard key={r.id} request={r} units={board.units} perms={perms} />
        ))}
      </section>

      {board.view === 'layanan' && (
        <section aria-label="Stok kantong" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Stok kantong ({stock.length})</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {stock.map((u) => (
              <StockUnitRow key={u.id} unit={u} me={perms.me} canDispose={perms.issue} />
            ))}
          </ul>
          {perms.crossmatch && (
            <details>
              <summary className="cursor-pointer text-small font-semibold">
                Catat kantong masuk dari UTD/PMI
              </summary>
              <div className="mt-2">
                <BloodUnitForm components={board.components} />
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
