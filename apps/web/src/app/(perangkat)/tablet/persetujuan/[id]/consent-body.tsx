'use client';

import type { ConsentDocument } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { formatTglJam } from '@/lib/rawat-inap';

/** Identitas dokumen: pasien, pemberi persetujuan, dokter pelaksana, pemberi informasi. */
export function ConsentParties({ doc, patient }: { doc: ConsentDocument; patient: string }) {
  const rows = [
    ['Pasien', patient],
    ['Yang memberi persetujuan', doc.consentGiver],
    ['Dokter pelaksana', doc.doctor],
    ['Pemberi informasi', doc.informer],
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 rounded-card border border-line bg-white p-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-[0.8em] text-ink-500">{k}</dt>
          <dd className="m-0 font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tujuh butir informasi wajib; tiap butir dipahami sebelum lanjut ke tanda tangan. */
export function ConsentInfo({
  doc,
  ack,
  locked,
  onAck,
}: {
  doc: ConsentDocument;
  ack: Record<string, boolean>;
  locked: boolean;
  onAck: (id: string) => void;
}) {
  const n = doc.items.filter((i) => ack[i.id]).length;
  return (
    <section
      aria-label="Informasi tindakan"
      className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[1.1em] font-semibold">Informasi tindakan</h2>
        <span className={cx('text-[0.85em] font-semibold', n === 7 ? 'text-success' : 'text-warning')}>
          {n} dari 7 dipahami
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {doc.items.map((i, k) => (
          <li key={i.id} className="border-b border-line-soft py-2 last:border-b-0">
            <label className={cx('flex gap-3', locked ? 'cursor-default' : 'cursor-pointer')}>
              <input
                type="checkbox"
                checked={!!ack[i.id]}
                disabled={locked}
                onChange={() => onAck(i.id)}
                aria-label={`Saya memahami: ${i.title}`}
                className="mt-1 size-6 flex-none accent-brand-600"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">
                  {k + 1}. {i.title}
                </span>
                <span className="text-ink-700">{i.body}</span>
              </span>
            </label>
          </li>
        ))}
      </ol>
      {/* Pita catatan penjelasan (mockup: gradasi biru). */}
      <p className="m-0 rounded-control border border-info-border bg-[linear-gradient(90deg,#EEF4FF,#FFFFFF)] px-3 py-2 text-[0.85em] text-info">
        Dibacakan dan dijelaskan oleh {doc.informer} pada {formatTglJam(doc.explainedAt)} · durasi penjelasan{' '}
        {doc.explanationMinutes} menit · pasien diberi kesempatan bertanya
      </p>
      <span className="text-[0.8em] text-ink-500">Centang tiap butir setelah dipahami.</span>
    </section>
  );
}

/** Formulir penolakan tindakan: alasan wajib dengan kata-kata pasien. */
export function RefusalForm({
  reason,
  error,
  busy,
  onReason,
  onCancel,
  onConfirm,
}: {
  reason: string;
  error: string | null;
  busy: boolean;
  onReason: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      aria-label="Konfirmasi penolakan"
      className="flex flex-col gap-2 rounded-card border border-danger-border bg-[#FFF8F7] p-4"
    >
      <h2 className="m-0 text-[1.05em] font-semibold text-danger-strong">Konfirmasi penolakan tindakan</h2>
      <span className="text-ink-700">
        Penolakan dicatat dengan formulir penolakan tindakan. Dokter akan menjelaskan risiko bila tindakan
        tidak dilakukan.
      </span>
      <label htmlFor="alasan-tolak" className="font-semibold">
        Alasan penolakan (wajib, minimal 10 karakter)
      </label>
      <textarea
        id="alasan-tolak"
        rows={3}
        value={reason}
        maxLength={500}
        aria-invalid={!!error}
        aria-describedby={error ? 'alasan-tolak-galat' : undefined}
        placeholder="Tulis alasan dengan kata-kata pasien"
        onChange={(e) => onReason(e.target.value)}
        className={cx(
          'rounded-control border bg-white px-3 py-2 font-[inherit]',
          error ? 'border-danger' : 'border-line-strong',
        )}
      />
      {error && (
        <span id="alasan-tolak-galat" role="alert" className="text-[0.85em] font-semibold text-danger">
          {error}
        </span>
      )}
      <span className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 cursor-pointer rounded-control border border-line-strong bg-white px-5 font-[inherit]"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-12 cursor-pointer rounded-control border border-[#9A1E14] bg-danger px-5 font-[inherit] font-semibold text-white disabled:opacity-60"
        >
          Catat penolakan
        </button>
      </span>
    </section>
  );
}
