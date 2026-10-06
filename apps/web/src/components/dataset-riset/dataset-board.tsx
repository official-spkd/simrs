'use client';

import { formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  FlashLine,
  KeyValues,
  Panel,
  ReasonButton,
  StageTrack,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import {
  allowedRules,
  type CohortRow,
  type DatasetField,
  deidBlock,
  ethicsBlock,
  type FieldRule,
  K_MIN,
  kAnonymity,
  RULE_LABEL,
  STAGES,
} from '@/lib/dataset-riset';
import { DATASET_APPROVER_ROLES, type DatasetStoreState, datasetExpiry } from '@/lib/dataset-riset-toko';

const KIND_LABEL = {
  pengenal: 'Pengenal langsung',
  kuasi: 'Kuasi-pengenal',
  klinis: 'Variabel klinis',
} as const;

/**
 * I11 · Satu permintaan dataset riset dari pengajuan sampai ekstrak: etik → aturan de-identifikasi per kolom dengan
 * uji k-anonimitas langsung → persetujuan petugas privasi (pengguna sesi ≠ pemohon dan ≠ penyusun
 * de-identifikasi) → ekstrak bertautan berbatas waktu; setiap langkah dan unduhan masuk jejak akses. Tersimpan di
 * toko demo (domain `dataset-riset`, ADR-0085).
 */
export function DatasetBoard({
  request,
  fields,
  rows,
  state,
  rev,
  viewer,
  today,
}: {
  request: {
    number: string;
    title: string;
    requester: string;
    institution: string;
    submittedAt: string;
    purpose: string;
    period: string;
  };
  fields: readonly DatasetField[];
  rows: readonly CohortRow[];
  state: DatasetStoreState;
  rev: number;
  viewer: { userId: string; name: string; role: string | null };
  today: string;
}) {
  const stage = state.stage;
  const log = state.log;
  const [ethicsNo, setEthicsNo] = useState('');
  const [ethicsUntil, setEthicsUntil] = useState('');
  const [draftRules, setRules] = useState<Record<string, FieldRule | undefined>>({});
  const rules: Record<string, FieldRule | undefined> = stage > 2 ? state.rules : draftRules;
  const { act, pending, flash } = useTokoAction('dataset-riset', rev);
  const k = kAnonymity(rows, rules as Record<string, FieldRule>);
  const block = pending ? 'Menyimpan…' : deidBlock(fields, rules, k);
  const done = (action: string) => `${request.number}: ${action} · ${demoStamp().jam}.`;
  const kept = fields.filter((f) => rules[f.key] && rules[f.key] !== 'hapus');
  const expiry = datasetExpiry();
  const approveBlock = pending
    ? 'Menyimpan…'
    : !viewer.role || !(DATASET_APPROVER_ROLES as readonly string[]).includes(viewer.role)
      ? 'Rilis dataset disetujui posisi Petugas privasi.'
      : viewer.name === request.requester
        ? 'Penyetuju harus berbeda dari pemohon dataset.'
        : state.deidBy?.userId === viewer.userId
          ? 'Anda menyusun de-identifikasi: penyetuju harus pengguna lain (pemisahan tugas).'
          : null;

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Panel
        title={`${request.number} · ${request.title}`}
        sub={`Diajukan ${formatTanggalWaktu(request.submittedAt)} oleh ${request.requester}`}
      >
        <StageTrack
          label={`Tahap ${request.number}`}
          stages={STAGES.map((label) => ({ label }))}
          current={stage >= 5 ? STAGES.length : stage}
        />
        <KeyValues
          rows={[
            ['Institusi', request.institution],
            ['Tujuan', request.purpose],
            ['Periode data', request.period],
            ['Kohort', `${rows.length} pasien memenuhi kriteria`],
          ]}
        />
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_520px]">
          {stage === 1 && (
            <Panel
              title="Persetujuan komite etik"
              sub="Dataset tidak diproses tanpa persetujuan etik yang berlaku"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField
                  label="Nomor persetujuan etik"
                  value={ethicsNo}
                  onChange={setEthicsNo}
                  placeholder="KEPK/…/2026"
                />
                <TextField
                  label="Berlaku sampai"
                  value={ethicsUntil}
                  onChange={setEthicsUntil}
                  placeholder="2027-09-30"
                />
              </div>
              <ReasonButton
                reason={pending ? 'Menyimpan…' : ethicsBlock(ethicsNo, ethicsUntil, today)}
                onClick={() =>
                  act(
                    { type: 'etik.dicatat', number: ethicsNo.trim(), until: ethicsUntil, when: demoStamp().when },
                    done(`persetujuan etik ${ethicsNo.trim()} dicatat, berlaku s.d. ${formatTanggal(ethicsUntil)}`),
                  )
                }
              >
                Catat persetujuan etik
              </ReasonButton>
            </Panel>
          )}
          {stage === 2 && (
            <Panel
              title="Aturan de-identifikasi per kolom"
              sub={`Uji k-anonimitas pada kuasi-pengenal · minimal k = ${K_MIN}`}
              actions={<Chip tone={k >= K_MIN ? 'success' : 'danger'}>k = {k}</Chip>}
              flush
            >
              <TableWrap label="Aturan per kolom" minWidth={560}>
                <thead>
                  <tr>
                    <th className={TH}>Kolom</th>
                    <th className={TH}>Jenis</th>
                    <th className={TH}>Aturan</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key}>
                      <td className={TD}>{f.label}</td>
                      <td className={TD}>
                        <Chip
                          tone={f.kind === 'pengenal' ? 'danger' : f.kind === 'kuasi' ? 'warning' : 'neutral'}
                        >
                          {KIND_LABEL[f.kind]}
                        </Chip>
                      </td>
                      <td className={TD}>
                        <select
                          aria-label={`Aturan ${f.label}`}
                          value={rules[f.key] ?? ''}
                          disabled={stage > 2}
                          onChange={(e) =>
                            setRules((cur) => ({
                              ...cur,
                              [f.key]: (e.target.value || undefined) as FieldRule | undefined,
                            }))
                          }
                          className="h-11 w-full rounded-control border border-line-strong bg-white px-3 font-[inherit]"
                        >
                          <option value="">Pilih aturan…</option>
                          {allowedRules(f.kind).map((r) => (
                            <option key={r} value={r}>
                              {f.key === 'age' && r === 'generalisasi'
                                ? 'Generalisasi (kelompok 10 tahun)'
                                : f.key === 'district' && r === 'generalisasi'
                                  ? 'Generalisasi (kota)'
                                  : RULE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <div className="p-4">
                <ReasonButton
                  reason={block}
                  onClick={() =>
                    act(
                      {
                        type: 'deid.diterapkan',
                        rules: Object.fromEntries(
                          Object.entries(rules).filter((e): e is [string, FieldRule] => !!e[1]),
                        ),
                        when: demoStamp().when,
                      },
                      done(`de-identifikasi diterapkan (k = ${k}, ${kept.length} kolom dipertahankan)`),
                    )
                  }
                >
                  Terapkan de-identifikasi
                </ReasonButton>
              </div>
            </Panel>
          )}
          {stage === 3 && (
            <Panel title="Persetujuan rilis" sub="Petugas privasi menilai risiko identifikasi ulang">
              <span className="text-small text-ink-700">
                Pemohon: {request.requester}. De-identifikasi disusun {state.deidBy?.name ?? '—'} (k ={' '}
                {state.k ?? k}). Penyetuju = pengguna yang masuk (posisi Petugas privasi), wajib orang lain.
              </span>
              <ReasonButton
                reason={approveBlock}
                onClick={() =>
                  act({ type: 'rilis.disetujui', when: demoStamp().when }, done(`rilis dataset disetujui ${viewer.name}`))
                }
              >
                Setujui rilis
              </ReasonButton>
            </Panel>
          )}
          {stage === 4 && (
            <Panel title="Ekstrak dataset" sub="Dari replika analitik, bukan basis data layanan">
              <span className="text-small text-ink-700">
                {rows.length} baris · kolom: {kept.map((f) => f.label).join(', ')}
              </span>
              <span>
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    act(
                      { type: 'dataset.diekstrak', when: demoStamp().when },
                      done(`dataset diekstrak; tautan untuk ${request.requester} berlaku s.d. ${formatTanggal(expiry)}`),
                    )
                  }
                >
                  Ekstrak dan kirim tautan
                </Button>
              </span>
            </Panel>
          )}
          {stage >= 5 && (
            <Panel title="Dataset siap" tone="success">
              <Alert level="success" title={`Tautan berlaku s.d. ${formatTanggal(expiry)}`}>
                {rows.length} baris ter-de-identifikasi untuk {request.requester}. Setiap unduhan tercatat dan
                diberi tanda air nomor permintaan.
              </Alert>
              <span>
                <Button
                  disabled={pending}
                  onClick={() =>
                    act(
                      { type: 'dataset.diunduh', when: demoStamp().when },
                      done('unduhan peneliti tercatat di jejak akses'),
                    )
                  }
                >
                  Simulasikan unduhan peneliti
                </Button>
              </span>
            </Panel>
          )}
        </div>
        <div className="min-w-0 flex-[1_1_320px] xl:max-w-[420px]">
          <Panel title="Jejak akses" sub="Tidak bisa diubah · ditinjau petugas privasi">
            <ol
              aria-label="Jejak akses dataset"
              className="m-0 flex list-none flex-col gap-1.5 p-0 text-small"
            >
              {log.map((l) => (
                <li key={`${l.at}-${l.action}`} className="border-l-2 border-brand-600 pl-2.5">
                  <span className="block">{l.action}</span>
                  <span className="block text-caption text-ink-500">
                    {l.who} · {formatTanggalWaktu(l.at)}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
