'use client';

import { DISCHARGE_DISPOSITIONS, DISPOSITION_LABEL, type DischargeDisposition } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { type CodedPick, CodeSearch } from '@/components/klinis/code-search';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import { certifyDeathAction, closeEncounterAction } from '@/lib/server/data/klinis/rekam-api-actions';

const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';
const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const FIELD =
  'min-h-11 rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small';

/** `datetime-local` (WIB) → ISO dengan offset +07:00. */
function wibIso(local: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? new Date(`${local}:00+07:00`).toISOString() : null;
}

/**
 * K13 · Tutup kunjungan mode api lewat `DischargeGate` (`POST /encounters/:id/close`): disposisi dipilih, syarat yang
 * kurang ditulis apa adanya dari API. Disposisi meninggal (K-1) wajib surat keterangan kematian ber-TTE dulu: jam
 * kematian + sebab ICD-10 dari data rujukan, oleh dokter berelasi (`clinical.sign`).
 */
export function CloseEncounterApi({
  encounterId,
  canClose,
  canCertify,
  deathCertified,
}: {
  encounterId: string;
  canClose: boolean;
  canCertify: boolean;
  deathCertified: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const [disposition, setDisposition] = useState<DischargeDisposition | ''>('');
  const [diedAt, setDiedAt] = useState('');
  const [cause, setCause] = useState<CodedPick | null>(null);
  const [note, setNote] = useState('');
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  if (!canClose) {
    return (
      <section aria-label="Tutup kunjungan" className={CARD}>
        <h2 className="m-0 text-body font-semibold">Tutup kunjungan</h2>
        <p className="m-0 text-small text-ink-500">
          Kunjungan ditutup oleh klinisi (DPJP); peran Anda hanya membaca.
        </p>
      </section>
    );
  }
  const needDeath = disposition === 'meninggal' && !deathCertified;
  return (
    <section aria-label="Tutup kunjungan" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Tutup kunjungan</h2>
      <Feedback msg={msg} />
      <span className="flex flex-col gap-1">
        <label htmlFor={`${id}-d`} className="text-small font-semibold">
          Disposisi
        </label>
        <select
          id={`${id}-d`}
          value={disposition}
          onChange={(e) => setDisposition(e.target.value as DischargeDisposition | '')}
          className={SELECT}
        >
          <option value="">Pilih disposisi…</option>
          {DISCHARGE_DISPOSITIONS.map((d) => (
            <option key={d} value={d}>
              {DISPOSITION_LABEL[d]}
            </option>
          ))}
        </select>
      </span>
      {needDeath && (
        <form
          aria-label="Surat keterangan kematian"
          className="flex flex-col gap-2 rounded-control bg-subtle p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const at = wibIso(diedAt);
            if (!at || !cause) return;
            run(() =>
              certifyDeathAction({
                encounterId,
                diedAt: at,
                causeCode: cause.code,
                causeDisplay: cause.display,
                note: note.trim() || null,
              }),
            );
          }}
        >
          <h3 className="m-0 text-small font-semibold">Surat keterangan kematian (TTE dokter)</h3>
          {!canCertify ? (
            <p className="m-0 text-small text-warning">
              Surat keterangan kematian ditandatangani dokter yang berelasi dengan pasien (DPJP/rawat
              bersama).
            </p>
          ) : (
            <>
              <label htmlFor={`${id}-t`} className="text-small font-semibold">
                Jam kematian (WIB)
              </label>
              <input
                id={`${id}-t`}
                type="datetime-local"
                value={diedAt}
                onChange={(e) => setDiedAt(e.target.value)}
                className={FIELD}
              />
              <CodeSearch label="Sebab kematian ICD-10" system="icd10" value={cause} onChange={setCause} />
              <label htmlFor={`${id}-n`} className="text-small font-semibold">
                Keterangan (opsional)
              </label>
              <input
                id={`${id}-n`}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                className={FIELD}
              />
              <Button
                type="submit"
                variant="primary"
                className="self-start"
                disabled={busy || !wibIso(diedAt) || !cause}
              >
                Buat surat dan minta TTE
              </Button>
            </>
          )}
        </form>
      )}
      <Button
        variant="primary"
        className="self-start"
        disabled={busy || !disposition || needDeath}
        onClick={() => disposition && run(() => closeEncounterAction({ encounterId, disposition }))}
      >
        Tutup kunjungan
      </Button>
      {needDeath && (
        <span className="text-caption text-ink-500">Buat surat keterangan kematian lebih dulu.</span>
      )}
    </section>
  );
}
