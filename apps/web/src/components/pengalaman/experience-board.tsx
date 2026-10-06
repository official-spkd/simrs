'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Chip, type ChipTone, Tabs } from '@simrs/ui';
import { useState } from 'react';
import {
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
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
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
import { type ComplaintEvent, complaintNumber, type ComplaintStoreState } from '@/lib/pengaduan-toko';

const G_TONE: Record<Grade, ChipTone> = { merah: 'danger', kuning: 'warning', hijau: 'success' };

/**
 * B13 · Pengaduan (diterima → grading → tindak lanjut unit → dijawab → selesai, catatan append-only atas nama
 * pengguna sesi, SLA per grading) dan survei kepuasan pasca-pulang (indeks per unit; skor rendah dijadikan
 * pengaduan). Tersimpan di toko demo (domain `pengaduan`, ADR-0085); jawaban masuk INM-12 di Mutu.
 */
export function ExperienceBoard({
  store,
  rev,
  responses,
  now,
}: {
  store: ComplaintStoreState;
  rev: number;
  responses: readonly SurveyResponse[];
  now: string;
}) {
  const [tab, setTab] = useState('pengaduan');
  const list = store.complaints;
  const converted = store.converted;
  const [sel, setSel] = useState(list[0]?.id ?? '');
  const [grade, setGrade] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [answer, setAnswer] = useState('');
  const { act, pending, flash } = useTokoAction('pengaduan', rev);
  const c = list.find((x) => x.id === sel);

  const update = (event: ComplaintEvent, entry: string, onOk?: () => void) => {
    const num = list.find((x) => 'id' in event && x.id === event.id)?.number ?? '';
    act(event, `${num}: ${entry} · ${demoStamp().jam}.`, onOk);
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
              reason={pending ? 'Menyimpan…' : grade ? null : 'Pilih grading dulu.'}
              onClick={() =>
                update(
                  { type: 'aduan.digrading', id: c.id, grade: grade as Grade, when: demoStamp().when },
                  `Digrading ${grade}, diteruskan ke ${c.unit}`,
                  () => setGrade(''),
                )
              }
            >
              Simpan grading dan teruskan
            </ReasonButton>
          </div>
        )}
        {c.stageNow === 1 && (
          <div className="flex flex-col gap-3">
            <TextField label="Tindak lanjut unit" rows={2} value={followUp} onChange={setFollowUp} />
            <ReasonButton
              reason={
                pending
                  ? 'Menyimpan…'
                  : followUp.trim().length < 10
                    ? 'Tulis tindak lanjut minimal 10 huruf.'
                    : null
              }
              onClick={() =>
                update(
                  { type: 'aduan.ditindaklanjuti', id: c.id, text: followUp.trim(), when: demoStamp().when },
                  followUp.trim(),
                  () => setFollowUp(''),
                )
              }
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
              reason={pending ? 'Menyimpan…' : answerBlock(answer)}
              onClick={() =>
                update(
                  { type: 'aduan.dijawab', id: c.id, answer: answer.trim(), when: demoStamp().when },
                  'Jawaban dikirim ke pelapor',
                  () => setAnswer(''),
                )
              }
            >
              Kirim jawaban
            </ReasonButton>
          </div>
        )}
        {c.stageNow === 3 && (
          <ReasonButton
            reason={pending ? 'Menyimpan…' : null}
            onClick={() =>
              update(
                { type: 'aduan.ditutup', id: c.id, when: demoStamp().when },
                'Pelapor menerima jawaban; pengaduan ditutup',
              )
            }
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
                <tr key={u.unit} className="transition-colors hover:bg-brand-50/60">
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
                className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-white/90 px-3 py-2 text-small transition-colors hover:bg-brand-50/60"
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
                      reason={pending ? 'Menyimpan…' : null}
                      onClick={() => {
                        const number = complaintNumber(store.seq);
                        act(
                          { type: 'survei.dijadikan-aduan', responseId: r.id, when: demoStamp().when },
                          `Skor rendah ${r.unit} dijadikan pengaduan ${number} · ${demoStamp().jam}.`,
                        );
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
