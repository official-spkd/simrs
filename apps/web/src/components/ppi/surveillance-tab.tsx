'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
  ConfirmBox,
  FlashLine,
  Panel,
  PickRow,
  ReasonButton,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import type { HaiSuspect } from '@/lib/demo/fixtures/ppi';
import {
  confirmBlock,
  formatRate,
  HAI_CRITERIA,
  HAI_DEFS,
  haiOnTarget,
  haiRate,
  type HaiType,
} from '@/lib/ppi';
import { MIN_PPI_REASON, type PpiStoreState } from '@/lib/ppi-toko';

const CENSUS: ReadonlyArray<{ type: HaiType; label: string }> = [
  { type: 'isk', label: 'Pasien dengan kateter urine' },
  { type: 'vap', label: 'Pasien dengan ventilator' },
  { type: 'phlebitis', label: 'Pasien dengan infus perifer' },
  { type: 'ido', label: 'Operasi bersih hari ini' },
];

/**
 * B07 · Surveilans HAIs bulan berjalan: laju per jenis terhadap sasaran, kasus suspek dari data klinis yang
 * dikonfirmasi IPCN dengan kriteria (atau "Bukan HAI" beralasan), dan sensus harian hari alat sebagai penyebut.
 * Tersimpan di toko demo (domain `ppi`, ADR-0085).
 */
