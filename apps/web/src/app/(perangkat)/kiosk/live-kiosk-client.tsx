'use client';

import type { KioskPurpose, KioskSessionOption, PrintableTicket } from '@simrs/shared';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { KioskTicket } from '@/components/front-office/kiosk-confirm';
import { KioskFooter, KioskHeader } from '@/components/front-office/kiosk-frame';
import { KioskKeypad, type KioskMethod } from '@/components/front-office/kiosk-keypad';
import { KioskMaskedConfirm, KioskSessions, KioskToCounter } from '@/components/front-office/kiosk-live';
import { KioskHome, KioskMethods, METHODS, PURPOSES } from '@/components/front-office/kiosk-screens';
import { KioskNotice } from '@/components/front-office/kiosk-ui';
import { useDemoClock } from '@/components/front-office/use-demo-clock';
import { greeting } from '@/lib/front-office';
import {
  type KioskFound,
  type KioskTicketOrigin,
  kioskFailure,
  kioskNextStep,
  kioskPurposeOf,
  kioskTicketView,
  newKioskKey,
} from '@/lib/kiosk';
import {
  assistAction,
  checkInAction,
  identifyAction,
  type KioskFailure,
  registerAction,
  sessionsAction,
  ticketAction,
  ticketHtmlAction,
} from './actions';

type Screen = 'home' | 'metode' | 'input' | 'konfirmasi' | 'dokter' | 'loket' | 'tiket';

/** Layar non-awal tanpa sentuhan selama ini → kembali ke awal (nama tersamar tidak tertinggal di layar umum). */
const IDLE_MS = 90_000;

/**
 * F05 · Anjungan mode api (fase 2 potongan 6) di PERANGKAT anjungan terdaftar: tujuan → cara identifikasi → keypad →
 * konfirmasi nama tersamar + tanggal lahir tanpa tahun → check-in / daftar ke poli (BPJS, alur 5a + SEP) / pilih
 * dokter (umum) / nomor loket / farmasi-kasir → tiket (dicetak lewat HTML 80 mm dari API). Komponen layar sama dengan
 * mode presentasi (target sentuh ≥ 64 px); jalur demo tetap di `kiosk-client.tsx`.
 */
