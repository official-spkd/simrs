'use client';

import { formatJam, formatTanggal, formatTanggalLahir, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx, Field } from '@simrs/ui';
import { useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  type PrintTemplate,
  type SamplePatient,
  templateChanged,
  templateIssues,
} from '@/lib/platform-pengaturan';
import { BarcodePreview, QrCode } from './codes';
import { type ConfirmRequest, ConfirmDialog, Panel, Stamp } from './parts';

function Preview({ t, p }: { t: PrintTemplate; p: SamplePatient }) {
  const allergy = p.alergi.length > 0 ? `ALERGI: ${p.alergi.join(', ')}` : 'Tidak ada alergi tercatat';
  const qr = t.showQr && (
    <QrCode value={`contoh-verifikasi/${t.id}-v${t.version}`} size={72} label="QR verifikasi (contoh)" />
  );
  const barcode = t.showBarcode && <BarcodePreview value={p.rm} width={140} height={28} />;
  const head = (
    <div className="flex flex-col border-b border-ink-900 pb-1.5">
      <span className="text-[13px] font-bold">{t.header || '(kop kosong)'}</span>
      {t.subheader && <span className="text-[10.5px] text-ink-700">{t.subheader}</span>}
    </div>
  );
  if (t.id === 'gelang' || t.id === 'label') {
    return (
      <div
        className={cx(
          'flex items-center gap-3 rounded-[6px] border border-ink-900 bg-white px-3 py-2 text-[11px]',
          t.id === 'gelang' ? 'w-full max-w-[460px]' : 'w-[280px]',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[10px] text-ink-700">{t.header}</span>
          <span className="text-[13px] font-bold">{p.nama}</span>
          <span className="font-mono">
            RM {p.rm} · {p.jk} · {formatTanggalLahir(p.tanggalLahir)}
          </span>
          {t.showAllergy && (
            <span
              className={cx(
                'self-start rounded px-1.5 font-semibold',
                p.alergi.length > 0 ? 'bg-danger text-white' : 'border border-ink-900',
              )}
            >
              {allergy}
            </span>
          )}
        </div>
        {barcode}
      </div>
    );
  }
  if (t.id === 'etiket') {
    return (
      <div className="flex w-[300px] flex-col gap-1 rounded-[6px] border border-ink-900 bg-white p-2.5 text-[11px]">
        {head}
        <span className="font-bold">{p.nama}</span>
        <span className="font-mono">RM {p.rm}</span>
        <span className="text-[12px] font-semibold">Metformin 500 mg · 3 × 1 tablet sesudah makan</span>
        {t.showAllergy && <span className="font-semibold">{allergy}</span>}
        <span className="flex items-end justify-between gap-2">
          <span className="text-[10px] text-ink-700">{t.footer}</span>
          {barcode}
        </span>
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-[420px] flex-col gap-2 rounded-[4px] border border-line-strong bg-white p-4 text-[11.5px] shadow-card">
      {head}
      <span className="text-center text-[13px] font-bold">
        {t.id === 'kuitansi' ? 'KUITANSI PEMBAYARAN' : 'RESUME MEDIS RAWAT JALAN'}
      </span>
      <span>
        {p.nama} · RM <span className="font-mono">{p.rm}</span> · {p.penjamin}
      </span>
      {t.id === 'kuitansi' ? (
        <span>
          Telah diterima pembayaran <b>Rp 185.000</b> untuk layanan rawat jalan ·{' '}
          {formatTanggal(demoPrintDate)}
        </span>
      ) : (
        <span className="text-ink-700">Diagnosis utama, terapi, dan rencana kontrol tercetak di sini.</span>
      )}
      <span className="flex items-end justify-between gap-3 pt-2">
        <span className="text-[10px] text-ink-700">{t.footer}</span>
        {qr}
      </span>
    </div>
  );
}

const demoPrintDate = '2026-10-05T10:45:00+07:00';

/**
 * P12 · Template cetak per RS berversi: pilih template → ubah isi → pratinjau langsung dengan pasien contoh fiktif →
 * terbitkan versi baru (gerbang: alergi + barcode di gelang, QR verifikasi di dokumen ber-TTE). Versi lama tetap
 * tersimpan untuk cetak ulang dokumen lama.
 */
export function PengaturanCetak({ initial, sample }: { initial: PrintTemplate[]; sample: SamplePatient }) {
  const [templates, setTemplates] = useState(initial);
  const [selected, setSelected] = useState<PrintTemplate['id']>('gelang');
  const [drafts, setDrafts] = useState<Record<string, PrintTemplate>>({});
  const [history, setHistory] = useState<Record<string, Array<{ v: number; at: string; note: string }>>>({});
  const [confirming, setConfirming] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const current = templates.find((t) => t.id === selected) ?? templates[0];
  if (!current) return null;
  const draft = drafts[current.id] ?? current;
  const issues = templateIssues(draft);
  const dirty = templateChanged(current, draft);
  const reason =
    issues.length > 0 ? 'Perbaiki syarat template di atas dulu.' : !dirty ? 'Belum ada perubahan.' : null;
  const edit = (patch: Partial<PrintTemplate>) => {
    setFlash(null);
    setDrafts((cur) => ({ ...cur, [current.id]: { ...draft, ...patch } }));
  };

  const request: ConfirmRequest | null = confirming
    ? {
        title: `Terbitkan ${current.name} versi ${current.version + 1}?`,
        body: (
          <>
            Cetakan baru memakai versi {current.version + 1}. Dokumen yang sudah dicetak tetap memakai versi{' '}
            {current.version} saat dicetak ulang.
          </>
        ),
        confirmLabel: `Terbitkan versi ${current.version + 1}`,
        reasonLabel: 'Catatan perubahan',
        reasonPlaceholder: 'mis. tambah nomor telepon IGD di kop',
      }
    : null;

  return (
    <div className="flex flex-wrap items-start gap-4">
      <nav aria-label="Daftar template" className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={t.id === selected ? 'true' : undefined}
            onClick={() => {
              setSelected(t.id);
              setFlash(null);
            }}
            className={cx(
              'flex min-h-11 cursor-pointer flex-col items-start gap-0.5 rounded-control border px-3 py-2 text-left font-[inherit]',
              t.id === selected ? 'border-brand-600 bg-brand-50' : 'border-line bg-white',
            )}
          >
            <span className="text-small font-semibold">{t.name}</span>
            <span className="text-caption text-ink-500">
              {t.size} · versi {t.version}
              {drafts[t.id] && templateChanged(t, drafts[t.id] as PrintTemplate) ? ' · ada draf' : ''}
            </span>
          </button>
        ))}
      </nav>

      <Panel
        className="flex-[2_1_320px]"
        title={`Ubah ${current.name}`}
        sub={`Versi ${current.version} aktif sejak ${formatTanggalWaktu(current.publishedAt)} · ${current.publishedBy}`}
      >
        <Field
          label="Baris kop (nama RS)"
          value={draft.header}
          onChange={(e) => edit({ header: e.target.value })}
        />
        <Field
          label="Baris kedua"
          value={draft.subheader}
          onChange={(e) => edit({ subheader: e.target.value })}
        />
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-small font-semibold text-ink-700">Unsur wajib/opsional</legend>
          {(
            [
              ['showQr', 'QR verifikasi dokumen'],
              ['showBarcode', 'Barcode nomor RM'],
              ['showAllergy', 'Penanda alergi'],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
              <input
                type="checkbox"
                className="size-5 accent-brand-600"
                checked={draft[key]}
                onChange={(e) => edit({ [key]: e.target.checked })}
              />
              {text}
            </label>
          ))}
        </fieldset>
        <Field label="Catatan kaki" value={draft.footer} onChange={(e) => edit({ footer: e.target.value })} />
        {issues.length > 0 && (
          <Alert level="warning" title="Belum bisa diterbitkan">
            <ul className="m-0 pl-4">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Alert>
        )}
        <span className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!!reason}
            aria-describedby={reason ? 'cetak-alasan' : undefined}
            onClick={() => setConfirming(true)}
          >
            Terbitkan versi {current.version + 1}
          </Button>
          <Button disabled={!dirty} onClick={() => setDrafts((cur) => ({ ...cur, [current.id]: current }))}>
            Batalkan draf
          </Button>
          {reason && (
            <span id="cetak-alasan" className="text-caption text-ink-500">
              {reason}
            </span>
          )}
        </span>
        {flash && (
          <span role="status">
            <Stamp>{flash}</Stamp>
          </span>
        )}
        {(history[current.id] ?? []).length > 0 && (
          <ul aria-label="Riwayat versi" className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {(history[current.id] ?? []).map((h) => (
              <li key={h.v}>
                <Chip tone="brand">v{h.v}</Chip> {h.at} · {h.note}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        className="flex-[2_1_320px]"
        title="Pratinjau"
        sub={`${current.size} · pasien contoh fiktif${dirty ? ' · draf belum terbit' : ''}`}
      >
        <div
          role="img"
          aria-label={`Pratinjau ${current.name}${dirty ? ' (draf)' : ''}`}
          className="flex min-h-[180px] items-center justify-center rounded-control bg-[repeating-linear-gradient(45deg,#F5F7F9,#F5F7F9_10px,#EEF1F4_10px,#EEF1F4_20px)] p-4"
        >
          <Preview t={draft} p={sample} />
        </div>
      </Panel>

      <ConfirmDialog
        request={request}
        onClose={() => setConfirming(false)}
        onConfirm={(note) => {
          const now = demoNow();
          const v = current.version + 1;
          setTemplates((cur) =>
            cur.map((t) =>
              t.id === current.id
                ? { ...draft, version: v, publishedAt: now.toISOString(), publishedBy: 'Anda (sesi ini)' }
                : t,
            ),
          );
          setDrafts((cur) => {
            const next = { ...cur };
            delete next[current.id];
            return next;
          });
          setHistory((cur) => ({
            ...cur,
            [current.id]: [{ v, at: formatJam(now), note }, ...(cur[current.id] ?? [])],
          }));
          setFlash(`Versi ${v} terbit · ${formatJam(now)} · cetakan berikutnya memakai versi ini`);
        }}
      />
    </div>
  );
}
