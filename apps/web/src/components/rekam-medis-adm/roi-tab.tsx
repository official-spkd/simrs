'use client';

import { formatJam, formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
  ConfirmBox,
  type Flash,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  SelectField,
  StageTrack,
} from '@/components/backoffice/kit';
import type { RoiRequest } from '@/lib/demo/fixtures/rekam-medis-adm';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  approvalBlock,
  deadlineText,
  deadlineTone,
  hoursLeft,
  ROI_CHECKS,
  ROI_KIND_LABEL,
  ROI_RESPONSE_HOURS,
  ROI_STAGES,
  roiDeadline,
  verificationBlock,
} from '@/lib/rekam-medis-adm';

export type RoiView = RoiRequest & { patientName: string; rm: string };

interface RoiState {
  stage: number;
  checks: boolean[];
  approver: string;
  at: Record<number, string>;
  rejected: { reason: string; at: string } | null;
}

const TONE: Record<ReturnType<typeof deadlineTone>, ChipTone> = {
  aman: 'neutral',
  mendekati: 'warning',
  lewat: 'danger',
};

function initial(r: RoiView): RoiState {
  return {
    stage: r.stage,
    checks: ROI_CHECKS.map(() => r.stage > 0),
    approver: '',
    at: r.verifiedAt ? { 1: formatTanggalWaktu(r.verifiedAt) } : {},
    rejected: null,
  };
}

/**
 * B09 · Pelepasan informasi & hak subjek data (UU PDP): diajukan → verifikasi identitas dan dasar (3 centang) →
 * disetujui orang lain dari penerima (pemisahan tugas) → dipenuhi (berkas bertanda air sekali pakai 24 jam, atau
 * koreksi sebagai versi baru). Tenggat 3×24 jam terlihat di daftar; tolak wajib beralasan.
 */
