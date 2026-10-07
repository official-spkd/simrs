'use client';

import type {
  CareTeamMember,
  ConsultantOption,
  ConsultKind,
  ConsultRequestRecord,
  ConsultUrgency,
} from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { ConsultantPicker } from '@/components/klinis/consultant-picker';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import {
  activePrimary,
  API_CARE_ROLE_LABEL,
  API_CONSULT_KIND_LABEL,
  API_FOLLOW_UP_LABEL,
  API_URGENCY_LABEL,
  apiAnswerBlocker,
  apiConsultStatus,
  apiSendBlocker,
  type ApiConsultDraft,
  handoverBlocker,
} from '@/lib/konsul-api';
import { formatTglJam } from '@/lib/rawat-inap';
import {
  answerConsultApiAction,
  changePrimaryApiAction,
  type KonsulActionResult,
  sendConsultApiAction,
} from '@/lib/server/data/klinis/konsul-actions';

const TONE = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
const FIELD = 'rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]';
const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5';

export interface ConsultMe {
  id: string;
  role: string | null;
  unitId: string | null;
}

/**
 * K10 · Konsultasi + tim perawatan satu kunjungan mode api (fase 3 · 3.8, ADR-0059; dipakai layar Konsultasi dan tab
 * "Dokumen & konsultasi" Rawat inap). Bentuk dan alur sama dengan layar demo (`rme/konsul-workspace.tsx`): kirim konsul
 * (urgensi + pertanyaan klinis), jawaban terstruktur hanya oleh konsultan tujuan, tindak lanjut rawat bersama/alih
 * rawat mengubah tim, serah DPJP utama beralasan. Data dari server; aksi lewat Server Action lalu `router.refresh()`.
 */
