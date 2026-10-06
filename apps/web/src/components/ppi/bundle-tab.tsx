'use client';

import { formatJam } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
  type Flash,
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { type BundleDef, bundleCompliant } from '@/lib/ppi';

const TARGET = 85;
const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0);

/**
 * B07 · Audit bundle all-or-none (VAP, ISK kateter, IDO): observer mencentang elemen yang dilakukan pada satu pasien;
 * patuh hanya bila semua elemen dilakukan. Elemen yang terlewat disebut di umpan balik untuk edukasi unit.
 */
export function BundleTab({
  bundles,
  initial,
}: {
  bundles: readonly BundleDef[];
  initial: Record<string, { total: number; compliant: number }>;
}) {
  const [audits, setAudits] = useState(initial);
  const [bundleId, setBundleId] = useState(bundles[0]?.id ?? '');
  const [rm, setRm] = useState('');
  const [checks, setChecks] = useState<boolean[]>(() => (bundles[0]?.elements ?? []).map(() => false));
  const [flash, setFlash] = useState<Flash | null>(null);
  const bundle = bundles.find((b) => b.id === bundleId);
  const block = !/^\d{2}-\d{2}-\d{2}-\d{2}$/.test(rm.trim())
    ? 'Isi nomor RM pasien yang diaudit (format 00-00-00-00).'
    : null;

  const save = () => {
    if (!bundle || block) return;
    const ok = bundleCompliant(checks);
    const missed = bundle.elements.filter((_, i) => !checks[i]);
    setAudits((cur) => {
      const a = cur[bundle.id] ?? { total: 0, compliant: 0 };
      return { ...cur, [bundle.id]: { total: a.total + 1, compliant: a.compliant + (ok ? 1 : 0) } };
    });
    setFlash({
      ok,
      text: ok
        ? `${bundle.label} RM ${rm.trim()} patuh (semua elemen) · ${formatJam(demoNow())}.`
        : `${bundle.label} RM ${rm.trim()} tidak patuh · ${formatJam(demoNow())}: terlewat ${missed.join(', ').toLowerCase()}. Umpan balik dikirim ke kepala ruang.`,
    });
    setRm('');
    setChecks(bundle.elements.map(() => false));
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_460px]">
          <Panel title="Kepatuhan bundle · Oktober 2026" sub={`All-or-none · sasaran ≥ ${TARGET}%`} flush>
            <TableWrap label="Kepatuhan bundle per jenis">
              <thead>
                <tr>
                  <th className={TH}>Bundle</th>
                  <th className={`${TH} text-right`}>Patuh</th>
                  <th className={`${TH} text-right`}>Diaudit</th>
                  <th className={`${TH} text-right`}>Kepatuhan</th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => {
                  const a = audits[b.id] ?? { total: 0, compliant: 0 };
                  const p = pct(a.compliant, a.total);
                  return (
                    <tr key={b.id}>
                      <td className={TD}>{b.label}</td>
                      <td className={`${TD} text-right font-mono`}>{a.compliant}</td>
                      <td className={`${TD} text-right font-mono`}>{a.total}</td>
                      <td className={`${TD} text-right`}>
                        <Chip tone={p >= TARGET ? 'success' : 'danger'}>
                          {p}%{p >= TARGET ? '' : ' · di bawah sasaran'}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
        <div className="min-w-0 flex-[1_1_320px] xl:max-w-[420px]">
          <Panel title="Audit bundle satu pasien">
            <SelectField
              label="Bundle"
              value={bundleId}
              onChange={(v) => {
                setBundleId(v);
                setChecks((bundles.find((b) => b.id === v)?.elements ?? []).map(() => false));
              }}
              options={bundles.map((b) => [b.id, b.label])}
            />
            <TextField label="Nomor RM" value={rm} onChange={setRm} placeholder="00-00-00-00" />
            <span className="text-small font-semibold text-ink-700">Elemen yang dilakukan</span>
            <div className="flex flex-col">
              {(bundle?.elements ?? []).map((el, i) => (
                <CheckField
                  key={el}
                  label={el}
                  checked={checks[i] ?? false}
                  onChange={(v) => setChecks((cur) => cur.map((x, j) => (j === i ? v : x)))}
                />
              ))}
            </div>
            <ReasonButton reason={block} onClick={save}>
              Simpan audit
            </ReasonButton>
          </Panel>
        </div>
      </div>
    </div>
  );
}