export function LiveKioskClient({
  tenantName,
  deviceName,
  unitName,
  nowIso,
  dateLabel,
}: {
  tenantName: string;
  deviceName: string;
  unitName: string;
  nowIso: string;
  dateLabel: string;
}) {
  const [screen, setScreen] = useState<Screen>('home');
  const [purpose, setPurpose] = useState<KioskPurpose>('booking');
  const [purposeIndex, setPurposeIndex] = useState(0);
  const [method, setMethod] = useState<KioskMethod['id']>('booking');
  const [digits, setDigits] = useState('');
  const [found, setFound] = useState<KioskFound | null>(null);
  /** Kunci idempotensi tindakan dengan token ini (sentuhan ganda/ulang kirim → tiket yang sama). */
  const [actionKey, setActionKey] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [counterMessage, setCounterMessage] = useState('');
  const [ticket, setTicket] = useState<PrintableTicket | null>(null);
  const [origin, setOrigin] = useState<KioskTicketOrigin>('ticket');
  const [sessions, setSessions] = useState<KioskSessionOption[]>([]);
  const [printNote, setPrintNote] = useState<string | null>(null);
  const [calledAt, setCalledAt] = useState<string | null>(null);
  const [english, setEnglish] = useState(false);
  const [large, setLarge] = useState(false);
  const [pending, startTransition] = useTransition();
  const [calling, startCall] = useTransition();
  const printFrame = useRef<HTMLIFrameElement>(null);
  const { time } = useDemoClock(nowIso);

  const pur = PURPOSES[purposeIndex] ?? PURPOSES[0];
  const order: Screen[] =
    purpose === 'umum'
      ? ['metode', 'input', 'konfirmasi', 'dokter', 'tiket']
      : ['metode', 'input', 'konfirmasi', 'tiket'];
  const stepLabel = `Langkah ${Math.max(order.indexOf(screen), 0) + 1} dari ${order.length}`;

  const reset = (message: string | null = null) => {
    setPurposeIndex(0);
    setPurpose('booking');
    setDigits('');
    setFound(null);
    setActionKey('');
    setTicket(null);
    setPrintNote(null);
    setNotice(message);
    setScreen('home');
  };

  // Kembali ke awal setelah tidak disentuh (setiap ketukan/perubahan layar memulai ulang hitungan).
  const [touched, setTouched] = useState(0);
  useEffect(() => {
    if (screen === 'home') return;
    const id = setTimeout(() => reset(), IDLE_MS);
    return () => clearTimeout(id);
  }, [screen, digits, touched]);

  const fail = (f: KioskFailure) => {
    const view = kioskFailure(f.code, f.reason, f.message);
    if (view.action === 'restart') reset(view.message);
    else if (view.action === 'loket') {
      setCounterMessage(view.message);
      setScreen('loket');
    } else setNotice(view.message);
  };

  const showTicket = (t: PrintableTicket, from: KioskTicketOrigin) => {
    setTicket(t);
    setOrigin(from);
    setFound(null);
    setScreen('tiket');
    setPrintNote(null);
    void ticketHtmlAction({ ticketId: t.ticketId }).then((res) => {
      const frame = printFrame.current;
      if (!res.ok || !frame) {
        setPrintNote('Printer tiket tidak merespons. Catat nomor Anda atau minta bantuan petugas.');
        return;
      }
      frame.onload = () => frame.contentWindow?.print();
      frame.srcdoc = res.html;
    });
  };

  const identify = () => {
    setNotice(null);
    startTransition(async () => {
      const res = await identifyAction({ purpose, method, value: digits });
      if (!res.ok) return fail(res);
      if (!res.result.found) {
        setCounterMessage(
          'Data tidak ditemukan. Periksa kembali angka yang Anda masukkan, atau minta bantuan petugas loket.',
        );
        setScreen('loket');
        return;
      }
      setFound(res.result);
      setActionKey(newKioskKey());
      setScreen('konfirmasi');
    });
  };

  const checkIn = () => {
    if (!found) return;
    startTransition(async () => {
      const res = await checkInAction({ lookupToken: found.lookupToken, idempotencyKey: actionKey });
      if (res.ok) showTicket(res.ticket, 'check-in');
      else fail(res);
    });
  };

  /** Registrasi mandiri (alur 5a di API): BPJS langsung; umum sesudah memilih sesi dokter. */
  const register = (sessionId?: string) => {
    if (!found) return;
    const token = found.lookupToken;
    startTransition(async () => {
      const res = await registerAction({
        request: sessionId
          ? { payer: 'umum', lookupToken: token, sessionId }
          : { payer: 'bpjs', lookupToken: token },
        idempotencyKey: actionKey,
      });
      if (res.ok) showTicket(res.ticket, 'register');
      else fail(res);
    });
  };

  const pickDoctor = () => {
    startTransition(async () => {
      const res = await sessionsAction();
      if (!res.ok) return fail(res);
      setSessions(res.sessions);
      setScreen('dokter');
    });
  };

  const takeTicket = (kind: 'loket' | 'farmasi' | 'kasir', withIdentity: boolean) => {
    const token = withIdentity ? found?.lookupToken : undefined;
    startTransition(async () => {
      const res = await ticketAction({
        request: { serviceKind: kind, ...(token ? { lookupToken: token } : {}) },
        idempotencyKey: token ? actionKey : newKioskKey(),
      });
      if (res.ok) showTicket(res.ticket, 'ticket');
      else fail(res);
    });
  };

  const callStaff = () => {
    startCall(async () => {
      const res = await assistAction();
      if (res.ok) setCalledAt(time);
      else setNotice(kioskFailure(res.code, res.reason, res.message).message);
    });
  };

  const back = () => {
    const prev: Record<Screen, Screen> = {
      home: 'home',
      metode: 'home',
      input: 'metode',
      konfirmasi: 'input',
      dokter: 'konfirmasi',
      loket: 'home',
      tiket: 'home',
    };
    setNotice(null);
    if (screen !== 'dokter') setFound(null);
    setScreen(prev[screen]);
  };

  const root = {
    '--k': large ? 1.2 : 1,
    backgroundColor: '#F5F7F9',
    backgroundImage:
      'radial-gradient(1100px 600px at 100% 0%, rgba(15,118,110,0.12), rgba(15,118,110,0) 70%), radial-gradient(900px 500px at 0% 100%, rgba(14,116,144,0.07), rgba(14,116,144,0) 70%), radial-gradient(circle at 1px 1px, rgba(20,33,43,0.06) 1.2px, rgba(20,33,43,0) 1.8px)',
    backgroundSize: 'auto, auto, 30px 30px',
  } as CSSProperties;

  return (
    <div
      className="flex h-full w-full flex-col text-ink-900"
      style={root}
      onPointerDown={() => setTouched((n) => n + 1)}
    >
      <KioskHeader tenantName={tenantName} time={time} date={dateLabel} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        {notice && screen !== 'input' && (
          <div className="px-16 pt-8">
            <KioskNotice tone="warning">{notice}</KioskNotice>
          </div>
        )}
        {screen === 'home' && (
          <KioskHome
            greeting={greeting(time)}
            onPick={(i) => {
              setPurposeIndex(i);
              setPurpose(kioskPurposeOf(PURPOSES[i]?.title ?? ''));
              setDigits('');
              setNotice(null);
              setScreen('metode');
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
              setScreen('input');
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
            onNext={identify}
          />
        )}
        {screen === 'konfirmasi' && found && (
          <KioskMaskedConfirm
            nameMasked={found.nameMasked}
            birthDayMonth={found.birthDayMonth}
            next={kioskNextStep(purpose, found)}
            step={stepLabel}
            busy={pending}
            onBack={back}
            onCheckIn={checkIn}
            onRegister={() => (kioskNextStep(purpose, found) === 'register-umum' ? pickDoctor() : register())}
            onTicket={(kind) => takeTicket(kind, true)}
            onNotMe={() => {
              setFound(null);
              setDigits('');
              setScreen('input');
            }}
          />
        )}
        {screen === 'dokter' && found && (
          <KioskSessions
            sessions={sessions}
            step={stepLabel}
            busy={pending}
            onBack={back}
            onPick={(id) => register(id)}
          />
        )}
        {screen === 'loket' && (
          <KioskToCounter
            message={counterMessage}
            busy={pending}
            onTicket={() => takeTicket('loket', false)}
            onRetry={() => reset()}
          />
        )}
        {screen === 'tiket' && ticket && (
          <>
            {printNote && (
              <div className="px-16 pt-8">
                <KioskNotice tone="warning">{printNote}</KioskNotice>
              </div>
            )}
            <KioskTicket
              ticket={kioskTicketView(ticket, origin)}
              onDone={() => reset()}
              displayLink={false}
            />
          </>
        )}
        <p
          className="m-0 mt-auto px-16 pt-6 text-ink-500"
          style={{ fontSize: 18 }}
          data-testid="nama-perangkat"
        >
          {deviceName} · {unitName}
        </p>
      </div>
      <KioskFooter
        calledAt={calledAt}
        english={english}
        large={large}
        onEnglish={() => setEnglish((e) => !e)}
        onLarge={() => setLarge((l) => !l)}
        onCall={callStaff}
        cancelable={false}
        calling={calling}
      />
      {/* Tiket 80 mm dari API dicetak lewat bingkai tersembunyi (HTML tanpa skrip, `srcdoc` asal yang sama). */}
      <iframe
        ref={printFrame}
        title="Cetak tiket"
        aria-hidden="true"
        tabIndex={-1}
        sandbox="allow-same-origin allow-modals"
        className="pointer-events-none absolute size-0 border-0 opacity-0"
      />
    </div>
  );
}
