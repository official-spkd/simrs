'use client';

import { Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  TableWrap,
  TD,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { HH_MOMENTS, type HhAction, type HhObservation, hhByProfession, hhCompliance } from '@/lib/ppi';

const TARGET = 85;
const ACTIONS: ReadonlyArray<readonly [HhAction, string]> = [
  ['handrub', 'Handrub berbasis alkohol'],
  ['cuci', 'Cuci tangan sabun dan air'],
  ['tidak', 'Tidak dilakukan (peluang terlewat)'],
];

/**
 * B07 · Audit kebersihan tangan 5 momen (INM-01): observer mencatat tiap peluang (profesi, momen, tindakan);
 * kepatuhan = tindakan ÷ peluang, per profesi dan total, terhadap sasaran ≥ 85%.
 */
export function HandHygieneTab({
  observations: obs,
  session,
  rev,
}: {
  observations: readonly HhObservation[];
  /** Peluang yang dicatat di layar (toko demo). */
  session: number;
  rev: number;
}) {
  const [profession, setProfession] = useState('');
  const [moment, setMoment] = useState('');
  const [action, setAction] = useState('');
  const { act, pending, flash } = useTokoAction('ppi', rev);
  const total = hhCompliance(obs);
  const rows = hhByProfession(obs);
  const block = pending
    ? 'Menyimpan…'
    : !profession || !moment || !action
      ? 'Pilih profesi, momen, dan tindakan.'
      : null;

  const record = () => {
    if (block) return;
    const o: HhObservation = { profession, moment: Number(moment), action: action as HhAction };
    const c = hhCompliance([...obs, o]);
    const { jam } = demoStamp();
    act(
      {
        type: 'hh.dicatat',
        profession: profession as 'Perawat' | 'Dokter' | 'Bidan' | 'Penunjang',
        moment: o.moment,
        action: o.action,
        jam,
      },
      `Peluang ${HH_MOMENTS[o.moment]?.toLowerCase()} (${profession}) tercatat · ${jam}; kepatuhan bulan ini ${c.pct}% (${c.done}/${c.total}).`,
      () => setAction(''),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_460px]">
          <Panel
            title="Kepatuhan kebersihan tangan · Oktober 2026"
            sub={`INM-01 · sasaran ≥ ${TARGET}% · ${total.total} peluang diamati`}
            actions={
              <Chip tone={(total.pct ?? 0) >= TARGET ? 'success' : 'danger'}>
                {total.pct}% {(total.pct ?? 0) >= TARGET ? 'memenuhi sasaran' : 'di bawah sasaran'}
              </Chip>
            }
            flush
          >
            <TableWrap label="Kepatuhan per profesi">
              <thead>
                <tr>
                  <th className={TH}>Profesi</th>
                  <th className={`${TH} text-right`}>Dilakukan</th>
                  <th className={`${TH} text-right`}>Peluang</th>
                  <th className={`${TH} text-right`}>Kepatuhan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.profession}>
                    <td className={TD}>{r.profession}</td>
                    <td className={`${TD} text-right font-mono`}>{r.done}</td>
                    <td className={`${TD} text-right font-mono`}>{r.total}</td>
                    <td className={`${TD} text-right`}>
                      <Chip tone={r.pct >= TARGET ? 'success' : 'warning'}>{r.pct}%</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
        <div className="min-w-0 flex-[1_1_320px] xl:max-w-[420px]">
          <Panel
            title="Catat peluang"
            sub={session ? `${session} peluang dicatat sesi ini` : 'Observasi langsung oleh IPCLN'}
          >
            <SelectField
              label="Profesi yang diamati"
              value={profession}
              onChange={setProfession}
              placeholder="Pilih profesi…"
              options={['Perawat', 'Dokter', 'Bidan', 'Penunjang'].map((p) => [p, p])}
            />
            <SelectField
              label="Momen"
              value={moment}
              onChange={setMoment}
              placeholder="Pilih momen…"
              options={HH_MOMENTS.map((m, i) => [String(i), `${i + 1}. ${m}`])}
            />
            <SelectField
              label="Tindakan"
              value={action}
              onChange={setAction}
              placeholder="Pilih tindakan…"
              options={ACTIONS}
            />
            <ReasonButton reason={block} onClick={record}>
              Catat peluang
            </ReasonButton>
          </Panel>
        </div>
      </div>
    </div>
  );
}
