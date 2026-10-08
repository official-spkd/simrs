'use client';

import {
  type AplicareSyncState,
  type BedBoardApi,
  type BedStatus,
  type DischargeDisposition,
  formatJam,
  type PractitionerOption,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { allocationCandidates, careClassLabel, manualTargets, transferTargets } from '@/lib/igd-api';
import { BED_STATUS_META, BOARDING_LATE_LABEL } from '@/lib/rawat-inap';
import { parseDiagnosis } from '@/lib/registration-api';
import {
  admitPlannedAction,
  allocateBedAction,
  cancelBedRequestAction,
  changeBedStatusAction,
  dischargeAction,
  emergencyAdmitAction,
  transferAction,
} from './actions-api';
import type { ApiBed, ApiUnit, BedPermissions } from './bed-live';

const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-body';
const CARD = 'flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';
type Msg = { ok: boolean; text: string; reasons?: string[] } | null;

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div
      role={msg.ok ? 'status' : 'alert'}
      className={cx('flex flex-col gap-1 text-small', msg.ok ? 'text-success' : 'text-danger')}
    >
      <p className="m-0 font-semibold">{msg.text}</p>
      {msg.reasons && msg.reasons.length > 0 && (
        <ul aria-label="Syarat yang belum terpenuhi" className="m-0 flex flex-col gap-0.5 pl-5 text-ink-800">
          {msg.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DISPOSITIONS: Array<[Exclude<DischargeDisposition, 'meninggal'>, string]> = [
  ['pulang', 'Pulang atas persetujuan dokter'],
  ['rujuk', 'Dirujuk ke RS lain'],
  ['pulang_paksa', 'Pulang atas permintaan sendiri'],
  ['pindah_rawat', 'Pindah rawat'],
];

export const GELANG_ROUTE = '/cetak/gelang';

/**
 * Bed terpilih: status bertulisan + versi; transisi manual berversi (`baseVersion`, beda → 409 dan papan dimuat
 * ulang); pasien di bed: pindah bed (transfer) dan pulang (lewat `DischargeGate` API), cetak gelang.
 */
export function BedPanel({
  bed,
  unit,
  board,
  canWrite,
  onClose,
}: {
  bed: ApiBed;
  unit: ApiUnit;
  board: BedBoardApi;
  canWrite: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] = useState<(typeof DISPOSITIONS)[number][0]>('pulang');
  const m = BED_STATUS_META[bed.status];
  const occupied = (bed.status === 'terisi' || bed.status === 'pulang') && bed.encounterId;
  const targets = transferTargets(board, bed.bedId);
  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; message: string; reasons?: string[] }>,
    ok: string,
  ) =>
    start(async () => {
      const r = await fn();
      if (r.ok) setMsg({ ok: true, text: ok });
      else
        setMsg({
          ok: false,
          text: r.reasons?.length ? 'Pasien belum bisa dipulangkan. Lengkapi dulu:' : r.message,
          reasons: r.reasons,
        });
      router.refresh();
    });

  const change = (to: BedStatus) =>
    run(async () => {
      const r = await changeBedStatusAction(bed.bedId, { status: to, baseVersion: bed.version, note: null });
      return r.ok ? { ok: true } : r;
    }, `${bed.code} kini ${BED_STATUS_META[to].label.toLowerCase()}.`);

  return (
    <section aria-label={`Bed ${bed.code}`} className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-body font-bold">
            {bed.code} · {unit.name}
          </h2>
          <span className="text-caption text-ink-500">
            {bed.room} · {careClassLabel(bed.careClass)} · versi {bed.version}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      </div>
      <p className="m-0 text-small">
        Status: <span className={cx('font-bold', m.text)}>{m.label}</span> sejak {formatJam(bed.since)}
        {bed.patientLabel ? ` · pasien ${bed.patientLabel}` : ''}
      </p>
      {canWrite && manualTargets(bed.status).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {manualTargets(bed.status).map((to) => (
            <Button key={to} size="sm" disabled={pending} onClick={() => change(to)}>
              Tandai {BED_STATUS_META[to].label.toLowerCase()}
            </Button>
          ))}
        </div>
      )}
      {occupied && bed.encounterId && (
        <>
          <Link
            href={`${GELANG_ROUTE}/${bed.encounterId}`}
            className="inline-flex min-h-11 items-center self-start text-small font-semibold"
          >
            Gelang identitas pasien
          </Link>
          {canWrite && (
            <form
              aria-label="Pindah bed"
              className="flex flex-col gap-2 border-t border-line-soft pt-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!target || !bed.encounterId) return;
                const encounterId = bed.encounterId;
                run(async () => {
                  const r = await transferAction({
                    encounterId,
                    locationId: target,
                    reason: reason.trim() || null,
                  });
                  return r.ok ? { ok: true } : r;
                }, 'Pasien dipindahkan; bed lama kini kotor.');
              }}
            >
              <h3 className="m-0 text-small font-semibold">Pindah bed (transfer)</h3>
              <label htmlFor={`${id}-tujuan`} className="flex flex-col gap-1 text-small font-semibold">
                Bed tujuan (siap)
                <select
                  id={`${id}-tujuan`}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className={INPUT}
                >
                  <option value="">Pilih bed…</option>
                  {targets.map(({ unit: u, bed: b }) => (
                    <option key={b.bedId} value={b.bedId}>
                      {b.code} · {u.name} · {careClassLabel(b.careClass)}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`${id}-alasan`} className="flex flex-col gap-1 text-small font-semibold">
                Alasan pindah (opsional)
                <input
                  id={`${id}-alasan`}
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                  className={INPUT}
                />
              </label>
              <Button type="submit" className="self-start" disabled={pending || !target}>
                Pindahkan pasien
              </Button>
            </form>
          )}
          {canWrite && (
            <form
              aria-label="Pulangkan pasien"
              className="flex flex-col gap-2 border-t border-line-soft pt-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!bed.encounterId) return;
                const encounterId = bed.encounterId;
                run(async () => {
                  const r = await dischargeAction({ encounterId, disposition });
                  return r.ok ? { ok: true } : r;
                }, 'Pasien pulang; bed kini kotor menunggu dibersihkan.');
              }}
            >
              <h3 className="m-0 text-small font-semibold">Pulangkan</h3>
              <label htmlFor={`${id}-disp`} className="flex flex-col gap-1 text-small font-semibold">
                Cara pulang
                <select
                  id={`${id}-disp`}
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value as typeof disposition)}
                  className={INPUT}
                >
                  {DISPOSITIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-caption text-ink-500">
                Syarat pulang diperiksa server: resume medis final ber-TTE DPJP; dirujuk juga surat rujukan.
                Disposisi meninggal dicatat dokter yang berelasi dengan pasien (surat keterangan kematian
                ber-TTE).
              </span>
              <Button type="submit" variant="danger" className="self-start" disabled={pending}>
                Pulangkan pasien
              </Button>
            </form>
          )}
        </>
      )}
      <Message msg={msg} />
    </section>
  );
}

