'use client';

import { formatJam, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Chip, type ChipTone, Tabs } from '@simrs/ui';
import { useState } from 'react';
import {
  type Flash,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  SelectField,
  StageTrack,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import type { Complaint } from '@/lib/demo/fixtures/pengalaman';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  answerBlock,
  COMPLAINT_STAGES,
  complaintDeadline,
  type Grade,
  GRADE_LABEL,
  indexByUnit,
  needsFollowUp,
  satisfactionIndex,
  slaState,
  SURVEY_ASPECTS,
  type SurveyResponse,
} from '@/lib/pengalaman';

const G_TONE: Record<Grade, ChipTone> = { merah: 'danger', kuning: 'warning', hijau: 'success' };

interface ComplaintState extends Complaint {
  stageNow: number;
  answeredAt: string | null;
  log: Array<{ at: string; by: string; text: string }>;
}

/**
 * B13 · Pengaduan (diterima → grading → tindak lanjut unit → dijawab → selesai, catatan append-only, SLA per
 * grading) dan survei kepuasan pasca-pulang (indeks per unit; skor rendah dijadikan pengaduan).
 */
export function ExperienceBoard({
  complaints,
  responses,
  now,
  operator,
}: {
  complaints: readonly Complaint[];
  responses: readonly SurveyResponse[];
  now: string;
  operator: string;
}) {
  const [tab, setTab] = useState('pengaduan');
  const [list, setList] = useState<ComplaintState[]>(() =>
    complaints.map((c) => ({ ...c, stageNow: c.stage, answeredAt: null, log: [...c.actions] })),
  );
  const [sel, setSel] = useState(complaints[0]?.id ?? '');
  const [grade, setGrade] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [answer, setAnswer] = useState('');
  const [converted, setConverted] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Flash | null>(null);
  const c = list.find((x) => x.id === sel);

  const update = (id: string, patch: Partial<ComplaintState>, entry: string) => {
    const at = demoNow().toISOString();
    setList((cur) =>
      cur.map((x) =>
        x.id === id ? { ...x, ...patch, log: [...x.log, { at, by: operator, text: entry }] } : x,
      ),
    );
    const num = list.find((x) => x.id === id)?.number ?? '';
    setFlash({ ok: true, text: `${num}: ${entry} · ${formatJam(at)}.` });
  };

  let detail = null;
  if (c) {
    const sla = c.grade ? slaState(c.receivedAt, c.grade, now, c.answeredAt) : null;
    detail = (
      <Panel
        title={`${c.number} · ${c.unit}`}
        sub={`${c.channel} · diterima ${formatTanggalWaktu(c.receivedAt)}`}
        actions={
          c.grade ? (
            <>
              <Chip tone={G_TONE[c.grade]}>{c.grade[0]?.toUpperCase() + c.grade.slice(1)}</Chip>
              {sla && (
                <Chip
                  tone={sla.state === 'lewat' ? 'danger' : sla.state === 'mendekati' ? 'warning' : 'neutral'}
                >
                  {sla.state === 'lewat'
                    ? 'Lewat SLA'
                    : c.answeredAt
                      ? 'Dijawab dalam SLA'
                      : `Tenggat ${formatTanggalWaktu(complaintDeadline(c.receivedAt, c.grade))}`}
                </Chip>
              )}
            </>
          ) : (
            <Chip tone="warning">Belum digrading</Chip>
          )
        }
      >
        <StageTrack
          label={`Tahap ${c.number}`}
          stages={COMPLAINT_STAGES.map((label) => ({ label }))}
          current={c.stageNow >= 4 ? COMPLAINT_STAGES.length : c.stageNow + 1}
        />
        <KeyValues
          rows={[
            ['Pelapor', `${c.reporter} · ${c.contactMasked}`],
            ['Isi', c.text],
          ]}
        />
        <ol
          aria-label="Catatan tindakan (tidak bisa diubah)"
          className="m-0 flex list-none flex-col gap-1.5 p-0 text-small"
        >
          {c.log.map((l) => (
            <li key={`${l.at}-${l.text}`} className="border-l-2 border-brand-600 pl-2.5">
              <span className="block">{l.text}</span>
              <span className="block text-caption text-ink-500">
                {l.by} · {formatTanggalWaktu(l.at)}
              </span>
            </li>
          ))}
        </ol>
        <hr className="m-0 border-0 border-t border-line" />
        {c.stageNow === 0 && (
          <div className="flex flex-col gap-3">
            <SelectField
              label="Grading risiko"
              value={grade}
              onChange={setGrade}
              placeholder="Pilih grading…"
              options={(Object.keys(GRADE_LABEL) as Grade[]).map((g) => [g, GRADE_LABEL[g]])}
            />
            <ReasonButton
              reason={grade ? null : 'Pilih grading dulu.'}
              onClick={() => {
                update(
                  c.id,
                  { grade: grade as Grade, stageNow: 1 },
                  `Digrading ${grade}, diteruskan ke ${c.unit}`,
                );
                setGrade('');
              }}
            >
              Simpan grading dan teruskan
            </ReasonButton>
          </div>
        )}
        {c.stageNow === 1 && (
          <div className="flex flex-col gap-3">
            <TextField label="Tindak lanjut unit" rows={2} value={followUp} onChange={setFollowUp} />
            <ReasonButton
              reason={followUp.trim().length < 10 ? 'Tulis tindak lanjut minimal 10 huruf.' : null}
              onClick={() => {
                update(c.id, { stageNow: 2 }, followUp.trim());
                setFollowUp('');
              }}
            >
              Catat tindak lanjut
            </ReasonButton>
          </div>
        )}
        {c.stageNow === 2 && (
          <div className="flex flex-col gap-3">
            <TextField
              label="Jawaban ke pelapor"
              rows={3}
              value={answer}
              onChange={setAnswer}
              hint={`Dikirim lewat kanal ${c.channel}; nomor kontak tidak ditampilkan ke unit.`}
            />
            <ReasonButton
              reason={answerBlock(answer)}
              onClick={() => {
                update(
                  c.id,
                  { stageNow: 3, answeredAt: demoNow().toISOString() },
                  'Jawaban dikirim ke pelapor',
                );
                setAnswer('');
              }}
            >
              Kirim jawaban
            </ReasonButton>
          </div>
        )}
        {c.stageNow === 3 && (
          <ReasonButton
            reason={null}
            onClick={() => update(c.id, { stageNow: 4 }, 'Pelapor menerima jawaban; pengaduan ditutup')}
          >
            Tutup pengaduan
          </ReasonButton>
        )}
        {c.stageNow >= 4 && (
          <Alert level="success" title="Pengaduan selesai">
            Masuk perhitungan kecepatan tanggap komplain (INM-12) dan laporan bulanan unit.
          </Alert>
        )}
      </Panel>
    );
  }

  const complaintsTab = (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[1_1_300px] xl:max-w-[400px]">
        <Panel title="Pengaduan terbuka" sub="Loket, telepon, WhatsApp, aplikasi, situs" flush>
          {list.map((x) => {
            const s = x.grade ? slaState(x.receivedAt, x.grade, now, x.answeredAt) : null;
            return (
              <PickRow
                key={x.id}
                selected={x.id === sel}
                onClick={() => setSel(x.id)}
                title={`${x.number} · ${x.unit}`}
                sub={x.text}
                right={
                  x.stageNow >= 4 ? (
                    <Chip tone="success">Selesai</Chip>
                  ) : !x.grade ? (
                    <Chip tone="warning">Grading</Chip>
                  ) : s?.state === 'lewat' ? (
                    <Chip tone="danger">Lewat SLA</Chip>
                  ) : (
                    <Chip tone={G_TONE[x.grade]}>{x.grade}</Chip>
                  )
                }
              />
            );
          })}
        </Panel>
      </div>
      <div className="min-w-0 flex-[999_1_460px]">{detail}</div>
    </div>
  );

  const low = responses.filter(needsFollowUp);
  const surveyTab = (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[999_1_440px]">
        <Panel
          title="Indeks kepuasan per unit"
          sub={`Survei otomatis 2 jam setelah pulang · skala 1–4 × 25 · ${responses.length} respons 30 hari`}
          actions={<Chip tone="brand">Indeks RS {satisfactionIndex(responses)}</Chip>}
          flush
        >
          <TableWrap label="Indeks kepuasan per unit" minWidth={420}>
            <thead>
              <tr>
                <th className={TH}>Unit</th>
                <th className={`${TH} text-right`}>Respons</th>
                <th className={`${TH} text-right`}>Indeks</th>
              </tr>
            </thead>
            <tbody>
              {indexByUnit(responses).map((u) => (
                <tr key={u.unit}>
                  <td className={TD}>{u.unit}</td>
                  <td className={`${TD} text-right font-mono`}>{u.n}</td>
                  <td className={`${TD} text-right`}>
                    <Chip tone={u.index >= 80 ? 'success' : 'warning'}>{u.index}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      </div>
      <div className="min-w-0 flex-[1_1_320px] xl:max-w-[440px]">
        <Panel title="Skor rendah perlu ditindaklanjuti" sub="Aspek bernilai ≤ 2 dari 4 · responden anonim">
          {low.map((r) => {
            const aspect = SURVEY_ASPECTS[r.scores.findIndex((s) => s <= 2)] ?? '';
            return (
              <div
                key={r.id}
                className="flex flex-col gap-1.5 rounded-control border border-line px-3 py-2 text-small"
              >
                <span className="font-semibold">
                  {r.unit} · {aspect}
                </span>
                <span className="text-ink-700">{r.comment}</span>
                {converted[r.id] ? (
                  <span className="font-semibold text-success">Dijadikan pengaduan {converted[r.id]}</span>
                ) : (
                  <span>
                    <ReasonButton
                      variant="secondary"
                      reason={null}
                      onClick={() => {
                        const number = `ADU-2610-${String(25 + Object.keys(converted).length).padStart(3, '0')}`;
                        const at = demoNow().toISOString();
                        setList((cur) => [
                          {
                            id: `adu-${r.id}`,
                            number,
                            channel: 'Situs web',
                            unit: r.unit,
                            reporter: 'Responden survei (anonim)',
                            contactMasked: 'tanpa kontak',
                            text: r.comment ?? aspect,
                            receivedAt: at,
                            grade: null,
                            stage: 0,
                            actions: [],
                            stageNow: 0,
                            answeredAt: null,
                            log: [{ at, by: operator, text: `Dibuat dari survei ${r.id}` }],
                          },
                          ...cur,
                        ]);
                        setConverted((cur) => ({ ...cur, [r.id]: number }));
                        setFlash({
                          ok: true,
                          text: `Skor rendah ${r.unit} dijadikan pengaduan ${number} · ${formatJam(at)}.`,
                        });
                      }}
                    >
                      Jadikan pengaduan<span className="sr-only"> dari survei {r.id}</span>
                    </ReasonButton>
                  </span>
                )}
              </div>
            );
          })}
          {low.length === 0 && <p className="m-0 text-small text-ink-500">Tidak ada skor rendah.</p>}
        </Panel>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Tabs
        label="Pengalaman pasien"
        value={tab}
        onChange={setTab}
        keepMounted
        panelClassName="pt-4 outline-none"
        items={[
          {
            id: 'pengaduan',
            label: 'Pengaduan',
            badge: String(list.filter((x) => x.stageNow < 4).length),
            badgeTone: 'danger',
            content: complaintsTab,
          },
          { id: 'survei', label: 'Survei kepuasan', content: surveyTab },
        ]}
      />
    </div>
  );
}
