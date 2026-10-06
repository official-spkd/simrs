'use client';

import { Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { type BundleDef, bundleCompliant } from '@/lib/ppi';

const TARGET = 85;
const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0);

/**
 * B07 · Audit bundle all-or-none (VAP, ISK kateter, IDO): observer mencentang elemen yang dilakukan pada satu pasien;
 * patuh hanya bila semua elemen dilakukan. Elemen yang terlewat disebut di umpan balik untuk edukasi unit.
 */
export function BundleTab({
  bundles,
  audits,
  rev,
}: {
  bundles: readonly BundleDef[];
  audits: Record<string, { total: number; compliant: number }>;
  rev: number;
}) {
  const [bundleId, setBundleId] = useState(bundles[0]?.id ?? '');
  const [rm, setRm] = useState('');
  const [checks, setChecks] = useState<boolean[]>(() => (bundles[0]?.elements ?? []).map(() => false));
  const { act, pending, flash, setFlash } = useTokoAction('ppi', rev);
  const bundle = bundles.find((b) => b.id === bundleId);
  const block = pending
    ? 'Menyimpan…'
    : !/^\d{2}-\d{2}-\d{2}-\d{2}$/.test(rm.trim())
      ? 'Isi nomor RM pasien yang diaudit (format 00-00-00-00).'
      : null;

  const save = () => {
    if (!bundle || block) return;
    const ok = bundleCompliant(checks);
    const missed = bundle.elements.filter((_, i) => !checks[i]);
    const { jam } = demoStamp();
    const text = ok
      ? `${bundle.label} RM ${rm.trim()} patuh (semua elemen) · ${jam}.`
      : `${bundle.label} RM ${rm.trim()} tidak patuh · ${jam}: terlewat ${missed.join(', ').toLowerCase()}. Umpan balik dikirim ke kepala ruang.`;
    act({ type: 'bundle.diaudit', bundleId: bundle.id, rm: rm.trim(), checks, jam }, null, () => {
      setFlash({ ok, text });
      setRm('');
      setChecks(bundle.elements.map(() => false));
    });
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
