'use client';

import { formatTanggalWaktu, type PatientDocumentView } from '@simrs/shared';
import { Button, Chip, type ChipTone } from '@simrs/ui';
import { useActionState, useId, useState } from 'react';
import { EmptyNote, FlashLine, Panel, TableWrap, TD, TH } from '@/components/backoffice/kit';
import { withBasePath } from '@/lib/base-path';
import {
  CLINICAL_UPLOAD_KINDS,
  formatSize,
  kindLabel,
  MIN_VOID_REASON,
  SIGNATURE_LABEL,
  type SignatureState,
  signatureState,
  signBlocker,
  UPLOAD_ACCEPT,
  uploadProblem,
  voidBlocker,
} from '@/lib/patient-documents';
import {
  type DocumentActionResult,
  requestSignatureAction,
  uploadDocumentAction,
  voidDocumentAction,
} from '@/lib/server/data/klinis/dokumen-actions';

const SIGN_TONE: Record<SignatureState, ChipTone> = {
  belum: 'neutral',
  menunggu: 'warning',
  ditandatangani: 'success',
  gagal: 'danger',
};

const CONTROL =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900';

/**
 * P08 · Dokumen pasien di layar klinis mode api (fase 3 · 3.8, ADR-0059; dipakai tab Dokumen Rawat inap W4 dan layar
 * klinis lain): daftar kelompok rekam medis pasien, unggah (PDF/PNG/JPEG ≤ 10 MB), batal beralasan, minta TTE, unduh
 * lewat BFF. Tombol nonaktif menuliskan alasannya; API tetap penegak akhir (izin, ABAC, status dokumen).
 */
export function PatientDocuments({
  patientId,
  documents,
  canWrite,
  path,
}: {
  patientId: string;
  documents: readonly PatientDocumentView[];
  /** Izin `documents.write` sesi (unggah, batal, minta TTE). */
  canWrite: boolean;
  /** Jalur halaman pemanggil (revalidasi setelah aksi). */
  path: string;
}) {
  const [uploadState, upload, uploading] = useActionState(uploadDocumentAction, {} as DocumentActionResult);
  const [rowState, setRowState] = useState<DocumentActionResult | null>(null);
  const flash = rowState ?? uploadState;
  return (
    <Panel
      title="Dokumen pasien"
      sub="Lampiran, hasil, surat, resume, dan persetujuan ber-TTE. Dokumen tidak pernah dihapus; salah unggah dibatalkan beralasan."
    >
      <div className="flex flex-col gap-3 p-4">
        <FlashLine
          flash={
            flash.error
              ? { ok: false, text: flash.error }
              : flash.message
                ? { ok: true, text: flash.message }
                : null
          }
        />
        {documents.length === 0 ? (
          <EmptyNote>Belum ada dokumen untuk pasien ini.</EmptyNote>
        ) : (
          <TableWrap label="Daftar dokumen pasien" minWidth={760}>
            <thead>
              <tr>
                <th className={TH}>Dokumen</th>
                <th className={TH}>Jenis</th>
                <th className={TH}>Diunggah</th>
                <th className={TH}>TTE</th>
                <th className={TH}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <DocumentRow key={d.id} doc={d} canWrite={canWrite} path={path} onResult={setRowState} />
              ))}
            </tbody>
          </TableWrap>
        )}
        {canWrite ? (
          <UploadForm
            patientId={patientId}
            path={path}
            action={upload}
            pending={uploading}
            onSubmit={() => setRowState(null)}
          />
        ) : (
          <p className="m-0 text-caption text-ink-500">
            Peran Anda hanya bisa membaca dan mengunduh dokumen.
          </p>
        )}
      </div>
    </Panel>
  );
}

