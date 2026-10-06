'use client';

import {
  formatJam,
  formatTanggalWaktu,
  REF_CODE_SYSTEM_IDS,
  REF_CODE_SYSTEMS,
  type RefCodeSystem,
} from '@simrs/shared';
import { Alert, Button, Chip, cx, Field, RadioSegmented, Tabs } from '@simrs/ui';
import { useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import type { TerminologyStoreState } from '@/lib/platform-terminologi-toko';
import type { DemoImportFile } from '@/lib/demo/fixtures/terminologi';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  dryRunImport,
  type ImportReport,
  MATCH_LABEL,
  parseCsv,
  type RefConcept,
  type RefVersion,
  searchConcepts,
} from '@/lib/platform-terminologi';
import { type ConfirmRequest, ConfirmDialog, FlowSteps, Panel, Stamp, TableWrap, TD, TH } from './parts';
import { KpiTile } from '../manajemen/kpi-tile';

const SYSTEM_ITEMS = REF_CODE_SYSTEM_IDS.map((s) => ({ id: s, label: REF_CODE_SYSTEMS[s].label }));
const SYSTEM_SHORT: Record<RefCodeSystem, string> = {
  icd10: 'ICD-10',
  icd9cm: 'ICD-9-CM',
  loinc: 'LOINC',
  kfa: 'KFA',
};

