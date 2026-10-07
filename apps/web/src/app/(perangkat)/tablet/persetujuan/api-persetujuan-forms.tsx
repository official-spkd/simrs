'use client';

import {
  type ConsentRecord,
  type ConsentSignerKind,
  type ConsentTemplate,
  formatTanggalWaktu,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { useRefreshWhilePending } from '@/lib/use-refresh-while-pending';
import { createConsentDraftAction, revokeConsentAction } from './actions';
import { DECISION, TteChip } from './consent-status';
import { TABLET_CARD } from './tablet-shell';

const FIELD = 'min-h-12 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-[16px]';

/** Pilihan pasien sendiri / wali (radio asli, label terlihat). */
function SignerKindPicker({
  value,
  onChange,
  disabled,
}: {
  value: ConsentSignerKind;
  onChange: (v: ConsentSignerKind) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
      <legend className="mb-1 font-semibold">Yang memberi persetujuan</legend>
      {(
        [
          ['pasien', 'Pasien sendiri (kompeten)'],
          ['wali', 'Wali/keluarga terdekat'],
        ] as const
      ).map(([v, label]) => (
        <label
          key={v}
          htmlFor={`${id}-${v}`}
          className="flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-white px-3"
        >
          <input
            id={`${id}-${v}`}
            type="radio"
            name={`${id}-signer`}
            checked={value === v}
            disabled={disabled}
            onChange={() => onChange(v)}
            className="size-5 accent-brand-600"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Draf persetujuan baru dari templat P07 (mode api): tindakan, pemberi persetujuan, dan ketujuh butir informasi yang
 * dijelaskan dokter. Setelah tersimpan, tablet membuka draf itu untuk tanda tangan.
 */
export function ConsentDraftForm({
  encounterId,
  templates,
  patientName,
}: {
  encounterId: string;
  templates: readonly ConsentTemplate[];
  patientName: string;
}) {
  const id = useId();
  const router = useRouter();
  const [code, setCode] = useState(templates[0]?.code ?? '');
  const template = templates.find((t) => t.code === code) ?? templates[0];
  const [procedure, setProcedure] = useState('');
  const [signerKind, setSignerKind] = useState<ConsentSignerKind>('pasien');
  const [info, setInfo] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!template) return null;
  const empty = template.items.filter((i) => !info[i.key]?.trim());
  const ready = procedure.trim().length > 0 && empty.length === 0;

  return (
    <section aria-label="Draf persetujuan baru" className={`flex flex-col gap-3 p-4 ${TABLET_CARD}`}>
      <h2 className="m-0 text-[1.1em] font-semibold">Draf persetujuan baru · {patientName}</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || pending) return;
          start(async () => {
            setError(null);
            const r = await createConsentDraftAction(encounterId, {
              templateCode: template.code,
              procedure: procedure.trim(),
              signerKind,
              information: Object.fromEntries(template.items.map((i) => [i.key, info[i.key]?.trim() ?? ''])),
              explainedAt: null,
            });
            if (!r.ok) return setError(r.message);
            router.push(`/tablet/persetujuan/${r.draftId}`);
          });
        }}
      >
        {templates.length > 1 && (
          <label htmlFor={`${id}-templat`} className="flex flex-col gap-1 font-semibold">
            Templat
            <select
              id={`${id}-templat`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={FIELD}
            >
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.title} (versi {t.version})
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={`${id}-prosedur`} className="flex flex-col gap-1 font-semibold">
          Tindakan yang akan dilakukan
          <input
            id={`${id}-prosedur`}
            value={procedure}
            maxLength={200}
            onChange={(e) => setProcedure(e.target.value)}
            className={FIELD}
          />
        </label>
        <SignerKindPicker value={signerKind} onChange={setSignerKind} disabled={pending} />
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {template.items.map((item, k) => (
            <li key={item.key}>
              <label htmlFor={`${id}-butir-${item.key}`} className="flex flex-col gap-1 font-semibold">
                {k + 1}. {item.label}
                <textarea
                  id={`${id}-butir-${item.key}`}
                  rows={2}
                  maxLength={2000}
                  value={info[item.key] ?? ''}
                  onChange={(e) => setInfo((v) => ({ ...v, [item.key]: e.target.value }))}
                  className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] font-normal"
                />
              </label>
            </li>
          ))}
        </ol>
        {error && (
          <span role="alert" className="font-semibold text-danger">
            {error}
          </span>
        )}
        <span className="flex flex-wrap items-center justify-end gap-3">
          {!ready && (
            <span className="text-[14px] font-semibold text-warning">
              {procedure.trim()
                ? `Lengkapi ${empty.length} butir informasi.`
                : 'Isi tindakan dan ketujuh butir.'}
            </span>
          )}
          <Button type="submit" variant="primary" disabled={!ready || pending} className="h-12">
            {pending ? 'Menyimpan…' : 'Simpan draf dan buka di tablet'}
          </Button>
        </span>
      </form>
    </section>
  );
}

/** Pencabutan persetujuan final: pasien/wali menyatakan dengan nama lengkap, dicatat dokter berelasi (TTE). */
function RevokeForm({ consent, onDone }: { consent: ConsentRecord; onDone: (message?: string) => void }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [signerKind, setSignerKind] = useState<ConsentSignerKind>('pasien');
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready =
    reason.trim().length >= SAFETY_REASON_MIN &&
    name.trim().length >= 3 &&
    (signerKind === 'pasien' || relation.trim().length > 0);
  return (
    <form
      className="flex flex-col gap-2 rounded-control border border-danger-border bg-alert-critical p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        start(async () => {
          setError(null);
          const r = await revokeConsentAction({
            consentId: consent.id,
            reason: reason.trim(),
            signerKind,
            signerName: name.trim(),
            relation: signerKind === 'wali' ? relation.trim() : null,
          });
          if (!r.ok) return setError(r.message);
          onDone(`Persetujuan ${consent.procedure} dicabut · dokumen pencabutan dikirim untuk TTE.`);
        });
      }}
    >
      <label htmlFor={`${id}-alasan`} className="flex flex-col gap-1 font-semibold">
        Alasan pencabutan (wajib, minimal {SAFETY_REASON_MIN} karakter)
        <textarea
          id={`${id}-alasan`}
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] font-normal"
        />
      </label>
      <SignerKindPicker value={signerKind} onChange={setSignerKind} disabled={pending} />
      <label htmlFor={`${id}-nama`} className="flex flex-col gap-1 font-semibold">
        Nama lengkap yang mencabut (tanda tangan ketik nama)
        <input
          id={`${id}-nama`}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={FIELD}
        />
      </label>
      {signerKind === 'wali' && (
        <label htmlFor={`${id}-hubungan`} className="flex flex-col gap-1 font-semibold">
          Hubungan dengan pasien
          <input
            id={`${id}-hubungan`}
            value={relation}
            maxLength={40}
            onChange={(e) => setRelation(e.target.value)}
            className={FIELD}
          />
        </label>
      )}
      {error && (
        <span role="alert" className="font-semibold text-danger">
          {error}
        </span>
      )}
      <span className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => onDone()} disabled={pending} className="h-12">
          Tutup
        </Button>
        <Button type="submit" variant="danger" disabled={!ready || pending} className="h-12">
          {pending ? 'Mencatat…' : 'Catat pencabutan (TTE)'}
        </Button>
      </span>
    </form>
  );
}