export function RoiTab({
  requests,
  approvers,
  now,
  operator,
}: {
  requests: readonly RoiView[];
  approvers: ReadonlyArray<{ name: string; role: string }>;
  /** Jam acuan tenggat saat halaman dibuka (ISO). */
  now: string;
  operator: string;
}) {
  const [sel, setSel] = useState(requests[0]?.id ?? '');
  const [state, setState] = useState<Record<string, RoiState>>(() =>
    Object.fromEntries(requests.map((r) => [r.id, initial(r)])),
  );
  const [rejecting, setRejecting] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const r = requests.find((x) => x.id === sel);
  const s = r ? state[r.id] : undefined;

  const update = (id: string, patch: Partial<RoiState>) =>
    setState((cur) => ({ ...cur, [id]: { ...(cur[id] as RoiState), ...patch } }));
  const stamp = () => formatTanggalWaktu(demoNow());

  if (!r || !s) {
    return (
      <Panel title="Permintaan informasi">
        <p className="m-0 text-small text-ink-500">Belum ada permintaan informasi atau hak subjek data.</p>
      </Panel>
    );
  }

  const deadline = roiDeadline(r.receivedAt);
  const left = hoursLeft(deadline, now);
  const done = s.stage >= 3;
  const verifyBlock = verificationBlock(s.checks);
  const approveBlock = approvalBlock(r.receiver, s.approver || null);

  const verify = () => {
    if (verifyBlock) return;
    update(r.id, { stage: 1, at: { ...s.at, 1: stamp() } });
    setFlash({
      ok: true,
      text: `${r.number}: identitas dan dasar diverifikasi oleh ${operator} · ${formatJam(demoNow())}.`,
    });
  };
  const approve = () => {
    if (approveBlock) return;
    update(r.id, { stage: 2, at: { ...s.at, 2: stamp() } });
    setFlash({ ok: true, text: `${r.number} disetujui ${s.approver} · ${formatJam(demoNow())}.` });
  };
  const fulfil = () => {
    update(r.id, { stage: 3, at: { ...s.at, 3: stamp() } });
    setFlash({
      ok: true,
      text:
        r.kind === 'koreksi'
          ? `${r.number}: koreksi diterapkan sebagai versi baru data identitas · ${formatJam(demoNow())}; data lama tetap tersimpan dan pasien diberi tahu (simulasi, tidak disimpan).`
          : `${r.number}: berkas bertanda air dikirim ke ${r.requester} · ${formatJam(demoNow())}; tautan sekali pakai berlaku 24 jam dan tercatat di log akses pasien (simulasi, tidak disimpan).`,
    });
  };
  const reject = (reason: string) => {
    update(r.id, { rejected: { reason, at: stamp() } });
    setRejecting(false);
    setFlash({
      ok: false,
      text: `${r.number} ditolak · ${formatJam(demoNow())}: ${reason}. Pemohon diberi tahu alasannya.`,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_300px] xl:max-w-[380px]">
          <Panel
            title="Permintaan masuk"
            sub={`UU PDP · data minimal · dijawab ≤ ${ROI_RESPONSE_HOURS / 24}×24 jam`}
            flush
          >
            {requests.map((x) => {
              const st = state[x.id] as RoiState;
              const h = hoursLeft(roiDeadline(x.receivedAt), now);
              const finished = st.stage >= 3 || st.rejected;
              return (
                <PickRow
                  key={x.id}
                  selected={x.id === sel}
                  onClick={() => {
                    setSel(x.id);
                    setRejecting(false);
                  }}
                  title={`${x.number} · ${x.requesterKind}`}
                  sub={`${ROI_KIND_LABEL[x.kind]} · ${x.patientName}`}
                  right={
                    st.rejected ? (
                      <Chip tone="danger">Ditolak</Chip>
                    ) : finished ? (
                      <Chip tone="success">Dipenuhi</Chip>
                    ) : (
                      <Chip tone={TONE[deadlineTone(h)]}>{deadlineText(h)}</Chip>
                    )
                  }
                />
              );
            })}
          </Panel>
        </div>
        <div className="min-w-0 flex-[999_1_480px]">
          <Panel
            title={`${r.number} · ${ROI_KIND_LABEL[r.kind]}`}
            sub={`Diterima ${formatTanggalWaktu(r.receivedAt)} oleh ${r.receiver}`}
            actions={
              s.rejected || done ? undefined : (
                <Chip tone={TONE[deadlineTone(left)]}>
                  Tenggat {formatTanggalWaktu(deadline)} · {deadlineText(left)}
                </Chip>
              )
            }
          >
            <StageTrack
              label={`Tahap ${r.number}`}
              stages={ROI_STAGES.map((label, i) => ({
                label,
                at: i === 0 ? formatTanggalWaktu(r.receivedAt) : (s.at[i] ?? null),
              }))}
              current={done ? ROI_STAGES.length : s.stage + 1}
              rejected={!!s.rejected}
            />
            <KeyValues
              rows={[
                ['Pemohon', `${r.requester} (${r.requesterKind})`],
                ['Pasien', `${r.patientName} · RM ${r.rm}`],
                ['Dasar', r.basis],
                ['Lingkup', r.scope.join(', ')],
              ]}
            />
            <hr className="m-0 border-0 border-t border-line" />

            {s.rejected ? (
              <Alert level="critical" title={`Ditolak · ${s.rejected.at}`}>
                {s.rejected.reason}
              </Alert>
            ) : s.stage === 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-small font-semibold text-ink-700">
                  Verifikasi oleh penerima ({operator})
                </span>
                {ROI_CHECKS.map((c, i) => (
                  <CheckField
                    key={c}
                    label={c}
                    checked={s.checks[i] ?? false}
                    onChange={(v) => update(r.id, { checks: s.checks.map((x, j) => (j === i ? v : x)) })}
                  />
                ))}
                <span className="flex flex-wrap items-start gap-2">
                  <ReasonButton reason={verifyBlock} onClick={verify}>
                    Verifikasi selesai
                  </ReasonButton>
                  {!rejecting && (
                    <Button variant="ghost" onClick={() => setRejecting(true)}>
                      Tolak permintaan…
                    </Button>
                  )}
                </span>
                {rejecting && (
                  <ConfirmBox
                    title={`Tolak ${r.number}?`}
                    confirmLabel="Tolak permintaan"
                    minReason={10}
                    reasonLabel="Alasan penolakan (dikirim ke pemohon, tercatat)"
                    danger
                    onCancel={() => setRejecting(false)}
                    onConfirm={reject}
                  >
                    Penolakan tidak bisa dibatalkan; pemohon boleh mengajukan ulang dengan dokumen yang
                    lengkap.
                  </ConfirmBox>
                )}
              </div>
            ) : s.stage === 1 ? (
              <div className="flex flex-col gap-3">
                <SelectField
                  label="Penyetuju"
                  value={s.approver}
                  onChange={(v) => update(r.id, { approver: v })}
                  placeholder="Pilih penyetuju…"
                  options={approvers.map((a) => [a.name, `${a.name} · ${a.role}`])}
                  hint={`Penerima permintaan: ${r.receiver}. Penyetuju wajib orang lain.`}
                />
                <ReasonButton reason={approveBlock} onClick={approve}>
                  Setujui {r.kind === 'koreksi' ? 'koreksi' : 'pelepasan'}
                </ReasonButton>
              </div>
            ) : s.stage === 2 ? (
              r.kind === 'koreksi' ? (
                <div className="flex flex-col gap-3">
                  <span className="text-small font-semibold text-ink-700">Usulan koreksi (versi baru)</span>
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {(r.correction ?? []).map((c) => (
                      <li key={c.field} className="rounded-control border border-line px-3 py-2 text-small">
                        <span className="block font-semibold">{c.field}</span>
                        <span className="block text-ink-500">
                          Lama: <s>{c.from}</s>
                        </span>
                        <span className="block text-ink-900">Baru: {c.to}</span>
                      </li>
                    ))}
                  </ul>
                  <span>
                    <Button variant="primary" onClick={fulfil}>
                      Terapkan koreksi
                    </Button>
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div
                    aria-label="Pratinjau berkas bertanda air"
                    role="img"
                    className="relative min-h-[120px] overflow-hidden rounded-control border border-line bg-subtle p-3.5"
                  >
                    <span className="block text-small font-semibold">
                      {r.scope[0]} · {r.patientName}
                    </span>
                    <span className="block text-caption text-ink-500">
                      Halaman 1 dari {r.scope.length + 2} · paket PDF
                    </span>
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-[-10%] top-[48%] -rotate-12 text-center text-[13px] font-bold tracking-wide text-danger/40"
                    >
                      DIRILIS UNTUK {r.requester.toUpperCase()} · {operator.toUpperCase()} ·{' '}
                      {formatTanggal(now).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-caption text-ink-500">
                    Tanda air nama pengakses + waktu di setiap halaman · tautan unduh sekali pakai, berlaku 24
                    jam.
                  </span>
                  <span>
                    <Button variant="primary" onClick={fulfil}>
                      Kirim berkas bertanda air
                    </Button>
                  </span>
                </div>
              )
            ) : (
              <Alert level="success" title={`Dipenuhi · ${s.at[3] ?? ''}`}>
                {r.kind === 'koreksi'
                  ? 'Data identitas versi baru berlaku; versi lama tetap tersimpan dan bisa ditelusuri. Pasien menerima pemberitahuan di aplikasi.'
                  : `Tautan sekali pakai terkirim ke ${r.requester}. Pelepasan tercatat di log akses pasien.`}
              </Alert>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
