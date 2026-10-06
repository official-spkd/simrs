'use client';

import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { answerConsultAction, sendConsultAction } from '@/app/(staf)/klinis/konsultasi/actions';
import { PERSONA } from '@/lib/demo/fixtures/staf';
import { useStoreAction } from '@/lib/demo/store/client';
import { formatTglJam } from '@/lib/rawat-inap';
import { shortWhen } from '@/lib/rme';
import {
  activeTeam,
  answerBlocker,
  CARE_ROLE_LABEL,
  type CareTeamMember,
  CONSULT_KIND_LABEL,
  type ConsultAnswer,
  type ConsultDraft,
  type ConsultKind,
  type ConsultRequest,
  consultantAccessUntil,
  consultStatus,
  FOLLOW_UP_LABEL,
  type FollowUp,
  primaryDoctor,
  sendBlocker,
  URGENCY_LABEL,
  type ConsultUrgency,
} from '@/lib/rme-konsul';
import { Feedback, type FeedbackMsg } from './feedback';

const TONE = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
const FIELD = 'rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]';
const SELECT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5';

/**
 * K10 · Konsultasi antar-DPJP dan rawat bersama: kotak masuk konsul, kirim konsul (urgensi + pertanyaan klinis),
 * jawaban terstruktur oleh dokter konsultan, tindak lanjut ke tim perawatan (rawat bersama / alih rawat = versi
 * baru tim), akses konsultan berbatas waktu. Konsul, jawaban, dan tim perawatan datang dari server (toko demo
 * `rekam-medis`); jawaban hanya oleh dokter konsultan yang dituju (posisi dokter dari sesi).
 */
