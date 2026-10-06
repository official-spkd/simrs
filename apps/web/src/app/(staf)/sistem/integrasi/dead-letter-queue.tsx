'use client';

import { type DlqMessage, formatJam, type InterfaceId, OUTBOX_MAX_ATTEMPTS } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { GatedButton } from '@/components/gated-button';
import { dlqNeedsFix, dlqPayloadText } from '@/lib/manajemen';
import { resendDeadLettersAction } from './actions';

interface Flash {
  tone: 'ok' | 'warn';
  text: string;
}

/**
 * Dead-letter queue (I01): centang pesan → "Kirim ulang terpilih" → konfirmasi → Server Action simulasi.
 * Payload galat hanya berisi pengenal teknis. Kirim ulang ditahan selama uji downtime: konfirmasi yang terbuka
 * ditutup dan "Ya, kirim ulang" nonaktif sampai koneksi pulih.
 */
export function DeadLetterQueue({
  messages,
  names,
  filterName,
  onClearFilter,
  holding,
  onResent,
}: {
  messages: DlqMessage[];
  names: Record<InterfaceId, string>;
  filterName: string | null;
  onClearFilter: () => void;
  holding: boolean;
  onResent: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Hanya pesan bergalat sementara yang bisa dipilih; galat permanen menunggu perbaikan data.
  const resendable = messages.filter((m) => !dlqNeedsFix(m));
  const visibleIds = resendable.map((m) => m.id);
  const chosen = resendable.filter((m) => picked.has(m.id));
  const allOn = resendable.length > 0 && chosen.length === resendable.length;
  const selected = messages.find((m) => m.id === sel) ?? messages[0] ?? null;
  const reason = holding
    ? 'Ditahan selama uji downtime: pesan tetap di antrean lokal sampai koneksi pulih.'
    : chosen.length === 0
      ? 'Centang minimal satu pesan untuk dikirim ulang.'
      : null;

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  // Uji downtime dimulai saat konfirmasi terbuka: tutup, jangan biarkan kirim ulang lolos dari penahanan.
  useEffect(() => {
    if (holding) setConfirm(false);
  }, [holding]);

  // Ganti tujuan (klik kartu): pesan dan payload terpilih dikosongkan seperti mockup.
  useEffect(() => {
    setFlash(null);
    setSel(null);
  }, [filterName]);

  /** Tutup konfirmasi dan kembalikan fokus ke tombol pemicunya. */
  const closeConfirm = () => {
    setConfirm(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const toggle = (id: string) => {
    setFlash(null);
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setFlash(null);
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of visibleIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const send = () => {
    if (holding) return;
    const ids = chosen.map((m) => m.id);
    startTransition(async () => {
      const r = await resendDeadLettersAction({ ids });
      closeConfirm();
      setFlash({ tone: r.ok ? 'ok' : 'warn', text: r.message });
      if (r.ok) {
        setPicked((cur) => new Set([...cur].filter((id) => !r.ids.includes(id))));
        onResent(r.ids);
      }
    });
  };

  const byTarget = [...new Set(chosen.map((m) => names[m.target]))];

  return (
    <section
      aria-labelledby="dlq-judul"
      className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-card border border-line bg-white"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
          <h2 id="dlq-judul" className="m-0 text-base font-semibold">
            Dead-letter queue
          </h2>
          <span className="text-[12.5px] text-ink-500">
            Galat sementara di-retry eksponensial (bawaan {OUTBOX_MAX_ATTEMPTS} percobaan); galat permanen
            (4xx, penolakan bisnis) langsung masuk antrean ini. Transaksi klinis tetap tersimpan lokal.
          </span>
          {filterName && (
            <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] font-semibold text-brand-700">
              Tujuan: {filterName} · {messages.length} pesan
              <button
                type="button"
                onClick={onClearFilter}
                className="h-11 cursor-pointer border-0 bg-transparent px-1 font-[inherit] text-brand-600 underline"
              >
                Tampilkan semua tujuan
              </button>
            </span>
          )}
        </div>
        <div className="flex max-w-[300px] flex-col items-end gap-1">
          <GatedButton
            ref={triggerRef}
            variant="primary"
            enabled={reason === null && !pending}
            aria-describedby={reason ? 'dlq-alasan' : undefined}
            onClick={() => {
              setFlash(null);
              setConfirm(true);
            }}
          >
            {chosen.length ? `Kirim ulang terpilih (${chosen.length})` : 'Kirim ulang terpilih'}
          </GatedButton>
          {reason && (
            <span id="dlq-alasan" className="text-right text-caption text-ink-500">
              {reason}
            </span>
          )}
        </div>
      </div>

      {confirm && !holding && chosen.length > 0 && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="alertdialog"
          aria-labelledby="dlq-konfirmasi"
          aria-describedby="dlq-konfirmasi-isi"
          className="flex flex-col gap-2 border-b border-[#F5D9A8] bg-warning-bg px-4 py-3 outline-none"
        >
          <span id="dlq-konfirmasi" className="font-semibold text-ink-900">
            Kirim ulang {chosen.length} pesan ke {byTarget.join(', ')}?
          </span>
          <span id="dlq-konfirmasi-isi" className="text-small text-ink-700">
            Pesan dikirim ulang dengan kunci idempotensi yang sama sehingga tujuan tidak menerima data ganda.
            Tindakan ini tercatat di log audit.
          </span>
          <span className="flex flex-wrap gap-2">
            <Button onClick={closeConfirm} disabled={pending}>
              Batal
            </Button>
            <Button variant="primary" onClick={send} disabled={pending || holding}>
              {pending ? 'Mengirim ulang…' : 'Ya, kirim ulang'}
            </Button>
          </span>
        </div>
      )}
      {flash && (
        <div
          role="status"
          className={cx(
            'border-b border-line px-4 py-2 text-[12.5px] font-medium',
            flash.tone === 'ok' ? 'bg-[#EAF5EC] text-success' : 'bg-warning-bg text-warning',
          )}
        >
          {flash.text}
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-line bg-[#F8FAFB] text-caption font-semibold text-ink-500">
        <label className="flex h-11 cursor-pointer items-center gap-2 pr-3 pl-3.5">
          <input
            type="checkbox"
            checked={allOn}
            onChange={toggleAll}
            disabled={resendable.length === 0}
            className="h-4 w-4 accent-brand-600"
          />
          Pilih semua yang tampil
        </label>
        <span className="ml-auto pr-4">{messages.length} pesan di antrean</span>
      </div>
      <ul className="m-0 list-none p-0" aria-label="Pesan gagal">
        {messages.map((d) => {
          const isSel = selected?.id === d.id;
          const t = formatJam(d.at);
          const needsFix = dlqNeedsFix(d);
          return (
            <li
              key={d.id}
              className={cx(
                'flex items-stretch border-b border-[#EEF1F4]',
                isSel
                  ? 'bg-[#EEF6F5] shadow-[inset_3px_0_0_#0F766E]'
                  : d.critical
                    ? 'bg-[#FFF8F7]'
                    : 'bg-white',
              )}
            >
              <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  checked={!needsFix && picked.has(d.id)}
                  disabled={!!needsFix}
                  onChange={() => toggle(d.id)}
                  aria-label={`Pilih pesan ${names[d.target]} ${d.operation} pukul ${t}`}
                  aria-describedby={needsFix ? `dlq-fix-${d.id}` : undefined}
                  className="h-4 w-4 accent-brand-600"
                />
              </label>
              <button
                type="button"
                aria-pressed={isSel}
                onClick={() => setSel(d.id)}
                className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col gap-0.5 border-0 bg-transparent py-2 pr-4 text-left font-[inherit] text-ink-900"
              >
                <span className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-small">
                  <span className="font-mono text-ink-500">{t}</span>
                  <span className="font-medium">{names[d.target]}</span>
                  <span className="min-w-0 font-mono text-[12px] break-all">{d.operation}</span>
                  <span className="ml-auto font-mono text-caption text-ink-500">
                    percobaan {d.attempts}/{d.maxAttempts}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-700">
                  {d.critical && <Chip tone="danger">Menahan layanan</Chip>}
                  <span>
                    {d.errorCode} · {d.errorMessage}
                  </span>
                </span>
                {needsFix && (
                  <span id={`dlq-fix-${d.id}`} className="text-caption font-medium text-warning">
                    {needsFix.reason}
                  </span>
                )}
              </button>
              {needsFix?.fix && (
                <Link
                  href={needsFix.fix.href}
                  className="flex shrink-0 items-center px-3 text-caption font-semibold text-brand-700"
                >
                  Perbaiki di {needsFix.fix.label}
                  <span className="sr-only">
                    {' '}
                    · pesan {d.operation} pukul {t}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {messages.length === 0 && (
        <p className="m-0 border-b border-[#EEF1F4] px-4 py-4 text-small text-ink-500">
          Tidak ada pesan gagal{filterName ? ` untuk ${filterName}` : ''}.
        </p>
      )}
      <div className="flex flex-col gap-1 bg-[#F8FAFB] px-4 py-3">
        <span className="text-caption font-semibold text-ink-500">
          Payload galat{selected ? ` · ${selected.id}` : ''} · pengenal saja, tanpa data pribadi
        </span>
        <pre
          aria-live="polite"
          aria-label="Payload galat"
          className="m-0 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-700 [overflow-wrap:anywhere]"
        >
          {selected ? dlqPayloadText(selected) : 'Tidak ada payload galat untuk ditampilkan.'}
        </pre>
      </div>
    </section>
  );
}
