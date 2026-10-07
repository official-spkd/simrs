'use client';

import {
  ALLERGY_CATEGORIES,
  ALLERGY_CRITICALITIES,
  type ConditionRecord,
  type PatientAllergies,
  type ProcedureRecord,
} from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useId, useState, useTransition } from 'react';
import { type CodedPick, CodeSearch } from '@/components/klinis/code-search';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import { formatTglJam } from '@/lib/rawat-inap';
import {
  addAllergyAction,
  addConditionAction,
  addProcedureAction,
  enteredInErrorAction,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam-api-actions';

const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';
const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const FIELD =
  'min-h-11 rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small';
const ROLE_LABEL = { utama: 'Utama', sekunder: 'Sekunder', komplikasi: 'Komplikasi' } as const;
const CATEGORY_LABEL = {
  obat: 'Obat',
  makanan: 'Makanan',
  lingkungan: 'Lingkungan',
  lainnya: 'Lainnya',
} as const;
const CRIT_LABEL = { rendah: 'Rendah', tinggi: 'Tinggi', tidak_diketahui: 'Tidak diketahui' } as const;

type Run = (fn: () => Promise<RekamActionResult>, done?: () => void) => void;

/**
 * K08 · Diagnosis & problem list mode api: diagnosis kunjungan ICD-10 (satu utama, API menolak utama kedua), problem
 * list lintas kunjungan, tindakan ICD-9-CM, alergi + NKDA. Kode hanya dari data rujukan (pencarian), salah entri wajib
 * alasan ≥ 10 (versi baru, isi asli tetap terbaca). Data dari server; aksi lewat Server Action lalu `router.refresh()`.
 */
export function DiagnosisApi({
  patientId,
  encounterId,
  conditions,
  problems,
  procedures,
  allergies,
  canWrite,
  canCorrect,
}: {
  patientId: string;
  encounterId: string;
  conditions: readonly ConditionRecord[];
  problems: readonly ConditionRecord[];
  procedures: readonly ProcedureRecord[];
  allergies: PatientAllergies;
  canWrite: boolean;
  canCorrect: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const run: Run = (fn, done) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        done?.();
        router.refresh();
      }
    });
  const live = (c: { status: string }) => c.status === 'final';
  const hasPrimary = conditions.some((c) => live(c) && c.role === 'utama');
  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Diagnosis kunjungan" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Diagnosis kunjungan (ICD-10)</h2>
          <EntryList
            items={conditions.filter(live).map((c) => ({
              id: c.id,
              main: `${c.code} ${c.display}`,
              chip: c.role ? ROLE_LABEL[c.role] : null,
              sub: `${c.author.nama} · ${formatTglJam(c.occurredAt)}${c.note ? ` · ${c.note}` : ''}`,
            }))}
            empty="Belum ada diagnosis pada kunjungan ini."
            target="conditions"
            canCorrect={canCorrect}
            busy={busy}
            run={run}
          />
          {canWrite && (
            <ConditionForm
              encounterId={encounterId}
              kind="encounter"
              defaultRole={hasPrimary ? 'sekunder' : 'utama'}
              busy={busy}
              run={run}
            />
          )}
        </section>
        <section aria-label="Problem list" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Problem list (lintas kunjungan)</h2>
          <EntryList
            items={problems.filter(live).map((c) => ({
              id: c.id,
              main: `${c.code} ${c.display}`,
              chip: c.clinicalStatus === 'resolved' ? 'Teratasi' : 'Aktif',
              sub: `${c.author.nama} · ${formatTglJam(c.occurredAt)}`,
            }))}
            empty="Problem list kosong."
            target="conditions"
            canCorrect={canCorrect}
            busy={busy}
            run={run}
          />
          {canWrite && (
            <ConditionForm
              encounterId={encounterId}
              kind="problem_list"
              defaultRole={null}
              busy={busy}
              run={run}
            />
          )}
        </section>
        <section aria-label="Tindakan" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Tindakan (ICD-9-CM)</h2>
          <EntryList
            items={procedures.filter(live).map((p) => ({
              id: p.id,
              main: `${p.code} ${p.display}`,
              chip: null,
              sub: `${p.author.nama} · ${formatTglJam(p.occurredAt)}`,
            }))}
            empty="Belum ada tindakan tercatat."
            target="procedures"
            canCorrect={canCorrect}
            busy={busy}
            run={run}
          />
          {canWrite && <ProcedureForm encounterId={encounterId} busy={busy} run={run} />}
        </section>
        <section aria-label="Alergi" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Alergi</h2>
          <span>
            {allergies.status === 'belum_dikaji' ? (
              <Chip tone="warning">Alergi belum dikaji</Chip>
            ) : allergies.status === 'nkda' ? (
              <Chip tone="success">Tidak ada alergi obat yang diketahui (NKDA)</Chip>
            ) : (
              <Chip tone="danger">{allergies.allergies.length} alergi tercatat</Chip>
            )}
          </span>
          <EntryList
            items={allergies.allergies.map((a) => ({
              id: a.id,
              main: a.substance?.name ?? a.text ?? 'Alergen',
              chip: a.criticality ? `Kritikalitas ${CRIT_LABEL[a.criticality].toLowerCase()}` : null,
              sub: `${a.category ? CATEGORY_LABEL[a.category] : ''}${a.reaction ? ` · ${a.reaction}` : ''} · ${a.author.nama}`,
            }))}
            empty="Tidak ada alergi tercatat."
            target="allergies"
            canCorrect={canCorrect}
            busy={busy}
            run={run}
          />
          {canWrite && (
            <AllergyForm
              patientId={patientId}
              encounterId={encounterId}
              showNkda={allergies.status === 'belum_dikaji'}
              busy={busy}
              run={run}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function EntryList({
  items,
  empty,
  target,
  canCorrect,
  busy,
  run,
}: {
  items: Array<{ id: string; main: string; chip: string | null; sub: string }>;
  empty: string;
  target: 'conditions' | 'procedures' | 'allergies';
  canCorrect: boolean;
  busy: boolean;
  run: Run;
}) {
  if (items.length === 0) return <p className="m-0 text-small text-ink-500">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((i) => (
        <EntryItem key={i.id} item={i} target={target} canCorrect={canCorrect} busy={busy} run={run} />
      ))}
    </ul>
  );
}

