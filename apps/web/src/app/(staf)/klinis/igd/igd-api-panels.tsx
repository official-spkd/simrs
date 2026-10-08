'use client';

import {
  BED_STATUSES,
  type BedStatus,
  type EdBoardApi,
  type EdBoardItem,
  ED_STATUSES,
  ED_ZONES,
  type EdStatus,
  type EdZone,
  SEP_STATUS_LABEL,
} from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { manualTargets, placementOptions, zoneOfBedCode } from '@/lib/igd-api';
import { BED_STATUS_META, BOARDING_LATE_LABEL, ED_STATUS_META, ED_ZONE_LABEL } from '@/lib/rawat-inap';
import { parseDiagnosis } from '@/lib/registration-api';
import {
  changeIgdBedStatusAction,
  claimPatientAction,
  emergencySepAction,
  requestBedAction,
  setEdStatusAction,
} from './actions-api';

const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-body';
type Msg = { ok: boolean; text: string } | null;

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? 'status' : 'alert'}
      className={cx('m-0 text-small font-semibold', msg.ok ? 'text-success' : 'text-danger')}
    >
      {msg.text}
    </p>
  );
}

/** Status alur IGD + zona + penempatan bed IGD (`POST /encounters/:id/ed-status`). */
export function EdStatusForm({
  item,
  beds,
  canWrite,
}: {
  item: EdBoardItem;
  beds: EdBoardApi['beds'];
  canWrite: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [status, setStatus] = useState<EdStatus>(item.status ?? 'registrasi');
  const [zone, setZone] = useState<EdZone>(item.zone ?? 'T');
  const [bedId, setBedId] = useState<string>(item.bedId ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const options = placementOptions(beds, item.bedId);
  const current = item.status ? ED_STATUS_META[item.status].label : 'Identifikasi (baru terdaftar)';

  if (!canWrite) {
    return (
      <p className="m-0 text-small text-ink-700">
        Status: <span className="font-semibold">{current}</span> · {ED_ZONE_LABEL[item.zone ?? 'T']} · bed{' '}
        {item.bedCode ?? 'belum ditempatkan'}
      </p>
    );
  }
  const save = () =>
    start(async () => {
      const r = await setEdStatusAction(item.encounterId, { status, zone, locationId: bedId || null });
      if (r.ok) {
        setMsg({ ok: true, text: `Status ${ED_STATUS_META[status].label} tersimpan.` });
        router.refresh();
      } else setMsg({ ok: false, text: r.message });
    });
  return (
    <form
      aria-label="Status alur IGD"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3 className="m-0 text-body font-semibold">Status alur dan bed IGD</h3>
      <p className="m-0 text-caption text-ink-500">Sekarang: {current}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label htmlFor={`${id}-st`} className="flex flex-col gap-1 text-small font-semibold">
          Status
          <select
            id={`${id}-st`}
            value={status}
            onChange={(e) => setStatus(e.target.value as EdStatus)}
            className={INPUT}
          >
            {ED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ED_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-zn`} className="flex flex-col gap-1 text-small font-semibold">
          Zona
          <select
            id={`${id}-zn`}
            value={zone}
            onChange={(e) => setZone(e.target.value as EdZone)}
            className={INPUT}
          >
            {ED_ZONES.map((z) => (
              <option key={z} value={z}>
                {ED_ZONE_LABEL[z]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-bd`} className="flex flex-col gap-1 text-small font-semibold">
          Bed IGD
          <select
            id={`${id}-bd`}
            value={bedId}
            onChange={(e) => {
              setBedId(e.target.value);
              const b = beds.find((x) => x.bedId === e.target.value);
              const z = b ? zoneOfBedCode(b.code) : null;
              if (z) setZone(z);
            }}
            className={INPUT}
          >
            <option value="">{item.bedId ? 'Tetap di bed sekarang' : 'Belum ditempatkan'}</option>
            {options.map((b) => (
              <option key={b.bedId} value={b.bedId}>
                {b.code} · {b.room}
                {b.bedId === item.bedId ? ' (sekarang)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button type="submit" variant="primary" className="self-start" disabled={pending}>
        {pending ? 'Menyimpan…' : 'Simpan status'}
      </Button>
      <Message msg={msg} />
    </form>
  );
}

const REQUEST_CLASSES = [
  ['kelas_3', 'Kelas 3'],
  ['kelas_2', 'Kelas 2'],
  ['kelas_1', 'Kelas 1'],
  ['vip', 'VIP'],
  ['icu', 'ICU'],
  ['hcu', 'HCU'],
] as const;

/**
 * Keputusan rawat inap: permintaan bed ke papan tempat tidur (`POST /adt/bed-requests`, asal IGD). Alokasi dan admisi
 * di layar Tempat tidur; boarding > `bed.boarding_alert_hours` ditandai teks.
 */
export function DispositionPanel({
  item,
  canRequest,
  bedHref,
}: {
  item: EdBoardItem;
  canRequest: boolean;
  bedHref: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [careClass, setCareClass] = useState<string>('kelas_3');
  const [isolation, setIsolation] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const r = item.bedRequest;

  return (
    <section
      aria-label="Keputusan rawat inap"
      className="flex flex-col gap-2 border-t border-line-soft pt-2.5"
    >
      <h3 className="m-0 text-body font-semibold">Rawat inap</h3>
      {r ? (
        <p
          className={cx(
            'm-0 rounded-control border px-3 py-2 text-small font-semibold',
            r.status === 'dialokasi'
              ? 'border-zamrud-200 bg-alert-success text-success'
              : 'border-line-soft bg-subtle text-ink-700',
          )}
        >
          {r.status === 'dialokasi'
            ? `Bed ${r.allocatedBedCode ?? ''} dialokasikan · menunggu admisi di papan tempat tidur`
            : `Permintaan bed menunggu alokasi · ${r.waitMinutes} menit`}
          {r.boarding ? ` · ${BOARDING_LATE_LABEL}` : ''}
          {bedHref && (
            <>
              {' · '}
              <Link href={bedHref}>Buka papan tempat tidur</Link>
            </>
          )}
        </p>
      ) : !item.triaged ? (
        <p className="m-0 text-caption text-ink-500">Triase pasien dulu sebelum keputusan rawat inap.</p>
      ) : canRequest ? (
        <form
          aria-label="Minta bed rawat inap"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await requestBedAction({
                encounterId: item.encounterId,
                origin: 'igd',
                careClass,
                unitId: null,
                isolation,
                note: note.trim() || null,
              });
              if (res.ok) {
                setMsg({ ok: true, text: 'Permintaan bed terkirim ke papan tempat tidur.' });
                router.refresh();
              } else setMsg({ ok: false, text: res.message });
            });
          }}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label htmlFor={`${id}-kls`} className="flex flex-col gap-1 text-small font-semibold">
              Kelas rawat
              <select
                id={`${id}-kls`}
                value={careClass}
                onChange={(e) => setCareClass(e.target.value)}
                className={INPUT}
              >
                {REQUEST_CLASSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-cat`} className="flex flex-col gap-1 text-small font-semibold">
              Kebutuhan ruang
              <input
                id={`${id}-cat`}
                value={note}
                maxLength={300}
                placeholder="Mis. Penyakit dalam · pantau EWS"
                onChange={(e) => setNote(e.target.value)}
                className={INPUT}
              />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={isolation}
              onChange={(e) => setIsolation(e.target.checked)}
              className="size-[18px] accent-brand-600"
            />
            Butuh ruang isolasi
          </label>
          <Button type="submit" variant="primary" className="self-start" disabled={pending}>
            {pending ? 'Mengirim…' : 'Putuskan rawat inap · minta bed'}
          </Button>
        </form>
      ) : (
        <p className="m-0 text-caption text-ink-500">
          Keputusan rawat inap dicatat petugas IGD/admisi yang berizin tempat tidur (atas instruksi dokter).
        </p>
      )}
      <Message msg={msg} />
    </section>
  );
}

/** SEP IGD (BPJS): status, atau SEP menyusul dengan diagnosa awal dokter jaga (`POST /encounters/:id/emergency-sep`). */
export function SepPanel({ item, canWrite }: { item: EdBoardItem; canWrite: boolean }) {
  const router = useRouter();
  const id = useId();
  const [dx, setDx] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  if (item.payer?.kind !== 'bpjs') return null;
  const parsed = parseDiagnosis(dx, null);
  return (
    <section aria-label="SEP IGD" className="flex flex-col gap-2 border-t border-line-soft pt-2.5">
      <h3 className="m-0 text-body font-semibold">SEP IGD (BPJS)</h3>
      {item.sep ? (
        <p className="m-0 text-small">
          {SEP_STATUS_LABEL[item.sep.status]}
          {item.sep.number ? (
            <>
              {' · '}
              <span className="font-mono">{item.sep.number}</span>
            </>
          ) : null}
        </p>
      ) : canWrite ? (
        <form
          aria-label="SEP IGD menyusul"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed) return;
            start(async () => {
              const r = await emergencySepAction(item.encounterId, { initialDiagnosis: parsed, note: null });
              if (r.ok) {
                setMsg({ ok: true, text: 'SEP IGD dikirim ke BPJS (menunggu jawaban).' });
                setDx('');
                router.refresh();
              } else setMsg({ ok: false, text: r.message });
            });
          }}
        >
          <label htmlFor={`${id}-dx`} className="flex flex-col gap-1 text-small font-semibold">
            Diagnosa awal ICD-10 (dari dokter jaga)
            <input
              id={`${id}-dx`}
              value={dx}
              placeholder="Mis. R07.4 Nyeri dada"
              maxLength={200}
              onChange={(e) => setDx(e.target.value)}
              className={INPUT}
            />
          </label>
          {dx.trim() && !parsed && (
            <span className="text-caption font-semibold text-danger">Awali dengan kode ICD-10 yang sah.</span>
          )}
          <Button type="submit" className="self-start" disabled={pending || !parsed}>
            {pending ? 'Mengirim…' : 'Buat SEP IGD'}
          </Button>
        </form>
      ) : (
        <p className="m-0 text-caption text-ink-500">SEP IGD belum dibuat (petugas pendaftaran).</p>
      )}
      <Message msg={msg} />
    </section>
  );
}

/** Bed IGD: status bertulisan + transisi manual berversi (kotor → dibersihkan → siap, rusak). */
export function IgdBedsPanel({
  beds,
  items,
  canWrite,
}: {
  beds: EdBoardApi['beds'];
  items: readonly EdBoardItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const occupant = (encounterId: string | null) =>
    encounterId ? (items.find((i) => i.encounterId === encounterId)?.patientName ?? 'pasien') : null;
  const change = (bedId: string, to: BedStatus, version: number, code: string) =>
    start(async () => {
      const r = await changeIgdBedStatusAction(bedId, { status: to, baseVersion: version, note: null });
      if (r.ok) {
        setMsg({ ok: true, text: `${code} kini ${BED_STATUS_META[to].label.toLowerCase()}.` });
        router.refresh();
      } else setMsg({ ok: false, text: r.message });
    });
  const counts = Object.fromEntries(BED_STATUSES.map((s) => [s, beds.filter((b) => b.status === s).length]));
  return (
    <section
      aria-label="Bed IGD"
      className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">Bed IGD</h2>
        <span className="text-caption text-ink-500">
          Siap {counts.siap} · Terisi {counts.terisi} · Kotor {counts.kotor} · Dibersihkan{' '}
          {counts.dibersihkan}
        </span>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-0">
        {beds.map((b) => {
          const m = BED_STATUS_META[b.status];
          const targets = canWrite
            ? manualTargets(b.status).filter((t) => t !== 'pulang' && t !== 'terisi')
            : [];
          return (
            <li
              key={b.bedId}
              className={cx('flex flex-col gap-1 rounded-control border px-2.5 py-2', m.tile)}
            >
              <span className="flex items-baseline justify-between gap-1">
                <span className="font-mono text-caption font-semibold">{b.code}</span>
                <span className={cx('text-[11px] font-bold', m.text)}>{m.label}</span>
              </span>
              <span className="truncate text-[12.5px]">{occupant(b.encounterId) ?? '—'}</span>
              {targets.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={pending}
                  onClick={() => change(b.bedId, t, b.version, b.code)}
                  className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-2 text-caption font-semibold"
                >
                  Tandai {BED_STATUS_META[t].label.toLowerCase()}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
      <Message msg={msg} />
    </section>
  );
}

/**
 * "Ambil pasien": dokter jaga menjadi penanggung jawab IGD (tim perawatan, relasi resmi untuk resume, surat kematian,
 * dan dokumen ber-TTE lain tanpa akses darurat). Penanggung jawab lain digantikan (serah terima tercatat).
 */
export function ClaimPanel({
  item,
  canClaim,
  userId,
}: {
  item: EdBoardItem;
  canClaim: boolean;
  userId: string;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const mine = item.doctorUserId === userId;
  return (
    <section aria-label="Dokter penanggung jawab" className="flex flex-col gap-1.5">
      <p className="m-0 text-small">
        <span className="text-ink-500">Dokter penanggung jawab IGD: </span>
        <span className="font-semibold">{item.doctor ?? 'belum ada'}</span>
        {mine ? ' (Anda)' : ''}
      </p>
      {canClaim && !mine && (
        <Button
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await claimPatientAction(item.encounterId);
              if (r.ok) {
                setMsg({
                  ok: true,
                  text: r.data.replacedUserId
                    ? 'Pasien diambil alih; Anda penanggung jawab IGD sekarang.'
                    : 'Anda penanggung jawab IGD pasien ini.',
                });
                router.refresh();
              } else setMsg({ ok: false, text: r.message });
            })
          }
        >
          {item.doctor ? 'Ambil alih pasien' : 'Ambil pasien'}
        </Button>
      )}
      <Message msg={msg} />
    </section>
  );
}