export function ConsultPanel({
  encounterId,
  consults,
  team,
  me,
  now,
  canWrite,
}: {
  encounterId: string;
  consults: readonly ConsultRequestRecord[];
  team: readonly CareTeamMember[];
  me: ConsultMe;
  now: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const run = (action: () => Promise<KonsulActionResult>, done?: () => void) =>
    start(async () => {
      const res = await action();
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        done?.();
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Konsul pasien ini" className={cx(CARD, 'flex-[2_1_520px]')}>
          <h2 className="m-0 text-body font-semibold">Konsul pasien ini</h2>
          {consults.length === 0 && (
            <p className="m-0 rounded-control bg-subtle px-3.5 py-3 text-small text-ink-700">
              Belum ada konsul pada kunjungan ini.
              {canWrite ? ' Kirim konsul baru di bawah bila butuh pendapat SMF lain.' : ''}
            </p>
          )}
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {consults.map((c) => (
              <ConsultItem key={c.id} c={c} me={me} now={now} busy={busy} run={run} />
            ))}
          </ol>
          {canWrite && <SendForm encounterId={encounterId} me={me} busy={busy} run={run} />}
        </section>
        <TeamCard encounterId={encounterId} team={team} me={me} canWrite={canWrite} busy={busy} run={run} />
      </div>
    </div>
  );
}

type Run = (action: () => Promise<KonsulActionResult>, done?: () => void) => void;

function ConsultItem({
  c,
  me,
  now,
  busy,
  run,
}: {
  c: ConsultRequestRecord;
  me: ConsultMe;
  now: string;
  busy: boolean;
  run: Run;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [ans, setAns] = useState({ findings: '', assessment: '', recommendation: '', accept: false });
  const st = apiConsultStatus(c, now);
  const block = apiAnswerBlocker(c, me);
  const answer = c.responses.at(-1);
  const comanage = c.kind !== 'konsultasi';
  return (
    <li>
      <article
        aria-labelledby={`${id}-judul`}
        className="flex flex-col gap-2 rounded-control border border-line px-3.5 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={c.urgency === 'segera' ? 'danger' : 'neutral'}>
            {c.urgency === 'segera' ? 'Cito' : 'Biasa'}
          </Chip>
          <Chip tone="info">{API_CONSULT_KIND_LABEL[c.kind]}</Chip>
          <span className="text-caption text-ink-500">
            Dikirim {formatTglJam(c.occurredAt)} · batas jawab {formatTglJam(c.dueAt)}
          </span>
        </div>
        <h3 id={`${id}-judul`} className="m-0 text-body font-semibold">
          {c.author.nama} → {c.toUser?.nama ?? `Unit ${c.toUnit?.name ?? '—'}`}
        </h3>
        <p className="m-0 text-small">{c.question}</p>
        <span className={cx('text-caption font-semibold', TONE[st.tone])}>{st.text}</span>
        {answer && (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-control bg-subtle px-3 py-2 text-small">
            <dt className="font-semibold">Temuan</dt>
            <dd className="m-0">{answer.findings || '—'}</dd>
            <dt className="font-semibold">Kesimpulan</dt>
            <dd className="m-0">{answer.assessment}</dd>
            <dt className="font-semibold">Rekomendasi</dt>
            <dd className="m-0">{answer.recommendation}</dd>
            <dt className="font-semibold">Tindak lanjut</dt>
            <dd className="m-0">{API_FOLLOW_UP_LABEL[answer.followUp]}</dd>
          </dl>
        )}
        {c.state === 'menunggu' && !open && (
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={block !== null}
              aria-describedby={block ? `${id}-why` : undefined}
              onClick={() => setOpen(true)}
            >
              Jawab konsul
            </Button>
            {block && (
              <span id={`${id}-why`} className="text-caption text-ink-500">
                {block}
              </span>
            )}
          </span>
        )}
        {open && (
          <form
            aria-label="Jawaban konsul"
            className="flex flex-col gap-2 rounded-control bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => answerConsultApiAction({ requestId: c.id, ...ans }),
                () => setOpen(false),
              );
            }}
          >
            {(
              [
                ['findings', 'Temuan pemeriksaan', false],
                ['assessment', 'Kesimpulan / diagnosis konsultan', true],
                ['recommendation', 'Rekomendasi tata laksana', true],
              ] as const
            ).map(([k, label, req]) => (
              <div key={k} className="flex flex-col gap-1">
                <label htmlFor={`${id}-${k}`} className="text-small font-semibold">
                  {label}
                  {req && <span className="text-danger"> *</span>}
                </label>
                <textarea
                  id={`${id}-${k}`}
                  rows={2}
                  value={ans[k]}
                  onChange={(e) => setAns({ ...ans, [k]: e.target.value })}
                  className={FIELD}
                />
              </div>
            ))}
            {comanage && (
              <label className="flex min-h-11 items-center gap-2 text-small font-semibold">
                <input
                  type="checkbox"
                  checked={ans.accept}
                  onChange={(e) => setAns({ ...ans, accept: e.target.checked })}
                  className="size-5"
                />
                {c.kind === 'rawat_bersama'
                  ? 'Terima rawat bersama (saya ikut merawat)'
                  : 'Terima alih rawat (saya menjadi DPJP utama)'}
              </label>
            )}
            <span className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !ans.assessment.trim() || !ans.recommendation.trim()}
              >
                Tanda tangani jawaban
              </Button>
              <Button onClick={() => setOpen(false)}>Batal</Button>
            </span>
          </form>
        )}
      </article>
    </li>
  );
}

