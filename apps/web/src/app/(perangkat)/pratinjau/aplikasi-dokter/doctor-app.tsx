'use client';

import type { DoctorAppInbox } from '@simrs/shared';
import { Chip, type ChipTone, cx, Icon, type IconName } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { AppPageView } from '@/components/manajemen/app-page-view';
import { PhoneFrame } from '@/components/manajemen/phone-frame';
import { DOCTOR_APP_PATIENT_ID } from '../../../../lib/demo/fixtures/ids';
import type { DoctorAppStoreState } from '@/lib/aplikasi-dokter-toko';
import { CosignCard } from './cosign-card';
import { type AppCritical, OtherCriticals } from './other-criticals';
import { CriticalCard } from './critical-card';
import { buildDoctorPages, criticalDetailRow, type DoctorTab } from './doctor-pages';

const TABS: Array<{ key: DoctorTab; label: string; icon: IconName }> = [
  { key: 'pasien', label: 'Pasien', icon: 'users' },
  { key: 'tugas', label: 'Tugas', icon: 'check' },
  { key: 'jadwal', label: 'Jadwal', icon: 'cal' },
  { key: 'profil', label: 'Profil', icon: 'idCard' },
];
const LEVEL: Record<
  DoctorAppInbox['patients'][number]['level'],
  { tone: ChipTone; bar: string; label: string }
> = {
  tinggi: { tone: 'danger', bar: 'bg-danger', label: 'tinggi' },
  sedang: { tone: 'warning', bar: 'bg-[#C27A1A]', label: 'sedang' },
  rendah: { tone: 'success', bar: 'bg-brand-600', label: 'rendah' },
};

