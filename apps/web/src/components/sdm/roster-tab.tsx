'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useState } from 'react';
import { FlashLine, Panel, ReasonButton, SelectField, TableWrap, TD, TH } from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import type { Employee } from '@/lib/demo/fixtures/pegawai';
import {
  MAX_WEEK_HOURS,
  overHours,
  publishBlock,
  restViolations,
  type Roster,
  rosterGaps,
  type Shift,
  SHIFT_HOURS,
  SHIFT_LABEL,
  SHIFTS,
  shortName,
  weeklyHours,
} from '@/lib/sdm';
import type { HrStoreState } from '@/lib/sdm-toko';

/**
 * B03 · Jadwal dinas satu unit (draf → terbit → revisi): grid hari × dinas dengan kekurangan per dinas, jeda
 * istirahat setelah malam (pagi/siang) yang dilanggar, dan beban > 40 jam. Klik sel untuk menambah/melepas perawat;
 * "Terbitkan" nonaktif beralasan sampai bersih. Tersimpan di toko demo (domain `sdm`, ADR-0085).
 */
export function RosterTab({
  unit,
  weekLabel,
  dayLabels,
  minimum,
  staff,
  roster,
  version,
  published,
  rev,
}: {
  unit: string;
  weekLabel: string;
  dayLabels: readonly string[];
  minimum: Record<Shift, number>;
  staff: readonly Employee[];
  roster: Roster;
  version: number;
  published: HrStoreState['published'];
  rev: number;
}) {
  const days = dayLabels.length;
  const [cell, setCell] = useState<{ day: number; shift: Shift } | null>(null);
  const [pick, setPick] = useState('');
  const { act, pending, flash } = useTokoAction('sdm', rev);
  const byId = new Map(staff.map((e) => [e.id, e]));
  const gaps = rosterGaps(roster, days, minimum);
  const violations = restViolations(roster, days);
  const over = overHours(
    roster,
    staff.map((e) => e.id),
  );
  const block = pending ? 'Menyimpan…' : publishBlock(gaps, violations, over);
  const gapAt = (d: number, s: Shift) => gaps.find((g) => g.day === d && g.shift === s);
  const violAt = (d: number, s: Shift, id: string) =>
    violations.some((v) => v.day === d && v.shift === s && v.staffId === id);

  const onDay = (d: number) => new Set(SHIFTS.flatMap((s) => roster[d]?.[s] ?? []));
  const selected = cell ? (roster[cell.day]?.[cell.shift] ?? []) : [];
  const candidates = cell ? staff.filter((e) => !onDay(cell.day).has(e.id)) : [];

  const add = () => {
    if (!cell || !pick) return;
    const who = byId.get(pick);
    act(
      { type: 'dinas.ditambah', day: cell.day, shift: cell.shift, staffId: pick },
      `${who?.name ?? ''} ditambahkan ke dinas ${SHIFT_LABEL[cell.shift].toLowerCase()} ${dayLabels[cell.day]}.`,
      () => setPick(''),
    );
  };
  const remove = (id: string) => {
    if (!cell) return;
    act(
      { type: 'dinas.dilepas', day: cell.day, shift: cell.shift, staffId: id },
      `${byId.get(id)?.name ?? ''} dilepas dari dinas ${SHIFT_LABEL[cell.shift].toLowerCase()} ${dayLabels[cell.day]}.`,
    );
  };
  const publish = () => {
    if (block) return;
    const { when } = demoStamp();
    act(
      { type: 'jadwal.diterbitkan', when },
      `Jadwal ${unit} ${weekLabel} terbit versi ${version} · ${formatTanggalWaktu(when)}; ${staff.filter((e) => weeklyHours(roster, e.id) > 0).length} perawat menerima notifikasi.`,
      () => setCell(null),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Panel
        title={`Jadwal dinas ${unit} · ${weekLabel}`}
        sub={`Minimum per dinas: pagi ${minimum.P}, siang ${minimum.S}, malam ${minimum.M} perawat · jam dinas P ${SHIFT_HOURS.P} · S ${SHIFT_HOURS.S} · M ${SHIFT_HOURS.M}`}
        actions={
          published ? (
            <>
              <Chip tone="success">
                Terbit versi {published.version} · {formatTanggalWaktu(published.when)} · {published.by.name}
              </Chip>
              <Button
                disabled={pending}
                onClick={() =>
                  act(
                    { type: 'jadwal.direvisi', when: demoStamp().when },
                    `Revisi versi ${version + 1} dibuka sebagai draf; versi terbit tetap berlaku sampai revisi terbit.`,
                  )
                }
              >
                Buat revisi
              </Button>
            </>
          ) : (
            <>
              <Chip tone="warning">Draf versi {version}</Chip>
              <ReasonButton reason={block} onClick={publish}>
                Terbitkan jadwal
              </ReasonButton>
            </>
          )
        }
        flush
      >
        <TableWrap label="Grid jadwal dinas">
          <thead>
            <tr>
              <th className={TH}>Dinas</th>
              {dayLabels.map((d) => (
                <th key={d} className={TH}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((s) => (
              <tr key={s}>
                <th scope="row" className={`${TD} text-left text-caption font-semibold text-ink-700`}>
                  {SHIFT_LABEL[s]}
                </th>
                {dayLabels.map((label, d) => {
                  const ids = roster[d]?.[s] ?? [];
                  const gap = gapAt(d, s);
                  const viol = ids.some((id) => violAt(d, s, id));
                  const active = cell?.day === d && cell.shift === s;
                  return (
                    <td key={label} className={`${TD} p-1`}>
                      <button
                        type="button"
                        aria-pressed={active}
                        disabled={!!published}
                        aria-label={`${SHIFT_LABEL[s]} ${label}: ${ids.length} dari ${minimum[s]} perawat${gap ? ', kurang' : ''}${viol ? ', jeda istirahat dilanggar' : ''}`}
                        onClick={() => {
                          setCell({ day: d, shift: s });
                          setPick('');
                        }}
                        className={cx(
                          'flex min-h-touch w-full min-w-[84px] cursor-pointer flex-col items-start gap-0.5 rounded-control border px-2 py-1.5 text-left font-[inherit] text-caption disabled:cursor-default',
                          active
                            ? 'border-brand-600 bg-selected'
                            : gap || viol
                              ? 'border-warning-border bg-warning-bg'
                              : 'border-line bg-white',
                        )}
                      >
                        {ids.map((id) => (
                          <span key={id} className={cx(violAt(d, s, id) && 'font-semibold text-danger')}>
                            {shortName(byId.get(id)?.name ?? id)}
                          </span>
                        ))}
                        {gap && (
                          <span className="font-semibold text-warning">kurang {gap.need - gap.have}</span>
                        )}
                        {viol && <span className="font-semibold text-danger">jeda &lt; 8 jam</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_420px]">
          {cell && !published ? (
            <Panel
              title={`Dinas ${SHIFT_LABEL[cell.shift].toLowerCase()} · ${dayLabels[cell.day]}`}
              sub={`${selected.length} dari minimum ${minimum[cell.shift]} perawat`}
            >
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {selected.map((id) => (
                  <li
                    key={id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-1.5 text-small"
                  >
                    <span>
                      {byId.get(id)?.name}
                      {violAt(cell.day, cell.shift, id) && (
                        <span className="ml-2 font-semibold text-danger">dinas malam kemarin</span>
                      )}
                    </span>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(id)}>
                      Lepas<span className="sr-only"> {byId.get(id)?.name}</span>
                    </Button>
                  </li>
                ))}
                {selected.length === 0 && (
                  <li className="text-small text-ink-500">Belum ada perawat di dinas ini.</li>
                )}
              </ul>
              <SelectField
                label="Tambah perawat"
                value={pick}
                onChange={setPick}
                placeholder={
                  candidates.length
                    ? 'Pilih perawat yang belum dinas hari ini…'
                    : 'Semua perawat sudah dinas hari ini'
                }
                options={candidates.map((e) => [
                  e.id,
                  `${e.name} · ${e.unit} · ${weeklyHours(roster, e.id)} jam minggu ini`,
                ])}
              />
              <ReasonButton reason={pending ? 'Menyimpan…' : pick ? null : 'Pilih perawat dulu.'} onClick={add}>
                Tambahkan ke dinas
              </ReasonButton>
            </Panel>
          ) : (
            <Alert
              level={published ? 'success' : 'info'}
              title={published ? 'Jadwal terbit' : 'Cara mengubah'}
            >
              {published
                ? 'Jadwal terkunci. Perubahan dibuat sebagai revisi berversi; anomali akses di luar jam dinas memakai jadwal terbit ini.'
                : 'Klik sel di grid untuk menambah atau melepas perawat. Sel kuning: kurang dari minimum atau jeda istirahat dilanggar.'}
            </Alert>
          )}
        </div>
        <div className="min-w-0 flex-[1_1_300px] xl:max-w-[400px]">
          <Panel title="Beban dinas per perawat" sub={`Batas ${MAX_WEEK_HOURS} jam per minggu`} flush>
            <ul className="m-0 list-none p-0">
              {staff.map((e) => {
                const h = weeklyHours(roster, e.id);
                return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2 text-small"
                  >
                    <span className="min-w-0">
                      {e.name}
                      <span className="block text-caption text-ink-500">{e.unit}</span>
                    </span>
                    <Chip tone={h > MAX_WEEK_HOURS ? 'danger' : h === 0 ? 'neutral' : 'brand'}>
                      {h} jam{h > MAX_WEEK_HOURS ? ' · melebihi batas' : ''}
                    </Chip>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