function SendForm({
  encounterId,
  me,
  busy,
  run,
}: {
  encounterId: string;
  me: ConsultMe;
  busy: boolean;
  run: Run;
}) {
  const id = useId();
  const empty: ApiConsultDraft = { toUserId: '', kind: 'konsultasi', urgency: 'biasa', question: '' };
  const [draft, setDraft] = useState<ApiConsultDraft>(empty);
  const [target, setTarget] = useState<ConsultantOption | null>(null);
  const [tried, setTried] = useState(false);
  const block = apiSendBlocker(draft, me.role, me.id);
  return (
    <form
      aria-label="Kirim konsul baru"
      className="flex flex-col gap-2 rounded-control bg-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (block) return;
        run(
          () => sendConsultApiAction({ encounterId, ...draft }),
          () => {
            setDraft(empty);
            setTarget(null);
            setTried(false);
          },
        );
      }}
    >
      <h3 className="m-0 text-small font-semibold">Kirim konsul baru</h3>
      <div className="flex flex-wrap gap-2">
        <div className="flex min-w-0 flex-[2_1_240px] flex-col gap-1">
          <ConsultantPicker
            label="Dokter konsultan"
            value={target}
            onChange={(v) => {
              setTarget(v);
              setDraft({ ...draft, toUserId: v?.userId ?? '' });
            }}
          />
        </div>
        <div className="flex flex-[1_1_160px] flex-col gap-1">
          <label htmlFor={`${id}-jenis`} className="text-small font-semibold">
            Jenis
          </label>
          <select
            id={`${id}-jenis`}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as ConsultKind })}
            className={SELECT}
          >
            {(Object.keys(API_CONSULT_KIND_LABEL) as ConsultKind[]).map((k) => (
              <option key={k} value={k}>
                {API_CONSULT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-[1_1_160px] flex-col gap-1">
          <label htmlFor={`${id}-urg`} className="text-small font-semibold">
            Urgensi
          </label>
          <select
            id={`${id}-urg`}
            value={draft.urgency}
            onChange={(e) => setDraft({ ...draft, urgency: e.target.value as ConsultUrgency })}
            className={SELECT}
          >
            {(Object.keys(API_URGENCY_LABEL) as ConsultUrgency[]).map((u) => (
              <option key={u} value={u}>
                {API_URGENCY_LABEL[u]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label htmlFor={`${id}-tanya`} className="text-small font-semibold">
        Pertanyaan klinis <span className="text-danger">*</span>
      </label>
      <textarea
        id={`${id}-tanya`}
        rows={3}
        value={draft.question}
        onChange={(e) => setDraft({ ...draft, question: e.target.value })}
        className={FIELD}
      />
      {tried && block && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {block}
        </p>
      )}
      <Button type="submit" variant="primary" className="self-start" disabled={busy}>
        Kirim konsul
      </Button>
    </form>
  );
}

function TeamCard({
  encounterId,
  team,
  me,
  canWrite,
  busy,
  run,
}: {
  encounterId: string;
  team: readonly CareTeamMember[];
  me: ConsultMe;
  canWrite: boolean;
  busy: boolean;
  run: Run;
}) {
  const id = useId();
  const [target, setTarget] = useState('');
  const [picked, setPicked] = useState<ConsultantOption | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const primary = activePrimary(team);
  const active = team.filter((m) => !m.endedAt).length;
  const block = handoverBlocker(team, me, target, reason);
  const mayHandover = canWrite && me.role === 'dokter' && (!primary || primary.user.userId === me.id);
  return (
    <section aria-label="Tim perawatan" className={cx(CARD, 'flex-[1_1_300px]')}>
      <h2 className="m-0 text-body font-semibold">Tim perawatan</h2>
      <span className="text-small">
        DPJP utama: <span className="font-semibold">{primary?.user.nama ?? '—'}</span>
      </span>
      <ul aria-label="Anggota tim" className="m-0 flex list-none flex-col gap-2 p-0">
        {team.map((m) => (
          <li
            key={m.id}
            className={cx(
              'flex flex-col rounded-control border px-3 py-2 text-small',
              m.endedAt ? 'border-line bg-subtle' : 'border-line',
            )}
          >
            <span className={cx('font-semibold', m.endedAt && 'text-ink-500 line-through')}>
              {m.user.nama}
            </span>
            <span className="text-caption text-ink-700">
              {API_CARE_ROLE_LABEL[m.role]} · sejak {formatTglJam(m.startedAt)}
              {m.endedAt ? ` · berakhir ${formatTglJam(m.endedAt)}` : ''}
              {m.endReason ? ` · ${m.endReason}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <span className="text-caption text-ink-500">
        {active} anggota aktif. Perubahan DPJP utama tercatat sebagai versi baru; akses rekam ikut berpindah.
      </span>
      {mayHandover && (
        <form
          aria-label="Serah DPJP utama"
          className="flex flex-col gap-2 rounded-control bg-subtle p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (block) return;
            run(
              () => changePrimaryApiAction({ encounterId, userId: target, reason }),
              () => {
                setTarget('');
                setPicked(null);
                setReason('');
                setTried(false);
              },
            );
          }}
        >
          <h3 className="m-0 text-small font-semibold">Serah DPJP utama</h3>
          <ConsultantPicker
            label="Dokter penerima"
            value={picked}
            onChange={(v) => {
              setPicked(v);
              setTarget(v?.userId ?? '');
            }}
          />
          <label htmlFor={`${id}-alasan`} className="text-small font-semibold">
            Alasan (wajib, tercatat) <span className="text-danger">*</span>
          </label>
          <textarea
            id={`${id}-alasan`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={FIELD}
          />
          {tried && block && (
            <p role="alert" className="m-0 text-small font-semibold text-danger">
              {block}
            </p>
          )}
          <Button type="submit" className="self-start" disabled={busy}>
            Serahkan DPJP utama
          </Button>
        </form>
      )}
    </section>
  );
}