const ORIGIN_LABEL: Record<BedBoardApi['requests'][number]['origin'], string> = {
  igd: 'IGD',
  ok: 'Kamar operasi',
  poli: 'Poli',
  lainnya: 'Lainnya',
};

/** Antrean permintaan bed: alokasi → admisi (dari IGD satu langkah, atau admisi terencana), batal beralasan. */
export function RequestsPanel({
  board,
  doctors,
  perms,
  onPickBed,
}: {
  board: BedBoardApi;
  doctors: PractitionerOption[];
  perms: BedPermissions;
  onPickBed: (bedId: string) => void;
}) {
  const bedCode = (bedId: string | null) => {
    if (!bedId) return null;
    for (const u of board.units) for (const b of u.beds) if (b.bedId === bedId) return b.code;
    return null;
  };
  // Hasil admisi disimpan di sini: permintaan yang sudah ditempati keluar dari daftar saat papan dimuat ulang.
  const [admitted, setAdmitted] = useState<Admitted | null>(null);
  return (
    <section aria-label="Permintaan bed" className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">Permintaan bed</h2>
        <span className="text-caption text-ink-500">{board.requests.length} terbuka</span>
      </div>
      {admitted && (
        <p
          role="status"
          className="m-0 rounded-control border border-zamrud-200 bg-alert-success px-3 py-2 text-small"
        >
          <span className="font-semibold text-success">
            Admisi selesai{admitted.bed ? ` di ${admitted.bed}` : ''}.
          </span>{' '}
          Gelang terbit · <Link href={`${GELANG_ROUTE}/${admitted.encounterId}`}>Cetak gelang</Link>
        </p>
      )}
      {board.requests.length === 0 && (
        <p className="m-0 text-small text-ink-500">Tidak ada permintaan bed terbuka.</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {board.requests.map((r) => (
          <RequestItem
            key={`${r.id}-${r.status}-${r.allocatedBedId ?? ''}`}
            req={r}
            board={board}
            bedCode={bedCode(r.allocatedBedId)}
            doctors={doctors}
            perms={perms}
            onPickBed={onPickBed}
            onAdmitted={setAdmitted}
          />
        ))}
      </ul>
    </section>
  );
}

/** Hasil admisi di layar (tanpa kode gelang, ADR-0109: kode hanya lewat aksi cetak). */
interface Admitted {
  encounterId: string;
  bed?: string;
}

function RequestItem({
  req,
  board,
  bedCode,
  doctors,
  perms,
  onPickBed,
  onAdmitted,
}: {
  req: BedBoardApi['requests'][number];
  board: BedBoardApi;
  bedCode: string | null;
  doctors: PractitionerOption[];
  perms: BedPermissions;
  onPickBed: (bedId: string) => void;
  onAdmitted: (a: Admitted) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [bed, setBed] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [pending, start] = useTransition();
  const candidates = allocationCandidates(board, req);
  const allocated = req.status === 'dialokasi' && req.allocatedBedId;

  const allocate = () =>
    start(async () => {
      const r = await allocateBedAction(req.id, { locationId: bed });
      setMsg(r.ok ? { ok: true, text: 'Bed dialokasikan (dipesan).' } : { ok: false, text: r.message });
      router.refresh();
    });
  const cancel = () =>
    start(async () => {
      const r = await cancelBedRequestAction(req.id, { reason: cancelReason.trim() });
      setMsg(r.ok ? { ok: true, text: 'Permintaan bed dibatalkan.' } : { ok: false, text: r.message });
      if (r.ok) setCancelOpen(false);
      router.refresh();
    });

  return (
    <li
      aria-label={`Permintaan ${req.patientLabel}`}
      className="flex flex-col gap-2 rounded-control border border-line-soft bg-white px-3 py-2.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {req.patientLabel} · dari {ORIGIN_LABEL[req.origin]}
        </span>
        <span className={cx('text-caption', req.boarding ? 'font-semibold text-danger' : 'text-ink-500')}>
          menunggu {req.waitMinutes} menit{req.boarding ? ` · ${BOARDING_LATE_LABEL}` : ''}
        </span>
      </div>
      <span className="text-caption text-ink-700">
        {careClassLabel(req.careClass)}
        {req.isolation ? ' · isolasi' : ''}
        {req.note ? ` · ${req.note}` : ''} · diminta {formatJam(req.requestedAt)}
      </span>
      {allocated && req.allocatedBedId ? (
        <p className="m-0 text-small">
          Dialokasikan:{' '}
          <button
            type="button"
            onClick={() => onPickBed(req.allocatedBedId as string)}
            className="cursor-pointer border-0 bg-transparent p-0 font-mono font-semibold text-brand-700 underline"
          >
            {bedCode ?? 'bed'}
          </button>{' '}
          (dipesan)
        </p>
      ) : (
        <span className="text-caption font-semibold text-warning">Menunggu alokasi bed</span>
      )}
      {perms.write && (
        <div className="flex flex-wrap items-end gap-2">
          <label
            htmlFor={`${id}-bed`}
            className="flex min-w-[180px] flex-1 flex-col gap-1 text-caption font-semibold"
          >
            {allocated ? 'Alokasi ulang ke' : 'Alokasikan ke bed siap'}
            <select id={`${id}-bed`} value={bed} onChange={(e) => setBed(e.target.value)} className={INPUT}>
              <option value="">{candidates.length ? 'Pilih bed…' : 'Tidak ada bed siap yang cocok'}</option>
              {candidates.map(({ unit, bed: b }) => (
                <option key={b.bedId} value={b.bedId}>
                  {b.code} · {unit.name}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={pending || !bed} onClick={allocate}>
            Alokasikan
          </Button>
        </div>
      )}
      {allocated && req.allocatedBedId && (
        <AdmitForm
          req={req}
          allocatedBedId={req.allocatedBedId}
          doctors={doctors}
          perms={perms}
          onAdmitted={onAdmitted}
        />
      )}
      {perms.write &&
        (cancelOpen ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-batal`} className="text-caption font-semibold">
              Alasan batal (minimal {SAFETY_REASON_MIN} karakter)
            </label>
            <input
              id={`${id}-batal`}
              value={cancelReason}
              maxLength={500}
              onChange={(e) => setCancelReason(e.target.value)}
              className={INPUT}
            />
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={pending || cancelReason.trim().length < SAFETY_REASON_MIN}
                onClick={cancel}
              >
                Batalkan permintaan
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelOpen(false)}>
                Tutup
              </Button>
            </span>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setCancelOpen(true)}>
            Batalkan permintaan…
          </Button>
        ))}
      <Message msg={msg} />
    </li>
  );
}

/**
 * Admisi bed yang sudah dipesan. Permintaan dari IGD → admisi rawat inap satu langkah (DPJP, persetujuan umum per
 * admisi, diagnosa awal untuk SEP rawat inap BPJS); admisi terencana (`planned`) → langsung masuk bed. Gelang terbit.
 */
function AdmitForm({
  req,
  allocatedBedId,
  doctors,
  perms,
  onAdmitted,
}: {
  req: BedBoardApi['requests'][number];
  allocatedBedId: string;
  doctors: PractitionerOption[];
  perms: BedPermissions;
  onAdmitted: (a: Admitted) => void;
}) {
  const router = useRouter();
  const id = useId();
  const key = useRef(crypto.randomUUID());
  const [dpjp, setDpjp] = useState('');
  const [signer, setSigner] = useState<'pasien' | 'wali'>('pasien');
  const [signerName, setSignerName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [dx, setDx] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const dxParsed = dx.trim() ? parseDiagnosis(dx, null) : null;
  const dxOk = !dx.trim() || !!dxParsed;
  const fromIgd = req.encounterClass === 'EMER';
  const planned = req.encounterClass === 'IMP' && req.plannedAdmissionId;

  if (fromIgd && !perms.admit) {
    return (
      <p className="m-0 text-caption text-ink-500">Admisi rawat inap oleh petugas pendaftaran/admisi.</p>
    );
  }
  if (!fromIgd && !planned) {
    return (
      <p className="m-0 text-caption text-ink-500">
        Daftarkan admisi rawat inap pasien ini di Pendaftaran, lalu masukkan ke bed dari sini.
      </p>
    );
  }
  if (planned && !perms.write) return null;

  const submit = () =>
    start(async () => {
      if (fromIgd) {
        const r = await emergencyAdmitAction(
          {
            bedRequestId: req.id,
            practitionerId: dpjp,
            generalConsent: {
              confirmedByStaff: true,
              signer,
              ...(signer === 'wali' ? { signerName: signerName.trim() } : {}),
            },
            initialDiagnosis: dxParsed,
          },
          key.current,
        );
        if (r.ok) {
          key.current = crypto.randomUUID();
          onAdmitted({ encounterId: r.data.encounterId, bed: r.data.bedCode });
          router.refresh();
        } else setMsg({ ok: false, text: r.message });
        return;
      }
      if (!req.plannedAdmissionId) return;
      const r = await admitPlannedAction({
        encounterId: req.plannedAdmissionId,
        locationId: allocatedBedId,
        initialDiagnosis: dxParsed,
      });
      if (r.ok) {
        onAdmitted({ encounterId: r.data.encounterId });
        router.refresh();
      } else setMsg({ ok: false, text: r.message });
    });

  const ready =
    (fromIgd ? !!dpjp && confirmed && (signer === 'pasien' || signerName.trim().length >= 2) : true) && dxOk;
  return (
    <form
      aria-label="Admisi rawat inap"
      className="flex flex-col gap-2 border-t border-line-soft pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) submit();
      }}
    >
      <h3 className="m-0 text-small font-semibold">
        {fromIgd ? 'Admisi rawat inap dari IGD' : 'Masukkan pasien ke bed (admisi terencana)'}
      </h3>
      {fromIgd && (
        <>
          <label htmlFor={`${id}-dpjp`} className="flex flex-col gap-1 text-caption font-semibold">
            DPJP rawat inap
            <select
              id={`${id}-dpjp`}
              value={dpjp}
              onChange={(e) => setDpjp(e.target.value)}
              className={INPUT}
            >
              <option value="">Pilih dokter…</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.specialty ? ` · ${d.specialty}` : ''}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0 text-small">
            <legend className="mb-1 p-0 text-caption font-semibold">
              Persetujuan umum rawat inap ditandatangani
            </legend>
            {(['pasien', 'wali'] as const).map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-signer`}
                  checked={signer === s}
                  onChange={() => setSigner(s)}
                  className="accent-brand-600"
                />
                {s === 'pasien' ? 'Pasien' : 'Wali'}
              </label>
            ))}
          </fieldset>
          {signer === 'wali' && (
            <label htmlFor={`${id}-wali`} className="flex flex-col gap-1 text-caption font-semibold">
              Nama wali
              <input
                id={`${id}-wali`}
                value={signerName}
                maxLength={120}
                onChange={(e) => setSignerName(e.target.value)}
                className={INPUT}
              />
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="size-[18px] accent-brand-600"
            />
            Persetujuan umum sudah ditandatangani
          </label>
        </>
      )}
      <label htmlFor={`${id}-dx`} className="flex flex-col gap-1 text-caption font-semibold">
        Diagnosa awal ICD-10 (wajib untuk SEP rawat inap BPJS)
        <input
          id={`${id}-dx`}
          value={dx}
          maxLength={200}
          placeholder="Mis. K35.8 Apendisitis akut"
          onChange={(e) => setDx(e.target.value)}
          className={INPUT}
        />
      </label>
      {!dxOk && (
        <span className="text-caption font-semibold text-danger">Awali dengan kode ICD-10 yang sah.</span>
      )}
      <Button type="submit" variant="primary" className="self-start" disabled={pending || !ready}>
        {pending ? 'Memproses…' : 'Admisi · terbitkan gelang'}
      </Button>
      <Message msg={msg} />
    </form>
  );
}

const SYNC_LABEL: Record<AplicareSyncState, string> = {
  terkirim: 'Terkirim',
  menunggu: 'Menunggu kirim',
  gagal: 'Gagal',
};

/** Status Aplicare BPJS per ruang (bangsal × kelas): revisi papan vs revisi yang sudah diterima BPJS. */
export function AplicarePanel({ board }: { board: BedBoardApi }) {
  const unitName = (unitId: string) => board.units.find((u) => u.unitId === unitId)?.name ?? '—';
  return (
    <section aria-label="Status Aplicare" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Aplicare BPJS (ketersediaan bed)</h2>
      {board.aplicare.length === 0 ? (
        <p className="m-0 text-small text-ink-500">
          Belum ada perubahan bed yang dilaporkan. Setiap perubahan status bed rawat inap dikirim otomatis.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
          {board.aplicare.map((a) => (
            <li key={a.roomCode} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-mono">{a.roomCode}</span> · {unitName(a.unitId)} ·{' '}
                {careClassLabel(a.careClass)}
              </span>
              <span
                className={cx(
                  'font-semibold',
                  a.state === 'terkirim'
                    ? 'text-success'
                    : a.state === 'gagal'
                      ? 'text-danger'
                      : 'text-warning',
                )}
              >
                {SYNC_LABEL[a.state]}
                {a.state === 'gagal' && a.lastErrorCode ? ` (${a.lastErrorCode})` : ''} ·{' '}
                {formatJam(a.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