/** I08 · Pratinjau aplikasi dokter (mockup AppDokter): nilai kritis + read-back, daftar pasien EWS, co-sign. */
export function DoctorApp({
  inbox,
  rev,
  labOrdered,
  orderHref,
  criticals,
  criticalRev,
  app,
}: {
  inbox: DoctorAppInbox;
  rev: number;
  /** Nilai kritis lain dari Pusat hasil kritis (toko demo `hasil-kritis`). */
  criticals: readonly AppCritical[];
  criticalRev: number;
  /** Keadaan co-sign aplikasi (toko demo `aplikasi-dokter`). */
  app: { state: DoctorAppStoreState; rev: number };
  /** Order lab Tn. Hartono sudah dikirim di skenario IGD (lihat `getDoctorAppInbox`). */
  labOrdered: boolean;
  /** CPOE kunjungan IGD Tn. Hartono, bila kunjungan itu sedang terbuka di CPOE. */
  orderHref: string | null;
}) {
  const [tab, setTab] = useState<DoctorTab>('pasien');
  const [pt, setPt] = useState<string | null>(null);

  /** "Keluar" di tab Profil (mockup AppDokter): hanya keluar dari pratinjau ponsel, sesi SIM RS tetap. */
  const [signedOut, setSignedOut] = useState(false);
  const c = inbox.critical;
  const accepted = c.state === 'diterima' ? c.acceptedAt : null;
  const waitingCosign = inbox.cosign.filter((n) => !app.state.signed[n.id]);
  const left = waitingCosign.length;
  const pages = buildDoctorPages(inbox, {
    accepted,
    labOrdered,
    cosignLeft: left,
    nextCosign: waitingCosign[0]?.patientName ?? null,
  });
  const detail = inbox.patients.find((p) => p.id === pt) ?? null;
  const title = tab === 'pasien' ? `Pasien saya · ${inbox.patients.length}` : pages[tab].title;

  return (
    <PhoneFrame time="10.45">
      <header className="flex shrink-0 flex-col bg-white px-5 pt-1 pb-3">
        <span className="truncate text-[12px] text-ink-500">{inbox.doctorName} · jaga konsulen</span>
        <span className="text-[22px] leading-tight font-bold">{title}</span>
      </header>
      <main
        tabIndex={0}
        aria-label="Isi aplikasi"
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4 outline-none *:shrink-0"
      >
        {signedOut ? (
          <section
            aria-label="Keluar"
            className="flex flex-col items-center gap-3 rounded-[16px] border border-line bg-white p-5 text-center"
          >
            <span role="status" className="font-semibold">
              Anda sudah keluar dari aplikasi dokter
            </span>
            <span className="text-[13px] text-ink-700">
              Notifikasi nilai kritis berhenti dikirim ke ponsel ini sampai Anda masuk lagi (hanya pratinjau
              ponsel; sesi SIM RS di komputer tetap aktif).
            </span>
            <button
              type="button"
              onClick={() => {
                setSignedOut(false);
                setTab('pasien');
              }}
              className="h-12 w-full cursor-pointer rounded-[12px] border border-brand-800 bg-brand-600 font-[inherit] font-semibold text-white"
            >
              Masuk lagi
            </button>
          </section>
        ) : tab !== 'pasien' ? (
          <>
            <AppPageView page={pages[tab]} />
            {tab === 'profil' && (
              <button
                type="button"
                onClick={() => setSignedOut(true)}
                className="h-12 cursor-pointer rounded-[12px] border border-line-strong bg-white font-[inherit] font-semibold text-danger"
              >
                Keluar
              </button>
            )}
          </>
        ) : detail ? (
          <section aria-label="Detail pasien" className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setPt(null)}
              className="flex h-11 w-fit cursor-pointer items-center gap-1 rounded-[12px] border border-line bg-white pr-3.5 pl-2 font-[inherit] font-semibold text-brand-700"
            >
              <Icon name="chevronLeft" size={20} />
              Daftar pasien
            </button>
            <div className="flex flex-col gap-1 rounded-[16px] border border-line bg-white p-3.5">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[16px] font-semibold">
                  {detail.name}, {detail.age}
                </span>
                <Chip tone={LEVEL[detail.level].tone}>
                  EWS {detail.ews} · {detail.hospitalDay}
                </Chip>
              </span>
              <span className="text-[12.5px] text-ink-500">
                RM {detail.rm} · {detail.location}
              </span>
            </div>
            <dl className="m-0 flex flex-col overflow-hidden rounded-[16px] border border-line bg-white">
              {[
                ...(detail.id === DOCTOR_APP_PATIENT_ID.hartono
                  ? [criticalDetailRow(c, accepted, labOrdered)]
                  : []),
                ...detail.details.map((r) => ({ ...r, danger: false })),
              ].map((r) => (
                <div
                  key={r.label}
                  className="flex flex-col gap-0.5 border-b border-line-soft px-3.5 py-2.5 last:border-0"
                >
                  <dt className="text-[12px] text-ink-500">{r.label}</dt>
                  <dd
                    className={cx(
                      'm-0 text-[13.5px]',
                      r.danger ? 'font-semibold text-danger' : 'text-ink-900',
                    )}
                  >
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
            {detail.id === DOCTOR_APP_PATIENT_ID.hartono && orderHref && (
              <Link
                href={orderHref}
                className="flex h-12 items-center justify-center rounded-[12px] border border-brand-800 bg-brand-600 font-semibold text-white no-underline"
              >
                Buka order pasien
              </Link>
            )}
          </section>
        ) : (
          <>
            <CriticalCard
              critical={c}
              rev={rev}
              labOrdered={labOrdered}
              orderHref={orderHref}
              onOpenPatient={() => setPt(DOCTOR_APP_PATIENT_ID.hartono)}
            />
            <OtherCriticals items={criticals} rev={criticalRev} />
            <section aria-label="Tugas" className="grid grid-cols-3 gap-2">
              {[
                { n: left, l: 'Co-sign residen', fg: 'text-brand-700' },
                { n: inbox.orderVerifyCount, l: 'Order perlu verifikasi', fg: 'text-warning' },
                { n: inbox.coderQueryCount, l: 'Query koder', fg: 'text-info' },
              ].map((t) => (
                <span
                  key={t.l}
                  className="flex flex-col rounded-[14px] border border-line bg-white px-2.5 py-2"
                >
                  <span className={cx('font-mono text-[22px] font-bold', t.fg)}>{t.n}</span>
                  <span className="text-[11.5px] leading-tight text-ink-700">{t.l}</span>
                </span>
              ))}
            </section>
            <section
              aria-label="Daftar pasien"
              className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-white"
            >
              {inbox.patients.map((p) => {
                const note =
                  p.id === DOCTOR_APP_PATIENT_ID.hartono && accepted
                    ? `Suspek SKA, K ${c.value} · read-back ${accepted}`
                    : p.note;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPt(p.id)}
                    className="flex min-h-16 w-full cursor-pointer items-stretch gap-3 border-0 border-b border-line-soft bg-transparent py-2.5 pr-3 pl-0 text-left font-[inherit] last:border-b-0"
                  >
                    <span
                      className={cx('w-1 shrink-0 rounded-r-full', LEVEL[p.level].bar)}
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold text-ink-900">
                        {p.name}, {p.age}
                      </span>
                      <span className="text-[12px] text-ink-500">{p.location}</span>
                      <span className="text-[12.5px] text-ink-700">{note}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end justify-center gap-1">
                      <Chip tone={LEVEL[p.level].tone}>EWS {p.ews}</Chip>
                      <span className="text-[11.5px] text-ink-500">
                        {p.hospitalDay} · risiko {LEVEL[p.level].label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
            <CosignCard
              notes={inbox.cosign}
              signed={app.state.signed}
              sentNotes={app.state.notes}
              rev={app.rev}
            />
          </>
        )}
      </main>
      <nav
        aria-label="Navigasi aplikasi"
        className="grid shrink-0 grid-cols-4 border-t border-line bg-white pb-3"
      >
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                setTab(t.key);
                setPt(null);
              }}
              className={cx(
                'flex h-14 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 bg-transparent font-[inherit] text-[11.5px]',
                on ? 'font-semibold text-brand-700' : 'text-ink-500',
              )}
            >
              <Icon name={t.icon} size={22} />
              {t.label}
            </button>
          );
        })}
      </nav>
    </PhoneFrame>
  );
}
