'use client';

import { formatJam, formatRupiah, formatTanggal } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, FilterChip } from '@simrs/ui';
import { useState } from 'react';
import {
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
import { type Asset } from '@/lib/demo/fixtures/aset';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { bookValue, calibrationStatus, type CalibrationStatus, nextCalibration } from '@/lib/aset';

const TONE: Record<CalibrationStatus, ChipTone> = {
  laik: 'success',
  segera: 'warning',
  lewat: 'danger',
  'tidak-perlu': 'neutral',
};

function calText(status: CalibrationStatus, days: number | null): string {
  if (status === 'tidak-perlu') return 'Tidak wajib kalibrasi';
  if (status === 'lewat') return `Lewat ${-(days ?? 0)} hari · tidak laik pakai`;
  if (status === 'segera') return `Jatuh tempo ${days} hari lagi`;
  return 'Laik pakai';
}

interface AssetState extends Asset {
  withdrawn: boolean;
}

/**
 * B02 · Register aset + kalibrasi: nilai buku garis lurus, status kalibrasi (lewat = tidak laik pakai), pencatatan
 * hasil kalibrasi (laik → jatuh tempo +12 bulan; tidak laik → alat ditarik dan tiket perbaikan dibuat otomatis).
 */
export function AssetTab({
  assets,
  labs,
  today,
  onWithdraw,
}: {
  assets: readonly Asset[];
  labs: readonly string[];
  today: string;
  onWithdraw: (asset: Asset, reason: string) => string;
}) {
  const [list, setList] = useState<AssetState[]>(() => assets.map((a) => ({ ...a, withdrawn: false })));
  const [filter, setFilter] = useState<'tindakan' | 'semua'>('tindakan');
  const [sel, setSel] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [cert, setCert] = useState('');
  const [lab, setLab] = useState(labs[0] ?? '');
  const [flash, setFlash] = useState<Flash | null>(null);

  const statusOf = (a: AssetState) => calibrationStatus(a.nextCalibration, today);
  const needs = (a: AssetState) => a.withdrawn || ['lewat', 'segera'].includes(statusOf(a).status);
  const visible = list.filter((a) => filter === 'semua' || needs(a));
  const asset = list.find((a) => a.id === sel);
  const block = !result
    ? 'Pilih hasil kalibrasi.'
    : cert.trim().length < 5
      ? 'Isi nomor sertifikat kalibrasi.'
      : null;
  const overdueCritical = list.filter((a) => !a.withdrawn && statusOf(a).status === 'lewat');

  const save = () => {
    if (!asset || block) return;
    const at = formatJam(demoNow());
    if (result === 'laik') {
      const next = nextCalibration(today);
      setList((cur) =>
        cur.map((a) =>
          a.id === asset.id ? { ...a, lastCalibration: today, nextCalibration: next, withdrawn: false } : a,
        ),
      );
      setFlash({
        ok: true,
        text: `${asset.name} (${asset.code}) laik pakai · sertifikat ${cert.trim()} · ${at}; kalibrasi berikutnya ${formatTanggal(next)}.`,
      });
    } else {
      const ticket = onWithdraw(asset, `Hasil kalibrasi tidak laik (sertifikat ${cert.trim()})`);
      setList((cur) =>
        cur.map((a) => (a.id === asset.id ? { ...a, lastCalibration: today, withdrawn: true } : a)),
      );
      setFlash({
        ok: false,
        text: `${asset.name} tidak laik · ${at}: label merah dipasang, alat ditarik dari layanan, tiket ${ticket} dibuat.`,
      });
    }
    setSel(null);
    setResult('');
    setCert('');
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      {overdueCritical.length > 0 && (
        <Alert level="critical" title="Alat lewat jatuh tempo kalibrasi">
          {overdueCritical.map((a) => `${a.name} (${a.location})`).join(', ')}: tidak laik pakai sampai
          dikalibrasi ulang; unit diminta memakai alat cadangan.
        </Alert>
      )}
      <Panel
        title="Register aset"
        sub={`${list.length} aset · nilai buku garis lurus per ${formatTanggal(today)}`}
        flush
        actions={
          <span role="group" aria-label="Saring aset" className="flex gap-2">
            <FilterChip selected={filter === 'tindakan'} onClick={() => setFilter('tindakan')}>
              Perlu tindakan
            </FilterChip>
            <FilterChip selected={filter === 'semua'} onClick={() => setFilter('semua')}>
              Semua
            </FilterChip>
          </span>
        }
      >
        <TableWrap label="Daftar aset" minWidth={720}>
          <thead>
            <tr>
              <th className={TH}>Aset</th>
              <th className={TH}>Lokasi</th>
              <th className={`${TH} text-right`}>Nilai buku</th>
              <th className={TH}>Kalibrasi</th>
              <th className={TH}>
                <span className="sr-only">Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const st = statusOf(a);
              return (
                <tr key={a.id}>
                  <td className={TD}>
                    <span className="block font-semibold">{a.name}</span>
                    <span className="block font-mono text-caption text-ink-500">{a.code}</span>
                  </td>
                  <td className={TD}>{a.location}</td>
                  <td className={`${TD} text-right font-mono whitespace-nowrap`}>
                    {formatRupiah(bookValue(BigInt(a.cost), a.acquired, a.lifeYears, today))}
                  </td>
                  <td className={TD}>
                    {a.withdrawn ? (
                      <Chip tone="danger">Ditarik · tidak laik</Chip>
                    ) : (
                      <Chip tone={TONE[st.status]}>{calText(st.status, st.days)}</Chip>
                    )}
                    {a.nextCalibration && (
                      <span className="mt-1 block text-caption text-ink-500">
                        jatuh tempo {formatTanggal(a.nextCalibration)}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    {a.nextCalibration && (
                      <Button size="sm" onClick={() => setSel(a.id)} aria-pressed={sel === a.id}>
                        Catat kalibrasi<span className="sr-only"> {a.name}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        {visible.length === 0 && (
          <p className="m-0 px-4 py-5 text-center text-small text-ink-500">
            Tidak ada aset yang perlu tindakan.
          </p>
        )}
      </Panel>
      {asset && (
        <Panel title={`Hasil kalibrasi · ${asset.name}`} sub={`${asset.code} · ${asset.location}`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SelectField
              label="Hasil"
              value={result}
              onChange={setResult}
              placeholder="Pilih hasil…"
              options={[
                ['laik', 'Laik pakai'],
                ['tidak', 'Tidak laik pakai'],
              ]}
            />
            <TextField label="Nomor sertifikat" value={cert} onChange={setCert} />
            <SelectField
              label="Lembaga penguji"
              value={lab}
              onChange={setLab}
              options={labs.map((l) => [l, l])}
            />
          </div>
          <span className="flex flex-wrap gap-2">
            <ReasonButton reason={block} onClick={save}>
              Simpan hasil kalibrasi
            </ReasonButton>
            <Button variant="ghost" onClick={() => setSel(null)}>
              Batal
            </Button>
          </span>
        </Panel>
      )}
    </div>
  );
}
