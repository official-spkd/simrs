'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useState } from 'react';
import {
  type Flash,
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  TableWrap,
  TD,
  TH,
} from '@/components/backoffice/kit';
import type { Employee } from '@/lib/demo/fixtures/pegawai';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  assign,
  publishBlock,
  restViolations,
  type Roster,
  rosterGaps,
  type Shift,
  SHIFT_HOURS,
  SHIFT_LABEL,
  SHIFTS,
  shortName,
  unassign,
  weeklyHours,
} from '@/lib/sdm';

const MAX_WEEK_HOURS = 40;

/**
 * B03 · Jadwal dinas satu unit (draf → terbit): grid hari × dinas dengan kekurangan per dinas dan jeda istirahat
 * malam → pagi yang dilanggar. Klik sel untuk menambah/melepas perawat; "Terbitkan" nonaktif beralasan sampai bersih.
 */
export function RosterTab({
  unit,
  weekLabel,
  dayLabels,
  minimum,
  staff,
  initial,
}: {
  unit: string;
  weekLabel: string;
  dayLabels: readonly string[];
  minimum: Record<Shift, number>;
  staff: readonly Employee[];
  initial: Roster;
}) {
  const days = dayLabels.length;
  const [roster, setRoster] = useState<Roster>(initial);
  const [cell, setCell] = useState<{ day: number; shift: Shift } | null>(null);
  const [pick, setPick] = useState('');
  const [published, setPublished] = useState<{ version: number; at: string } | null>(null);
  const [version, setVersion] = useState(1);
  const [flash, setFlash] = useState<Flash | null>(null);
  const byId = new Map(staff.map((e) => [e.id, e]));
  const gaps = rosterGaps(roster, days, minimum);
  const violations = restViolations(roster, days);
  const block = publishBlock(gaps, violations);
  const gapAt = (d: number, s: Shift) => gaps.find((g) => g.day === d && g.shift === s);
  const violAt = (d: number, s: Shift, id: string) =>
    s === 'P' && violations.some((v) => v.day === d && v.staffId === id);

  const onDay = (d: number) => new Set(SHIFTS.flatMap((s) => roster[d]?.[s] ?? []));
  const selected = cell ? (roster[cell.day]?.[cell.shift] ?? []) : [];
  const candidates = cell ? staff.filter((e) => !onDay(cell.day).has(e.id)) : [];

  const add = () => {
    if (!cell || !pick) return;
    const who = byId.get(pick);
    setRoster((r) => assign(r, cell.day, cell.shift, pick));
    setFlash({
      ok: true,
      text: `${who?.name ?? ''} ditambahkan ke dinas ${SHIFT_LABEL[cell.shift].toLowerCase()} ${dayLabels[cell.day]}.`,
    });
    setPick('');
  };
  const remove = (id: string) => {
    if (!cell) return;
    setRoster((r) => unassign(r, cell.day, cell.shift, id));
    setFlash({
      ok: true,
      text: `${byId.get(id)?.name ?? ''} dilepas dari dinas ${SHIFT_LABEL[cell.shift].toLowerCase()} ${dayLabels[cell.day]}.`,
    });
  };
  const publish = () => {
    if (block) return;
    const at = formatTanggalWaktu(demoNow());
    setPublished({ version, at });
    setCell(null);
    setFlash({
      ok: true,
      text: `Jadwal ${unit} ${weekLabel} terbit versi ${version} · ${at}; ${staff.filter((e) => weeklyHours(roster, e.id) > 0).length} perawat menerima notifikasi (simulasi, tidak disimpan).`,
    });
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
                Terbit versi {published.version} · {published.at}
              </Chip>
              <Button
                onClick={() => {
                  setPublished(null);
                  setVersion((v) => v + 1);
                  setFlash({
                    ok: true,
                    text: `Revisi versi ${version + 1} dibuka sebagai draf; versi terbit tetap berlaku sampai revisi terbit.`,
                  });
                }}
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
                    <Button size="sm" variant="ghost" onClick={() => remove(id)}>
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
              <ReasonButton reason={pick ? null : 'Pilih perawat dulu.'} onClick={add}>
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
                    <Chip tone={h > MAX_WEEK_HOURS ? 'danger' : h === 0 ? 'neutral' : 'brand'}>{h} jam</Chip>
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
