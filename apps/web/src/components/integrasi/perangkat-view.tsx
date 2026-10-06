'use client';

import { formatJam } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { processHl7Action } from '@/app/(staf)/sistem/integrasi/perangkat/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import type { GatewayData } from '@/lib/server/data/integrasi-lanjut';

const ACK_TONE = { AA: 'success', AE: 'warning', AR: 'danger' } as const;

/**
 * I06 · Device gateway (simulasi): analyzer terdaftar, pesan HL7 ORU^R01 masuk → ACK → cocokkan nomor lab → hasil
 * sebagai draf menunggu validasi analis. Pesan ditampilkan dengan PID tersamar; control ID ganda idempoten.
 */
export function GatewayView({ data }: { data: GatewayData }) {
  const id = useId();
  const [presetId, setPresetId] = useState(data.presets[0]?.id ?? '');
  const [raw, setRaw] = useState(data.presets[0]?.raw ?? '');
  const log = data.log;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(data.rev);

  const send = () =>
    save(
      (rev) => processHl7Action({ raw }, rev),
      (result) => setMsg({ ok: result.ok, text: result.message }),
    );

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Perangkat terdaftar" className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.devices.map((d) => (
          <div
            key={d.id}
            className="flex flex-col gap-1 rounded-card border border-white/95 bg-white/90 shadow-card p-3.5"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {d.name} · <span className="font-mono">{d.id}</span>
              </span>
              <Chip tone={d.status === 'online' ? 'success' : 'danger'}>
                {d.status === 'online' ? 'Terhubung' : 'Terputus'}
              </Chip>
            </span>
            <span className="text-caption text-ink-500">{d.protocol} · prinsipal perangkat terdaftar</span>
            <span className="text-small">
              {d.messagesToday} pesan hari ini · terakhir {formatJam(d.lastMessageAt)}
            </span>
          </div>
        ))}
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form
          aria-label="Simulasi pesan masuk"
          className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <h2 className="m-0 text-[15px] font-semibold">Simulasi pesan masuk analyzer</h2>
          <label htmlFor={`${id}-preset`} className="text-small font-semibold text-ink-700">
            Pesan contoh
          </label>
          <select
            id={`${id}-preset`}
            value={presetId}
            onChange={(e) => {
              setPresetId(e.target.value);
              setRaw(data.presets.find((p) => p.id === e.target.value)?.raw ?? '');
            }}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            {data.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-raw`} className="text-small font-semibold text-ink-700">
            Isi pesan HL7 (boleh diubah untuk mencoba galat)
          </label>
          <textarea
            id={`${id}-raw`}
            value={raw}
            rows={7}
            spellCheck={false}
            onChange={(e) => setRaw(e.target.value)}
            className="rounded-control border border-line-strong bg-white px-3 py-2 font-mono text-caption"
          />
          <Button type="submit" variant="primary" className="self-start" disabled={pending || !raw.trim()}>
            Kirim ke gateway
          </Button>
          <span className="text-caption text-ink-500">
            Hasil yang cocok selalu masuk sebagai draf; validasi dan nilai kritis tetap di layar{' '}
            <Link href="/penunjang/lab" className="inline-flex min-h-11 items-center">
              Laboratorium
            </Link>
            .
          </span>
        </form>
        <section
          aria-label="Log pesan gateway"
          className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <h2 className="m-0 text-[15px] font-semibold">Log pesan tersimpan</h2>
          {msg && <Alert level={msg.ok ? 'success' : 'warning'}>{msg.text}</Alert>}
          {log.length === 0 ? (
            <p className="m-0 text-small text-ink-700">
              Belum ada pesan baru. Hari ini sudah diproses: {data.processed.join(', ')}.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {log.map((l, i) => (
                <li
                  key={`${l.at}-${i}`}
                  className="flex flex-col gap-1 rounded-[12px] border border-line bg-white/80 p-2.5 text-small"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone={ACK_TONE[l.result.ack]}>ACK {l.result.ack}</Chip>
                    <span className="font-mono">{l.result.controlId ?? '—'}</span>
                    <span className="text-ink-500">{l.at}</span>
                  </span>
                  <span>{l.result.text}</span>
                  {l.result.status === 'dicocokkan' && (
                    <ul className="m-0 list-disc pl-5 text-caption">
                      {l.result.observations.map((o) => (
                        <li key={o.loinc}>
                          {o.name} (LOINC {o.loinc}) {o.value} {o.unit} · flag {o.flag || '—'} · draf
                        </li>
                      ))}
                    </ul>
                  )}
                  <pre className="m-0 overflow-auto rounded-control bg-batu-100 p-2 font-mono text-caption">
                    {l.redacted}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
