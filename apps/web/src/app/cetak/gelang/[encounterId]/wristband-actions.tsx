'use client';

import {
  formatTanggal,
  formatTanggalWaktu,
  SAFETY_REASON_MIN,
  type WristbandPrint,
  type WristbandStatus,
} from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import {
  printWristbandAction,
  reprintWristbandAction,
} from '../../../(staf)/klinis/tempat-tidur/actions-api';

const SEX: Record<string, string> = { male: 'L', female: 'P', unknown: '?' };

/**
 * Pita gelang + aksi. Kode gelang tidak ikut termuat saat halaman dibuka (ADR-0109): "Cetak gelang" memanggil aksi cetak
 * API (`POST /encounters/:id/wristband/print`, diaudit `print`), lalu membuka dialog cetak browser. Cetak ulang beralasan
 * membatalkan gelang lama dan langsung mencetak kode baru. Tombol tidak ikut tercetak.
 */
export function WristbandSheet({ status }: { status: WristbandStatus }) {
  const router = useRouter();
  const id = useId();
  const [band, setBand] = useState<WristbandPrint | null>(null);
  const [printing, setPrinting] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ok = reason.trim().length >= SAFETY_REASON_MIN;
  const shown = band ?? { ...status, code: null };

  // Dialog cetak dibuka setelah kode tampil di pita.
  useEffect(() => {
    if (!printing || !band) return;
    setPrinting(false);
    window.print();
  }, [printing, band]);

  const print = () =>
    start(async () => {
      const r = await printWristbandAction(status.encounterId);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg(null);
      setBand(r.data);
      setPrinting(true);
    });

  return (
    <>
      <article
        aria-label="Gelang identitas pasien"
        className="band mx-auto flex h-[25mm] w-[280mm] max-w-full items-center gap-4 overflow-hidden rounded-[12px] border border-black bg-white px-4 text-black"
      >
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[15px] font-bold">{shown.patientName}</span>
          <span className="text-[11px]">
            {SEX[shown.sex] ?? shown.sex} · lahir{' '}
            {shown.birthDate ? formatTanggal(shown.birthDate) : 'tidak diketahui'} · RM{' '}
            <span className="font-mono font-semibold">{shown.rm}</span>
          </span>
        </span>
        <span className="flex flex-col items-end leading-tight">
          <span className="text-[10px]">Kode gelang</span>
          {shown.code ? (
            <span aria-label="Kode gelang" className="font-mono text-[18px] font-bold tracking-wider">
              {shown.code}
            </span>
          ) : (
            <span className="text-[11px] italic">tampil saat dicetak</span>
          )}
          <span className="text-[10px]">Terbit {formatTanggalWaktu(shown.issuedAt)}</span>
        </span>
      </article>
      <div className="band-actions mx-auto flex w-[280mm] max-w-full flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={print} disabled={pending}>
            <Icon name="printer" size={16} />
            Cetak gelang
          </Button>
          <Button onClick={() => setOpen((v) => !v)}>Cetak ulang (gelang rusak/hilang)…</Button>
          <Button variant="ghost" onClick={() => router.back()}>
            Kembali
          </Button>
        </div>
        {open && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ok) return;
              start(async () => {
                const r = await reprintWristbandAction(status.encounterId, { reason: reason.trim() });
                if (r.ok) {
                  setMsg({ ok: true, text: 'Gelang baru terbit; gelang lama tidak berlaku lagi.' });
                  setOpen(false);
                  setReason('');
                  setBand(r.data);
                  setPrinting(true);
                } else setMsg({ ok: false, text: r.message });
              });
            }}
          >
            <label
              htmlFor={`${id}-r`}
              className="flex min-w-[280px] flex-1 flex-col gap-1 text-small font-semibold"
            >
              Alasan cetak ulang (minimal {SAFETY_REASON_MIN} karakter)
              <input
                id={`${id}-r`}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                className="h-11 rounded-control border border-line-strong bg-white px-3"
              />
            </label>
            <Button type="submit" variant="danger" disabled={!ok || pending}>
              Terbitkan gelang baru
            </Button>
          </form>
        )}
        {msg && (
          <p
            role={msg.ok ? 'status' : 'alert'}
            className={`m-0 text-small font-semibold ${msg.ok ? 'text-success' : 'text-danger'}`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </>
  );
}
