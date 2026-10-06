'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import { useState } from 'react';
import { FlashLine, Panel, ReasonButton, SelectField } from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import type { IsolationRequest } from '@/lib/demo/fixtures/ppi';
import { type IsolationRoom, PRECAUTION_LABEL, roomBlock } from '@/lib/ppi';

/**
 * B07 · Penempatan isolasi: permintaan dari unit (MDRO, suspek TB) ditempatkan ke ruang isolasi yang sesuai
 * kewaspadaannya; airborne wajib ruang bertekanan negatif, ruang terisi tidak bisa dipilih.
 */
export function IsolationTab({
  rooms,
  placed,
  requests,
  rev,
}: {
  rooms: readonly IsolationRoom[];
  placed: Record<string, { room: string; jam: string; by: string }>;
  requests: readonly IsolationRequest[];
  rev: number;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const { act, pending, flash } = useTokoAction('ppi', rev);

  const place = (r: IsolationRequest) => {
    const room = rooms.find((x) => x.id === pick[r.id]);
    if (!room || roomBlock(r.precaution, room)) return;
    const { jam } = demoStamp();
    act(
      { type: 'isolasi.ditempatkan', requestId: r.id, roomId: room.id, jam },
      `RM ${r.rm} ditempatkan di ${room.label} · ${jam}; papan tempat tidur dan tanda ${PRECAUTION_LABEL[r.precaution].toLowerCase()} di pintu diperbarui.`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_460px] flex-col gap-4">
          {requests.map((r) => {
            const done = placed[r.id];
            const room = rooms.find((x) => x.id === pick[r.id]);
            return (
              <Panel
                key={r.id}
                title={`Permintaan isolasi · RM ${r.rm}`}
                sub={`${r.unit} · diminta ${formatTanggalWaktu(r.requestedAt)}`}
                actions={
                  <Chip tone={r.precaution === 'airborne' ? 'danger' : 'warning'}>
                    {PRECAUTION_LABEL[r.precaution]}
                  </Chip>
                }
              >
                <p className="m-0 text-small text-ink-700">{r.reason}</p>
                {done ? (
                  <span className="text-small font-semibold text-success">
                    Ditempatkan di {done.room} · {done.jam} oleh {done.by}
                  </span>
                ) : (
                  <>
                    <SelectField
                      label={`Ruang isolasi untuk RM ${r.rm}`}
                      value={pick[r.id] ?? ''}
                      onChange={(v) => setPick((cur) => ({ ...cur, [r.id]: v }))}
                      placeholder="Pilih ruang…"
                      options={rooms.map((x) => [
                        x.id,
                        `${x.label}${x.occupiedBy ? ` · terisi RM ${x.occupiedBy}` : ' · kosong'}`,
                      ])}
                    />
                    <ReasonButton
                      reason={pending ? 'Menyimpan…' : roomBlock(r.precaution, room)}
                      onClick={() => place(r)}
                    >
                      Tempatkan
                    </ReasonButton>
                  </>
                )}
              </Panel>
            );
          })}
        </div>
        <div className="min-w-0 flex-[1_1_300px] xl:max-w-[380px]">
          <Panel
            title="Ruang isolasi"
            sub={`${rooms.filter((x) => !x.occupiedBy).length} dari ${rooms.length} kosong`}
            flush
          >
            <ul className="m-0 list-none p-0">
              {rooms.map((x) => (
                <li
                  key={x.id}
                  className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5 text-small"
                >
                  <span>
                    {x.label}
                    {x.occupiedBy && (
                      <span className="block text-caption text-ink-500">RM {x.occupiedBy}</span>
                    )}
                  </span>
                  <Chip tone={x.occupiedBy ? 'neutral' : 'success'}>
                    {x.occupiedBy ? 'Terisi' : 'Kosong'}
                  </Chip>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