function DocumentRow({
  doc,
  canWrite,
  path,
  onResult,
}: {
  doc: PatientDocumentView;
  canWrite: boolean;
  path: string;
  onResult: (r: DocumentActionResult) => void;
}) {
  const [voiding, setVoiding] = useState(false);
  const state = signatureState(doc);
  const signReason = signBlocker(doc, canWrite);
  const voidReason = voidBlocker(doc, canWrite);
  const run = async (
    action: (prev: DocumentActionResult, fd: FormData) => Promise<DocumentActionResult>,
    fields: Record<string, string>,
  ) => {
    const fd = new FormData();
    fd.set('documentId', doc.id);
    fd.set('path', path);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    onResult(await action({}, fd));
  };
  return (
    <tr className={doc.voided ? 'text-ink-500' : undefined}>
      <td className={TD}>
        <span className={doc.voided ? 'line-through' : 'font-semibold text-ink-900'}>{doc.title}</span>
        <span className="block text-caption text-ink-500">
          {doc.fileName} · {formatSize(doc.sizeBytes)}
        </span>
        {doc.voided && (
          <span className="block text-caption text-danger">
            Dibatalkan {doc.voided.by ?? ''}: {doc.voided.reason ?? '-'}
          </span>
        )}
      </td>
      <td className={TD}>{kindLabel(doc.kind)}</td>
      <td className={TD}>
        {formatTanggalWaktu(new Date(doc.createdAt))}
        <span className="block text-caption text-ink-500">{doc.createdBy ?? 'Sistem'}</span>
      </td>
      <td className={TD}>
        <Chip tone={SIGN_TONE[state]}>{SIGNATURE_LABEL[state]}</Chip>
      </td>
      <td className={TD}>
        <div className="flex flex-wrap items-start gap-2">
          <a
            href={withBasePath(`/klinis/dokumen/${doc.id}/unduh`)}
            className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-3 text-small font-semibold text-ink-900"
          >
            Unduh
          </a>
          <RowButton label="Minta TTE" reason={signReason} onClick={() => run(requestSignatureAction, {})} />
          {voiding ? (
            <VoidBox
              onCancel={() => setVoiding(false)}
              onConfirm={async (reason) => {
                setVoiding(false);
                await run(voidDocumentAction, { reason });
              }}
            />
          ) : (
            <RowButton
              label="Batalkan"
              variant="danger"
              reason={voidReason}
              onClick={() => setVoiding(true)}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

function RowButton({
  label,
  reason,
  onClick,
  variant = 'secondary',
}: {
  label: string;
  reason: string | null;
  onClick: () => void;
  variant?: 'secondary' | 'danger';
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex max-w-56 flex-col gap-1">
      <Button
        variant={variant}
        disabled={reason !== null || busy}
        aria-describedby={reason ? id : undefined}
        onClick={async () => {
          setBusy(true);
          try {
            await onClick();
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {reason && (
        <span id={id} className="text-caption text-ink-500">
          {reason}
        </span>
      )}
    </span>
  );
}

function VoidBox({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const short = reason.trim().length < MIN_VOID_REASON;
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${id}-t`}
      className="flex w-72 flex-col gap-2 rounded-control border border-danger-border bg-danger-bg p-3"
    >
      <span id={`${id}-t`} className="font-semibold text-ink-900">
        Batalkan dokumen?
      </span>
      <label htmlFor={`${id}-r`} className="text-small font-semibold text-ink-700">
        Alasan (wajib, tercatat)
      </label>
      <textarea
        id={`${id}-r`}
        value={reason}
        rows={2}
        onChange={(e) => setReason(e.target.value)}
        className="min-h-11 rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-ink-900"
      />
      <span className="text-caption text-ink-500">
        {short
          ? `Minimal ${MIN_VOID_REASON} huruf (${reason.trim().length}/${MIN_VOID_REASON}).`
          : 'Alasan cukup.'}
      </span>
      <span className="flex gap-2">
        <Button onClick={onCancel}>Kembali</Button>
        <Button variant="danger" disabled={short} onClick={() => onConfirm(reason.trim())}>
          Batalkan dokumen
        </Button>
      </span>
    </div>
  );
}

function UploadForm({
  patientId,
  path,
  action,
  pending,
  onSubmit,
}: {
  patientId: string;
  path: string;
  action: (fd: FormData) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const problem = uploadProblem(file, title);
  return (
    <form
      action={action}
      onSubmit={onSubmit}
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-3 rounded-card border border-line-soft p-3"
    >
      <h3 id={`${id}-h`} className="m-0 text-body font-semibold text-ink-900">
        Unggah dokumen
      </h3>
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="path" value={path} />
      <div className="grid gap-3 sm:grid-cols-3">
        <span className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-k`} className="text-small font-semibold text-ink-700">
            Jenis
          </label>
          <select id={`${id}-k`} name="kind" defaultValue="lampiran" className={CONTROL}>
            {CLINICAL_UPLOAD_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </span>
        <span className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-t`} className="text-small font-semibold text-ink-700">
            Judul
          </label>
          <input
            id={`${id}-t`}
            name="title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className={CONTROL}
          />
        </span>
        <span className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-f`} className="text-small font-semibold text-ink-700">
            Berkas (PDF, PNG, JPEG · maks. 10 MB)
          </label>
          <input
            id={`${id}-f`}
            name="file"
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="min-h-11 text-small"
          />
        </span>
      </div>
      <span className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={problem !== null || pending}
          aria-describedby={`${id}-p`}
        >
          {pending ? 'Mengunggah…' : 'Unggah'}
        </Button>
        <span id={`${id}-p`} className="text-caption text-ink-500">
          {problem ?? 'Siap diunggah; berkas dikenali dari isinya dan hash-nya dicatat.'}
        </span>
      </span>
    </form>
  );
}
