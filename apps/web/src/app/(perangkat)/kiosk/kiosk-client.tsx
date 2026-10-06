'use client';

import type { RegistrationPatient } from '@simrs/shared';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import { KioskConfirm, KioskTicket, type KioskTicketView } from '@/components/front-office/kiosk-confirm';
import { KioskFooter, KioskHeader } from '@/components/front-office/kiosk-frame';
import type { KioskScenarioTask, KioskScenarioView } from '@/components/front-office/kiosk-hint';
import { KioskKeypad, type KioskMethod } from '@/components/front-office/kiosk-keypad';
import {
  type BiometricChoice,
  KioskBiometric,
  KioskHome,
  KioskMethods,
  METHODS,
  PURPOSES,
} from '@/components/front-office/kiosk-screens';
import { KioskNotice } from '@/components/front-office/kiosk-ui';
import { useDemoClock } from '@/components/front-office/use-demo-clock';
import { useStoreAction } from '@/lib/demo/store/client';
import { addMinutes, greeting } from '@/lib/front-office';
import { requestKioskAssistAction, takeKioskTicketAction } from './actions-demo';

type Screen = 'home' | 'metode' | 'input' | 'bio' | 'konfirmasi' | 'tiket';

export interface KioskTickets {
  bpjs: { no: string; waitMin: number };
  umum: { no: string; waitMin: number };
  farmasi: { no: string; waitMin: number };
  skenario: { no: string; waitMin: number };
}

const BASIS = [
  'Booking Mobile JKN',
  'Surat kontrol 12 Sep 2026',
  'Pendaftaran langsung',
  'Resep elektronik hari ini',
];

/**
 * F05 · Anjungan pendaftaran mandiri (mockup Anjungan): tujuan → cara identifikasi → keypad → (biometrik JKN) →
 * konfirmasi → tiket. Kode booking Tn. Suryo saat langkah `kedatangan` aktif menjalankan tugas skenario
 * (scan → bio → tiket A-031); selain itu pasien lokal Siti Rahmawati: nomor tiket dihitung server dan tersimpan di
 * toko demo (antrean loket/farmasi), lalu tampil di meja pendaftaran dan papan TV.
 */