function SearchTab({ concepts }: { concepts: RefConcept[] }) {
  const [system, setSystem] = useState<RefCodeSystem>('icd10');
  const [q, setQ] = useState('pnemonia');
  const [inactive, setInactive] = useState(false);
  const hits = searchConcepts(concepts, { system, q, includeInactive: inactive });
  return (
    <div className="flex flex-col gap-3">
      <RadioSegmented
        label="Sistem kode"
        items={SYSTEM_ITEMS}
        value={system}
        onChange={(v) => setSystem(v as RefCodeSystem)}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Kode atau kata kunci"
          className="flex-[1_1_280px]"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          hint={`Tahan salah ketik. Format kode: ${REF_CODE_SYSTEMS[system].hint}`}
          hintTone="muted"
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
          <input
            type="checkbox"
            className="size-5 accent-brand-600"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
          Termasuk kode nonaktif
        </label>
      </div>
      <p className="m-0 text-small text-ink-500" aria-live="polite">
        {q.trim() === ''
          ? 'Ketik kode atau kata kunci.'
          : `${hits.length} hasil untuk “${q.trim()}” di ${SYSTEM_SHORT[system]}`}
      </p>
      {q.trim() !== '' && hits.length === 0 ? (
        <p className="m-0 rounded-control border border-dashed border-line-strong p-3 text-small text-ink-500">
          Tidak ada kode yang cocok. Periksa sistem kode yang dipilih, atau cari dengan awalan kode (mis.
          J18).
        </p>
      ) : (
        <ul aria-label="Hasil pencarian kode" className="m-0 flex list-none flex-col p-0">
          {hits.map((h) => (
            <li
              key={h.concept.code}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2 last:border-0"
            >
              <span className="w-24 font-mono font-semibold text-brand-700">{h.concept.code}</span>
              <span className="min-w-0 flex-[1_1_220px]">{h.concept.display}</span>
              <Chip tone={h.match === 'mirip' ? 'warning' : 'brand'}>
                {MATCH_LABEL[h.match]}
                {h.match === 'mirip' ? ` ${Math.round(h.score * 100)}%` : ''}
              </Chip>
              {!h.concept.active && <Chip tone="neutral">Nonaktif</Chip>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STEPS = [
  { label: 'Pilih berkas', note: 'CSV code, display, active' },
  { label: 'Uji kering', note: 'validasi tanpa menulis' },
  { label: 'Ringkasan', note: 'tambah, ubah, nonaktif' },
  { label: 'Terapkan', note: 'versi baru tercatat' },
];

function ReportView({ report, replace }: { report: ImportReport; replace: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div role="region" aria-label="Ringkasan uji kering" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiTile index={2} label="Baris dibaca" value={String(report.rows)} />
        <KpiTile
          index={3}
          label="Kode baru"
          value={String(report.inserted)}
          tone="success"
          hint="akan ditambahkan"
        />
        <KpiTile index={4} label="Label berubah" value={String(report.updated)} hint="akan diperbarui" />
        <KpiTile index={5} label="Tetap" value={String(report.unchanged)} />
        <KpiTile
          index={0}
          label="Dinonaktifkan"
          value={String(report.deactivated)}
          tone={report.deactivated > 0 ? 'warning' : 'neutral'}
          hint={replace ? 'tidak ada di berkas' : 'opsi pengganti mati'}
        />
      </div>
      {report.errors.length > 0 && (
        <Alert level="critical" title={`${report.errors.length} baris galat · tidak ada yang ditulis`}>
          <ul aria-label="Galat impor" className="m-0 flex list-none flex-col gap-0.5 p-0">
            {report.errors.map((e) => (
              <li key={`${e.line}-${e.message}`}>
                Baris <span className="font-mono">{e.line}</span>: {e.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

function ImportTab({
  concepts,
  files,
  rev,
}: {
  concepts: readonly RefConcept[];
  files: DemoImportFile[];
  rev: number;
}) {
  const { dispatch, pending, error } = useDemoDispatch('terminologi', rev);
  const [fileId, setFileId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<DemoImportFile | null>(null);
  const [replace, setReplace] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const file = uploaded && fileId === uploaded.id ? uploaded : files.find((f) => f.id === fileId);
  const step = applied ? 4 : report ? (report.errors.length > 0 ? 1 : 2) : file ? 1 : 0;
  const pick = (id: string) => {
    setFileId(id);
    setReport(null);
    setApplied(null);
  };
  const dryRun = () => {
    if (!file) return;
    setReport(dryRunImport(concepts, file.system, parseCsv(file.text), replace));
    setCheckedAt(formatJam(demoNow()));
    setApplied(null);
  };
  const applyReason = !report
    ? 'Jalankan uji kering dulu.'
    : report.errors.length > 0
      ? 'Perbaiki baris galat lalu uji ulang (gagal tertutup).'
      : null;

  const request: ConfirmRequest | null =
    confirming && report && file
      ? {
          title: `Terapkan ${file.name}?`,
          body: (
            <>
              {SYSTEM_SHORT[file.system]} versi {file.version}: {report.inserted} kode baru, {report.updated}{' '}
              label berubah{replace ? `, ${report.deactivated} kode dinonaktifkan` : ''}. Kode lama tidak
              dihapus; entri klinis lama tetap terbaca.
            </>
          ),
          confirmLabel: 'Ya, terapkan',
        }
      : null;

  return (
    <div className="flex flex-col gap-3">
      <FlowSteps label="Tahap impor" steps={STEPS} current={step} />
      <Panel title="1. Pilih berkas" sub="Hanya dataset resmi; tidak ada kode yang diketik manual">
        <ul aria-label="Berkas contoh" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {files.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                aria-pressed={fileId === f.id}
                onClick={() => pick(f.id)}
                className={cx(
                  'flex min-h-11 cursor-pointer flex-col items-start rounded-control border px-3 py-1.5 text-left font-[inherit]',
                  fileId === f.id ? 'border-brand-600 bg-brand-50' : 'border-line-strong bg-white',
                )}
              >
                <span className="font-mono text-small">{f.name}</span>
                <span className="text-caption text-ink-500">
                  {SYSTEM_SHORT[f.system]} · versi {f.version} · {f.text.split('\n').length - 1} baris
                </span>
              </button>
            </li>
          ))}
        </ul>
        <label className="flex flex-col gap-1.5 text-small">
          <span className="font-semibold text-ink-700">
            Atau unggah CSV LOINC sendiri (uji kering di browser; isi dikirim hanya saat diterapkan)
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="min-h-11 text-small"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const text = await f.text();
              const up: DemoImportFile = {
                id: 'unggah',
                name: f.name,
                system: 'loinc',
                version: 'unggahan',
                text,
              };
              setUploaded(up);
              pick(up.id);
            }}
          />
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
          <input
            type="checkbox"
            className="size-5 accent-brand-600"
            checked={replace}
            onChange={(e) => {
              setReplace(e.target.checked);
              setReport(null);
            }}
          />
          Versi pengganti: nonaktifkan kode yang tidak ada di berkas
        </label>
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!file} onClick={dryRun}>
            Jalankan uji kering
          </Button>
          {!file && <span className="text-caption text-ink-500">Pilih berkas dulu.</span>}
          {report && checkedAt && (
            <span role="status">
              <Stamp tone={report.errors.length > 0 ? 'danger' : 'success'}>
                Uji kering · {checkedAt} ·{' '}
                {report.errors.length > 0 ? `${report.errors.length} galat` : 'lolos'}
              </Stamp>
            </span>
          )}
        </span>
      </Panel>
      {report && (
        <Panel
          title="2. Ringkasan uji kering"
          sub={file ? `${file.name} · ${SYSTEM_SHORT[report.system]}` : undefined}
        >
          <ReportView report={report} replace={replace} />
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!!applyReason || !!applied || pending}
              aria-describedby={applyReason ? 'impor-alasan' : undefined}
              onClick={() => setConfirming(true)}
            >
              Terapkan impor
            </Button>
            {applyReason && (
              <span id="impor-alasan" className="text-caption font-medium text-warning">
                {applyReason}
              </span>
            )}
            {(applied || error) && (
              <span role="status">
                <Stamp>{error ?? applied}</Stamp>
              </span>
            )}
          </span>
        </Panel>
      )}
      <ConfirmDialog
        request={request}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          if (!report || !file) return;
          const now = demoNow();
          const text = `Diterapkan · ${formatJam(now)} · ${SYSTEM_SHORT[report.system]} versi ${file.version}`;
          dispatch(
            {
              type: 'impor.diterapkan',
              fileId: file.id,
              ...(file.id === 'unggah'
                ? { upload: { name: file.name, system: file.system, text: file.text.slice(0, 12_000) } }
                : {}),
              replace,
              at: now.toISOString(),
            },
            (ok) => ok && setApplied(text),
          );
        }}
      />
    </div>
  );
}

/**
 * P06 · Cari kode baku (tahan salah ketik), impor CSV bergerbang uji kering, dan riwayat versi per sistem kode. Impor
 * yang diterapkan tersimpan di toko demo bersama (domain `terminologi`) atas nama pengguna sesi.
 */
export function TerminologiBoard({
  state,
  rev,
  files,
}: {
  state: TerminologyStoreState;
  rev: number;
  files: DemoImportFile[];
}) {
  const [tab, setTab] = useState('cari');
  const concepts = state.concepts;
  const history: readonly RefVersion[] = state.versions;
  const counts = REF_CODE_SYSTEM_IDS.map((s) => ({
    s,
    active: concepts.filter((c) => c.system === s && c.active).length,
    latest: history.find((v) => v.system === s),
  }));
  return (
    <div className="flex flex-col gap-4">
      <div
        role="region"
        aria-label="Ringkasan data rujukan"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        {counts.map((c) => (
          <KpiTile
            index={1}
            key={c.s}
            label={REF_CODE_SYSTEMS[c.s].label}
            value={`${c.active} kode`}
            detail={c.latest ? `versi ${c.latest.version}` : 'belum ada versi'}
          />
        ))}
      </div>
      <Tabs
        label="Data rujukan"
        value={tab}
        onChange={setTab}
        keepMounted
        items={[
          { id: 'cari', label: 'Cari kode', content: <SearchTab concepts={[...concepts]} /> },
          {
            id: 'impor',
            label: 'Impor CSV',
            content: <ImportTab concepts={concepts} files={files} rev={rev} />,
          },
          {
            id: 'riwayat',
            label: 'Riwayat versi',
            content: (
              <TableWrap label="Riwayat versi data rujukan">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr>
                      {['Sistem', 'Versi', 'Sumber', 'Diterapkan', 'Tambah', 'Ubah', 'Nonaktif'].map((h) => (
                        <th key={h} scope="col" className={TH}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((v) => (
                      <tr key={`${v.system}-${v.version}-${v.appliedAt}`}>
                        <td className={TD}>{SYSTEM_SHORT[v.system]}</td>
                        <td className={cx(TD, 'font-mono')}>{v.version}</td>
                        <td className={TD}>{v.source}</td>
                        <td className={TD}>
                          {formatTanggalWaktu(v.appliedAt)}
                          <span className="block text-caption text-ink-500">{v.appliedBy}</span>
                        </td>
                        <td className={cx(TD, 'font-mono')}>{v.inserted}</td>
                        <td className={cx(TD, 'font-mono')}>{v.updated}</td>
                        <td className={cx(TD, 'font-mono')}>{v.deactivated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ),
          },
        ]}
      />
    </div>
  );
}
