'use client';

import { Alert, Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import {
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { DemoPolling } from '@/components/front-office/demo-polling';
import { demoStamp } from '@/lib/backoffice-toko';
import {
  BOR_ALERT,
  boarding,
  type CcState,
  type CcWard,
  decisionAlerts,
  QUEUE_ALERT,
  wardRows,
} from '@/lib/command-center';
import { alertKey, type CommandAck, DECIDER_ROLES } from '@/lib/command-center-toko';

const ED_LABEL: Record<string, string> = {
  registrasi: 'Registrasi',
  triase: 'Triase',
  resusitasi: 'Resusitasi',
  pemeriksaan: 'Pemeriksaan',
  'tunggu-dokter': 'Tunggu dokter',
  'tunggu-lab': 'Tunggu hasil',
  observasi: 'Observasi',
  'tunggu-bed': 'Tunggu bed',
  'siap-pulang': 'Siap pulang',
};

/**
 * I09 · Command center: kapasitas bed per ruang, IGD (menunggu bed), antrean poli, dan alert keputusan yang wajib
 * ditindaklanjuti (pilihan tindakan + catatan). Data dibaca langsung dari toko demo layar asalnya (Tempat tidur,
 * IGD, antrean) dan diperbarui otomatis; keputusan alert tersimpan (domain `command-center`, ADR-0085).
 */
export function CommandBoard({
  asOf,
  wards,
  state,
  acks,
  rev,
  viewerRole,
}: {
  asOf: string;
  wards: readonly CcWard[];
  state: CcState;
  acks: Readonly<Record<string, CommandAck>>;
  rev: number;
  viewerRole: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const { act, pending, flash } = useTokoAction('command-center', rev);
  const canDecide = !!viewerRole && (DECIDER_ROLES as readonly string[]).includes(viewerRole);
  const rows = wardRows(wards, state.beds);
  const alerts = decisionAlerts(state, wards);
  const waitingBed = boarding(state.ed);
  const total = rows.reduce(
    (t, r) => ({ occ: t.occ + r.occupied, all: t.all + r.total, ready: t.ready + r.ready }),
    { occ: 0, all: 0, ready: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <DemoPolling intervalMs={5000} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3">
        <span className="flex flex-col">
          <span className="font-semibold">Data langsung · hari presentasi {asOf.slice(0, 10)}</span>
          <span className="text-caption text-ink-500">
            Bed dari Tempat tidur, IGD dari papan triase, antrean dari papan poli · diperbarui otomatis
          </span>
        </span>
      </div>
      <FlashLine flash={flash} />

      <section aria-label="Alert keputusan" className="flex flex-col gap-2">
        {!canDecide && alerts.length > 0 && (
          <span className="text-caption text-ink-500">Keputusan alert diambil posisi Manajemen.</span>
        )}
        {alerts.length === 0 && (
          <Alert level="success" title="Tidak ada alert">
            Semua indikator dalam ambang.
          </Alert>
        )}
        {alerts.map((a) => {
          const ack = acks[alertKey(a)];
          return (
            <div
              key={a.id}
              className={cx(
                'flex flex-col gap-2 rounded-card border px-4 py-3',
                ack
                  ? 'border-line bg-white'
                  : a.level === 'critical'
                    ? 'border-danger-border bg-danger-bg'
                    : 'border-warning-border bg-warning-bg',
              )}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-col">
                  <span
                    className={cx(
                      'font-semibold',
                      ack
                        ? 'text-ink-900'
                        : a.level === 'critical'
                          ? 'text-danger-strong'
                          : 'text-warning-strong',
                    )}
                  >
                    {a.level === 'critical' && !ack ? 'Kritis: ' : ''}
                    {a.title}
                  </span>
                  <span className="text-small text-ink-700">{a.detail}</span>
                  <span className="text-caption text-ink-500">Aturan: {a.rule}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={a.href} className="text-small font-medium text-brand-700">
                    {a.hrefLabel}
                  </Link>
                  {ack ? (
                    <Chip tone="success">
                      Ditindaklanjuti {ack.jam} · {ack.by}
                    </Chip>
                  ) : (
                    open !== a.id && (
                      <Button
                        variant="primary"
                        disabled={!canDecide}
                        onClick={() => {
                          setOpen(a.id);
                          setAction('');
                          setNote('');
                        }}
                      >
                        Putuskan tindakan<span className="sr-only">: {a.title}</span>
                      </Button>
                    )
                  )}
                </span>
              </span>
              {ack && (
                <span className="text-small text-ink-700">
                  {ack.action} · {ack.note}
                </span>
              )}
              {open === a.id && !ack && (
                <div className="flex flex-col gap-2 rounded-control border border-line bg-white p-3">
                  <SelectField
                    label="Tindakan"
                    value={action}
                    onChange={setAction}
                    placeholder="Pilih tindakan…"
                    options={a.actions.map((x) => [x, x])}
                  />
                  <TextField label="Catatan dan penanggung jawab" rows={2} value={note} onChange={setNote} />
                  <span className="flex flex-wrap gap-2">
                    <ReasonButton
                      reason={
                        pending
                          ? 'Menyimpan…'
                          : !action
                            ? 'Pilih tindakan.'
                            : note.trim().length < 10
                              ? 'Tulis catatan minimal 10 huruf.'
                              : null
                      }
                      onClick={() => {
                        const { jam } = demoStamp();
                        act(
                          {
                            type: 'alert.ditindaklanjuti',
                            key: alertKey(a),
                            title: a.title,
                            action,
                            note: note.trim(),
                            jam,
                          },
                          `Keputusan "${action}" untuk ${a.title.toLowerCase()} tercatat ${jam}; penanggung jawab diberi tahu.`,
                          () => setOpen(null),
                        );
                      }}
                    >
                      Simpan keputusan
                    </ReasonButton>
                    <Button variant="ghost" onClick={() => setOpen(null)}>
                      Batal
                    </Button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_520px]">
          <Panel
            title="Keterisian tempat tidur per ruang"
            sub={`${total.occ}/${total.all} terisi · ${total.ready} siap · ambang alert ${BOR_ALERT}%`}
            flush
          >
            <TableWrap label="Keterisian per ruang" minWidth={560}>
              <thead>
                <tr>
                  <th className={TH}>Ruang</th>
                  <th className={`${TH} text-right`}>Terisi</th>
                  <th className={`${TH} text-right`}>Siap</th>
                  <th className={`${TH} text-right`}>Pulang/dibersihkan</th>
                  <th className={TH}>BOR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td className={TD}>{r.name}</td>
                    <td className={`${TD} text-right font-mono`}>
                      {r.occupied}/{r.total}
                    </td>
                    <td className={`${TD} text-right font-mono`}>{r.ready}</td>
                    <td className={`${TD} text-right font-mono`}>{r.turnover}</td>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-20 overflow-hidden rounded-full bg-line-soft"
                          aria-hidden="true"
                        >
                          <span
                            className={cx('block h-full', r.bor > BOR_ALERT ? 'bg-danger' : 'bg-brand-600')}
                            style={{ width: `${r.bor}%` }}
                          />
                        </span>
                        <span
                          className={cx(
                            'font-mono text-small',
                            r.bor > BOR_ALERT && 'font-semibold text-danger',
                          )}
                        >
                          {r.bor}%
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 xl:max-w-[420px]">
          <Panel
            title="IGD saat ini"
            sub={`${state.ed.length} pasien · ${state.ambulances} ambulans menuju`}
            tone={waitingBed.length ? 'warning' : undefined}
          >
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {state.ed.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 border-b border-line-soft py-1">
                  <span className="min-w-0">
                    <span className="block truncate">{e.label}</span>
                    <span className="text-caption text-ink-500">
                      {e.triageLevel ? `Triase ${e.triageLevel}` : 'Belum triase'} · {e.losMinutes} menit
                    </span>
                  </span>
                  <Chip tone={e.status === 'tunggu-bed' ? 'danger' : 'neutral'}>
                    {ED_LABEL[e.status] ?? e.status}
                  </Chip>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Antrean rawat jalan" sub={`Alert bila menunggu > ${QUEUE_ALERT} pasien`}>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {state.queues.map((q) => (
                <li key={q.poliCode} className="flex justify-between gap-2">
                  <span>
                    {q.poliName} · dilayani {q.current ?? '—'}
                  </span>
                  <Chip tone={q.waiting > QUEUE_ALERT ? 'warning' : 'neutral'}>{q.waiting} menunggu</Chip>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
