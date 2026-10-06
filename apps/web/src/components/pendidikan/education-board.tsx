'use client';

import { formatJam, formatTanggal } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  ConfirmBox,
  type Flash,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  TextField,
} from '@/components/backoffice/kit';
import type { Trainee } from '@/lib/demo/fixtures/pendidikan';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  cosignRule,
  LEVEL_LABEL,
  LEVEL_UP_THRESHOLD,
  type LogbookEntry,
  levelUpBlock,
  returnBlock,
  type SupervisionLevel,
  verifiedCount,
} from '@/lib/pendidikan';

/**
 * B10 · Peserta didik: tingkat supervisi menentukan aturan co-sign; supervisor memverifikasi atau mengembalikan
 * logbook (umpan balik wajib), lalu menaikkan tingkat bila syarat tindakan terverifikasi terpenuhi.
 */
export function EducationBoard({
  trainees,
  logbook,
}: {
  trainees: readonly Trainee[];
  logbook: readonly LogbookEntry[];
}) {
  const [sel, setSel] = useState(trainees[0]?.id ?? '');
  const [levels, setLevels] = useState<Record<string, SupervisionLevel>>(() =>
    Object.fromEntries(trainees.map((t) => [t.id, t.level])),
  );
  const [entries, setEntries] = useState<LogbookEntry[]>([...logbook]);
  const [returning, setReturning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [askLevel, setAskLevel] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const t = trainees.find((x) => x.id === sel);
  const at = () => formatJam(demoNow());

  const setStatus = (id: string, status: LogbookEntry['status'], fb?: string) =>
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, status, feedback: fb } : e)));

  let detail = null;
  if (t) {
    const level = levels[t.id] ?? t.level;
    const verified = verifiedCount(entries, t.id, t.competency);
    const block = levelUpBlock(level, verified);
    const pending = entries.filter((e) => e.traineeId === t.id && e.status === 'menunggu');
    const next = Math.min(4, level + 1) as SupervisionLevel;
    detail = (
      <Panel
        title={t.name}
        sub={t.program}
        actions={
          <Chip tone="brand">
            Tingkat {level} · {LEVEL_LABEL[level]}
          </Chip>
        }
      >
        <KeyValues
          rows={[
            ['Supervisor', t.supervisor],
            ['Stase', `${t.rotation} · ${t.period}`],
            ['Aturan co-sign', cosignRule(level)],
            ['Menunggu co-sign', `${t.pendingCosign} catatan/order`],
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-semibold text-ink-700">
            Kompetensi: {t.competency} · {verified}/{LEVEL_UP_THRESHOLD} terverifikasi
          </span>
          <div
            role="progressbar"
            aria-label={`Kemajuan ${t.competency}`}
            aria-valuemin={0}
            aria-valuemax={LEVEL_UP_THRESHOLD}
            aria-valuenow={Math.min(verified, LEVEL_UP_THRESHOLD)}
            className="h-2 overflow-hidden rounded-full bg-line-soft"
          >
            <div
              className="h-full bg-brand-600"
              style={{ width: `${Math.min(100, (verified / LEVEL_UP_THRESHOLD) * 100)}%` }}
            />
          </div>
        </div>
        {askLevel ? (
          <ConfirmBox
            title={`Naikkan ${t.name} ke tingkat ${next}?`}
            confirmLabel="Naikkan tingkat"
            minReason={10}
            reasonLabel="Pernyataan supervisor (wajib, tercatat)"
            onCancel={() => setAskLevel(false)}
            onConfirm={(why) => {
              setLevels((cur) => ({ ...cur, [t.id]: next }));
              setAskLevel(false);
              setFlash({
                ok: true,
                text: `${t.name} naik ke tingkat ${next} (${LEVEL_LABEL[next]}) · ${at()}; aturan co-sign kini: ${cosignRule(next).toLowerCase()}. Alasan: ${why}.`,
              });
            }}
          >
            Aturan co-sign di CPPT dan CPOE berubah mulai sekarang.
          </ConfirmBox>
        ) : (
          <ReasonButton reason={block} variant="secondary" onClick={() => setAskLevel(true)}>
            Naikkan ke tingkat {next}…
          </ReasonButton>
        )}
        <hr className="m-0 border-0 border-t border-line" />
        <span className="text-small font-semibold text-ink-700">
          Logbook menunggu verifikasi ({pending.length})
        </span>
        {pending.length === 0 && (
          <p className="m-0 text-small text-ink-500">Tidak ada entri logbook yang menunggu.</p>
        )}
        {pending.map((e) => (
          <div
            key={e.id}
            className="flex flex-col gap-2 rounded-control border border-line px-3 py-2 text-small"
          >
            <span>
              <span className="font-semibold">{e.competency}</span> · {e.role} · RM {e.rm} ·{' '}
              {formatTanggal(e.date)}
            </span>
            {returning === e.id ? (
              <div className="flex flex-col gap-2">
                <TextField label="Umpan balik supervisor" rows={2} value={feedback} onChange={setFeedback} />
                <span className="flex flex-wrap gap-2">
                  <ReasonButton
                    reason={returnBlock(feedback)}
                    variant="secondary"
                    onClick={() => {
                      setStatus(e.id, 'dikembalikan', feedback.trim());
                      setReturning(null);
                      setFeedback('');
                      setFlash({
                        ok: true,
                        text: `Logbook ${e.competency} (${formatTanggal(e.date)}) dikembalikan dengan umpan balik · ${at()}.`,
                      });
                    }}
                  >
                    Kembalikan
                  </ReasonButton>
                  <Button variant="ghost" onClick={() => setReturning(null)}>
                    Batal
                  </Button>
                </span>
              </div>
            ) : (
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setStatus(e.id, 'terverifikasi');
                    setFlash({
                      ok: true,
                      text: `Logbook ${e.competency} RM ${e.rm} diverifikasi ${t.supervisor} · ${at()}.`,
                    });
                  }}
                >
                  Verifikasi<span className="sr-only"> logbook {formatTanggal(e.date)}</span>
                </Button>
                <Button size="sm" onClick={() => setReturning(e.id)}>
                  Kembalikan…<span className="sr-only"> logbook {formatTanggal(e.date)}</span>
                </Button>
              </span>
            )}
          </div>
        ))}
        {entries.some((e) => e.traineeId === t.id && e.status === 'dikembalikan') && (
          <Alert level="info" title="Dikembalikan ke peserta">
            Entri yang dikembalikan menunggu perbaikan peserta didik; umpan balik tersimpan di logbook.
          </Alert>
        )}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_300px] xl:max-w-[400px]">
          <Panel title="Peserta didik aktif" sub="Residen, koas, dan mahasiswa profesi" flush>
            {trainees.map((x) => {
              const pending = entries.filter((e) => e.traineeId === x.id && e.status === 'menunggu').length;
              return (
                <PickRow
                  key={x.id}
                  selected={x.id === sel}
                  onClick={() => {
                    setSel(x.id);
                    setAskLevel(false);
                    setReturning(null);
                  }}
                  title={x.name}
                  sub={`${x.rotation} · tingkat ${levels[x.id] ?? x.level}`}
                  right={pending ? <Chip tone="warning">{pending} logbook</Chip> : undefined}
                />
              );
            })}
          </Panel>
        </div>
        <div className="min-w-0 flex-[999_1_460px]">{detail}</div>
      </div>
    </div>
  );
}