/**
 * Persetujuan tercatat kunjungan ini (rekam medis berversi): keputusan berlaku, pemberi informasi, status TTE dokumen
 * (dimuat ulang sendiri selama diproses), alasan penolakan, dan pencabutan oleh dokter berelasi.
 */
export function ConsentRecords({
  consents,
  canRevoke,
  patientName,
}: {
  consents: readonly ConsentRecord[];
  canRevoke: boolean;
  patientName: string;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useRefreshWhilePending(consents.some((c) => c.document?.signatureStatus === 'pending'));
  return (
    <section aria-label="Persetujuan tercatat" className={`flex flex-col gap-2 p-4 ${TABLET_CARD}`}>
      <h2 className="m-0 text-[1.1em] font-semibold">Persetujuan tercatat · {patientName}</h2>
      {notice && (
        <p
          role="status"
          className="m-0 rounded-control bg-alert-success px-3 py-2 font-semibold text-success"
        >
          {notice}
        </p>
      )}
      {consents.length === 0 ? (
        <p className="m-0 text-ink-700">Belum ada persetujuan final untuk kunjungan ini.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {consents.map((c) => {
            const d = DECISION[c.effectiveDecision];
            return (
              <li key={c.id} className="flex flex-col gap-2 border-b border-line-soft py-2.5 last:border-b-0">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="font-semibold">
                      {c.decision === 'dicabut' ? `Pencabutan · ${c.procedure}` : c.procedure}
                    </span>
                    <span className="text-[14px] text-ink-700">
                      {formatTanggalWaktu(c.recordedAt)} · dijelaskan {c.informer.nama}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={d.tone}>{d.label}</Chip>
                    <TteChip consent={c} />
                  </span>
                </span>
                {c.refusalReason && (
                  <span className="text-[14px] text-ink-700">Alasan: {c.refusalReason}</span>
                )}
                {canRevoke &&
                  c.decision === 'setuju' &&
                  c.effectiveDecision === 'setuju' &&
                  revoking !== c.id && (
                    <Button size="sm" className="w-fit" onClick={() => setRevoking(c.id)}>
                      Pasien mencabut persetujuan
                    </Button>
                  )}
                {revoking === c.id && (
                  <RevokeForm
                    consent={c}
                    onDone={(message) => {
                      setRevoking(null);
                      if (message) setNotice(message);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
