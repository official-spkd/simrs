'use client';

import { formatJam, formatTanggalLahir } from '@simrs/shared';
import { Button, Chip, cx, SafetyGate, type SafetyGateResolution } from '@simrs/ui';
import { useId, useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { formatTglJam } from '@/lib/rawat-inap';
import {
  type CarePackage,
  formatLabValue,
  type GateDecision,
  labFailures,
  markBlocker,
  missingItems,
  type PackageItem,
  type PackageSession,
  progressLabel,
  SESSION_STATUS_LABEL,
  type SessionStatus,
  setTodayStatus,
  startBlocker,
  todaySession,
} from '@/lib/rme-paket';
import { Feedback, type FeedbackMsg } from './feedback';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5';
const STATUS_TONE: Record<SessionStatus, 'success' | 'brand' | 'info' | 'neutral' | 'warning'> = {
  selesai: 'success',
  'hari-ini': 'brand',
  berlangsung: 'info',
  terjadwal: 'neutral',
  ditunda: 'warning',
};

/**
 * K15 · Paket layanan khusus satu pasien: jadwal sesi/siklus, kelengkapan per sesi (hak isi per profesi), gerbang lab
 * pra-tindakan (tunda atau override beralasan), lalu mulai → selesai sesi berjam. Keadaan lokal (simulasi, tidak
 * disimpan).
 */
export function PaketWorkspace({ pkg, role, user }: { pkg: CarePackage; role: string | null; user: string }) {
  const id = useId();
  const [items, setItems] = useState<PackageItem[]>(pkg.items);
  const [sessions, setSessions] = useState<PackageSession[]>(pkg.sessions);
  const [decision, setDecision] = useState<GateDecision>(null);
  const [gate, setGate] = useState<SafetyGateResolution | null>(null);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const today = todaySession(sessions);
  const fails = labFailures(pkg.labGates);
  const block = startBlocker({ items, labGates: pkg.labGates }, decision);
  const missing = missingItems(items);
  const clock = () => demoNow().toISOString();
  const say = (text: string) => setMsg({ ok: true, text: `${text} (simulasi, tidak disimpan).` });
  const oneStep = pkg.kind === 'anc';

  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label={`Paket ${pkg.title}`} className={cx(CARD, 'flex-[2_1_520px]')}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col">
              <h2 className="m-0 text-h2 font-semibold">
                {pkg.title} · {pkg.cycleLabel}
              </h2>
              <span className="text-small text-ink-700">{pkg.protocol}</span>
            </div>
            <Chip tone="info">{progressLabel(sessions)}</Chip>
          </div>
          <ol aria-label="Jadwal sesi" className="m-0 flex list-none flex-col p-0">
            {sessions.map((s) => (
              <li
                key={s.n}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 text-small"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">
                    {pkg.kind === 'anc'
                      ? `Kunjungan ${s.n}`
                      : pkg.kind === 'kemoterapi'
                        ? `Siklus ${s.n}`
                        : `Sesi ${s.n}`}{' '}
                    · {formatTanggalLahir(s.date)}
                  </span>
                  {s.note && <span className="text-caption text-ink-700">{s.note}</span>}
                </span>
                <Chip tone={STATUS_TONE[s.status]}>{SESSION_STATUS_LABEL[s.status]}</Chip>
              </li>
            ))}
          </ol>

          <h3 className="m-0 text-body font-semibold">
            Kelengkapan sesi hari ini ({items.length - missing.length} dari {items.length})
          </h3>
          <ul aria-label="Kelengkapan sesi" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {items.map((it) => {
              const mb = markBlocker(it, role);
              return (
                <li
                  key={it.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-2 text-small"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{it.label}</span>
                    {it.done ? (
                      <span className="text-caption font-semibold text-success">
                        ✓ {it.done.by} · {formatTglJam(it.done.at)}
                      </span>
                    ) : (
                      <span className="text-caption font-semibold text-warning">Belum lengkap</span>
                    )}
                  </span>
                  {!it.done && (
                    <span className="flex flex-col items-end gap-0.5">
                      <Button
                        size="sm"
                        disabled={!!mb || !today}
                        aria-describedby={mb ? `${id}-${it.id}` : undefined}
                        aria-label={`Tandai selesai: ${it.label}`}
                        onClick={() => {
                          const at = clock();
                          setItems((cur) =>
                            cur.map((x) => (x.id === it.id ? { ...x, done: { by: user, at } } : x)),
                          );
                          say(`${it.label} · selesai ${formatJam(at)}`);
                        }}
                      >
                        Tandai selesai
                      </Button>
                      {mb && (
                        <span id={`${id}-${it.id}`} className="text-caption text-ink-500">
                          {mb}
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Gerbang sesi" className={cx(CARD, 'flex-[1_1_340px]')}>
          <h2 className="m-0 text-body font-semibold">Gerbang sesi hari ini</h2>
          {pkg.labGates.length > 0 && (
            <ul aria-label="Lab pra-tindakan" className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {pkg.labGates.map((g) => {
                const ok = g.value >= g.min;
                return (
                  <li key={g.name} className="flex justify-between gap-2">
                    <span>{g.name}</span>
                    <span className={cx('font-mono font-semibold', ok ? 'text-success' : 'text-danger')}>
                      {formatLabValue(g.value)} {g.unit} {ok ? '✓' : `< ${formatLabValue(g.min)}`}
                    </span>
                  </li>
                );
              })}
              <li className="text-caption text-ink-500">Ambang = contoh protokol komite RS.</li>
            </ul>
          )}
          {fails.length > 0 && today && (
            <SafetyGate
              title={fails
                .map(
                  (f) =>
                    `${f.name} ${formatLabValue(f.value)} ${f.unit} di bawah ambang ${formatLabValue(f.min)}`,
                )
                .join('; ')}
              recommendation="Tunda sesi hari ini"
              overrideLabel="Lanjut dengan alasan klinis"
              resolved={gate}
              tone="danger"
              onFollow={() => {
                const at = clock();
                setSessions((cur) =>
                  setTodayStatus(
                    cur,
                    'ditunda',
                    `Ditunda ${formatJam(at)} · ${fails[0]?.name} di bawah ambang`,
                  ),
                );
                setGate({ kind: 'ikuti', text: `Sesi ditunda · ${formatJam(at)}` });
                say(`Sesi ditunda · ${formatJam(at)}; DPJP menjadwalkan ulang`);
              }}
              onOverride={(reason) => {
                const at = clock();
                setDecision({ kind: 'override', reason, by: user, at });
                setGate({ kind: 'override', text: `${reason} · ${user} · ${formatJam(at)}` });
                say(`Override gerbang lab tercatat · ${formatJam(at)}`);
              }}
            >
              Pemberian ditahan sampai ditindaklanjuti. Override memerlukan alasan klinis dan tercatat untuk
              ditinjau.
            </SafetyGate>
          )}
          {today ? (
            <>
              {today.status === 'hari-ini' && (
                <Button
                  variant="primary"
                  disabled={!!block}
                  aria-describedby={block ? `${id}-start` : undefined}
                  onClick={() => {
                    const at = clock();
                    setSessions((cur) =>
                      setTodayStatus(
                        cur,
                        oneStep ? 'selesai' : 'berlangsung',
                        `${oneStep ? 'Ditutup' : 'Mulai'} ${formatJam(at)} · ${user}`,
                      ),
                    );
                    say(`${oneStep ? pkg.finishLabel : `${pkg.title} dimulai`} · ${formatJam(at)}`);
                  }}
                >
                  {pkg.startLabel}
                </Button>
              )}
              {today.status === 'berlangsung' && (
                <Button
                  variant="primary"
                  onClick={() => {
                    const at = clock();
                    setSessions((cur) =>
                      setTodayStatus(cur, 'selesai', `Selesai ${formatJam(at)} · ${user}`),
                    );
                    say(`${pkg.cycleLabel} selesai · ${formatJam(at)}`);
                  }}
                >
                  {pkg.finishLabel}
                </Button>
              )}
              {today.status === 'hari-ini' && block && (
                <p id={`${id}-start`} role="status" className="m-0 text-small font-semibold text-warning">
                  {block}
                </p>
              )}
            </>
          ) : (
            <p className="m-0 text-small text-ink-500">Tidak ada sesi berjalan hari ini.</p>
          )}
        </section>
      </div>
    </div>
  );
}
