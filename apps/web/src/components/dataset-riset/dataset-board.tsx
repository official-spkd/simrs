'use client';

import { formatJam, formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  type Flash,
  FlashLine,
  KeyValues,
  Panel,
  ReasonButton,
  SelectField,
  StageTrack,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { demoNow, shiftDate } from '@/lib/demo/fixtures/waktu';
import {
  ACCESS_DAYS,
  allowedRules,
  type CohortRow,
  type DatasetField,
  deidBlock,
  ethicsBlock,
  type FieldRule,
  K_MIN,
  kAnonymity,
  privacyApproveBlock,
  RULE_LABEL,
  STAGES,
} from '@/lib/dataset-riset';

const KIND_LABEL = {
  pengenal: 'Pengenal langsung',
  kuasi: 'Kuasi-pengenal',
  klinis: 'Variabel klinis',
} as const;

/**
 * I11 · Satu permintaan dataset riset dari pengajuan sampai ekstrak: etik → aturan de-identifikasi per kolom dengan
 * uji k-anonimitas langsung → persetujuan petugas privasi (≠ pemohon) → ekstrak bertautan berbatas waktu; setiap
 * langkah dan unduhan masuk jejak akses.
 */
export function DatasetBoard({
  request,
  fields,
  rows,
  approvers,
  log: initialLog,
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
  approvers: readonly string[];
  log: ReadonlyArray<{ at: string; who: string; action: string }>;
  today: string;
}) {
  const [stage, setStage] = useState(1);
  const [ethicsNo, setEthicsNo] = useState('');
  const [ethicsUntil, setEthicsUntil] = useState('');
  const [rules, setRules] = useState<Record<string, FieldRule | undefined>>({});
  const [approver, setApprover] = useState('');
  const [log, setLog] = useState([...initialLog]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const k = kAnonymity(rows, rules as Record<string, FieldRule>);
  const block = deidBlock(fields, rules, k);
  const record = (who: string, action: string) => {
    const at = demoNow().toISOString();
    setLog((cur) => [...cur, { at, who, action }]);
    setFlash({ ok: true, text: `${request.number}: ${action} · ${formatJam(at)}.` });
  };
  const kept = fields.filter((f) => rules[f.key] && rules[f.key] !== 'hapus');
  const expiry = shiftDate(today, ACCESS_DAYS);

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
                reason={ethicsBlock(ethicsNo, ethicsUntil, today)}
                onClick={() => {
                  setStage(2);
                  record(
                    'Petugas privasi',
                    `persetujuan etik ${ethicsNo.trim()} dicatat, berlaku s.d. ${formatTanggal(ethicsUntil)}`,
                  );
                }}
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
                  onClick={() => {
                    setStage(3);
                    record(
                      'Petugas privasi',
                      `de-identifikasi diterapkan (k = ${k}, ${kept.length} kolom dipertahankan)`,
                    );
                  }}
                >
                  Terapkan de-identifikasi
                </ReasonButton>
              </div>
            </Panel>
          )}
          {stage === 3 && (
            <Panel title="Persetujuan rilis" sub="Petugas privasi menilai risiko identifikasi ulang">
              <SelectField
                label="Penyetuju"
                value={approver}
                onChange={setApprover}
                placeholder="Pilih penyetuju…"
                options={approvers.map((a) => [a, a])}
                hint={`Pemohon: ${request.requester}.`}
              />
              <ReasonButton
                reason={privacyApproveBlock(request.requester, approver || null)}
                onClick={() => {
                  setStage(4);
                  record(approver, 'rilis dataset disetujui');
                }}
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
                  onClick={() => {
                    setStage(5);
                    record(
                      'Sistem',
                      `dataset diekstrak; tautan untuk ${request.requester} berlaku s.d. ${formatTanggal(expiry)}`,
                    );
                  }}
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
                <Button onClick={() => record(request.requester, 'mengunduh dataset (CSV bertanda air)')}>
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