function EntryItem({
  item,
  target,
  canCorrect,
  busy,
  run,
}: {
  item: { id: string; main: string; chip: string | null; sub: string };
  target: 'conditions' | 'procedures' | 'allergies';
  canCorrect: boolean;
  busy: boolean;
  run: Run;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="flex flex-col gap-1 rounded-control border border-line px-3 py-2 text-small">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{item.main}</span>
        {item.chip && <Chip tone="info">{item.chip}</Chip>}
      </span>
      <span className="text-caption text-ink-500">{item.sub}</span>
      {canCorrect &&
        (open ? (
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-r`} className="text-caption font-semibold">
              Alasan salah entri (wajib, minimal 10 karakter)
            </label>
            <textarea
              id={`${id}-r`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={FIELD}
            />
            <span className="flex gap-2">
              <Button
                variant="danger"
                disabled={busy || reason.trim().length < 10}
                onClick={() =>
                  run(
                    () => enteredInErrorAction({ target, id: item.id, reason }),
                    () => setOpen(false),
                  )
                }
              >
                Tandai salah entri
              </Button>
              <Button onClick={() => setOpen(false)}>Batal</Button>
            </span>
          </span>
        ) : (
          <Button className="self-start" onClick={() => setOpen(true)}>
            Salah entri
          </Button>
        ))}
    </li>
  );
}

function FormBox({
  label,
  children,
  onSubmit,
}: {
  label: string;
  children: ReactNode;
  onSubmit: () => void;
}) {
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-2 rounded-control bg-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h3 className="m-0 text-small font-semibold">{label}</h3>
      {children}
    </form>
  );
}

function ConditionForm({
  encounterId,
  kind,
  defaultRole,
  busy,
  run,
}: {
  encounterId: string;
  kind: 'encounter' | 'problem_list';
  defaultRole: 'utama' | 'sekunder' | null;
  busy: boolean;
  run: Run;
}) {
  const id = useId();
  const [pick, setPick] = useState<CodedPick | null>(null);
  const [role, setRole] = useState<'utama' | 'sekunder' | 'komplikasi'>(defaultRole ?? 'sekunder');
  const [note, setNote] = useState('');
  const label = kind === 'encounter' ? 'Tambah diagnosis' : 'Tambah ke problem list';
  return (
    <FormBox
      label={label}
      onSubmit={() =>
        pick &&
        run(
          () =>
            addConditionAction({
              encounterId,
              kind,
              role: kind === 'encounter' ? role : null,
              code: pick.code,
              note: note.trim() || null,
            }),
          () => {
            setPick(null);
            setNote('');
          },
        )
      }
    >
      <CodeSearch
        label={kind === 'encounter' ? 'Diagnosis ICD-10' : 'Masalah ICD-10'}
        system="icd10"
        value={pick}
        onChange={setPick}
      />
      {kind === 'encounter' && (
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-role`} className="text-small font-semibold">
            Peran diagnosis
          </label>
          <select
            id={`${id}-role`}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className={SELECT}
          >
            {(Object.keys(ROLE_LABEL) as Array<keyof typeof ROLE_LABEL>).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </span>
      )}
      <label htmlFor={`${id}-note`} className="text-small font-semibold">
        Catatan (opsional)
      </label>
      <input
        id={`${id}-note`}
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        className={FIELD}
      />
      <Button type="submit" variant="primary" className="self-start" disabled={busy || !pick}>
        {label}
      </Button>
    </FormBox>
  );
}

function ProcedureForm({ encounterId, busy, run }: { encounterId: string; busy: boolean; run: Run }) {
  const [pick, setPick] = useState<CodedPick | null>(null);
  return (
    <FormBox
      label="Tambah tindakan"
      onSubmit={() =>
        pick &&
        run(
          () => addProcedureAction({ encounterId, code: pick.code, note: null }),
          () => setPick(null),
        )
      }
    >
      <CodeSearch label="Tindakan ICD-9-CM" system="icd9cm" value={pick} onChange={setPick} />
      <Button type="submit" variant="primary" className="self-start" disabled={busy || !pick}>
        Tambah tindakan
      </Button>
    </FormBox>
  );
}

function AllergyForm({
  patientId,
  encounterId,
  showNkda,
  busy,
  run,
}: {
  patientId: string;
  encounterId: string;
  showNkda: boolean;
  busy: boolean;
  run: Run;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<(typeof ALLERGY_CATEGORIES)[number]>('obat');
  const [criticality, setCriticality] = useState<(typeof ALLERGY_CRITICALITIES)[number]>('tinggi');
  const [reaction, setReaction] = useState('');
  return (
    <FormBox
      label="Catat alergi"
      onSubmit={() =>
        run(
          () =>
            addAllergyAction({
              kind: 'alergi',
              patientId,
              encounterId,
              text,
              category,
              criticality,
              reaction,
            }),
          () => {
            setText('');
            setReaction('');
          },
        )
      }
    >
      <label htmlFor={`${id}-t`} className="text-small font-semibold">
        Alergen
      </label>
      <input
        id={`${id}-t`}
        value={text}
        maxLength={120}
        onChange={(e) => setText(e.target.value)}
        className={FIELD}
      />
      <span className="grid gap-2 sm:grid-cols-2">
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-c`} className="text-small font-semibold">
            Kategori
          </label>
          <select
            id={`${id}-c`}
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className={SELECT}
          >
            {ALLERGY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-k`} className="text-small font-semibold">
            Kritikalitas
          </label>
          <select
            id={`${id}-k`}
            value={criticality}
            onChange={(e) => setCriticality(e.target.value as typeof criticality)}
            className={SELECT}
          >
            {ALLERGY_CRITICALITIES.map((c) => (
              <option key={c} value={c}>
                {CRIT_LABEL[c]}
              </option>
            ))}
          </select>
        </span>
      </span>
      <label htmlFor={`${id}-r`} className="text-small font-semibold">
        Reaksi (opsional)
      </label>
      <input
        id={`${id}-r`}
        value={reaction}
        maxLength={300}
        onChange={(e) => setReaction(e.target.value)}
        className={FIELD}
      />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || text.trim().length < 2}>
          Catat alergi
        </Button>
        {showNkda && (
          <Button
            disabled={busy}
            onClick={() => run(() => addAllergyAction({ kind: 'nkda', patientId, encounterId }))}
          >
            Catat tidak ada alergi obat (NKDA)
          </Button>
        )}
      </span>
    </FormBox>
  );
}