export function KioskClient({
  tenantName,
  nowIso,
  dateLabel,
  local,
  scenarioPatient,
  doctor,
  tickets,
  bookingCode,
  scenario,
  assistAt,
}: {
  tenantName: string;
  nowIso: string;
  dateLabel: string;
  local: RegistrationPatient;
  scenarioPatient: RegistrationPatient;
  doctor: { name: string; time: string };
  tickets: KioskTickets;
  bookingCode: string;
  scenario: KioskScenarioView;
  /** Jam permintaan bantuan yang belum ditangani petugas (toko demo), null bila tidak ada. */
  assistAt: string | null;
}) {
  const [screen, setScreen] = useState<Screen>('home');
  const [purpose, setPurpose] = useState(0);
  const [method, setMethod] = useState<KioskMethod['id']>('booking');
  const [digits, setDigits] = useState('');
  const [bio, setBio] = useState<BiometricChoice | null>(null);
  const [forScenario, setForScenario] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState('');
  /** Nomor tiket lokal yang dicetak server (toko demo). */
  const [ticketNo, setTicketNo] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const store = useStoreAction(0);
  const assist = useStoreAction(0);
  const [english, setEnglish] = useState(false);
  const [large, setLarge] = useState(false);
  const { run, pending, error, clearError } = useDemoRunner(scenario.rev);
  const { time } = useDemoClock(nowIso);

  const pur = PURPOSES[purpose] ?? PURPOSES[0];
  const bpjsFlow = forScenario || !!pur?.bpjs;
  const order: Screen[] = bpjsFlow
    ? ['metode', 'input', 'bio', 'konfirmasi', 'tiket']
    : ['metode', 'input', 'konfirmasi', 'tiket'];
  const stepLabel = `Langkah ${order.indexOf(screen) + 1} dari ${order.length}`;
  const task = (id: string) => scenario.tasks.find((t) => t.id === id);
  const go = (s: Screen) => {
    clearError();
    setStoreError(null);
    setScreen(s);
  };
  const runTask = (id: string, value: true | string, then: () => void) => {
    if (scenario.step === null) return;
    run({ type: 'task', step: scenario.step, task: id, value, scenario: 'rawat-jalan' }, (ok) => {
      if (ok) then();
    });
  };
  /**
   * Tugas skenario ada tetapi belum gilirannya (mis. simulasi diulang atau dimajukan dari perangkat lain): jangan
   * kirim perintah yang pasti ditolak server; kembali ke isian kode booking yang melanjutkan tugas sesuai urutan.
   */
  const notYourTurn = (t: KioskScenarioTask) => {
    setMethod('booking');
    setDigits('');
    go('input');
    setNotice(
      `${t.label} belum gilirannya di simulasi (keadaan berubah dari perangkat lain). Masukkan ulang kode booking ${bookingCode} untuk melanjutkan check-in ${scenario.patientName}.`,
    );
  };

  const back = () => {
    const prev: Record<Screen, Screen> = {
      home: 'home',
      metode: 'home',
      input: 'metode',
      bio: 'input',
      konfirmasi: bpjsFlow ? 'bio' : 'input',
      tiket: 'home',
    };
    setNotice(null);
    go(prev[screen]);
  };

  const reset = () => {
    setPurpose(0);
    setDigits('');
    setBio(null);
    setForScenario(false);
    setNotice(null);
    go('home');
  };

  const next = () => {
    setNotice(null);
    if (method === 'booking' && digits === bookingCode) {
      if (scenario.step === null) {
        if (scenario.ticketDone) {
          setNotice(
            `Kode booking ${bookingCode} sudah dipakai check-in. Nomor antrean Anda ${tickets.skenario.no}.`,
          );
          return;
        }
      } else {
        const scan = task('scan');
        if (scan && !scan.done && !scan.enabled) {
          notYourTurn(scan);
          return;
        }
        setForScenario(true);
        const afterScan = () => go(task('bio')?.done ? 'konfirmasi' : 'bio');
        if (scan && !scan.done) runTask('scan', true, afterScan);
        else afterScan();
        return;
      }
    }
    setForScenario(false);
    go(pur?.bpjs ? 'bio' : 'konfirmasi');
  };

  const pickBio = (c: BiometricChoice) => {
    const t = forScenario ? task('bio') : undefined;
    if (t && !t.done) {
      if (!t.enabled) {
        notYourTurn(t);
        return;
      }
      runTask('bio', c, () => {
        setBio(c);
        go('konfirmasi');
      });
      return;
    }
    setBio(
      forScenario && (scenario.bioValue === 'wajah' || scenario.bioValue === 'jari') ? scenario.bioValue : c,
    );
    go('konfirmasi');
  };

  const print = () => {
    const done = () => {
      setPrintedAt(time);
      go('tiket');
    };
    if (!forScenario) {
      store.run(
        () => takeKioskTicketAction({ purpose, jam: time }),
        (r) => {
          if (r.ok && r.ticketNo) {
            setTicketNo(r.ticketNo);
            done();
          } else setStoreError(r.message);
        },
      );
      return;
    }
    const t = task('tiket');
    if (t && !t.done) {
      if (t.enabled) runTask('tiket', true, done);
      else notYourTurn(t);
    } else done();
  };

  const pt = forScenario ? scenarioPatient : local;
  const farmasi = !forScenario && purpose === 3;
  const rows = [
    {
      k: 'Penjamin',
      v: forScenario || purpose !== 2 ? `BPJS Kesehatan · ${pt.eligibility?.kelas ?? 'Kelas 2'}` : 'Umum',
    },
    { k: 'Tujuan', v: farmasi ? 'Farmasi rawat jalan' : 'Poli Penyakit Dalam' },
    { k: farmasi ? 'Asal resep' : 'Dokter', v: farmasi ? doctor.name : `${doctor.name} · ${doctor.time}` },
    { k: 'Dasar', v: forScenario ? `Booking aplikasi · kode ${bookingCode}` : (BASIS[purpose] ?? '') },
    ...(bpjsFlow && bio
      ? [{ k: 'Biometrik', v: bio === 'wajah' ? 'Pengenalan wajah cocok' : 'Sidik jari cocok' }]
      : []),
  ];

  const at = printedAt || time;
  const ticket: KioskTicketView = forScenario
    ? {
        no: tickets.skenario.no,
        tujuan: 'Loket pendaftaran',
        lokasi: `Lantai 1 · loket 1–4 · perkiraan dipanggil ${addMinutes(at, tickets.skenario.waitMin)}`,
        sep: null,
        note: 'SEP dan nomor antrean poli diterbitkan petugas loket.',
      }
    : farmasi
      ? {
          no: ticketNo ?? tickets.farmasi.no,
          tujuan: 'Farmasi rawat jalan',
          lokasi: `Lantai 1 · loket 2 · perkiraan dipanggil ${addMinutes(at, tickets.farmasi.waitMin)}`,
          sep: null,
          note: null,
        }
      : {
          no: ticketNo ?? (purpose === 2 ? tickets.umum.no : tickets.bpjs.no),
          tujuan: 'Loket pendaftaran',
          lokasi: `Lantai 1 · loket 1–4 · perkiraan dipanggil ${addMinutes(
            at,
            purpose === 2 ? tickets.umum.waitMin : tickets.bpjs.waitMin,
          )}`,
          sep: null,
          note:
            purpose === 2
              ? 'Petugas loket mendaftarkan Anda ke poli tujuan.'
              : 'Booking Anda didahulukan. SEP dan nomor antrean poli diterbitkan petugas loket.',
        };

  const root = {
    '--k': large ? 1.2 : 1,
    backgroundColor: '#F5F7F9',
    backgroundImage:
      'radial-gradient(1100px 600px at 100% 0%, rgba(15,118,110,0.12), rgba(15,118,110,0) 70%), radial-gradient(900px 500px at 0% 100%, rgba(14,116,144,0.07), rgba(14,116,144,0) 70%), radial-gradient(circle at 1px 1px, rgba(20,33,43,0.06) 1.2px, rgba(20,33,43,0) 1.8px)',
    backgroundSize: 'auto, auto, 30px 30px',
  } as CSSProperties;

  return (
    <div className="flex h-full w-full flex-col text-ink-900" style={root}>
      <KioskHeader tenantName={tenantName} time={time} date={dateLabel} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        {(error || storeError) && (
          <div className="px-16 pt-8">
            <KioskNotice tone="warning">{error?.message ?? storeError}</KioskNotice>
          </div>
        )}
        {screen === 'home' && (
          <KioskHome
            greeting={greeting(time)}
            onPick={(i) => {
              setPurpose(i);
              setDigits('');
              go('metode');
            }}
          />
        )}
        {screen === 'metode' && pur && (
          <KioskMethods
            purpose={pur}
            step={stepLabel}
            onBack={back}
            onPick={(id) => {
              setMethod(id);
              setDigits('');
              go('input');
            }}
          />
        )}
        {screen === 'input' && (
          <KioskKeypad
            method={METHODS[method]}
            digits={digits}
            step={stepLabel}
            busy={pending}
            notice={notice ? <KioskNotice tone="warning">{notice}</KioskNotice> : null}
            onDigits={(d) => {
              setNotice(null);
              setDigits(d);
            }}
            onBack={back}
            onNext={next}
          />
        )}
        {screen === 'bio' && (
          <KioskBiometric step={stepLabel} busy={pending} onBack={back} onPick={pickBio} />
        )}
        {screen === 'konfirmasi' && (
          <KioskConfirm
            patient={{ name: pt.name, birthDate: pt.birthDate, rm: pt.rm }}
            rows={rows}
            step={stepLabel}
            busy={pending || store.pending}
            onBack={back}
            onConfirm={print}
            onNotMe={() => {
              setDigits('');
              go('input');
            }}
          />
        )}
        {screen === 'tiket' && <KioskTicket ticket={ticket} onDone={reset} />}
      </div>
      <KioskFooter
        calledAt={assistAt}
        cancelable={false}
        calling={assist.pending}
        english={english}
        large={large}
        onEnglish={() => setEnglish((e) => !e)}
        onLarge={() => setLarge((l) => !l)}
        onCall={() => {
          if (assistAt) return;
          assist.run(
            () => requestKioskAssistAction({ jam: time }),
            (r) => setStoreError(r.ok ? null : r.message),
          );
        }}
      />
    </div>
  );
}
