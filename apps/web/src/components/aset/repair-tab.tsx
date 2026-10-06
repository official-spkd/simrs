'use client';

import { formatJam, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
  type Flash,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  SelectField,
  StageTrack,
  TextField,
} from '@/components/backoffice/kit';
import type { Asset, RepairTicket } from '@/lib/demo/fixtures/aset';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  completionBlock,
  formatDuration,
  type Impact,
  IMPACT_LABEL,
  minutesBetween,
  RESPONSE_SLA_HOURS,
  responseWithinSla,
  TICKET_STAGES,
} from '@/lib/aset';

export interface TicketView extends Omit<RepairTicket, 'stage'> {
  stage: number;
  at: Record<number, string>;
  note: string;
}

/**
 * B02 · Permintaan perbaikan → tiket → selesai: unit melapor (dampak menentukan SLA respons), IPSRS menerima dan
 * menetapkan teknisi, dikerjakan, selesai setelah uji fungsi + keselamatan listrik, lalu unit mengonfirmasi.
 */
export function RepairTab({
  assets,
  tickets,
  setTickets,
  technicians,
  now,
  nextNumber,
}: {
  assets: readonly Asset[];
  tickets: TicketView[];
  setTickets: (fn: (cur: TicketView[]) => TicketView[]) => void;
  technicians: readonly string[];
  now: string;
  nextNumber: () => string;
}) {
  const [sel, setSel] = useState(tickets[0]?.id ?? '');
  const [tech, setTech] = useState('');
  const [fnTest, setFnTest] = useState(false);
  const [elec, setElec] = useState(false);
  const [note, setNote] = useState('');
  const [assetId, setAssetId] = useState('');
  const [complaint, setComplaint] = useState('');
  const [impact, setImpact] = useState('');
  const [flash, setFlash] = useState<Flash | null>(null);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const t = tickets.find((x) => x.id === sel);
  const stamp = () => demoNow().toISOString();
  const patch = (id: string, p: Partial<TicketView>) =>
    setTickets((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const reportBlock = !assetId
    ? 'Pilih alat yang rusak.'
    : complaint.trim().length < 10
      ? 'Jelaskan keluhan minimal 10 huruf.'
      : !impact
        ? 'Pilih dampak ke layanan.'
        : null;
  const report = () => {
    if (reportBlock) return;
    const a = byId.get(assetId);
    const number = nextNumber();
    const id = `tkt-baru-${number}`;
    setTickets((cur) => [
      {
        id,
        number,
        assetId,
        unit: a?.location ?? '',
        reporter: 'Unit pelapor',
        complaint: complaint.trim(),
        impact: impact as Impact,
        reportedAt: stamp(),
        stage: 0,
        technician: null,
        respondedAt: null,
        at: {},
        note: '',
      },
      ...cur,
    ]);
    setSel(id);
    setFlash({
      ok: true,
      text: `Tiket ${number} dibuat · ${formatJam(demoNow())}; SLA respons ${RESPONSE_SLA_HOURS[impact as Impact]} jam.`,
    });
    setAssetId('');
    setComplaint('');
    setImpact('');
  };

  const advance = (to: number, extra: Partial<TicketView>, text: string) => {
    if (!t) return;
    patch(t.id, { stage: to, at: { ...t.at, [to]: formatTanggalWaktu(demoNow()) }, ...extra });
    setFlash({ ok: true, text: `${t.number}: ${text} · ${formatJam(demoNow())}.` });
  };

  let detail = (
    <Panel title="Tiket perbaikan">
      <p className="m-0 text-small text-ink-500">Pilih tiket di daftar kiri.</p>
    </Panel>
  );
  if (t) {
    const a = byId.get(t.assetId);
    const response = t.respondedAt ? minutesBetween(t.reportedAt, t.respondedAt) : null;
    const inSla = responseWithinSla(t.reportedAt, t.respondedAt, now, t.impact);
    const doneBlock = completionBlock({ functionTest: fnTest, electricalSafety: elec, note });
    detail = (
      <Panel
        title={`${t.number} · ${a?.name ?? ''}`}
        sub={`${t.unit} · dilaporkan ${formatTanggalWaktu(t.reportedAt)} oleh ${t.reporter}`}
        actions={
          <Chip tone={inSla ? 'success' : 'danger'}>
            {response !== null
              ? `Respons ${formatDuration(response)} ${inSla ? '(dalam SLA)' : '(lewat SLA)'}`
              : inSla
                ? `Menunggu respons · SLA ${RESPONSE_SLA_HOURS[t.impact]} jam`
                : 'Respons lewat SLA'}
          </Chip>
        }
      >
        <StageTrack
          label={`Tahap ${t.number}`}
          stages={TICKET_STAGES.map((label, i) => ({
            label,
            at:
              i === 0
                ? formatJam(t.reportedAt)
                : i === 1 && t.respondedAt
                  ? formatJam(t.respondedAt)
                  : (t.at[i] ?? null),
          }))}
          current={t.stage >= 4 ? TICKET_STAGES.length : t.stage + 1}
        />
        <KeyValues
          rows={[
            ['Keluhan', t.complaint],
            ['Dampak', IMPACT_LABEL[t.impact]],
            ['Teknisi', t.technician ?? 'belum ditetapkan'],
          ]}
        />
        <hr className="m-0 border-0 border-t border-line" />
        {t.stage === 0 ? (
          <div className="flex flex-col gap-3">
            <SelectField
              label="Teknisi"
              value={tech}
              onChange={setTech}
              placeholder="Pilih teknisi…"
              options={technicians.map((x) => [x, x])}
            />
            <ReasonButton
              reason={tech ? null : 'Pilih teknisi dulu.'}
              onClick={() => {
                advance(1, { technician: tech, respondedAt: stamp() }, `diterima IPSRS, teknisi ${tech}`);
                setTech('');
              }}
            >
              Terima dan tetapkan teknisi
            </ReasonButton>
          </div>
        ) : t.stage === 1 ? (
          <span>
            <Button variant="primary" onClick={() => advance(2, {}, 'mulai dikerjakan')}>
              Mulai kerjakan
            </Button>
          </span>
        ) : t.stage === 2 ? (
          <div className="flex flex-col gap-1">
            <CheckField label="Uji fungsi lulus" checked={fnTest} onChange={setFnTest} />
            <CheckField label="Uji keselamatan listrik lulus" checked={elec} onChange={setElec} />
            <TextField label="Tindakan perbaikan" rows={2} value={note} onChange={setNote} />
            <ReasonButton
              reason={doneBlock}
              onClick={() => {
                advance(
                  3,
                  { note: note.trim() },
                  'selesai, uji fungsi dan keselamatan lulus; menunggu konfirmasi unit',
                );
                setFnTest(false);
                setElec(false);
                setNote('');
              }}
            >
              Selesai dan lulus uji
            </ReasonButton>
          </div>
        ) : t.stage === 3 ? (
          <div className="flex flex-col gap-2">
            <span className="text-small text-ink-700">Tindakan: {t.note}</span>
            <span>
              <Button
                variant="primary"
                onClick={() => advance(4, {}, `${t.unit} mengonfirmasi alat berfungsi; tiket ditutup`)}
              >
                Konfirmasi unit dan tutup
              </Button>
            </span>
          </div>
        ) : (
          <Alert level="success" title={`Ditutup · ${t.at[4] ?? ''}`}>
            Alat kembali dipakai. Riwayat perbaikan masuk kartu aset {a?.code} dan data ASPAK.
          </Alert>
        )}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 xl:max-w-[400px]">
          <Panel title="Tiket perbaikan" sub={`${tickets.filter((x) => x.stage < 4).length} terbuka`} flush>
            {tickets.map((x) => (
              <PickRow
                key={x.id}
                selected={x.id === sel}
                onClick={() => setSel(x.id)}
                title={`${x.number} · ${byId.get(x.assetId)?.name ?? ''}`}
                sub={`${x.unit} · ${IMPACT_LABEL[x.impact].split(' · ')[0]}`}
                right={
                  <Chip tone={x.stage >= 4 ? 'success' : x.impact === 'kritis' ? 'danger' : 'info'}>
                    {x.stage >= 4 ? 'Ditutup' : TICKET_STAGES[x.stage]}
                  </Chip>
                }
              />
            ))}
          </Panel>
          <Panel title="Laporkan kerusakan" sub="Diisi unit pemakai alat">
            <SelectField
              label="Alat"
              value={assetId}
              onChange={setAssetId}
              placeholder="Pilih alat…"
              options={assets.map((a) => [a.id, `${a.name} · ${a.location}`])}
            />
            <TextField label="Keluhan" rows={2} value={complaint} onChange={setComplaint} />
            <SelectField
              label="Dampak ke layanan"
              value={impact}
              onChange={setImpact}
              placeholder="Pilih dampak…"
              options={(Object.keys(IMPACT_LABEL) as Impact[]).map((k) => [
                k,
                `${IMPACT_LABEL[k]} (respons ≤ ${RESPONSE_SLA_HOURS[k]} jam)`,
              ])}
            />
            <ReasonButton reason={reportBlock} onClick={report}>
              Kirim laporan
            </ReasonButton>
          </Panel>
        </div>
        <div className="min-w-0 flex-[999_1_460px]">{detail}</div>
      </div>
    </div>
  );
}
