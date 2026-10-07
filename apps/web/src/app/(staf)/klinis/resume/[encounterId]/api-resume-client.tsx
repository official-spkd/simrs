'use client';

import {
  DISCHARGE_DISPOSITIONS,
  DISCHARGE_MEDICATION_CHANGES,
  type DischargeDisposition,
  type DischargeDraftInput,
  type DischargeMedicationLine,
  type DischargeSummaryView,
  DISPOSITION_LABEL,
  formatJam,
  formatTanggalWaktu,
  resumeCompleteness,
} from '@simrs/shared';
import { Alert, Button, cx, Field } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import {
  addendumAction,
  createResumeDraftAction,
  finalizeResumeAction,
  reconcileAction,
  type ResumeActionResult,
  saveResumeDraftAction,
} from './actions-api';
import { ResumeSections } from './resume-sections';

const CHANGE_LABEL: Record<DischargeMedicationLine['change'], string> = {
  baru: 'Baru',
  lanjut: 'Lanjut',
  'ubah-dosis': 'Ubah dosis',
  dihentikan: 'Dihentikan',
};

const NOTE_LABEL: Record<keyof DischargeDraftInput['notes'], string> = {
  anamnesis: 'Catatan anamnesis',
  fisik: 'Catatan pemeriksaan fisik pulang',
  penunjang: 'Catatan penunjang (mis. "tidak ada pemeriksaan penunjang")',
  terapi: 'Catatan terapi',
};

/** `datetime-local` (WIB) ↔ ISO. */
function toLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  return d.toISOString().slice(0, 16);
}
function fromLocal(v: string): string | null {
  return v ? new Date(`${v}:00+07:00`).toISOString() : null;
}

/**
 * K13 · Resume medis mode api (W5b, mockup Resume): bagian berlabel sumber (isi = data sumber, DPJP menambah catatan),
 * rekonsiliasi obat pulang + konfirmasi DPJP, butir wajib dari server, TTE, addendum, cetak PDF. Semua lewat API.
 */