export function SurveillanceTab({
  state: ppi,
  rev,
  suspects,
}: {
  state: PpiStoreState;
  rev: number;
  suspects: readonly HaiSuspect[];
}) {
  const month = ppi.month;
  const [sel, setSel] = useState(suspects[0]?.id ?? '');
  const [checks, setChecks] = useState<Record<string, boolean[]>>({});
  const [rejecting, setRejecting] = useState(false);
  const [census, setCensus] = useState<Record<HaiType, string>>({ isk: '', vap: '', phlebitis: '', ido: '' });
  const { act, pending, flash } = useTokoAction('ppi', rev);
  const defOf = (t: HaiType) => HAI_DEFS.find((d) => d.id === t);

  const s = suspects.find((x) => x.id === sel);
  const st = s
    ? { checks: checks[s.id] ?? HAI_CRITERIA[s.type].map(() => false), decision: ppi.decisions[s.id] ?? null }
    : undefined;

  const confirm = () => {
    if (!s || !st) return;
    const def = defOf(s.type);
    const next = month[s.type].cases + 1;
    const rate = haiRate(next, month[s.type].denominator, def?.per ?? 1000);
    const over = def ? !haiOnTarget(rate, def.target) : false;
    const { jam, when } = demoStamp();
    act(
      { type: 'suspek.dikonfirmasi', id: s.id, checks: st.checks, when },
      `${def?.label ?? ''} RM ${s.rm} dikonfirmasi · ${jam}; laju bulan ini ${formatRate(rate, def?.unit ?? '')}${
        over ? ' (di atas sasaran: audit bundle unit dijadwalkan)' : ''
      }.`,
    );
  };
  const reject = (reason: string) => {
    if (!s) return;
    const { jam, when } = demoStamp();
    act(
      { type: 'suspek.ditolak', id: s.id, reason, when },
      `Suspek RM ${s.rm} diputus bukan HAI · ${jam}: ${reason}.`,
      () => setRejecting(false),
    );
  };

  const censusValues = CENSUS.map((c) => census[c.type].trim());
  const censusBlock = pending
    ? 'Menyimpan…'
    : ppi.census
      ? 'Sensus hari ini sudah tercatat.'
      : censusValues.some((v) => !/^\d{1,3}$/.test(v))
        ? 'Isi keempat angka (bilangan bulat ≥ 0).'
        : null;
  const recordCensus = () => {
    if (censusBlock) return;
    const { jam } = demoStamp();
    act(
      {
        type: 'sensus.dicatat',
        counts: {
          isk: Number(census.isk),
          vap: Number(census.vap),
          phlebitis: Number(census.phlebitis),
          ido: Number(census.ido),
        },
        jam,
      },
      `Sensus harian hari alat tercatat · ${jam}; penyebut laju bulan ini diperbarui.`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Panel
        title="Laju HAIs · Oktober 2026 (s.d. hari ini)"
        sub="Pembilang: kasus terkonfirmasi IPCN · penyebut: sensus harian"
        flush
      >
        <TableWrap label="Laju infeksi terkait pelayanan">
          <thead>
            <tr>
              <th className={TH}>Jenis</th>
              <th className={`${TH} text-right`}>Kasus</th>
              <th className={`${TH} text-right`}>Penyebut</th>
              <th className={`${TH} text-right`}>Laju</th>
              <th className={TH}>Sasaran</th>
            </tr>
          </thead>
          <tbody>
            {HAI_DEFS.map((d) => {
              const m = month[d.id];
              const rate = haiRate(m.cases, m.denominator, d.per);
              const ok = haiOnTarget(rate, d.target);
              return (
                <tr key={d.id}>
                  <td className={TD}>{d.label}</td>
                  <td className={`${TD} text-right font-mono`}>{m.cases}</td>
                  <td className={`${TD} text-right font-mono`}>
                    {m.denominator.toLocaleString('id-ID')}
                    <span className="block font-sans text-caption text-ink-500">{d.denominator}</span>
                  </td>
                  <td className={`${TD} text-right font-mono font-semibold`}>{formatRate(rate, d.unit)}</td>
                  <td className={TD}>
                    <Chip tone={ok ? 'success' : 'danger'}>
                      {ok ? 'Sesuai' : 'Di atas sasaran'} ≤ {formatRate(d.target, d.unit)}
                    </Chip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_300px] xl:max-w-[380px]">
          <Panel title="Kasus suspek" sub="Ditandai otomatis dari data klinis · hanya nomor RM" flush>
            {suspects.map((x) => {
              const d = ppi.decisions[x.id];
              return (
                <PickRow
                  key={x.id}
                  selected={x.id === sel}
                  onClick={() => {
                    setSel(x.id);
                    setRejecting(false);
                  }}
                  title={`${defOf(x.type)?.label ?? ''}`}
                  sub={`RM ${x.rm} · ${x.unit}`}
                  right={
                    d ? (
                      <Chip tone={d.kind === 'hai' ? 'danger' : 'success'}>
                        {d.kind === 'hai' ? 'HAI' : 'Bukan HAI'}
                      </Chip>
                    ) : (
                      <Chip tone="warning">Perlu verifikasi</Chip>
                    )
                  }
                />
              );
            })}
          </Panel>
        </div>
        <div className="min-w-0 flex-[999_1_440px]">
          {s && st ? (
            <Panel
              title={`Verifikasi suspek · RM ${s.rm}`}
              sub={`${s.unit} · ditandai ${formatTanggalWaktu(s.flaggedAt)}`}
            >
              <p className="m-0 text-small text-ink-700">{s.trigger}</p>
              {st.decision ? (
                <Alert
                  level={st.decision.kind === 'hai' ? 'warning' : 'success'}
                  title={
                    st.decision.kind === 'hai'
                      ? `Dikonfirmasi HAI · ${formatTanggalWaktu(st.decision.when)} · ${st.decision.by.name}`
                      : `Bukan HAI · ${formatTanggalWaktu(st.decision.when)} · ${st.decision.by.name}`
                  }
                >
                  {st.decision.kind === 'hai'
                    ? 'Masuk pembilang laju bulan ini; DPJP dan kepala ruang diberi tahu.'
                    : st.decision.reason}
                </Alert>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-small font-semibold text-ink-700">Kriteria surveilans</span>
                  {HAI_CRITERIA[s.type].map((c, i) => (
                    <CheckField
                      key={c}
                      label={c}
                      checked={st.checks[i] ?? false}
                      onChange={(v) =>
                        setChecks((cur) => ({ ...cur, [s.id]: st.checks.map((x, j) => (j === i ? v : x)) }))
                      }
                    />
                  ))}
                  <span className="flex flex-wrap items-start gap-2">
                    <ReasonButton
                      reason={pending ? 'Menyimpan…' : confirmBlock(s.type, st.checks)}
                      onClick={confirm}
                    >
                      Konfirmasi HAI
                    </ReasonButton>
                    {!rejecting && (
                      <Button variant="ghost" onClick={() => setRejecting(true)}>
                        Bukan HAI…
                      </Button>
                    )}
                  </span>
                  {rejecting && (
                    <ConfirmBox
                      title={`Putuskan RM ${s.rm} bukan HAI?`}
                      confirmLabel="Simpan keputusan"
                      minReason={MIN_PPI_REASON}
                      onCancel={() => setRejecting(false)}
                      onConfirm={reject}
                    >
                      Keputusan tercatat dan bisa ditinjau komite PPI.
                    </ConfirmBox>
                  )}
                </div>
              )}
            </Panel>
          ) : (
            <Panel title="Verifikasi suspek">
              <p className="m-0 text-small text-ink-500">Tidak ada kasus suspek.</p>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Sensus harian hari alat" sub="Diisi IPCLN tiap unit pukul 10.00 · penyebut laju HAIs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CENSUS.map((c) => (
            <TextField
              key={c.type}
              label={c.label}
              inputMode="numeric"
              value={census[c.type]}
              onChange={(v) => setCensus((cur) => ({ ...cur, [c.type]: v }))}
            />
          ))}
        </div>
        {ppi.census ? (
          <span className="text-small font-semibold text-success">
            Sensus hari ini tercatat · {ppi.census.jam} oleh {ppi.census.by}
          </span>
        ) : (
          <ReasonButton reason={censusBlock} onClick={recordCensus}>
            Catat sensus hari ini
          </ReasonButton>
        )}
      </Panel>
    </div>
  );
}
