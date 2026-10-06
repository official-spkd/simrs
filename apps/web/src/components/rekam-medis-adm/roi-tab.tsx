'use client';

import { formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
  ConfirmBox,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  StageTrack,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import type { RoiRequest } from '@/lib/demo/fixtures/rekam-medis-adm';
import {
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
import { MIN_ROI_REJECT, ROI_APPROVER_ROLES, type RoiProgress } from '@/lib/rekam-medis-adm-toko';

export type RoiView = RoiRequest & { patientName: string; rm: string };

const TONE: Record<ReturnType<typeof deadlineTone>, ChipTone> = {
  aman: 'neutral',
  mendekati: 'warning',
  lewat: 'danger',
};

/**
 * B09 · Pelepasan informasi & hak subjek data (UU PDP): diajukan → verifikasi identitas dan dasar (3 centang, oleh
 * pengguna sesi) → disetujui PENGGUNA LAIN (posisi Petugas privasi/Manajemen; pemisahan tugas memakai ID sesi) →
 * dipenuhi (berkas bertanda air sekali pakai 24 jam, atau koreksi sebagai versi baru). Tenggat 3×24 jam terlihat di
 * daftar; tolak wajib beralasan. Tersimpan di toko demo (domain `rekam-medis-adm`).
 */
export function RoiTab({
  requests,
  progress,
  rev,
  now,
  operator,
  viewerId,
  viewerRole,
}: {
  requests: readonly RoiView[];
  progress: Readonly<Record<string, RoiProgress>>;
  rev: number;
  /** Jam acuan tenggat saat halaman dibuka (ISO). */
  now: string;
  operator: string;
  viewerId: string;
  viewerRole: string | null;
}) {
  const [sel, setSel] = useState(requests[0]?.id ?? '');
  const [checks, setChecks] = useState<Record<string, boolean[]>>({});
  const [rejecting, setRejecting] = useState(false);
  const { act, pending, flash } = useTokoAction('rekam-medis-adm', rev);
  const r = requests.find((x) => x.id === sel);
  const s = r ? progress[r.id] : undefined;

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
  const myChecks = checks[r.id] ?? ROI_CHECKS.map(() => false);
  const verifyBlock = pending ? 'Menyimpan…' : verificationBlock(myChecks);
  const approveBlock = pending
    ? 'Menyimpan…'
    : !viewerRole || !(ROI_APPROVER_ROLES as readonly string[]).includes(viewerRole)
      ? 'Penyetuju: posisi Petugas privasi atau Manajemen.'
      : s.verifiedBy?.userId === viewerId || operator === r.receiver
        ? 'Anda yang memverifikasi/menerima permintaan ini: penyetuju harus pengguna lain (pemisahan tugas).'
        : null;
  const stamp = (i: number) => {
    const at = i === 1 ? s.verifiedAt : i === 2 ? s.approvedAt : i === 3 ? s.fulfilledAt : null;
    return at ? formatTanggalWaktu(at) : null;
  };
  const who = (i: number) =>
    (i === 1 ? s.verifiedBy : i === 2 ? s.approvedBy : i === 3 ? s.fulfilledBy : null)?.name;

  const verify = () =>
    act(
      { type: 'roi.diverifikasi', id: r.id, when: demoStamp().when },
      `${r.number}: identitas dan dasar diverifikasi oleh ${operator} · ${demoStamp().jam}.`,
    );
  const approve = () =>
    act(
      { type: 'roi.disetujui', id: r.id, when: demoStamp().when },
      `${r.number} disetujui ${operator} · ${demoStamp().jam}.`,
    );
  const fulfil = () =>
    act(
      { type: 'roi.dipenuhi', id: r.id, when: demoStamp().when },
      r.kind === 'koreksi'
        ? `${r.number}: koreksi diterapkan sebagai versi baru data identitas · ${demoStamp().jam}; data lama tetap tersimpan dan pasien diberi tahu.`
        : `${r.number}: berkas bertanda air dikirim ke ${r.requester} · ${demoStamp().jam}; tautan sekali pakai berlaku 24 jam dan tercatat di log akses pasien.`,
    );
  const reject = (reason: string) =>
    act({ type: 'roi.ditolak', id: r.id, reason, when: demoStamp().when }, null, () => setRejecting(false));

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
              const st = progress[x.id] as RoiProgress;
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
                at:
                  i === 0
                    ? formatTanggalWaktu(r.receivedAt)
                    : stamp(i)
                      ? `${stamp(i)}${who(i) ? ` · ${who(i)}` : ''}`
                      : null,
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
              <Alert
                level="critical"
                title={`Ditolak · ${formatTanggalWaktu(s.rejected.when)} oleh ${s.rejected.by.name}`}
              >
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
                    checked={myChecks[i] ?? false}
                    onChange={(v) =>
                      setChecks((cur) => ({ ...cur, [r.id]: myChecks.map((x, j) => (j === i ? v : x)) }))
                    }
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
                    minReason={MIN_ROI_REJECT}
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
                <span className="text-small text-ink-700">
                  Diverifikasi {s.verifiedBy?.name ?? r.receiver}. Penyetuju = pengguna yang masuk (posisi
                  Petugas privasi atau Manajemen), wajib orang lain.
                </span>
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
                    <Button variant="primary" disabled={pending} onClick={fulfil}>
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
                    <Button variant="primary" disabled={pending} onClick={fulfil}>
                      Kirim berkas bertanda air
                    </Button>
                  </span>
                </div>
              )
            ) : (
              <Alert level="success" title={`Dipenuhi · ${stamp(3) ?? ''} · ${who(3) ?? ''}`}>
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
