'use client';

import type { PatientAppHome } from '@simrs/shared';
import { cx, Icon, type IconName } from '@simrs/ui';
import { useState } from 'react';
import { AppPageView } from '@/components/manajemen/app-page-view';
import { PhoneFrame } from '@/components/manajemen/phone-frame';
import { GlucoseCard } from './glucose-card';
import { buildPatientPages, isSubKey, type SubKey, type TabKey } from './patient-pages';
import { QueueCard } from './queue-card';

const MENU: Array<{ key: SubKey; label: string; icon: IconName }> = [
  { key: 'daftar', label: 'Daftar berobat', icon: 'cal' },
  { key: 'lab', label: 'Hasil lab', icon: 'flask' },
  { key: 'resume', label: 'Resume medis', icon: 'fileCheck' },
  { key: 'obat', label: 'Obat saya', icon: 'pill' },
  { key: 'tagihan', label: 'Tagihan', icon: 'card' },
  { key: 'keluarga', label: 'Keluarga', icon: 'users' },
  { key: 'tanya', label: 'Tanya RS', icon: 'phone' },
  { key: 'privasi', label: 'Data & privasi', icon: 'shield' },
];
const TABS: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: 'beranda', label: 'Beranda', icon: 'home' },
  { key: 'jadwal', label: 'Jadwal', icon: 'cal' },
  { key: 'notif', label: 'Notifikasi', icon: 'bell' },
  { key: 'profil', label: 'Profil', icon: 'idCard' },
];
const DOT: Record<PatientAppHome['feed'][number]['tone'], string> = {
  brand: 'bg-brand-600',
  warning: 'bg-[#8A4B00]',
  info: 'bg-[#1E3A8A]',
  success: 'bg-[#1E6B34]',
  danger: 'bg-danger',
};

/** I07 · Pratinjau aplikasi pasien (mockup AppPasien) untuk Tn. Suryo, mengikuti skenario rawat jalan. */
export function PatientApp({ home, rsName }: { home: PatientAppHome; rsName: string }) {
  const [tab, setTab] = useState<TabKey>('beranda');
  const [sub, setSub] = useState<SubKey | null>(null);
  const pages = buildPatientPages(home);
  const page = sub ? pages[sub] : tab === 'beranda' ? null : pages[tab];
  const badge: Partial<Record<SubKey, string>> = {
    lab: home.labResults.length ? `${home.labResults.length} baru` : undefined,
    obat: home.medicines.length ? `${home.medicines.length} aktif` : undefined,
  };
  const q = home.queue;

  return (
    <PhoneFrame time="10.45">
      <header className="flex shrink-0 items-center justify-between gap-3 bg-white px-5 pt-1 pb-3">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12px] text-ink-500">{rsName}</span>
          <span className="text-[13px] text-ink-700">Selamat pagi,</span>
          <span className="text-[19px] font-semibold">{home.greeting}</span>
        </span>
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700"
          role="img"
          aria-label={`Akun ${home.fullName}`}
        >
          {home.initials}
        </span>
      </header>
      <main
        tabIndex={0}
        aria-label="Isi aplikasi"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 outline-none *:shrink-0"
      >
        {page ? (
          <AppPageView
            page={page}
            onBack={sub ? () => setSub(null) : undefined}
            onOpen={(k) => isSubKey(k) && setSub(k)}
          />
        ) : (
          <>
            <QueueCard key={`${q.stage}-${q.number}-${q.serving}-${q.ahead}`} queue={q} payer={home.payer} />
            <section aria-label="Menu" className="grid grid-cols-4 gap-2">
              {MENU.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setSub(m.key)}
                  className="relative flex min-h-[78px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border border-line bg-white px-1 font-[inherit] text-[12px] leading-tight text-ink-900"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                    <Icon name={m.icon} size={19} />
                  </span>
                  {m.label}
                  {badge[m.key] && (
                    <span className="absolute -top-1.5 right-0.5 rounded-full bg-danger px-1.5 text-[10.5px] font-semibold text-white">
                      {badge[m.key]}
                    </span>
                  )}
                </button>
              ))}
            </section>
            <section
              aria-label="Terbaru"
              className="flex flex-col gap-1 rounded-[18px] border border-line bg-white px-4 py-3"
            >
              <span className="flex items-center justify-between">
                <span className="font-semibold">Terbaru untuk Anda</span>
                <button
                  type="button"
                  onClick={() => setTab('notif')}
                  className="h-11 cursor-pointer border-0 bg-transparent px-1 font-[inherit] font-semibold text-brand-700"
                >
                  Semua
                </button>
              </span>
              <ul className="m-0 flex list-none flex-col p-0">
                {home.feed.slice(0, 3).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-start gap-2.5 border-b border-[#EEF1F4] py-2 last:border-0"
                  >
                    <span
                      className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[f.tone])}
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13.5px] font-semibold">{f.title}</span>
                      <span className="text-[12.5px] text-ink-500">{f.detail}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-500">{f.when}</span>
                  </li>
                ))}
              </ul>
            </section>
            <GlucoseCard glucose={home.glucose} target={home.glucoseTarget} />
          </>
        )}
      </main>
      <nav
        aria-label="Navigasi aplikasi"
        className="grid shrink-0 grid-cols-4 border-t border-line bg-white pb-3"
      >
        {TABS.map((t) => {
          const on = tab === t.key && !sub;
          return (
            <button
              key={t.key}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                setTab(t.key);
                setSub(null);
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