export function KonsulWorkspace({
  encounterId,
  patientNames,
  consults,
  team,
  rev,
  consultants,
  role,
  user,
  now,
  route,
}: {
  encounterId: string;
  /** Nama pasien per id (kotak masuk lintas pasien). */
  patientNames: Readonly<Record<string, string>>;
  consults: readonly ConsultRequest[];
  team: readonly CareTeamMember[];
  /** Revisi toko `rekam-medis`. */
  rev: number;
  consultants: ReadonlyArray<{ name: string; specialty: string }>;
  role: string | null;
  user: string;
  now: string;
  route: string;
}) {
  const id = useId();
  const { run, pending } = useStoreAction(rev);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [ans, setAns] = useState<Omit<ConsultAnswer, 'by' | 'at'>>({
    findings: '',
    conclusion: '',
    recommendation: '',
    followUp: 'selesai',
  });
  const [ansTried, setAnsTried] = useState(false);
  const [draft, setDraft] = useState<ConsultDraft>({
    to: '',
    kind: 'sekali',
    urgency: 'biasa',
    question: '',
  });
  const [sendTried, setSendTried] = useState(false);
  const inbox = consults.filter((c) => !c.answer && (role === 'dokter' || role === 'dokter_residen'));
  const mine = consults.filter((c) => c.encounterId === encounterId);
  /** Dokter yang diperankan posisi aktif (posisi dokter = DPJP persona demo); menentukan konsul mana yang boleh dijawab. */
  const actor = role === 'dokter' ? PERSONA.dokter : user;
  const sendBlock = sendBlocker(draft, role, user);
  const dpjp = primaryDoctor(team);

  const answer = (c: ConsultRequest) => {
    setAnsTried(true);
    if (answerBlocker(c, ans, role, actor)) return;
    run(
      (r) => answerConsultAction({ consultId: c.id, ...ans }, r),
      (res) => {
        setMsg({ ok: res.ok, text: res.message });
        if (res.ok) setAnswering(null);
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      {inbox.length > 0 && (
        <section aria-label="Konsul masuk" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Konsul masuk belum dijawab ({inbox.length})</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {inbox.map((c) => {
              const st = consultStatus(c, now);
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2.5"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">
                      {patientNames[c.patientId]} · {c.urgency === 'cito' ? 'Cito' : 'Biasa'} · dari {c.from}
                    </span>
                    <span className={cx('text-caption font-semibold', TONE[st.tone])}>{st.text}</span>
                  </span>
                  {c.encounterId === encounterId ? (
                    <Chip tone="brand">Pasien ini</Chip>
                  ) : (
                    <Link
                      href={`${route}?pasien=${c.encounterId}`}
                      className="text-small font-semibold text-brand-700"
                    >
                      Buka konsul
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Konsul pasien ini" className={cx(CARD, 'flex-[2_1_560px]')}>
          <h2 className="m-0 text-body font-semibold">Konsul pasien ini</h2>
          {mine.length === 0 && (
            <p className="m-0 rounded-control bg-subtle px-3.5 py-3 text-small text-ink-700">
              Belum ada konsul pada kunjungan ini. Kirim konsul baru di bawah bila butuh pendapat SMF lain.
            </p>
          )}
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {mine.map((c) => {
              const st = consultStatus(c, now);
              const access = consultantAccessUntil(c);
              const block = answerBlocker(c, ans, role, actor);
              return (
                <li key={c.id}>
                  <article
                    aria-labelledby={`${c.id}-judul`}
                    className="flex flex-col gap-2 rounded-control border border-line px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={c.urgency === 'cito' ? 'danger' : 'neutral'}>
                        {c.urgency === 'cito' ? 'Cito' : 'Biasa'}
                      </Chip>
                      <Chip tone="info">{CONSULT_KIND_LABEL[c.kind]}</Chip>
                      <span className="text-caption text-ink-500">Dikirim {formatTglJam(c.sentAt)}</span>
                    </div>
                    <h3 id={`${c.id}-judul`} className="m-0 text-body font-semibold">
                      {c.from} → {c.to} (SMF {c.toSpecialty})
                    </h3>
                    <p className="m-0 text-small">{c.question}</p>
                    <span className={cx('text-caption font-semibold', TONE[st.tone])}>{st.text}</span>
                    {c.answer && (
                      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-control bg-subtle px-3 py-2 text-small">
                        <dt className="font-semibold">Temuan</dt>
                        <dd className="m-0">{c.answer.findings || '—'}</dd>
                        <dt className="font-semibold">Kesimpulan</dt>
                        <dd className="m-0">{c.answer.conclusion}</dd>
                        <dt className="font-semibold">Rekomendasi</dt>
                        <dd className="m-0">{c.answer.recommendation}</dd>
                        <dt className="font-semibold">Tindak lanjut</dt>
                        <dd className="m-0">{FOLLOW_UP_LABEL[c.answer.followUp]}</dd>
                      </dl>
                    )}
                    {access && (
                      <span className="text-caption text-ink-500">
                        Akses rekam konsultan berakhir {shortWhen(access, now)}
                      </span>
                    )}
                    {!c.answer && answering !== c.id && (
                      <span className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="primary"
                          disabled={role !== 'dokter'}
                          aria-describedby={role !== 'dokter' ? `${c.id}-why` : undefined}
                          onClick={() => {
                            setAnswering(c.id);
                            setAnsTried(false);
                            setAns({ findings: '', conclusion: '', recommendation: '', followUp: 'selesai' });
                          }}
                        >
                          Jawab konsul
                        </Button>
                        {role !== 'dokter' && (
                          <span id={`${c.id}-why`} className="text-caption text-ink-500">
                            Jawaban konsul ditandatangani dokter konsultan (posisi dokter).
                          </span>
                        )}
                      </span>
                    )}
                    {answering === c.id && (
                      <form
                        aria-label="Jawaban konsul"
                        className="flex flex-col gap-2 rounded-control bg-brand-50 p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          answer(c);
                        }}
                      >
                        {(
                          [
                            ['findings', 'Temuan pemeriksaan', false],
                            ['conclusion', 'Kesimpulan / diagnosis konsultan', true],
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
                        <label htmlFor={`${id}-tl`} className="text-small font-semibold">
                          Tindak lanjut
                        </label>
                        <select
                          id={`${id}-tl`}
                          value={ans.followUp}
                          onChange={(e) => setAns({ ...ans, followUp: e.target.value as FollowUp })}
                          className={SELECT}
                        >
                          {(Object.keys(FOLLOW_UP_LABEL) as FollowUp[]).map((f) => (
                            <option key={f} value={f}>
                              {FOLLOW_UP_LABEL[f]}
                            </option>
                          ))}
                        </select>
                        {ansTried && block && (
                          <p role="alert" className="m-0 text-small font-semibold text-danger">
                            {block}
                          </p>
                        )}
                        <span className="flex gap-2">
                          <Button type="submit" variant="primary" disabled={pending}>
                            Tanda tangani jawaban
                          </Button>
                          <Button onClick={() => setAnswering(null)}>Batal</Button>
                        </span>
                      </form>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>

          <form
            aria-label="Kirim konsul baru"
            className="flex flex-col gap-2 rounded-control bg-subtle p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setSendTried(true);
              if (sendBlock) return;
              run(
                (r) => sendConsultAction({ encounterId, ...draft }, r),
                (res) => {
                  setMsg({ ok: res.ok, text: res.message });
                  if (!res.ok) return;
                  setDraft({ to: '', kind: 'sekali', urgency: 'biasa', question: '' });
                  setSendTried(false);
                },
              );
            }}
          >
            <h3 className="m-0 text-small font-semibold">Kirim konsul baru</h3>
            <div className="flex flex-wrap gap-2">
              <div className="flex min-w-0 flex-[2_1_240px] flex-col gap-1">
                <label htmlFor={`${id}-ke`} className="text-small font-semibold">
                  Dokter konsultan
                </label>
                <select
                  id={`${id}-ke`}
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  className={SELECT}
                >
                  <option value="">Pilih konsultan…</option>
                  {consultants.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} · {c.specialty}
                    </option>
                  ))}
                </select>
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
                  {(Object.keys(CONSULT_KIND_LABEL) as ConsultKind[]).map((k) => (
                    <option key={k} value={k}>
                      {CONSULT_KIND_LABEL[k]}
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
                  {(Object.keys(URGENCY_LABEL) as ConsultUrgency[]).map((u) => (
                    <option key={u} value={u}>
                      {URGENCY_LABEL[u]}
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
            {sendTried && sendBlock && (
              <p role="alert" className="m-0 text-small font-semibold text-danger">
                {sendBlock}
              </p>
            )}
            <Button type="submit" variant="primary" className="self-start" disabled={pending}>
              Kirim konsul
            </Button>
          </form>
        </section>

        <section aria-label="Tim perawatan" className={cx(CARD, 'flex-[1_1_300px]')}>
          <h2 className="m-0 text-body font-semibold">Tim perawatan</h2>
          <span className="text-small">
            DPJP utama: <span className="font-semibold">{dpjp ?? '—'}</span>
          </span>
          <ul aria-label="Anggota tim" className="m-0 flex list-none flex-col gap-2 p-0">
            {team.map((m) => (
              <li
                key={m.id}
                className={cx(
                  'flex flex-col rounded-control border px-3 py-2 text-small',
                  m.until ? 'border-line bg-subtle' : 'border-line',
                )}
              >
                <span className={cx('font-semibold', m.until && 'text-ink-500 line-through')}>{m.name}</span>
                <span className="text-caption text-ink-700">
                  {CARE_ROLE_LABEL[m.role]} · sejak {formatTglJam(m.since)}
                  {m.until ? ` · berakhir ${formatTglJam(m.until)}` : ''}
                  {m.note ? ` · ${m.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <span className="text-caption text-ink-500">
            {activeTeam(team).length} anggota aktif. Perubahan DPJP utama tercatat sebagai versi baru; akses
            rekam ikut berpindah.
          </span>
        </section>
      </div>
    </div>
  );
}