export function ApiResumeClient({
  view,
  canWrite,
  pdfBase,
}: {
  view: DischargeSummaryView;
  /** Peran berizin `clinical.write` (menyusun draf). */
  canWrite: boolean;
  /** Awalan rute unduh dokumen BFF (`/klinis/dokumen`, P08). */
  pdfBase: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = view.summary;
  const final = view.final;
  const base: DischargeDraftInput = view.draft ?? {
    dischargeAt: null,
    disposition: null,
    dischargeCondition: null,
    notes: { anamnesis: null, fisik: null, penunjang: null, terapi: null },
    education: null,
    instructions: null,
    followUp: null,
    medications: view.medications,
  };
  const [form, setForm] = useState<DischargeDraftInput>(base);
  const [dirty, setDirty] = useState(false);
  const [newMed, setNewMed] = useState({
    name: '',
    sig: '',
    change: 'baru' as DischargeMedicationLine['change'],
  });
  const [addendum, setAddendum] = useState('');
  const [resignReason, setResignReason] = useState('');
  const set = (patch: Partial<DischargeDraftInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const run = (fn: () => Promise<ResumeActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const comp = resumeCompleteness(s.checklist, view.requiredChecks);
  const checklist = s.checklist.filter((c) => view.requiredChecks.includes(c.id));
  const editable = canWrite && view.state === 'draf' && !final;
  const blocker = final
    ? null
    : view.state !== 'draf'
      ? 'Himpun draf resume lebih dulu.'
      : dirty
        ? 'Simpan perubahan draf lebih dulu.'
        : !comp.complete
          ? `TTE terkunci: lengkapi ${comp.total - comp.done} butir lagi (${comp.missing.join(', ')}).`
          : !view.canSign
            ? 'Resume disiapkan; TTE hanya oleh DPJP pasien ini.'
            : null;
  const los = Math.max(
    view.kind === 'rawat_inap' ? 1 : 0,
    Math.round((Date.parse(s.dischargeAt) - Date.parse(s.admittedAt)) / 86_400_000),
  );
  const reconAt = s.reconciliationConfirmedAt;
  const textArea =
    'min-h-[64px] rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small text-ink-900 read-only:bg-subtle';

  const reconControls =
    final || view.kind !== 'rawat_inap' ? null : (
      <span className="flex flex-wrap items-center gap-2.5">
        <Button
          variant={reconAt ? 'secondary' : 'primary'}
          aria-pressed={!!reconAt}
          disabled={pending || !view.canSign || view.state !== 'draf' || dirty}
          onClick={() => run(() => reconcileAction(view.encounterId, !reconAt))}
        >
          {reconAt ? 'Batalkan konfirmasi' : 'Konfirmasi DPJP'}
        </Button>
        <span className="text-caption text-ink-700">
          {!view.canSign
            ? 'Konfirmasi hanya oleh DPJP pasien ini.'
            : dirty
              ? 'Simpan draf dulu; konfirmasi berlaku untuk daftar obat yang tersimpan.'
              : reconAt
                ? `Dikonfirmasi ${formatJam(reconAt)}. Mengubah daftar obat membatalkan konfirmasi.`
                : 'Periksa ulang dosis dan obat yang dihentikan sebelum konfirmasi.'}
        </span>
      </span>
    );

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
        {view.state === 'belum' && canWrite && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] px-4 py-3 shadow-card">
            <span className="text-small text-ink-700">
              Pratinjau dari rekam medis terkini. Himpun draf untuk menulis catatan DPJP, obat pulang, dan
              kondisi pulang.
            </span>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => run(() => createResumeDraftAction(view.encounterId))}
            >
              Himpun resume
            </Button>
          </div>
        )}
        <ResumeSections summary={s} los={los} reconAt={reconAt} reconControls={reconControls} />
        {editable && (
          <section
            aria-labelledby={`${ids}-dpjp`}
            className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3 shadow-card"
          >
            <h2 id={`${ids}-dpjp`} className="m-0 text-body font-semibold">
              Isian DPJP
            </h2>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field
                label="Rencana pulang"
                type="datetime-local"
                value={toLocal(form.dischargeAt)}
                onChange={(e) => set({ dischargeAt: fromLocal(e.target.value) })}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-cara`} className="text-small font-semibold">
                  Cara pulang
                </label>
                <select
                  id={`${ids}-cara`}
                  value={form.disposition ?? ''}
                  onChange={(e) =>
                    set({ disposition: (e.target.value || null) as DischargeDisposition | null })
                  }
                  className="h-11 rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-small"
                >
                  <option value="">Pilih cara pulang…</option>
                  {DISCHARGE_DISPOSITIONS.map((d) => (
                    <option key={d} value={d}>
                      {DISPOSITION_LABEL[d]}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                label="Kondisi pulang"
                value={form.dischargeCondition ?? ''}
                maxLength={40}
                placeholder="Membaik"
                onChange={(e) => set({ dischargeCondition: e.target.value || null })}
              />
            </div>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {(Object.keys(NOTE_LABEL) as Array<keyof DischargeDraftInput['notes']>).map((k) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label htmlFor={`${ids}-n-${k}`} className="text-small font-semibold">
                    {NOTE_LABEL[k]}
                  </label>
                  <textarea
                    id={`${ids}-n-${k}`}
                    rows={2}
                    maxLength={1200}
                    value={form.notes[k] ?? ''}
                    onChange={(e) => set({ notes: { ...form.notes, [k]: e.target.value || null } })}
                    className={textArea}
                  />
                </div>
              ))}
              {(
                [
                  ['education', 'Edukasi pasien dan keluarga'],
                  ['instructions', 'Instruksi pulang dan tanda bahaya'],
                  ['followUp', 'Tindak lanjut / jadwal kontrol'],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label htmlFor={`${ids}-${k}`} className="text-small font-semibold">
                    {label}
                  </label>
                  <textarea
                    id={`${ids}-${k}`}
                    rows={2}
                    maxLength={1200}
                    value={form[k] ?? ''}
                    onChange={(e) => set({ [k]: e.target.value || null })}
                    className={textArea}
                  />
                </div>
              ))}
            </div>
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-control border border-line p-3">
              <legend className="px-1 text-small font-semibold">Obat pulang (rekonsiliasi)</legend>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {form.medications.map((m, i) => (
                  <li key={`${m.name}-${i}`} className="flex flex-wrap items-center gap-2 text-small">
                    <label className="sr-only" htmlFor={`${ids}-m-${i}`}>
                      Status {m.name}
                    </label>
                    <select
                      id={`${ids}-m-${i}`}
                      value={m.change}
                      onChange={(e) =>
                        set({
                          medications: form.medications.map((x, j) =>
                            j === i
                              ? { ...x, change: e.target.value as DischargeMedicationLine['change'] }
                              : x,
                          ),
                        })
                      }
                      className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit] text-small"
                    >
                      {DISCHARGE_MEDICATION_CHANGES.map((c) => (
                        <option key={c} value={c}>
                          {CHANGE_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-ink-700">{m.sig}</span>
                    <Button
                      variant="secondary"
                      aria-label={`Hapus ${m.name} dari obat pulang`}
                      onClick={() => set({ medications: form.medications.filter((_, j) => j !== i) })}
                    >
                      Hapus
                    </Button>
                  </li>
                ))}
                {form.medications.length === 0 && (
                  <li className="text-small text-ink-500">Belum ada obat pulang.</li>
                )}
              </ul>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[2fr_2fr_1fr_auto] xl:items-end">
                <Field
                  label="Nama obat"
                  value={newMed.name}
                  maxLength={80}
                  onChange={(e) => setNewMed((n) => ({ ...n, name: e.target.value }))}
                />
                <Field
                  label="Aturan pakai"
                  value={newMed.sig}
                  maxLength={80}
                  placeholder="2×1 PO · 5 hari"
                  onChange={(e) => setNewMed((n) => ({ ...n, sig: e.target.value }))}
                />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${ids}-newchange`} className="text-small font-semibold">
                    Status
                  </label>
                  <select
                    id={`${ids}-newchange`}
                    value={newMed.change}
                    onChange={(e) =>
                      setNewMed((n) => ({
                        ...n,
                        change: e.target.value as DischargeMedicationLine['change'],
                      }))
                    }
                    className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit] text-small"
                  >
                    {DISCHARGE_MEDICATION_CHANGES.map((c) => (
                      <option key={c} value={c}>
                        {CHANGE_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="secondary"
                  disabled={!newMed.name.trim() || !newMed.sig.trim()}
                  onClick={() => {
                    set({
                      medications: [
                        ...form.medications,
                        {
                          medicationRequestId: null,
                          name: newMed.name.trim(),
                          sig: newMed.sig.trim(),
                          change: newMed.change,
                        },
                      ],
                    });
                    setNewMed({ name: '', sig: '', change: 'baru' });
                  }}
                >
                  Tambah obat
                </Button>
              </div>
            </fieldset>
            <span className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="primary"
                disabled={pending || !dirty}
                onClick={() =>
                  run(
                    () => saveResumeDraftAction(view.encounterId, form),
                    () => setDirty(false),
                  )
                }
              >
                Simpan draf resume
              </Button>
              <span className="text-caption text-ink-500">
                {dirty ? 'Perubahan belum disimpan.' : 'Draf tersimpan; butir kelengkapan dihitung server.'}
              </span>
            </span>
          </section>
        )}
        {final && (
          <section
            aria-label="Addendum"
            className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 px-4 py-3 shadow-card"
          >
            <h2 className="m-0 text-body font-semibold">Addendum</h2>
            {view.addenda.length === 0 ? (
              <span className="text-small text-ink-500">Belum ada addendum.</span>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {view.addenda.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-0.5 border-l-2 border-brand-200 pl-3 text-small"
                  >
                    <span className="whitespace-pre-line">{a.text}</span>
                    <span className="text-caption text-ink-500">
                      {a.author.nama} · {formatTanggalWaktu(a.recordedAt)} · TTE{' '}
                      {a.document?.signatureStatus === 'signed' ? 'sah' : 'diminta'}
                      {a.document && (
                        <>
                          {' · '}
                          <a href={`${pdfBase}/${a.document.id}/unduh`} target="_blank" rel="noopener">
                            Buka PDF
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {view.canSign && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-add`} className="text-small font-semibold">
                  Tambah addendum (isi resume final tidak berubah)
                </label>
                <textarea
                  id={`${ids}-add`}
                  rows={3}
                  maxLength={2000}
                  value={addendum}
                  onChange={(e) => setAddendum(e.target.value)}
                  className={textArea}
                />
                <span>
                  <Button
                    variant="primary"
                    disabled={pending || addendum.trim().length < 10}
                    onClick={() =>
                      run(
                        () => addendumAction(final.id, addendum),
                        () => setAddendum(''),
                      )
                    }
                  >
                    Tanda tangani addendum (TTE)
                  </Button>
                </span>
              </div>
            )}
          </section>
        )}
      </div>
      <aside
        aria-label="Kelengkapan dan tanda tangan"
        className="flex flex-[1_1_300px] flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card lg:max-w-[360px]"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 text-body font-semibold">Kelengkapan</h2>
          <span className="font-mono font-bold">
            {comp.done}/{comp.total}
          </span>
        </div>
        <span
          role="progressbar"
          aria-label="Kelengkapan resume"
          aria-valuemin={0}
          aria-valuemax={comp.total}
          aria-valuenow={comp.done}
          className="h-2 overflow-hidden rounded-full bg-[rgba(23,32,46,0.08)]"
        >
          <span
            className={cx('block h-2 rounded-full', comp.complete ? 'bg-success' : 'bg-domain-bar')}
            style={{ width: `${Math.round((comp.done / Math.max(1, comp.total)) * 100)}%` }}
          />
        </span>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {checklist.map((c) => (
            <li key={c.id} className="flex min-h-9 items-center gap-2.5 text-small">
              <span aria-hidden="true" className={cx('font-bold', c.done ? 'text-success' : 'text-warning')}>
                {c.done ? '✓' : '○'}
              </span>
              <span className={cx(c.done ? 'text-ink-700' : 'font-semibold text-warning')}>
                {c.label}
                <span className="sr-only">{c.done ? ' (lengkap)' : ' (belum)'}</span>
              </span>
            </li>
          ))}
        </ul>
        <span className="text-caption text-ink-500">
          Butir dihitung server dari data sumber dan isian DPJP
          {view.kind === 'rawat_jalan' ? ' (resume rawat jalan ringkas)' : ''}.
        </span>
        {final ? (
          <div
            role="status"
            className="flex flex-col gap-1.5 rounded-control border border-zamrud-200 bg-alert-success px-3 py-2.5"
          >
            <span className="font-semibold text-success">
              Resume final · versi {final.version} · {formatJam(final.recordedAt)}
            </span>
            <span className="text-small text-ink-700">
              Ditandatangani {final.author.nama}. TTE{' '}
              {final.document?.signatureStatus === 'signed'
                ? 'sah'
                : final.document?.signatureStatus === 'failed'
                  ? 'gagal (masuk worklist)'
                  : 'diminta ke penyelenggara'}
              . Staging SATUSEHAT Composition tercatat.
            </span>
            {final.document && (
              <a
                href={`${pdfBase}/${final.document.id}/unduh`}
                target="_blank"
                rel="noopener"
                className="text-small font-semibold"
              >
                Cetak PDF resume
              </a>
            )}
            {final.document?.signatureStatus === 'failed' && view.canSign && (
              <div className="flex flex-col gap-1.5 border-t border-zamrud-200 pt-2">
                <label htmlFor={`${ids}-resign`} className="text-small font-semibold text-danger">
                  TTE gagal · alasan tanda tangan ulang
                </label>
                <textarea
                  id={`${ids}-resign`}
                  rows={2}
                  maxLength={500}
                  value={resignReason}
                  onChange={(e) => setResignReason(e.target.value)}
                  placeholder="Mis. TTE ditolak penyelenggara, ditandatangani ulang"
                  className={textArea}
                />
                <span>
                  <Button
                    variant="primary"
                    disabled={pending || resignReason.trim().length < 10}
                    onClick={() =>
                      run(
                        () =>
                          finalizeResumeAction(view.encounterId, {
                            kind: 'koreksi',
                            supersedesId: final.id,
                            correctionReason: resignReason.trim(),
                          }),
                        () => setResignReason(''),
                      )
                    }
                  >
                    Tanda tangani ulang (TTE)
                  </Button>
                </span>
              </div>
            )}
          </div>
        ) : (
          <Button
            variant="primary"
            className="h-12 font-bold"
            disabled={!!blocker || pending}
            aria-describedby={`${ids}-why`}
            onClick={() => run(() => finalizeResumeAction(view.encounterId, { kind: 'baru' }))}
          >
            Tanda tangani resume (TTE)
          </Button>
        )}
        <span
          id={`${ids}-why`}
          className={cx('text-caption', blocker ? 'font-semibold text-warning' : 'text-ink-500')}
        >
          {blocker ?? 'Setelah final, perubahan hanya lewat addendum berversi.'}
        </span>
        {msg && (
          <span
            role={msg.ok ? 'status' : 'alert'}
            className={cx('text-caption font-semibold', msg.ok ? 'text-success' : 'text-danger')}
          >
            {msg.text}
          </span>
        )}
        {!canWrite && <Alert level="info">Peran Anda hanya melihat resume.</Alert>}
      </aside>
    </div>
  );
}
